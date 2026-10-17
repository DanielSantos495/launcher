package caller

import (
	"errors"
	"testing"
)

func TestWindowsPathKey(t *testing.T) {
	for in, want := range map[string]string{
		`C:\Program Files\Brave\brave.exe`:    `c:/program files/brave/brave.exe`,
		`c:/Program Files//Brave/./brave.exe`: `c:/program files/brave/brave.exe`,
		`C:\a\b\..\c.exe`:                     `c:/a/c.exe`,
		`\\?\C:\Program Files\x.exe`:          `c:/program files/x.exe`,
		`\\Servidor\Recurso\x.exe`:            `//servidor/recurso/x.exe`,
		`C:\`:                                 `c:`,
	} {
		if got, ok := windowsPathKey(in); !ok || got != want {
			t.Errorf("windowsPathKey(%q) = %q, %v; quiero %q", in, got, ok, want)
		}
	}
	for _, in := range []string{"", `brave.exe`, `\x\y.exe`, `C:x.exe`, `C:\..`, "C:\\a\x00", `\\`, `\\?\UNC\s\r`, `/usr/bin/x`} {
		if got, ok := windowsPathKey(in); ok {
			t.Errorf("windowsPathKey(%q) = %q, debería rechazarla", in, got)
		}
	}
}

func TestSameWindowsPath(t *testing.T) {
	if !SameWindowsPath(`C:\Program Files\Brave\brave.exe`, `c:\PROGRAM FILES\brave\..\Brave\BRAVE.EXE`) {
		t.Fatal("misma ruta con otras mayúsculas y un ..")
	}
	for _, c := range [][2]string{
		{`C:\a\brave.exe`, `C:\b\brave.exe`},
		{`C:\a\brave.exe`, `D:\a\brave.exe`},
		{`C:\a\brave.exe`, `C:\a\brave.exe.bak`},
		{`brave.exe`, `brave.exe`},
		{``, ``},
	} {
		if SameWindowsPath(c[0], c[1]) {
			t.Errorf("%q y %q no son la misma ruta", c[0], c[1])
		}
	}
}

func TestCheckParentWindows(t *testing.T) {
	old := windowsPaths
	windowsPaths = true
	t.Cleanup(func() { windowsPaths = old })
	cfg := Config{Exe: `C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe`}
	lookup := func(path string, err error) ParentLookup {
		return func(pid int) (string, error) {
			if pid != 1234 {
				t.Errorf("lookup(%d)", pid)
			}
			return path, err
		}
	}
	if err := CheckParent(cfg, 1234, lookup(`c:\program files\bravesoftware\brave-browser\application\BRAVE.EXE`, nil)); err != nil {
		t.Fatalf("mismo navegador con otras mayúsculas: %v", err)
	}
	if err := CheckParent(cfg, 1234, lookup(`C:\Users\x\AppData\Local\Temp\brave.exe`, nil)); !errors.Is(err, ErrParentMismatch) {
		t.Fatalf("padre en otra carpeta = %v", err)
	}
	if err := CheckParent(cfg, 1234, lookup(`C:\Windows\System32\cmd.exe`, nil)); !errors.Is(err, ErrParentMismatch) {
		t.Fatalf("padre cmd.exe = %v", err)
	}
	if err := CheckParent(cfg, 1234, lookup("", nil)); !errors.Is(err, ErrParentMismatch) {
		t.Fatalf("ruta vacía = %v", err)
	}
	boom := errors.New("sin acceso")
	if err := CheckParent(cfg, 1234, lookup("", boom)); !errors.Is(err, boom) {
		t.Fatalf("error de lookup = %v", err)
	}
	if err := CheckParent(cfg, 0, lookup("x", nil)); !errors.Is(err, ErrParentMismatch) {
		t.Fatalf("ppid 0 = %v", err)
	}
}

func TestParentOf(t *testing.T) {
	rows := []procEntry{{pid: 4, ppid: 0}, {pid: 100, ppid: 4}, {pid: 200, ppid: 100}, {pid: 300, ppid: 100}}
	iter := func(rows []procEntry) func() (procEntry, bool) {
		i := 0
		return func() (procEntry, bool) {
			if i >= len(rows) {
				return procEntry{}, false
			}
			i++
			return rows[i-1], true
		}
	}
	if got, err := parentOf(200, iter(rows)); err != nil || got != 100 {
		t.Fatalf("parentOf(200) = %d, %v", got, err)
	}
	if _, err := parentOf(999, iter(rows)); err == nil {
		t.Fatal("proceso ausente sin error")
	}
	if _, err := parentOf(4, iter(rows)); err == nil {
		t.Fatal("padre 0 sin error")
	}
	if _, err := parentOf(1, iter(nil)); err == nil {
		t.Fatal("instantánea vacía sin error")
	}
}
