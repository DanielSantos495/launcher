package main

import (
	"bytes"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/DanielSantos495/launcher/native-host/internal/install"
	"github.com/DanielSantos495/launcher/native-host/internal/store"
)

// cliFixture ejecuta runCLI con una carpeta personal temporal y un "binario" cualquiera como fuente de install.
type cliFixture struct {
	t      *testing.T
	home   string
	src    string
	stdout bytes.Buffer
	stderr bytes.Buffer
}

func newCLIFixture(t *testing.T) *cliFixture {
	t.Helper()
	f := &cliFixture{t: t, home: t.TempDir()}
	f.src = filepath.Join(t.TempDir(), "src-host")
	if err := os.WriteFile(f.src, []byte("#!/bin/sh\necho prueba\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	return f
}

func (f *cliFixture) run(args ...string) int {
	f.t.Helper()
	f.stdout.Reset()
	f.stderr.Reset()
	return runCLI(args, &f.stdout, &f.stderr, cliDeps{
		Home:       func() (string, error) { return f.home, nil },
		Executable: func() (string, error) { return f.src, nil },
	})
}

func TestCLIUsageErrors(t *testing.T) {
	for _, args := range [][]string{
		{"install"},
		{"install", "--extension-id", "corto"},
		{"install", "--browser", "opera", "--extension-id", testExtensionID},
		{"install", "--extension-id", testExtensionID, "sobra"},
		{"install", "--nope"},
		{"uninstall", "--browser", "opera"},
		{"uninstall", "sobra"},
		{"doctor", "sobra"},
		{"doctor", "--nope"},
		{"doctor", "--browser", "opera"},
		{"pairing"},
		{"pairing", "--browser", "brave"},
		{"pairing", "--reset"},
		{"pairing", "--browser", "brave", "--max", "17"},
		{"pairing", "--browser", "brave", "--max", "-1"},
		{"pairing", "--browser", "brave", "--max", "x"},
	} {
		f := newCLIFixture(t)
		if code := f.run(args...); code != 2 {
			t.Fatalf("%v = %d, quiero 2\nstdout: %s\nstderr: %s", args, code, f.stdout.String(), f.stderr.String())
		}
		if f.stderr.Len() == 0 {
			t.Fatalf("%v: un error de uso debe explicarse por stderr", args)
		}
		// Un error de uso no escribe nada.
		entries, err := os.ReadDir(f.home)
		if err != nil || len(entries) != 0 {
			t.Fatalf("%v escribió en la carpeta personal: %v, %v", args, entries, err)
		}
	}
}

// Un navegador desconocido es un error de uso (2); uno conocido sin instalación es un fallo de doctor (1).
func TestCLIDoctorBrowserValidation(t *testing.T) {
	f := newCLIFixture(t)
	if code := f.run("doctor", "--browser", "opera"); code != 2 {
		t.Fatalf("doctor --browser opera = %d, quiero 2\nstdout: %s\nstderr: %s", code, f.stdout.String(), f.stderr.String())
	}
	if !strings.Contains(f.stderr.String(), "navegador desconocido") {
		t.Fatalf("falta el mensaje de uso: %q", f.stderr.String())
	}
	f = newCLIFixture(t)
	if code := f.run("doctor", "--browser", "brave"); code != 1 {
		t.Fatalf("doctor --browser brave sin instalar = %d, quiero 1\nstdout: %s\nstderr: %s", code, f.stdout.String(), f.stderr.String())
	}
}

func TestCLIHelpExitsZero(t *testing.T) {
	for _, name := range []string{"install", "uninstall", "doctor", "pairing"} {
		f := newCLIFixture(t)
		if code := f.run(name, "-h"); code != 0 {
			t.Fatalf("%s -h = %d, quiero 0", name, code)
		}
		if !strings.Contains(f.stderr.String(), "uso: launcher-host "+name) {
			t.Fatalf("%s -h no muestra el uso: %q", name, f.stderr.String())
		}
	}
}

func TestCLIHomeFailure(t *testing.T) {
	var stdout, stderr bytes.Buffer
	for _, home := range []func() (string, error){
		func() (string, error) { return "", os.ErrNotExist },
		func() (string, error) { return "relativa", nil },
	} {
		code := runCLI([]string{"doctor"}, &stdout, &stderr, cliDeps{Home: home, Executable: func() (string, error) { return "/x", nil }})
		if code != 1 || !strings.Contains(stderr.String(), "carpeta personal") {
			t.Fatalf("doctor sin carpeta personal = %d, %q", code, stderr.String())
		}
	}
}

func TestCLIFullFlow(t *testing.T) {
	if runtime.GOOS != "darwin" {
		t.Skip("install solo funciona en macOS en F1")
	}
	f := newCLIFixture(t)
	exe := filepath.Join(t.TempDir(), "mi-brave")
	if err := os.WriteFile(exe, []byte("exe"), 0o755); err != nil {
		t.Fatal(err)
	}
	userDir := t.TempDir()
	copyTree(t, filepath.Join("..", "..", "testdata", "macos"), userDir)

	if code := f.run("install", "--browser", "brave", "--extension-id", testExtensionID, "--exe", exe, "--user-data-dir", userDir); code != 0 {
		t.Fatalf("install = %d\nstdout: %s\nstderr: %s", code, f.stdout.String(), f.stderr.String())
	}
	if code := f.run("doctor", "--browser", "brave"); code != 0 {
		t.Fatalf("doctor = %d\n%s%s", code, f.stdout.String(), f.stderr.String())
	}
	if strings.Contains(f.stdout.String(), "FALLO") {
		t.Fatalf("doctor con FALLO:\n%s", f.stdout.String())
	}

	// pairing necesita un almacén: sin él, 1 (un fallo, no un error de uso).
	if code := f.run("pairing", "--browser", "brave", "--reset"); code != 1 {
		t.Fatalf("pairing sin almacén = %d, quiero 1\n%s", code, f.stderr.String())
	}
	app := install.AppDir(f.home, "brave")
	s, err := store.Open(app, time.Second)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.Save(store.NewState()); err != nil {
		t.Fatal(err)
	}
	s.Close()
	if code := f.run("pairing", "--browser", "brave", "--max", "3"); code != 0 {
		t.Fatalf("pairing --max 3 = %d\n%s", code, f.stderr.String())
	}
	s, err = store.Open(app, time.Second)
	if err != nil {
		t.Fatal(err)
	}
	st, err := s.Load()
	s.Close()
	if err != nil || st == nil || st.MaxPairedProfiles != 3 {
		t.Fatalf("estado tras pairing --max 3: %+v, %v", st, err)
	}

	if code := f.run("uninstall", "--browser", "brave"); code != 0 {
		t.Fatalf("uninstall = %d\n%s", code, f.stderr.String())
	}
	if code := f.run("doctor", "--browser", "brave"); code != 1 || !strings.Contains(f.stdout.String(), "no está instalado") {
		t.Fatalf("doctor tras uninstall = %d\n%s", code, f.stdout.String())
	}
}
