package protocol_test

import (
	"bytes"
	"encoding/json"
	"os"
	"reflect"
	"slices"
	"strings"
	"testing"

	"github.com/DanielSantos495/launcher/native-host/internal/protocol"
)

// responseCase es un caso de host-responses.json (archivo de confianza del proyecto).
type responseCase struct {
	Name     string          `json:"name"`
	Cmd      string          `json:"cmd"`
	Response json.RawMessage `json:"response"`
}

func loadResponseCases(t *testing.T) []responseCase {
	t.Helper()
	raw, err := os.ReadFile(fixturePath("host-responses.json"))
	if err != nil {
		t.Fatalf("no se puede leer el contrato (host-responses.json): %v", err)
	}
	var cases []responseCase
	if err := json.Unmarshal(raw, &cases); err != nil {
		t.Fatalf("host-responses.json no es valido: %v", err)
	}
	return cases
}

// resultTypes asigna a cada comando el tipo Go de su result.
func resultTypes() map[string]func() any {
	empty := func() any { return new(protocol.Empty) }
	return map[string]func() any{
		"ping":          func() any { return new(protocol.PingResult) },
		"listProfiles":  func() any { return new(protocol.ListProfilesResult) },
		"open":          empty,
		"openTemporary": empty,
		"createProfile": func() any { return new(protocol.CreateProfileResult) },
		"pair.start":    func() any { return new(protocol.PairStartResult) },
		"pair.join":     func() any { return new(protocol.PairJoinResult) },
		"pair.declare":  empty,
		"pair.list":     func() any { return new(protocol.PairListResult) },
		"pair.remove":   empty,
		"pair.verify":   func() any { return new(protocol.PairVerifyResult) },
		"pair.prove":    func() any { return new(protocol.PairProveResult) },
		"sync.get":      func() any { return new(protocol.SyncGetResult) },
		"sync.put":      func() any { return new(protocol.SyncPutResult) },
		"icons.get":     func() any { return new(protocol.IconsGetResult) },
		"icons.put":     empty,
		"icons.delete":  empty,
	}
}

// asValue decodifica JSON a any para comparar valores (el orden de las claves y los espacios no importan).
func asValue(t *testing.T, b []byte) any {
	t.Helper()
	var v any
	if err := json.Unmarshal(b, &v); err != nil {
		t.Fatalf("no es JSON valido: %v\n%s", err, b)
	}
	return v
}

func decodeStrict(t *testing.T, raw []byte, into any) {
	t.Helper()
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(into); err != nil {
		t.Fatalf("no cabe en el tipo %T: %v", into, err)
	}
}

// TestResultTypesCoverCommands: la tabla de tipos tiene exactamente las claves de Commands.
func TestResultTypesCoverCommands(t *testing.T) {
	types := resultTypes()
	if len(types) != len(protocol.Commands) {
		t.Fatalf("la tabla tiene %d tipos, Commands tiene %d", len(types), len(protocol.Commands))
	}
	for _, cmd := range protocol.Commands {
		if types[cmd] == nil {
			t.Errorf("falta el tipo del comando %q", cmd)
		}
	}
}

// TestResponseFixtures: lo que el host escribe tiene exactamente la forma de las respuestas del contrato. Una
// etiqueta mal escrita (por ejemplo installationID) falla porque la salida deja de coincidir con el fixture.
func TestResponseFixtures(t *testing.T) {
	cases := loadResponseCases(t)
	types := resultTypes()
	okByCmd := map[string]bool{}
	for _, c := range cases {
		t.Run(c.Name, func(t *testing.T) {
			var env struct {
				OK     bool            `json:"ok"`
				Result json.RawMessage `json:"result"`
				Error  *struct {
					Code     string `json:"code"`
					Revision *int64 `json:"revision"`
				} `json:"error"`
			}
			if err := json.Unmarshal(c.Response, &env); err != nil {
				t.Fatalf("respuesta ilegible: %v", err)
			}

			var got []byte
			if env.OK {
				newType, found := types[c.Cmd]
				if !found {
					t.Fatalf("comando %q sin tipo", c.Cmd)
				}
				result := newType()
				decodeStrict(t, env.Result, result)
				got = protocol.Encode(protocol.OK(result))
				okByCmd[c.Cmd] = true
			} else {
				if env.Error == nil {
					t.Fatal("respuesta de error sin error")
				}
				e := &protocol.Error{Code: protocol.Code(env.Error.Code)}
				if env.Error.Revision != nil {
					e.Revision = *env.Error.Revision
				}
				got = protocol.Encode(protocol.Failure(e))
			}

			if len(got) == 0 || got[len(got)-1] == '\n' {
				t.Fatalf("la salida no debe llevar salto de linea final: %q", got)
			}
			if !reflect.DeepEqual(asValue(t, got), asValue(t, c.Response)) {
				t.Fatalf("la salida no coincide con el fixture\n got  %s\n want %s", got, c.Response)
			}
		})
	}
	for _, cmd := range protocol.Commands {
		if !okByCmd[cmd] {
			t.Errorf("el comando %q no tiene respuesta correcta en los fixtures", cmd)
		}
	}
}

