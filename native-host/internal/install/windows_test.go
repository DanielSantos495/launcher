package install

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"strings"
	"testing"
	"unicode/utf16"

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

	// Get no ejecuta reg.exe: lee con la API del registro.
	api := newFakeRegAPI()
	api.values[`Software\Google\Chrome\NativeMessagingHosts\com.curyapps.launcher.chrome`] = regValue{typ: regSZ, data: utf16z(manifest)}
	r.Read = api.api()
	calls = nil
	got, found, err := r.Get(key)
	if err != nil || !found || got != manifest || len(calls) != 0 {
		t.Fatalf("Get = %q, %v, %v (%d llamadas a reg.exe)", got, found, err, len(calls))
	}

	// Delete consulta antes y borra con /f.
	if err := r.Delete(key); err != nil {
		t.Fatal(err)
	}
	if len(calls) != 1 || !reflect.DeepEqual(calls[0], regCall{exe, []string{"delete", key, "/f"}}) {
		t.Fatalf("Delete = %+v", calls)
	}

	// Clave inexistente: Get da found=false y Delete no borra.
	api.values = map[string]regValue{}
	calls = nil
	if _, found, err := r.Get(key); found || err != nil {
		t.Fatalf("Get de clave ausente = %v, %v", found, err)
	}
	if err := r.Delete(key); err != nil || len(calls) != 0 {
		t.Fatalf("Delete de clave ausente: %v, %d llamadas", err, len(calls))
	}
	if api.open != api.closed {
		t.Fatalf("claves abiertas %d, cerradas %d", api.open, api.closed)
	}

	// Otro código de salida es un error.
	exit = 5
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

// regValue es un valor falso del registro: su tipo y sus bytes en UTF-16.
type regValue struct {
	typ  uint32
	data []uint16
}

// fakeRegAPI es un registro falso para RegAPI: valores por subclave, errores inyectados y recuento de aperturas.
type fakeRegAPI struct {
	values       map[string]regValue
	missingValue map[string]bool // la clave existe pero sin valor por defecto
	openErr      error
	queryErr     error
	open, closed int
	handles      map[uintptr]string
	queries      []int // tamaño de buf en cada Query
}

func newFakeRegAPI() *fakeRegAPI {
	return &fakeRegAPI{values: map[string]regValue{}, missingValue: map[string]bool{}, handles: map[uintptr]string{}}
}

func (f *fakeRegAPI) api() *RegAPI {
	return &RegAPI{
		Open: func(subkey string) (uintptr, error) {
			if f.openErr != nil {
				return 0, f.openErr
			}
			if _, ok := f.values[subkey]; !ok && !f.missingValue[subkey] {
				return 0, errRegNotFound
			}
			f.open++
			h := uintptr(100 + f.open)
			f.handles[h] = subkey
			return h, nil
		},
		Query: func(h uintptr, buf []uint16) (uint32, uint32, error) {
			f.queries = append(f.queries, len(buf))
			if f.queryErr != nil {
				return 0, 0, f.queryErr
			}
			v, ok := f.values[f.handles[h]]
			if !ok {
				return 0, 0, errRegNotFound
			}
			size := uint32(2 * len(v.data))
			if len(v.data) > len(buf) {
				return v.typ, size, errRegMoreData
			}
			copy(buf, v.data)
			return v.typ, size, nil
		},
		Close: func(h uintptr) error {
			if _, ok := f.handles[h]; !ok {
				return errors.New("handle desconocido")
			}
			f.closed++
			return nil
		},
	}
}

// utf16z es s en UTF-16 con el NUL final, como lo guarda el registro.
func utf16z(s string) []uint16 { return append(utf16.Encode([]rune(s)), 0) }

