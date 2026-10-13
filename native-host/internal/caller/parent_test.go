package caller

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

// braveExe es una ruta con la forma de la de Brave en macOS pero que no existe en ningun equipo: las pruebas no
// dependen de que el navegador este instalado.
const braveExe = "/no-existe-launcher-prueba/Brave Browser.app/Contents/MacOS/Brave Browser"

func testConfig(exe string) Config {
	return Config{
		Browser:      "brave",
		Exe:          exe,
		UserDataDir:  "/Users/ejemplo/Library/Application Support/BraveSoftware/Brave-Browser",
		ExtensionID:  "abcdefghijklmnopabcdefghijklmnop",
		BinarySHA256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
	}
}

// fakeLookup devuelve siempre path y err, y apunta los pids por los que le preguntan.
type fakeLookup struct {
	path string
	err  error
	pids []int
}

func (f *fakeLookup) lookup(pid int) (string, error) {
	f.pids = append(f.pids, pid)
	return f.path, f.err
}

func TestCheckParentMatch(t *testing.T) {
	f := &fakeLookup{path: braveExe}
	if err := CheckParent(testConfig(braveExe), 4321, f.lookup); err != nil {
		t.Fatalf("CheckParent = %v, want nil", err)
	}
	if len(f.pids) != 1 || f.pids[0] != 4321 {
		t.Fatalf("lookup recibio los pids %v, want [4321]", f.pids)
	}
}

func TestCheckParentMismatch(t *testing.T) {
	cases := []struct {
		name, parent, exe string
	}{
		{"otro navegador", "/no-existe-launcher-prueba/Google Chrome.app/Contents/MacOS/Google Chrome", braveExe},
		{"otra ruta con el mismo nombre", "/tmp/Brave Browser.app/Contents/MacOS/Brave Browser", braveExe},
		{"mismo nombre base", "/tmp/Brave Browser", braveExe},
		{"padre vacio", "", braveExe},
		{"exe vacio", braveExe, ""},
		{"ambos vacios", "", ""},
		{"padre relativo", "Brave Browser", "Brave Browser"},
		{"padre relativo y exe absoluto", "Contents/MacOS/Brave Browser", braveExe},
		{"mayusculas distintas", "/NO-EXISTE-LAUNCHER-PRUEBA/Brave Browser.app/Contents/MacOS/Brave Browser", braveExe},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			f := &fakeLookup{path: tc.parent}
			err := CheckParent(testConfig(tc.exe), 4321, f.lookup)
			if !errors.Is(err, ErrParentMismatch) {
				t.Fatalf("CheckParent = %v, want ErrParentMismatch", err)
			}
		})
	}
}

func TestCheckParentCleansPaths(t *testing.T) {
	// Rutas que no existen en disco: EvalSymlinks falla y solo queda la comparacion de rutas limpias.
	const clean = "/no-existe-launcher-prueba/app/Contents/MacOS/navegador"
	f := &fakeLookup{path: "/no-existe-launcher-prueba/./app/Contents/../Contents/MacOS/navegador"}
	if err := CheckParent(testConfig(clean), 4321, f.lookup); err != nil {
		t.Fatalf("CheckParent con '.' y '..' en el padre = %v, want nil", err)
	}
	f = &fakeLookup{path: clean}
	if err := CheckParent(testConfig(clean+"/"), 4321, f.lookup); err != nil {
		t.Fatalf("CheckParent con barra final en exe = %v, want nil", err)
	}
	// Limpiar no puede juntar rutas distintas.
	f = &fakeLookup{path: "/no-existe-launcher-prueba/app/Contents/../navegador"}
	if err := CheckParent(testConfig(clean), 4321, f.lookup); !errors.Is(err, ErrParentMismatch) {
		t.Fatalf("CheckParent con otra ruta = %v, want ErrParentMismatch", err)
	}
}

