//go:build !windows

package install

import "errors"

func systemRegistry() (Registry, error) {
	return nil, errors.New("registro: solo existe en Windows")
}
