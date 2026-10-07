package main

import (
	"errors"
	"path/filepath"
	"strings"
)

// Defensa por proceso padre (se evalúa en la Tarea 9): el navegador lanza el host como hijo directo
// de su proceso principal (medido en macOS: ppid = PID principal de Brave).
var errParentUnsupported = errors.New("unsupported")

// parseLsofTxt lee la salida de `lsof -a -p <pid> -d txt -Fn` y devuelve la primera entrada txt,
// que es el ejecutable real (sale del fichero abierto). No se usa `ps -o comm=` porque en macOS
// devuelve argv[0], que el proceso elige (medido: puede ser relativo o falso).
func parseLsofTxt(out []byte) (string, error) {
	for _, line := range strings.Split(string(out), "\n") {
		if p, ok := strings.CutPrefix(line, "n"); ok {
			if !filepath.IsAbs(p) {
				break
			}
			return p, nil
		}
	}
	return "", errors.New("parent path not found")
}

// parentMatch compara la ruta exacta del padre con config.exe; vacío nunca coincide.
func parentMatch(parent, exe string) bool {
	return parent != "" && exe != "" && filepath.Clean(parent) == filepath.Clean(exe)
}
