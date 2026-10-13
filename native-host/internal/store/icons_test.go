package store_test

import (
	"encoding/hex"
	"errors"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/DanielSantos495/launcher/native-host/internal/jsonx"
	"github.com/DanielSantos495/launcher/native-host/internal/protocol"
	"github.com/DanielSantos495/launcher/native-host/internal/store"
)

var pngIcon = store.Icon{Mime: "image/png", Base64: "AAAA"}

// iconFile es la ruta del archivo de un icono: icons/<hex del id>.json.
func iconFile(dir, id string) string {
	return filepath.Join(dir, store.IconsDir, hex.EncodeToString([]byte(id))+".json")
}

// iconTemps lista los temporales de iconos que quedan en icons/.
func iconTemps(t *testing.T, dir string) []string {
	t.Helper()
	entries, err := os.ReadDir(filepath.Join(dir, store.IconsDir))
	if err != nil {
		t.Fatal(err)
	}
	var out []string
	for _, e := range entries {
		if strings.HasSuffix(e.Name(), ".tmp") {
			out = append(out, e.Name())
		}
	}
	return out
}

func mustPut(t *testing.T, s *store.Store, key string, ic store.Icon) {
	t.Helper()
	if perr := s.PutIcon(key, ic); perr != nil {
		t.Fatalf("PutIcon(%q) = %v", key, perr)
	}
}

func TestPutGetIcon(t *testing.T) {
	dir := t.TempDir()
	s := open(t, dir)
	mustPut(t, s, "icon:a", pngIcon)

	got, ok, err := s.GetIcon("icon:a")
	if err != nil || !ok || got != pngIcon {
		t.Fatalf("GetIcon = %+v, %v, %v; want %+v, true, nil", got, ok, err, pngIcon)
	}
	if hex.EncodeToString([]byte("a")) != "61" {
		t.Fatal("la prueba asume hex(a) = 61")
	}
	file := iconFile(dir, "a")
	if filepath.Base(file) != "61.json" {
		t.Fatalf("archivo esperado 61.json, es %s", filepath.Base(file))
	}
	if p := perm(t, file); p != 0o600 {
		t.Errorf("permisos del icono = %o, want 600", p)
	}
	if p := perm(t, filepath.Join(dir, store.IconsDir)); p != 0o700 {
		t.Errorf("permisos de icons = %o, want 700", p)
	}
	b, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	if string(b) != `{"mime":"image/png","base64":"AAAA"}` {
		t.Errorf("contenido del icono = %s", b)
	}
	if tmp := iconTemps(t, dir); len(tmp) != 0 {
		t.Errorf("quedaron temporales: %v", tmp)
	}
}

func TestIconKeysAreCaseSensitive(t *testing.T) {
	dir := t.TempDir()
	s := open(t, dir)
	upper := store.Icon{Mime: "image/jpeg", Base64: "QUJD"}
	lower := store.Icon{Mime: "image/webp", Base64: "YWJj"}
	mustPut(t, s, "icon:A", upper)
	mustPut(t, s, "icon:a", lower)

	if iconFile(dir, "A") == iconFile(dir, "a") {
		t.Fatal("icon:A e icon:a deben ser archivos distintos")
	}
	for key, want := range map[string]store.Icon{"icon:A": upper, "icon:a": lower} {
		got, ok, err := s.GetIcon(key)
		if err != nil || !ok || got != want {
			t.Errorf("GetIcon(%q) = %+v, %v, %v; want %+v", key, got, ok, err, want)
		}
	}
	// Reemplazar uno no toca el otro.
	mustPut(t, s, "icon:a", pngIcon)
	if got, _, _ := s.GetIcon("icon:A"); got != upper {
		t.Errorf("icon:A cambio al reemplazar icon:a: %+v", got)
	}
}

func TestPutIconReplaces(t *testing.T) {
	dir := t.TempDir()
	s := open(t, dir)
	mustPut(t, s, "icon:a", pngIcon)
	next := store.Icon{Mime: "image/webp", Base64: "YWJj"}
	mustPut(t, s, "icon:a", next)
	got, ok, err := s.GetIcon("icon:a")
	if err != nil || !ok || got != next {
		t.Errorf("GetIcon tras reemplazar = %+v, %v, %v; want %+v", got, ok, err, next)
	}
	entries, _ := os.ReadDir(filepath.Join(dir, store.IconsDir))
	if len(entries) != 1 {
		t.Errorf("icons debe tener un archivo, tiene %d", len(entries))
	}
}

func TestGetIconMissing(t *testing.T) {
	dir := t.TempDir()
	s := open(t, dir)
	for _, when := range []string{"sin carpeta icons", "con carpeta icons"} {
		got, ok, err := s.GetIcon("icon:nope")
		if got != (store.Icon{}) || ok || err != nil {
			t.Errorf("GetIcon (%s) = %+v, %v, %v; want vacio, false, nil", when, got, ok, err)
		}
		mustPut(t, s, "icon:other", pngIcon)
	}
}

