package profiles

import (
	"errors"
	"io/fs"
	"path/filepath"

	"github.com/DanielSantos495/launcher/native-host/internal/jsonx"
	"github.com/DanielSantos495/launcher/native-host/internal/protocol"
)

const preferencesFile = "Preferences"

var (
	errPreferences = errors.New("profiles: Preferences no valido")
	errProfileDir  = errors.New("profiles: carpeta de perfil no valida")
)

// ParseContainers devuelve los nombres de brave.containers.list[].name, en el orden del archivo. Sin "brave", sin
// "containers" o sin "list" no hay contenedores (lista vacía, no nil). Una forma incorrecta (un "list" que no es un
// array) es un error. Los elementos que no son objetos o no tienen un "name" de texto se omiten.
func ParseContainers(b []byte) ([]string, error) {
	root, ok := decodeObject(b)
	if !ok {
		return nil, errPreferences
	}
	names := make([]string, 0)

	rawBrave, present := root["brave"]
	if !present {
		return names, nil
	}
	brave, ok := jsonx.Object(rawBrave)
	if !ok {
		return nil, errPreferences
	}
	rawContainers, present := brave["containers"]
	if !present {
		return names, nil
	}
	containers, ok := jsonx.Object(rawContainers)
	if !ok {
		return nil, errPreferences
	}
	rawList, present := containers["list"]
	if !present {
		return names, nil
	}
	items, ok := jsonx.Array(rawList)
	if !ok {
		return nil, errPreferences
	}
	for _, item := range items {
		fields, ok := jsonx.Object(item)
		if !ok {
			continue
		}
		if name, ok := jsonx.String(fields["name"]); ok {
			names = append(names, name)
		}
	}
	return names, nil
}

// ReadContainers lee los contenedores de <userDataDir>/<profileDir>/Preferences. Sin archivo, el perfil no tiene
// contenedores (nil, nil). profileDir debe cumplir protocol.ValidProfileDirectory: así la ruta no puede salirse de
// userDataDir.
func ReadContainers(userDataDir, profileDir string) ([]string, error) {
	if !protocol.ValidProfileDirectory(profileDir) {
		return nil, errProfileDir
	}
	b, err := jsonx.ReadFileLimit(filepath.Join(userDataDir, profileDir, preferencesFile), MaxFileBytes)
	if errors.Is(err, fs.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return ParseContainers(b)
}
