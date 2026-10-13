// Package store guarda el estado compartido de los perfiles (shared.json) y los iconos (icons/) en la carpeta de
// instalación del host. El host es un proceso por mensaje y dos perfiles del navegador pueden escribir a la vez,
// así que todo acceso exige un bloqueo entre procesos (flock sobre shared.lock), las escrituras son atómicas
// (temporal en la misma carpeta, fsync y rename) y lo que se lee se valida entero antes de usarlo. Los errores no
// repiten contenido de los archivos.
package store

import (
	"bytes"
	"encoding/json"

	"github.com/DanielSantos495/launcher/native-host/internal/jsonx"
	"github.com/DanielSantos495/launcher/native-host/internal/protocol"
)

// Installation es una instalación de la extensión emparejada con el host. El token solo se guarda como hash.
type Installation struct {
	InstallationID   string `json:"installationId"`
	TokenHash        string `json:"tokenHash"` // hex SHA-256 en minúsculas
	IdentityID       string `json:"identityId,omitempty"`
	ProfileDirectory string `json:"profileDirectory,omitempty"`
	PairedAt         string `json:"pairedAt"`
	VerifiedAt       string `json:"verifiedAt,omitempty"`
}

// PairCode es el código de emparejamiento activo (solo uno a la vez): su hash, cuándo caduca y los intentos
// fallidos de pair.join con él.
type PairCode struct {
	CodeHash  string `json:"codeHash"`
	ExpiresAt string `json:"expiresAt"`
	Failures  int    `json:"failures"`
}

// Proof es una prueba pendiente de pair.prove: el hash del nonce, la instalación y el perfil que lo declaró.
type Proof struct {
	NonceHash        string `json:"nonceHash"`
	InstallationID   string `json:"installationId"`
	ProfileDirectory string `json:"profileDirectory"`
	ExpiresAt        string `json:"expiresAt"`
}

// State es el contenido de shared.json. Data y Bindings se guardan como bytes en bruto: el host nunca interpreta
// su contenido, solo que sean un objeto (Data también puede ser null).
type State struct {
	Format            int             `json:"format"`
	Revision          int64           `json:"revision"`
	Data              json.RawMessage `json:"data"`     // "null" o un objeto
	Bindings          json.RawMessage `json:"bindings"` // objeto
	MaxPairedProfiles int             `json:"maxPairedProfiles"`
	Paired            []Installation  `json:"paired"`
	PairCode          *PairCode       `json:"pairCode,omitempty"`
	PendingProofs     []Proof         `json:"pendingProofs"`
}

// fieldError dice qué campo del estado no es válido, sin repetir su valor.
type fieldError string

func (e fieldError) Error() string { return "store: estado: campo " + string(e) + " no valido" }

// NewState es el estado de un almacén recién creado: revisión 0, data null, bindings {} y listas vacías (no nil,
// para que se escriban como []).
func NewState() *State {
	return &State{
		Format:            Format,
		Data:              json.RawMessage("null"),
		Bindings:          json.RawMessage("{}"),
		MaxPairedProfiles: protocol.DefaultMaxPairedProfiles,
		Paired:            []Installation{},
		PendingProofs:     []Proof{},
	}
}

// Validate comprueba el estado entero. Los límites de las listas se miran antes de recorrer sus elementos. Data nil
// vale como null; Bindings nunca puede ser nil ni null (la extensión rechaza null). Las listas nil valen como vacías.
func (st *State) Validate() error {
	switch {
	case st.Format != Format:
		return fieldError("format")
	case st.Revision < 0 || st.Revision > protocol.MaxSafeInteger:
		return fieldError("revision")
	case !validData(st.Data):
		return fieldError("data")
	case !validBindings(st.Bindings):
		return fieldError("bindings")
	case st.MaxPairedProfiles < 1 || st.MaxPairedProfiles > protocol.MaxPairedProfilesLimit:
		return fieldError("maxPairedProfiles")
	case len(st.Paired) > protocol.MaxInstallations:
		return fieldError("paired")
	case len(st.PendingProofs) > MaxPendingProofs:
		return fieldError("pendingProofs")
	}
	seen := make(map[string]struct{}, len(st.Paired))
	for _, in := range st.Paired {
		if err := in.validate(); err != nil {
			return err
		}
		if _, dup := seen[in.InstallationID]; dup {
			return fieldError("paired.installationId")
		}
		seen[in.InstallationID] = struct{}{}
	}
	if st.PairCode != nil {
		if err := st.PairCode.validate(); err != nil {
			return err
		}
	}
	for _, p := range st.PendingProofs {
		if err := p.validate(); err != nil {
			return err
		}
	}
	return nil
}

