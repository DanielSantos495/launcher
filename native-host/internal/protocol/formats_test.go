package protocol_test

import (
	"strings"
	"testing"
	"time"

	"github.com/DanielSantos495/launcher/native-host/internal/protocol"
)

// chr devuelve el caracter U+XXXX. Los caracteres especiales (invisibles o de control) se construyen con su
// numero para que ninguna herramienta ni editor los cambie por otro: en el codigo fuente no aparecen en claro.
func chr(cp rune) string { return string(cp) }

// esc devuelve el escape JSON de cuatro digitos hexadecimales (barra invertida, "u" y los digitos). Se construye
// por partes para que ninguna herramienta lo convierta en el caracter que representa.
func esc(hex string) string { return "\\" + "u" + hex }

type formatCase struct {
	name string
	in   string
	want bool
}

func runFormat(t *testing.T, fn func(string) bool, cases []formatCase) {
	t.Helper()
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := fn(tc.in); got != tc.want {
				t.Fatalf("got %v, want %v", got, tc.want)
			}
		})
	}
}

func TestValidProfileDirectory(t *testing.T) {
	runFormat(t, protocol.ValidProfileDirectory, []formatCase{
		{"Default", "Default", true},
		{"con espacio", "Profile 1", true},
		{"Launcher-", "Launcher-1a2b3c4d", true},
		{"255 ASCII", strings.Repeat("a", 255), true},
		{"255 unidades UTF-16 con emoji", strings.Repeat("🎨", 127) + "a", true},
		{"tres puntos", "...", true},
		{"guion no inicial", "a-", true},
		{"punto interno", "a.b", true},
		{"tilde", "perfil-ñandú", true},
		{"comilla simple", "a'b", true},
		{"vacio", "", false},
		{"256 ASCII", strings.Repeat("a", 256), false},
		{"256 unidades UTF-16 con emoji", strings.Repeat("🎨", 128), false},
		{"punto", ".", false},
		{"dos puntos", "..", false},
		{"barra", "a/b", false},
		{"barra invertida", `a\b`, false},
		{"solo barra", "/", false},
		{"guion inicial", "-a", false},
		{"solo guion", "-", false},
		{"NUL", "a\x00", false},
		{"C0 0x1f", "a\x1f", false},
		{"espacio 0x20 vale", "a b", true},
		{"DEL", "a\x7f", false},
		{"C1 U+0080", "a" + chr(0x80), false},
		{"C1 U+0085", "a" + chr(0x85), false},
		{"C1 U+009F", "a" + chr(0x9f), false},
		{"U+00A0 no es control", "a" + chr(0xa0), true},
		{"UTF-8 invalido", "a\xff", false},
		{"sustituto codificado en UTF-8", "a\xed\xa0\x80", false},
	})
}

func TestValidContainerName(t *testing.T) {
	runFormat(t, protocol.ValidContainerName, []formatCase{
		{"Trabajo", "Trabajo", true},
		{"con espacio", "Mi contenedor", true},
		{"espacio inicial pero no en blanco", " a", true},
		{"U+FEFF seguido de letra", chr(0xfeff) + "a", true},
		{"64 emoji", strings.Repeat("🎨", 64), true},
		{"64 ASCII", strings.Repeat("a", 64), true},
		{"tilde", "ñandú", true},
		{"U+180E solo no se recorta en JS", chr(0x180e), true},
		{"guion interno", "a-b", true},
		{"vacio", "", false},
		{"65 emoji", strings.Repeat("🎨", 65), false},
		{"65 ASCII", strings.Repeat("a", 65), false},
		{"solo U+FEFF", chr(0xfeff), false},
		{"U+00A0 y U+2003", chr(0xa0) + chr(0x2003), false},
		{"solo U+3000", chr(0x3000), false},
		{"solo U+2028", chr(0x2028), false},
		{"espacio, tabulador y salto", " \t\n", false},
		{"guion inicial", "-x", false},
		{"solo guion", "-", false},
		{"igual", "a=b", false},
		{"solo igual", "=", false},
		{"C0 U+0007", "a" + chr(0x07), false},
		{"C1 U+0085", "a" + chr(0x85), false},
		{"C1 U+0080", "a" + chr(0x80), false},
		{"C1 U+009F", "a" + chr(0x9f), false},
		{"DEL", "a" + chr(0x7f), false},
		{"U+0085 solo: control, no espacio", chr(0x85), false},
		{"UTF-8 invalido", "a\xff", false},
	})
}