func TestEncodeShapes(t *testing.T) {
	tests := []struct {
		name string
		resp protocol.Response
		want string
	}{
		{"Empty", protocol.OK(protocol.Empty{}), `{"ok":true,"result":{}}`},
		{"nil", protocol.OK(nil), `{"ok":true,"result":{}}`},
		{"error sin revision", protocol.Failure(protocol.Fail(protocol.BadURL)), `{"ok":false,"error":{"code":"bad_url"}}`},
		{"conflict con revision", protocol.Failure(protocol.ConflictAt(7)), `{"ok":false,"error":{"code":"conflict","revision":7}}`},
		{"conflict con revision 0", protocol.Failure(protocol.ConflictAt(0)), `{"ok":false,"error":{"code":"conflict","revision":0}}`},
		{"revision de otro codigo no se escribe",
			protocol.Failure(&protocol.Error{Code: protocol.NotFound, Revision: 3}), `{"ok":false,"error":{"code":"not_found"}}`},
		{"Failure(nil) es internal", protocol.Failure(nil), `{"ok":false,"error":{"code":"internal"}}`},
		{"codigo desconocido es internal",
			protocol.Failure(&protocol.Error{Code: "otro"}), `{"ok":false,"error":{"code":"internal"}}`},
		{"codigo vacio es internal", protocol.Failure(&protocol.Error{}), `{"ok":false,"error":{"code":"internal"}}`},
		{"revision de conflict fuera de rango",
			protocol.Failure(protocol.ConflictAt(protocol.MaxSafeInteger + 1)), `{"ok":false,"error":{"code":"internal"}}`},
		{"revision negativa", protocol.Failure(protocol.ConflictAt(-1)), `{"ok":false,"error":{"code":"internal"}}`},
		{"result que no es un objeto", protocol.OK([]string{"a"}), `{"ok":false,"error":{"code":"internal"}}`},
		{"result texto", protocol.OK("x"), `{"ok":false,"error":{"code":"internal"}}`},
		{"result puntero nil", protocol.OK((*protocol.SyncPutResult)(nil)), `{"ok":false,"error":{"code":"internal"}}`},
		{"result que no se puede codificar", protocol.OK(make(chan int)), `{"ok":false,"error":{"code":"internal"}}`},
		{"RawMessage invalido", protocol.OK(protocol.SyncGetResult{Data: json.RawMessage(`{`), Bindings: json.RawMessage(`{}`)}),
			`{"ok":false,"error":{"code":"internal"}}`},
		{"sync.get sin datos", protocol.OK(protocol.SyncGetResult{Revision: 0, Bindings: json.RawMessage(`{}`)}),
			`{"ok":true,"result":{"revision":0,"data":null,"bindings":{}}}`},
		{"ping sin browserVersion", protocol.OK(protocol.PingResult{HostVersion: "0.1.0", Protocol: 1, Browser: "brave"}),
			`{"ok":true,"result":{"hostVersion":"0.1.0","protocol":1,"browser":"brave","features":{"temporaryContainer":false}}}`},
		{"perfil sin color", protocol.OK(protocol.ListProfilesResult{Profiles: []protocol.ProfileInfo{{Directory: "Default", Name: "Trabajo", IsUsingDefaultName: true}}}),
			`{"ok":true,"result":{"profiles":[{"directory":"Default","name":"Trabajo","isUsingDefaultName":true}]}}`},
		{"pair.start sin token", protocol.OK(protocol.PairStartResult{Code: "042913", ExpiresAt: "2026-10-07T12:02:00.000Z"}),
			`{"ok":true,"result":{"code":"042913","expiresAt":"2026-10-07T12:02:00.000Z"}}`},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := string(protocol.Encode(tc.resp)); got != tc.want {
				t.Fatalf("got  %s\nwant %s", got, tc.want)
			}
		})
	}
}

