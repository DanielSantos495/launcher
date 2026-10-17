//go:build windows

package store

import (
	"errors"
	"os"
	"syscall"
	"time"
	"unsafe"
)

// lockPoll es cada cuánto se reintenta el bloqueo mientras otro proceso lo tiene.
const lockPoll = 10 * time.Millisecond

const (
	lockfileFailImmediately = 0x1 // LOCKFILE_FAIL_IMMEDIATELY
	lockfileExclusiveLock   = 0x2 // LOCKFILE_EXCLUSIVE_LOCK
	// errorLockViolation es ERROR_LOCK_VIOLATION: otro proceso tiene el bloqueo.
	errorLockViolation syscall.Errno = 33
	// allBytes bloquea todo el rango posible del archivo, como flock bloquea el archivo entero.
	allBytes = ^uint32(0)
)

var (
	kernel32       = syscall.NewLazyDLL("kernel32.dll")
	procLockFileEx = kernel32.NewProc("LockFileEx")
	procUnlockFile = kernel32.NewProc("UnlockFileEx")
)

// lockFile toma un bloqueo exclusivo (LockFileEx con LOCKFILE_EXCLUSIVE_LOCK) sobre f, como flock en macOS: reintenta
// cada lockPoll hasta que pasa timeout y entonces devuelve ErrLocked. Se pide con LOCKFILE_FAIL_IMMEDIATELY para poder
// respetar el plazo; ERROR_LOCK_VIOLATION se reintenta y cualquier otro error se devuelve tal cual.
func lockFile(f *os.File, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	for {
		var ol syscall.Overlapped
		r, _, err := procLockFileEx.Call(f.Fd(), lockfileExclusiveLock|lockfileFailImmediately, 0,
			uintptr(allBytes), uintptr(allBytes), uintptr(unsafe.Pointer(&ol)))
		if r != 0 {
			return nil
		}
		if !errors.Is(err, errorLockViolation) {
			return err
		}
		if !time.Now().Before(deadline) {
			return ErrLocked
		}
		time.Sleep(min(lockPoll, time.Until(deadline)))
	}
}

// unlockFile suelta el bloqueo antes de cerrar f: Windows lo suelta al cerrar el handle, pero no garantiza que sea
// enseguida.
func unlockFile(f *os.File) {
	var ol syscall.Overlapped
	_, _, _ = procUnlockFile.Call(f.Fd(), 0, uintptr(allBytes), uintptr(allBytes), uintptr(unsafe.Pointer(&ol)))
}