func (in Installation) validate() error {
	switch {
	case !protocol.ValidID(in.InstallationID):
		return fieldError("paired.installationId")
	case !validHash(in.TokenHash):
		return fieldError("paired.tokenHash")
	case in.IdentityID != "" && !protocol.ValidID(in.IdentityID):
		return fieldError("paired.identityId")
	case in.ProfileDirectory != "" && !protocol.ValidProfileDirectory(in.ProfileDirectory):
		return fieldError("paired.profileDirectory")
	case !protocol.ValidTimestamp(in.PairedAt):
		return fieldError("paired.pairedAt")
	case in.VerifiedAt != "" && !protocol.ValidTimestamp(in.VerifiedAt):
		return fieldError("paired.verifiedAt")
	}
	return nil
}

func (c PairCode) validate() error {
	switch {
	case !validHash(c.CodeHash):
		return fieldError("pairCode.codeHash")
	case !protocol.ValidTimestamp(c.ExpiresAt):
		return fieldError("pairCode.expiresAt")
	case c.Failures < 0 || c.Failures > MaxJoinFailures:
		return fieldError("pairCode.failures")
	}
	return nil
}

func (p Proof) validate() error {
	switch {
	case !validHash(p.NonceHash):
		return fieldError("pendingProofs.nonceHash")
	case !protocol.ValidID(p.InstallationID):
		return fieldError("pendingProofs.installationId")
	case !protocol.ValidProfileDirectory(p.ProfileDirectory):
		return fieldError("pendingProofs.profileDirectory")
	case !protocol.ValidTimestamp(p.ExpiresAt):
		return fieldError("pendingProofs.expiresAt")
	}
	return nil
}

// Put sustituye data y bindings si baseRevision es la revisión actual y la sube en uno. Con otra base devuelve
// ConflictAt(actual) y no cambia nada; en la revisión máxima segura devuelve Internal (la siguiente ya no cabría
// en un número de JavaScript). Data nil se guarda como null. Una forma que Validate rechazaría (bindings que no son
// un objeto, valores demasiado grandes) también es Internal: el router la validó antes, así que aquí sería un fallo
// del host. Los bytes se copian: el estado no comparte memoria con los argumentos.
func (st *State) Put(baseRevision int64, data, bindings json.RawMessage) (int64, *protocol.Error) {
	if baseRevision != st.Revision {
		return 0, protocol.ConflictAt(st.Revision)
	}
	if st.Revision >= protocol.MaxSafeInteger {
		return 0, protocol.Fail(protocol.Internal)
	}
	if len(data) == 0 {
		data = json.RawMessage("null")
	}
	if !validData(data) || !validBindings(bindings) {
		return 0, protocol.Fail(protocol.Internal)
	}
	st.Data = bytes.Clone(data)
	st.Bindings = bytes.Clone(bindings)
	st.Revision++
	return st.Revision, nil
}

// validData: nil o "null" (sin datos todavía) o un objeto JSON de como mucho MaxSharedDataBytes.
func validData(raw json.RawMessage) bool {
	return len(raw) == 0 || string(raw) == "null" || validObject(raw, protocol.MaxSharedDataBytes)
}

// validBindings: un objeto JSON de como mucho MaxSharedBindingsBytes (nunca nil ni null).
func validBindings(raw json.RawMessage) bool {
	return validObject(raw, protocol.MaxSharedBindingsBytes)
}

// validObject comprueba, de más barato a más caro, que raw tenga como mucho max bytes, empiece y acabe como un
// objeto, no lleve sustitutos UTF-16 sueltos ni UTF-8 inválido y sea un único valor JSON completo.
func validObject(raw json.RawMessage, max int) bool {
	n := len(raw)
	return n >= 2 && n <= max && raw[0] == '{' && raw[n-1] == '}' && jsonx.CheckText(raw) && json.Valid(raw)
}

// validHash: 64 dígitos hexadecimales en minúsculas (un SHA-256).
func validHash(s string) bool {
	if len(s) != 64 {
		return false
	}
	for i := 0; i < len(s); i++ {
		c := s[i]
		if (c < '0' || c > '9') && (c < 'a' || c > 'f') {
			return false
		}
	}
	return true
}
