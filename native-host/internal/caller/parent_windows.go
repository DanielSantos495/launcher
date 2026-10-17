//go:build windows

package caller

import (
	"errors"
	"syscall"
	"unsafe"
)

// processQueryLimitedInformation es PROCESS_QUERY_LIMITED_INFORMATION: basta para leer la ruta de la imagen y se
// concede incluso a procesos protegidos.
const processQueryLimitedInformation = 0x1000

var queryFullProcessImageName = syscall.NewLazyDLL("kernel32.dll").NewProc("QueryFullProcessImageNameW")

// ParentExe devuelve la ruta del ejecutable del proceso pid (QueryFullProcessImageNameW). Un pid <= 4 se rechaza (0 es
// el proceso inactivo y 4 es System).
func ParentExe(pid int) (string, error) {
	if pid <= 4 {
		return "", errors.New("caller: no hay proceso padre")
	}
	h, err := syscall.OpenProcess(processQueryLimitedInformation, false, uint32(pid))
	if err != nil {
		return "", err
	}
	defer syscall.CloseHandle(h)
	buf := make([]uint16, 32768)
	size := uint32(len(buf))
	r, _, callErr := queryFullProcessImageName.Call(uintptr(h), 0, uintptr(unsafe.Pointer(&buf[0])), uintptr(unsafe.Pointer(&size)))
	if r == 0 {
		return "", callErr
	}
	if size == 0 || int(size) > len(buf) {
		return "", errors.New("caller: ruta del proceso padre no valida")
	}
	return syscall.UTF16ToString(buf[:size]), nil
}
