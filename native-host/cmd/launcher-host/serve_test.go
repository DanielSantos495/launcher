package main

import (
	"bytes"
	"encoding/binary"
	"errors"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/DanielSantos495/launcher/native-host/internal/caller"
	"github.com/DanielSantos495/launcher/native-host/internal/framing"
	"github.com/DanielSantos495/launcher/native-host/internal/protocol"
)

var t0 = time.Date(2026, 10, 8, 12, 0, 0, 0, time.UTC)

// testExtensionID cumple ^[a-p]{32}$.
const testExtensionID = "abcdefghijklmnopabcdefghijklmnop"

const browserExe = "/Applications/Fake Browser.app/Contents/MacOS/Fake Browser"

type startCall struct {
	exe  string
	args []string
}

type fakeStarter struct{ calls []startCall }

func (f *fakeStarter) Start(exe string, args []string) error {
	f.calls = append(f.calls, startCall{exe: exe, args: slices.Clone(args)})
	return nil
}

// forbiddenReader falla la prueba si alguien lee de él: prueba que las comprobaciones del llamador van antes de leer
// el marco.
type forbiddenReader struct{ t *testing.T }

func (r forbiddenReader) Read([]byte) (int, error) {
	r.t.Error("se leyó de stdin antes de comprobar al llamador")
	return 0, io.EOF
}

type failingWriter struct{}

func (failingWriter) Write([]byte) (int, error) { return 0, errors.New("tubería cerrada") }

// serveEnv es el entorno de una prueba de serve: una carpeta del binario con config.json, una copia de testdata/macos
// como userDataDir, un lanzador falso y un padre que coincide con el navegador configurado.
type serveEnv struct {
	t       *testing.T
	exeDir  string
	userDir string
	cfg     caller.Config
	starter *fakeStarter
	ppid    int
	lookup  caller.ParentLookup
	origin  string
}

func newServeEnv(t *testing.T, logEnabled bool) *serveEnv {
	t.Helper()
	e := &serveEnv{t: t, exeDir: t.TempDir(), userDir: t.TempDir(), starter: &fakeStarter{}, ppid: 4242}
	copyTree(t, filepath.Join("..", "..", "testdata", "macos"), e.userDir)
	e.cfg = caller.Config{
		Browser: "brave", Exe: browserExe, UserDataDir: e.userDir, ExtensionID: testExtensionID,
		BinarySHA256: strings.Repeat("0", 64), Log: logEnabled,
	}
	e.writeConfig()
	e.lookup = func(pid int) (string, error) {
		if pid != e.ppid {
			t.Errorf("Lookup(%d), quiero el ppid %d", pid, e.ppid)
		}
		return browserExe, nil
	}
	e.origin = caller.Origin(testExtensionID)
	return e
}

func (e *serveEnv) writeConfig() {
	e.t.Helper()
	b, err := e.cfg.Encode()
	if err != nil {
		e.t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(e.exeDir, caller.ConfigFile), b, 0o600); err != nil {
		e.t.Fatal(err)
	}
}

func copyTree(t *testing.T, src, dst string) {
	t.Helper()
	err := filepath.WalkDir(src, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(src, path)
		if err != nil {
			return err
		}
		target := filepath.Join(dst, rel)
		if d.IsDir() {
			return os.MkdirAll(target, 0o700)
		}
		b, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		return os.WriteFile(target, b, 0o600)
	})
	if err != nil {
		t.Fatal(err)
	}
}

func (e *serveEnv) deps(stdin io.Reader, stdout io.Writer) serveDeps {
	return serveDeps{
		ExeDir: e.exeDir, Origin: e.origin, PPID: e.ppid, Lookup: e.lookup, Stdin: stdin, Stdout: stdout,
		Now:     func() time.Time { return t0 },
		Rand:    bytes.NewReader(bytes.Repeat([]byte{7}, 4096)),
		Starter: e.starter,
	}
}

