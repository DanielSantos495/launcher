//go:build !windows

package caller

import "os"

// ParentPID es el PID del proceso padre.
func ParentPID() int { return os.Getppid() }
