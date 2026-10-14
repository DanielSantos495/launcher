package host

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/DanielSantos495/launcher/native-host/internal/protocol"
	"github.com/DanielSantos495/launcher/native-host/internal/store"
)

// firstPairing empareja id como primera instalación (pair.start sin token) y devuelve su token y el código.
func (te *testEnv) firstPairing(id string) (token, code string) {
	te.t.Helper()
	res := result(te.t, te.do("pair.start", `{"installationId":"`+id+`"}`))
	return str(te.t, res, "token"), str(te.t, res, "code")
}

func tokenArgs(token string) string { return `{"token":"` + token + `"}` }

func putArgs(token string, base int, data, bindings string) string {
	return fmt.Sprintf(`{"token":%q,"baseRevision":%d,"data":%s,"bindings":%s}`, token, base, data, bindings)
}

const minimalData = `{"schemaVersion":1,"revision":0}`

func TestSyncGetWithoutStoreIsNotPaired(t *testing.T) {
	te := newEnv(t, "brave", "155.1.97.56")
	if got := te.do("sync.get", tokenArgs(unknownToken)); got != errBody("not_paired") {
		t.Fatalf("sync.get = %s, quiero not_paired", got)
	}
	// Preguntar no crea el almacén.
	if _, err := os.Stat(filepath.Join(te.dataDir, store.FileName)); !os.IsNotExist(err) {
		t.Fatalf("sync.get no debe crear shared.json (err = %v)", err)
	}
}

func TestSyncEmptyStore(t *testing.T) {
	te := newEnv(t, "brave", "155.1.97.56")
	token, _ := te.firstPairing("inst-a")
	const want = `{"ok":true,"result":{"revision":0,"data":null,"bindings":{}}}`
	if got := te.do("sync.get", tokenArgs(token)); got != want {
		t.Fatalf("sync.get = %s, quiero %s", got, want)
	}
}

func TestSyncPutGetConflict(t *testing.T) {
	te := newEnv(t, "brave", "155.1.97.56")
	token, _ := te.firstPairing("inst-a")

	data := `{"schemaVersion":1, "revision":0, "a":[1, 2]}`
	bindings := `{"k": {"x":1}}`
	if got := te.do("sync.put", putArgs(token, 0, data, bindings)); got != `{"ok":true,"result":{"revision":1}}` {
		t.Fatalf("sync.put = %s", got)
	}
	// data y bindings vuelven tal como se guardaron: compactados, byte a byte.
	const want = `{"ok":true,"result":{"revision":1,"data":{"schemaVersion":1,"revision":0,"a":[1,2]},"bindings":{"k":{"x":1}}}}`
	if got := te.do("sync.get", tokenArgs(token)); got != want {
		t.Fatalf("sync.get = %s\nquiero   %s", got, want)
	}
	// La misma base otra vez: conflict con la revisión actual.
	const conflict = `{"ok":false,"error":{"code":"conflict","revision":1}}`
	if got := te.do("sync.put", putArgs(token, 0, minimalData, `{}`)); got != conflict {
		t.Fatalf("sync.put = %s, quiero %s", got, conflict)
	}
	// El conflicto no cambió nada.
	if got := te.do("sync.get", tokenArgs(token)); got != want {
		t.Fatalf("tras el conflicto, sync.get = %s", got)
	}
	if got := te.do("sync.put", putArgs(token, 1, minimalData, `{}`)); got != `{"ok":true,"result":{"revision":2}}` {
		t.Fatalf("sync.put base 1 = %s", got)
	}
}

func TestSyncUnknownTokenIsNotPaired(t *testing.T) {
	te := newEnv(t, "brave", "155.1.97.56")
	token, _ := te.firstPairing("inst-a")
	if got := te.do("sync.put", putArgs(token, 0, minimalData, `{"a":1}`)); got != `{"ok":true,"result":{"revision":1}}` {
		t.Fatalf("sync.put = %s", got)
	}
	if got := te.do("sync.get", tokenArgs(unknownToken)); got != errBody("not_paired") {
		t.Fatalf("sync.get = %s, quiero not_paired", got)
	}
	// Con un token desconocido se comprueba la identidad ANTES que la revisión: ni conflict (que revelaría la
	// revisión actual) ni cambios en el almacén, con una base vieja o con la buena.
	for _, base := range []int{0, 1} {
		if got := te.do("sync.put", putArgs(unknownToken, base, minimalData, `{"b":2}`)); got != errBody("not_paired") {
			t.Fatalf("sync.put base %d = %s, quiero not_paired", base, got)
		}
	}
	const want = `{"ok":true,"result":{"revision":1,"data":{"schemaVersion":1,"revision":0},"bindings":{"a":1}}}`
	if got := te.do("sync.get", tokenArgs(token)); got != want {
		t.Fatalf("el almacén cambió: %s", got)
	}
}

// object arma {"schemaVersion":1,"revision":0,"x":"<fill * n>"} de exactamente total bytes (con fill de 1 byte).
func bigData(total int, fill string) string {
	const prefix = `{"schemaVersion":1,"revision":0,"x":"`
	return prefix + strings.Repeat(fill, (total-len(prefix)-2)/len(fill)) + `"}`
}