// frame antepone el prefijo de longitud (orden nativo) a un cuerpo.
func frame(body []byte) []byte {
	return append(binary.NativeEndian.AppendUint32(nil, uint32(len(body))), body...)
}

const pingRequest = `{"v":1,"cmd":"ping","args":{}}`

const pingResponse = `{"ok":true,"result":{"hostVersion":"0.1.0","protocol":1,"browser":"brave","browserVersion":"155.1.97.56","features":{"temporaryContainer":true}}}`

const openRequest = `{"v":1,"cmd":"open","args":{"profileDirectory":"Profile 1","url":"https://github.com/"}}`

func errBody(code string) string {
	return `{"ok":false,"error":{"code":"` + code + `"}}`
}

// serveRaw ejecuta serve con los bytes exactos de stdin y devuelve el código de salida y lo escrito en stdout.
func (e *serveEnv) serveRaw(stdin []byte) (int, []byte) {
	e.t.Helper()
	var out bytes.Buffer
	code := serve(e.deps(bytes.NewReader(stdin), &out))
	return code, out.Bytes()
}

// serveBody enmarca body, ejecuta serve y devuelve el código de salida y el cuerpo de la respuesta (leída del marco).
func (e *serveEnv) serveBody(body string) (int, string) {
	e.t.Helper()
	code, out := e.serveRaw(frame([]byte(body)))
	return code, readResponse(e.t, out)
}

func readResponse(t *testing.T, out []byte) string {
	t.Helper()
	r := bytes.NewReader(out)
	body, err := framing.ReadMessage(r, protocol.MaxResponseBytes)
	if err != nil {
		t.Fatalf("no hay un marco de respuesta legible: %v", err)
	}
	if r.Len() != 0 {
		t.Fatalf("sobran %d bytes tras la respuesta", r.Len())
	}
	return string(body)
}

func TestServePing(t *testing.T) {
	e := newServeEnv(t, false)
	code, got := e.serveBody(pingRequest)
	if code != 0 || got != pingResponse {
		t.Fatalf("serve = %d, %s\nquiero   0, %s", code, got, pingResponse)
	}
}

func TestServeRejectsTheCallerBeforeReadingOrRunningAnything(t *testing.T) {
	for _, tc := range []struct {
		name string
		want string
		set  func(e *serveEnv)
	}{
		{"origen distinto", "unsupported_browser", func(e *serveEnv) {
			e.origin = caller.Origin(strings.Repeat("p", 32))
		}},
		{"origen vacío", "unsupported_browser", func(e *serveEnv) { e.origin = "" }},
		{"el padre es otro ejecutable", "unsupported_browser", func(e *serveEnv) {
			e.lookup = func(int) (string, error) { return "/usr/bin/otro", nil }
		}},
		{"el padre murió (ppid 1)", "unsupported_browser", func(e *serveEnv) { e.ppid = 1 }},
		{"el padre murió (ppid 0)", "unsupported_browser", func(e *serveEnv) { e.ppid = 0 }},
		{"lsof falla", "internal", func(e *serveEnv) {
			e.lookup = func(int) (string, error) { return "", errors.New("lsof: " + e.exeDir) }
		}},
		{"sin comprobación del padre", "internal", func(e *serveEnv) { e.lookup = nil }},
		{"verificación del padre no disponible", "internal", func(e *serveEnv) {
			e.lookup = func(int) (string, error) { return "", caller.ErrUnsupported }
		}},
		{"sin config.json", "internal", func(e *serveEnv) {
			if err := os.Remove(filepath.Join(e.exeDir, caller.ConfigFile)); err != nil {
				e.t.Fatal(err)
			}
		}},
		{"config.json que no es válido", "internal", func(e *serveEnv) {
			if err := os.WriteFile(filepath.Join(e.exeDir, caller.ConfigFile), []byte(`{"browser":"opera"}`), 0o600); err != nil {
				e.t.Fatal(err)
			}
		}},
		{"carpeta del binario relativa", "internal", func(e *serveEnv) { e.exeDir = "." }},
		{"carpeta del binario desconocida", "internal", func(e *serveEnv) { e.exeDir = "" }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			e := newServeEnv(t, false)
			tc.set(e)
			// stdin no se lee: el navegador escribe en la tubería sin esperar la respuesta.
			var out bytes.Buffer
			if code := serve(e.deps(forbiddenReader{t}, &out)); code != 0 {
				t.Fatalf("serve = %d, quiero 0", code)
			}
			if got := readResponse(t, out.Bytes()); got != errBody(tc.want) {
				t.Fatalf("respuesta = %s, quiero %s", got, errBody(tc.want))
			}
			// Aunque el mensaje sea un open válido, no se ejecuta nada.
			if code, got := e.serveBody(openRequest); code != 0 || got != errBody(tc.want) {
				t.Fatalf("con un open: serve = %d, %s", code, got)
			}
			if len(e.starter.calls) != 0 {
				t.Fatalf("se lanzó el navegador: %v", e.starter.calls)
			}
		})
	}
}

