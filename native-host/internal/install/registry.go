package install

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os/exec"
	"regexp"
	"slices"
	"strings"
	"time"
	"unicode/utf16"
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

// RegExe escribe y borra con reg.exe del sistema, sin shell, y lee con la API del registro (Read). Path es la ruta
// absoluta de reg.exe (<GetSystemDirectoryW>\reg.exe).
//
// La lectura no usa `reg query`: reg.exe escribe en la página de códigos de la consola y una ruta con caracteres no
// ASCII (C:\Users\José) saldría cambiada. RegQueryValueExW la da en UTF-16.
type RegExe struct {
	Path string
	Run  Runner  // nil = ejecutar de verdad
	Read *RegAPI // nil = no se puede leer (Get falla)
}

// RegAPI son las tres llamadas a la API del registro que hacen falta para leer el valor por defecto de una clave de
// HKCU. En Windows son RegOpenKeyExW, RegQueryValueExW y RegCloseKey; las pruebas pasan falsos.
type RegAPI struct {
	// Open abre HKCU\<subkey> para leer. Devuelve errRegNotFound si la clave no existe.
	Open func(subkey string) (handle uintptr, err error)
	// Query lee el valor por defecto en buf y devuelve su tipo y su tamaño en bytes. Devuelve errRegNotFound si el valor
	// no existe y errRegMoreData (con el tamaño necesario) si no cabe en buf.
	Query func(handle uintptr, buf []uint16) (valType uint32, size uint32, err error)
	Close func(handle uintptr) error
}

var (
	errRegNotFound = errors.New("registro: no existe")
	errRegMoreData = errors.New("registro: el valor no cabe")
	errRegBadValue = errors.New("registro: valor no valido")
)

const (
	regSZ = 1 // REG_SZ
	// maxRegValueChars es lo máximo que se lee de un valor (en unidades UTF-16): el de una ruta larga de Windows.
	maxRegValueChars = 32768
)

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

// Get lee el valor por defecto con la API del registro, en UTF-16. found es false si la clave o el valor no existen (o
// el valor está vacío). Un valor que no es REG_SZ, con un NUL en medio o con UTF-16 inválido es un error.
func (r RegExe) Get(key string) (string, bool, error) {
	if !validKey(key) {
		return "", false, errBadRegArg
	}
	if r.Read == nil || r.Read.Open == nil || r.Read.Query == nil || r.Read.Close == nil {
		return "", false, errors.New("registro: lectura no disponible")
	}
	h, err := r.Read.Open(strings.TrimPrefix(key, `HKCU\`))
	if errors.Is(err, errRegNotFound) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	defer r.Read.Close(h)
	buf := make([]uint16, 260)
	for range 2 {
		typ, size, err := r.Read.Query(h, buf)
		switch {
		case errors.Is(err, errRegNotFound):
			return "", false, nil
		case errors.Is(err, errRegMoreData):
			if size == 0 || size > 2*maxRegValueChars {
				return "", false, errRegBadValue
			}
			buf = make([]uint16, (size+1)/2)
			continue
		case err != nil:
			return "", false, err
		}
		if typ != regSZ || size%2 != 0 || int(size/2) > len(buf) {
			return "", false, errRegBadValue
		}
		v, ok := decodeRegString(buf[:size/2])
		if !ok {
			return "", false, errRegBadValue
		}
		return v, v != "", nil
	}
	return "", false, errRegBadValue
}

// decodeRegString pasa un REG_SZ a UTF-8: quita los NUL del final (el registro no garantiza que haya uno) y rechaza un
// NUL en medio y los sustitutos sueltos.
func decodeRegString(u []uint16) (string, bool) {
	for len(u) > 0 && u[len(u)-1] == 0 {
		u = u[:len(u)-1]
	}
	if slices.Contains(u, 0) {
		return "", false
	}
	runes := utf16.Decode(u)
	if !slices.Equal(utf16.Encode(runes), u) {
		return "", false // utf16.Decode cambia los sustitutos sueltos por U+FFFD
	}
	return string(runes), true
}

// Delete ejecuta: reg.exe delete <clave> /f. Si la clave no existe no hace nada (se consulta antes con Get: reg delete
// falla con 1 tanto si no existe como por otras causas).
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
