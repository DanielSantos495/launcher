package pairing

import (
	"crypto/subtle"
	"io"
	"time"

	"github.com/DanielSantos495/launcher/native-host/internal/protocol"
	"github.com/DanielSantos495/launcher/native-host/internal/store"
)

// Clock da la hora y la aleatoriedad: el router usa el reloj y crypto/rand del sistema; las pruebas, valores fijos.
type Clock struct {
	Now  func() time.Time
	Rand io.Reader
}

// ProofRequest es lo que hace falta para abrir whoami en el perfil declarado. El nonce en claro solo viaja en la
// URL de whoami: nunca se guarda (solo su hash) ni va en la respuesta de pair.verify.
type ProofRequest struct {
	Nonce            string
	ProfileDirectory string
	ExpiresAt        string
}

// Convenciones de este archivo:
//   - st == nil significa que aún no hay almacén (shared.json no existe).
//   - Las funciones que cambian el estado y reciben un Clock empiezan por prune. El valor changed dice si el router
//     tiene que guardar el estado, también junto a un error (un fallo de pair.join cuenta). No incluye lo que quita
//     prune: la limpieza se repite en cada llamada y guardarla no cambia ningún resultado.
//   - Toda la aleatoriedad se pide antes de tocar el estado: si falla, la respuesta es internal y nada cambia.
//   - Las listas se sustituyen por copias nuevas y nunca quedan nil (se escribirían como null).

// Authenticate devuelve el índice de la instalación cuyo token es token. Recorre TODAS las instalaciones y compara
// los hashes con subtle.ConstantTimeCompare sin salir del bucle al encontrarla, para que el tiempo no diga si el
// token existe ni en qué posición está. Un token sin el formato del contrato no autentica nunca.
func Authenticate(st *store.State, token string) (int, bool) {
	if st == nil || !protocol.ValidToken(token) {
		return -1, false
	}
	h := []byte(HashSecret(token))
	found := -1
	for i, in := range st.Paired {
		found = subtle.ConstantTimeSelect(subtle.ConstantTimeCompare(h, []byte(in.TokenHash)), i, found)
	}
	return found, found >= 0
}

// Start atiende pair.start y devuelve el estado que hay que guardar (el nuevo o el mismo, modificado); con error,
// nil. Sin token solo vale si no hay ninguna instalación emparejada (D5): es el primer emparejamiento, crea el
// almacén si no existe (o conserva sus datos) y devuelve el token. Con token emite un código para que otra
// instalación se una, si la del token es installationID y queda alguna plaza (D6); el resultado no lleva token.
// El código nuevo reemplaza al anterior y empieza sin fallos (D7).
func Start(st *store.State, installationID, token string, c Clock) (*store.State, protocol.PairStartResult, *protocol.Error) {
	now := c.Now()
	prune(st, now)
	if token != "" {
		i, ok := Authenticate(st, token)
		if !ok || st.Paired[i].InstallationID != installationID {
			return nil, protocol.PairStartResult{}, protocol.Fail(protocol.NotPaired)
		}
		if len(st.Paired) >= st.MaxPairedProfiles {
			return nil, protocol.PairStartResult{}, protocol.Fail(protocol.LimitReached)
		}
		code, err := NewCode(c.Rand)
		if err != nil {
			return nil, protocol.PairStartResult{}, protocol.Fail(protocol.Internal)
		}
		return st, issueCode(st, code, now), nil
	}

	if st != nil && len(st.Paired) > 0 {
		return nil, protocol.PairStartResult{}, protocol.Fail(protocol.NotPaired)
	}
	newToken, err := NewToken(c.Rand)
	if err != nil {
		return nil, protocol.PairStartResult{}, protocol.Fail(protocol.Internal)
	}
	code, err := NewCode(c.Rand)
	if err != nil {
		return nil, protocol.PairStartResult{}, protocol.Fail(protocol.Internal)
	}
	if st == nil {
		st = store.NewState()
	}
	st.Paired = append(st.Paired, newInstallation(installationID, newToken, now))
	res := issueCode(st, code, now)
	res.Token = newToken
	return st, res, nil
}

