package host

import (
	"encoding/hex"
	"os"
	"path/filepath"
	"testing"

	"github.com/DanielSantos495/launcher/native-host/internal/store"
)

const iconPNG = "iVBORw0KGgo="

func iconArgs(token, key string) string {
	return `{"token":"` + token + `","key":"` + key + `"}`
}

func putIconArgs(token, key, mime, b64 string) string {
	return `{"token":"` + token + `","key":"` + key + `","mime":"` + mime + `","base64":"` + b64 + `"}`
}

func TestIconsRoundTrip(t *testing.T) {
	te := newEnv(t, "brave", "155.1.97.56")
	token, _ := te.firstPairing("inst-a")

	if got := te.do("icons.put", putIconArgs(token, "icon:abc", "image/png", iconPNG)); got != okEmpty {
		t.Fatalf("icons.put = %s", got)
	}
	const want = `{"ok":true,"result":{"key":"icon:abc","mime":"image/png","base64":"` + iconPNG + `"}}`
	if got := te.do("icons.get", iconArgs(token, "icon:abc")); got != want {
		t.Fatalf("icons.get = %s, quiero %s", got, want)
	}
	if got := te.do("icons.get", iconArgs(token, "icon:otra")); got != errBody("not_found") {
		t.Fatalf("icons.get de otra clave = %s, quiero not_found", got)
	}
	// Reemplazar una clave existente.
	if got := te.do("icons.put", putIconArgs(token, "icon:abc", "image/webp", "AAAA")); got != okEmpty {
		t.Fatalf("icons.put (reemplazo) = %s", got)
	}
	const replaced = `{"ok":true,"result":{"key":"icon:abc","mime":"image/webp","base64":"AAAA"}}`
	if got := te.do("icons.get", iconArgs(token, "icon:abc")); got != replaced {
		t.Fatalf("icons.get = %s, quiero %s", got, replaced)
	}
	// delete: {} y, aunque ya no exista, {} otra vez (D13).
	for range 2 {
		if got := te.do("icons.delete", iconArgs(token, "icon:abc")); got != okEmpty {
			t.Fatalf("icons.delete = %s", got)
		}
	}
	if got := te.do("icons.get", iconArgs(token, "icon:abc")); got != errBody("not_found") {
		t.Fatalf("icons.get tras borrar = %s, quiero not_found", got)
	}
}

func TestIconsNeedAValidToken(t *testing.T) {
	te := newEnv(t, "brave", "155.1.97.56")
	// Sin almacén y con un token desconocido (y luego con almacén): not_paired y no se escribe ningún archivo.
	check := func() {
		t.Helper()
		if got := te.do("icons.put", putIconArgs(unknownToken, "icon:abc", "image/png", iconPNG)); got != errBody("not_paired") {
			t.Fatalf("icons.put = %s", got)
		}
		if got := te.do("icons.get", iconArgs(unknownToken, "icon:abc")); got != errBody("not_paired") {
			t.Fatalf("icons.get = %s", got)
		}
		if got := te.do("icons.delete", iconArgs(unknownToken, "icon:abc")); got != errBody("not_paired") {
			t.Fatalf("icons.delete = %s", got)
		}
	}
	check()
	te.firstPairing("inst-a")
	check()
	if _, err := os.Stat(filepath.Join(te.dataDir, store.IconsDir)); !os.IsNotExist(err) {
		t.Fatalf("un token desconocido no debe crear icons/ (err = %v)", err)
	}
}

func TestIconsCorruptFileIsInternal(t *testing.T) {
	te := newEnv(t, "brave", "155.1.97.56")
	token, _ := te.firstPairing("inst-a")
	dir := filepath.Join(te.dataDir, store.IconsDir)
	if err := os.Mkdir(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(dir, hex.EncodeToString([]byte("abc"))+".json")
	if err := os.WriteFile(file, []byte(`{"mime":"image/svg+xml","base64":"AAAA"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if got := te.do("icons.get", iconArgs(token, "icon:abc")); got != errBody("internal") {
		t.Fatalf("icons.get = %s, quiero internal", got)
	}
}