func TestRegExeGet(t *testing.T) {
	const key = `HKCU\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\com.curyapps.launcher.brave`
	const sub = `Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\com.curyapps.launcher.brave`
	const jose = `C:\Users\José\AppData\Local\AccountLauncher\brave\com.curyapps.launcher.brave.json`
	long := `C:\` + strings.Repeat("ñ", 400) + `\m.json` // no cabe en el primer búfer (260)
	boom := errors.New("acceso denegado")
	for name, tc := range map[string]struct {
		setup     func(*fakeRegAPI)
		want      string
		found     bool
		err       error // nil = sin error
		queries   []int
		noQueries bool
	}{
		"ruta con José": {setup: func(f *fakeRegAPI) { f.values[sub] = regValue{regSZ, utf16z(jose)} }, want: jose, found: true,
			queries: []int{260}},
		"sin NUL final": {setup: func(f *fakeRegAPI) { f.values[sub] = regValue{regSZ, utf16.Encode([]rune(jose))} }, want: jose,
			found: true, queries: []int{260}},
		"valor largo, segundo intento": {setup: func(f *fakeRegAPI) { f.values[sub] = regValue{regSZ, utf16z(long)} },
			want: long, found: true, queries: []int{260, len(utf16z(long))}},
		"exactamente 260 unidades": {setup: func(f *fakeRegAPI) {
			f.values[sub] = regValue{regSZ, utf16z(`C:\` + strings.Repeat("a", 256))}
		}, want: `C:\` + strings.Repeat("a", 256), found: true, queries: []int{260}},
		"261 unidades": {setup: func(f *fakeRegAPI) {
			f.values[sub] = regValue{regSZ, utf16z(`C:\` + strings.Repeat("a", 257))}
		}, want: `C:\` + strings.Repeat("a", 257), found: true, queries: []int{260, 261}},
		"clave ausente": {setup: func(*fakeRegAPI) {}, noQueries: true},
		"valor ausente": {setup: func(f *fakeRegAPI) { f.missingValue[sub] = true }, queries: []int{260}},
		"valor vacío":   {setup: func(f *fakeRegAPI) { f.values[sub] = regValue{regSZ, []uint16{0}} }, queries: []int{260}},
		"otro tipo":     {setup: func(f *fakeRegAPI) { f.values[sub] = regValue{2, utf16z(jose)} }, err: errRegBadValue, queries: []int{260}},
		"NUL en medio":  {setup: func(f *fakeRegAPI) { f.values[sub] = regValue{regSZ, utf16z("C:\\a\x00b.json")} }, err: errRegBadValue, queries: []int{260}},
		"sustituto suelto": {setup: func(f *fakeRegAPI) { f.values[sub] = regValue{regSZ, []uint16{'C', ':', '\\', 0xD800, 0}} },
			err: errRegBadValue, queries: []int{260}},
		"tamaño impar": {setup: func(f *fakeRegAPI) { f.values[sub] = regValue{regSZ, utf16z(jose)} }, err: errRegBadValue},
		"demasiado largo": {setup: func(f *fakeRegAPI) {
			f.values[sub] = regValue{regSZ, make([]uint16, maxRegValueChars+1)}
		}, err: errRegBadValue, queries: []int{260}},
		"error al abrir":     {setup: func(f *fakeRegAPI) { f.openErr = boom }, err: boom, noQueries: true},
		"error al consultar": {setup: func(f *fakeRegAPI) { f.values[sub] = regValue{regSZ, utf16z(jose)}; f.queryErr = boom }, err: boom, queries: []int{260}},
	} {
		t.Run(name, func(t *testing.T) {
			f := newFakeRegAPI()
			tc.setup(f)
			api := f.api()
			if name == "tamaño impar" {
				query := api.Query
				api.Query = func(h uintptr, buf []uint16) (uint32, uint32, error) {
					typ, size, err := query(h, buf)
					return typ, size - 1, err
				}
				tc.queries = []int{260}
			}
			got, found, err := RegExe{Read: api}.Get(key)
			if tc.err == nil && err != nil || tc.err != nil && !errors.Is(err, tc.err) {
				t.Fatalf("Get = %v, quiero %v", err, tc.err)
			}
			if got != tc.want || found != tc.found {
				t.Fatalf("Get = %q, %v; quiero %q, %v", got, found, tc.want, tc.found)
			}
			if tc.noQueries {
				tc.queries = nil
			}
			if !slices.Equal(f.queries, tc.queries) {
				t.Fatalf("Query con búferes %v, quiero %v", f.queries, tc.queries)
			}
			if f.open != f.closed {
				t.Fatalf("claves abiertas %d, cerradas %d", f.open, f.closed)
			}
		})
	}
	if _, _, err := (RegExe{}).Get(key); err == nil {
		t.Fatal("Get sin RegAPI no falla")
	}
}

func TestCopyBinaryWindows(t *testing.T) {
	old := goos
	goos = "windows"
	t.Cleanup(func() { goos = old })
	dir := t.TempDir()
	dst := filepath.Join(dir, "launcher-host.exe")

	// Sin binario anterior.
	if err := copyBinary(dst, []byte("v1")); err != nil {
		t.Fatal(err)
	}
	// Con binario anterior y un .old de otra instalación: el anterior se renombra y los dos .old se borran.
	if err := os.WriteFile(dst+".old", []byte("v0"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := copyBinary(dst, []byte("v2")); err != nil {
		t.Fatal(err)
	}
	if got := readFile(t, dst); string(got) != "v2" {
		t.Fatalf("binario = %q, quiero v2", got)
	}
	if _, err := os.Lstat(dst + ".old"); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf(".old sigue ahí: %v", err)
	}

	// Un anterior que no se puede borrar (aquí, una carpeta con contenido; en Windows, un .exe en uso) se renombra y la
	// instalación sigue: el .old se queda.
	if err := os.Remove(dst); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(dst, "x"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := copyBinary(dst, []byte("v3")); err != nil {
		t.Fatalf("copyBinary con el anterior sin poder borrarse = %v", err)
	}
	if got := readFile(t, dst); string(got) != "v3" {
		t.Fatalf("binario = %q, quiero v3", got)
	}
	if fi, err := os.Stat(dst + ".old"); err != nil || !fi.IsDir() {
		t.Fatalf("el anterior no quedó en .old: %v", err)
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