func TestDeleteIcon(t *testing.T) {
	dir := t.TempDir()
	s := open(t, dir)
	if err := s.DeleteIcon("icon:a"); err != nil {
		t.Errorf("DeleteIcon sin carpeta icons = %v, want nil", err)
	}
	mustPut(t, s, "icon:a", pngIcon)
	mustPut(t, s, "icon:b", pngIcon)
	if err := s.DeleteIcon("icon:a"); err != nil {
		t.Fatalf("DeleteIcon existente: %v", err)
	}
	if _, ok, _ := s.GetIcon("icon:a"); ok {
		t.Error("icon:a sigue existiendo")
	}
	if _, err := os.Stat(iconFile(dir, "a")); !errors.Is(err, os.ErrNotExist) {
		t.Errorf("el archivo de icon:a sigue en disco: %v", err)
	}
	if _, ok, _ := s.GetIcon("icon:b"); !ok {
		t.Error("DeleteIcon borro otro icono")
	}
	if err := s.DeleteIcon("icon:a"); err != nil {
		t.Errorf("DeleteIcon de una clave inexistente = %v, want nil", err)
	}
}

func TestIconLimit(t *testing.T) {
	store.SetMaxIcons(t, 3)
	dir := t.TempDir()
	s := open(t, dir)
	mustPut(t, s, "icon:a", pngIcon)
	mustPut(t, s, "icon:b", pngIcon)
	// Un temporal huerfano en icons/ no cuenta como icono.
	if err := os.WriteFile(filepath.Join(dir, store.IconsDir, ".icon-1.tmp"), []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	mustPut(t, s, "icon:c", pngIcon) // el tercero llega justo al tope

	perr := s.PutIcon("icon:d", pngIcon)
	if perr == nil || perr.Code != protocol.LimitReached {
		t.Fatalf("PutIcon con el tope alcanzado = %v, want limit_reached", perr)
	}
	if _, err := os.Stat(iconFile(dir, "d")); !errors.Is(err, os.ErrNotExist) {
		t.Errorf("el icono rechazado se escribio: %v", err)
	}

	// Una clave existente se reemplaza aunque se haya llegado al tope.
	replacement := store.Icon{Mime: "image/jpeg", Base64: "QUJD"}
	mustPut(t, s, "icon:b", replacement)
	if got, _, _ := s.GetIcon("icon:b"); got != replacement {
		t.Errorf("icon:b = %+v, want %+v", got, replacement)
	}

	// Al borrar uno hay sitio para uno nuevo.
	if err := s.DeleteIcon("icon:a"); err != nil {
		t.Fatal(err)
	}
	mustPut(t, s, "icon:d", pngIcon)
	if perr := s.PutIcon("icon:e", pngIcon); perr == nil || perr.Code != protocol.LimitReached {
		t.Errorf("PutIcon de nuevo en el tope = %v, want limit_reached", perr)
	}
}

func TestIconDefaultLimit(t *testing.T) {
	if store.MaxIcons != 2500 {
		t.Errorf("MaxIcons = %d, want 2500", store.MaxIcons)
	}
}

func TestIconInputsAreChecked(t *testing.T) {
	dir := t.TempDir()
	s := open(t, dir)
	badKeys := []string{
		"", "a", "icon:", "icon:a/b", "icon:../x", "icon:a.b", "icon:a b", "ICON:a", "icon:" + strings.Repeat("a", 65), "icon:a\x00",
	}
	for _, key := range badKeys {
		if perr := s.PutIcon(key, pngIcon); perr == nil || perr.Code != protocol.Internal {
			t.Errorf("PutIcon(%q) = %v, want internal", key, perr)
		}
		if _, ok, err := s.GetIcon(key); ok || err == nil {
			t.Errorf("GetIcon(%q) = %v, %v; want false y error", key, ok, err)
		}
		if err := s.DeleteIcon(key); err == nil {
			t.Errorf("DeleteIcon(%q) = nil, want error", key)
		}
	}
	// El borde del id: 64 caracteres valen.
	mustPut(t, s, "icon:"+strings.Repeat("a", 64), pngIcon)

	badIcons := []store.Icon{
		{Mime: "image/svg+xml", Base64: "AAAA"},
		{Mime: "", Base64: "AAAA"},
		{Mime: "image/png", Base64: ""},
		{Mime: "image/png", Base64: "AAA"},
		{Mime: "image/png", Base64: "AA!="},
		{Mime: "image/png", Base64: strings.Repeat("A", protocol.MaxBase64Chars)},
	}
	for _, ic := range badIcons {
		if perr := s.PutIcon("icon:x", ic); perr == nil || perr.Code != protocol.Internal {
			t.Errorf("PutIcon(%+v) = %v, want internal", ic, perr)
		}
	}
	if _, err := os.Stat(iconFile(dir, "x")); !errors.Is(err, os.ErrNotExist) {
		t.Errorf("un icono invalido se escribio: %v", err)
	}
}

func TestIconAtMaxSize(t *testing.T) {
	dir := t.TempDir()
	s := open(t, dir)
	big := store.Icon{Mime: "image/png", Base64: strings.Repeat("A", protocol.MaxBase64Chars-1) + "="}
	mustPut(t, s, "icon:big", big)
	got, ok, err := s.GetIcon("icon:big")
	if err != nil || !ok || got != big {
		t.Errorf("GetIcon del icono mas grande: ok %v, err %v", ok, err)
	}
}

func TestGetIconRejectsBadFiles(t *testing.T) {
	dir := t.TempDir()
	s := open(t, dir)
	mustPut(t, s, "icon:z", pngIcon) // crea la carpeta icons
	cases := []struct {
		name    string
		content string
	}{
		{"svg", `{"mime":"image/svg+xml","base64":"AAAA"}`},
		{"base64 invalido", `{"mime":"image/png","base64":"A"}`},
		{"base64 sin relleno", `{"mime":"image/png","base64":"AAA"}`},
		{"mime vacio", `{"mime":"","base64":"AAAA"}`},
		{"sin mime", `{"base64":"AAAA"}`},
		{"campo desconocido", `{"mime":"image/png","base64":"AAAA","extra":1}`},
		{"datos despues del valor", `{"mime":"image/png","base64":"AAAA"} {}`},
		{"json invalido", `{`},
		{"null", `null`},
		{"array", `[]`},
		{"tipo equivocado", `{"mime":1,"base64":"AAAA"}`},
		{"utf8 invalido", "{\"mime\":\"image/png\",\"base64\":\"AAAA\xff\"}"},
		{"mayor de 64 KiB", `{"mime":"image/png","base64":"AAAA"}` + strings.Repeat(" ", 64<<10)},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if err := os.WriteFile(iconFile(dir, "a"), []byte(tc.content), 0o600); err != nil {
				t.Fatal(err)
			}
			got, ok, err := s.GetIcon("icon:a")
			if err == nil || ok || got != (store.Icon{}) {
				t.Errorf("GetIcon = %+v, %v, %v; want vacio, false y error", got, ok, err)
			}
			if strings.Contains(tc.name, "64 KiB") && !errors.Is(err, jsonx.ErrFileTooLarge) {
				t.Errorf("err = %v, want ErrFileTooLarge", err)
			}
		})
	}

	// El limite de 64 KiB: un archivo de exactamente 64 KiB (relleno al final) aun se lee.
	body := `{"mime":"image/png","base64":"AAAA"}`
	exact := body + strings.Repeat(" ", 64<<10-len(body))
	if err := os.WriteFile(iconFile(dir, "a"), []byte(exact), 0o600); err != nil {
		t.Fatal(err)
	}
	if got, ok, err := s.GetIcon("icon:a"); err != nil || !ok || got != pngIcon {
		t.Errorf("GetIcon de un archivo de exactamente 64 KiB = %+v, %v, %v", got, ok, err)
	}
}

