package caller

import (
	"errors"
	"path/filepath"
	"runtime"
	"strings"
)

// windowsPaths indica que las rutas se comparan como en Windows (sin distinguir mayúsculas). Las pruebas lo activan
// para simular Windows en otro sistema.
var windowsPaths = runtime.GOOS == "windows"

// ErrParentMismatch indica que el proceso padre no es el navegador configurado.
var ErrParentMismatch = errors.New("caller: el proceso padre no es el navegador configurado")

// ErrUnsupported indica que este sistema no sabe averiguar el ejecutable del proceso padre (la comprobación falla
// cerrada).
var ErrUnsupported = errors.New("caller: verificación del padre no disponible en este sistema")

// ParentLookup devuelve la ruta del ejecutable del proceso pid. En producción es ParentExe; las pruebas pasan un
// falso.
type ParentLookup func(pid int) (string, error)

// CheckParent comprueba que el proceso ppid sea el navegador de c. El navegador lanza el host como hijo directo de su
// proceso principal, así que el ejecutable del padre tiene que ser c.Exe. Las dos rutas se comparan tras resolver los
// enlaces simbólicos y limpiarlas.
//
// Devuelve ErrParentMismatch si el padre es otro (o si ppid <= 1: el padre murió y el host quedó colgado de
// launchd, sin llamar a lookup), el error de lookup tal cual si no puede averiguarlo, y ErrUnsupported si no hay
// lookup.
func CheckParent(c Config, ppid int, lookup ParentLookup) error {
	if ppid <= 1 {
		return ErrParentMismatch
	}
	if lookup == nil {
		return ErrUnsupported
	}
	parent, err := lookup(ppid)
	if err != nil {
		return err
	}
	if !samePath(parent, c.Exe) {
		return ErrParentMismatch
	}
	return nil
}

// samePath compara dos rutas absolutas tras resolver enlaces simbólicos y limpiarlas. Una ruta vacía o relativa nunca
// coincide. Si una ruta no se puede resolver (no existe), se compara su forma limpia.
func samePath(a, b string) bool {
	if windowsPaths {
		return SameWindowsPath(resolve(a), resolve(b))
	}
	if !filepath.IsAbs(a) || !filepath.IsAbs(b) {
		return false
	}
	return resolve(a) == resolve(b)
}

func resolve(p string) string {
	if resolved, err := filepath.EvalSymlinks(p); err == nil {
		return filepath.Clean(resolved)
	}
	return filepath.Clean(p)
}

// parseLsofTxt lee la salida de `lsof -a -p <pid> -d txt -Fn` y devuelve la primera entrada txt, que es el ejecutable
// real (sale del archivo abierto). No se usa `ps -o comm=` porque en macOS devuelve argv[0], que el proceso elige y
// puede ser relativo o falso.
func parseLsofTxt(out []byte) (string, error) {
	for _, line := range strings.Split(string(out), "\n") {
		if p, ok := strings.CutPrefix(line, "n"); ok {
			if !filepath.IsAbs(p) {
				break
			}
			return p, nil
		}
	}
	return "", errors.New("caller: no se encontro la ruta del proceso padre")
}
