package profiles

import (
	"path/filepath"
	"strings"

	"github.com/DanielSantos495/launcher/native-host/internal/jsonx"
)

const (
	lastVersionFile = "Last Version"
	// maxLastVersion es el máximo de caracteres de una versión (sin los espacios de alrededor).
	maxLastVersion = 32
	// maxLastVersionFile es el máximo de bytes que se leen de Last Version: la versión más algún salto de línea.
	maxLastVersionFile = 256
)

// ParseLastVersion valida el contenido de Last Version: ^[0-9]+(\.[0-9]+){1,3}$ tras quitar los espacios, tabuladores y
// saltos de línea de alrededor, de como mucho 32 caracteres. Devuelve la versión sin esos espacios. En Brave tiene la
// forma <chromium>.1.<menor>.<compilación> (155.1.97.56 es Brave 1.97.56).
func ParseLastVersion(s string) (string, bool) {
	v := strings.Trim(s, " \t\r\n")
	if v == "" || len(v) > maxLastVersion {
		return "", false
	}
	parts := strings.Split(v, ".")
	if len(parts) < 2 || len(parts) > 4 {
		return "", false
	}
	for _, part := range parts {
		if part == "" {
			return "", false
		}
		for i := 0; i < len(part); i++ {
			if part[i] < '0' || part[i] > '9' {
				return "", false
			}
		}
	}
	return v, true
}

// ReadLastVersion lee <userDataDir>/Last Version. Un archivo que falta, que pesa más de lo razonable o que no es una
// versión da ("", false).
func ReadLastVersion(userDataDir string) (string, bool) {
	b, err := jsonx.ReadFileLimit(filepath.Join(userDataDir, lastVersionFile), maxLastVersionFile)
	if err != nil {
		return "", false
	}
	return ParseLastVersion(string(b))
}
