//go:build (!unix && !windows) || solaris || aix

package store

import (
	"errors"
	"os"
	"time"
)

// lockFile no existe fuera de Unix y Windows: Open falla cerrado en vez de trabajar sin bloqueo.
func lockFile(*os.File, time.Duration) error {
	return errors.New("store: bloqueo no disponible en este sistema")
}

func unlockFile(*os.File) {}