// TestEncodeNoHTMLEscape: sin escape HTML (json.Marshal escribiria <) y con U+2028 escapado por el Encoder.
func TestEncodeNoHTMLEscape(t *testing.T) {
	out := protocol.Encode(protocol.OK(protocol.SyncGetResult{
		Revision: 1,
		Data:     json.RawMessage(`{"x":"<&>"}`),
		Bindings: json.RawMessage("{}"),
	}))
	if !bytes.Contains(out, []byte(`<&>`)) {
		t.Fatalf("la salida debe llevar <&> literales: %s", out)
	}
	for _, bad := range []string{esc("003c"), esc("003e"), esc("0026")} {
		if bytes.Contains(out, []byte(bad)) {
			t.Fatalf("la salida no debe escapar HTML (%s): %s", bad, out)
		}
	}

	// U+2028 dentro de data sale como el escape de 6 bytes, aun con SetEscapeHTML(false).
	line := "\xe2\x80\xa8"
	out = protocol.Encode(protocol.OK(protocol.SyncGetResult{
		Data:     json.RawMessage(`{"x":"` + line + `"}`),
		Bindings: json.RawMessage("{}"),
	}))
	if !bytes.Contains(out, []byte(esc("2028"))) || bytes.Contains(out, []byte(line)) {
		t.Fatalf("U+2028 debe salir escapado: %q", out)
	}
	// El resto de los campos tampoco escapa HTML (un nombre de perfil con < y &).
	out = protocol.Encode(protocol.OK(protocol.ListProfilesResult{Profiles: []protocol.ProfileInfo{{Directory: "Default", Name: "A&B <c>"}}}))
	if !bytes.Contains(out, []byte(`"A&B <c>"`)) {
		t.Fatalf("el nombre debe salir sin escape HTML: %s", out)
	}
	// Se quitan los espacios del RawMessage (el Encoder lo compacta): nunca crece.
	out = protocol.Encode(protocol.OK(protocol.SyncGetResult{
		Data:     json.RawMessage(`{ "a" : 1 }`),
		Bindings: json.RawMessage(`{ }`),
	}))
	if want := `{"ok":true,"result":{"revision":0,"data":{"a":1},"bindings":{}}}`; string(out) != want {
		t.Fatalf("got %s\nwant %s", out, want)
	}
}

// TestEncodeListsAreNeverNull: los resultados con listas usan make([]T, 0); un slice nil saldria como null.
func TestEncodeListsAreNeverNull(t *testing.T) {
	out := protocol.Encode(protocol.OK(protocol.ListProfilesResult{Profiles: make([]protocol.ProfileInfo, 0)}))
	if want := `{"ok":true,"result":{"profiles":[]}}`; string(out) != want {
		t.Fatalf("got %s, want %s", out, want)
	}
	out = protocol.Encode(protocol.OK(protocol.PairListResult{MaxPairedProfiles: 2, Installations: make([]protocol.InstallationInfo, 0)}))
	if want := `{"ok":true,"result":{"maxPairedProfiles":2,"installations":[]}}`; string(out) != want {
		t.Fatalf("got %s, want %s", out, want)
	}

	// Documentacion del riesgo: con un slice nil Go escribe null, que la extension rechaza (bad_response).
	// Las pruebas de las tareas que construyen estos resultados vigilan los casos vacios.
	out = protocol.Encode(protocol.OK(protocol.ListProfilesResult{}))
	if want := `{"ok":true,"result":{"profiles":null}}`; string(out) != want {
		t.Fatalf("un slice nil debe verse como null (documenta el riesgo): got %s", out)
	}
}

