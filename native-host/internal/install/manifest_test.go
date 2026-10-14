package install

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"
)

// testID cumple ^[a-p]{32}$.
const testID = "abcdefghijklmnopabcdefghijklmnop"

func TestManifestValue(t *testing.T) {
	b, err := Manifest("brave", "/abs/launcher-host", testID)
	if err != nil {
		t.Fatal(err)
	}
	var got any
	if err := json.Unmarshal(b, &got); err != nil {
		t.Fatal(err)
	}
	want := map[string]any{
		"name":            "com.curyapps.launcher.brave",
		"description":     "Account Launcher native host",
		"path":            "/abs/launcher-host",
		"type":            "stdio",
		"allowed_origins": []any{"chrome-extension://" + testID + "/"},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("manifest = %s", b)
	}
}

func TestManifestExactBytes(t *testing.T) {
	// Instalar dos veces tiene que dar los mismos bytes: el orden de las claves y la sangría son fijos.
	b, err := Manifest("edge", "/abs/launcher-host", testID)
	if err != nil {
		t.Fatal(err)
	}
	want := "{\n" +
		"  \"name\": \"com.curyapps.launcher.edge\",\n" +
		"  \"description\": \"Account Launcher native host\",\n" +
		"  \"path\": \"/abs/launcher-host\",\n" +
		"  \"type\": \"stdio\",\n" +
		"  \"allowed_origins\": [\n" +
		"    \"chrome-extension://" + testID + "/\"\n" +
		"  ]\n" +
		"}\n"
	if string(b) != want {
		t.Fatalf("manifest = %q\nquiero    %q", b, want)
	}
}

func TestManifestDoesNotEscapeHTML(t *testing.T) {
	b, err := Manifest("brave", "/a&b/launcher-host", testID)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(b), `"/a&b/launcher-host"`) {
		t.Fatalf("manifest = %s", b)
	}
}

func TestManifestRejectsInvalidInput(t *testing.T) {
	for _, tc := range []struct{ name, browser, path, id string }{
		{"ruta relativa", "brave", "launcher-host", testID},
		{"ruta vacía", "brave", "", testID},
		{"ruta con carácter de control", "brave", "/abs/launcher\nhost", testID},
		{"id corto", "brave", "/abs/launcher-host", testID[:31]},
		{"id largo", "brave", "/abs/launcher-host", testID + "a"},
		{"id con mayúsculas", "brave", "/abs/launcher-host", strings.ToUpper(testID)},
		{"id fuera de a-p", "brave", "/abs/launcher-host", strings.Repeat("q", 32)},
		{"id vacío", "brave", "/abs/launcher-host", ""},
		{"navegador desconocido", "opera", "/abs/launcher-host", testID},
		{"navegador vacío", "", "/abs/launcher-host", testID},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if b, err := Manifest(tc.browser, tc.path, tc.id); err == nil || b != nil {
				t.Fatalf("Manifest(%q, %q, %q) = %s, %v; quiero un error", tc.browser, tc.path, tc.id, b, err)
			}
		})
	}
}
