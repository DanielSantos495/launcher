package store

import "testing"

// SetMaxIcons cambia el tope de iconos durante la prueba t y lo restaura al terminar.
func SetMaxIcons(t testing.TB, n int) {
	t.Helper()
	old := maxIcons
	maxIcons = n
	t.Cleanup(func() { maxIcons = old })
}
