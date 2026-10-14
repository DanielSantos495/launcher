package install

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/DanielSantos495/launcher/native-host/internal/protocol"
	"github.com/DanielSantos495/launcher/native-host/internal/store"
)

// writeStore guarda un almacén con dos instalaciones emparejadas (A en Default, verificada; B en Profile 1, sin
// verificar) y un código de emparejamiento activo. La verificación de A es anterior a t0: no cuenta como una nueva.
func writeStore(t *testing.T, app string) {
	t.Helper()
	st := store.NewState()
	st.Paired = []store.Installation{
		{
			InstallationID: "inst-a", TokenHash: strings.Repeat("a", 64), ProfileDirectory: "Default",
			PairedAt: "2026-10-08T10:00:00.000Z", VerifiedAt: "2026-10-08T11:00:00.000Z",
		},
		{
			InstallationID: "inst-b", TokenHash: strings.Repeat("b", 64), ProfileDirectory: "Profile 1",
			PairedAt: "2026-10-08T10:00:00.000Z",
		},
	}
	st.PairCode = &store.PairCode{CodeHash: strings.Repeat("c", 64), ExpiresAt: "2099-01-01T00:00:00.000Z"}
	s, err := store.Open(app, time.Second)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if err := s.Save(st); err != nil {
		t.Fatal(err)
	}
}

// installHealthy deja Brave instalado con la copia de testdata/macos como datos del navegador y un almacén con dos
// instalaciones. Devuelve las opciones para Doctor.
func installHealthy(t *testing.T) (*fixture, Options) {
	t.Helper()
	f := newFixture(t, "brave")
	userDir := t.TempDir()
	copyTree(t, filepath.Join("..", "..", "testdata", "macos"), userDir)
	f.userDir = userDir
	o := f.opts("brave")
	o.UserDataDir = userDir
	if err := Install(o); err != nil {
		t.Fatal(err)
	}
	writeStore(t, f.app("brave"))
	f.out.Reset()
	return f, f.opts("brave")
}

func lines(out string) []string {
	return strings.Split(strings.TrimRight(out, "\n"), "\n")
}

func failures(out string) []string {
	var failed []string
	for _, l := range lines(out) {
		if strings.HasPrefix(l, "FALLO") {
			failed = append(failed, l)
		}
	}
	return failed
}

func TestDoctorHealthyInstallation(t *testing.T) {
	f, o := installHealthy(t)
	if !Doctor(o, false) {
		t.Fatalf("Doctor = false con una instalación sana:\n%s", f.out.String())
	}
	for _, l := range lines(f.out.String()) {
		if !strings.HasPrefix(l, "OK ") {
			t.Fatalf("línea que no es OK en una instalación sana: %q\n%s", l, f.out.String())
		}
	}
	out := f.out.String()
	// Informa del número de perfiles, de la versión del navegador, de los contenedores temporales y de las
	// instalaciones emparejadas y verificadas.
	for _, want := range []string{"perfiles: 3", "155.1.97.56", "contenedores temporales: sí", "emparejadas: 2, verificadas: 1"} {
		if !strings.Contains(out, want) {
			t.Fatalf("la salida no contiene %q:\n%s", want, out)
		}
	}
	// Ni nombres de perfil ni el código de emparejamiento activo.
	for _, secret := range []string{"Trabajo", "Personal", "Persona 1", strings.Repeat("c", 64)} {
		if strings.Contains(out, secret) {
			t.Fatalf("la salida contiene %q:\n%s", secret, out)
		}
	}
	if len(f.starter.calls) != 0 {
		t.Fatalf("Doctor sin --verify lanzó el navegador: %v", f.starter.calls)
	}
}

func TestDoctorWithoutStoreIsHealthy(t *testing.T) {
	f, o := installHealthy(t)
	if err := os.Remove(filepath.Join(f.app("brave"), "shared.json")); err != nil {
		t.Fatal(err)
	}
	f.out.Reset()
	if !Doctor(o, false) {
		t.Fatalf("Doctor = false sin almacén (aún sin emparejar):\n%s", f.out.String())
	}
}

