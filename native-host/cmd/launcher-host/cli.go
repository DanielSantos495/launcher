package main

import (
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"slices"

	"github.com/DanielSantos495/launcher/native-host/internal/install"
)

// cliDeps es lo que los subcomandos toman del sistema; las pruebas pasan una carpeta personal temporal.
type cliDeps struct {
	Home       func() (string, error)
	Executable func() (string, error)
}

func defaultCLIDeps() cliDeps {
	return cliDeps{Home: os.UserHomeDir, Executable: executablePath}
}

// runCLI ejecuta install, uninstall, doctor o pairing (args[0]) y devuelve el código de salida: 0 bien, 1 fallo, 2 uso
// incorrecto.
func runCLI(args []string, stdout, stderr io.Writer, d cliDeps) int {
	name, rest := args[0], args[1:]
	home, err := d.Home()
	if err != nil || !filepath.IsAbs(home) {
		fmt.Fprintln(stderr, "launcher-host: no se pudo determinar la carpeta personal")
		return 1
	}
	o := install.Options{Home: home, Out: stdout}
	switch name {
	case "install":
		return cmdInstall(rest, o, stderr, d)
	case "uninstall":
		return cmdUninstall(rest, o, stderr)
	case "doctor":
		return cmdDoctor(rest, o, stderr)
	case "pairing":
		return cmdPairing(rest, o, stderr)
	}
	usage(stderr)
	return 2
}

// newFlagSet crea el conjunto de opciones de un subcomando; los errores y el uso salen por stderr.
func newFlagSet(name, synopsis string, stderr io.Writer) *flag.FlagSet {
	fs := flag.NewFlagSet(name, flag.ContinueOnError)
	fs.SetOutput(stderr)
	fs.Usage = func() {
		fmt.Fprintf(stderr, "uso: launcher-host %s %s\n", name, synopsis)
		fs.PrintDefaults()
	}
	return fs
}

// parse analiza las opciones. ok es false si el subcomando no debe seguir; entonces code es el código de salida.
func parse(fs *flag.FlagSet, args []string, stderr io.Writer) (code int, ok bool) {
	if err := fs.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return 0, false
		}
		return 2, false
	}
	if fs.NArg() > 0 {
		fmt.Fprintf(stderr, "launcher-host %s: sobran argumentos\n", fs.Name())
		fs.Usage()
		return 2, false
	}
	return 0, true
}

// exitCode imprime el error y devuelve su código de salida: 2 si es de uso (y entonces recuerda el uso del
// subcomando), 1 si es un fallo.
func exitCode(err error, stderr io.Writer, fs *flag.FlagSet) int {
	if err == nil {
		return 0
	}
	fmt.Fprintf(stderr, "launcher-host: %v\n", err)
	if errors.Is(err, install.ErrUsage) {
		fs.Usage()
		return 2
	}
	return 1
}

func cmdInstall(args []string, o install.Options, stderr io.Writer, d cliDeps) int {
	fs := newFlagSet("install", "[--browser b] --extension-id id [--exe ruta] [--user-data-dir ruta]", stderr)
	browser := fs.String("browser", "", "navegador: brave, chrome o edge (por defecto, los detectados)")
	fs.StringVar(&o.ExtensionID, "extension-id", "", "id de la extensión (32 letras de la a a la p)")
	fs.StringVar(&o.Exe, "exe", "", "ejecutable del navegador, si no es el de siempre (solo con --browser)")
	fs.StringVar(&o.UserDataDir, "user-data-dir", "", "datos del navegador, si no son los de siempre (solo con --browser)")
	if code, ok := parse(fs, args, stderr); !ok {
		return code
	}
	if *browser != "" {
		o.Browsers = []string{*browser}
	}
	if o.ExtensionID == "" {
		fmt.Fprintln(stderr, "launcher-host install: falta --extension-id")
		fs.Usage()
		return 2
	}
	src, err := d.Executable()
	if err != nil {
		fmt.Fprintln(stderr, "launcher-host: no se pudo averiguar la ruta del binario")
		return 1
	}
	o.Source = src
	return exitCode(install.Install(o), stderr, fs)
}

func cmdUninstall(args []string, o install.Options, stderr io.Writer) int {
	fs := newFlagSet("uninstall", "[--browser b] [--purge]", stderr)
	browser := fs.String("browser", "", "navegador: brave, chrome o edge (por defecto, todos los instalados)")
	purge := fs.Bool("purge", false, "borra también shared.json, icons/ y el resto de la carpeta de instalación")
	if code, ok := parse(fs, args, stderr); !ok {
		return code
	}
	if *browser != "" {
		o.Browsers = []string{*browser}
	}
	return exitCode(install.Uninstall(o, *purge), stderr, fs)
}

func cmdDoctor(args []string, o install.Options, stderr io.Writer) int {
	fs := newFlagSet("doctor", "[--browser b] [--verify]", stderr)
	browser := fs.String("browser", "", "navegador: brave, chrome o edge (por defecto, todos los instalados)")
	verify := fs.Bool("verify", false, "abre whoami en el perfil de cada instalación emparejada y espera hasta 65 s")
	if code, ok := parse(fs, args, stderr); !ok {
		return code
	}
	if *browser != "" {
		// Doctor informa de un navegador desconocido como un FALLO (1); aquí es un error de uso (2), como en uninstall.
		if !slices.ContainsFunc(install.Browsers(o.Home), func(b install.Browser) bool { return b.Name == *browser }) {
			fmt.Fprintln(stderr, "launcher-host doctor: navegador desconocido (brave, chrome o edge)")
			fs.Usage()
			return 2
		}
		o.Browsers = []string{*browser}
	}
	if install.Doctor(o, *verify) {
		return 0
	}
	return 1
}

func cmdPairing(args []string, o install.Options, stderr io.Writer) int {
	fs := newFlagSet("pairing", "--browser b [--reset] [--max n]", stderr)
	browser := fs.String("browser", "", "navegador: brave, chrome o edge")
	reset := fs.Bool("reset", false, "borra los emparejamientos, el código y las pruebas (conserva datos e iconos)")
	max := fs.Int("max", 0, "máximo de perfiles emparejados (de 1 a 16)")
	if code, ok := parse(fs, args, stderr); !ok {
		return code
	}
	if *browser != "" {
		o.Browsers = []string{*browser}
	}
	return exitCode(install.Pairing(o, *reset, *max), stderr, fs)
}
