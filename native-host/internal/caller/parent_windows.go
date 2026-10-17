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

var (
	kernel32                  = syscall.NewLazyDLL("kernel32.dll")
	queryFullProcessImageName = kernel32.NewProc("QueryFullProcessImageNameW")
	getSystemDirectory        = kernel32.NewProc("GetSystemDirectoryW")
)

// SystemDirectory es la carpeta del sistema (GetSystemDirectoryW), normalmente C:\Windows\System32. No sale de
// %SystemRoot%: una variable de entorno la puede cambiar quien lanza el proceso.
func SystemDirectory() (string, error) {
	buf := make([]uint16, 260)
	for range 2 {
		n, _, callErr := getSystemDirectory.Call(uintptr(unsafe.Pointer(&buf[0])), uintptr(len(buf)))
		switch {
		case n == 0:
			return "", callErr
		case int(n) < len(buf):
			dir := syscall.UTF16ToString(buf[:n])
			if _, ok := windowsPathKey(dir); !ok {
				return "", errors.New("caller: carpeta del sistema no valida")
			}
			return dir, nil
		}
		// Si no cabe, n es el tamaño necesario con el NUL: se reintenta una vez.
		buf = make([]uint16, min(int(n), 32768))
	}
	return "", errors.New("caller: carpeta del sistema no valida")
}

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
