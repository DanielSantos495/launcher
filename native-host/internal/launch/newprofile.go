package launch

import (
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"

	"github.com/DanielSantos495/launcher/native-host/internal/profiles"
)

const (
	// newProfileAttempts es el número de carpetas candidatas que se prueban antes de rendirse.
	newProfileAttempts = 16
	newProfilePrefix   = "Launcher-"
)

var errNewProfile = errors.New("launch: no se pudo elegir una carpeta de perfil libre")

// NewProfileDirectory elige una carpeta Launcher-<8 hexadecimales en minúsculas> libre: que no esté tomada en Local
// State (info_cache o borrados, sin distinguir mayúsculas) ni exista en userDataDir. r da la aleatoriedad (4 bytes por
// candidato; en producción, crypto/rand). exists dice si una ruta existe; ante cualquier duda (un error que no sea
// "no existe") tiene que devolver true: ver PathExists. Prueba 16 candidatos.
func NewProfileDirectory(r io.Reader, ls *profiles.LocalState, userDataDir string, exists func(string) bool) (string, error) {
	if r == nil || ls == nil || exists == nil {
		return "", errNewProfile
	}
	var buf [4]byte
	for range newProfileAttempts {
		if _, err := io.ReadFull(r, buf[:]); err != nil {
			return "", fmt.Errorf("launch: no se pudo leer aleatoriedad: %w", err)
		}
		candidate := newProfilePrefix + hex.EncodeToString(buf[:])
		if ls.Taken(candidate) || exists(filepath.Join(userDataDir, candidate)) {
			continue
		}
		return candidate, nil
	}
	return "", errNewProfile
}

// PathExists dice si hay algo en path (sin seguir enlaces simbólicos). Solo "no existe" (fs.ErrNotExist) cuenta como
// libre: cualquier otro error (permisos, un componente que no es una carpeta...) devuelve true, así que no se
// reutiliza una carpeta de la que no se sabe nada.
func PathExists(path string) bool {
	_, err := os.Lstat(path)
	return !errors.Is(err, fs.ErrNotExist)
}
