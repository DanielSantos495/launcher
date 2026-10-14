package install

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"runtime"
	"slices"
	"time"

	"github.com/DanielSantos495/launcher/native-host/internal/caller"
	"github.com/DanielSantos495/launcher/native-host/internal/jsonx"
	"github.com/DanielSantos495/launcher/native-host/internal/launch"
)

// BinaryName es el nombre del binario dentro de la carpeta de instalación.
const BinaryName = "launcher-host"

// maxBinaryBytes es el tamaño máximo del binario que se copia. Se lee entero a memoria antes de borrar el anterior,
// por si install se ejecuta desde la propia copia instalada.
const maxBinaryBytes = 64 << 20

// ErrUsage envuelve los errores de uso (un navegador o un id que no valen, una opción que falta): la línea de órdenes
// los distingue de los fallos del sistema.
var ErrUsage = errors.New("uso incorrecto")

func usageError(msg string) error { return fmt.Errorf("%w: %s", ErrUsage, msg) }

// Variables de paquete que las pruebas sustituyen: el sistema operativo y la función de rutas, para simular los
// ejecutables de los navegadores con archivos temporales.
var (
	goos     = runtime.GOOS
	browsers = Browsers
)

// Options reúne lo que necesitan Install, Uninstall, Doctor y Pairing. Los campos de reloj, aleatoriedad, lanzador y
// espera solo los usa Doctor con verify; si faltan, se usan los del sistema.
type Options struct {
	Home        string
	Browsers    []string // vacío = los detectados (ejecutable presente) o, en uninstall y doctor, los instalados
	ExtensionID string
	Source      string // binario que se copia (os.Executable en producción)
	Exe         string // opcional, solo con un navegador: sustituye al ejecutable por defecto
	UserDataDir string // opcional, solo con un navegador: sustituye a los datos por defecto
	Out         io.Writer
	Now         func() time.Time
	Rand        io.Reader
	Starter     launch.Starter
	Sleep       func(time.Duration)
}

// defaults completa lo que falte con el sistema real.
func (o Options) defaults() Options {
	if o.Out == nil {
		o.Out = io.Discard
	}
	if o.Now == nil {
		o.Now = time.Now
	}
	if o.Rand == nil {
		o.Rand = rand.Reader
	}
	if o.Starter == nil {
		o.Starter = launch.ExecStarter{}
	}
	if o.Sleep == nil {
		o.Sleep = time.Sleep
	}
	return o
}

// checkOS rechaza cualquier sistema que no sea macOS: en F1 solo hay rutas de macOS.
func checkOS() error {
	if goos != "darwin" {
		return errors.New("solo macOS en F1")
	}
	return nil
}

// byName devuelve el navegador de nombre name, o un error de uso si no es uno de los admitidos.
func byName(home, name string) (Browser, error) {
	for _, b := range browsers(home) {
		if b.Name == name {
			return b, nil
		}
	}
	return Browser{}, usageError("navegador desconocido (brave, chrome o edge)")
}

// selectNamed devuelve los navegadores de names, sin repetidos y en el orden dado. Con names vacío devuelve nil.
func selectNamed(home string, names []string) ([]Browser, error) {
	var out []Browser
	for _, name := range names {
		b, err := byName(home, name)
		if err != nil {
			return nil, err
		}
		if !slices.ContainsFunc(out, func(x Browser) bool { return x.Name == b.Name }) {
			out = append(out, b)
		}
	}
	return out, nil
}

// regularFile dice si path es un archivo normal (no una carpeta ni un enlace roto).
func regularFile(path string) bool {
	fi, err := os.Stat(path)
	return err == nil && fi.Mode().IsRegular()
}