func TestServeFraming(t *testing.T) {
	t.Run("cabecera mayor que el máximo y sin cuerpo", func(t *testing.T) {
		e := newServeEnv(t, false)
		header := binary.NativeEndian.AppendUint32(nil, protocol.MaxRequestBytes+1)
		code, out := e.serveRaw(header)
		if got := readResponse(t, out); code != 0 || got != errBody("too_large") {
			t.Fatalf("serve = %d, %s", code, got)
		}
	})
	t.Run("justo el máximo se lee y se valida", func(t *testing.T) {
		e := newServeEnv(t, false)
		body := pingRequest + strings.Repeat(" ", protocol.MaxRequestBytes-len(pingRequest))
		if code, got := e.serveBody(body); code != 0 || got != pingResponse {
			t.Fatalf("serve = %d, %.100s", code, got)
		}
	})
	t.Run("stdin vacío: sale con 1 sin escribir", func(t *testing.T) {
		e := newServeEnv(t, false)
		if code, out := e.serveRaw(nil); code != 1 || len(out) != 0 {
			t.Fatalf("serve = %d, %d bytes escritos", code, len(out))
		}
	})
	t.Run("cabecera a medias", func(t *testing.T) {
		e := newServeEnv(t, false)
		if code, out := e.serveRaw([]byte{1, 0}); code != 1 || len(out) != 0 {
			t.Fatalf("serve = %d, %d bytes escritos", code, len(out))
		}
	})
	t.Run("cuerpo incompleto", func(t *testing.T) {
		e := newServeEnv(t, false)
		raw := frame([]byte(pingRequest))
		if code, out := e.serveRaw(raw[:len(raw)-3]); code != 1 || len(out) != 0 {
			t.Fatalf("serve = %d, %d bytes escritos", code, len(out))
		}
	})
	t.Run("no se puede escribir la respuesta", func(t *testing.T) {
		e := newServeEnv(t, false)
		if code := serve(e.deps(bytes.NewReader(frame([]byte(pingRequest))), failingWriter{})); code != 1 {
			t.Fatalf("serve = %d, quiero 1", code)
		}
	})
}

func TestServeValidationErrors(t *testing.T) {
	for _, tc := range []struct{ name, body, want string }{
		{"JSON inválido", `{`, "bad_request"},
		{"no es un objeto", `[]`, "bad_request"},
		{"versión", `{"v":2,"cmd":"ping","args":{}}`, "unsupported_version"},
		{"comando", `{"v":1,"cmd":"exec","args":{}}`, "unknown_command"},
		{"url", `{"v":1,"cmd":"open","args":{"profileDirectory":"Default","url":"javascript:x"}}`, "bad_url"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			e := newServeEnv(t, false)
			if code, got := e.serveBody(tc.body); code != 0 || got != errBody(tc.want) {
				t.Fatalf("serve = %d, %s, quiero %s", code, got, errBody(tc.want))
			}
			if len(e.starter.calls) != 0 {
				t.Fatalf("se lanzó el navegador: %v", e.starter.calls)
			}
		})
	}
}

