//go:build !darwin

package caller

// ParentExe aún no está implementado fuera de macOS (F2). En Windows, syscall solo da el nombre del ejecutable; la
// ruta completa necesita QueryFullProcessImageName (golang.org/x/sys, que este módulo no usa). Falla cerrado.
func ParentExe(int) (string, error) { return "", ErrUnsupported }
