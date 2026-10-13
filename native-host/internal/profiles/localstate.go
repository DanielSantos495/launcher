// Package profiles lee los archivos que escribe el navegador (Local State, Preferences y Last Version). Todo se
// decodifica con jsonx a mapas de claves exactas: nunca a structs, que emparejan las claves sin distinguir
// mayúsculas. Los errores no repiten nada del contenido de los archivos.
package profiles

import (
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"sort"
	"strings"

	"github.com/DanielSantos495/launcher/native-host/internal/jsonx"
	"github.com/DanielSantos495/launcher/native-host/internal/protocol"
)

// MaxFileBytes es el tamaño máximo de Local State y de Preferences. Se comprueba antes de decodificar.
const MaxFileBytes = 16 << 20

const (
	localStateFile = "Local State"
	guestProfile   = "Guest Profile"
	systemProfile  = "System Profile"
)

// errLocalState es el único error de forma de Local State: no lleva nada del archivo.
var errLocalState = errors.New("profiles: Local State no valido")

// LocalState es el contenido de Local State que le importa al host: los perfiles listables y las carpetas ya
// tomadas. Es inmutable después de ParseLocalState.
type LocalState struct {
	// entries son los perfiles que cumplen el contrato, ordenados por carpeta (bytes) y sin el tope de MaxProfiles.
	entries []protocol.ProfileInfo
	// known son las carpetas de entries.
	known map[string]struct{}
	// taken son las carpetas de info_cache y de profile_basenames_deleted, en minúsculas.
	taken map[string]struct{}
}

// ParseLocalState decodifica un Local State. Sin "profile" o sin "info_cache" no hay perfiles (no es un error);
// una forma que no es la esperada (un "profile" que no es un objeto, por ejemplo) sí lo es. Dentro de info_cache,
// un perfil que no cumple el contrato (carpeta no válida, sin nombre, nombre de más de 256 unidades UTF-16, perfil de
// invitado o de sistema, borrado) se omite sin error.
func ParseLocalState(b []byte) (*LocalState, error) {
	root, ok := decodeObject(b)
	if !ok {
		return nil, errLocalState
	}
	ls := &LocalState{known: map[string]struct{}{}, taken: map[string]struct{}{}}

	// Los borrados se leen primero: filtran los perfiles de info_cache.
	deleted := map[string]struct{}{}
	if rawProfiles, present := root["profiles"]; present {
		fields, ok := jsonx.Object(rawProfiles)
		if !ok {
			return nil, errLocalState
		}
		if rawDeleted, present := fields["profile_basenames_deleted"]; present {
			items, ok := jsonx.Array(rawDeleted)
			if !ok {
				return nil, errLocalState
			}
			for _, item := range items {
				name, ok := jsonx.String(item)
				if !ok || name == "" {
					continue
				}
				// Base por si algún navegador guarda la ruta completa.
				base := filepath.Base(name)
				deleted[base] = struct{}{}
				ls.taken[strings.ToLower(base)] = struct{}{}
			}
		}
	}

	if rawProfile, present := root["profile"]; present {
		fields, ok := jsonx.Object(rawProfile)
		if !ok {
			return nil, errLocalState
		}
		if rawCache, present := fields["info_cache"]; present {
			cache, ok := jsonx.Object(rawCache)
			if !ok {
				return nil, errLocalState
			}
			for dir, rawInfo := range cache {
				// Toda carpeta de info_cache está tomada, aunque no sea un perfil listable.
				ls.taken[strings.ToLower(dir)] = struct{}{}
				if _, isDeleted := deleted[dir]; isDeleted {
					continue
				}
				if info, ok := profileInfo(dir, rawInfo); ok {
					ls.entries = append(ls.entries, info)
					ls.known[dir] = struct{}{}
				}
			}
		}
	}

	sort.Slice(ls.entries, func(i, j int) bool { return ls.entries[i].Directory < ls.entries[j].Directory })
	return ls, nil
}

// profileInfo convierte una entrada de info_cache. Devuelve false si la carpeta o el nombre no cumplen el contrato.
func profileInfo(dir string, raw json.RawMessage) (protocol.ProfileInfo, bool) {
	if dir == guestProfile || dir == systemProfile || !protocol.ValidProfileDirectory(dir) {
		return protocol.ProfileInfo{}, false
	}
	fields, ok := jsonx.Object(raw)
	if !ok {
		return protocol.ProfileInfo{}, false
	}
	name, ok := jsonx.String(fields["name"])
	if !ok || protocol.UTF16Len(name) > protocol.MaxProfileName {
		return protocol.ProfileInfo{}, false
	}
	// D15: si falta is_using_default_name o no es un booleano, se asume true (no se revincula por ese nombre).
	info := protocol.ProfileInfo{Directory: dir, Name: name, IsUsingDefaultName: true}
	if v, ok := jsonx.Bool(fields["is_using_default_name"]); ok {
		info.IsUsingDefaultName = v
	}
	// El color es un ARGB con signo; se queda con los 24 bits de rojo, verde y azul. Si no es un entero, sin color.
	if v, ok := jsonx.Int(fields["profile_highlight_color"]); ok {
		info.Color = fmt.Sprintf("#%06x", uint32(v)&0xFFFFFF)
	}
	return info, true
}

// ReadLocalState lee <userDataDir>/Local State. Si el archivo no existe, el error cumple fs.ErrNotExist; si pesa
// más de MaxFileBytes, jsonx.ErrFileTooLarge.
func ReadLocalState(userDataDir string) (*LocalState, error) {
	b, err := jsonx.ReadFileLimit(filepath.Join(userDataDir, localStateFile), MaxFileBytes)
	if err != nil {
		return nil, err
	}
	return ParseLocalState(b)
}

// List devuelve los perfiles ordenados por carpeta (orden de bytes), como mucho protocol.MaxProfiles. Nunca es nil y
// es una copia: quien la recibe puede modificarla.
func (ls *LocalState) List() []protocol.ProfileInfo {
	n := min(len(ls.entries), protocol.MaxProfiles)
	out := make([]protocol.ProfileInfo, n)
	copy(out, ls.entries[:n])
	return out
}

// Known dice si dir es la carpeta de un perfil de la lista filtrada. No aplica el tope de MaxProfiles: un perfil
// que no cabe en List sigue siendo conocido. Distingue mayúsculas (es la carpeta exacta).
func (ls *LocalState) Known(dir string) bool {
	_, ok := ls.known[dir]
	return ok
}

// Taken dice si dir ya la usa un perfil: está en info_cache o en profile_basenames_deleted, sin distinguir
// mayúsculas (el sistema de archivos de macOS no las distingue).
func (ls *LocalState) Taken(dir string) bool {
	_, ok := ls.taken[strings.ToLower(dir)]
	return ok
}

// decodeObject comprueba el tamaño y el texto (UTF-8 válido, sin sustitutos sueltos) y decodifica un objeto.
func decodeObject(b []byte) (map[string]json.RawMessage, bool) {
	if len(b) > MaxFileBytes || !jsonx.CheckText(b) {
		return nil, false
	}
	return jsonx.Object(b)
}
