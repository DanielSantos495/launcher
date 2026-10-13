package store

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"

	"github.com/DanielSantos495/launcher/native-host/internal/jsonx"
	"github.com/DanielSantos495/launcher/native-host/internal/protocol"
)

// maxIconFileBytes es el tamaño máximo de un archivo de icono (64 KiB): un icono de MaxIconBytes en base64 cabe de
// sobra (43 692 caracteres más el JSON).
const maxIconFileBytes = 64 << 10

// maxIcons es MaxIcons como variable de paquete para que las pruebas lo reduzcan.
var maxIcons = MaxIcons

var (
	errBadKey  = errors.New("store: clave de icono no valida")
	errBadIcon = errors.New("store: icono no valido")
)

// Icon es un icono guardado: su tipo (png, jpeg o webp, nunca svg) y sus bytes en base64.
type Icon struct {
	Mime   string `json:"mime"`
	Base64 string `json:"base64"`
}

// iconPath devuelve la ruta del archivo de la clave key ("icon:<id>"): icons/<hex del id>.json. El hexadecimal
// evita cualquier carácter de ruta y distingue mayúsculas de minúsculas aunque el sistema de archivos no lo haga.
func (s *Store) iconPath(key string) (string, bool) {
	if !protocol.ValidIconKey(key) {
		return "", false
	}
	id := strings.TrimPrefix(key, "icon:")
	return filepath.Join(s.dir, IconsDir, hex.EncodeToString([]byte(id))+".json"), true
}

// GetIcon lee el icono de key. Una clave sin icono devuelve (Icon{}, false, nil). Un archivo que no cumple el
// formato (svg, base64 inválido, campos de más) o una clave inválida es un error: el router lo convierte en internal.
func (s *Store) GetIcon(key string) (Icon, bool, error) {
	if s.lock == nil {
		return Icon{}, false, errClosed
	}
	path, ok := s.iconPath(key)
	if !ok {
		return Icon{}, false, errBadKey
	}
	b, err := jsonx.ReadFileLimit(path, maxIconFileBytes)
	if errors.Is(err, fs.ErrNotExist) {
		return Icon{}, false, nil
	}
	if err != nil {
		return Icon{}, false, err
	}
	ic, err := decodeIcon(b)
	if err != nil {
		return Icon{}, false, err
	}
	return ic, true, nil
}

// decodeIcon decodifica un archivo de icono: struct con DisallowUnknownFields, nada tras el objeto y formato válido.
func decodeIcon(b []byte) (Icon, error) {
	if !jsonx.CheckText(b) {
		return Icon{}, errBadIcon
	}
	dec := json.NewDecoder(bytes.NewReader(b))
	dec.DisallowUnknownFields()
	var ic Icon
	if err := dec.Decode(&ic); err != nil {
		return Icon{}, errBadIcon
	}
	var extra json.RawMessage
	if err := dec.Decode(&extra); !errors.Is(err, io.EOF) {
		return Icon{}, errBadIcon
	}
	if !protocol.ValidMime(ic.Mime) || !protocol.ValidBase64(ic.Base64) {
		return Icon{}, errBadIcon
	}
	return ic, nil
}

// PutIcon guarda el icono de key, o lo reemplaza si ya existía. Devuelve nil, LimitReached (clave nueva con maxIcons
// iconos ya guardados) o Internal (clave o icono que el router debía haber rechazado, o un fallo de disco). La
// escritura es atómica, como la de Save.
func (s *Store) PutIcon(key string, ic Icon) *protocol.Error {
	if s.lock == nil {
		return protocol.Fail(protocol.Internal)
	}
	path, ok := s.iconPath(key)
	if !ok || !protocol.ValidMime(ic.Mime) || !protocol.ValidBase64(ic.Base64) {
		return protocol.Fail(protocol.Internal)
	}
	dir := filepath.Join(s.dir, IconsDir)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return protocol.Fail(protocol.Internal)
	}
	// El tope solo cuenta al añadir una clave nueva: reemplazar una existente no suma.
	switch _, err := os.Lstat(path); {
	case err == nil:
	case errors.Is(err, fs.ErrNotExist):
		n, err := countIcons(dir)
		if err != nil {
			return protocol.Fail(protocol.Internal)
		}
		if n >= maxIcons {
			return protocol.Fail(protocol.LimitReached)
		}
	default:
		return protocol.Fail(protocol.Internal)
	}
	body, err := encodeJSON(ic)
	if err != nil {
		return protocol.Fail(protocol.Internal)
	}
	if err := writeAtomic(dir, ".icon-*.tmp", path, body); err != nil {
		return protocol.Fail(protocol.Internal)
	}
	return nil
}

// countIcons cuenta los archivos .json de dir; los temporales no cuentan.
func countIcons(dir string) (int, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return 0, err
	}
	n := 0
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".json") {
			n++
		}
	}
	return n, nil
}

// DeleteIcon borra el icono de key. Una clave sin icono no es un error.
func (s *Store) DeleteIcon(key string) error {
	if s.lock == nil {
		return errClosed
	}
	path, ok := s.iconPath(key)
	if !ok {
		return errBadKey
	}
	if err := os.Remove(path); err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return nil
		}
		return err
	}
	syncDir(filepath.Dir(path))
	return nil
}
