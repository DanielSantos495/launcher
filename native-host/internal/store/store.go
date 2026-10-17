package store

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"time"

	"github.com/DanielSantos495/launcher/native-host/internal/jsonx"
)

const (
	FileName         = "shared.json"
	LockName         = "shared.lock"
	IconsDir         = "icons"
	Format           = 1
	MaxFileBytes     = 4 << 20
	MaxIcons         = 2500
	MaxJoinFailures  = 5  // pair.join fallidos con un mismo código antes de anularlo (D7)
	MaxPendingProofs = 16 // pruebas pendientes de pair.prove a la vez
)

// ErrLocked indica que otro proceso tiene el almacén y no lo soltó dentro del plazo de Open.
var ErrLocked = errors.New("store: almacén bloqueado")

var (
	// errClosed: el almacén ya se cerró; sin el bloqueo ninguna lectura ni escritura es segura.
	errClosed = errors.New("store: almacen cerrado")
	// errCorrupt es genérico a propósito: los errores de encoding/json repiten nombres de claves del archivo.
	errCorrupt = errors.New("store: shared.json no valido")
	errEncode  = errors.New("store: no se pudo codificar el estado")
)

// Store es el acceso exclusivo a la carpeta del host: mientras exista, ningún otro proceso puede abrir el
// almacén. Un Store no es seguro para varias goroutines a la vez; cada proceso del host usa uno.
type Store struct {
	dir  string
	lock *os.File
}

// Open crea shared.lock en dir (0600) si no existe y toma el bloqueo exclusivo, esperando hasta timeout a que
// otro proceso lo suelte (entonces devuelve ErrLocked). dir debe existir: lo crea la instalación. El llamador debe
// llamar a Close.
func Open(dir string, timeout time.Duration) (*Store, error) {
	f, err := os.OpenFile(filepath.Join(dir, LockName), os.O_RDWR|os.O_CREATE, 0o600)
	if err != nil {
		return nil, err
	}
	if err := lockFile(f, timeout); err != nil {
		_ = f.Close()
		return nil, err
	}
	return &Store{dir: dir, lock: f}, nil
}

// Close suelta el bloqueo. Se puede llamar más de una vez; después, el resto de métodos fallan.
func (s *Store) Close() error {
	if s.lock == nil {
		return nil
	}
	f := s.lock
	s.lock = nil
	return f.Close() // cerrar el descriptor suelta el flock
}