func TestDoctorReportsEachProblem(t *testing.T) {
	for _, tc := range []struct {
		name string
		want string // texto que debe llevar la única línea FALLO
		hurt func(t *testing.T, f *fixture)
	}{
		{"binario modificado (T9)", "hash", func(t *testing.T, f *fixture) {
			bin := filepath.Join(f.app("brave"), "launcher-host")
			if err := os.WriteFile(bin, append(readFile(t, bin), '#'), 0o700); err != nil {
				t.Fatal(err)
			}
		}},
		{"binario ausente", "launcher-host", func(t *testing.T, f *fixture) {
			if err := os.Remove(filepath.Join(f.app("brave"), "launcher-host")); err != nil {
				t.Fatal(err)
			}
		}},
		{"binario con permisos 0755", "launcher-host", func(t *testing.T, f *fixture) {
			if err := os.Chmod(filepath.Join(f.app("brave"), "launcher-host"), 0o755); err != nil {
				t.Fatal(err)
			}
		}},
		{"manifest con otra ruta", "otra ruta", func(t *testing.T, f *fixture) {
			rewriteManifest(t, f, "/otro/launcher-host", testID)
		}},
		{"allowed_origins con otro id", "allowed_origins", func(t *testing.T, f *fixture) {
			rewriteManifest(t, f, filepath.Join(f.app("brave"), "launcher-host"), strings.Repeat("p", 32))
		}},
		{"manifest ausente", "manifest", func(t *testing.T, f *fixture) {
			if err := os.Remove(f.manifestPath("brave")); err != nil {
				t.Fatal(err)
			}
		}},
		{"manifest que no es JSON", "manifest", func(t *testing.T, f *fixture) {
			if err := os.WriteFile(f.manifestPath("brave"), []byte("{"), 0o644); err != nil {
				t.Fatal(err)
			}
		}},
		{"shared.json con permisos 0644", "0644", func(t *testing.T, f *fixture) {
			if err := os.Chmod(filepath.Join(f.app("brave"), "shared.json"), 0o644); err != nil {
				t.Fatal(err)
			}
		}},
		{"shared.json corrupto", "shared.json no es válido", func(t *testing.T, f *fixture) {
			if err := os.WriteFile(filepath.Join(f.app("brave"), "shared.json"), []byte("{"), 0o600); err != nil {
				t.Fatal(err)
			}
		}},
		{"ejecutable del navegador inexistente", "ejecutable del navegador", func(t *testing.T, f *fixture) {
			if err := os.Remove(f.exes["brave"]); err != nil {
				t.Fatal(err)
			}
		}},
		{"config.json con permisos 0644", "config.json", func(t *testing.T, f *fixture) {
			if err := os.Chmod(filepath.Join(f.app("brave"), "config.json"), 0o644); err != nil {
				t.Fatal(err)
			}
		}},
		{"config.json ausente", "config.json", func(t *testing.T, f *fixture) {
			if err := os.Remove(filepath.Join(f.app("brave"), "config.json")); err != nil {
				t.Fatal(err)
			}
		}},
		{"config.json no válido", "config.json", func(t *testing.T, f *fixture) {
			if err := os.WriteFile(filepath.Join(f.app("brave"), "config.json"), []byte(`{"browser":"opera"}`), 0o600); err != nil {
				t.Fatal(err)
			}
		}},
		{"carpeta de instalación con permisos 0755", "carpeta de instalación", func(t *testing.T, f *fixture) {
			if err := os.Chmod(f.app("brave"), 0o755); err != nil {
				t.Fatal(err)
			}
		}},
		{"Local State ilegible", "Local State", func(t *testing.T, f *fixture) {
			if err := os.Remove(filepath.Join(f.userDir, "Local State")); err != nil {
				t.Fatal(err)
			}
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f, o := installHealthy(t)
			tc.hurt(t, f)
			if Doctor(o, false) {
				t.Fatalf("Doctor = true con el problema %q:\n%s", tc.name, f.out.String())
			}
			failed := failures(f.out.String())
			if len(failed) != 1 || !strings.Contains(failed[0], tc.want) {
				t.Fatalf("quiero exactamente un FALLO con %q, hay %d:\n%s", tc.want, len(failed), f.out.String())
			}
		})
	}
}

