package main

import (
	"encoding/json"
	"os"
	"path/filepath"
)

type localState struct {
	Profile struct {
		InfoCache map[string]struct {
			Name string `json:"name"`
		} `json:"info_cache"`
	} `json:"profile"`
	Profiles struct {
		// Carpetas de perfiles eliminados pendientes de borrar (medido en Brave 1.96.61).
		BasenamesDeleted []string `json:"profile_basenames_deleted"`
	} `json:"profiles"`
}

// readProfiles devuelve carpeta → nombre visible, sin los perfiles de invitado, de sistema ni eliminados.
func readProfiles(path string) (map[string]string, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var ls localState
	if err := json.Unmarshal(b, &ls); err != nil {
		return nil, err
	}
	deleted := make(map[string]bool, len(ls.Profiles.BasenamesDeleted))
	for _, d := range ls.Profiles.BasenamesDeleted {
		deleted[filepath.Base(d)] = true // Base por si algún navegador guarda la ruta completa
	}
	out := make(map[string]string, len(ls.Profile.InfoCache))
	for dir, info := range ls.Profile.InfoCache {
		if dir == "Guest Profile" || dir == "System Profile" || deleted[dir] {
			continue
		}
		out[dir] = info.Name
	}
	return out, nil
}

type preferences struct {
	Brave struct {
		Containers struct {
			List []struct {
				Name string `json:"name"`
			} `json:"list"`
		} `json:"containers"`
	} `json:"brave"`
}

// readContainers devuelve los nombres exactos (distinguen mayúsculas) de los contenedores de un perfil.
// Los contenedores son de cada perfil; sin lista (Chrome, Edge o un perfil sin contenedores) el mapa queda vacío.
func readContainers(prefsPath string) (map[string]bool, error) {
	b, err := os.ReadFile(prefsPath)
	if err != nil {
		return nil, err
	}
	var p preferences
	if err := json.Unmarshal(b, &p); err != nil {
		return nil, err
	}
	out := make(map[string]bool, len(p.Brave.Containers.List))
	for _, c := range p.Brave.Containers.List {
		out[c.Name] = true
	}
	return out, nil
}
