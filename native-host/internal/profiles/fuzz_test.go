package profiles_test

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/DanielSantos495/launcher/native-host/internal/profiles"
	"github.com/DanielSantos495/launcher/native-host/internal/protocol"
)

// FuzzParseLocalState: con cualquier entrada no hay pánico y todo lo que sale cumple el contrato de ProfileInfo.
func FuzzParseLocalState(f *testing.F) {
	seed, err := os.ReadFile(filepath.Join(testdata, "Local State"))
	if err != nil {
		f.Fatal(err)
	}
	f.Add(seed)
	f.Add([]byte(`{}`))
	f.Add([]byte(`{"profile":{"info_cache":{"A":{"name":"x","profile_highlight_color":-1}}},"profiles":{"profile_basenames_deleted":["A"]}}`))
	f.Add([]byte(`{"profile":5}`))
	f.Fuzz(func(t *testing.T, b []byte) {
		ls, err := profiles.ParseLocalState(b)
		if err != nil {
			if ls != nil {
				t.Fatal("error con LocalState no nil")
			}
			return
		}
		list := ls.List()
		if list == nil || len(list) > protocol.MaxProfiles {
			t.Fatalf("List() = %d perfiles (nil: %v)", len(list), list == nil)
		}
		prev := ""
		for i, p := range list {
			if !protocol.ValidProfileDirectory(p.Directory) || protocol.UTF16Len(p.Name) > protocol.MaxProfileName ||
				(p.Color != "" && !protocol.ValidColor(p.Color)) {
				t.Fatalf("perfil fuera del contrato: %+v", p)
			}
			if i > 0 && p.Directory <= prev {
				t.Fatalf("lista sin ordenar o con repetidos: %q tras %q", p.Directory, prev)
			}
			prev = p.Directory
			if !ls.Known(p.Directory) || !ls.Taken(p.Directory) {
				t.Fatalf("%q esta en la lista pero no es Known/Taken", p.Directory)
			}
		}
	})
}

// FuzzParseContainers: nunca entra en pánico; sin error devuelve siempre un slice no nil.
func FuzzParseContainers(f *testing.F) {
	seed, err := os.ReadFile(filepath.Join(testdata, "Default", "Preferences"))
	if err != nil {
		f.Fatal(err)
	}
	f.Add(seed)
	f.Add([]byte(`{}`))
	f.Add([]byte(`{"brave":{"containers":{"list":{}}}}`))
	f.Fuzz(func(t *testing.T, b []byte) {
		names, err := profiles.ParseContainers(b)
		if err == nil && names == nil {
			t.Fatal("sin error debe devolver un slice no nil")
		}
		if err != nil && names != nil {
			t.Fatal("con error debe devolver nil")
		}
	})
}

// FuzzParseLastVersion: lo aceptado cumple ^[0-9]+(\.[0-9]+){1,3}$ y cabe en 32 caracteres.
func FuzzParseLastVersion(f *testing.F) {
	f.Add("155.1.97.56\n")
	f.Add("1.2")
	f.Add("")
	f.Fuzz(func(t *testing.T, s string) {
		v, ok := profiles.ParseLastVersion(s)
		if !ok {
			if v != "" {
				t.Fatalf("v = %q con ok=false", v)
			}
			return
		}
		if len(v) == 0 || len(v) > 32 || v[0] == '.' || v[len(v)-1] == '.' {
			t.Fatalf("version aceptada fuera de la forma: %q", v)
		}
		dots := 0
		for i := 0; i < len(v); i++ {
			switch c := v[i]; {
			case c == '.':
				dots++
				if v[i-1] == '.' {
					t.Fatalf("version con '..': %q", v)
				}
			case c < '0' || c > '9':
				t.Fatalf("version con caracter no valido: %q", v)
			}
		}
		if dots < 1 || dots > 3 {
			t.Fatalf("version con %d puntos: %q", dots, v)
		}
	})
}
