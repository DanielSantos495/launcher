//go:build unix && !solaris && !aix

package store

import (
	"errors"
	"os"
	"syscall"
	"time"
)

// lockPoll es cada cuánto se reintenta el bloqueo mientras otro proceso lo tiene.
const lockPoll = 10 * time.Millisecond

// lockFile toma un flock exclusivo sobre f sin bloquear el hilo: reintenta cada lockPoll hasta que pasa timeout y
// entonces devuelve ErrLocked. EWOULDBLOCK y EINTR se reintentan; cualquier otro error se devuelve tal cual. El
// bloqueo se suelta al cerrar f (o al morir el proceso).
func lockFile(f *os.File, timeout time.Duration) error {
	fd := int(f.Fd())
	deadline := time.Now().Add(timeout)
	for {
		err := syscall.Flock(fd, syscall.LOCK_EX|syscall.LOCK_NB)
		if err == nil {
			return nil
		}
		if !errors.Is(err, syscall.EWOULDBLOCK) && !errors.Is(err, syscall.EINTR) {
			return err
		}
		if !time.Now().Before(deadline) {
			return ErrLocked
		}
		time.Sleep(min(lockPoll, time.Until(deadline)))
	}
}
