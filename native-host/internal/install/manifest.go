package install

import (
	"bytes"
	"encoding/json"
	"errors"
	"path/filepath"
	"slices"
	"unicode/utf8"

	"github.com/DanielSantos495/launcher/native-host/internal/caller"
	"github.com/DanielSantos495/launcher/native-host/internal/protocol"
)

const (
	manifestDescription = "Account Launcher native host"
	manifestType        = "stdio"
)

// manifestFile es el manifest de native messaging de Chromium, con las claves en el orden en que se escriben.
type manifestFile struct {
	Name           string   `json:"name"`
	Description    string   `json:"description"`
	Path           string   `json:"path"`
	Type           string   `json:"type"`
	AllowedOrigins []string `json:"allowed_origins"`
}

// wantManifest es el manifest que Install escribe y Doctor espera.
func wantManifest(browser, binaryPath, extensionID string) manifestFile {
	return manifestFile{
		Name:           caller.HostName(browser),
		Description:    manifestDescription,
		Path:           binaryPath,
		Type:           manifestType,
		AllowedOrigins: []string{caller.Origin(extensionID)},
	}
}

// Manifest devuelve el manifest de native messaging del host de browser: nombre com.curyapps.launcher.<navegador>,
// ruta absoluta del binario y un único origen permitido, el de la extensión. Rechaza un navegador desconocido, una
// ruta que no sea absoluta (o lleve caracteres de control) y un id de extensión que no cumpla ^[a-p]{32}$.
func Manifest(browser, binaryPath, extensionID string) ([]byte, error) {
	switch {
	case !slices.Contains(caller.Browsers, browser):
		return nil, errors.New("manifest: navegador desconocido")
	case !filepath.IsAbs(binaryPath) || !utf8.ValidString(binaryPath) || protocol.HasControlChars(binaryPath):
		return nil, errors.New("manifest: la ruta del binario debe ser absoluta y sin caracteres de control")
	case !caller.ValidExtensionID(extensionID):
		return nil, errors.New("manifest: id de extensión no válido")
	}
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	enc.SetIndent("", "  ")
	if err := enc.Encode(wantManifest(browser, binaryPath, extensionID)); err != nil {
		return nil, errors.New("manifest: no se pudo codificar")
	}
	return buf.Bytes(), nil
}
