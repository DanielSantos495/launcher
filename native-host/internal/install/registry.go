package install

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os/exec"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/DanielSantos495/launcher/native-host/internal/protocol"
)

// Registry lee y escribe el valor por defecto de una clave de HKCU. En Windows lo implementa RegExe; las pruebas pasan
// un falso.
type Registry interface {
	// Set crea la clave si falta y fija su valor por defecto (REG_SZ).
	Set(key, value string) error
	// Get devuelve el valor por defecto; found es false si la clave no existe.
	Get(key string) (value string, found bool, err error)
	// Delete borra la clave. No es un error que no exista.
	Delete(key string) error
}

// Runner ejecuta exe con args y devuelve su salida estándar y su código de salida. err solo es no nil si el programa no
// pudo ejecutarse (un código distinto de 0 no es un error).
type Runner func(exe string, args []string) (stdout []byte, exit int, err error)

// regTimeout es lo máximo que se espera a reg.exe.
const regTimeout = 10 * time.Second

// RegExe usa reg.exe del sistema, sin shell. Path es la ruta absoluta de reg.exe (%SystemRoot%\System32\reg.exe).
type RegExe struct {
	Path string
	Run  Runner // nil = ejecutar de verdad
}

// keyPattern: HKCU\Software\ seguido de segmentos de letras, cifras, punto, guion y guion bajo. Nada que empiece por
// "-" o "/" (reg.exe lo tomaría por una opción) ni comillas.
var keyPattern = regexp.MustCompile(`^HKCU\\Software(\\[A-Za-z0-9][A-Za-z0-9._-]*)+$`)

func validKey(key string) bool { return keyPattern.MatchString(key) }

// validValue: ruta absoluta de Windows (letra de unidad o UNC) sin comillas ni caracteres de control, y que no empiece
// por "-" ni "/" (por la forma de la ruta no puede, pero se comprueba).
func validValue(v string) bool {
	if !utf8.ValidString(v) || protocol.HasControlChars(v) || strings.Contains(v, `"`) || v == "" {
		return false
	}
	if v[0] == '-' || v[0] == '/' {
		return false
	}
	drive := len(v) >= 3 && isASCIILetter(v[0]) && v[1] == ':' && v[2] == '\\'
	unc := strings.HasPrefix(v, `\\`) && len(v) > 2 && v[2] != '\\'
	return drive || unc
}

func isASCIILetter(b byte) bool { return (b >= 'a' && b <= 'z') || (b >= 'A' && b <= 'Z') }

var errBadRegArg = errors.New("registro: argumento no valido")

func (r RegExe) run(args []string) ([]byte, int, error) {
	if !validRegExePath(r.Path) {
		return nil, 0, errors.New("registro: ruta de reg.exe no valida")
	}
	run := r.Run
	if run == nil {
		run = runCommand
	}
	return run(r.Path, args)
}

// validRegExePath: ruta absoluta de Windows que termina en \reg.exe.
func validRegExePath(p string) bool {
	return validValue(p) && strings.HasSuffix(strings.ToLower(p), `\reg.exe`)
}

// Set ejecuta: reg.exe add <clave> /ve /t REG_SZ /d <valor> /f
func (r RegExe) Set(key, value string) error {
	if !validKey(key) || !validValue(value) {
		return errBadRegArg
	}
	_, exit, err := r.run([]string{"add", key, "/ve", "/t", "REG_SZ", "/d", value, "/f"})
	if err != nil {
		return err
	}
	if exit != 0 {
		return fmt.Errorf("registro: reg add terminó con código %d", exit)
	}
	return nil
}

// Get ejecuta: reg.exe query <clave> /ve. Código 1 = la clave o el valor no existen.
func (r RegExe) Get(key string) (string, bool, error) {
	if !validKey(key) {
		return "", false, errBadRegArg
	}
	out, exit, err := r.run([]string{"query", key, "/ve"})
	if err != nil {
		return "", false, err
	}
	switch exit {
	case 0:
	case 1:
		return "", false, nil
	default:
		return "", false, fmt.Errorf("registro: reg query terminó con código %d", exit)
	}
	v, ok := parseRegQuery(out)
	return v, ok, nil
}

// Delete ejecuta: reg.exe delete <clave> /f. Si la clave no existe no hace nada (se consulta antes: reg delete falla
// con 1 tanto si no existe como por otras causas).
func (r RegExe) Delete(key string) error {
	if !validKey(key) {
		return errBadRegArg
	}
	if _, found, err := r.Get(key); err != nil || !found {
		return err
	}
	_, exit, err := r.run([]string{"delete", key, "/f"})
	if err != nil {
		return err
	}
	if exit != 0 {
		return fmt.Errorf("registro: reg delete terminó con código %d", exit)
	}
	return nil
}

// parseRegQuery lee la salida de `reg query <clave> /ve`: una línea "    (Predeterminado)    REG_SZ    <valor>".
// El nombre del valor está traducido al idioma del sistema, el tipo REG_SZ no.
func parseRegQuery(out []byte) (string, bool) {
	for _, line := range strings.Split(string(out), "\n") {
		line = strings.TrimRight(line, "\r")
		i := strings.Index(line, "REG_SZ")
		if i < 0 || !strings.HasPrefix(line, " ") {
			continue
		}
		v := strings.TrimLeft(line[i+len("REG_SZ"):], " \t")
		if v == "" {
			return "", false
		}
		return v, true
	}
	return "", false
}

// runCommand ejecuta exe sin shell, con límite de tiempo, y separa el código de salida del error de ejecución.
func runCommand(exe string, args []string) ([]byte, int, error) {
	ctx, cancel := context.WithTimeout(context.Background(), regTimeout)
	defer cancel()
	var stdout bytes.Buffer
	cmd := exec.CommandContext(ctx, exe, args...)
	cmd.Stdout = &stdout
	err := cmd.Run()
	var exitErr *exec.ExitError
	switch {
	case err == nil:
		return stdout.Bytes(), 0, nil
	case errors.As(err, &exitErr):
		return stdout.Bytes(), exitErr.ExitCode(), nil
	}
	return nil, 0, errors.New("registro: no se pudo ejecutar reg.exe")
}
