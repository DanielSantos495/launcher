// Package caller decide quién puede hablar con el host y qué navegador representa: lee config.json (la única fuente
// del ejecutable y de las rutas), comprueba el origen que el navegador pasa como argumento y verifica que el
// proceso padre sea el navegador configurado. Los errores no repiten valores del archivo ni del mensaje.
package caller

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"path/filepath"
	"slices"
	"strings"
	"unicode/utf8"

	"github.com/DanielSantos495/launcher/native-host/internal/jsonx"
	"github.com/DanielSantos495/launcher/native-host/internal/protocol"
)

// ConfigFile es el nombre del archivo de configuración, junto al binario del host.
const ConfigFile = "config.json"

// maxConfigBytes es el tamaño máximo de config.json (64 KiB). Se comprueba antes de decodificar.
const maxConfigBytes = 64 << 10

// hostNamePrefix es el prefijo del nombre del host de native messaging; el sufijo es el navegador.
const hostNamePrefix = "com.curyapps.launcher."

// Browsers son los navegadores admitidos, en el orden en que se muestran.
var Browsers = []string{"brave", "chrome", "edge"}

// Config es config.json. Lo escribe el propio host (install) y se decodifica a un struct con
// DisallowUnknownFields; después se valida campo a campo (ParseConfig).
type Config struct {
	Browser      string `json:"browser"`      // brave | chrome | edge
	Exe          string `json:"exe"`          // ruta absoluta del ejecutable del navegador
	UserDataDir  string `json:"userDataDir"`  // ruta absoluta
	ExtensionID  string `json:"extensionId"`  // ^[a-p]{32}$
	BinarySHA256 string `json:"binarySha256"` // hex en minúsculas del binario instalado (doctor, T9)
	Log          bool   `json:"log,omitempty"`
}

// errConfig es el error de un config.json que ni siquiera se deja decodificar. Es genérico a propósito: el error de
// encoding/json para un campo desconocido repite el nombre de la clave.
var errConfig = errors.New("caller: config.json no valido")

// fieldError dice qué campo de config.json no es válido, sin repetir su valor.
type fieldError string

func (e fieldError) Error() string {
	return "caller: config.json: campo " + string(e) + " no valido"
}

// HostName es el nombre del host de native messaging de un navegador: com.curyapps.launcher.<navegador>.
func HostName(browser string) string { return hostNamePrefix + browser }

// ValidExtensionID dice si s es un id de extensión de Chromium: ^[a-p]{32}$.
func ValidExtensionID(s string) bool {
	if len(s) != 32 {
		return false
	}
	for i := 0; i < len(s); i++ {
		if s[i] < 'a' || s[i] > 'p' {
			return false
		}
	}
	return true
}

// Origin es el origen que el navegador pasa al host como primer argumento: chrome-extension://<id>/.
func Origin(extensionID string) string { return "chrome-extension://" + extensionID + "/" }

// ParseConfig decodifica y valida un config.json. Rechaza los campos desconocidos, los datos sobrantes, los textos
// con UTF-8 inválido o sustitutos sueltos, los navegadores que no están en Browsers, las rutas que no son absolutas
// o llevan caracteres de control, los ejecutables .bat y .cmd (Windows los ejecutaría con cmd.exe, que interpreta
// caracteres de la URL), un id de extensión que no cumple ^[a-p]{32}$ y un binarySha256 que no son 64 dígitos
// hexadecimales en minúsculas.
func ParseConfig(b []byte) (Config, error) {
	if len(b) > maxConfigBytes || !jsonx.CheckText(b) {
		return Config{}, errConfig
	}
	dec := json.NewDecoder(bytes.NewReader(b))
	dec.DisallowUnknownFields()
	var c Config
	if err := dec.Decode(&c); err != nil {
		return Config{}, errConfig
	}
	// Tras el objeto solo puede haber espacios. (Decoder.More no basta: no ve una llave de cierre sobrante.)
	var extra json.RawMessage
	if err := dec.Decode(&extra); !errors.Is(err, io.EOF) {
		return Config{}, errConfig
	}
	if err := c.validate(); err != nil {
		return Config{}, err
	}
	return c, nil
}

// LoadConfig lee y valida <dir>/config.json (como mucho 64 KiB). Si no existe, el error cumple fs.ErrNotExist.
func LoadConfig(dir string) (Config, error) {
	b, err := jsonx.ReadFileLimit(filepath.Join(dir, ConfigFile), maxConfigBytes)
	if err != nil {
		return Config{}, err
	}
	return ParseConfig(b)
}

// Encode escribe la configuración como la lee ParseConfig: sangría de dos espacios, sin escapar HTML y con salto de
// línea final. Una configuración que ParseConfig rechazaría no se escribe.
func (c Config) Encode() ([]byte, error) {
	if err := c.validate(); err != nil {
		return nil, err
	}
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	enc.SetIndent("", "  ")
	if err := enc.Encode(c); err != nil {
		return nil, errConfig
	}
	return buf.Bytes(), nil
}

// validate comprueba los cinco campos obligatorios y devuelve el primero que falla.
func (c Config) validate() error {
	switch {
	case !slices.Contains(Browsers, c.Browser):
		return fieldError("browser")
	case !validExe(c.Exe):
		return fieldError("exe")
	case !validPath(c.UserDataDir):
		return fieldError("userDataDir")
	case !ValidExtensionID(c.ExtensionID):
		return fieldError("extensionId")
	case !validSHA256(c.BinarySHA256):
		return fieldError("binarySha256")
	}
	return nil
}

// validPath: ruta absoluta, en UTF-8 y sin caracteres de control (un NUL cortaría la ruta en el sistema).
func validPath(p string) bool {
	return filepath.IsAbs(p) && utf8.ValidString(p) && !protocol.HasControlChars(p)
}

// validExe: ruta válida que no es un .bat ni un .cmd (sin distinguir mayúsculas).
func validExe(p string) bool {
	if !validPath(p) {
		return false
	}
	ext := strings.ToLower(filepath.Ext(p))
	return ext != ".bat" && ext != ".cmd"
}

// validSHA256: 64 dígitos hexadecimales en minúsculas.
func validSHA256(s string) bool {
	if len(s) != 64 {
		return false
	}
	for i := 0; i < len(s); i++ {
		c := s[i]
		if (c < '0' || c > '9') && (c < 'a' || c > 'f') {
			return false
		}
	}
	return true
}

// CheckOrigin dice si arg, el origen que el navegador pasa al host, es exactamente el de la extensión configurada.
// Una configuración sin un id válido no da por bueno ningún origen.
func CheckOrigin(arg string, c Config) bool {
	return ValidExtensionID(c.ExtensionID) && arg == Origin(c.ExtensionID)
}