// Join atiende pair.join. Sin almacén o sin código activo: bad_code sin cambios. Un código incorrecto suma un fallo
// y al quinto anula el código (D7). El correcto se consume; si installationID ya estaba emparejada, su entrada (y
// sus pruebas) se quita antes de contar el límite (D8); con el límite alcanzado, limit_reached (D9). Si no, la
// instalación se añade y recibe su token.
func Join(st *store.State, installationID, code string, c Clock) (protocol.PairJoinResult, bool, *protocol.Error) {
	now := c.Now()
	prune(st, now)
	if st == nil || st.PairCode == nil {
		return protocol.PairJoinResult{}, false, protocol.Fail(protocol.BadCode)
	}
	if !equalHash(HashSecret(code), st.PairCode.CodeHash) {
		st.PairCode.Failures++
		if st.PairCode.Failures >= store.MaxJoinFailures {
			st.PairCode = nil
		}
		return protocol.PairJoinResult{}, true, protocol.Fail(protocol.BadCode)
	}
	newToken, err := NewToken(c.Rand)
	if err != nil {
		return protocol.PairJoinResult{}, false, protocol.Fail(protocol.Internal)
	}
	st.PairCode = nil
	if j := indexOf(st, installationID); j >= 0 {
		removeInstallation(st, j)
	}
	if len(st.Paired) >= st.MaxPairedProfiles {
		return protocol.PairJoinResult{}, true, protocol.Fail(protocol.LimitReached)
	}
	st.Paired = append(st.Paired, newInstallation(installationID, newToken, now))
	return protocol.PairJoinResult{Token: newToken}, true, nil
}

// Declare atiende pair.declare: guarda la carpeta del perfil y la identidad de la instalación del token
// (identityID "" borra la guardada). known dice si la carpeta existe en Local State. Si la carpeta cambia, la
// verificación y las pruebas pendientes de la instalación dejan de valer (D11); con la misma, se conservan.
func Declare(st *store.State, token, profileDir, identityID string, known func(string) bool) (bool, *protocol.Error) {
	i, ok := Authenticate(st, token)
	if !ok {
		return false, protocol.Fail(protocol.NotPaired)
	}
	if !known(profileDir) {
		return false, protocol.Fail(protocol.UnknownProfile)
	}
	in := &st.Paired[i]
	changed := false
	if in.ProfileDirectory != profileDir {
		in.ProfileDirectory = profileDir
		in.VerifiedAt = ""
		removeProofs(st, in.InstallationID)
		changed = true
	}
	if in.IdentityID != identityID {
		in.IdentityID = identityID
		changed = true
	}
	return changed, nil
}

// List atiende pair.list: las instalaciones en el orden guardado (como mucho MaxInstallations), con self en la del
// token. La lista nunca es nil.
func List(st *store.State, token string) (protocol.PairListResult, *protocol.Error) {
	self, ok := Authenticate(st, token)
	if !ok {
		return protocol.PairListResult{}, protocol.Fail(protocol.NotPaired)
	}
	n := min(len(st.Paired), protocol.MaxInstallations)
	out := make([]protocol.InstallationInfo, 0, n)
	for i, in := range st.Paired[:n] {
		out = append(out, protocol.InstallationInfo{
			InstallationID:   in.InstallationID,
			IdentityID:       in.IdentityID,
			ProfileDirectory: in.ProfileDirectory,
			PairedAt:         in.PairedAt,
			VerifiedAt:       in.VerifiedAt,
			Self:             i == self,
		})
	}
	return protocol.PairListResult{MaxPairedProfiles: st.MaxPairedProfiles, Installations: out}, nil
}

