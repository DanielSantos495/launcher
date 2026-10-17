//go:build windows

package caller

import (
	"os"
	"syscall"
	"unsafe"
)

// ParentPID es el PID del proceso padre, leído de una instantánea de procesos (CreateToolhelp32Snapshot,
// Process32First y Process32Next). Si no se puede averiguar devuelve 0, que CheckParent rechaza.
func ParentPID() int {
	snap, err := syscall.CreateToolhelp32Snapshot(syscall.TH32CS_SNAPPROCESS, 0)
	if err != nil {
		return 0
	}
	defer syscall.CloseHandle(snap)
	var entry syscall.ProcessEntry32
	entry.Size = uint32(unsafe.Sizeof(entry))
	first := true
	next := func() (procEntry, bool) {
		var err error
		if first {
			first = false
			err = syscall.Process32First(snap, &entry)
		} else {
			err = syscall.Process32Next(snap, &entry)
		}
		if err != nil {
			return procEntry{}, false
		}
		return procEntry{pid: entry.ProcessID, ppid: entry.ParentProcessID}, true
	}
	ppid, err := parentOf(uint32(os.Getpid()), next)
	if err != nil {
		return 0
	}
	return ppid
}