// TestEncodeResponseCap: ninguna respuesta supera MaxResponseBytes; si fuera a pasar, sale internal.
func TestEncodeResponseCap(t *testing.T) {
	internal := `{"ok":false,"error":{"code":"internal"}}`
	syncGet := func(data string) protocol.Response {
		return protocol.OK(protocol.SyncGetResult{Data: json.RawMessage(data), Bindings: json.RawMessage("{}")})
	}
	str := func(n int, fill string) string { return `"` + strings.Repeat(fill, n) + `"` }

	// Frontera exacta: 1 000 000 bytes pasan, 1 000 001 no.
	base := len(protocol.Encode(syncGet(`""`)))
	exact := syncGet(str(protocol.MaxResponseBytes-base, "a"))
	if out := protocol.Encode(exact); len(out) != protocol.MaxResponseBytes || bytes.Contains(out, []byte("internal")) {
		t.Fatalf("una respuesta de exactamente %d bytes debe pasar, got %d bytes", protocol.MaxResponseBytes, len(out))
	}
	over := syncGet(str(protocol.MaxResponseBytes-base+1, "a"))
	if out := string(protocol.Encode(over)); out != internal {
		t.Fatalf("una respuesta de %d bytes debe ser internal, got %.80s", protocol.MaxResponseBytes+1, out)
	}

	// data de 999 950 bytes: con el sobre pasa del tope.
	if out := string(protocol.Encode(syncGet(str(999950-2, "a")))); out != internal {
		t.Fatalf("data de 999950 bytes debe dar internal, got %.80s", out)
	}

	// 524 288 bytes de "<": sin escape HTML caben (con json.Marshal serian mas de 3 MB).
	lt := `{"x":"` + strings.Repeat("<", protocol.MaxSharedDataBytes-8) + `"}`
	if len(lt) != protocol.MaxSharedDataBytes {
		t.Fatalf("el dato de prueba mide %d, want %d", len(lt), protocol.MaxSharedDataBytes)
	}
	out := protocol.Encode(syncGet(lt))
	if len(out) >= protocol.MaxResponseBytes || !bytes.Contains(out, []byte("<<<<")) || bytes.Contains(out, []byte(esc("003c"))) {
		t.Fatalf("512 KiB de < deben caber con los < literales: %d bytes", len(out))
	}
	if len(out) > 524288+200 {
		t.Fatalf("la respuesta con 512 KiB de < ocupa %d bytes, se esperaban unos 524 300", len(out))
	}

	// Unos 512 KiB casi solo de U+2028 se duplican al escribirse (3 bytes -> 6): internal.
	ls := `"` + strings.Repeat("\xe2\x80\xa8", 174000) + `"`
	if len(ls) < 500_000 || len(ls) > protocol.MaxSharedDataBytes {
		t.Fatalf("el dato de prueba mide %d", len(ls))
	}
	if out := string(protocol.Encode(syncGet(ls))); out != internal {
		t.Fatalf("512 KiB de U+2028 deben dar internal, got %.80s", out)
	}
}

// TestEncodeInternalIsStable: la respuesta internal de la salvaguarda es la misma que Failure(Fail(Internal)).
func TestEncodeInternalIsStable(t *testing.T) {
	want := protocol.Encode(protocol.Failure(protocol.Fail(protocol.Internal)))
	got := protocol.Encode(protocol.OK(make(chan int)))
	if !bytes.Equal(got, want) {
		t.Fatalf("got %s, want %s", got, want)
	}
}

// TestEveryCodeEncodes: todos los codigos de AllCodes se escriben tal cual (con revision solo conflict).
func TestEveryCodeEncodes(t *testing.T) {
	for _, c := range protocol.AllCodes {
		e := protocol.Fail(c)
		want := `{"ok":false,"error":{"code":"` + string(c) + `"}}`
		if c == protocol.Conflict {
			e = protocol.ConflictAt(9)
			want = `{"ok":false,"error":{"code":"conflict","revision":9}}`
		}
		if got := string(protocol.Encode(protocol.Failure(e))); got != want {
			t.Errorf("%s: got %s, want %s", c, got, want)
		}
		if !slices.Contains(protocol.AllCodes, c) {
			t.Errorf("%s no esta en AllCodes", c)
		}
	}
}
