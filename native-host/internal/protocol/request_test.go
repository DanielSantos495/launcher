package protocol_test

import (
	"bytes"
	"encoding/json"
	"reflect"
	"strconv"
	"strings"
	"testing"

	"github.com/DanielSantos495/launcher/native-host/internal/protocol"
)

const (
	testToken = "abcdefghijABCDEFGHIJ0123456789_-abcdefghijk"
	pingBody  = `{"v":1,"cmd":"ping","args":{}}`
	okData    = `{"schemaVersion":1,"revision":0}`
)

type validateCase struct {
	name string
	body string
	want protocol.Code // "" = la peticion es valida
}

// runValidate comprueba el codigo exacto de cada caso (o que no haya error).
func runValidate(t *testing.T, cases []validateCase) {
	t.Helper()
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req, err := protocol.Validate([]byte(tc.body))
			if tc.want == "" {
				if err != nil {
					t.Fatalf("got error %q, want nil", err.Code)
				}
				return
			}
			if err == nil {
				t.Fatalf("got nil (cmd %q), want %q", req.Cmd, tc.want)
			}
			if err.Code != tc.want {
				t.Fatalf("got %q, want %q", err.Code, tc.want)
			}
			if !reflect.DeepEqual(req, protocol.Request{}) {
				t.Fatalf("con error la peticion debe quedar vacia, got %+v", req)
			}
		})
	}
}

// padTo construye prefix + "a" repetida + suffix con exactamente total bytes.
func padTo(t *testing.T, prefix, suffix string, total int) string {
	t.Helper()
	n := total - len(prefix) - len(suffix)
	if n < 0 {
		t.Fatalf("total %d es menor que el prefijo y el sufijo", total)
	}
	s := prefix + strings.Repeat("a", n) + suffix
	if len(s) != total {
		t.Fatalf("padTo construyo %d bytes, want %d", len(s), total)
	}
	return s
}

func putBody(data, bindings string) string {
	return `{"v":1,"cmd":"sync.put","args":{"token":"` + testToken + `","baseRevision":0,"data":` + data +
		`,"bindings":` + bindings + `}}`
}

func openBody(url string) string {
	return `{"v":1,"cmd":"open","args":{"profileDirectory":"Default","url":` + url + `}}`
}

func tempBody(name string) string {
	return `{"v":1,"cmd":"openTemporary","args":{"profileDirectory":"Profile 1","url":"https://example.com/","name":` +
		name + `}}`
}

func iconBody(base64 string) string {
	return `{"v":1,"cmd":"icons.put","args":{"token":"` + testToken + `","key":"icon:gh1","mime":"image/png","base64":"` +
		base64 + `"}}`
}

// bindingsWith devuelve un objeto con n claves distintas k0..k(n-1).
func bindingsWith(n int) string {
	var b strings.Builder
	b.WriteString("{")
	for i := 0; i < n; i++ {
		if i > 0 {
			b.WriteString(",")
		}
		b.WriteString(`"k` + strconv.Itoa(i) + `":{}`)
	}
	b.WriteString("}")
	return b.String()
}

// Paso 1: el tamano se mide antes de parsear.
func TestValidateStep1Size(t *testing.T) {
	runValidate(t, []validateCase{
		{"1048576 bytes", pingBody + strings.Repeat(" ", protocol.MaxRequestBytes-len(pingBody)), ""},
		{"1048577 bytes", pingBody + strings.Repeat(" ", protocol.MaxRequestBytes+1-len(pingBody)), protocol.TooLarge},
		{"mas de 1 MiB que no es JSON: too_large va antes", strings.Repeat("x", protocol.MaxRequestBytes+1), protocol.TooLarge},
		{"exactamente 1 MiB que no es JSON: bad_request", strings.Repeat("x", protocol.MaxRequestBytes), protocol.BadRequest},
	})
}

