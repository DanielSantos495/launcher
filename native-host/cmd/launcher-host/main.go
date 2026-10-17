// Command launcher-host es el host de native messaging de Account Launcher. El navegador lo lanza con el origen de la
// extensión como primer argumento (modo host: un mensaje, una respuesta); el usuario lo ejecuta con subcomandos para
// instalarlo y diagnosticarlo.
package main

import (
	"crypto/rand"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/DanielSantos495/launcher/native-host/internal/caller"
	"github.com/DanielSantos495/launcher/native-host/internal/launch"
)

// Version es la versión del host; se puede fijar con -ldflags "-X main.Version=…".
var Version = "0.1.0"

// hostArgPrefix es cómo empieza el primer argumento que pasa el navegador: chrome-extension://<id>/.
const hostArgPrefix = "chrome-extension://"

func main() {
	os.Exit(run(os.Args[1:], os.Stdin, os.Stdout, os.Stderr))
}

// run despacha por el primer argumento y devuelve el código de salida: 0 bien, 1 fallo, 2 uso incorrecto.
func run(args []string, stdin io.Reader, stdout, stderr io.Writer) int {
	if len(args) == 0 {
		usage(stderr)
		return 2
	}
	if strings.HasPrefix(args[0], hostArgPrefix) {
		return runHost(args[0], stdin, stdout)
	}
	switch args[0] {
	case "version":
		fmt.Fprintln(stdout, Version)
		return 0
	case "install", "uninstall", "doctor", "pairing":
		return runCLI(args, stdout, stderr, defaultCLIDeps())
	}
	usage(stderr)
	return 2
}

func usage(w io.Writer) {
	fmt.Fprint(w, `uso: launcher-host <subcomando>

  install     instala el host (--browser, --extension-id, --exe, --user-data-dir)
  uninstall   quita el host (--browser, --purge)
  doctor      comprueba la instalación (--browser, --verify)
  pairing     cambia el emparejamiento (--browser, --reset, --max)
  version     muestra la versión
`)
}

// runHost atiende un mensaje del navegador con el sistema real.
func runHost(origin string, stdin io.Reader, stdout io.Writer) int {
	return serve(serveDeps{
		ExeDir:  exeDir(),
		Origin:  origin,
		PPID:    caller.ParentPID(),
		Lookup:  caller.ParentExe,
		Chain:   caller.SystemChain(),
		Stdin:   stdin,
		Stdout:  stdout,
		Now:     time.Now,
		Rand:    rand.Reader,
		Starter: launch.ExecStarter{},
	})
}

// exeDir es la carpeta del binario, con los enlaces simbólicos resueltos. Si no se puede averiguar devuelve "": serve
// no la acepta (no es absoluta) y responde internal.
func exeDir() string {
	exe, err := executablePath()
	if err != nil {
		return ""
	}
	return filepath.Dir(exe)
}

// executablePath es la ruta del binario en ejecución, con los enlaces simbólicos resueltos.
func executablePath() (string, error) {
	exe, err := os.Executable()
	if err != nil {
		return "", err
	}
	return filepath.EvalSymlinks(exe)
}