// installTargets decide en qué navegadores se instala y con qué ejecutable y datos. Con navegadores explícitos exige
// que su ejecutable exista; sin ellos, instala en los que lo tienen.
func installTargets(o Options) ([]Browser, error) {
	named, err := selectNamed(o.Home, o.Browsers)
	if err != nil {
		return nil, err
	}
	if (o.Exe != "" || o.UserDataDir != "") && len(named) != 1 {
		return nil, usageError("--exe y --user-data-dir necesitan exactamente un --browser")
	}
	targets := named
	if len(named) == 0 {
		for _, b := range browsers(o.Home) {
			if regularFile(b.Exe) {
				targets = append(targets, b)
			}
		}
		if len(targets) == 0 {
			return nil, errors.New("no se encontró ningún navegador compatible (Brave, Chrome o Edge); usa --browser con --exe")
		}
	}
	for i := range targets {
		if o.Exe != "" {
			targets[i].Exe = o.Exe
		}
		if o.UserDataDir != "" {
			targets[i].UserDataDir = o.UserDataDir
		}
		if !regularFile(targets[i].Exe) {
			return nil, fmt.Errorf("no se encontró el ejecutable de %s: %s", targets[i].Name, targets[i].Exe)
		}
	}
	return targets, nil
}

// plan es todo lo que Install escribe para un navegador, ya validado.
type plan struct {
	browser      Browser
	appDir       string
	binaryPath   string
	config       []byte
	manifestPath string
	manifest     []byte
}

// Install copia el binario a la carpeta de instalación de cada navegador, escribe config.json y el manifest. Valida
// todo (navegadores, ejecutables, id, configuración y manifest) antes de escribir nada. Es idempotente: reinstalar da
// los mismos archivos y no toca shared.json ni icons/.
func Install(o Options) error {
	o = o.defaults()
	if err := checkOS(); err != nil {
		return err
	}
	if !caller.ValidExtensionID(o.ExtensionID) {
		return usageError("el id de la extensión debe cumplir ^[a-p]{32}$ (--extension-id)")
	}
	targets, err := installTargets(o)
	if err != nil {
		return err
	}
	binary, err := jsonx.ReadFileLimit(o.Source, maxBinaryBytes)
	if err != nil {
		return fmt.Errorf("no se pudo leer el binario que se instala: %w", err)
	}
	sum := sha256.Sum256(binary)
	hash := hex.EncodeToString(sum[:])

	plans := make([]plan, 0, len(targets))
	for _, b := range targets {
		p := plan{browser: b, appDir: AppDir(o.Home, b.Name)}
		p.binaryPath = filepath.Join(p.appDir, BinaryName)
		cfg := caller.Config{
			Browser: b.Name, Exe: b.Exe, UserDataDir: b.UserDataDir, ExtensionID: o.ExtensionID, BinarySHA256: hash,
		}
		// Reinstalar conserva el registro activado a mano.
		if old, err := caller.LoadConfig(p.appDir); err == nil {
			cfg.Log = old.Log
		}
		if p.config, err = cfg.Encode(); err != nil {
			return fmt.Errorf("configuración de %s no válida: %w", b.Name, err)
		}
		if p.manifest, err = Manifest(b.Name, p.binaryPath, o.ExtensionID); err != nil {
			return err
		}
		p.manifestPath = manifestPath(b)
		plans = append(plans, p)
	}

	for _, p := range plans {
		if err := write(p, binary); err != nil {
			return fmt.Errorf("no se pudo instalar para %s: %w", p.browser.Name, err)
		}
		fmt.Fprintf(o.Out, "Instalado para %s:\n  binario:  %s\n  config:   %s\n  manifest: %s\n",
			p.browser.Name, p.binaryPath, filepath.Join(p.appDir, caller.ConfigFile), p.manifestPath)
	}
	return nil
}

// write escribe los tres archivos de un navegador. El manifest va el último: el navegador no ve el host hasta que
// está completo.
func write(p plan, binary []byte) error {
	if err := os.MkdirAll(p.appDir, 0o700); err != nil {
		return err
	}
	if err := os.Chmod(p.appDir, 0o700); err != nil {
		return err
	}
	if err := copyBinary(p.binaryPath, binary); err != nil {
		return err
	}
	if err := writeAtomic(filepath.Join(p.appDir, caller.ConfigFile), p.config, 0o600); err != nil {
		return err
	}
	if err := os.MkdirAll(p.browser.ManifestDir, 0o755); err != nil {
		return err
	}
	return writeAtomic(p.manifestPath, p.manifest, 0o644)
}

