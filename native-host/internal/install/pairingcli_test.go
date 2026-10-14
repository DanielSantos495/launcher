package install

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/DanielSantos495/launcher/native-host/internal/protocol"
	"github.com/DanielSantos495/launcher/native-host/internal/store"
)

// writeFullStore guarda un almacén con datos, vínculos, dos instalaciones, un código y una prueba pendiente.
func writeFullStore(t *testing.T, app string) {
	t.Helper()
	st := store.NewState()
	if _, perr := st.Put(0, []byte(`{"schemaVersion":1,"revision":4}`), []byte(`{"k":{"x":1}}`)); perr != nil {
		t.Fatal(perr)
	}
	st.Paired = []store.Installation{
		{InstallationID: "inst-a", TokenHash: strings.Repeat("a", 64), ProfileDirectory: "Default", PairedAt: "2026-10-08T12:00:00.000Z"},
		{InstallationID: "inst-b", TokenHash: strings.Repeat("b", 64), PairedAt: "2026-10-08T12:00:00.000Z"},
	}
	st.PairCode = &store.PairCode{CodeHash: strings.Repeat("c", 64), ExpiresAt: "2099-01-01T00:00:00.000Z"}
	st.PendingProofs = []store.Proof{{
		NonceHash: strings.Repeat("d", 64), InstallationID: "inst-a", ProfileDirectory: "Default", ExpiresAt: "2099-01-01T00:00:00.000Z",
	}}
	s, err := store.Open(app, time.Second)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if err := s.Save(st); err != nil {
		t.Fatal(err)
	}
}

func mustLoadState(t *testing.T, app string) *store.State {
	t.Helper()
	s, err := store.Open(app, time.Second)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	st, err := s.Load()
	if err != nil || st == nil {
		t.Fatalf("no se pudo cargar el almacén: %v", err)
	}
	return st
}

func TestPairingReset(t *testing.T) {
	f := newFixture(t, "brave")
	app := f.app("brave")
	if err := os.MkdirAll(app, 0o700); err != nil {
		t.Fatal(err)
	}
	writeFullStore(t, app)
	before := mustLoadState(t, app)

	if err := Pairing(f.opts("brave"), true, 0); err != nil {
		t.Fatal(err)
	}
	after := mustLoadState(t, app)
	if len(after.Paired) != 0 || after.PairCode != nil || len(after.PendingProofs) != 0 {
		t.Fatalf("reset dejó emparejamientos: %+v", after)
	}
	// Se conserva todo lo demás (Review Focus 3).
	if after.Revision != before.Revision || string(after.Data) != string(before.Data) ||
		string(after.Bindings) != string(before.Bindings) || after.MaxPairedProfiles != before.MaxPairedProfiles {
		t.Fatalf("reset tocó los datos: antes %+v, después %+v", before, after)
	}
	if after.Revision != 1 || string(after.Data) != `{"schemaVersion":1,"revision":4}` {
		t.Fatalf("estado inesperado tras reset: %+v", after)
	}
}

func TestPairingMax(t *testing.T) {
	f := newFixture(t, "brave")
	app := f.app("brave")
	if err := os.MkdirAll(app, 0o700); err != nil {
		t.Fatal(err)
	}
	writeFullStore(t, app)
	for _, n := range []int{3, 1, protocol.MaxPairedProfilesLimit} {
		if err := Pairing(f.opts("brave"), false, n); err != nil {
			t.Fatalf("--max %d: %v", n, err)
		}
		st := mustLoadState(t, app)
		if st.MaxPairedProfiles != n || len(st.Paired) != 2 {
			t.Fatalf("--max %d: MaxPairedProfiles = %d, instalaciones = %d", n, st.MaxPairedProfiles, len(st.Paired))
		}
	}
	// --reset y --max juntos.
	if err := Pairing(f.opts("brave"), true, 4); err != nil {
		t.Fatal(err)
	}
	if st := mustLoadState(t, app); st.MaxPairedProfiles != 4 || len(st.Paired) != 0 {
		t.Fatalf("reset + max: %+v", st)
	}
}

func TestPairingUsageErrors(t *testing.T) {
	f := newFixture(t, "brave")
	app := f.app("brave")
	if err := os.MkdirAll(app, 0o700); err != nil {
		t.Fatal(err)
	}
	writeFullStore(t, app)
	before := mustLoadState(t, app)
	for _, tc := range []struct {
		name    string
		names   []string
		reset   bool
		max     int
		wantUse bool
	}{
		{"sin reset ni max", []string{"brave"}, false, 0, true},
		{"max 17", []string{"brave"}, false, 17, true},
		{"max negativo", []string{"brave"}, false, -1, true},
		{"sin navegador", nil, true, 0, true},
		{"dos navegadores", []string{"brave", "chrome"}, true, 0, true},
		{"navegador desconocido", []string{"opera"}, true, 0, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			err := Pairing(f.opts(tc.names...), tc.reset, tc.max)
			if err == nil || errors.Is(err, ErrUsage) != tc.wantUse {
				t.Fatalf("Pairing = %v; quiero un error de uso = %v", err, tc.wantUse)
			}
		})
	}
	after := mustLoadState(t, app)
	if len(after.Paired) != len(before.Paired) || after.MaxPairedProfiles != before.MaxPairedProfiles {
		t.Fatal("un error de uso cambió el almacén")
	}
}

func TestPairingWithoutStore(t *testing.T) {
	f := newFixture(t, "brave")
	for _, tc := range []struct {
		reset bool
		max   int
	}{{true, 0}, {false, 3}} {
		err := Pairing(f.opts("brave"), tc.reset, tc.max)
		if err == nil || errors.Is(err, ErrUsage) || !strings.Contains(err.Error(), "almacén") {
			t.Fatalf("Pairing sin almacén = %v; quiero un error claro sobre el almacén", err)
		}
	}
	// No crea nada.
	assertEmpty(t, f.home)
	if exists(filepath.Join(f.app("brave"), "shared.json")) {
		t.Fatal("Pairing creó shared.json")
	}
}

func TestPairingCorruptStore(t *testing.T) {
	f := newFixture(t, "brave")
	app := f.app("brave")
	if err := os.MkdirAll(app, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(app, "shared.json"), []byte("{"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := Pairing(f.opts("brave"), true, 0); err == nil {
		t.Fatal("Pairing con shared.json corrupto debe fallar")
	}
	if got := readFile(t, filepath.Join(app, "shared.json")); string(got) != "{" {
		t.Fatalf("Pairing tocó un shared.json corrupto: %s", got)
	}
}
