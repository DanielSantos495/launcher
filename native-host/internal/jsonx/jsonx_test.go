package jsonx_test

import (
	"bytes"
	"encoding/json"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/DanielSantos495/launcher/native-host/internal/jsonx"
)

// js convierte el marcador "@u" en una barra invertida y una u, el inicio de un escape JSON. Las entradas usan
// el marcador para que ninguna herramienta ni editor las convierta en el caracter que representan: un escape
// son seis caracteres (barra, u y cuatro digitos) en la tuberia, no uno. Las cadenas con comillas inversas son
// JSON tal cual llega; los bytes sueltos (UTF-8 invalido) se escriben en cadenas normales de Go.
func js(s string) string { return strings.ReplaceAll(s, "@u", `\u`) }

var checkTextCases = []struct {
	name string
	in   string
	want bool
}{
	// Validos.
	{"objeto vacio", `{}`, true},
	{"emoji literal", "{\"a\":\"🎨\"}", true},
	{"emoji como par de escapes", `{"a":"@ud83c@udfa8"}`, true},
	{"par en mayusculas", `{"a":"@uD83C@uDFA8"}`, true},
	{"par en una clave", `{"@ud83c@udfa8":1}`, true},
	{"barra escapada: es texto, no escape", `{"a":"\@ud800"}`, true},
	{"barra escapada seguida de escape valido", `{"a":"\\@ud83c@udfa8"}`, true},
	{"escape no sustituto", `{"a":"@u0041@ufffd@ue000"}`, true},
	{"comilla escapada antes de un escape raro", `{"a":"\"@ud83c@udfa8"}`, true},
	{"sustituto fuera de un texto no es escape", `{"a":1} @ud800`, true},
	{"entrada vacia", ``, true},
	{"escape truncado", `{"a":"@u12`, true},
	{"escape truncado tras cuatro digitos y uno mas", `{"a":"@u00e`, true},
	{"barra al final", `{"a":"\`, true},
	{"hex no valido tras la u", `{"a":"@uzzzz"}`, true},

	// Sustitutos sueltos.
	{"alto suelto", `{"a":"@ud800"}`, false},
	{"bajo suelto", `{"a":"@udc00"}`, false},
	{"alto suelto en mayusculas", `{"a":"@uD800"}`, false},
	{"bajo suelto en mayusculas", `{"a":"@uDFFF"}`, false},
	{"alto seguido de letra", `{"a":"@ud800A"}`, false},
	{"alto seguido de x", `{"a":"@ud800x"}`, false},
	{"alto seguido de escape no sustituto", `{"a":"@ud800@u0041"}`, false},
	{"alto seguido de otro alto", `{"a":"@ud800@ud800"}`, false},
	{"bajo seguido de alto", `{"a":"@udc00@ud800"}`, false},
	{"par y luego bajo suelto", `{"a":"@ud83c@udfa8@udfa8"}`, false},
	{"alto suelto en una clave", `{"@ud800":1}`, false},
	{"alto suelto en un valor anidado", `{"a":{"b":["x","@ud800"]}}`, false},
	{"alto suelto tras un par", `{"a":"@ud83c@udfa8@ud83c"}`, false},
	{"alto al final de la entrada", `{"a":"@ud800`, false},
	{"alto con escape bajo truncado", `{"a":"@ud800@udc0`, false},
	{"barra escapada y luego alto suelto", `{"a":"\\@ud800"}`, false},

	// UTF-8 invalido.
	{"byte 0xff en un texto", "{\"a\":\"\xff\"}", false},
	{"byte 0xff fuera de un texto", "{\"a\":1}\xff", false},
	{"secuencia truncada", "{\"a\":\"\xe2\x82\"}", false},
	{"sustituto codificado en UTF-8", "{\"a\":\"\xed\xa0\x80\"}", false},
	{"sobrelarga", "{\"a\":\"\xc0\xaf\"}", false},
}

func TestCheckText(t *testing.T) {
	for _, tc := range checkTextCases {
		t.Run(tc.name, func(t *testing.T) {
			if got := jsonx.CheckText([]byte(js(tc.in))); got != tc.want {
				t.Errorf("CheckText(%q) = %v, quiero %v", js(tc.in), got, tc.want)
			}
		})
	}
}

// Lo que acepta CheckText y el decodificador lo da por valido no puede traer U+FFFD que el emisor no escribio:
// es lo que ocurre cuando encoding/json sustituye un escape suelto.
func TestCheckTextMatchesDecoder(t *testing.T) {
	in := js(`{"k":"@ud800"}`)
	m, ok := jsonx.Object([]byte(in))
	if !ok {
		t.Fatalf("Object no decodifica %q", in)
	}
	s, _ := jsonx.String(m["k"])
	if !strings.ContainsRune(s, utf8.RuneError) {
		t.Fatalf("el decodificador ya no sustituye el sustituto suelto: %q", s)
	}
	if jsonx.CheckText([]byte(in)) {
		t.Errorf("CheckText debe rechazar lo que el decodificador sustituye en silencio")
	}
}

func TestObject(t *testing.T) {
	valid := []struct {
		name string
		in   string
		keys int
	}{
		{"vacio", `{}`, 0},
		{"con espacios alrededor", "  {\"a\":1}  \n", 1},
		{"tabuladores y saltos", "\t\r\n{\"a\":1,\"b\":2}\r\n", 2},
		{"anidado", `{"a":{"b":{}}}`, 1},
	}
	for _, tc := range valid {
		t.Run("valido/"+tc.name, func(t *testing.T) {
			m, ok := jsonx.Object([]byte(tc.in))
			if !ok {
				t.Fatalf("Object(%q) = false", tc.in)
			}
			if m == nil {
				t.Fatalf("el mapa de %q no debe ser nil", tc.in)
			}
			if len(m) != tc.keys {
				t.Errorf("claves = %d, quiero %d", len(m), tc.keys)
			}
		})
	}

	invalid := []struct{ name, in string }{
		{"null", `null`},
		{"array", `[]`},
		{"array de objetos", `[{}]`},
		{"texto", `"x"`},
		{"numero", `1`},
		{"true", `true`},
		{"datos sobrantes", `{} x`},
		{"dos objetos", `{}{}`},
		{"objeto y coma", `{},`},
		{"valor ausente", `{"a":}`},
		{"coma final", `{"a":1,}`},
		{"sin cerrar", `{"a":1`},
		{"clave sin comillas", `{a:1}`},
		{"comillas simples", `{'a':1}`},
		{"vacio", ``},
		{"solo espacios", "  \n"},
		{"NaN", `{"a":NaN}`},
		{"escape invalido", `{"a":"\x"}`},
		{"control sin escapar", "{\"a\":\"\x01\"}"},
	}
	for _, tc := range invalid {
		t.Run("invalido/"+tc.name, func(t *testing.T) {
			m, ok := jsonx.Object([]byte(tc.in))
			if ok {
				t.Fatalf("Object(%q) = true, quiero false", tc.in)
			}
			if m != nil {
				t.Errorf("con ok=false el mapa debe ser nil, no %v", m)
			}
		})
	}

	t.Run("clave duplicada: gana la ultima", func(t *testing.T) {
		m, ok := jsonx.Object([]byte(`{"v":2,"v":1}`))
		if !ok {
			t.Fatalf("Object = false")
		}
		if len(m) != 1 {
			t.Errorf("claves = %d, quiero 1", len(m))
		}
		if string(m["v"]) != "1" {
			t.Errorf("v = %q, quiero 1", m["v"])
		}
	})

	t.Run("los bytes del valor van sin los espacios de alrededor", func(t *testing.T) {
		m, ok := jsonx.Object([]byte(`{ "a" :  { "x" : 1 } }`))
		if !ok {
			t.Fatalf("Object = false")
		}
		if got, want := string(m["a"]), `{ "x" : 1 }`; got != want {
			t.Errorf("a = %q, quiero %q", got, want)
		}
	})

	t.Run("las claves distinguen mayusculas", func(t *testing.T) {
		m, ok := jsonx.Object([]byte(`{"url":1,"URL":2}`))
		if !ok {
			t.Fatalf("Object = false")
		}
		if len(m) != 2 || string(m["url"]) != "1" || string(m["URL"]) != "2" {
			t.Errorf("mapa inesperado: %v", m)
		}
	})

	t.Run("el valor null se conserva como null", func(t *testing.T) {
		m, ok := jsonx.Object([]byte(`{"a":null}`))
		if !ok {
			t.Fatalf("Object = false")
		}
		raw, present := m["a"]
		if !present || string(raw) != "null" {
			t.Errorf("a = %q (presente=%v), quiero null presente", raw, present)
		}
	})
}

func TestString(t *testing.T) {
	valid := []struct{ in, want string }{
		{`"x"`, "x"},
		{`""`, ""},
		{`"A"`, "A"},
		{`"A"`, "A"},
		{`"a\"b\\c\n"`, "a\"b\\c\n"},
		{`"@u0041"`, "A"},
		{`"@ud83c@udfa8"`, "🎨"},
	}
	for _, tc := range valid {
		got, ok := jsonx.String(json.RawMessage(js(tc.in)))
		if !ok || got != tc.want {
			t.Errorf("String(%s) = %q, %v; quiero %q, true", tc.in, got, ok, tc.want)
		}
	}

	invalid := []string{``, `null`, `1`, `[]`, `{}`, `true`, `x`, `"x`, `"x"y`, ` "x"`, `"x" `, `"a" "b"`}
	for _, in := range invalid {
		if got, ok := jsonx.String(json.RawMessage(in)); ok || got != "" {
			t.Errorf("String(%s) = %q, %v; quiero \"\", false", in, got, ok)
		}
	}
}

func TestUint(t *testing.T) {
	const max = 9007199254740991 // Number.MAX_SAFE_INTEGER

	valid := []struct {
		in   string
		want int64
	}{
		{`0`, 0},
		{`1`, 1},
		{`10`, 10},
		{`9007199254740991`, 9007199254740991},
	}
	for _, tc := range valid {
		got, ok := jsonx.Uint(json.RawMessage(tc.in), max)
		if !ok || got != tc.want {
			t.Errorf("Uint(%s) = %d, %v; quiero %d, true", tc.in, got, ok, tc.want)
		}
	}

	invalid := []string{
		`9007199254740992`, // max + 1
		`-1`, `-0`, `+1`, `01`, `00`, `1.0`, `1.`, `.5`, `1e0`, `1E3`, `0x10`,
		`"1"`, `null`, `true`, `[]`, `{}`, ``, ` 1`, `1 `,
		`12345678901234567`, // 17 dígitos
		`99999999999999999999999999`,
	}
	for _, in := range invalid {
		if got, ok := jsonx.Uint(json.RawMessage(in), max); ok || got != 0 {
			t.Errorf("Uint(%s) = %d, %v; quiero 0, false", in, got, ok)
		}
	}

	t.Run("frontera del maximo del llamador", func(t *testing.T) {
		if got, ok := jsonx.Uint(json.RawMessage(`100`), 100); !ok || got != 100 {
			t.Errorf("Uint(100, max 100) = %d, %v", got, ok)
		}
		if got, ok := jsonx.Uint(json.RawMessage(`101`), 100); ok || got != 0 {
			t.Errorf("Uint(101, max 100) = %d, %v", got, ok)
		}
		if _, ok := jsonx.Uint(json.RawMessage(`0`), -1); ok {
			t.Errorf("Uint(0, max -1) debe ser false")
		}
	})

	t.Run("16 digitos es el tope aunque el maximo sea mayor", func(t *testing.T) {
		if got, ok := jsonx.Uint(json.RawMessage(`9999999999999999`), 1<<62); !ok || got != 9999999999999999 {
			t.Errorf("Uint(16 digitos) = %d, %v", got, ok)
		}
		if got, ok := jsonx.Uint(json.RawMessage(`10000000000000000`), 1<<62); ok || got != 0 {
			t.Errorf("Uint(17 digitos) = %d, %v", got, ok)
		}
	})
}

func TestInt(t *testing.T) {
	valid := []struct {
		in   string
		want int64
	}{
		{`-14737629`, -14737629},
		{`0`, 0},
		{`7`, 7},
		{`-1`, -1},
		{`9223372036854775807`, 9223372036854775807},
		{`-9223372036854775808`, -9223372036854775808},
	}
	for _, tc := range valid {
		got, ok := jsonx.Int(json.RawMessage(tc.in))
		if !ok || got != tc.want {
			t.Errorf("Int(%s) = %d, %v; quiero %d, true", tc.in, got, ok, tc.want)
		}
	}

	invalid := []string{
		`-0`, `1.5`, `1.0`, `1e3`, `01`, `-01`, `+1`, `--1`, `-`, `"1"`, `null`, `[]`, ``, ` 1`,
		`9223372036854775808`,  // max int64 + 1
		`-9223372036854775809`, // min int64 - 1
		`99999999999999999999`,
	}
	for _, in := range invalid {
		if got, ok := jsonx.Int(json.RawMessage(in)); ok || got != 0 {
			t.Errorf("Int(%s) = %d, %v; quiero 0, false", in, got, ok)
		}
	}
}

func TestBool(t *testing.T) {
	for in, want := range map[string]bool{`true`: true, `false`: false} {
		if got, ok := jsonx.Bool(json.RawMessage(in)); !ok || got != want {
			t.Errorf("Bool(%s) = %v, %v; quiero %v, true", in, got, ok, want)
		}
	}
	for _, in := range []string{`1`, `0`, `"true"`, `null`, `True`, `TRUE`, `[]`, ``, ` true`, `true `, `truee`} {
		if got, ok := jsonx.Bool(json.RawMessage(in)); ok || got {
			t.Errorf("Bool(%s) = %v, %v; quiero false, false", in, got, ok)
		}
	}
}

func TestArray(t *testing.T) {
	t.Run("vacio", func(t *testing.T) {
		a, ok := jsonx.Array(json.RawMessage(`[]`))
		if !ok || a == nil || len(a) != 0 {
			t.Errorf("Array([]) = %v, %v; quiero vacio no nil, true", a, ok)
		}
	})
	t.Run("elementos en bruto sin espacios de alrededor", func(t *testing.T) {
		a, ok := jsonx.Array(json.RawMessage(`[ 1 , "x" ,{ "k" : null }, [ 2 ] ]`))
		if !ok {
			t.Fatalf("Array = false")
		}
		want := []string{`1`, `"x"`, `{ "k" : null }`, `[ 2 ]`}
		if len(a) != len(want) {
			t.Fatalf("elementos = %d, quiero %d", len(a), len(want))
		}
		for i := range want {
			if string(a[i]) != want[i] {
				t.Errorf("a[%d] = %q, quiero %q", i, a[i], want[i])
			}
		}
	})
	for _, in := range []string{`{}`, `null`, `1`, `"x"`, `true`, ``, `[`, `[1,]`, `[1] x`, ` []`, `[] `} {
		if a, ok := jsonx.Array(json.RawMessage(in)); ok || a != nil {
			t.Errorf("Array(%s) = %v, %v; quiero nil, false", in, a, ok)
		}
	}
}

func TestReadFileLimit(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "ten.json")
	if err := os.WriteFile(path, []byte("0123456789"), 0o600); err != nil {
		t.Fatal(err)
	}

	t.Run("exactamente max", func(t *testing.T) {
		got, err := jsonx.ReadFileLimit(path, 10)
		if err != nil {
			t.Fatalf("error inesperado: %v", err)
		}
		if string(got) != "0123456789" {
			t.Errorf("contenido = %q", got)
		}
	})
	t.Run("holgado", func(t *testing.T) {
		got, err := jsonx.ReadFileLimit(path, 1<<20)
		if err != nil || string(got) != "0123456789" {
			t.Errorf("ReadFileLimit = %q, %v", got, err)
		}
	})
	t.Run("max - 1 es ErrFileTooLarge", func(t *testing.T) {
		got, err := jsonx.ReadFileLimit(path, 9)
		if !errors.Is(err, jsonx.ErrFileTooLarge) {
			t.Fatalf("error = %v, quiero ErrFileTooLarge", err)
		}
		if got != nil {
			t.Errorf("con error el contenido debe ser nil")
		}
	})
	t.Run("max 0 con archivo vacio", func(t *testing.T) {
		empty := filepath.Join(dir, "empty.json")
		if err := os.WriteFile(empty, nil, 0o600); err != nil {
			t.Fatal(err)
		}
		got, err := jsonx.ReadFileLimit(empty, 0)
		if err != nil || len(got) != 0 {
			t.Errorf("ReadFileLimit = %q, %v; quiero vacio sin error", got, err)
		}
		if _, err := jsonx.ReadFileLimit(path, 0); !errors.Is(err, jsonx.ErrFileTooLarge) {
			t.Errorf("archivo de 10 bytes con max 0: error = %v, quiero ErrFileTooLarge", err)
		}
	})
	t.Run("max negativo", func(t *testing.T) {
		if _, err := jsonx.ReadFileLimit(path, -1); !errors.Is(err, jsonx.ErrFileTooLarge) {
			t.Errorf("error = %v, quiero ErrFileTooLarge", err)
		}
	})
	t.Run("max enorme no desborda", func(t *testing.T) {
		got, err := jsonx.ReadFileLimit(path, 1<<63-1)
		if err != nil || string(got) != "0123456789" {
			t.Errorf("ReadFileLimit = %q, %v", got, err)
		}
	})
	t.Run("inexistente", func(t *testing.T) {
		_, err := jsonx.ReadFileLimit(filepath.Join(dir, "no-existe.json"), 10)
		if !errors.Is(err, fs.ErrNotExist) {
			t.Errorf("error = %v, quiero fs.ErrNotExist", err)
		}
		if errors.Is(err, jsonx.ErrFileTooLarge) {
			t.Errorf("un archivo inexistente no es ErrFileTooLarge")
		}
	})
	t.Run("un directorio no es un archivo legible", func(t *testing.T) {
		if _, err := jsonx.ReadFileLimit(dir, 10); err == nil {
			t.Errorf("leer un directorio debe fallar")
		}
	})
}

func FuzzCheckText(f *testing.F) {
	for _, tc := range checkTextCases {
		f.Add([]byte(js(tc.in)))
	}
	f.Add([]byte(`{"v":1,"cmd":"ping","args":{}}`))
	f.Add([]byte(js(`{"a":"@u12`)))

	f.Fuzz(func(t *testing.T, b []byte) {
		if !jsonx.CheckText(b) {
			return
		}
		m, ok := jsonx.Object(b)
		if !ok {
			return
		}
		if !utf8.Valid(b) {
			t.Fatalf("CheckText y Object aceptan un marco con UTF-8 invalido")
		}
		// Un marco aceptado no puede traer un sustituto suelto que el decodificador haya cambiado en
		// silencio por U+FFFD. Si algun texto de primer nivel lo contiene, el emisor tuvo que escribirlo
		// (en bruto o como escape), y entonces no hay nada que comprobar.
		if bytes.Contains(b, []byte("\xef\xbf\xbd")) || bytes.Contains(bytes.ToLower(b), []byte(js("@ufffd"))) {
			return
		}
		for k, raw := range m {
			if strings.ContainsRune(k, utf8.RuneError) {
				t.Fatalf("clave con U+FFFD que el emisor no escribio")
			}
			if s, isString := jsonx.String(raw); isString && strings.ContainsRune(s, utf8.RuneError) {
				t.Fatalf("valor con U+FFFD que el emisor no escribio")
			}
		}
	})
}
