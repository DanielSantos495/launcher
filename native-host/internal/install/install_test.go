package install

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/DanielSantos495/launcher/native-host/internal/caller"
)

func TestInstallOnlyTheDetectedBrowser(t *testing.T) {
	f := newFixture(t, "brave")
	f.mustInstall()

	app := f.app("brave")
	if got := perm(t, app); got != 0o700 {
		t.Fatalf("carpeta de instalación = %v, quiero 0700", got)
	}
	bin := filepath.Join(app, "launcher-host")
	if got := perm(t, bin); got != 0o700 {
		t.Fatalf("launcher-host = %v, quiero 0700", got)
	}
	if got := readFile(t, bin); string(got) != string(f.srcBytes) {
		t.Fatalf("el binario instalado no tiene los bytes de la fuente")
	}
	cfgPath := filepath.Join(app, "config.json")
	if got := perm(t, cfgPath); got != 0o600 {
		t.Fatalf("config.json = %v, quiero 0600", got)
	}
	cfg, err := caller.ParseConfig(readFile(t, cfgPath))
	if err != nil {
		t.Fatalf("config.json no lo acepta ParseConfig: %v", err)
	}
	want := caller.Config{
		Browser: "brave", Exe: f.exes["brave"], UserDataDir: f.userDataDir("brave"), ExtensionID: testID,
		BinarySHA256: f.srcHash(),
	}
	if cfg != want {
		t.Fatalf("config.json = %+v\nquiero        %+v", cfg, want)
	}
	manifest, err := Manifest("brave", bin, testID)
	if err != nil {
		t.Fatal(err)
	}
	if got := readFile(t, f.manifestPath("brave")); string(got) != string(manifest) {
		t.Fatalf("manifest = %s\nquiero    %s", got, manifest)
	}
	// Chrome y Edge no están: no se instalan.
	for _, name := range []string{"chrome", "edge"} {
		if exists(f.app(name)) || exists(f.manifestPath(name)) {
			t.Fatalf("se instaló %s sin su ejecutable", name)
		}
	}
	if !strings.Contains(f.out.String(), "brave") {
		t.Fatalf("la salida no menciona el navegador: %q", f.out.String())
	}
}

func TestInstallSeveralDetectedBrowsers(t *testing.T) {
	f := newFixture(t, "brave", "chrome")
	f.mustInstall()
	for _, name := range []string{"brave", "chrome"} {
		if !exists(filepath.Join(f.app(name), "launcher-host")) || !exists(f.manifestPath(name)) {
			t.Fatalf("falta la instalación de %s", name)
		}
	}
	// Brave y Chrome comparten la carpeta de manifests, con un nombre de host cada uno.
	if filepath.Dir(f.manifestPath("brave")) != filepath.Dir(f.manifestPath("chrome")) {
		t.Fatal("brave y chrome deben compartir la carpeta de manifests")
	}
	if exists(f.app("edge")) {
		t.Fatal("se instaló edge sin su ejecutable")
	}
}

func TestInstallNothingDetected(t *testing.T) {
	f := newFixture(t)
	if err := Install(f.opts()); err == nil {
		t.Fatal("sin ningún navegador, Install debe fallar")
	}
	assertEmpty(t, f.home)
}

func TestInstallExplicitBrowserWithoutExecutable(t *testing.T) {
	f := newFixture(t, "brave")
	for _, names := range [][]string{{"chrome"}, {"brave", "chrome"}} {
		if err := Install(f.opts(names...)); err == nil {
			t.Fatalf("Install(%v) sin el ejecutable de chrome debe fallar", names)
		}
		// Nada escrito: ni siquiera para el navegador que sí está.
		assertEmpty(t, f.home)
	}
}

func TestInstallRejectsInvalidExtensionIDBeforeWriting(t *testing.T) {
	for _, id := range []string{"", testID[:31], testID + "a", strings.ToUpper(testID), strings.Repeat("q", 32)} {
		f := newFixture(t, "brave")
		o := f.opts()
		o.ExtensionID = id
		err := Install(o)
		if err == nil || !errors.Is(err, ErrUsage) {
			t.Fatalf("Install con id %q: %v; quiero un error de uso", id, err)
		}
		assertEmpty(t, f.home)
	}
}

func TestInstallRejectsUnknownBrowser(t *testing.T) {
	f := newFixture(t, "brave")
	if err := Install(f.opts("opera")); !errors.Is(err, ErrUsage) {
		t.Fatalf("Install(opera) = %v; quiero un error de uso", err)
	}
	assertEmpty(t, f.home)
}

func TestInstallMissingSource(t *testing.T) {
	f := newFixture(t, "brave")
	o := f.opts()
	o.Source = filepath.Join(t.TempDir(), "no-existe")
	if err := Install(o); err == nil {
		t.Fatal("sin binario que copiar, Install debe fallar")
	}
	assertEmpty(t, f.home)
}

