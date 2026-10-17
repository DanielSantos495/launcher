package launch_test

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"testing/iotest"

	"github.com/DanielSantos495/launcher/native-host/internal/launch"
	"github.com/DanielSantos495/launcher/native-host/internal/profiles"
)

const userDataDir = "/Users/ejemplo/Library/Application Support/BraveSoftware/Brave-Browser"

var candidateFormat = regexp.MustCompile(`^Launcher-[0-9a-f]{8}$`)

// testdataLocalState lee la copia inventada de Local State: tiene Launcher-1a2b3c4d en info_cache y Profile 3 en
// profile_basenames_deleted.
func testdataLocalState(t *testing.T) *profiles.LocalState {
	t.Helper()
	ls, err := profiles.ReadLocalState("../../testdata/macos")
	if err != nil {
		t.Fatal(err)
	}
	return ls
}

func localState(t *testing.T, json string) *profiles.LocalState {
	t.Helper()
	ls, err := profiles.ParseLocalState([]byte(json))
	if err != nil {
		t.Fatal(err)
	}
	return ls
}

// existsRecorder es un "exists" falso: apunta cada ruta por la que le preguntan y dice que existe si esta en taken.
type existsRecorder struct {
	taken map[string]bool
	calls []string
}

func (e *existsRecorder) exists(path string) bool {
	e.calls = append(e.calls, path)
	return e.taken[path]
}

func noneExists(string) bool { return false }

func TestNewProfileDirectorySkipsInfoCache(t *testing.T) {
	// El primer candidato es Launcher-1a2b3c4d, que ya esta en info_cache del Local State de prueba.
	r := bytes.NewReader([]byte{0x1a, 0x2b, 0x3c, 0x4d, 0x5e, 0x6f, 0x70, 0x81})
	rec := &existsRecorder{}
	got, err := launch.NewProfileDirectory(r, testdataLocalState(t), userDataDir, rec.exists)
	if err != nil || got != "Launcher-5e6f7081" {
		t.Fatalf("NewProfileDirectory = %q, %v; want Launcher-5e6f7081", got, err)
	}
	// El candidato tomado ni siquiera llega a mirarse en disco.
	if want := []string{filepath.Join(userDataDir, "Launcher-5e6f7081")}; len(rec.calls) != 1 || rec.calls[0] != want[0] {
		t.Fatalf("exists recibio %q, want %q", rec.calls, want)
	}
}

func TestNewProfileDirectoryFirstCandidateFree(t *testing.T) {
	r := bytes.NewReader([]byte{0xde, 0xad, 0xbe, 0xef, 0x00, 0x00, 0x00, 0x00})
	rec := &existsRecorder{}
	got, err := launch.NewProfileDirectory(r, testdataLocalState(t), userDataDir, rec.exists)
	if err != nil || got != "Launcher-deadbeef" {
		t.Fatalf("NewProfileDirectory = %q, %v", got, err)
	}
	if r.Len() != 4 {
		t.Fatalf("se leyeron %d bytes de mas", 4-r.Len())
	}
	if len(rec.calls) != 1 || rec.calls[0] != filepath.Join(userDataDir, "Launcher-deadbeef") {
		t.Fatalf("exists recibio %q", rec.calls)
	}
}

func TestNewProfileDirectorySkipsExistingFolder(t *testing.T) {
	rec := &existsRecorder{taken: map[string]bool{filepath.Join(userDataDir, "Launcher-aabbccdd"): true}}
	r := bytes.NewReader([]byte{0xaa, 0xbb, 0xcc, 0xdd, 0x11, 0x22, 0x33, 0x44})
	got, err := launch.NewProfileDirectory(r, testdataLocalState(t), userDataDir, rec.exists)
	if err != nil || got != "Launcher-11223344" {
		t.Fatalf("NewProfileDirectory = %q, %v; want Launcher-11223344", got, err)
	}
	want := []string{filepath.Join(userDataDir, "Launcher-aabbccdd"), filepath.Join(userDataDir, "Launcher-11223344")}
	if len(rec.calls) != 2 || rec.calls[0] != want[0] || rec.calls[1] != want[1] {
		t.Fatalf("exists recibio %q, want %q", rec.calls, want)
	}
}

