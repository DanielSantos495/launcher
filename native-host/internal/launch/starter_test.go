package launch

import (
	"slices"
	"testing"
)

// Estas pruebas no lanzan nada: miran la orden que ExecStarter ejecutaria.

func TestBuildCmdNoShell(t *testing.T) {
	args := []string{"--profile-directory=Default", "--", "https://example.com/?a=1&b=$(id)"}
	cmd, err := buildCmd("/usr/bin/true", args)
	if err != nil {
		t.Fatal(err)
	}
	if cmd.Path != "/usr/bin/true" {
		t.Fatalf("Path = %q", cmd.Path)
	}
	// Args[0] es el propio ejecutable y el resto, exactamente los argumentos recibidos: ni un shell ni
	// "-c" ni un argumento fusionado.
	if want := append([]string{"/usr/bin/true"}, args...); !slices.Equal(cmd.Args, want) {
		t.Fatalf("Args = %q, want %q", cmd.Args, want)
	}
}

func TestBuildCmdDetachesStandardStreams(t *testing.T) {
	cmd, err := buildCmd("/usr/bin/true", nil)
	if err != nil {
		t.Fatal(err)
	}
	// nil en exec.Cmd significa el dispositivo nulo: el navegador no hereda la tuberia de native messaging.
	if cmd.Stdin != nil || cmd.Stdout != nil || cmd.Stderr != nil {
		t.Fatalf("Stdin=%v Stdout=%v Stderr=%v, want nil", cmd.Stdin, cmd.Stdout, cmd.Stderr)
	}
}

func TestBuildCmdRequiresAbsolutePath(t *testing.T) {
	// Un nombre sin ruta haria que exec buscara en el PATH: el ejecutable sale siempre de la configuracion.
	for _, exe := range []string{"", "true", "./true", "bin/true", "../bin/true"} {
		if cmd, err := buildCmd(exe, nil); err == nil {
			t.Errorf("buildCmd(%q) = %v, want error", exe, cmd)
		}
	}
}
