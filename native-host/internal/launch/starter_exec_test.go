package launch_test

import (
	"errors"
	"io/fs"
	"strings"
	"testing"

	"github.com/DanielSantos495/launcher/native-host/internal/launch"
)

// ExecStarter solo se prueba con /usr/bin/true (existe en macOS y Linux) y con rutas que no valen: nunca se lanza
// un navegador. Starter se comprueba en tiempo de compilacion.
var _ launch.Starter = launch.ExecStarter{}

func TestExecStarter(t *testing.T) {
	var s launch.ExecStarter
	if err := s.Start("/usr/bin/true", []string{"--x"}); err != nil {
		t.Fatalf("Start(/usr/bin/true) = %v", err)
	}
	if err := s.Start("/usr/bin/true", nil); err != nil {
		t.Fatalf("Start(/usr/bin/true, nil) = %v", err)
	}
}

func TestExecStarterFailures(t *testing.T) {
	var s launch.ExecStarter
	for _, exe := range []string{"/no/existe", "", "true", "./true"} {
		if err := s.Start(exe, nil); err == nil {
			t.Errorf("Start(%q): want error", exe)
		}
	}
}

func TestExecStarterErrorWithoutPath(t *testing.T) {
	var s launch.ExecStarter
	err := s.Start("/no/existe/navegador-de-prueba", nil)
	if !errors.Is(err, fs.ErrNotExist) {
		t.Fatalf("err = %v, want fs.ErrNotExist", err)
	}
	if strings.Contains(err.Error(), "navegador-de-prueba") {
		t.Fatalf("el error lleva la ruta del ejecutable: %v", err)
	}
}
