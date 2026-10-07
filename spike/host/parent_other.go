//go:build !darwin

package main

// parentExe aún no está implementado fuera de macOS. En Windows, syscall solo da el nombre del
// ejecutable (Process32First); la ruta completa necesita QueryFullProcessImageName (golang.org/x/sys).
func parentExe(int) (string, error) { return "", errParentUnsupported }