// jsSpaces son exactamente los caracteres que quita String.prototype.trim (copiados de la especificacion de JS).
func jsSpaces() []rune {
	spaces := []rune{0x20, 0xa0, 0x1680, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff}
	for r := rune(0x09); r <= 0x0d; r++ {
		spaces = append(spaces, r)
	}
	for r := rune(0x2000); r <= 0x200a; r++ {
		spaces = append(spaces, r)
	}
	return spaces
}

// TestContainerNameBlank: cada espacio de trim, solo, deja el nombre en blanco (invalido); acompanado de una letra
// vale, salvo los de control (U+0009 a U+000D), que se rechazan por la regla de controles.
func TestContainerNameBlank(t *testing.T) {
	for _, sp := range jsSpaces() {
		alone := chr(sp)
		if protocol.ValidContainerName(alone) {
			t.Errorf("U+%04X solo deberia ser invalido (en blanco)", sp)
		}
		if protocol.ValidContainerName(alone + alone + alone) {
			t.Errorf("U+%04X repetido deberia ser invalido (en blanco)", sp)
		}
		control := sp >= 0x09 && sp <= 0x0d
		if got := protocol.ValidContainerName(alone + "a"); got == control {
			t.Errorf("U+%04X seguido de 'a': got %v, want %v", sp, got, !control)
		}
	}
	// JS no recorta U+180E (ya no es un espacio Unicode) ni U+0085 (que ademas es un control C1).
	if !protocol.ValidContainerName(chr(0x180e)) {
		t.Error("U+180E solo deberia ser valido: no esta en blanco para trim")
	}
	if protocol.ValidContainerName(chr(0x85)) {
		t.Error("U+0085 solo deberia ser invalido: es un control C1")
	}
}

func TestValidID(t *testing.T) {
	runFormat(t, protocol.ValidID, []formatCase{
		{"una letra", "a", true},
		{"64 caracteres", strings.Repeat("a", 64), true},
		{"alfabeto completo", "abcXYZ019_-", true},
		{"Constructor con mayuscula", "Constructor", true},
		{"__proto__x", "__proto__x", true},
		{"65 caracteres", strings.Repeat("a", 65), false},
		{"vacio", "", false},
		{"punto", "a.b", false},
		{"eñe", "ñ", false},
		{"espacio", "a b", false},
		{"salto final", "a\n", false},
		{"__proto__", "__proto__", false},
		{"constructor", "constructor", false},
		{"prototype", "prototype", false},
		{"digito arabe", chr(0x661), false},
	})
}

func TestValidToken(t *testing.T) {
	runFormat(t, protocol.ValidToken, []formatCase{
		{"43", strings.Repeat("a", 43), true},
		{"alfabeto base64url", "abcdefghijABCDEFGHIJ0123456789_-abcdefghijk", true},
		{"42", strings.Repeat("a", 42), false},
		{"44", strings.Repeat("a", 44), false},
		{"con igual", strings.Repeat("a", 42) + "=", false},
		{"con mas", strings.Repeat("a", 42) + "+", false},
		{"con barra", strings.Repeat("a", 42) + "/", false},
		{"salto final", strings.Repeat("a", 43) + "\n", false},
		{"vacio", "", false},
		{"ñ de 2 bytes", strings.Repeat("a", 41) + "ñ", false},
	})
}

func TestValidCode(t *testing.T) {
	arabic := ""
	for r := rune(0x661); r <= 0x666; r++ {
		arabic += chr(r)
	}
	runFormat(t, protocol.ValidCode, []formatCase{
		{"000000", "000000", true},
		{"123456", "123456", true},
		{"5 cifras", "12345", false},
		{"7 cifras", "1234567", false},
		{"con letra", "12345a", false},
		{"digitos arabes", arabic, false},
		{"salto final", "123456\n", false},
		{"vacio", "", false},
		{"espacio", "12 456", false},
	})
}