func TestCheckParentCleansResolvedPaths(t *testing.T) {
	dir := t.TempDir()
	real := filepath.Join(dir, "real")
	if err := os.WriteFile(real, []byte("x"), 0o700); err != nil {
		t.Fatal(err)
	}
	f := &fakeLookup{path: dir + "/./sub/../real"}
	if err := os.Mkdir(filepath.Join(dir, "sub"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := CheckParent(testConfig(real), 4321, f.lookup); err != nil {
		t.Fatalf("CheckParent = %v, want nil", err)
	}
}

func TestCheckParentFollowsSymlinks(t *testing.T) {
	dir := t.TempDir()
	real := filepath.Join(dir, "real")
	other := filepath.Join(dir, "otro")
	link := filepath.Join(dir, "enlace")
	for _, p := range []string{real, other} {
		if err := os.WriteFile(p, []byte("x"), 0o700); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.Symlink(real, link); err != nil {
		t.Fatal(err)
	}

	// exe es un enlace a la ruta que da lookup.
	f := &fakeLookup{path: real}
	if err := CheckParent(testConfig(link), 4321, f.lookup); err != nil {
		t.Fatalf("exe es un enlace al padre: %v, want nil", err)
	}
	// lookup da el enlace y exe es la ruta real.
	f = &fakeLookup{path: link}
	if err := CheckParent(testConfig(real), 4321, f.lookup); err != nil {
		t.Fatalf("el padre es un enlace al exe: %v, want nil", err)
	}
	// Un enlace a otro archivo no vale.
	f = &fakeLookup{path: other}
	if err := CheckParent(testConfig(link), 4321, f.lookup); !errors.Is(err, ErrParentMismatch) {
		t.Fatalf("enlace a otro archivo: %v, want ErrParentMismatch", err)
	}
}

func TestCheckParentLookupError(t *testing.T) {
	boom := errors.New("lsof fallo")
	f := &fakeLookup{path: braveExe, err: boom}
	err := CheckParent(testConfig(braveExe), 4321, f.lookup)
	if !errors.Is(err, boom) {
		t.Fatalf("CheckParent = %v, want el error de lookup", err)
	}
	if errors.Is(err, ErrParentMismatch) {
		t.Fatal("un fallo de lookup no es ErrParentMismatch")
	}

	f = &fakeLookup{err: ErrUnsupported}
	if err := CheckParent(testConfig(braveExe), 4321, f.lookup); !errors.Is(err, ErrUnsupported) || errors.Is(err, ErrParentMismatch) {
		t.Fatalf("CheckParent = %v, want ErrUnsupported", err)
	}
}

func TestCheckParentRejectsOrphanPPID(t *testing.T) {
	for _, ppid := range []int{-5, 0, 1} {
		f := &fakeLookup{path: braveExe}
		err := CheckParent(testConfig(braveExe), ppid, f.lookup)
		if err == nil {
			t.Errorf("ppid %d: want error", ppid)
		}
		if len(f.pids) != 0 {
			t.Errorf("ppid %d: lookup se llamo con %v", ppid, f.pids)
		}
	}
	// 2 ya es un pid posible.
	f := &fakeLookup{path: braveExe}
	if err := CheckParent(testConfig(braveExe), 2, f.lookup); err != nil {
		t.Fatalf("ppid 2: %v", err)
	}
}

func TestCheckParentNilLookupFailsClosed(t *testing.T) {
	if err := CheckParent(testConfig(braveExe), 4321, nil); err == nil {
		t.Fatal("lookup nil: want error")
	}
}

func TestParseLsofTxt(t *testing.T) {
	// Salida real de `lsof -a -p <pid> -d txt -Fn` (macOS): la primera entrada txt es el ejecutable.
	const real = "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"
	out := "p91980\nftxt\nn" + real + "\nftxt\nn/usr/lib/dyld\n"
	got, err := parseLsofTxt([]byte(out))
	if err != nil || got != real {
		t.Fatalf("got %q, %v", got, err)
	}
	for _, bad := range []string{"", "p1\n", "p1\nftxt\nnBrave Browser\n", "p1\nftxt\nn\n"} {
		if _, err := parseLsofTxt([]byte(bad)); err == nil {
			t.Errorf("%q: want error (sin entrada o ruta no absoluta)", bad)
		}
	}
}

func TestParseLsofTxtUsesOnlyTheFirstEntry(t *testing.T) {
	// Si la primera entrada no es absoluta no se salta a la siguiente: el ejecutable es la primera.
	out := "p1\nftxt\nnrelativa\nftxt\nn/usr/lib/dyld\n"
	if got, err := parseLsofTxt([]byte(out)); err == nil {
		t.Fatalf("got %q, want error", got)
	}
}

func TestParentExeRejectsBadPID(t *testing.T) {
	for _, pid := range []int{-1, 0, 1} {
		if _, err := ParentExe(pid); err == nil {
			t.Errorf("pid %d: want error", pid)
		}
	}
}
