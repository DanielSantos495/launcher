package launch

import (
	"errors"
	"fmt"
	"io/fs"
	"os/exec"
	"path/filepath"
)

// Starter lanza el ejecutable del navegador con unos argumentos. Las pruebas del router pasan un falso que apunta las
// llamadas.
type Starter interface {
	Start(exe string, args []string) error
}

// ExecStarter lanza el navegador de verdad: exec.Command(exe, args...), sin shell, y no espera a que termine (la
// segunda invocación de un navegador ya abierto reenvía la orden y sale).
type ExecStarter struct{}

// buildCmd prepara la orden. exe tiene que ser una ruta absoluta: un nombre sin ruta haría que exec lo buscara en el
// PATH. Stdin, Stdout y Stderr se quedan en nil, que en exec.Cmd es el dispositivo nulo: el navegador no hereda la
// tubería de native messaging.
func buildCmd(exe string, args []string) (*exec.Cmd, error) {
	if !filepath.IsAbs(exe) {
		return nil, ErrInvalidArgument
	}
	cmd := exec.Command(exe, args...)
	detach(cmd)
	return cmd, nil
}

// Start lanza exe con args y suelta el proceso. El error de exec lleva la ruta del ejecutable; se quita y solo queda la
// causa del sistema (errors.Is(err, fs.ErrNotExist) sigue valiendo).
func (ExecStarter) Start(exe string, args []string) error {
	cmd, err := buildCmd(exe, args)
	if err != nil {
		return err
	}
	if err := cmd.Start(); err != nil {
		var pathErr *fs.PathError
		if errors.As(err, &pathErr) {
			err = pathErr.Err
		}
		return fmt.Errorf("launch: no se pudo lanzar el navegador: %w", err)
	}
	return cmd.Process.Release()
}