func TestPutIconIsAtomic(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("root ignora los permisos de la carpeta")
	}
	dir := t.TempDir()
	s := open(t, dir)
	mustPut(t, s, "icon:a", pngIcon)
	iconsDir := filepath.Join(dir, store.IconsDir)
	if err := os.Chmod(iconsDir, 0o500); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(iconsDir, 0o700) })

	if perr := s.PutIcon("icon:a", store.Icon{Mime: "image/webp", Base64: "YWJj"}); perr == nil || perr.Code != protocol.Internal {
		t.Errorf("PutIcon en una carpeta 0500 = %v, want internal", perr)
	}
	if perr := s.PutIcon("icon:b", pngIcon); perr == nil || perr.Code != protocol.Internal {
		t.Errorf("PutIcon nuevo en una carpeta 0500 = %v, want internal", perr)
	}
	if got, ok, err := s.GetIcon("icon:a"); err != nil || !ok || got != pngIcon {
		t.Errorf("icon:a cambio tras un fallo: %+v, %v, %v", got, ok, err)
	}
	entries, _ := os.ReadDir(iconsDir)
	var names []string
	for _, e := range entries {
		names = append(names, e.Name())
	}
	if !slices.Equal(names, []string{"61.json"}) {
		t.Errorf("icons contiene %v, want solo 61.json", names)
	}
}
