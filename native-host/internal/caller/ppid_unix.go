//go:build !windows

package caller

import "os"

// ParentPID es el PID del proceso padre.
func ParentPID() int { return os.Getppid() }

// SystemChain solo existe en Windows: fuera de él CheckParentChain no la necesita.
func SystemChain() *Chain { return nil }