func TestSyncAcceptsMaximumWithHTMLCharacters(t *testing.T) {
	// ADR-004: 512 KiB de "<" en data y 128 KiB en bindings se guardan y se devuelven sin escapar (json.Marshal los
	// escribiría como seis bytes cada uno y la respuesta superaría el máximo).
	te := newEnv(t, "brave", "155.1.97.56")
	token, _ := te.firstPairing("inst-a")
	data := bigData(protocol.MaxSharedDataBytes, "<")
	bindings := `{"k":"` + strings.Repeat("<", protocol.MaxSharedBindingsBytes-8) + `"}`
	if len(data) != protocol.MaxSharedDataBytes || len(bindings) != protocol.MaxSharedBindingsBytes {
		t.Fatalf("la prueba arma %d y %d bytes", len(data), len(bindings))
	}
	if got := te.do("sync.put", putArgs(token, 0, data, bindings)); got != `{"ok":true,"result":{"revision":1}}` {
		t.Fatalf("sync.put = %.200s", got)
	}
	body := te.do("sync.get", tokenArgs(token))
	if len(body) >= protocol.MaxResponseBytes {
		t.Fatalf("sync.get mide %d bytes, quiero menos de %d", len(body), protocol.MaxResponseBytes)
	}
	if strings.Contains(body, `\`+`u003c`) || !strings.Contains(body, strings.Repeat("<", 1000)) {
		t.Fatalf("sync.get debe llevar los < literales")
	}
	res := result(t, body)
	if string(res["data"]) != data || string(res["bindings"]) != bindings {
		t.Fatalf("data o bindings no vuelven tal como se guardaron")
	}
}

func TestSyncGetOverResponseLimitIsInternal(t *testing.T) {
	// Unos 524 280 bytes casi todo U+2028 se guardan (el escape no cabe en la entrada pero sí en el almacén) y al
	// devolverlos se duplican por encima del máximo de la respuesta: internal.
	te := newEnv(t, "brave", "155.1.97.56")
	token, _ := te.firstPairing("inst-a")
	data := bigData(protocol.MaxSharedDataBytes, string(rune(0x2028)))
	if len(data) < 524_000 || len(data) > protocol.MaxSharedDataBytes {
		t.Fatalf("la prueba arma %d bytes", len(data))
	}
	if got := te.do("sync.put", putArgs(token, 0, data, `{}`)); got != `{"ok":true,"result":{"revision":1}}` {
		t.Fatalf("sync.put = %.200s", got)
	}
	if got := te.do("sync.get", tokenArgs(token)); got != errBody("internal") {
		t.Fatalf("sync.get = %.200s, quiero internal", got)
	}
}

func TestSyncGetResultBindingsAreNeverNil(t *testing.T) {
	// Un RawMessage nil se escribe null y la extensión rechaza bindings null: siempre al menos {}.
	res := syncGetResult(&store.State{Revision: 7})
	if got := string(protocol.Encode(protocol.OK(res))); got != `{"ok":true,"result":{"revision":7,"data":null,"bindings":{}}}` {
		t.Fatalf("got %s", got)
	}
	res = syncGetResult(&store.State{Revision: 7, Data: json.RawMessage(`{"a":1}`), Bindings: json.RawMessage(`{"b":2}`)})
	if got := string(protocol.Encode(protocol.OK(res))); got != `{"ok":true,"result":{"revision":7,"data":{"a":1},"bindings":{"b":2}}}` {
		t.Fatalf("got %s", got)
	}
}

func TestStoreFailuresAreInternal(t *testing.T) {
	t.Run("shared.json corrupto", func(t *testing.T) {
		te := newEnv(t, "brave", "155.1.97.56")
		token, _ := te.firstPairing("inst-a")
		if err := os.WriteFile(filepath.Join(te.dataDir, store.FileName), []byte(`{`), 0o600); err != nil {
			t.Fatal(err)
		}
		for _, cmd := range []string{"sync.get", "pair.list", "icons.delete"} {
			args := tokenArgs(token)
			if cmd == "icons.delete" {
				args = `{"token":"` + token + `","key":"icon:a"}`
			}
			if got := te.do(cmd, args); got != errBody("internal") {
				t.Fatalf("%s = %s, quiero internal", cmd, got)
			}
		}
	})
	t.Run("la carpeta de datos no existe", func(t *testing.T) {
		te := newEnv(t, "brave", "155.1.97.56")
		te.env.DataDir = filepath.Join(te.dataDir, "no-existe")
		if got := te.do("sync.get", tokenArgs(unknownToken)); got != errBody("internal") {
			t.Fatalf("got %s", got)
		}
	})
	t.Run("almacén bloqueado por otro proceso", func(t *testing.T) {
		te := newEnv(t, "brave", "155.1.97.56")
		te.firstPairing("inst-a")
		te.env.LockTimeout = 50 * time.Millisecond
		held, err := store.Open(te.dataDir, 0)
		if err != nil {
			t.Fatal(err)
		}
		defer held.Close()
		if got := te.do("sync.get", tokenArgs(unknownToken)); got != errBody("internal") {
			t.Fatalf("got %s", got)
		}
	})
	t.Run("no se puede guardar", func(t *testing.T) {
		te := newEnv(t, "brave", "155.1.97.56")
		if os.Geteuid() == 0 {
			t.Skip("root escribe igualmente")
		}
		token, _ := te.firstPairing("inst-a")
		// El almacén se carga bien, pero la carpeta deja de admitir ficheros nuevos: el temporal de Save falla.
		if err := os.Chmod(te.dataDir, 0o500); err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = os.Chmod(te.dataDir, 0o700) })
		if got := te.do("sync.put", putArgs(token, 0, minimalData, `{}`)); got != errBody("internal") {
			t.Fatalf("got %s", got)
		}
	})
}
