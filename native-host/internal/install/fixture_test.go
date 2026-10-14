package install

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"io/fs"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"
)

// t0 es la hora fija de las pruebas: 2026-10-08T12:00:00.000Z.
var t0 = time.Date(2026, 10, 8, 12, 0, 0, 0, time.UTC)

type startCall struct {
	exe  string
	args []string
}

// fakeStarter apunta las llamadas; onStart se ejecuta en cada una (la prueba lo usa para simular a whoami).
type fakeStarter struct {
	calls   []startCall
	err     error
	onStart func(exe string, args []string)
}

func (f *fakeStarter) Start(exe string, args []string) error {
	f.calls = append(f.calls, startCall{exe: exe, args: slices.Clone(args)})
	if f.onStart != nil {
		f.onStart(exe, args)
	}
	return f.err
}

// fixture es un entorno de prueba: una carpeta personal temporal, un binario "fuente" cualquiera, ejecutables falsos
// de los navegadores (archivos en una carpeta temporal) y relojes falsos. Sustituye goos y browsers del paquete.
type fixture struct {
	t        *testing.T
	home     string
	src      string // ruta del binario que se copia
	srcBytes []byte
	exes     map[string]string // navegador -> ejecutable falso
	userDir  string            // datos del navegador de installHealthy
	out      bytes.Buffer
	starter  *fakeStarter
	now      time.Time
	slept    time.Duration
}

// newFixture crea los ejecutables falsos de los navegadores present (los demás apuntan a archivos que no existen).
func newFixture(t *testing.T, present ...string) *fixture {
	t.Helper()
	f := &fixture{
		t: t, home: t.TempDir(), exes: map[string]string{}, starter: &fakeStarter{}, now: t0,
		srcBytes: []byte("#!/bin/sh\necho launcher-host de prueba\n"),
	}
	srcDir := t.TempDir()
	f.src = filepath.Join(srcDir, "src-host")
	if err := os.WriteFile(f.src, f.srcBytes, 0o755); err != nil {
		t.Fatal(err)
	}
	exeDir := t.TempDir()
	for _, name := range []string{"brave", "chrome", "edge"} {
		f.exes[name] = filepath.Join(exeDir, name+"-exe")
		if slices.Contains(present, name) {
			if err := os.WriteFile(f.exes[name], []byte("exe"), 0o755); err != nil {
				t.Fatal(err)
			}
		}
	}
	oldGOOS, oldBrowsers := goos, browsers
	goos = "darwin"
	browsers = func(home string) []Browser {
		list := Browsers(home)
		for i := range list {
			list[i].Exe = f.exes[list[i].Name]
		}
		return list
	}
	t.Cleanup(func() { goos, browsers = oldGOOS, oldBrowsers })
	return f
}

// opts son las opciones de Install/Uninstall/Doctor/Pairing con los navegadores indicados.
func (f *fixture) opts(names ...string) Options {
	return Options{
		Home:        f.home,
		Browsers:    names,
		ExtensionID: testID,
		Source:      f.src,
		Out:         &f.out,
		Now:         func() time.Time { return f.now },
		Rand:        bytes.NewReader(bytes.Repeat([]byte{7}, 4096)),
		Starter:     f.starter,
		Sleep: func(d time.Duration) {
			f.slept += d
			f.now = f.now.Add(d)
		},
	}
}

func (f *fixture) app(browser string) string { return AppDir(f.home, browser) }

func (f *fixture) manifestPath(browser string) string {
	for _, b := range browsers(f.home) {
		if b.Name == browser {
			return filepath.Join(b.ManifestDir, "com.curyapps.launcher."+browser+".json")
		}
	}
	f.t.Fatalf("navegador desconocido: %s", browser)
	return ""
}

func (f *fixture) userDataDir(browser string) string {
	for _, b := range browsers(f.home) {
		if b.Name == browser {
			return b.UserDataDir
		}
	}
	f.t.Fatalf("navegador desconocido: %s", browser)
	return ""
}

func (f *fixture) mustInstall(names ...string) {
	f.t.Helper()
	if err := Install(f.opts(names...)); err != nil {
		f.t.Fatalf("Install: %v", err)
	}
}

func (f *fixture) srcHash() string {
	sum := sha256.Sum256(f.srcBytes)
	return hex.EncodeToString(sum[:])
}

func readFile(t *testing.T, path string) []byte {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func perm(t *testing.T, path string) fs.FileMode {
	t.Helper()
	fi, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	return fi.Mode().Perm()
}

// assertEmpty comprueba que dir no contiene nada: un error previo a escribir no deja rastro.
func assertEmpty(t *testing.T, dir string) {
	t.Helper()
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 0 {
		names := make([]string, 0, len(entries))
		for _, e := range entries {
			names = append(names, e.Name())
		}
		t.Fatalf("se escribió algo en %s: %s", dir, strings.Join(names, ", "))
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