func rewriteManifest(t *testing.T, f *fixture, binary, id string) {
	t.Helper()
	b, err := Manifest("brave", binary, id)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(f.manifestPath("brave"), b, 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestDoctorNotInstalled(t *testing.T) {
	f := newFixture(t, "brave")
	if Doctor(f.opts("brave"), false) {
		t.Fatal("Doctor = true sin nada instalado")
	}
	if failed := failures(f.out.String()); len(failed) != 1 || !strings.Contains(failed[0], "no está instalado") {
		t.Fatalf("quiero un único FALLO «no está instalado»:\n%s", f.out.String())
	}
	assertEmpty(t, f.home)

	// Tras un uninstall que conserva shared.json sigue sin estar instalado.
	f2, o := installHealthy(t)
	if err := Uninstall(o, false); err != nil {
		t.Fatal(err)
	}
	f2.out.Reset()
	if Doctor(o, false) {
		t.Fatal("Doctor = true tras uninstall")
	}
	if failed := failures(f2.out.String()); len(failed) != 1 || !strings.Contains(failed[0], "no está instalado") {
		t.Fatalf("tras uninstall quiero un único FALLO «no está instalado»:\n%s", f2.out.String())
	}
}

func TestDoctorUnknownBrowser(t *testing.T) {
	f := newFixture(t)
	if Doctor(f.opts("opera"), false) {
		t.Fatal("Doctor(opera) = true")
	}
	if len(failures(f.out.String())) != 1 {
		t.Fatalf("salida:\n%s", f.out.String())
	}
}

func TestDoctorWithoutBrowserChecksTheInstalledOnes(t *testing.T) {
	f, _ := installHealthy(t)
	if !Doctor(f.opts(), false) {
		t.Fatalf("Doctor sin --browser = false:\n%s", f.out.String())
	}
	if !strings.Contains(f.out.String(), "brave") || strings.Contains(f.out.String(), "chrome") {
		t.Fatalf("debe revisar solo los navegadores instalados:\n%s", f.out.String())
	}
	// Sin nada instalado en ninguno, falla.
	f2 := newFixture(t, "brave")
	if Doctor(f2.opts(), false) {
		t.Fatal("Doctor sin nada instalado = true")
	}
}

// markVerified simula a whoami: cuando se lanza, abre el almacén y marca verifiedAt en la instalación del perfil.
func markVerified(t *testing.T, f *fixture, app string) func(exe string, args []string) {
	return func(_ string, args []string) {
		dir, ok := strings.CutPrefix(args[0], "--profile-directory=")
		if !ok {
			t.Errorf("argumentos de whoami = %v", args)
			return
		}
		s, err := store.Open(app, time.Second) // falla si Doctor sigue teniendo el bloqueo
		if err != nil {
			t.Errorf("no se pudo abrir el almacén al lanzar whoami: %v", err)
			return
		}
		defer s.Close()
		st, err := s.Load()
		if err != nil || st == nil {
			t.Errorf("no se pudo cargar el almacén: %v", err)
			return
		}
		for i := range st.Paired {
			if st.Paired[i].ProfileDirectory == dir {
				st.Paired[i].VerifiedAt = protocol.FormatTime(f.now)
			}
		}
		if err := s.Save(st); err != nil {
			t.Errorf("no se pudo guardar: %v", err)
		}
	}
}

func TestDoctorVerifyReportsVerified(t *testing.T) {
	f, o := installHealthy(t)
	f.starter.onStart = markVerified(t, f, f.app("brave"))
	if !Doctor(o, true) {
		t.Fatalf("Doctor --verify = false:\n%s", f.out.String())
	}
	if n := strings.Count(f.out.String(), ": verificada\n"); n != 2 {
		t.Fatalf("quiero 2 instalaciones verificadas, hay %d:\n%s", n, f.out.String())
	}
	if f.slept != 0 {
		t.Fatalf("la verificación inmediata no debe esperar (esperó %v)", f.slept)
	}
	// whoami se abre en el perfil declarado de cada instalación, con el ejecutable de la configuración.
	if len(f.starter.calls) != 2 {
		t.Fatalf("llamadas = %v", f.starter.calls)
	}
	for i, dir := range []string{"Default", "Profile 1"} {
		c := f.starter.calls[i]
		if c.exe != f.exes["brave"] || len(c.args) != 3 || c.args[0] != "--profile-directory="+dir || c.args[1] != "--" ||
			!strings.HasPrefix(c.args[2], "chrome-extension://"+testID+"/whoami.html#") {
			t.Fatalf("llamada %d = %v", i, c)
		}
	}
	// El almacén guarda las pruebas emitidas, pero ni el nonce ni nombres de perfil salen por pantalla.
	for _, c := range f.starter.calls {
		nonce := c.args[2][strings.Index(c.args[2], "#")+1:]
		if strings.Contains(f.out.String(), nonce) {
			t.Fatalf("la salida contiene el nonce:\n%s", f.out.String())
		}
	}
}

func TestDoctorVerifyTimesOutWhenNobodyAnswers(t *testing.T) {
	// A ya tenía una verificación anterior: no cuenta, tiene que haber una nueva.
	f, o := installHealthy(t)
	if Doctor(o, true) {
		t.Fatalf("Doctor --verify = true sin respuesta:\n%s", f.out.String())
	}
	failed := failures(f.out.String())
	if len(failed) != 2 {
		t.Fatalf("quiero un FALLO por instalación, hay %d:\n%s", len(failed), f.out.String())
	}
	for _, l := range failed {
		if !strings.Contains(l, "sin verificar") {
			t.Fatalf("FALLO sin «sin verificar»: %q", l)
		}
	}
	// Espera hasta 65 s por instalación (D21), sin pasarse mucho.
	if f.slept < 2*65*time.Second || f.slept > 2*66*time.Second {
		t.Fatalf("esperó %v en total, quiero unos %v", f.slept, 2*65*time.Second)
	}
}

func TestDoctorVerifyNeedsADeclaredProfile(t *testing.T) {
	f, o := installHealthy(t)
	s, err := store.Open(f.app("brave"), time.Second)
	if err != nil {
		t.Fatal(err)
	}
	st, err := s.Load()
	if err != nil || st == nil {
		t.Fatal(err)
	}
	st.Paired[1].ProfileDirectory = ""
	st.Paired[0].VerifiedAt = ""
	if err := s.Save(st); err != nil {
		t.Fatal(err)
	}
	s.Close()
	f.starter.onStart = markVerified(t, f, f.app("brave"))
	f.out.Reset()
	if Doctor(o, true) {
		t.Fatalf("Doctor --verify = true con una instalación sin perfil:\n%s", f.out.String())
	}
	if failed := failures(f.out.String()); len(failed) != 1 || !strings.Contains(failed[0], "perfil") {
		t.Fatalf("quiero un FALLO por la instalación sin perfil declarado:\n%s", f.out.String())
	}
	// Solo se lanzó la instalación con perfil.
	if len(f.starter.calls) != 1 {
		t.Fatalf("llamadas = %v", f.starter.calls)
	}
}

func TestDoctorVerifyLaunchFailure(t *testing.T) {
	f, o := installHealthy(t)
	f.starter.err = os.ErrPermission
	if Doctor(o, true) {
		t.Fatalf("Doctor --verify = true con el lanzador roto:\n%s", f.out.String())
	}
	if f.slept != 0 {
		t.Fatalf("si no se pudo lanzar no hay nada que esperar (esperó %v)", f.slept)
	}
	if strings.Contains(f.out.String(), "permission") {
		t.Fatalf("la salida no debe repetir el error del lanzador:\n%s", f.out.String())
	}
}

func TestDoctorVerifyWithoutPairings(t *testing.T) {
	f, o := installHealthy(t)
	if err := Pairing(o, true, 0); err != nil {
		t.Fatal(err)
	}
	f.out.Reset()
	if Doctor(o, true) {
		t.Fatalf("Doctor --verify = true sin instalaciones:\n%s", f.out.String())
	}
	if len(f.starter.calls) != 0 {
		t.Fatalf("llamadas = %v", f.starter.calls)
	}
}
