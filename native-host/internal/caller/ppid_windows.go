//go:build windows

package caller

import (
	"errors"
	"os"
	"syscall"
	"unsafe"
)

// ParentPID es el PID del proceso padre, leído de una instantánea de procesos (CreateToolhelp32Snapshot,
// Process32First y Process32Next). Si no se puede averiguar devuelve 0, que CheckParent rechaza.
func ParentPID() int {
	ppid, err := ppidOf(uint32(os.Getpid()))
	if err != nil {
		return 0
	}
	return ppid
}

// ppidOf es el PID del padre de pid según una instantánea de procesos.
func ppidOf(pid uint32) (int, error) {
	snap, err := syscall.CreateToolhelp32Snapshot(syscall.TH32CS_SNAPPROCESS, 0)
	if err != nil {
		return 0, err
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
	return parentOf(pid, next)
}

// ProcessInfo devuelve el PID del padre de pid (instantánea de procesos) y su hora de creación (GetProcessTimes). Un
// pid <= 4 se rechaza (0 es el proceso inactivo y 4 es System).
func ProcessInfo(pid int) (ProcInfo, error) {
	if pid <= 4 {
		return ProcInfo{}, errors.New("caller: no hay proceso")
	}
	h, err := syscall.OpenProcess(processQueryLimitedInformation, false, uint32(pid))
	if err != nil {
		return ProcInfo{}, err
	}
	defer syscall.CloseHandle(h)
	var created, exited, kernel, user syscall.Filetime
	if err := syscall.GetProcessTimes(h, &created, &exited, &kernel, &user); err != nil {
		return ProcInfo{}, err
	}
	ppid, err := ppidOf(uint32(pid))
	if err != nil {
		return ProcInfo{}, err
	}
	return ProcInfo{PPID: ppid, Created: uint64(created.HighDateTime)<<32 | uint64(created.LowDateTime)}, nil
}

// SystemChain son las consultas de Windows para CheckParentChain: este proceso, ProcessInfo y cmd.exe de la carpeta
// del sistema. Si no se puede averiguar la carpeta del sistema devuelve nil, y CheckParentChain falla cerrado.
func SystemChain() *Chain {
	dir, err := SystemDirectory()
	if err != nil {
		return nil
	}
	return &Chain{Self: os.Getpid(), Info: ProcessInfo, CmdExe: dir + `\cmd.exe`}
}
