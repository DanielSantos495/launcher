package main

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
)

// Hay una copia del binario por navegador; su config.json dice a qué navegador sirve.
type config struct {
	Browser     string `json:"browser"`
	Exe         string `json:"exe"`
	AppPath     string `json:"appPath,omitempty"`
	UserDataDir string `json:"userDataDir"`
	LaunchMode  string `json:"launchMode"` // "direct" | "open" (solo macOS)
}

func (c config) localStatePath() string { return filepath.Join(c.UserDataDir, "Local State") }

// preferencesPath solo debe recibir carpetas aceptadas por knownProfile.
func (c config) preferencesPath(profileDir string) string {
	return filepath.Join(c.UserDataDir, profileDir, "Preferences")
}

func loadConfig() (config, string, error) {
	exe, err := os.Executable()
	if err != nil {
		return config{}, "", err
	}
	dir := filepath.Dir(exe)
	b, err := os.ReadFile(filepath.Join(dir, "config.json"))
	if err != nil {
		return config{}, dir, err
	}
	c, err := parseConfig(b)
	return c, dir, err
}

// parseConfig exige rutas absolutas: el ejecutable nunca se busca en el PATH ni sale del mensaje.
func parseConfig(b []byte) (config, error) {
	var c config
	if err := json.Unmarshal(b, &c); err != nil {
		return config{}, err
	}
	switch {
	case c.Browser == "":
		return config{}, errors.New("missing browser")
	case !filepath.IsAbs(c.Exe):
		return config{}, errors.New("exe must be an absolute path")
	case strings.EqualFold(filepath.Ext(c.Exe), ".bat") || strings.EqualFold(filepath.Ext(c.Exe), ".cmd"):
		// Windows ejecuta los .bat/.cmd con cmd.exe, que interpretaría caracteres de la URL como "&".
		return config{}, errors.New("exe must not be a batch file")
	case !filepath.IsAbs(c.UserDataDir):
		return config{}, errors.New("userDataDir must be an absolute path")
	case c.LaunchMode != "direct" && c.LaunchMode != "open":
		return config{}, errors.New("launchMode must be direct or open")
	case c.LaunchMode == "open" && !filepath.IsAbs(c.AppPath):
		return config{}, errors.New("appPath must be an absolute path")
	}
	return c, nil
}
