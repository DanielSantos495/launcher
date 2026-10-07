package main

import (
	"bytes"
	"errors"
	"io"
	"log"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"unicode"
)

// Pruebas añadidas por la revisión de seguridad (golang-security): no sustituyen a las del plan.

func TestValidateOpenRejectsUnsafeProfileDir(t *testing.T) {
	// Un Local State manipulado no debe permitir salir de <userDataDir> al construir la ruta de Preferences.
	for _, dir := range []string{"..", "../x", "a/b", "-x"} {
		profiles := map[string]string{dir: "Malo"}
		_, err := validateOpen(OpenRequest{V: 1, ProfileDirectory: dir, URL: "https://example.com"}, profiles, nil)
		if !errors.Is(err, errUnknownProfile) {
			t.Fatalf("%q: err = %v, want errUnknownProfile", dir, err)
		}
	}
}

func TestHandleErrorsDoNotLeakPaths(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "usuario-secreto")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	logger := log.New(io.Discard, "", 0)

	// Sin Local State.
	resp := handle(request{Cmd: "listProfiles"}, config{UserDataDir: dir}, logger)
	if resp["ok"] != false || strings.Contains(resp["error"].(string), "usuario-secreto") {
		t.Fatalf("listProfiles resp = %v", resp)
	}

	// Perfil válido sin Preferences y con contenedor pedido: falla cerrado sin mostrar la ruta.
	ls := `{"profile":{"info_cache":{"Default":{"name":"Work"}}}}`
	if err := os.WriteFile(filepath.Join(dir, "Local State"), []byte(ls), 0o600); err != nil {
		t.Fatal(err)
	}
	req := request{Cmd: "open", Open: OpenRequest{V: 1, ProfileDirectory: "Default", Container: "SpikeA", URL: "https://example.com"}}
	resp = handle(req, config{UserDataDir: dir}, logger)
	if resp["ok"] != false || strings.Contains(resp["error"].(string), "usuario-secreto") {
		t.Fatalf("open resp = %v", resp)
	}
}

func TestHandleOpenLogsOnlyHost(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("usa /usr/bin/true como navegador falso")
	}
	cfg := config{Browser: "brave", Exe: "/usr/bin/true", UserDataDir: "testdata/userdata", LaunchMode: "direct"}
	var buf bytes.Buffer
	req := request{Cmd: "open", Open: OpenRequest{V: 1, ProfileDirectory: "Default", Container: "SpikeA", URL: "https://mail.example.com/u/1/secreto?token=abc#frag"}}
	resp := handle(req, cfg, log.New(&buf, "", 0))
	if resp["ok"] != true {
		t.Fatalf("resp = %v", resp)
	}
	got := buf.String()
	if !strings.Contains(got, "mail.example.com") {
		t.Fatalf("log sin host: %q", got)
	}
	for _, leak := range []string{"secreto", "token", "abc", "frag", "SpikeA"} {
		if strings.Contains(got, leak) {
			t.Fatalf("log contiene %q: %q", leak, got)
		}
	}
}

func TestHandleOpenLogsRejection(t *testing.T) {
	var buf bytes.Buffer
	req := request{Cmd: "open", Open: OpenRequest{V: 1, ProfileDirectory: "Default", Container: "NoExiste", URL: "https://example.com/privado"}}
	resp := handle(req, testCfg, log.New(&buf, "", 0))
	if resp["ok"] != false || !strings.Contains(buf.String(), errUnknownContainer.Error()) || strings.Contains(buf.String(), "privado") {
		t.Fatalf("resp = %v, log = %q", resp, buf.String())
	}
}

func TestParseConfigRejectsUnsafeValues(t *testing.T) {
	abs := filepath.Join(t.TempDir(), "x")
	cases := map[string]string{
		"relative exe":      `{"browser":"brave","exe":"brave","userDataDir":"` + jsonPath(abs) + `","launchMode":"direct"}`,
		"relative data dir": `{"browser":"brave","exe":"` + jsonPath(abs) + `","userDataDir":"data","launchMode":"direct"}`,
		"unknown mode":      `{"browser":"brave","exe":"` + jsonPath(abs) + `","userDataDir":"` + jsonPath(abs) + `","launchMode":"shell"}`,
		"open without app":  `{"browser":"brave","exe":"` + jsonPath(abs) + `","userDataDir":"` + jsonPath(abs) + `","launchMode":"open"}`,
		"legacy localState": `{"browser":"brave","exe":"` + jsonPath(abs) + `","localState":"` + jsonPath(abs) + `","launchMode":"direct"}`,
		"missing browser":   `{"exe":"` + jsonPath(abs) + `","userDataDir":"` + jsonPath(abs) + `","launchMode":"direct"}`,
		"not json":          `{`,
		// En Windows, CreateProcess ejecuta .bat/.cmd con cmd.exe, que interpretaría "&" de la URL.
		"batch exe": `{"browser":"brave","exe":"` + jsonPath(abs) + `.CMD","userDataDir":"` + jsonPath(abs) + `","launchMode":"direct"}`,
	}
	for name, raw := range cases {
		if _, err := parseConfig([]byte(raw)); err == nil {
			t.Errorf("%s: want error", name)
		}
	}
	ok := `{"browser":"brave","exe":"` + jsonPath(abs) + `","userDataDir":"` + jsonPath(abs) + `","launchMode":"direct"}`
	if _, err := parseConfig([]byte(ok)); err != nil {
		t.Fatalf("valid config: %v", err)
	}
}

// jsonPath escapa las barras invertidas de las rutas de Windows dentro de un literal JSON.
func jsonPath(p string) string { return strings.ReplaceAll(p, `\`, `\\`) }

// FuzzValidateOpenURL: si validateOpen acepta una URL, el argumento resultante es seguro para pasarlo tras "--".
func FuzzValidateOpenURL(f *testing.F) {
	for _, s := range []string{
		"https://example.com/a b#sección",
		"https://example.com/?q=a b",
		"https://example.com/?q=\u0085",
		"HTTPS://Example.com/",
		"javascript:alert(1)",
		"https://u:p@example.com",
		"--incognito",
		`http:/\evil.com`,
		"https://example.com/‮",
	} {
		f.Add(s)
	}
	profiles := map[string]string{"Default": "Work"}
	f.Fuzz(func(t *testing.T, raw string) {
		got, err := validateOpen(OpenRequest{V: 1, ProfileDirectory: "Default", URL: raw}, profiles, nil)
		if err != nil {
			return
		}
		if strings.HasPrefix(got, "-") || strings.ContainsFunc(got, unicode.IsControl) {
			t.Fatalf("argumento inseguro %q (de %q)", got, raw)
		}
		u, err := url.Parse(got)
		if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Host == "" || u.User != nil {
			t.Fatalf("re-parse de %q (de %q) = %v, %v", got, raw, u, err)
		}
	})
}