// copyBinary escribe el binario con 0700. Antes borra el anterior: sobrescribir en el mismo inodo un binario firmado
// hace que macOS mate el proceso al ejecutarlo. O_EXCL asegura que se crea un archivo nuevo.
func copyBinary(dst string, data []byte) error {
	if err := os.Remove(dst); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return err
	}
	f, err := os.OpenFile(dst, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o700)
	if err != nil {
		return err
	}
	if _, err := f.Write(data); err != nil {
		_ = f.Close()
		_ = os.Remove(dst)
		return err
	}
	if err := f.Sync(); err != nil {
		_ = f.Close()
		_ = os.Remove(dst)
		return err
	}
	if err := f.Close(); err != nil {
		_ = os.Remove(dst)
		return err
	}
	return nil
}

// writeAtomic escribe data en path con el modo mode: temporal en la misma carpeta, fsync y rename.
func writeAtomic(path string, data []byte, mode fs.FileMode) error {
	tmp, err := os.CreateTemp(filepath.Dir(path), ".install-*.tmp")
	if err != nil {
		return err
	}
	ok := false
	defer func() {
		if !ok {
			_ = tmp.Close()
			_ = os.Remove(tmp.Name())
		}
	}()
	if _, err := tmp.Write(data); err != nil {
		return err
	}
	if err := tmp.Chmod(mode); err != nil {
		return err
	}
	if err := tmp.Sync(); err != nil {
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := os.Rename(tmp.Name(), path); err != nil {
		return err
	}
	ok = true
	return nil
}

// installedBrowsers son los navegadores con algo instalado: su carpeta de instalación o su manifest existen.
func installedBrowsers(home string) []Browser {
	var out []Browser
	for _, b := range browsers(home) {
		if exists(AppDir(home, b.Name)) || exists(manifestPath(b)) {
			out = append(out, b)
		}
	}
	return out
}

// manifestPath es el manifest de native messaging de b.
func manifestPath(b Browser) string {
	return filepath.Join(b.ManifestDir, caller.HostName(b.Name)+".json")
}

func exists(path string) bool {
	_, err := os.Lstat(path)
	return err == nil
}

// existing devuelve los navegadores de names o, si no hay ninguno, los que tienen algo instalado.
func existing(home string, names []string) ([]Browser, error) {
	named, err := selectNamed(home, names)
	if err != nil {
		return nil, err
	}
	if len(named) > 0 {
		return named, nil
	}
	return installedBrowsers(home), nil
}

// Uninstall borra el manifest, el binario y config.json de cada navegador. Conserva shared.json, shared.lock, icons/ y
// host.log (lo que guardó el usuario); con purge borra la carpeta de instalación entera. Sin nada instalado no es un
// error.
func Uninstall(o Options, purge bool) error {
	o = o.defaults()
	if err := checkOS(); err != nil {
		return err
	}
	targets, err := existing(o.Home, o.Browsers)
	if err != nil {
		return err
	}
	if len(targets) == 0 {
		fmt.Fprintln(o.Out, "No hay nada instalado.")
		return nil
	}
	var errs []error
	for _, b := range targets {
		app := AppDir(o.Home, b.Name)
		manifest := manifestPath(b)
		if !exists(app) && !exists(manifest) {
			fmt.Fprintf(o.Out, "%s: no había nada instalado.\n", b.Name)
			continue
		}
		paths := []string{manifest, filepath.Join(app, BinaryName), filepath.Join(app, caller.ConfigFile)}
		for _, p := range paths {
			if err := os.Remove(p); err != nil && !errors.Is(err, fs.ErrNotExist) {
				errs = append(errs, err)
			}
		}
		if purge {
			if err := os.RemoveAll(app); err != nil {
				errs = append(errs, err)
			}
			fmt.Fprintf(o.Out, "Desinstalado %s (carpeta de instalación borrada).\n", b.Name)
			continue
		}
		fmt.Fprintf(o.Out, "Desinstalado %s (se conservan shared.json e icons/).\n", b.Name)
	}
	return errors.Join(errs...)
}