func TestValidNonce(t *testing.T) {
	runFormat(t, protocol.ValidNonce, []formatCase{
		{"16", strings.Repeat("a", 16), true},
		{"64", strings.Repeat("a", 64), true},
		{"alfabeto", "step0-nonce_0001", true},
		{"15", strings.Repeat("a", 15), false},
		{"65", strings.Repeat("a", 65), false},
		{"con punto", strings.Repeat("a", 15) + ".", false},
		{"vacio", "", false},
	})
}

func TestValidIconKey(t *testing.T) {
	runFormat(t, protocol.ValidIconKey, []formatCase{
		{"icon:a", "icon:a", true},
		{"icon: + 64", "icon:" + strings.Repeat("a", 64), true},
		{"icon:gh1", "icon:gh1", true},
		{"icon: vacio", "icon:", false},
		{"icon: + 65", "icon:" + strings.Repeat("a", 65), false},
		{"Icon mayuscula", "Icon:a", false},
		{"punto", "icon:a.b", false},
		{"sin prefijo", "a", false},
		{"vacio", "", false},
		{"dos puntos", "icon:a:b", false},
	})
}

func TestValidMime(t *testing.T) {
	runFormat(t, protocol.ValidMime, []formatCase{
		{"png", "image/png", true},
		{"jpeg", "image/jpeg", true},
		{"webp", "image/webp", true},
		{"svg", "image/svg+xml", false},
		{"mayusculas", "IMAGE/PNG", false},
		{"gif", "image/gif", false},
		{"vacio", "", false},
		{"con espacio", "image/png ", false},
	})
}

func TestValidBase64(t *testing.T) {
	runFormat(t, protocol.ValidBase64, []formatCase{
		{"AAAA", "AAAA", true},
		{"AA==", "AA==", true},
		{"AAA=", "AAA=", true},
		{"AAAAAAA=", "AAAAAAA=", true},
		{"alfabeto estandar con + y /", "+/+/", true},
		{"icono real", "iVBORw0KGgo=", true},
		{"32768 bytes (43691 A y relleno)", strings.Repeat("A", 43691) + "=", true},
		{"32767 bytes (43690 A y dos de relleno)", strings.Repeat("A", 43690) + "==", true},
		// Los bits sobrantes del ultimo caracter no se comprueban (no se usa Strict).
		{"bits sobrantes AB==", "AB==", true},
		{"bits sobrantes AAB=", "AAB=", true},
		{"vacio", "", false},
		{"3 caracteres", "AAA", false},
		{"relleno de mas A===", "A===", false},
		{"relleno en medio AA=A", "AA=A", false},
		{"relleno solo", "====", false},
		{"relleno doble en medio", "AA==AAAA", false},
		{"alfabeto de URL", "-_AA", false},
		{"salto final", "AAAA\n", false},
		{"longitud no multiplo de 4", "AAAAA", false},
		{"un solo caracter de relleno tras 4", "AAAA=", false},
		{"32769 bytes (43692 A)", strings.Repeat("A", 43692), false},
		{"43696 caracteres", strings.Repeat("A", 43696), false},
		{"digito arabe", "AAA" + chr(0x661), false},
	})
}

func TestValidColor(t *testing.T) {
	runFormat(t, protocol.ValidColor, []formatCase{
		{"minusculas", "#1f6feb", true},
		{"mayusculas", "#1F6FEB", true},
		{"mezcla", "#aAbB09", true},
		{"5 digitos", "#1f6fe", false},
		{"7 digitos", "#1f6feb0", false},
		{"sin almohadilla", "1f6feb", false},
		{"no hexadecimal", "#1f6feg", false},
		{"vacio", "", false},
		{"salto final", "#1f6feb\n", false},
		{"alfa", "#1f6feb80", false},
	})
}

