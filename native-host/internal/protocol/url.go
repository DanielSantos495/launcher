package protocol

import (
	"strconv"
	"strings"
)

// Caracteres que cada componente excluye además del espacio y de lo que no es ASCII imprimible
// (fixtures/README.md, «URL: gramática G»; son los de grammarError en packages/core/src/url.ts).
const (
	pathExcluded     = "\"#<>?`{}\\"
	queryExcluded    = "\"#<>'"
	fragmentExcluded = "\"<>`"
)

// ValidURL dice si s está en la gramática G (fixtures/README.md, ADR-004 punto 6). Es la traducción literal de
// grammarError de packages/core/src/url.ts: mismo orden, mismas reglas.
func ValidURL(s string) bool {
	if s == "" || len(s) > MaxURLLength {
		return false
	}
	for i := 0; i < len(s); i++ {
		if s[i] < 0x21 || s[i] > 0x7e {
			return false
		}
	}
	var scheme, rest string
	switch {
	case strings.HasPrefix(s, "https://"):
		scheme, rest = "https", s[len("https://"):]
	case strings.HasPrefix(s, "http://"):
		scheme, rest = "http", s[len("http://"):]
	default:
		return false
	}
	// La autoridad acaba en el primer "/", "?" o "#", y la ruta es obligatoria.
	end := strings.IndexAny(rest, "/?#")
	if end == -1 || rest[end] != '/' {
		return false
	}
	host, port, hasPort := strings.Cut(rest[:end], ":")
	if !validHost(host) || (hasPort && !validPort(port, scheme)) {
		return false
	}
	// El primer "#" abre el fragmento y, antes de él, el primer "?" abre la consulta.
	beforeHash, fragment, hasHash := strings.Cut(rest[end:], "#")
	path, query, hasQuery := strings.Cut(beforeHash, "?")
	if badChars(path, pathExcluded) || (hasQuery && badChars(query, queryExcluded)) ||
		(hasHash && badChars(fragment, fragmentExcluded)) {
		return false
	}
	for _, seg := range strings.Split(path, "/") {
		switch strings.ToLower(seg) {
		case ".", "..", "%2e", ".%2e", "%2e.", "%2e%2e":
			return false
		}
	}
	return true
}

// validHost: IPv4 canónica o dominio de etiquetas [a-z0-9_-]{1,63} separadas por "." (con un "." final opcional).
// La última etiqueta no puede ser solo dígitos ni empezar por 0x: WHATWG leería el host como una IPv4.
func validHost(h string) bool {
	if validIPv4(h) {
		return true
	}
	labels := strings.Split(strings.TrimSuffix(h, "."), ".")
	for _, label := range labels {
		if !isClass(label, 1, 63, isLabelChar) {
			return false
		}
	}
	last := labels[len(labels)-1]
	return !isClass(last, 1, len(last), isDigit) && !strings.HasPrefix(last, "0x")
}

// validIPv4: cuatro números decimales de 0 a 255 sin ceros a la izquierda (salvo el propio 0).
func validIPv4(h string) bool {
	parts := strings.Split(h, ".")
	if len(parts) != 4 {
		return false
	}
	for _, p := range parts {
		if !isClass(p, 1, 3, isDigit) || (len(p) > 1 && p[0] == '0') {
			return false
		}
		if n, _ := strconv.Atoi(p); n > 255 {
			return false
		}
	}
	return true
}

// validPort: [1-9][0-9]{0,4}, como mucho 65535 y distinto del puerto por defecto del esquema (WHATWG lo quitaría).
func validPort(port, scheme string) bool {
	if !isClass(port, 1, 5, isDigit) || port[0] == '0' {
		return false
	}
	if n, _ := strconv.Atoi(port); n > 65535 {
		return false
	}
	defaultPort := "80"
	if scheme == "https" {
		defaultPort = "443"
	}
	return port != defaultPort
}

// badChars dice si el componente tiene un carácter excluido o un "%" que no va seguido de dos dígitos
// hexadecimales (%7e y %7E valen).
func badChars(component, excluded string) bool {
	for i := 0; i < len(component); i++ {
		c := component[i]
		if strings.IndexByte(excluded, c) != -1 {
			return true
		}
		if c == '%' && (i+2 >= len(component) || !isHex(component[i+1]) || !isHex(component[i+2])) {
			return true
		}
	}
	return false
}

func isLabelChar(c byte) bool { return (c >= 'a' && c <= 'z') || isDigit(c) || c == '_' || c == '-' }
