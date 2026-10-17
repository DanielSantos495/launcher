package install

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/DanielSantos495/launcher/native-host/internal/caller"
)

// fakeRegistry guarda las claves en memoria y apunta las llamadas.
type fakeRegistry struct {
	keys    map[string]string
	calls   []string
	failSet string // clave cuyo Set falla
	failGet string // clave cuyo Get falla
	failDel string // clave cuyo Delete falla
}

func newFakeRegistry() *fakeRegistry { return &fakeRegistry{keys: map[string]string{}} }

func (r *fakeRegistry) Set(key, value string) error {
	r.calls = append(r.calls, "set "+key)
	if key == r.failSet {
		return errors.New("falla")
	}
	r.keys[key] = value
	return nil
}

func (r *fakeRegistry) Get(key string) (string, bool, error) {
	r.calls = append(r.calls, "get "+key)
	if key == r.failGet {
		return "", false, errors.New("falla")
	}
	v, ok := r.keys[key]
	return v, ok, nil
}

func (r *fakeRegistry) Delete(key string) error {
	r.calls = append(r.calls, "delete "+key)
	if key == r.failDel {
		return errors.New("falla")
	}
	delete(r.keys, key)
	return nil
}

// windowsFixture simula Windows en el sistema de pruebas: goos "windows", rutas de windowsBrowsers sobre carpetas
// temporales y un registro falso.
func windowsFixture(t *testing.T, present ...string) (*fixture, *fakeRegistry) {
	t.Helper()
	f := newFixture(t, present...)
	reg := newFakeRegistry()
	oldGOOS, oldBrowsers := goos, browsers
	goos = "windows"
	browsers = func(home string) []Browser {
		list := windowsBrowsers(winEnv{LocalAppData: home}, regularFile)
		for i := range list {
			list[i].Exe = f.exes[list[i].Name]
		}
		return list
	}
	t.Cleanup(func() { goos, browsers = oldGOOS, oldBrowsers })
	return f, reg
}

func winOpts(f *fixture, reg Registry, names ...string) Options {
	o := f.opts(names...)
	o.Registry = reg
	return o
}

const (
	braveKey  = `HKCU\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\com.curyapps.launcher.brave`
	chromeKey = `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.curyapps.launcher.brave`
)

