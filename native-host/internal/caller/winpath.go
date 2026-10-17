package caller

import (
	"path"
	"strings"
)

// windowsPathKey normaliza una ruta absoluta de Windows para compararla: acepta "X:\..." (o con "/") y "\\servidor\
// recurso", quita el prefijo "\\?\" de las rutas con letra de unidad, limpia "." y ".." y pasa a mayúsculas (Windows
// no distingue mayúsculas y compara como RtlUpcaseUnicodeString: en mayúsculas, no en minúsculas). Una ruta relativa, vacía o con NUL no es válida.
func windowsPathKey(p string) (string, bool) {
	if p == "" || strings.ContainsRune(p, 0) {
		return "", false
	}
	if strings.HasPrefix(p, `\\?\`) && len(p) >= 7 && isDriveLetter(p[4]) && p[5] == ':' {
		p = p[4:]
	}
	s := strings.ReplaceAll(p, `\`, "/")
	switch {
	case len(s) >= 3 && isDriveLetter(s[0]) && s[1] == ':' && s[2] == '/':
		c := path.Clean(s)
		if len(c) < 2 || c[1] != ':' {
			return "", false
		}
		return strings.ToUpper(c), true
	case strings.HasPrefix(s, "//") && len(s) > 2 && s[2] != '/' && s[2] != '?' && s[2] != '.':
		return strings.ToUpper("/" + path.Clean(s)), true
	}
	return "", false
}

func isDriveLetter(b byte) bool { return (b >= 'a' && b <= 'z') || (b >= 'A' && b <= 'Z') }

// SameWindowsPath dice si dos rutas absolutas de Windows son la misma, sin distinguir mayúsculas y normalizadas. Una
// ruta que no sea absoluta nunca coincide.
func SameWindowsPath(a, b string) bool {
	ka, okA := windowsPathKey(a)
	kb, okB := windowsPathKey(b)
	return okA && okB && ka == kb
}