// Load lee y valida shared.json. Sin archivo devuelve (nil, nil). Nunca devuelve un estado a medias: con
// cualquier fallo (más de MaxFileBytes, JSON inválido, campo desconocido, datos después del valor, estado que no
// pasa Validate) devuelve (nil, error). El estado cargado es canónico: data y bindings compactados, data nil como
// null y listas nil como vacías, de modo que Save y Load son inversos.
func (s *Store) Load() (*State, error) {
	if s.lock == nil {
		return nil, errClosed
	}
	b, err := jsonx.ReadFileLimit(filepath.Join(s.dir, FileName), MaxFileBytes)
	if errors.Is(err, fs.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	st, err := decodeState(b)
	if err != nil {
		return nil, err
	}
	return st, nil
}

// decodeState decodifica un shared.json: struct con DisallowUnknownFields (excepción de las reglas globales para los
// archivos que escribe el propio host), nada más que espacios tras el objeto y Validate.
func decodeState(b []byte) (*State, error) {
	if !jsonx.CheckText(b) {
		return nil, errCorrupt
	}
	dec := json.NewDecoder(bytes.NewReader(b))
	dec.DisallowUnknownFields()
	var st State
	if err := dec.Decode(&st); err != nil {
		return nil, errCorrupt
	}
	// Tras el objeto solo puede haber espacios. (Decoder.More no basta: no ve una llave de cierre sobrante.)
	var extra json.RawMessage
	if err := dec.Decode(&extra); !errors.Is(err, io.EOF) {
		return nil, errCorrupt
	}
	if err := st.canonicalize(); err != nil {
		return nil, errCorrupt
	}
	if err := st.Validate(); err != nil {
		return nil, err
	}
	return &st, nil
}

// canonicalize deja el estado en su forma canónica: data y bindings tal como los escribe Save (compactos y con
// U+2028 y U+2029 escapados), data ausente como null y listas null o ausentes como vacías. Así Save y Load son
// inversos y volver a guardar lo cargado da los mismos bytes. Un bindings ausente se queda nil y Validate lo rechaza.
func (st *State) canonicalize() error {
	var err error
	if st.Data, err = canonical(st.Data); err != nil {
		return err
	}
	if st.Data == nil {
		st.Data = json.RawMessage("null")
	}
	if st.Bindings, err = canonical(st.Bindings); err != nil {
		return err
	}
	if st.Paired == nil {
		st.Paired = []Installation{}
	}
	if st.PendingProofs == nil {
		st.PendingProofs = []Proof{}
	}
	return nil
}

// canonical devuelve el valor JSON raw en la forma que escribe el codificador de Save: sin espacios, sin escapar el
// HTML y con U+2028 y U+2029 escapados (el codificador lo hace siempre). Se pasa por el mismo codificador en vez de
// imitarlo, para que no puedan diferir. Un valor vacío (campo ausente) sigue nil.
func canonical(raw json.RawMessage) (json.RawMessage, error) {
	if len(raw) == 0 {
		return nil, nil
	}
	out, err := encodeJSON(raw)
	if err != nil {
		return nil, err
	}
	return out, nil
}

// Save valida y escribe de forma atómica: temporal en la misma carpeta, fsync, rename y fsync de la carpeta.
// Un fallo en cualquier punto deja shared.json como estaba y sin temporales.
func (s *Store) Save(st *State) error {
	if s.lock == nil {
		return errClosed
	}
	if err := st.Validate(); err != nil {
		return err
	}
	body, err := encodeState(st) // json.Encoder, SetEscapeHTML(false), sin el \n final
	if err != nil {
		return err
	}
	return writeAtomic(s.dir, ".shared-*.tmp", filepath.Join(s.dir, FileName), body)
}

// encodeState escribe el estado en una sola línea, con data y bindings compactados y sin escapar <, > ni &. Trabaja
// sobre una copia para normalizar data nil y las listas nil sin tocar el estado del llamador.
func encodeState(st *State) ([]byte, error) {
	cp := *st
	if len(cp.Data) == 0 {
		cp.Data = json.RawMessage("null")
	}
	if cp.Paired == nil {
		cp.Paired = []Installation{}
	}
	if cp.PendingProofs == nil {
		cp.PendingProofs = []Proof{}
	}
	return encodeJSON(&cp)
}

// encodeJSON codifica v con json.Encoder sin escapar HTML y sin el salto de línea final.
func encodeJSON(v any) ([]byte, error) {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(v); err != nil {
		return nil, errEncode // el error de encoding/json puede citar parte del valor
	}
	return bytes.TrimSuffix(buf.Bytes(), []byte("\n")), nil
}

// writeAtomic escribe body en final: crea un temporal (0600) en la carpeta de final con el patrón pattern, lo
// escribe, hace fsync, lo renombra sobre final y hace fsync de la carpeta. Si algo falla antes del rename, borra el
// temporal y final queda intacto.
func writeAtomic(dir, pattern, final string, body []byte) error {
	tmp, err := os.CreateTemp(dir, pattern) // 0600
	if err != nil {
		return err
	}
	ok := false
	defer func() {
		if !ok {
			_ = tmp.Close()
			_ = os.Remove(tmp.Name())
		}
	}()
	if _, err := tmp.Write(body); err != nil {
		return err
	}
	if err := tmp.Sync(); err != nil {
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := os.Rename(tmp.Name(), final); err != nil {
		return err
	}
	ok = true
	syncDir(dir) // mejor esfuerzo: en macOS el fsync de una carpeta puede no estar soportado
	return nil
}

// syncDir hace fsync de una carpeta para que el rename sobreviva a un corte de luz. Es de mejor esfuerzo: si no se
// puede abrir o sincronizar, el rename ya ocurrió y no hay nada que deshacer.
func syncDir(dir string) {
	d, err := os.Open(dir)
	if err != nil {
		return
	}
	_ = d.Sync()
	_ = d.Close()
}
