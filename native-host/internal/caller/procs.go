package caller

import "errors"

// procEntry es una fila de la instantánea de procesos: el PID y el de su padre.
type procEntry struct{ pid, ppid uint32 }

// parentOf recorre las filas que da next (ok=false al terminar) y devuelve el PID del padre de self. Sin fila de self
// o con un padre 0 devuelve un error: la comprobación falla cerrada.
func parentOf(self uint32, next func() (procEntry, bool)) (int, error) {
	for {
		e, ok := next()
		if !ok {
			return 0, errors.New("caller: no se encontro el proceso padre")
		}
		if e.pid != self {
			continue
		}
		if e.ppid == 0 {
			return 0, errors.New("caller: no se encontro el proceso padre")
		}
		return int(e.ppid), nil
	}
}
