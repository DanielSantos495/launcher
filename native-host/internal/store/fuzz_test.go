package store_test

import (
	"bytes"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"github.com/DanielSantos495/launcher/native-host/internal/store"
)

// FuzzLoad: Load nunca entra en panico; si acepta un archivo, el estado cumple Validate, y Save + Load lo devuelve
// igual (DeepEqual) y con los mismos bytes si se guarda otra vez.
func FuzzLoad(f *testing.F) {
	// Las semillas son estados guardados por el propio almacen, para que lleven la forma exacta que escribe Save.
	seedDir := f.TempDir()
	seedStore, err := store.Open(seedDir, time.Second)
	if err != nil {
		f.Fatal(err)
	}
	twoInstallations := store.NewState()
	twoInstallations.Paired = []store.Installation{
		{InstallationID: "a", TokenHash: hash64("a"), PairedAt: ts1},
		{InstallationID: "b", TokenHash: hash64("b"), IdentityID: "id", ProfileDirectory: "Default", PairedAt: ts1, VerifiedAt: ts2},
	}
	for _, st := range []*store.State{store.NewState(), twoInstallations, validState()} {
		if err := seedStore.Save(st); err != nil {
			f.Fatal(err)
		}
		b, err := os.ReadFile(filepath.Join(seedDir, store.FileName))
		if err != nil {
			f.Fatal(err)
		}
		f.Add(b)
	}
	if err := seedStore.Close(); err != nil {
		f.Fatal(err)
	}
	f.Add([]byte(`{}`))
	f.Add([]byte(`null`))
	f.Add([]byte(`{"format":1,"revision":3,"bindings": { "a": 1 },"maxPairedProfiles":2,"paired":null,"pendingProofs":null}` + "\n"))

	dir := f.TempDir()
	s, err := store.Open(dir, time.Second)
	if err != nil {
		f.Fatal(err)
	}
	f.Cleanup(func() { _ = s.Close() })
	path := filepath.Join(dir, store.FileName)

	f.Fuzz(func(t *testing.T, content []byte) {
		if err := os.WriteFile(path, content, 0o600); err != nil {
			t.Fatal(err)
		}
		st, err := s.Load()
		if err != nil {
			if st != nil {
				t.Fatal("con error Load no debe devolver estado")
			}
			return
		}
		if st == nil {
			t.Fatal("Load devolvio (nil, nil) con un archivo presente")
		}
		if err := st.Validate(); err != nil {
			t.Fatalf("Load devolvio un estado invalido: %v", err)
		}
		if err := s.Save(st); err != nil {
			t.Fatalf("Save de un estado cargado: %v", err)
		}
		first, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		if len(first) > store.MaxFileBytes {
			t.Fatalf("Save escribio %d bytes, mas que MaxFileBytes", len(first))
		}
		back, err := s.Load()
		if err != nil {
			t.Fatalf("Load de lo que escribio Save: %v", err)
		}
		if !reflect.DeepEqual(back, st) {
			t.Fatalf("ida y vuelta distinta:\n%+v\n%+v", back, st)
		}
		if err := s.Save(back); err != nil {
			t.Fatal(err)
		}
		second, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		if !bytes.Equal(first, second) {
			t.Fatalf("Save no es estable:\n%s\n%s", first, second)
		}
	})
}