func TestNewProfileDirectorySkipsDeleted(t *testing.T) {
	for _, deleted := range []string{`"Launcher-aabbccdd"`, `"/x/y/Launcher-aabbccdd"`, `"LAUNCHER-AABBCCDD"`} {
		ls := localState(t, `{"profiles":{"profile_basenames_deleted":[`+deleted+`]}}`)
		r := bytes.NewReader([]byte{0xaa, 0xbb, 0xcc, 0xdd, 0x11, 0x22, 0x33, 0x44})
		got, err := launch.NewProfileDirectory(r, ls, userDataDir, noneExists)
		if err != nil || got != "Launcher-11223344" {
			t.Errorf("deleted %s: NewProfileDirectory = %q, %v; want Launcher-11223344", deleted, got, err)
		}
	}
}

func TestNewProfileDirectoryIgnoresCaseInLocalState(t *testing.T) {
	ls := localState(t, `{"profile":{"info_cache":{"LAUNCHER-AABBCCDD":{"name":"x"}}}}`)
	r := bytes.NewReader([]byte{0xaa, 0xbb, 0xcc, 0xdd, 0x11, 0x22, 0x33, 0x44})
	got, err := launch.NewProfileDirectory(r, ls, userDataDir, noneExists)
	if err != nil || got != "Launcher-11223344" {
		t.Fatalf("NewProfileDirectory = %q, %v; want Launcher-11223344", got, err)
	}
}

func TestNewProfileDirectoryLowercaseHex(t *testing.T) {
	r := bytes.NewReader([]byte{0xab, 0xcd, 0xef, 0x01})
	got, err := launch.NewProfileDirectory(r, testdataLocalState(t), userDataDir, noneExists)
	if err != nil || got != "Launcher-abcdef01" || !candidateFormat.MatchString(got) {
		t.Fatalf("NewProfileDirectory = %q, %v", got, err)
	}
}

// collisions devuelve n candidatos distintos (4 bytes cada uno) y cuenta cuantos se leyeron.
func collisions(n int) []byte {
	b := make([]byte, 0, 4*n)
	for i := 0; i < n; i++ {
		b = append(b, 0x10, 0x20, 0x30, byte(i))
	}
	return b
}

func TestNewProfileDirectoryGivesUpAfter16Attempts(t *testing.T) {
	// 16 colisiones seguidas con carpetas que existen en disco.
	r := bytes.NewReader(collisions(32))
	calls := 0
	exists := func(string) bool { calls++; return true }
	got, err := launch.NewProfileDirectory(r, testdataLocalState(t), userDataDir, exists)
	if err == nil || got != "" {
		t.Fatalf("NewProfileDirectory = %q, %v; want error", got, err)
	}
	if calls != 16 {
		t.Fatalf("exists se llamo %d veces, want 16", calls)
	}
	if read := 4*32 - r.Len(); read != 4*16 {
		t.Fatalf("se leyeron %d bytes, want 64", read)
	}
	if strings.Contains(err.Error(), userDataDir) || strings.Contains(err.Error(), "Launcher-") {
		t.Fatalf("el error lleva datos: %v", err)
	}
}

func TestNewProfileDirectoryGivesUpAfter16TakenInLocalState(t *testing.T) {
	// 16 colisiones seguidas con perfiles de Local State (los candidatos tomados tambien cuentan como intento).
	var sb strings.Builder
	sb.WriteString(`{"profile":{"info_cache":{`)
	for i := 0; i < 16; i++ {
		if i != 0 {
			sb.WriteString(",")
		}
		fmt.Fprintf(&sb, `"Launcher-102030%02x":{"name":"x"}`, i)
	}
	sb.WriteString(`}}}`)
	r := bytes.NewReader(collisions(32))
	calls := 0
	exists := func(string) bool { calls++; return false }
	got, err := launch.NewProfileDirectory(r, localState(t, sb.String()), userDataDir, exists)
	if err == nil || got != "" {
		t.Fatalf("NewProfileDirectory = %q, %v; want error", got, err)
	}
	if calls != 0 {
		t.Fatalf("exists se llamo %d veces para candidatos ya tomados", calls)
	}
	if read := 4*32 - r.Len(); read != 4*16 {
		t.Fatalf("se leyeron %d bytes, want 64", read)
	}
}

