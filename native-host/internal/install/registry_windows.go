//go:build windows

package install

import (
	"errors"
	"os"
	"path/filepath"
)

// systemRegistry usa %SystemRoot%\System32\reg.exe.
func systemRegistry() (Registry, error) {
	root := os.Getenv("SystemRoot")
	if root == "" {
		return nil, errors.New("registro: falta %SystemRoot%")
	}
	return RegExe{Path: filepath.Join(root, "System32", "reg.exe")}, nil
}