func TestServeOpenLaunchesTheConfiguredBrowser(t *testing.T) {
	e := newServeEnv(t, false)
	if code, got := e.serveBody(openRequest); code != 0 || got != `{"ok":true,"result":{}}` {
		t.Fatalf("serve = %d, %s", code, got)
	}
	want := []startCall{{browserExe, []string{"--profile-directory=Profile 1", "--", "https://github.com/"}}}
	if len(e.starter.calls) != 1 || e.starter.calls[0].exe != want[0].exe || !slices.Equal(e.starter.calls[0].args, want[0].args) {
		t.Fatalf("llamadas = %v, quiero %v", e.starter.calls, want)
	}
}

func readHostLog(t *testing.T, e *serveEnv) string {
	t.Helper()
	b, err := os.ReadFile(filepath.Join(e.exeDir, "host.log"))
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func TestServeLogRecordsOnlyCommandAndCode(t *testing.T) {
	e := newServeEnv(t, true)
	e.serveBody(openRequest)
	e.serveBody(`{`)
	e.serveBody(`{"v":1,"cmd":"sync.get","args":{"token":"` + strings.Repeat("Z", 43) + `"}}`)
	want := "2026-10-08T12:00:00.000Z cmd=open code=ok ms=0\n" +
		"2026-10-08T12:00:00.000Z cmd=- code=bad_request ms=0\n" +
		"2026-10-08T12:00:00.000Z cmd=sync.get code=not_paired ms=0\n"
	got := readHostLog(t, e)
	if got != want {
		t.Fatalf("host.log = %q\nquiero    %q", got, want)
	}
	for _, secret := range []string{"github.com", "Profile 1", strings.Repeat("Z", 43), e.userDir} {
		if strings.Contains(got, secret) {
			t.Fatalf("host.log lleva %q", secret)
		}
	}
	fi, err := os.Stat(filepath.Join(e.exeDir, "host.log"))
	if err != nil || fi.Mode().Perm() != 0o600 {
		t.Fatalf("host.log: %v, %v", fi, err)
	}
}

func TestServeLogRecordsCallerRejections(t *testing.T) {
	e := newServeEnv(t, true)
	e.origin = caller.Origin(strings.Repeat("p", 32))
	e.serveBody(openRequest)
	if got, want := readHostLog(t, e), "2026-10-08T12:00:00.000Z cmd=- code=unsupported_browser ms=0\n"; got != want {
		t.Fatalf("host.log = %q, quiero %q", got, want)
	}
}

func TestServeNoLogWhenDisabled(t *testing.T) {
	e := newServeEnv(t, false)
	e.serveBody(openRequest)
	if _, err := os.Stat(filepath.Join(e.exeDir, "host.log")); !os.IsNotExist(err) {
		t.Fatalf("host.log no debe existir con el registro desactivado (err = %v)", err)
	}
}

func TestServeLogRotatesAboveOneMiB(t *testing.T) {
	e := newServeEnv(t, true)
	old := strings.Repeat("x", 1<<20+1)
	if err := os.WriteFile(filepath.Join(e.exeDir, "host.log"), []byte(old), 0o600); err != nil {
		t.Fatal(err)
	}
	e.serveBody(pingRequest)
	rotated, err := os.ReadFile(filepath.Join(e.exeDir, "host.log.1"))
	if err != nil || string(rotated) != old {
		t.Fatalf("host.log.1 debe ser el registro anterior (err = %v, %d bytes)", err, len(rotated))
	}
	if got, want := readHostLog(t, e), "2026-10-08T12:00:00.000Z cmd=ping code=ok ms=0\n"; got != want {
		t.Fatalf("host.log = %q, quiero %q", got, want)
	}
}