func TestValidTimestamp(t *testing.T) {
	runFormat(t, protocol.ValidTimestamp, []formatCase{
		{"canonica", "2026-10-08T12:00:00.000Z", true},
		{"milisegundos", "2026-10-08T12:00:00.005Z", true},
		{"29 de febrero bisiesto", "2024-02-29T00:00:00.000Z", true},
		{"anio 0000", "0000-01-01T00:00:00.000Z", true},
		{"anio 9999", "9999-12-31T23:59:59.999Z", true},
		{"sin milisegundos", "2026-10-08T12:00:00Z", false},
		{"con desplazamiento", "2026-10-08T12:00:00.000+00:00", false},
		{"30 de febrero", "2026-02-30T00:00:00.000Z", false},
		{"29 de febrero no bisiesto", "2026-02-29T00:00:00.000Z", false},
		{"minusculas", "2026-10-08t12:00:00.000z", false},
		{"hora 24", "2026-10-08T24:00:00.000Z", false},
		{"minuto 60", "2026-10-08T12:60:00.000Z", false},
		{"segundo 60", "2026-10-08T12:00:60.000Z", false},
		{"mes 13", "2026-13-08T12:00:00.000Z", false},
		{"mes 00", "2026-00-08T12:00:00.000Z", false},
		{"dia 00", "2026-10-00T12:00:00.000Z", false},
		{"hora de un digito", "2026-10-08T5:00:00.000Z", false},
		{"dia de un digito", "2026-10-8T12:00:00.000Z", false},
		{"espacio en lugar de T", "2026-10-08 12:00:00.000Z", false},
		{"espacio final", "2026-10-08T12:00:00.000Z ", false},
		{"salto final", "2026-10-08T12:00:00.000Z\n", false},
		{"anio de 6 cifras", "+012026-10-08T12:00:00.000Z", false},
		{"digito arabe", "2026-10-08T12:00:00.00" + chr(0x660) + "Z", false},
		{"vacio", "", false},
	})
}

func TestFormatAndParseTime(t *testing.T) {
	zone := time.FixedZone("x", 7200)
	got := protocol.FormatTime(time.Date(2026, 10, 8, 14, 0, 0, 5e6, zone))
	if want := "2026-10-08T12:00:00.005Z"; got != want {
		t.Fatalf("FormatTime = %q, want %q", got, want)
	}
	// Los nanosegundos por debajo del milisegundo se truncan, no se redondean.
	got = protocol.FormatTime(time.Date(2026, 10, 8, 12, 0, 0, 999_999_999, time.UTC))
	if want := "2026-10-08T12:00:00.999Z"; got != want {
		t.Fatalf("FormatTime = %q, want %q", got, want)
	}

	parsed, ok := protocol.ParseTime("2026-10-08T12:00:00.005Z")
	if !ok {
		t.Fatal("ParseTime rechaza una marca canonica")
	}
	if want := time.Date(2026, 10, 8, 12, 0, 0, 5e6, time.UTC); !parsed.Equal(want) {
		t.Fatalf("ParseTime = %v, want %v", parsed, want)
	}
	if protocol.FormatTime(parsed) != "2026-10-08T12:00:00.005Z" {
		t.Fatal("FormatTime(ParseTime(s)) != s")
	}
	if _, ok := protocol.ParseTime("2026-10-08T12:00:00Z"); ok {
		t.Fatal("ParseTime acepta una marca sin milisegundos")
	}
}

func TestUTF16Len(t *testing.T) {
	tests := []struct {
		in   string
		want int
	}{
		{"", 0},
		{"a", 1},
		{"ñ", 1},
		{"🎨", 2},
		{"a🎨b", 4},
		{chr(0x10000), 2},
		{chr(0xffff), 1},
		{chr(0x20ac), 1},
	}
	for _, tc := range tests {
		if got := protocol.UTF16Len(tc.in); got != tc.want {
			t.Errorf("UTF16Len(%q) = %d, want %d", tc.in, got, tc.want)
		}
	}
}

func TestHasControlChars(t *testing.T) {
	runFormat(t, protocol.HasControlChars, []formatCase{
		{"vacio", "", false},
		{"texto", "hola", false},
		{"C0 U+0000", "a\x00", true},
		{"C0 U+0009", "a\t", true},
		{"C0 U+000A", "a\n", true},
		{"C0 U+001F", "a\x1f", true},
		{"U+0020 no es control", "a b", false},
		{"U+007E no es control", "a~", false},
		{"DEL", "a\x7f", true},
		{"C1 U+0080", "a" + chr(0x80), true},
		{"C1 U+0085", "a" + chr(0x85), true},
		{"C1 U+009F", "a" + chr(0x9f), true},
		{"U+00A0 no es control", "a" + chr(0xa0), false},
		{"emoji", "🎨", false},
		{"U+2028 no es control", chr(0x2028), false},
	})
}
