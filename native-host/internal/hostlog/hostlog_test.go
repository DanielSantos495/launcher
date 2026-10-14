package hostlog

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

var t0 = time.Date(2026, 10, 8, 12, 0, 0, 0, time.UTC)

func fixedNow() time.Time { return t0 }

func readLog(t *testing.T, dir string) string {
	t.Helper()
	b, err := os.ReadFile(filepath.Join(dir, "host.log"))
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func TestDisabledIsNoOp(t *testing.T) {
	dir := t.TempDir()
	l := Open(dir, false, fixedNow)
	l.Record("open", "ok", time.Second)
	if err := l.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dir, "host.log")); !os.IsNotExist(err) {
		t.Fatalf("host.log no debe existir con el registro desactivado (err = %v)", err)
	}
}

func TestOpenErrorIsNoOp(t *testing.T) {
	// La carpeta no existe: Open no puede crear el archivo y el registro queda inactivo, sin error ni pánico.
	l := Open(filepath.Join(t.TempDir(), "no-existe"), true, fixedNow)
	l.Record("open", "ok", 0)
	if err := l.Close(); err != nil {
		t.Fatal(err)
	}
}

func TestNilLoggerIsNoOp(t *testing.T) {
	var l *Logger
	l.Record("open", "ok", 0)
	if err := l.Close(); err != nil {
		t.Fatal(err)
	}
}

func TestRecordFormatAndAppend(t *testing.T) {
	dir := t.TempDir()
	l := Open(dir, true, fixedNow)
	l.Record("open", "ok", 12*time.Millisecond+900*time.Microsecond)
	l.Record("-", "bad_request", 0)
	if err := l.Close(); err != nil {
		t.Fatal(err)
	}
	// Otra apertura añade al final, no sobrescribe.
	l = Open(dir, true, fixedNow)
	l.Record("sync.put", "conflict", 3*time.Millisecond)
	if err := l.Close(); err != nil {
		t.Fatal(err)
	}
	want := "2026-10-08T12:00:00.000Z cmd=open code=ok ms=12\n" +
		"2026-10-08T12:00:00.000Z cmd=- code=bad_request ms=0\n" +
		"2026-10-08T12:00:00.000Z cmd=sync.put code=conflict ms=3\n"
	if got := readLog(t, dir); got != want {
		t.Fatalf("host.log = %q, quiero %q", got, want)
	}
	fi, err := os.Stat(filepath.Join(dir, "host.log"))
	if err != nil {
		t.Fatal(err)
	}
	if fi.Mode().Perm() != 0o600 {
		t.Fatalf("permisos = %v, quiero 0600", fi.Mode().Perm())
	}
}

func TestRecordSanitizesValues(t *testing.T) {
	// cmd y code llegan ya validados; si no lo estuvieran, no se escriben tal cual (nada de saltos de línea ni
	// datos del mensaje en el registro).
	dir := t.TempDir()
	l := Open(dir, true, fixedNow)
	l.Record("https://github.com/\nfalso", "bad\ncode", -5*time.Second)
	if err := l.Close(); err != nil {
		t.Fatal(err)
	}
	want := "2026-10-08T12:00:00.000Z cmd=- code=- ms=0\n"
	if got := readLog(t, dir); got != want {
		t.Fatalf("host.log = %q, quiero %q", got, want)
	}
}

func TestRotatesAboveOneMiB(t *testing.T) {
	for _, tc := range []struct {
		name    string
		size    int
		rotated bool
	}{
		{"justo 1 MiB no rota", 1 << 20, false},
		{"1 MiB + 1 rota", 1<<20 + 1, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			dir := t.TempDir()
			old := strings.Repeat("x", tc.size)
			if err := os.WriteFile(filepath.Join(dir, "host.log"), []byte(old), 0o600); err != nil {
				t.Fatal(err)
			}
			l := Open(dir, true, fixedNow)
			l.Record("ping", "ok", 0)
			if err := l.Close(); err != nil {
				t.Fatal(err)
			}
			line := "2026-10-08T12:00:00.000Z cmd=ping code=ok ms=0\n"
			rotated, err := os.ReadFile(filepath.Join(dir, "host.log.1"))
			if tc.rotated {
				if err != nil || string(rotated) != old {
					t.Fatalf("host.log.1 debe tener el contenido anterior (err = %v, %d bytes)", err, len(rotated))
				}
				if got := readLog(t, dir); got != line {
					t.Fatalf("host.log = %q, quiero solo la línea nueva", got)
				}
				return
			}
			if !os.IsNotExist(err) {
				t.Fatalf("host.log.1 no debe existir (err = %v)", err)
			}
			if got := readLog(t, dir); got != old+line {
				t.Fatalf("host.log debe conservar lo anterior y añadir la línea")
			}
		})
	}
}

func TestRotationReplacesPreviousRotation(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "host.log.1"), []byte("viejo"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "host.log"), []byte(strings.Repeat("y", 1<<20+1)), 0o600); err != nil {
		t.Fatal(err)
	}
	Open(dir, true, fixedNow).Close()
	rotated, err := os.ReadFile(filepath.Join(dir, "host.log.1"))
	if err != nil || len(rotated) != 1<<20+1 {
		t.Fatalf("host.log.1 debe ser el registro rotado (err = %v, %d bytes)", err, len(rotated))
	}
}