// Remove atiende pair.remove: quita la instalación installationID y sus pruebas pendientes. Puede ser la propia
// (su token deja de valer). Así se libera la plaza de una instalación que perdió su token (Review Focus 3).
func Remove(st *store.State, token, installationID string) (bool, *protocol.Error) {
	if _, ok := Authenticate(st, token); !ok {
		return false, protocol.Fail(protocol.NotPaired)
	}
	j := indexOf(st, installationID)
	if j < 0 {
		return false, protocol.Fail(protocol.NotFound)
	}
	removeInstallation(st, j)
	return true, nil
}

// Verify atiende pair.verify: emite una prueba para la instalación del token (IssueProof). El router abre whoami
// con el ProofRequest después de guardar el estado.
func Verify(st *store.State, token string, c Clock, known func(string) bool) (ProofRequest, bool, *protocol.Error) {
	i, ok := Authenticate(st, token)
	if !ok {
		return ProofRequest{}, false, protocol.Fail(protocol.NotPaired)
	}
	req, err := IssueProof(st, i, c, known)
	if err != nil {
		return ProofRequest{}, false, err
	}
	return req, true, nil
}

// IssueProof emite un nonce de un solo uso para la instalación index, válido ProofTTL, en la carpeta que declaró:
// sin carpeta, not_found; con una que ya no está en Local State, unknown_profile (D10). Reemplaza las pruebas
// pendientes de esa instalación. Si el estado ya tiene el máximo de pruebas (solo con pruebas de instalaciones que
// ya no existen), descarta las más antiguas para que siga siendo válido. Un índice fuera de rango es un fallo del
// llamador: internal. La usan Verify y doctor --verify; sin error, el estado siempre cambia.
func IssueProof(st *store.State, index int, c Clock, known func(string) bool) (ProofRequest, *protocol.Error) {
	if st == nil || index < 0 || index >= len(st.Paired) {
		return ProofRequest{}, protocol.Fail(protocol.Internal)
	}
	now := c.Now()
	prune(st, now)
	in := st.Paired[index]
	if in.ProfileDirectory == "" {
		return ProofRequest{}, protocol.Fail(protocol.NotFound)
	}
	if !known(in.ProfileDirectory) {
		return ProofRequest{}, protocol.Fail(protocol.UnknownProfile)
	}
	nonce, err := NewNonce(c.Rand)
	if err != nil {
		return ProofRequest{}, protocol.Fail(protocol.Internal)
	}
	removeProofs(st, in.InstallationID)
	if extra := len(st.PendingProofs) - (store.MaxPendingProofs - 1); extra > 0 {
		st.PendingProofs = st.PendingProofs[extra:]
	}
	expiresAt := protocol.FormatTime(now.Add(protocol.ProofTTL))
	st.PendingProofs = append(st.PendingProofs, store.Proof{
		NonceHash:        HashSecret(nonce),
		InstallationID:   in.InstallationID,
		ProfileDirectory: in.ProfileDirectory,
		ExpiresAt:        expiresAt,
	})
	return ProofRequest{Nonce: nonce, ProfileDirectory: in.ProfileDirectory, ExpiresAt: expiresAt}, nil
}

// Prove atiende pair.prove (la página whoami): busca una prueba vigente de la instalación del token con el hash del
// nonce, comparando todas en tiempo constante. Un nonce de otra instalación, caducado o ya usado: bad_nonce sin
// cambios. Si la carpeta de la prueba no es la declarada ahora, bad_nonce y la prueba se gasta (D12). Si coincide,
// la prueba se gasta y la instalación queda verificada ahora.
func Prove(st *store.State, token, nonce string, c Clock) (protocol.PairProveResult, bool, *protocol.Error) {
	now := c.Now()
	prune(st, now)
	i, ok := Authenticate(st, token)
	if !ok {
		return protocol.PairProveResult{}, false, protocol.Fail(protocol.NotPaired)
	}
	in := &st.Paired[i]
	h := []byte(HashSecret(nonce))
	found := -1
	for j, p := range st.PendingProofs {
		match := subtle.ConstantTimeCompare(h, []byte(p.NonceHash))
		if p.InstallationID != in.InstallationID {
			match = 0
		}
		found = subtle.ConstantTimeSelect(match, j, found)
	}
	if found < 0 {
		return protocol.PairProveResult{}, false, protocol.Fail(protocol.BadNonce)
	}
	proofDir := st.PendingProofs[found].ProfileDirectory
	st.PendingProofs = without(st.PendingProofs, found)
	if proofDir != in.ProfileDirectory {
		return protocol.PairProveResult{}, true, protocol.Fail(protocol.BadNonce)
	}
	in.VerifiedAt = protocol.FormatTime(now)
	return protocol.PairProveResult{VerifiedAt: in.VerifiedAt}, true, nil
}

