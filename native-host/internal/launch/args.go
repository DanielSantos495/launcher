// Package launch construye los argumentos con los que el host lanza el navegador y lo lanza, sin shell. Es la parte
// más delicada del host: el ejecutable sale siempre de la configuración (nunca del mensaje), los switches son fijos,
// la URL va después de "--" y ningún argumento libre (carpeta, nombre, URL, nonce) puede empezar por "-".
package launch

import (
	"errors"
	"slices"
	"strconv"
	"strings"

	"github.com/DanielSantos495/launcher/native-host/internal/caller"
	"github.com/DanielSantos495/launcher/native-host/internal/profiles"
	"github.com/DanielSantos495/launcher/native-host/internal/protocol"
)

// ErrInvalidArgument indica que un valor no cumple el contrato (carpeta, URL, nombre, id de extensión o nonce). No
// lleva el valor: los constructores de argumentos son una segunda defensa, y el mensaje ya se validó antes.
var ErrInvalidArgument = errors.New("launch: argumento no valido")

// Switches fijos. Son los únicos argumentos que empiezan por "-".
const (
	profileSwitch   = "--profile-directory="
	containerSwitch = "--container="
	temporarySwitch = "--temporary-container"
	endOfOptions    = "--"
)

// whoamiPage es la página de la extensión que muestra en qué perfil está abierta (doctor --verify).
const whoamiPage = "whoami.html#"

// minTemporaryMinor es la primera versión menor de Brave 1.x con contenedores temporales (1.95).
const minTemporaryMinor = 95

// OpenArgs son los argumentos para abrir url en un perfil: --profile-directory=<d> -- <url>.
func OpenArgs(profileDir, url string) ([]string, error) {
	if !protocol.ValidProfileDirectory(profileDir) || !protocol.ValidURL(url) {
		return nil, ErrInvalidArgument
	}
	return []string{profileSwitch + profileDir, endOfOptions, url}, nil
}

// TemporaryArgs son los argumentos para abrir url en un contenedor temporal de Brave:
// --profile-directory=<d> --temporary-container [--container=<n>] -- <url>. Con name vacío no se pasa
// --container.
func TemporaryArgs(profileDir, url, name string) ([]string, error) {
	if !protocol.ValidProfileDirectory(profileDir) || !protocol.ValidURL(url) {
		return nil, ErrInvalidArgument
	}
	args := []string{profileSwitch + profileDir, temporarySwitch}
	if name != "" {
		if !protocol.ValidContainerName(name) {
			return nil, ErrInvalidArgument
		}
		args = append(args, containerSwitch+name)
	}
	return append(args, endOfOptions, url), nil
}

// CreateProfileArgs son los argumentos para crear un perfil: --profile-directory=<d>. El navegador crea la carpeta
// al abrirla.
func CreateProfileArgs(profileDir string) ([]string, error) {
	if !protocol.ValidProfileDirectory(profileDir) {
		return nil, ErrInvalidArgument
	}
	return []string{profileSwitch + profileDir}, nil
}

// WhoamiURL es la página whoami de la extensión con el nonce en el fragmento:
// chrome-extension://<id>/whoami.html#<nonce>. No valida nada: WhoamiArgs sí.
func WhoamiURL(extensionID, nonce string) string {
	return caller.Origin(extensionID) + whoamiPage + nonce
}

// WhoamiArgs son los argumentos para abrir la página whoami en un perfil: --profile-directory=<d> -- <whoami>.
func WhoamiArgs(profileDir, extensionID, nonce string) ([]string, error) {
	if !protocol.ValidProfileDirectory(profileDir) || !caller.ValidExtensionID(extensionID) || !protocol.ValidNonce(nonce) {
		return nil, ErrInvalidArgument
	}
	return []string{profileSwitch + profileDir, endOfOptions, WhoamiURL(extensionID, nonce)}, nil
}

// SupportsTemporaryContainer dice si el navegador admite --temporary-container: solo Brave, y solo con una versión
// legible (Last Version) y de la forma <chromium>.<major>.<menor>.<compilación> con Brave >= 1.95. En Brave la versión
// 155.1.97.56 es Brave 1.97.56. Cualquier otra cosa da false (falla cerrado).
func SupportsTemporaryContainer(browser, lastVersion string) bool {
	if browser != "brave" {
		return false
	}
	version, ok := profiles.ParseLastVersion(lastVersion)
	if !ok {
		return false
	}
	parts := strings.Split(version, ".")
	if len(parts) != 4 {
		return false
	}
	major, err := strconv.Atoi(parts[1])
	if err != nil {
		return false
	}
	minor, err := strconv.Atoi(parts[2])
	if err != nil {
		return false
	}
	return major > 1 || (major == 1 && minor >= minTemporaryMinor)
}

// ContainerNameTaken dice si name ya es el nombre de un contenedor, sin distinguir mayúsculas (strings.EqualFold).
func ContainerNameTaken(name string, containers []string) bool {
	return slices.ContainsFunc(containers, func(c string) bool { return strings.EqualFold(c, name) })
}
