package main

import (
	"errors"
	"net/url"
	"path/filepath"
	"strings"
	"unicode"
)

const (
	maxURLLen       = 2048
	maxContainerLen = 64
)

var (
	errBadURL           = errors.New("bad url")
	errUnknownProfile   = errors.New("unknown profile")
	errBadContainer     = errors.New("bad container name")
	errUnknownContainer = errors.New("unknown container")
)

type OpenRequest struct {
	V                int    `json:"v"`
	ProfileDirectory string `json:"profileDirectory"`
	Container        string `json:"container,omitempty"`
	URL              string `json:"url"`
}

// validateOpen devuelve la URL re-serializada que se pasará al navegador.
// containers es la lista blanca del perfil de destino: Brave abre fuera del contenedor sin avisar
// si el nombre no coincide exactamente (F0, prueba 2), así que se falla cerrado.
func validateOpen(req OpenRequest, profiles map[string]string, containers map[string]bool) (string, error) {
	if !knownProfile(req.ProfileDirectory, profiles) {
		return "", errUnknownProfile
	}
	if req.Container != "" {
		if err := validateContainerName(req.Container); err != nil {
			return "", err
		}
		if !containers[req.Container] {
			return "", errUnknownContainer
		}
	}
	if req.URL == "" || len(req.URL) > maxURLLen || strings.HasPrefix(req.URL, "-") || strings.ContainsFunc(req.URL, unicode.IsControl) {
		return "", errBadURL
	}
	u, err := url.Parse(req.URL)
	if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Host == "" || u.User != nil {
		return "", errBadURL
	}
	// security: Go recodifica ruta y fragmento, pero deja la consulta tal cual (espacios, Unicode) y codifica
	// con % los hosts IDN. No es inyección: la URL va en un único argumento tras "--" y empieza por http(s).
	return u.String(), nil
}

// knownProfile exige que la carpeta esté en la lista blanca de Local State y que sea un único
// elemento de ruta, porque con ella se construye <userDataDir>/<perfil>/Preferences.
func knownProfile(dir string, profiles map[string]string) bool {
	_, ok := profiles[dir]
	return ok && !strings.HasPrefix(dir, "-") && filepath.IsLocal(dir) && filepath.Base(dir) == dir
}

func validateContainerName(name string) error {
	if strings.TrimSpace(name) == "" || len(name) > maxContainerLen || strings.HasPrefix(name, "-") ||
		strings.Contains(name, "=") || strings.ContainsFunc(name, unicode.IsControl) {
		return errBadContainer
	}
	return nil
}
