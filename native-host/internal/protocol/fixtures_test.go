package protocol_test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"testing"

	"github.com/DanielSantos495/launcher/native-host/internal/protocol"
)

// fixturePath devuelve la ruta de un archivo del contrato (packages/protocol/fixtures).
func fixturePath(name string) string {
	return filepath.Join("..", "..", "..", "packages", "protocol", "fixtures", name)
}

// requestCase es un caso de host-requests.json. El archivo de fixtures es de confianza (lo escribe el proyecto), asi
// que se decodifica a un struct; Request conserva los bytes del archivo tal cual.
type requestCase struct {
	Name    string          `json:"name"`
	Valid   bool            `json:"valid"`
	Error   string          `json:"error"`
	Request json.RawMessage `json:"request"`
}

func loadRequestCases(tb testing.TB) []requestCase {
	tb.Helper()
	raw, err := os.ReadFile(fixturePath("host-requests.json"))
	if err != nil {
		tb.Fatalf("no se puede leer el contrato (host-requests.json): %v", err)
	}
	var cases []requestCase
	if err := json.Unmarshal(raw, &cases); err != nil {
		tb.Fatalf("host-requests.json no es valido: %v", err)
	}
	return cases
}

// TestFixtures: el host pasa todos los casos del contrato con el codigo exacto.
func TestFixtures(t *testing.T) {
	cases := loadRequestCases(t)
	if len(cases) < 108 {
		t.Fatalf("host-requests.json tiene %d casos, want >= 108", len(cases))
	}

	validByCmd := map[string]bool{}
	for _, c := range cases {
		if !c.Valid && !slices.Contains(protocol.AllCodes, protocol.Code(c.Error)) {
			t.Errorf("%q: el codigo %q no esta en AllCodes", c.Name, c.Error)
		}
		t.Run(c.Name, func(t *testing.T) {
			req, err := protocol.Validate(c.Request)
			if c.Valid {
				if err != nil {
					t.Fatalf("debia ser valida, got error %q", err.Code)
				}
				validByCmd[req.Cmd] = true
				var env struct {
					Cmd string `json:"cmd"`
				}
				if jerr := json.Unmarshal(c.Request, &env); jerr != nil || env.Cmd != req.Cmd {
					t.Fatalf("Cmd = %q, la peticion dice %q", req.Cmd, env.Cmd)
				}
				return
			}
			if err == nil {
				t.Fatalf("debia fallar con %q, pero es valida", c.Error)
			}
			if err.Code != protocol.Code(c.Error) {
				t.Fatalf("got %q, want %q", err.Code, c.Error)
			}
		})
	}

	for _, cmd := range protocol.Commands {
		if !validByCmd[cmd] {
			t.Errorf("el comando %q no tiene ningun caso valido en los fixtures", cmd)
		}
	}
}
