//go:build windows

package install

import (
	"errors"
	"syscall"
	"unsafe"

	"github.com/DanielSantos495/launcher/native-host/internal/caller"
)

// systemRegistry escribe con <GetSystemDirectoryW>\reg.exe y lee con la API del registro.
func systemRegistry() (Registry, error) {
	dir, err := caller.SystemDirectory()
	if err != nil {
		return nil, errors.New("registro: no se pudo averiguar la carpeta del sistema")
	}
	return RegExe{Path: dir + `\reg.exe`, Read: &RegAPI{Open: regOpen, Query: regQuery, Close: regClose}}, nil
}

func regOpen(subkey string) (uintptr, error) {
	p, err := syscall.UTF16PtrFromString(subkey)
	if err != nil {
		return 0, err
	}
	var h syscall.Handle
	if err := syscall.RegOpenKeyEx(syscall.HKEY_CURRENT_USER, p, 0, syscall.KEY_QUERY_VALUE, &h); err != nil {
		return 0, regErr(err)
	}
	return uintptr(h), nil
}

// regQuery lee el valor por defecto (nombre NULL) de la clave abierta.
func regQuery(h uintptr, buf []uint16) (uint32, uint32, error) {
	var typ uint32
	size := uint32(len(buf) * 2)
	err := syscall.RegQueryValueEx(syscall.Handle(h), nil, nil, &typ, (*byte)(unsafe.Pointer(&buf[0])), &size)
	return typ, size, regErr(err)
}

func regClose(h uintptr) error { return syscall.RegCloseKey(syscall.Handle(h)) }

// regErr traduce los dos códigos que Get trata aparte.
func regErr(err error) error {
	switch {
	case err == nil:
		return nil
	case errors.Is(err, syscall.ERROR_FILE_NOT_FOUND):
		return errRegNotFound
	case errors.Is(err, syscall.ERROR_MORE_DATA):
		return errRegMoreData
	}
	return err
}
