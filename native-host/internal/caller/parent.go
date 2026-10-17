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
// enlaces simbólicos y limpiarlas. En Windows hace falta además chain (CheckParentChain).
//
// Devuelve ErrParentMismatch si el padre es otro (o si ppid <= 1: el padre murió y el host quedó colgado de
// launchd, sin llamar a lookup), el error de lookup tal cual si no puede averiguarlo, y ErrUnsupported si no hay
// lookup.
func CheckParent(c Config, ppid int, lookup ParentLookup) error {
	return CheckParentChain(c, ppid, lookup, nil)
}

// ProcInfo es lo que hace falta saber de un proceso en Windows: el PID de su padre y su hora de creación (FILETIME:
// intervalos de 100 ns desde 1601).
type ProcInfo struct {
	PPID    int
	Created uint64
}

// Chain son las consultas que CheckParentChain necesita en Windows, donde la comprobación cambia en dos cosas:
//
//   - Chromium lanza el host con `cmd.exe /d /s /c` (salvo que la directiva NativeHostsExecutablesLaunchDirectly diga
//     otra cosa), así que si el padre es exactamente CmdExe el navegador tiene que ser el abuelo. Solo un nivel.
//   - Windows no olvida el PID del padre cuando este muere y el PID se puede reutilizar: un padre (o abuelo) creado
//     después que su hijo es otro proceso con el mismo PID, y se rechaza.
type Chain struct {
	Self   int                             // PID del host
	Info   func(pid int) (ProcInfo, error) // padre y hora de creación del proceso pid
	CmdExe string                          // <GetSystemDirectoryW>\cmd.exe; vacío = cmd.exe nunca se acepta
}

// CheckParentChain es CheckParent con las comprobaciones de Windows de chain (ver Chain). Fuera de Windows chain es
// nil; en Windows, un chain nil o sin Info falla cerrado con ErrUnsupported. Cualquier fallo al consultar un proceso
// se devuelve tal cual (el host no atiende), y un padre o abuelo que no cuadra da ErrParentMismatch.
func CheckParentChain(c Config, ppid int, lookup ParentLookup, chain *Chain) error {
	if ppid <= 1 {
		return ErrParentMismatch
	}
	if lookup == nil {
		return ErrUnsupported
	}
	if chain == nil {
		if windowsPaths {
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
	if chain.Info == nil {
		return ErrUnsupported
	}
	return chain.check(c, ppid, lookup)
}

func (ch *Chain) check(c Config, ppid int, lookup ParentLookup) error {
	self, err := ch.Info(ch.Self)
	if err != nil {
		return err
	}
	if self.Created == 0 {
		return ErrParentMismatch
	}
	parent, err := ch.olderProcess(ppid, self.Created)
	if err != nil {
		return err
	}
	exe, err := lookup(ppid)
	if err != nil {
		return err
	}
	if samePath(exe, c.Exe) {
		return nil
	}
	if ch.CmdExe == "" || !samePath(exe, ch.CmdExe) {
		return ErrParentMismatch
	}
	// El padre es cmd.exe: el navegador tiene que ser el abuelo.
	gp := parent.PPID
	if gp <= 1 {
		return ErrParentMismatch
	}
	if _, err := ch.olderProcess(gp, parent.Created); err != nil {
		return err
	}
	exe, err = lookup(gp)
	if err != nil {
		return err
	}
	if !samePath(exe, c.Exe) {
		return ErrParentMismatch
	}
	return nil
}

// olderProcess consulta pid y comprueba que se creó antes que su hijo (o a la vez, con la resolución del reloj): si
// se creó después, el PID es de otro proceso que lo reutilizó.
func (ch *Chain) olderProcess(pid int, child uint64) (ProcInfo, error) {
	info, err := ch.Info(pid)
	if err != nil {
		return ProcInfo{}, err
	}
	if info.Created == 0 || info.Created > child {
		return ProcInfo{}, ErrParentMismatch
	}
	return info, nil
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