func TestWindowsBrowsersPaths(t *testing.T) {
	env := winEnv{LocalAppData: "/L", ProgramFiles: "/P", ProgramFilesX86: "/X"}
	j := filepath.Join
	got := windowsBrowsers(env, func(string) bool { return false })
	want := []Browser{
		{
			Name: "brave", Exe: j("/P", "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
			UserDataDir: j("/L", "BraveSoftware", "Brave-Browser", "User Data"), ManifestDir: j("/L", "AccountLauncher", "brave"),
			RegistryKeys: []string{braveKey, chromeKey},
		},
		{
			Name: "chrome", Exe: j("/P", "Google", "Chrome", "Application", "chrome.exe"),
			UserDataDir: j("/L", "Google", "Chrome", "User Data"), ManifestDir: j("/L", "AccountLauncher", "chrome"),
			RegistryKeys: []string{`HKCU\Software\Google\Chrome\NativeMessagingHosts\com.curyapps.launcher.chrome`},
		},
		{
			Name: "edge", Exe: j("/X", "Microsoft", "Edge", "Application", "msedge.exe"),
			UserDataDir: j("/L", "Microsoft", "Edge", "User Data"), ManifestDir: j("/L", "AccountLauncher", "edge"),
			RegistryKeys: []string{`HKCU\Software\Microsoft\Edge\NativeMessagingHosts\com.curyapps.launcher.edge`},
		},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("windowsBrowsers =\n%+v\nquiero\n%+v", got, want)
	}
	// Con el ejecutable por usuario presente, gana sobre la ruta de Program Files.
	perUser := j("/L", "BraveSoftware", "Brave-Browser", "Application", "brave.exe")
	got = windowsBrowsers(env, func(p string) bool { return p == perUser })
	if got[0].Exe != perUser {
		t.Fatalf("brave exe = %q, quiero %q", got[0].Exe, perUser)
	}
	// Sin ProgramFiles, la primera candidata es la de LOCALAPPDATA.
	got = windowsBrowsers(winEnv{LocalAppData: "/L"}, func(string) bool { return false })
	if got[0].Exe != perUser {
		t.Fatalf("brave exe sin ProgramFiles = %q, quiero %q", got[0].Exe, perUser)
	}
}

func TestAppDirWindows(t *testing.T) {
	if got, want := windowsAppDir("/L", "edge"), filepath.Join("/L", "AccountLauncher", "edge"); got != want {
		t.Fatalf("windowsAppDir = %q, quiero %q", got, want)
	}
}

type regCall struct {
	exe  string
	args []string
}

func TestRegExeArguments(t *testing.T) {
	const exe = `C:\Windows\System32\reg.exe`
	const key = `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.curyapps.launcher.chrome`
	const manifest = `C:\Users\Ana Pérez\AppData\Local\AccountLauncher\chrome\com.curyapps.launcher.chrome.json`
	var calls []regCall
	exit := 0
	out := []byte(nil)
	r := RegExe{Path: exe, Run: func(e string, a []string) ([]byte, int, error) {
		calls = append(calls, regCall{e, append([]string(nil), a...)})
		return out, exit, nil
	}}

	if err := r.Set(key, manifest); err != nil {
		t.Fatal(err)
	}
	wantSet := regCall{exe, []string{"add", key, "/ve", "/t", "REG_SZ", "/d", manifest, "/f"}}
	if !reflect.DeepEqual(calls[0], wantSet) {
		t.Fatalf("Set = %+v, quiero %+v", calls[0], wantSet)
	}

	out = []byte("\r\nHKEY_CURRENT_USER\\Software\\Google\\Chrome\\NativeMessagingHosts\\x\r\n    (Default)    REG_SZ    " + manifest + "\r\n\r\n")
	calls = nil
	got, found, err := r.Get(key)
	if err != nil || !found || got != manifest {
		t.Fatalf("Get = %q, %v, %v", got, found, err)
	}
	if want := (regCall{exe, []string{"query", key, "/ve"}}); !reflect.DeepEqual(calls[0], want) {
		t.Fatalf("Get = %+v, quiero %+v", calls[0], want)
	}

	// Delete consulta antes y borra con /f.
	calls = nil
	if err := r.Delete(key); err != nil {
		t.Fatal(err)
	}
	if len(calls) != 2 || !reflect.DeepEqual(calls[1], regCall{exe, []string{"delete", key, "/f"}}) {
		t.Fatalf("Delete = %+v", calls)
	}

	// Clave inexistente: Get da found=false y Delete no borra.
	exit = 1
	calls = nil
	if _, found, err := r.Get(key); found || err != nil {
		t.Fatalf("Get de clave ausente = %v, %v", found, err)
	}
	if err := r.Delete(key); err != nil || len(calls) != 2 {
		t.Fatalf("Delete de clave ausente: %v, %d llamadas", err, len(calls))
	}

	// Otro código de salida es un error.
	exit = 5
	if _, _, err := r.Get(key); err == nil {
		t.Fatal("Get con código 5 sin error")
	}
	if err := r.Set(key, manifest); err == nil {
		t.Fatal("Set con código 5 sin error")
	}
}

func TestRegExeRejectsBadArguments(t *testing.T) {
	const exe = `C:\Windows\System32\reg.exe`
	const key = `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.curyapps.launcher.chrome`
	const value = `C:\a\b.json`
	ran := 0
	run := func(string, []string) ([]byte, int, error) { ran++; return nil, 0, nil }
	r := RegExe{Path: exe, Run: run}

	for _, k := range []string{
		"", `-HKCU\Software\x`, `/HKCU\Software\x`, `HKLM\Software\x`, `HKCU\Software`, `HKCU\Software\`, `HKCU\Software\a b`,
		`HKCU\Software\a"b`, `HKCU\Software\..\x`, `HKCU\Software\-x`, "HKCU\\Software\\a\nb", `HKCU\Software\a\\b`,
	} {
		if r.Set(k, value) == nil || r.Delete(k) == nil {
			t.Errorf("clave %q aceptada", k)
		}
		if _, _, err := r.Get(k); err == nil {
			t.Errorf("Get acepta la clave %q", k)
		}
	}
	for _, v := range []string{
		"", "-f", "/f", `/d`, "relativa.json", `C:relativa`, `C:\a"b`, "C:\\a\nb", "C:\\a\x00b", `\x`, "\xff",
	} {
		if r.Set(key, v) == nil {
			t.Errorf("valor %q aceptado", v)
		}
	}
	for _, p := range []string{"", "reg.exe", `C:\Windows\System32\cmd.exe`, `/usr/bin/reg.exe`, `-x\reg.exe`} {
		if (RegExe{Path: p, Run: run}).Set(key, value) == nil {
			t.Errorf("ruta de reg.exe %q aceptada", p)
		}
	}
	if ran != 0 {
		t.Fatalf("se ejecutó reg.exe %d veces con argumentos no válidos", ran)
	}
	if err := r.Set(key, `\\servidor\recurso\m.json`); err != nil {
		t.Fatalf("una ruta UNC válida se rechazó: %v", err)
	}
}

func TestParseRegQuery(t *testing.T) {
	for name, tc := range map[string]struct {
		out  string
		want string
		ok   bool
	}{
		"inglés":    {"\r\nHKEY_CURRENT_USER\\Software\\X\r\n    (Default)    REG_SZ    C:\\a b\\m.json\r\n\r\n", `C:\a b\m.json`, true},
		"español":   {"HKEY_CURRENT_USER\\Software\\X\n    (Predeterminado)    REG_SZ    C:\\m.json\n", `C:\m.json`, true},
		"sin valor": {"HKEY_CURRENT_USER\\Software\\X\r\n    (Default)    REG_SZ    (value not set)\r\n", `(value not set)`, true},
		"vacía":     {"", "", false},
		"otro tipo": {"HKEY_CURRENT_USER\\Software\\X\r\n    (Default)    REG_DWORD    0x1\r\n", "", false},
	} {
		got, ok := parseRegQuery([]byte(tc.out))
		if got != tc.want || ok != tc.ok {
			t.Errorf("%s: parseRegQuery = %q, %v; quiero %q, %v", name, got, ok, tc.want, tc.ok)
		}
	}
}

func TestInstallWindows(t *testing.T) {
	f, reg := windowsFixture(t, "brave")
	if err := Install(winOpts(f, reg)); err != nil {
		t.Fatal(err)
	}
	app := f.app("brave")
	if want := filepath.Join(f.home, "AccountLauncher", "brave"); app != want {
		t.Fatalf("AppDir = %q, quiero %q", app, want)
	}
	bin := filepath.Join(app, "launcher-host.exe")
	if got := readFile(t, bin); !bytes.Equal(got, f.srcBytes) {
		t.Fatal("el binario instalado no tiene los bytes de la fuente")
	}
	if exists(filepath.Join(app, "launcher-host")) {
		t.Fatal("se instaló un binario sin .exe")
	}
	manifest := filepath.Join(app, "com.curyapps.launcher.brave.json")
	if got := f.manifestPath("brave"); got != manifest {
		t.Fatalf("manifest en %q, quiero %q", got, manifest)
	}
	wantManifest, err := Manifest("brave", bin, testID)
	if err != nil {
		t.Fatal(err)
	}
	if got := readFile(t, manifest); !bytes.Equal(got, wantManifest) {
		t.Fatalf("manifest = %s", got)
	}
	cfg, err := caller.LoadConfig(app)
	if err != nil || cfg.Browser != "brave" || cfg.Exe != f.exes["brave"] || cfg.BinarySHA256 != f.srcHash() {
		t.Fatalf("config.json = %+v, %v", cfg, err)
	}
	wantKeys := map[string]string{braveKey: manifest, chromeKey: manifest}
	if !reflect.DeepEqual(reg.keys, wantKeys) {
		t.Fatalf("registro = %v, quiero %v", reg.keys, wantKeys)
	}
	if !strings.Contains(f.out.String(), braveKey) {
		t.Fatalf("la salida no menciona la clave de registro: %q", f.out.String())
	}
	// Reinstalar da lo mismo.
	if err := Install(winOpts(f, reg)); err != nil || !reflect.DeepEqual(reg.keys, wantKeys) {
		t.Fatalf("reinstalar: %v, %v", err, reg.keys)
	}
}

func TestInstallWindowsRegistryFailure(t *testing.T) {
	f, reg := windowsFixture(t, "brave")
	reg.failSet = chromeKey
	err := Install(winOpts(f, reg))
	if err == nil || !strings.Contains(err.Error(), chromeKey) {
		t.Fatalf("Install = %v, quiero un error con la clave", err)
	}
}

func TestInstallWindowsWithoutSystemRegistry(t *testing.T) {
	// Sin registro inyectado y fuera de Windows no hay reg.exe: Install falla sin escribir nada.
	f, _ := windowsFixture(t, "brave")
	if err := Install(f.opts()); err == nil {
		t.Fatal("Install sin registro no falló")
	}
	if exists(f.app("brave")) {
		t.Fatal("se escribió algo sin registro")
	}
}

func TestUninstallWindows(t *testing.T) {
	f, reg := windowsFixture(t, "brave")
	if err := Install(winOpts(f, reg)); err != nil {
		t.Fatal(err)
	}
	reg.calls = nil
	if err := Uninstall(winOpts(f, reg), false); err != nil {
		t.Fatal(err)
	}
	if len(reg.keys) != 0 {
		t.Fatalf("quedan claves: %v", reg.keys)
	}
	wantCalls := []string{"delete " + braveKey, "delete " + chromeKey}
	if !reflect.DeepEqual(reg.calls, wantCalls) {
		t.Fatalf("llamadas = %v, quiero %v", reg.calls, wantCalls)
	}
	app := f.app("brave")
	for _, p := range []string{"launcher-host.exe", "config.json", "com.curyapps.launcher.brave.json"} {
		if exists(filepath.Join(app, p)) {
			t.Fatalf("queda %s", p)
		}
	}
}

func TestUninstallWindowsReportsRegistryError(t *testing.T) {
	f, reg := windowsFixture(t, "brave")
	if err := Install(winOpts(f, reg)); err != nil {
		t.Fatal(err)
	}
	reg.failDel = braveKey
	err := Uninstall(winOpts(f, reg), true)
	if err == nil || !strings.Contains(err.Error(), braveKey) {
		t.Fatalf("Uninstall = %v", err)
	}
	// Aun con el fallo, quita lo demás.
	if _, ok := reg.keys[chromeKey]; ok || exists(f.app("brave")) {
		t.Fatal("no quitó el resto tras el fallo del registro")
	}
}

// windowsDoctor instala Brave en el Windows simulado y devuelve la salida de Doctor.
func windowsDoctor(t *testing.T, f *fixture, reg Registry) (string, bool) {
	t.Helper()
	f.out.Reset()
	ok := Doctor(winOpts(f, reg, "brave"), false)
	return f.out.String(), ok
}

func TestDoctorWindows(t *testing.T) {
	f, reg := windowsFixture(t, "brave")
	o := winOpts(f, reg, "brave")
	o.UserDataDir = t.TempDir()
	copyTree(t, filepath.Join("..", "..", "testdata", "macos"), o.UserDataDir)
	if err := Install(o); err != nil {
		t.Fatal(err)
	}
	// Los permisos de Unix no cuentan en Windows.
	if err := os.Chmod(filepath.Join(f.app("brave"), "config.json"), 0o666); err != nil {
		t.Fatal(err)
	}

	out, ok := windowsDoctor(t, f, reg)
	if !ok || strings.Contains(out, "FALLO") {
		t.Fatalf("Doctor sano:\n%s", out)
	}
	for _, key := range []string{braveKey, chromeKey} {
		if !strings.Contains(out, "OK     brave: clave de registro "+key+" correcta") {
			t.Fatalf("falta el OK de %s:\n%s", key, out)
		}
	}

	// La clave apunta a otro manifest.
	reg.keys[braveKey] = `C:\otro\m.json`
	out, ok = windowsDoctor(t, f, reg)
	if ok || !strings.Contains(out, "FALLO  brave: la clave de registro "+braveKey+" apunta a otro manifest") {
		t.Fatalf("clave desviada:\n%s", out)
	}

	// La clave falta.
	delete(reg.keys, braveKey)
	out, ok = windowsDoctor(t, f, reg)
	if ok || !strings.Contains(out, "FALLO  brave: falta la clave de registro "+braveKey) {
		t.Fatalf("clave ausente:\n%s", out)
	}

	// El registro falla.
	reg.keys[braveKey] = f.manifestPath("brave")
	reg.failGet = chromeKey
	out, ok = windowsDoctor(t, f, reg)
	if ok || !strings.Contains(out, "FALLO  brave: no se pudo leer la clave de registro "+chromeKey) {
		t.Fatalf("registro con error:\n%s", out)
	}
}
