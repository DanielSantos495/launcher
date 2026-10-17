// Package jsonx reúne la decodificación estricta de JSON que necesita el host. Todo lo que llega del navegador
// se decodifica como mapa de claves a json.RawMessage y se compara con claves exactas (nunca a structs, que
// emparejan las claves sin distinguir mayúsculas), y los enteros solo se aceptan con dígitos.
package jsonx

import (
	"encoding/json"
	"errors"
	"io"
	"math"
	"os"
	"strconv"
	"unicode/utf8"
)

// ErrFileTooLarge indica que un archivo supera el máximo permitido por ReadFileLimit.
var ErrFileTooLarge = errors.New("jsonx: archivo demasiado grande")

// maxUintDigits limita Uint a 16 dígitos: basta para Number.MAX_SAFE_INTEGER (9007199254740991) y evita
// recorrer números gigantes.
const maxUintDigits = 16

// CheckText comprueba que b sea UTF-8 válido y que no contenga, dentro de un texto JSON, ningún escape de
// sustituto UTF-16 (D800 a DFFF) que no forme un par alto + bajo. json.Unmarshal los cambia en silencio por
// U+FFFD y json.Valid los da por buenos, así que se miran antes de decodificar. Es tolerante con el JSON
// inválido (un escape truncado no cuenta): lo rechazará el decodificador.
func CheckText(b []byte) bool {
	return utf8.Valid(b) && !hasLoneSurrogate(b)
}

// hasLoneSurrogate recorre los textos JSON y busca escapes de sustituto sueltos. Es tolerante con JSON
// inválido: si algo no cuadra, devuelve false y el decodificador lo rechazará.
func hasLoneSurrogate(b []byte) bool {
	inString := false
	for i := 0; i < len(b); i++ {
		c := b[i]
		if !inString {
			inString = c == '"'
			continue
		}
		switch c {
		case '"':
			inString = false
		case '\\':
			if i+1 >= len(b) {
				return false
			}
			if b[i+1] != 'u' {
				// Escape de un carácter (\" \\ \n...): se salta, así una comilla escapada no cierra el texto.
				i++
				continue
			}
			r, ok := hex4(b, i+2)
			if !ok {
				return false
			}
			switch {
			case r >= 0xDC00 && r <= 0xDFFF:
				return true
			case r >= 0xD800 && r <= 0xDBFF:
				// Un sustituto alto solo vale si le sigue, justo después, un escape de sustituto bajo.
				if i+11 < len(b) && b[i+6] == '\\' && b[i+7] == 'u' {
					if lo, ok := hex4(b, i+8); ok && lo >= 0xDC00 && lo <= 0xDFFF {
						i += 11
						continue
					}
				}
				return true
			}
			i += 5
		}
	}
	return false
}

// hex4 lee cuatro dígitos hexadecimales en b[at:at+4]. Devuelve false si no caben o alguno no es hexadecimal.
func hex4(b []byte, at int) (rune, bool) {
	if at < 0 || at+4 > len(b) {
		return 0, false
	}
	var r rune
	for _, c := range b[at : at+4] {
		var d byte
		switch {
		case c >= '0' && c <= '9':
			d = c - '0'
		case c >= 'a' && c <= 'f':
			d = c - 'a' + 10
		case c >= 'A' && c <= 'F':
			d = c - 'A' + 10
		default:
			return 0, false
		}
		r = r<<4 | rune(d)
	}
	return r, true
}

// Object decodifica un objeto JSON (con espacios alrededor, sin datos sobrantes) a un mapa de claves a bytes en
// bruto de cada valor (sin los espacios de alrededor). Un array, un texto, un número, null o JSON inválido
// devuelven ok=false. Con claves duplicadas gana la última, como JSON.parse.
func Object(raw []byte) (map[string]json.RawMessage, bool) {
	var m map[string]json.RawMessage
	if err := json.Unmarshal(raw, &m); err != nil {
		return nil, false
	}
	// Con null, Unmarshal no da error y deja el mapa en nil.
	if m == nil {
		return nil, false
	}
	return m, true
}

// String decodifica un texto JSON: el primer y el último byte deben ser '"' (sin espacios de alrededor, como
// los entrega Object). null u otro tipo devuelven ok=false. No mira los sustitutos sueltos ni el UTF-8 inválido
// (json.Unmarshal los cambia por U+FFFD): de eso se encarga CheckText sobre el marco entero, antes de decodificar.
func String(raw json.RawMessage) (string, bool) {
	if len(raw) < 2 || raw[0] != '"' || raw[len(raw)-1] != '"' {
		return "", false
	}
	var s string
	if err := json.Unmarshal(raw, &s); err != nil {
		return "", false
	}
	return s, true
}

// Uint decodifica un entero sin signo escrito solo con dígitos (^(0|[1-9][0-9]*)$: sin signo, fracción,
// exponente ni ceros a la izquierda), de como mucho 16 dígitos y con valor <= max.
func Uint(raw json.RawMessage, max int64) (int64, bool) {
	if len(raw) == 0 || len(raw) > maxUintDigits || !isDigits(raw) {
		return 0, false
	}
	v, err := strconv.ParseInt(string(raw), 10, 64)
	if err != nil || v > max {
		return 0, false
	}
	return v, true
}

// Int decodifica un entero con signo opcional (^-?(0|[1-9][0-9]*)$, sin "-0") que quepa en int64. Es para
// profile_highlight_color de Local State.
func Int(raw json.RawMessage) (int64, bool) {
	digits := raw
	if len(digits) > 0 && digits[0] == '-' {
		digits = digits[1:]
		if string(digits) == "0" {
			return 0, false
		}
	}
	if !isDigits(digits) {
		return 0, false
	}
	v, err := strconv.ParseInt(string(raw), 10, 64)
	if err != nil {
		return 0, false
	}
	return v, true
}

// isDigits comprueba ^(0|[1-9][0-9]*)$: al menos un dígito y sin ceros a la izquierda.
func isDigits(b []byte) bool {
	if len(b) == 0 || (b[0] == '0' && len(b) > 1) {
		return false
	}
	for _, c := range b {
		if c < '0' || c > '9' {
			return false
		}
	}
	return true
}

// Bool decodifica exactamente true o false.
func Bool(raw json.RawMessage) (bool, bool) {
	switch string(raw) {
	case "true":
		return true, true
	case "false":
		return false, true
	}
	return false, false
}

// Array decodifica un array JSON (primer byte '[' y último ']', sin espacios de alrededor) a los bytes en bruto
// de sus elementos.
func Array(raw json.RawMessage) ([]json.RawMessage, bool) {
	if len(raw) < 2 || raw[0] != '[' || raw[len(raw)-1] != ']' {
		return nil, false
	}
	var a []json.RawMessage
	if err := json.Unmarshal(raw, &a); err != nil {
		return nil, false
	}
	return a, true
}

// ReadFileLimit lee un archivo de como mucho max bytes; si es más grande devuelve ErrFileTooLarge. Nunca lee
// más de max+1 bytes.
func ReadFileLimit(path string, max int64) ([]byte, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	limit := max
	if limit < math.MaxInt64 {
		limit++ // un byte de más para distinguir "justo max" de "más de max"
	}
	data, err := io.ReadAll(io.LimitReader(f, limit))
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > max {
		return nil, ErrFileTooLarge
	}
	return data, nil
}