// Paso 2: JSON invalido, UTF-8 invalido, sustitutos sueltos, datos sobrantes.
func TestValidateStep2Frame(t *testing.T) {
	runValidate(t, []validateCase{
		{"vacio", ``, protocol.BadRequest},
		{"solo espacios", `   `, protocol.BadRequest},
		{"datos despues del valor", pingBody + ` x`, protocol.BadRequest},
		{"dos objetos", pingBody + pingBody, protocol.BadRequest},
		{"coma final", `{"v":1,"cmd":"ping","args":{},}`, protocol.BadRequest},
		{"espacios delante y detras", "  \t\r\n" + pingBody + "\n \t ", ""},
		{"null", `null`, protocol.BadRequest},
		{"texto", `"ping"`, protocol.BadRequest},
		{"numero", `1`, protocol.BadRequest},
		{"array", `[]`, protocol.BadRequest},
		{"array con la peticion", `[` + pingBody + `]`, protocol.BadRequest},
		{"BOM delante", "\xef\xbb\xbf" + pingBody, protocol.BadRequest},
		{"0xFF dentro de un texto", "{\"v\":1,\"cmd\":\"ping\xff\",\"args\":{}}", protocol.BadRequest},
		{"0xFF fuera de un texto", pingBody + "\xff", protocol.BadRequest},
		{"0xFF delante", "\xff" + pingBody, protocol.BadRequest},
		{"UTF-8 truncado en un texto", "{\"v\":1,\"cmd\":\"ping\",\"args\":{\"a\":\"\xe2\x80\"}}", protocol.BadRequest},
		{"sustituto alto suelto en profileDirectory",
			`{"v":1,"cmd":"open","args":{"profileDirectory":"` + esc("D800") + `","url":"https://github.com/"}}`,
			protocol.BadRequest},
		{"sustituto bajo suelto en profileDirectory",
			`{"v":1,"cmd":"open","args":{"profileDirectory":"` + esc("dc00") + `","url":"https://github.com/"}}`,
			protocol.BadRequest},
		{"sustituto suelto en cmd: bad_request, no unknown_command",
			`{"v":1,"cmd":"` + esc("d800") + `","args":{}}`, protocol.BadRequest},
		{"sustituto suelto en una clave", `{"v":1,"cmd":"ping","args":{},"` + esc("d800") + `":1}`, protocol.BadRequest},
		{"sustituto suelto con v no valida: bad_request va antes que unsupported_version",
			`{"v":2,"cmd":"` + esc("d800") + `","args":{}}`, protocol.BadRequest},
		{"barra invertida y ud800 como texto literal, no es un escape", tempBody(`"\` + esc("d800") + `"`), ""},
		{"par de sustitutos valido como nombre", tempBody(`"` + esc("D83C") + esc("DFA8") + `"`), ""},
		{"par de sustitutos en minusculas", tempBody(`"` + esc("d83c") + esc("dfa8") + `"`), ""},
		{"emoji literal", tempBody(`"🎨"`), ""},
		{"profundidad excesiva", `{"v":1,"cmd":"ping","args":{},"x":` + strings.Repeat("[", 200000) + strings.Repeat("]", 200000) + `}`,
			protocol.BadRequest},
	})
}

// Paso 3: version. Claves duplicadas: gana la ultima.
func TestValidateStep3Version(t *testing.T) {
	runValidate(t, []validateCase{
		{"v duplicada: gana la ultima (1)", `{"v":2,"v":1,"cmd":"ping","args":{}}`, ""},
		{"v duplicada: gana la ultima (2)", `{"v":1,"v":2,"cmd":"ping","args":{}}`, protocol.UnsupportedVersion},
		{"v = 1.0 (D1)", `{"v":1.0,"cmd":"ping","args":{}}`, protocol.UnsupportedVersion},
		{"v = 1e0 (D1)", `{"v":1e0,"cmd":"ping","args":{}}`, protocol.UnsupportedVersion},
		{"v = 1E0", `{"v":1E0,"cmd":"ping","args":{}}`, protocol.UnsupportedVersion},
		{"v = 0", `{"v":0,"cmd":"ping","args":{}}`, protocol.UnsupportedVersion},
		{"v = -1", `{"v":-1,"cmd":"ping","args":{}}`, protocol.UnsupportedVersion},
		{"v = 10", `{"v":10,"cmd":"ping","args":{}}`, protocol.UnsupportedVersion},
		{"v = true", `{"v":true,"cmd":"ping","args":{}}`, protocol.UnsupportedVersion},
		{"v = null", `{"v":null,"cmd":"ping","args":{}}`, protocol.UnsupportedVersion},
		{"v = [1]", `{"v":[1],"cmd":"ping","args":{}}`, protocol.UnsupportedVersion},
		{"v con espacios alrededor", `{"v" : 1 ,"cmd":"ping","args":{}}`, ""},
		{"v con ceros a la izquierda no es JSON", `{"v":01,"cmd":"ping","args":{}}`, protocol.BadRequest},
		{"v ausente", `{"cmd":"ping","args":{}}`, protocol.UnsupportedVersion},
		{"clave v con escape equivale a v", `{"` + esc("0076") + `":1,"cmd":"ping","args":{}}`, ""},
	})
}

// Pasos 4 y 5: cmd, sobre y args.
func TestValidateStep4And5Envelope(t *testing.T) {
	runValidate(t, []validateCase{
		{"cmd en mayusculas", `{"v":1,"cmd":"PING","args":{}}`, protocol.UnknownCommand},
		{"cmd __proto__", `{"v":1,"cmd":"__proto__","args":{}}`, protocol.UnknownCommand},
		{"cmd constructor", `{"v":1,"cmd":"constructor","args":{}}`, protocol.UnknownCommand},
		{"cmd vacio", `{"v":1,"cmd":"","args":{}}`, protocol.UnknownCommand},
		{"cmd con espacio", `{"v":1,"cmd":"ping ","args":{}}`, protocol.UnknownCommand},
		{"cmd con punto de mas", `{"v":1,"cmd":"pair","args":{}}`, protocol.UnknownCommand},
		{"cmd null", `{"v":1,"cmd":null,"args":{}}`, protocol.BadRequest},
		{"cmd array", `{"v":1,"cmd":["ping"],"args":{}}`, protocol.BadRequest},
		{"cmd objeto", `{"v":1,"cmd":{},"args":{}}`, protocol.BadRequest},
		{"cmd duplicado: gana el ultimo", `{"v":1,"cmd":"ping","cmd":"exec","args":{}}`, protocol.UnknownCommand},
		{"args null", `{"v":1,"cmd":"ping","args":null}`, protocol.BadRequest},
		{"args texto", `{"v":1,"cmd":"ping","args":"x"}`, protocol.BadRequest},
		{"args array vacio", `{"v":1,"cmd":"ping","args":[]}`, protocol.BadRequest},
		{"args numero", `{"v":1,"cmd":"ping","args":0}`, protocol.BadRequest},
		{"args ausente", `{"v":1,"cmd":"ping"}`, protocol.BadRequest},
		{"campo de mas en el sobre", `{"v":1,"cmd":"ping","args":{},"x":1}`, protocol.BadRequest},
		{"args en mayusculas", `{"v":1,"cmd":"ping","ARGS":{}}`, protocol.BadRequest},
		{"orden: cmd desconocido antes que sobre", `{"v":1,"cmd":"exec","x":1}`, protocol.UnknownCommand},
		{"orden: version antes que cmd", `{"v":2,"cmd":5,"x":1}`, protocol.UnsupportedVersion},
		{"orden: cmd no texto antes que sobre", `{"v":1,"cmd":5,"x":1}`, protocol.BadRequest},
	})
}

// Todos los comandos de Commands tienen esquema: un argumento desconocido es bad_request, nunca unknown_command.
func TestValidateEveryCommandHasSchema(t *testing.T) {
	if len(protocol.Commands) != 17 {
		t.Fatalf("hay %d comandos, want 17", len(protocol.Commands))
	}
	seen := map[string]bool{}
	for _, cmd := range protocol.Commands {
		if seen[cmd] {
			t.Errorf("comando repetido: %q", cmd)
		}
		seen[cmd] = true
		_, err := protocol.Validate([]byte(`{"v":1,"cmd":"` + cmd + `","args":{"zzz":1}}`))
		if err == nil || err.Code != protocol.BadRequest {
			t.Errorf("%s con un argumento desconocido: got %v, want bad_request", cmd, err)
		}
	}
}

// Paso 6: campos de args.
func TestValidateStep6Args(t *testing.T) {
	runValidate(t, []validateCase{
		// url: texto fuera de G -> bad_url; tipo incorrecto -> bad_request.
		{"url de 2048", openBody(`"https://example.com/` + strings.Repeat("a", 2028) + `"`), ""},
		{"url de 2049", openBody(`"https://example.com/` + strings.Repeat("a", 2029) + `"`), protocol.BadURL},
		{"url con claves duplicadas: gana la ultima (valida)",
			`{"v":1,"cmd":"open","args":{"profileDirectory":"Default","url":"javascript:x","url":"https://github.com/"}}`, ""},
		{"url con claves duplicadas: gana la ultima (invalida)",
			`{"v":1,"cmd":"open","args":{"profileDirectory":"Default","url":"https://github.com/","url":"javascript:x"}}`,
			protocol.BadURL},
		{"url con salto escapado", openBody(`"https://example.com/` + esc("000a") + `x"`), protocol.BadURL},
		{"url con U+0085 escapado", openBody(`"https://example.com/` + esc("0085") + `"`), protocol.BadURL},
		{"url con escape equivalente a caracter valido", openBody(`"https://example.com/` + esc("0061") + `"`), ""},
		{"url null", openBody(`null`), protocol.BadRequest},
		{"url numero", openBody(`5`), protocol.BadRequest},
		{"url array", openBody(`["https://github.com/"]`), protocol.BadRequest},
		{"url objeto", openBody(`{}`), protocol.BadRequest},

		// name de openTemporary.
		{"name null", tempBody(`null`), protocol.BadRequest},
		{"name vacio", tempBody(`""`), protocol.BadName},
		{"name numero", tempBody(`5`), protocol.BadRequest},
		{"name de 65 puntos de codigo", tempBody(`"` + strings.Repeat("🎨", 65) + `"`), protocol.BadName},
		{"name de 64 puntos de codigo", tempBody(`"` + strings.Repeat("🎨", 64) + `"`), ""},
		{"name solo con U+FEFF escapado", tempBody(`"` + esc("feff") + `"`), protocol.BadName},
		{"name con U+0085 escapado", tempBody(`"a` + esc("0085") + `"`), protocol.BadName},
		{"name con NUL escapado", tempBody(`"a` + esc("0000") + `"`), protocol.BadName},
		{"name con salto", tempBody(`"a\nb"`), protocol.BadName},
		{"name con U+180E solo", tempBody(`"` + esc("180e") + `"`), ""},
		{"openTemporary sin name", `{"v":1,"cmd":"openTemporary","args":{"profileDirectory":"Profile 1","url":"https://example.com/"}}`, ""},

		// Formatos que dan bad_request.
		{"profileDirectory con barra", `{"v":1,"cmd":"open","args":{"profileDirectory":"a/b","url":"https://github.com/"}}`, protocol.BadRequest},
		{"profileDirectory de 255", `{"v":1,"cmd":"open","args":{"profileDirectory":"` + strings.Repeat("a", 255) + `","url":"https://github.com/"}}`, ""},
		{"profileDirectory de 256", `{"v":1,"cmd":"open","args":{"profileDirectory":"` + strings.Repeat("a", 256) + `","url":"https://github.com/"}}`, protocol.BadRequest},
		{"profileDirectory vacio", `{"v":1,"cmd":"open","args":{"profileDirectory":"","url":"https://github.com/"}}`, protocol.BadRequest},
		{"profileDirectory null", `{"v":1,"cmd":"open","args":{"profileDirectory":null,"url":"https://github.com/"}}`, protocol.BadRequest},
		{"profileDirectory ausente", `{"v":1,"cmd":"open","args":{"url":"https://github.com/"}}`, protocol.BadRequest},
		{"url ausente", `{"v":1,"cmd":"open","args":{"profileDirectory":"Default"}}`, protocol.BadRequest},
		{"orden: profileDirectory ausente y url invalida", `{"v":1,"cmd":"open","args":{"url":"javascript:x"}}`, protocol.BadRequest},
		{"installationId reservado", `{"v":1,"cmd":"pair.start","args":{"installationId":"constructor"}}`, protocol.BadRequest},
		{"installationId ausente", `{"v":1,"cmd":"pair.start","args":{}}`, protocol.BadRequest},
		{"pair.start sin token", `{"v":1,"cmd":"pair.start","args":{"installationId":"inst-a"}}`, ""},
		{"pair.start con token corto", `{"v":1,"cmd":"pair.start","args":{"installationId":"inst-a","token":"x"}}`, protocol.BadRequest},
		{"pair.join con codigo de 7 cifras", `{"v":1,"cmd":"pair.join","args":{"installationId":"inst-b","code":"0429131"}}`, protocol.BadRequest},
		{"pair.join con codigo numerico", `{"v":1,"cmd":"pair.join","args":{"installationId":"inst-b","code":42913}}`, protocol.BadRequest},
		{"pair.declare con identityId invalido", `{"v":1,"cmd":"pair.declare","args":{"token":"` + testToken + `","profileDirectory":"Default","identityId":"a b"}}`, protocol.BadRequest},
		{"pair.declare con identityId null", `{"v":1,"cmd":"pair.declare","args":{"token":"` + testToken + `","profileDirectory":"Default","identityId":null}}`, protocol.BadRequest},
		{"pair.remove sin installationId", `{"v":1,"cmd":"pair.remove","args":{"token":"` + testToken + `"}}`, protocol.BadRequest},
		{"pair.prove con nonce de 64", `{"v":1,"cmd":"pair.prove","args":{"token":"` + testToken + `","nonce":"` + strings.Repeat("n", 64) + `"}}`, ""},
		{"pair.prove con nonce de 65", `{"v":1,"cmd":"pair.prove","args":{"token":"` + testToken + `","nonce":"` + strings.Repeat("n", 65) + `"}}`, protocol.BadRequest},
		{"sync.get con token de 44", `{"v":1,"cmd":"sync.get","args":{"token":"` + testToken + `a"}}`, protocol.BadRequest},
		{"sync.get con token numerico", `{"v":1,"cmd":"sync.get","args":{"token":5}}`, protocol.BadRequest},
		{"icons.get con clave invalida", `{"v":1,"cmd":"icons.get","args":{"token":"` + testToken + `","key":"icon:"}}`, protocol.BadRequest},
		{"icons.delete valido", `{"v":1,"cmd":"icons.delete","args":{"token":"` + testToken + `","key":"icon:` + strings.Repeat("k", 64) + `"}}`, ""},
		{"icons.put con mime gif", `{"v":1,"cmd":"icons.put","args":{"token":"` + testToken + `","key":"icon:a","mime":"image/gif","base64":"AAAA"}}`, protocol.BadRequest},

		// Campos desconocidos: al final, y con claves exactas.
		{"campo desconocido", `{"v":1,"cmd":"ping","args":{"x":1}}`, protocol.BadRequest},
		{"campo en mayusculas", `{"v":1,"cmd":"open","args":{"profileDirectory":"Default","url":"https://github.com/","Url":"x"}}`, protocol.BadRequest},
		{"args de un comando en otro", `{"v":1,"cmd":"pair.list","args":{"token":"` + testToken + `","installationId":"inst-a"}}`, protocol.BadRequest},
		{"orden: url invalida y campo desconocido", `{"v":1,"cmd":"open","args":{"profileDirectory":"Default","url":"javascript:x","extra":1}}`, protocol.BadURL},
		{"orden: profileDirectory invalido y url invalida", `{"v":1,"cmd":"open","args":{"url":"javascript:x","profileDirectory":"-x"}}`, protocol.BadRequest},
		{"orden: url invalida y name no texto", `{"v":1,"cmd":"openTemporary","args":{"profileDirectory":"Profile 1","url":"javascript:x","name":5}}`, protocol.BadURL},
	})
}

// Icono: 43691 A y relleno valen, 43692 A (32769 bytes) no.
func TestValidateIconBoundary(t *testing.T) {
	runValidate(t, []validateCase{
		{"icons.put con 32768 bytes", iconBody(strings.Repeat("A", 43691) + "="), ""},
		{"icons.put con 32769 bytes", iconBody(strings.Repeat("A", 43692)), protocol.BadRequest},
		{"icons.put con 43696 caracteres", iconBody(strings.Repeat("A", 43696)), protocol.BadRequest},
		{"icons.put con base64 vacio", iconBody(""), protocol.BadRequest},
		{"icons.put con base64 de 4", iconBody("AAAA"), ""},
		{"icons.put con base64 de 3", iconBody("AAA"), protocol.BadRequest},
		{"icons.put con salto escapado", iconBody("AAAA" + esc("000a")), protocol.BadRequest},
	})
}

// Paso 7 y estructura de data y bindings.
func TestValidateSyncPut(t *testing.T) {
	dataPrefix := `{"schemaVersion":1,"revision":0,"pad":"`
	data524288 := padTo(t, dataPrefix, `"}`, protocol.MaxSharedDataBytes)
	data524289 := padTo(t, dataPrefix, `"}`, protocol.MaxSharedDataBytes+1)
	bind131072 := padTo(t, `{"k":"`, `"}`, protocol.MaxSharedBindingsBytes)
	bind131073 := padTo(t, `{"k":"`, `"}`, protocol.MaxSharedBindingsBytes+1)
	// Los espacios internos cuentan: el tamano son los bytes recibidos del valor.
	spacedData := `{ "schemaVersion" : 1 , "revision" : 0 , "pad" : "` + strings.Repeat(" ", 100) + `" }`
	spacedBig := padTo(t, `{ "schemaVersion" : 1 , "revision" : 0 , "pad" : "`, `" }`, protocol.MaxSharedDataBytes+1)

	runValidate(t, []validateCase{
		{"data de 524288 bytes", putBody(data524288, `{}`), ""},
		{"data de 524289 bytes", putBody(data524289, `{}`), protocol.TooLarge},
		{"bindings de 131072 bytes con 1 clave", putBody(okData, bind131072), ""},
		{"bindings de 131073 bytes", putBody(okData, bind131073), protocol.TooLarge},
		{"data y bindings grandes a la vez", putBody(data524289, bind131073), protocol.TooLarge},
		{"data con espacios internos, pequeno", putBody(spacedData, `{ }`), ""},
		{"data con espacios internos, un byte de mas", putBody(spacedBig, `{}`), protocol.TooLarge},
		{"orden: data grande y campo desconocido", strings.TrimSuffix(putBody(data524289, `{}`), `}}`) + `,"extra":1}}`, protocol.BadRequest},
		{"orden: data grande y token corto", strings.Replace(putBody(data524289, `{}`), testToken, "corto", 1), protocol.BadRequest},
		{"orden: data grande y baseRevision negativa", strings.Replace(putBody(data524289, `{}`), `"baseRevision":0`, `"baseRevision":-1`, 1), protocol.BadRequest},
		{"orden: data grande y bindings como array", putBody(data524289, `[]`), protocol.BadRequest},
		{"orden: data grande y schemaVersion 2", putBody(strings.Replace(data524289, `"schemaVersion":1`, `"schemaVersion":2`, 1), `{}`), protocol.BadRequest},
		{"orden: data grande y bindings con 101 claves", putBody(data524289, bindingsWith(101)), protocol.BadRequest},

		// data (D2).
		{"schemaVersion 1", putBody(`{"schemaVersion":1,"revision":0}`, `{}`), ""},
		{"schemaVersion 1.0", putBody(`{"schemaVersion":1.0,"revision":0}`, `{}`), protocol.BadRequest},
		{"schemaVersion 1e0", putBody(`{"schemaVersion":1e0,"revision":0}`, `{}`), protocol.BadRequest},
		{"schemaVersion 2", putBody(`{"schemaVersion":2,"revision":0}`, `{}`), protocol.BadRequest},
		{"schemaVersion 0", putBody(`{"schemaVersion":0,"revision":0}`, `{}`), protocol.BadRequest},
		{"schemaVersion texto", putBody(`{"schemaVersion":"1","revision":0}`, `{}`), protocol.BadRequest},
		{"schemaVersion ausente", putBody(`{"revision":0}`, `{}`), protocol.BadRequest},
		{"schemaVersion en mayusculas", putBody(`{"SchemaVersion":1,"revision":0}`, `{}`), protocol.BadRequest},
		{"schemaVersion duplicada: gana la ultima (valida)", putBody(`{"schemaVersion":2,"schemaVersion":1,"revision":0}`, `{}`), ""},
		{"schemaVersion duplicada: gana la ultima (invalida)", putBody(`{"schemaVersion":1,"schemaVersion":2,"revision":0}`, `{}`), protocol.BadRequest},
		{"revision 2^53-1", putBody(`{"schemaVersion":1,"revision":9007199254740991}`, `{}`), ""},
		{"revision 2^53", putBody(`{"schemaVersion":1,"revision":9007199254740992}`, `{}`), protocol.BadRequest},
		{"revision -1", putBody(`{"schemaVersion":1,"revision":-1}`, `{}`), protocol.BadRequest},
		{"revision 1.5", putBody(`{"schemaVersion":1,"revision":1.5}`, `{}`), protocol.BadRequest},
		{"revision 1e0", putBody(`{"schemaVersion":1,"revision":1e0}`, `{}`), protocol.BadRequest},
		{"revision texto", putBody(`{"schemaVersion":1,"revision":"0"}`, `{}`), protocol.BadRequest},
		{"revision null", putBody(`{"schemaVersion":1,"revision":null}`, `{}`), protocol.BadRequest},
		{"revision ausente", putBody(`{"schemaVersion":1}`, `{}`), protocol.BadRequest},
		{"data con campos desconocidos y de tipo raro (D2)",
			putBody(`{"schemaVersion":1,"revision":5,"accounts":"x","otro":{"a":[1]}}`, `{}`), ""},
		{"data null", putBody(`null`, `{}`), protocol.BadRequest},
		{"data array", putBody(`[]`, `{}`), protocol.BadRequest},
		{"data array con el objeto", putBody(`[`+okData+`]`, `{}`), protocol.BadRequest},
		{"data texto", putBody(`"x"`, `{}`), protocol.BadRequest},
		{"data vacio", putBody(`{}`, `{}`), protocol.BadRequest},
		{"data ausente", `{"v":1,"cmd":"sync.put","args":{"token":"` + testToken + `","baseRevision":0,"bindings":{}}}`, protocol.BadRequest},
		{"bindings ausente", `{"v":1,"cmd":"sync.put","args":{"token":"` + testToken + `","baseRevision":0,"data":` + okData + `}}`, protocol.BadRequest},

		// bindings.
		{"bindings vacio", putBody(okData, `{}`), ""},
		{"bindings con 100 claves", putBody(okData, bindingsWith(100)), ""},
		{"bindings con 101 claves", putBody(okData, bindingsWith(101)), protocol.BadRequest},
		{"bindings con 101 claves, dos repetidas (100 distintas)",
			putBody(okData, strings.TrimSuffix(bindingsWith(100), "}")+`,"k0":{},"k1":{}}`), ""},
		{"bindings null", putBody(okData, `null`), protocol.BadRequest},
		{"bindings array", putBody(okData, `[]`), protocol.BadRequest},
		{"bindings texto", putBody(okData, `"x"`), protocol.BadRequest},
		{"bindings con valores de cualquier tipo", putBody(okData, `{"a":1,"b":"x","c":[1],"d":null}`), ""},

		// baseRevision.
		{"baseRevision 2^53-1", strings.Replace(putBody(okData, `{}`), `"baseRevision":0`, `"baseRevision":9007199254740991`, 1), ""},
		{"baseRevision 2^53", strings.Replace(putBody(okData, `{}`), `"baseRevision":0`, `"baseRevision":9007199254740992`, 1), protocol.BadRequest},
		{"baseRevision 1.0", strings.Replace(putBody(okData, `{}`), `"baseRevision":0`, `"baseRevision":1.0`, 1), protocol.BadRequest},
		{"baseRevision 1e0", strings.Replace(putBody(okData, `{}`), `"baseRevision":0`, `"baseRevision":1e0`, 1), protocol.BadRequest},
		{"baseRevision texto", strings.Replace(putBody(okData, `{}`), `"baseRevision":0`, `"baseRevision":"0"`, 1), protocol.BadRequest},
		{"baseRevision null", strings.Replace(putBody(okData, `{}`), `"baseRevision":0`, `"baseRevision":null`, 1), protocol.BadRequest},
		{"baseRevision +1", strings.Replace(putBody(okData, `{}`), `"baseRevision":0`, `"baseRevision":+1`, 1), protocol.BadRequest},
		{"baseRevision con 17 digitos", strings.Replace(putBody(okData, `{}`), `"baseRevision":0`, `"baseRevision":10000000000000000`, 1), protocol.BadRequest},
	})
}

// Los valores devueltos: campos exactos y los bytes recibidos de data y bindings.
func TestValidateReturnedValues(t *testing.T) {
	req, err := protocol.Validate([]byte(openBody(`"https://github.com/"`)))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	if req.Cmd != "open" || req.ProfileDirectory != "Default" || req.URL != "https://github.com/" {
		t.Fatalf("open: got %+v", req)
	}

	// data y bindings: los bytes del valor, con sus espacios, sin los de alrededor.
	data := `{ "schemaVersion" : 1 , "revision" : 3 ,"x":"` + esc("0041") + `" }`
	bindings := `{ "a" : { "b" : 1 } }`
	req, err = protocol.Validate([]byte(putBody(data, bindings)))
	if err != nil {
		t.Fatalf("sync.put: %v", err)
	}
	if !bytes.Equal(req.Data, []byte(data)) {
		t.Fatalf("Data = %q, want %q", req.Data, data)
	}
	if !bytes.Equal(req.Bindings, []byte(bindings)) {
		t.Fatalf("Bindings = %q, want %q", req.Bindings, bindings)
	}

	req, err = protocol.Validate([]byte(`{"v":1,"cmd":"pair.start","args":{"installationId":"inst-a"}}`))
	if err != nil {
		t.Fatalf("pair.start: %v", err)
	}
	if req.Token != "" {
		t.Fatalf("pair.start sin token: Token = %q, want vacio", req.Token)
	}

	// Un escape JSON se decodifica antes de validar: el valor devuelto es el texto.
	req, err = protocol.Validate([]byte(`{"v":1,"cmd":"open","args":{"profileDirectory":"Prof` + esc("0069") + `le 1","url":"https://github.com/"}}`))
	if err != nil || req.ProfileDirectory != "Profile 1" {
		t.Fatalf("escape decodificado: %+v, %v", req, err)
	}
}

// TestValidateFillsEveryField: cada comando devuelve exactamente sus campos, y los opcionales ausentes quedan en "".
func TestValidateFillsEveryField(t *testing.T) {
	const tok = testToken
	data := `{"schemaVersion":1,"revision":2}`
	bindings := `{"a":{}}`
	tests := []struct {
		body string
		want protocol.Request
	}{
		{pingBody, protocol.Request{Cmd: "ping"}},
		{`{"v":1,"cmd":"listProfiles","args":{}}`, protocol.Request{Cmd: "listProfiles"}},
		{openBody(`"https://github.com/"`), protocol.Request{Cmd: "open", ProfileDirectory: "Default", URL: "https://github.com/"}},
		{tempBody(`"Trabajo"`), protocol.Request{Cmd: "openTemporary", ProfileDirectory: "Profile 1", URL: "https://example.com/", Name: "Trabajo"}},
		{`{"v":1,"cmd":"openTemporary","args":{"profileDirectory":"Profile 1","url":"https://example.com/"}}`,
			protocol.Request{Cmd: "openTemporary", ProfileDirectory: "Profile 1", URL: "https://example.com/"}},
		{`{"v":1,"cmd":"createProfile","args":{}}`, protocol.Request{Cmd: "createProfile"}},
		{`{"v":1,"cmd":"pair.start","args":{"installationId":"inst-a","token":"` + tok + `"}}`,
			protocol.Request{Cmd: "pair.start", InstallationID: "inst-a", Token: tok}},
		{`{"v":1,"cmd":"pair.join","args":{"installationId":"inst-b","code":"042913"}}`,
			protocol.Request{Cmd: "pair.join", InstallationID: "inst-b", Code: "042913"}},
		{`{"v":1,"cmd":"pair.declare","args":{"token":"` + tok + `","profileDirectory":"Profile 1","identityId":"id-home"}}`,
			protocol.Request{Cmd: "pair.declare", Token: tok, ProfileDirectory: "Profile 1", IdentityID: "id-home"}},
		{`{"v":1,"cmd":"pair.declare","args":{"token":"` + tok + `","profileDirectory":"Profile 1"}}`,
			protocol.Request{Cmd: "pair.declare", Token: tok, ProfileDirectory: "Profile 1"}},
		{`{"v":1,"cmd":"pair.list","args":{"token":"` + tok + `"}}`, protocol.Request{Cmd: "pair.list", Token: tok}},
		{`{"v":1,"cmd":"pair.remove","args":{"token":"` + tok + `","installationId":"inst-b"}}`,
			protocol.Request{Cmd: "pair.remove", Token: tok, InstallationID: "inst-b"}},
		{`{"v":1,"cmd":"pair.verify","args":{"token":"` + tok + `"}}`, protocol.Request{Cmd: "pair.verify", Token: tok}},
		{`{"v":1,"cmd":"pair.prove","args":{"token":"` + tok + `","nonce":"step0-nonce-0001"}}`,
			protocol.Request{Cmd: "pair.prove", Token: tok, Nonce: "step0-nonce-0001"}},
		{`{"v":1,"cmd":"sync.get","args":{"token":"` + tok + `"}}`, protocol.Request{Cmd: "sync.get", Token: tok}},
		{`{"v":1,"cmd":"sync.put","args":{"token":"` + tok + `","baseRevision":7,"data":` + data + `,"bindings":` + bindings + `}}`,
			protocol.Request{Cmd: "sync.put", Token: tok, BaseRevision: 7, Data: json.RawMessage(data), Bindings: json.RawMessage(bindings)}},
		{`{"v":1,"cmd":"icons.get","args":{"token":"` + tok + `","key":"icon:gh1"}}`,
			protocol.Request{Cmd: "icons.get", Token: tok, Key: "icon:gh1"}},
		{`{"v":1,"cmd":"icons.put","args":{"token":"` + tok + `","key":"icon:gh1","mime":"image/webp","base64":"iVBORw0KGgo="}}`,
			protocol.Request{Cmd: "icons.put", Token: tok, Key: "icon:gh1", Mime: "image/webp", Base64: "iVBORw0KGgo="}},
		{`{"v":1,"cmd":"icons.delete","args":{"token":"` + tok + `","key":"icon:gh1"}}`,
			protocol.Request{Cmd: "icons.delete", Token: tok, Key: "icon:gh1"}},
	}
	covered := map[string]bool{}
	for _, tc := range tests {
		got, err := protocol.Validate([]byte(tc.body))
		if err != nil {
			t.Errorf("%s: error %q", tc.want.Cmd, err.Code)
			continue
		}
		covered[tc.want.Cmd] = true
		if !reflect.DeepEqual(got, tc.want) {
			t.Errorf("%s:\n got  %+v\n want %+v", tc.want.Cmd, got, tc.want)
		}
	}
	for _, cmd := range protocol.Commands {
		if !covered[cmd] {
			t.Errorf("el comando %q no tiene caso en TestValidateFillsEveryField", cmd)
		}
	}
}

// TestValidateErrorsCarryNoData: el error es solo el codigo; no repite nada de lo recibido.
func TestValidateErrorsCarryNoData(t *testing.T) {
	secret := "secret-value-9f3a"
	bodies := []string{
		openBody(`"javascript:` + secret + `"`),
		tempBody(`"=` + secret + `"`),
		`{"v":1,"cmd":"open","args":{"profileDirectory":"../` + secret + `","url":"https://github.com/"}}`,
		`{"v":1,"cmd":"` + secret + `","args":{}}`,
		`{"v":1,"cmd":"ping","args":{},"` + secret + `":1}`,
		`{"v":1,"cmd":"sync.get","args":{"token":"` + secret + `"}}`,
	}
	for _, b := range bodies {
		_, err := protocol.Validate([]byte(b))
		if err == nil {
			t.Fatalf("%q deberia fallar", b)
		}
		if strings.Contains(err.Error(), secret) || err.Error() != string(err.Code) {
			t.Errorf("el error repite datos: %q", err.Error())
		}
		if err.Revision != 0 {
			t.Errorf("Validate no devuelve revisiones, got %d", err.Revision)
		}
	}
}