func TestInstallIsIdempotentAndReplacesTheBinaryFile(t *testing.T) {
	f := newFixture(t, "brave")
	f.mustInstall()
	app := f.app("brave")
	bin := filepath.Join(app, "launcher-host")
	cfgPath := filepath.Join(app, "config.json")
	manifestPath := f.manifestPath("brave")

	// Un shared.json existente (y el resto de la carpeta) sobrevive a la reinstalación.
	shared := []byte(`{"format":1}`)
	if err := os.WriteFile(filepath.Join(app, "shared.json"), shared, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(app, "icons"), 0o700); err != nil {
		t.Fatal(err)
	}
	before := map[string][]byte{bin: readFile(t, bin), cfgPath: readFile(t, cfgPath), manifestPath: readFile(t, manifestPath)}

	// Con el archivo anterior abierto su inodo no se puede reutilizar: si el binario nuevo es otro archivo, SameFile
	// da false aunque el sistema de archivos reasigne inodos.
	old, err := os.Open(bin)
	if err != nil {
		t.Fatal(err)
	}
	defer old.Close()
	oldInfo, err := old.Stat()
	if err != nil {
		t.Fatal(err)
	}

	f.mustInstall()

	for path, want := range before {
		if got := readFile(t, path); string(got) != string(want) {
			t.Fatalf("%s cambió al reinstalar", path)
		}
	}
	newInfo, err := os.Stat(bin)
	if err != nil {
		t.Fatal(err)
	}
	if os.SameFile(oldInfo, newInfo) {
		t.Fatal("el binario se sobrescribió en su inodo: debe borrarse antes de copiar (macOS mata el binario firmado)")
	}
	if got := readFile(t, filepath.Join(app, "shared.json")); string(got) != string(shared) {
		t.Fatalf("shared.json cambió: %s", got)
	}
	if !exists(filepath.Join(app, "icons")) {
		t.Fatal("icons/ desapareció")
	}
	if got := perm(t, bin); got != 0o700 {
		t.Fatalf("launcher-host = %v, quiero 0700", got)
	}
}

