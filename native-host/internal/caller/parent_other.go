//go:build !darwin && !windows

package caller

// ParentExe no está implementado fuera de macOS y Windows. Falla cerrado.
func ParentExe(int) (string, error) { return "", ErrUnsupported }