// Reset vacía el emparejamiento (instalaciones, código y pruebas) y conserva todo lo demás: revisión, data,
// bindings y el máximo de perfiles. Es pairing --reset.
func Reset(st *store.State) {
	if st == nil {
		return
	}
	st.Paired = []store.Installation{}
	st.PairCode = nil
	st.PendingProofs = []store.Proof{}
}

// prune quita el código y las pruebas que ya caducaron (expiresAt <= now). Es la ÚNICA comprobación de caducidad.
func prune(st *store.State, now time.Time) {
	if st == nil {
		return
	}
	if st.PairCode != nil && expired(st.PairCode.ExpiresAt, now) {
		st.PairCode = nil
	}
	kept := make([]store.Proof, 0, len(st.PendingProofs))
	for _, p := range st.PendingProofs {
		if !expired(p.ExpiresAt, now) {
			kept = append(kept, p)
		}
	}
	st.PendingProofs = kept
}

// expired dice si expiresAt <= now. Una marca ilegible cuenta como caducada.
func expired(expiresAt string, now time.Time) bool {
	t, ok := protocol.ParseTime(expiresAt)
	return !ok || !t.After(now)
}

// issueCode guarda el hash de code como el código activo, con 0 fallos y caducidad now + PairCodeTTL, y devuelve
// el resultado de pair.start sin token.
func issueCode(st *store.State, code string, now time.Time) protocol.PairStartResult {
	expiresAt := protocol.FormatTime(now.Add(protocol.PairCodeTTL))
	st.PairCode = &store.PairCode{CodeHash: HashSecret(code), ExpiresAt: expiresAt}
	return protocol.PairStartResult{Code: code, ExpiresAt: expiresAt}
}

func newInstallation(installationID, token string, now time.Time) store.Installation {
	return store.Installation{
		InstallationID: installationID,
		TokenHash:      HashSecret(token),
		PairedAt:       protocol.FormatTime(now),
	}
}

// equalHash compara dos hashes en tiempo constante.
func equalHash(a, b string) bool {
	return subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1
}

// indexOf devuelve la posición de la instalación installationID o -1.
func indexOf(st *store.State, installationID string) int {
	for i, in := range st.Paired {
		if in.InstallationID == installationID {
			return i
		}
	}
	return -1
}

// removeInstallation quita la instalación j y sus pruebas pendientes.
func removeInstallation(st *store.State, j int) {
	id := st.Paired[j].InstallationID
	st.Paired = without(st.Paired, j)
	removeProofs(st, id)
}

// removeProofs quita las pruebas pendientes de la instalación id.
func removeProofs(st *store.State, id string) {
	kept := make([]store.Proof, 0, len(st.PendingProofs))
	for _, p := range st.PendingProofs {
		if p.InstallationID != id {
			kept = append(kept, p)
		}
	}
	st.PendingProofs = kept
}

// without devuelve una copia de s sin el elemento j (nunca nil).
func without[T any](s []T, j int) []T {
	out := make([]T, 0, len(s)-1)
	out = append(out, s[:j]...)
	return append(out, s[j+1:]...)
}
