package protocol

import (
	"strings"
	"time"
	"unicode/utf8"
)

// maxProfileDirectory es el máximo de ProfileDirectorySchema (packages/core/src/schema.ts), en unidades UTF-16.
const maxProfileDirectory = 255

// timeLayout es la forma de Date.prototype.toISOString(): milisegundos y "Z".
const timeLayout = "2006-01-02T15:04:05.000Z"

// reservedIDs no son claves de objeto seguras en JavaScript; ningún id puede coincidir con ellos.
var reservedIDs = []string{"__proto__", "constructor", "prototype"}

// ValidProfileDirectory sigue ProfileDirectorySchema: 1 a 255 unidades UTF-16, no "." ni "..", sin "/" ni "\", sin
// "-" inicial y sin caracteres de control. Un UTF-8 inválido no vale (JSON ya lo ha descartado en las peticiones).
func ValidProfileDirectory(s string) bool {
	if s == "" || s == "." || s == ".." || s[0] == '-' || !utf8.ValidString(s) {
		return false
	}
	return UTF16Len(s) <= maxProfileDirectory && !strings.ContainsAny(s, `/\`) && !HasControlChars(s)
}

// ValidContainerName sigue isValidContainerName: como mucho 64 puntos de código, no en blanco (lo que quita
// String.prototype.trim), sin "-" inicial, sin "=" y sin caracteres de control.
func ValidContainerName(s string) bool {
	if !utf8.ValidString(s) || utf8.RuneCountInString(s) > MaxContainerName {
		return false
	}
	if strings.HasPrefix(s, "-") || strings.Contains(s, "=") || HasControlChars(s) {
		return false
	}
	return strings.IndexFunc(s, func(r rune) bool { return !isJSSpace(r) }) != -1
}

// isJSSpace dice si String.prototype.trim quitaría r: los espacios Unicode (Zs), los terminadores de línea y
// U+FEFF. strings.TrimSpace no coincide: no cuenta U+FEFF y sí U+0085. U+180E no se quita en JS moderno.
func isJSSpace(r rune) bool {
	switch {
	case r >= 0x0009 && r <= 0x000D, r == 0x0020, r == 0x00A0, r == 0x1680, r >= 0x2000 && r <= 0x200A,
		r == 0x2028, r == 0x2029, r == 0x202F, r == 0x205F, r == 0x3000, r == 0xFEFF:
		return true
	}
	return false
}

// ValidID sigue IdSchema: ^[A-Za-z0-9_-]{1,64}$ y distinto de __proto__, constructor y prototype.
func ValidID(s string) bool {
	if !isClass(s, 1, 64, isIDChar) {
		return false
	}
	for _, reserved := range reservedIDs {
		if s == reserved {
			return false
		}
	}
	return true
}

// ValidToken: ^[A-Za-z0-9_-]{43}$ (256 bits en base64url sin relleno).
func ValidToken(s string) bool { return isClass(s, 43, 43, isIDChar) }

// ValidCode: ^[0-9]{6}$ (solo cifras ASCII).
func ValidCode(s string) bool { return isClass(s, 6, 6, isDigit) }

// ValidNonce: ^[A-Za-z0-9_-]{16,64}$.
func ValidNonce(s string) bool { return isClass(s, 16, 64, isIDChar) }

// ValidIconKey: ^icon:[A-Za-z0-9_-]{1,64}$.
func ValidIconKey(s string) bool {
	rest, ok := strings.CutPrefix(s, "icon:")
	return ok && isClass(rest, 1, 64, isIDChar)
}

// ValidMime: image/png, image/jpeg o image/webp (nada de image/svg+xml).
func ValidMime(s string) bool {
	return s == "image/png" || s == "image/jpeg" || s == "image/webp"
}

// ValidBase64 sigue Base64Schema: alfabeto estándar con relleno "=", entre 4 y 43692 caracteres, en la forma
// ^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$ y con un tamaño decodificado de como mucho
// 32768 bytes (longitud / 4 * 3 - relleno). No comprueba los bits sobrantes del último carácter.
func ValidBase64(s string) bool {
	n := len(s)
	if n < 4 || n > MaxBase64Chars || n%4 != 0 {
		return false
	}
	padding := 0
	switch {
	case strings.HasSuffix(s, "=="):
		padding = 2
	case strings.HasSuffix(s, "="):
		padding = 1
	}
	for i := 0; i < n-padding; i++ {
		if !isBase64Char(s[i]) {
			return false
		}
	}
	return n/4*3-padding <= MaxIconBytes
}

// ValidColor: ^#[0-9a-fA-F]{6}$.
func ValidColor(s string) bool {
	return len(s) == 7 && s[0] == '#' && isClass(s[1:], 6, 6, isHex)
}

// ValidTimestamp dice si s es exactamente la forma de toISOString() (YYYY-MM-DDTHH:mm:ss.sssZ) y una fecha real.
func ValidTimestamp(s string) bool {
	_, ok := ParseTime(s)
	return ok
}

// FormatTime escribe t como toISOString(): en UTC, con milisegundos y "Z".
func FormatTime(t time.Time) string { return t.UTC().Format(timeLayout) }

// ParseTime lee una marca canónica. time.Parse por sí solo admite formas que toISOString nunca escribe (una hora
// de un dígito, por ejemplo), así que se exige que al volver a escribirla salga el mismo texto.
func ParseTime(s string) (time.Time, bool) {
	t, err := time.Parse(timeLayout, s)
	if err != nil || FormatTime(t) != s {
		return time.Time{}, false
	}
	return t, true
}

// HasControlChars dice si s contiene algún carácter de control: C0 (U+0000 a U+001F), DEL (U+007F) o C1
// (U+0080 a U+009F). Es hasControlChars de packages/core/src/text.ts sin excepciones.
func HasControlChars(s string) bool {
	for _, r := range s {
		if r < 0x20 || (r >= 0x7f && r <= 0x9f) {
			return true
		}
	}
	return false
}

// UTF16Len cuenta las unidades UTF-16 de s, como String.length de JavaScript: un emoji cuenta 2.
func UTF16Len(s string) int {
	n := 0
	for _, r := range s {
		if r >= 0x10000 {
			n += 2
		} else {
			n++
		}
	}
	return n
}

// isClass comprueba que s tenga entre min y max bytes y que todos cumplan ok. Los alfabetos son ASCII, así que
// bytes y caracteres coinciden: un carácter no ASCII falla en ok.
func isClass(s string, min, max int, ok func(byte) bool) bool {
	if len(s) < min || len(s) > max {
		return false
	}
	for i := 0; i < len(s); i++ {
		if !ok(s[i]) {
			return false
		}
	}
	return true
}

func isDigit(c byte) bool { return c >= '0' && c <= '9' }

func isHex(c byte) bool { return isDigit(c) || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F') }

func isIDChar(c byte) bool {
	return isDigit(c) || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c == '_' || c == '-'
}

func isBase64Char(c byte) bool {
	return isDigit(c) || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c == '+' || c == '/'
}