func TestNewProfileDirectorySucceedsOnThe16thAttempt(t *testing.T) {
	r := bytes.NewReader(collisions(16))
	calls := 0
	exists := func(string) bool {
		calls++
		return calls < 16 // las 15 primeras existen; la 16 esta libre
	}
	got, err := launch.NewProfileDirectory(r, testdataLocalState(t), userDataDir, exists)
	if err != nil || got != "Launcher-1020300f" {
		t.Fatalf("NewProfileDirectory = %q, %v; want Launcher-1020300f", got, err)
	}
	if calls != 16 {
		t.Fatalf("exists se llamo %d veces, want 16", calls)
	}
}

func TestNewProfileDirectoryReaderFailures(t *testing.T) {
	boom := errors.New("sin aleatoriedad")
	cases := []struct {
		name string
		r    io.Reader
	}{
		{"lector que falla", iotest.ErrReader(boom)},
		{"lector vacio", bytes.NewReader(nil)},
		{"lector corto", bytes.NewReader([]byte{1, 2, 3})},
		{"falla tras un candidato tomado", io.MultiReader(bytes.NewReader([]byte{0x1a, 0x2b, 0x3c, 0x4d}), iotest.ErrReader(boom))},
		{"se acaba tras un candidato tomado", bytes.NewReader([]byte{0x1a, 0x2b, 0x3c, 0x4d})},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := launch.NewProfileDirectory(tc.r, testdataLocalState(t), userDataDir, noneExists)
			if err == nil || got != "" {
				t.Fatalf("NewProfileDirectory = %q, %v; want error", got, err)
			}
		})
	}
}

func TestNewProfileDirectoryNeedsItsDependencies(t *testing.T) {
	r := func() io.Reader { return bytes.NewReader(collisions(1)) }
	if got, err := launch.NewProfileDirectory(r(), nil, userDataDir, noneExists); err == nil {
		t.Fatalf("sin Local State: %q, want error", got)
	}
	if got, err := launch.NewProfileDirectory(r(), testdataLocalState(t), userDataDir, nil); err == nil {
		t.Fatalf("sin exists: %q, want error", got)
	}
	if got, err := launch.NewProfileDirectory(nil, testdataLocalState(t), userDataDir, noneExists); err == nil {
		t.Fatalf("sin lector: %q, want error", got)
	}
}

func TestNewProfileDirectoryResultIsAlwaysValid(t *testing.T) {
	// Con bytes cualesquiera el resultado siempre cumple el formato.
	var buf [64]byte
	for i := range buf {
		buf[i] = byte(i*37 + 11)
	}
	r := bytes.NewReader(buf[:])
	for i := 0; i < 16; i++ {
		got, err := launch.NewProfileDirectory(r, testdataLocalState(t), userDataDir, noneExists)
		if err != nil || !candidateFormat.MatchString(got) {
			t.Fatalf("intento %d: %q, %v", i, got, err)
		}
	}
}

func TestPathExists(t *testing.T) {
	dir := t.TempDir()
	file := filepath.Join(dir, "archivo")
	if err := os.WriteFile(file, []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(dir, "enlace-roto")
	if err := os.Symlink(filepath.Join(dir, "no-existe"), link); err != nil {
		t.Fatal(err)
	}

	cases := []struct {
		name string
		path string
		want bool
	}{
		{"archivo", file, true},
		{"carpeta", dir, true},
		{"no existe", filepath.Join(dir, "no-existe"), false},
		{"enlace roto: Lstat ve el enlace", link, true},
		{"bajo un archivo (ENOTDIR): falla cerrado", filepath.Join(file, "hijo"), true},
	}
	for _, tc := range cases {
		if got := launch.PathExists(tc.path); got != tc.want {
			t.Errorf("%s: PathExists = %v, want %v", tc.name, got, tc.want)
		}
	}
}

func TestPathExistsFailsClosedOnPermissionError(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("root salta los permisos")
	}
	dir := t.TempDir()
	locked := filepath.Join(dir, "cerrada")
	if err := os.Mkdir(locked, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(locked, 0); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(locked, 0o700) })
	// Dentro de una carpeta sin permisos Lstat da EACCES, no ENOENT: no se puede afirmar que no exista.
	if !launch.PathExists(filepath.Join(locked, "Launcher-aabbccdd")) {
		t.Fatal("PathExists con EACCES = false, want true (falla cerrado)")
	}
}