// Una carpeta de instalación que ya existía con permisos más abiertos queda en 0700 (MkdirAll no cambia una existente).
func TestInstallTightensAnExistingAppDir(t *testing.T) {
	f := newFixture(t, "brave")
	app := f.app("brave")
	if err := os.MkdirAll(app, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(app, 0o755); err != nil {
		t.Fatal(err)
	}
	f.mustInstall()
	if got := perm(t, app); got != 0o700 {
		t.Fatalf("la carpeta de instalación = %v, quiero 0700", got)
	}
}

func TestInstallReplacesAChangedBinary(t *testing.T) {
	f := newFixture(t, "brave")
	f.mustInstall()
	bin := filepath.Join(f.app("brave"), "launcher-host")
	if err := os.WriteFile(bin, []byte("manipulado"), 0o700); err != nil {
		t.Fatal(err)
	}
	f.mustInstall()
	if got := readFile(t, bin); string(got) != string(f.srcBytes) {
		t.Fatal("la reinstalación no restauró el binario")
	}
}

func TestInstallFromTheInstalledBinary(t *testing.T) {
	// install se puede ejecutar desde la copia ya instalada: se lee entera antes de borrarla.
	f := newFixture(t, "brave")
	f.mustInstall()
	bin := filepath.Join(f.app("brave"), "launcher-host")
	o := f.opts()
	o.Source = bin
	if err := Install(o); err != nil {
		t.Fatal(err)
	}
	if got := readFile(t, bin); string(got) != string(f.srcBytes) {
		t.Fatal("el binario se perdió al instalar desde sí mismo")
	}
}

func TestInstallKeepsTheLogSetting(t *testing.T) {
	f := newFixture(t, "brave")
	f.mustInstall()
	cfgPath := filepath.Join(f.app("brave"), "config.json")
	cfg, err := caller.ParseConfig(readFile(t, cfgPath))
	if err != nil {
		t.Fatal(err)
	}
	cfg.Log = true
	b, err := cfg.Encode()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(cfgPath, b, 0o600); err != nil {
		t.Fatal(err)
	}
	f.mustInstall()
	if got := readFile(t, cfgPath); string(got) != string(b) {
		t.Fatalf("la reinstalación perdió \"log\": true: %s", got)
	}
}

func TestInstallOverridesExeAndUserDataDir(t *testing.T) {
	f := newFixture(t, "brave")
	customExe := filepath.Join(t.TempDir(), "mi-brave")
	if err := os.WriteFile(customExe, []byte("exe"), 0o755); err != nil {
		t.Fatal(err)
	}
	customData := t.TempDir()
	o := f.opts("chrome") // chrome no tiene su ejecutable por defecto: lo pone --exe
	o.Exe, o.UserDataDir = customExe, customData
	if err := Install(o); err != nil {
		t.Fatal(err)
	}
	cfg, err := caller.LoadConfig(f.app("chrome"))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Browser != "chrome" || cfg.Exe != customExe || cfg.UserDataDir != customData {
		t.Fatalf("config.json = %+v", cfg)
	}
}

func TestInstallOverridesNeedExactlyOneBrowser(t *testing.T) {
	f := newFixture(t, "brave", "chrome")
	customExe := filepath.Join(t.TempDir(), "mi-brave")
	if err := os.WriteFile(customExe, []byte("exe"), 0o755); err != nil {
		t.Fatal(err)
	}
	for _, names := range [][]string{nil, {"brave", "chrome"}} {
		for _, set := range []func(o *Options){
			func(o *Options) { o.Exe = customExe },
			func(o *Options) { o.UserDataDir = t.TempDir() },
		} {
			o := f.opts(names...)
			set(&o)
			if err := Install(o); !errors.Is(err, ErrUsage) {
				t.Fatalf("Install(%v) con --exe o --user-data-dir = %v; quiero un error de uso", names, err)
			}
		}
	}
	assertEmpty(t, f.home)
}

func TestInstallOverrideExeMustExistAndBeAbsolute(t *testing.T) {
	f := newFixture(t, "brave")
	for _, exe := range []string{filepath.Join(t.TempDir(), "no-existe"), "relativo/brave"} {
		o := f.opts("brave")
		o.Exe = exe
		if err := Install(o); err == nil {
			t.Fatalf("Install con --exe %q debe fallar", exe)
		}
	}
	o := f.opts("brave")
	o.UserDataDir = "relativo"
	if err := Install(o); err == nil {
		t.Fatal("Install con --user-data-dir relativo debe fallar")
	}
	assertEmpty(t, f.home)
}

func TestNotDarwinIsRefused(t *testing.T) {
	f := newFixture(t, "brave")
	goos = "linux" // newFixture restaura el valor original al terminar
	if err := Install(f.opts()); err == nil || !strings.Contains(err.Error(), "solo macOS y Windows") {
		t.Fatalf("Install en linux = %v; quiero «solo macOS y Windows»", err)
	}
	if err := Uninstall(f.opts(), false); err == nil || !strings.Contains(err.Error(), "solo macOS y Windows") {
		t.Fatalf("Uninstall en linux = %v", err)
	}
	if err := Pairing(f.opts("brave"), true, 0); err == nil || !strings.Contains(err.Error(), "solo macOS y Windows") {
		t.Fatalf("Pairing en linux = %v", err)
	}
	if Doctor(f.opts("brave"), false) {
		t.Fatal("Doctor en linux debe fallar")
	}
	assertEmpty(t, f.home)
}

func TestUninstall(t *testing.T) {
	f := newFixture(t, "brave", "chrome")
	f.mustInstall()
	app := f.app("brave")
	// Lo que guarda el usuario (y el bloqueo y el registro) sobrevive a un uninstall normal.
	for name, content := range map[string]string{"shared.json": "{}", "shared.lock": "", "host.log": "x"} {
		if err := os.WriteFile(filepath.Join(app, name), []byte(content), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.MkdirAll(filepath.Join(app, "icons"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(app, "icons", "61.json"), []byte("{}"), 0o600); err != nil {
		t.Fatal(err)
	}

	if err := Uninstall(f.opts("brave"), false); err != nil {
		t.Fatal(err)
	}
	for _, gone := range []string{f.manifestPath("brave"), filepath.Join(app, "launcher-host"), filepath.Join(app, "config.json")} {
		if exists(gone) {
			t.Fatalf("%s sigue existiendo", gone)
		}
	}
	for _, kept := range []string{"shared.json", "shared.lock", "host.log", filepath.Join("icons", "61.json")} {
		if !exists(filepath.Join(app, kept)) {
			t.Fatalf("uninstall borró %s", kept)
		}
	}
	// Chrome no se tocó.
	if !exists(filepath.Join(f.app("chrome"), "launcher-host")) || !exists(f.manifestPath("chrome")) {
		t.Fatal("uninstall --browser brave tocó chrome")
	}

	// --purge borra la carpeta entera; sin --browser, la de todos los navegadores que tengan algo.
	if err := Uninstall(f.opts(), true); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"brave", "chrome"} {
		if exists(f.app(name)) || exists(f.manifestPath(name)) {
			t.Fatalf("--purge dejó restos de %s", name)
		}
	}
}

func TestUninstallWithNothingInstalled(t *testing.T) {
	f := newFixture(t, "brave")
	for _, names := range [][]string{nil, {"brave"}} {
		for _, purge := range []bool{false, true} {
			if err := Uninstall(f.opts(names...), purge); err != nil {
				t.Fatalf("Uninstall(%v, %v) sin nada instalado: %v", names, purge, err)
			}
		}
	}
	assertEmpty(t, f.home)
}

func TestUninstallRejectsUnknownBrowser(t *testing.T) {
	f := newFixture(t)
	if err := Uninstall(f.opts("opera"), true); !errors.Is(err, ErrUsage) {
		t.Fatalf("Uninstall(opera) = %v; quiero un error de uso", err)
	}
}
