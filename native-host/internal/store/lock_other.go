//go:build !unix || solaris || aix

package store

import (
	"errors"
	"os"
	"time"
)

// lockFile no existe fuera de Unix hasta F2 (Windows usará LockFileEx): Open falla cerrado en vez de trabajar sin
// bloqueo.
func lockFile(*os.File, time.Duration) error {
	return errors.New("store: bloqueo no disponible hasta F2")
}
