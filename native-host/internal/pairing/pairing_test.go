package pairing_test

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/DanielSantos495/launcher/native-host/internal/pairing"
	"github.com/DanielSantos495/launcher/native-host/internal/protocol"
	"github.com/DanielSantos495/launcher/native-host/internal/store"
)

// t0 es la hora fija de las pruebas: 2026-10-08T12:00:00.000Z.
var t0 = time.Date(2026, 10, 8, 12, 0, 0, 0, time.UTC)

// unknownToken tiene el formato de un token pero no es de nadie.
var unknownToken = strings.Repeat("Z", 43)

// env es el entorno de una prueba: un reloj que la prueba adelanta, aleatoriedad determinista y los perfiles que
// conoce el Local State (la prueba puede quitar alguno).
type env struct {
	t        *testing.T
	now      time.Time
	c        pairing.Clock
	profiles map[string]bool
}

func newEnv(t *testing.T) *env {
	e := &env{t: t, now: t0, profiles: map[string]bool{"Default": true, "Profile 1": true}}
	e.c = pairing.Clock{Now: func() time.Time { return e.now }, Rand: pattern()}
	return e
}

// pattern es la aleatoriedad determinista: SHA-256 de 0, 1, 2, ... seguidos. No se repite en 8192 bytes, asi que
// dos tokens o dos nonces de una misma prueba nunca coinciden.
func pattern() *bytes.Reader {
	var buf []byte
	for i := range 256 {
		sum := sha256.Sum256([]byte{byte(i)})
		buf = append(buf, sum[:]...)
	}
	return bytes.NewReader(buf)
}

func (e *env) known(dir string) bool { return e.profiles[dir] }

// at pone el reloj en t0 + d.
func (e *env) at(d time.Duration) { e.now = t0.Add(d) }

// first empareja inst-a como primera instalacion (Start sin token).
func (e *env) first() (*store.State, protocol.PairStartResult) {
	e.t.Helper()
	st, res, err := pairing.Start(nil, "inst-a", "", e.c)
	noErr(e.t, err)
	return st, res
}

// join une id con code y devuelve su token.
func (e *env) join(st *store.State, id, code string) string {
	e.t.Helper()
	res, changed, err := pairing.Join(st, id, code, e.c)
	noErr(e.t, err)
	if !changed {
		e.t.Fatal("Join correcto sin changed")
	}
	return res.Token
}

// pair deja emparejadas inst-a e inst-b (las dos a las 12:00:00.000, maximo 2) y devuelve sus tokens.
func (e *env) pair() (*store.State, string, string) {
	e.t.Helper()
	st, res := e.first()
	return st, res.Token, e.join(st, "inst-b", res.Code)
}

// code pide un codigo nuevo con el token de inst-a.
func (e *env) code(st *store.State, tokenA string) string {
	e.t.Helper()
	got, res, err := pairing.Start(st, "inst-a", tokenA, e.c)
	noErr(e.t, err)
	if got != st {
		e.t.Fatal("Start con token no devuelve el mismo estado")
	}
	return res.Code
}

func (e *env) declare(st *store.State, token, dir, identity string) {
	e.t.Helper()
	if _, err := pairing.Declare(st, token, dir, identity, e.known); err != nil {
		e.t.Fatalf("Declare: %s", err.Code)
	}
}

// verify pide una prueba para la instalacion de token y devuelve el nonce.
func (e *env) verify(st *store.State, token string) string {
	e.t.Helper()
	req, changed, err := pairing.Verify(st, token, e.c, e.known)
	noErr(e.t, err)
	if !changed {
		e.t.Fatal("Verify correcto sin changed")
	}
	return req.Nonce
}

func (e *env) prove(st *store.State, token, nonce string) {
	e.t.Helper()
	if _, _, err := pairing.Prove(st, token, nonce, e.c); err != nil {
		e.t.Fatalf("Prove: %s", err.Code)
	}
}

func noErr(t *testing.T, err *protocol.Error) {
	t.Helper()
	if err != nil {
		t.Fatalf("error inesperado %s", err.Code)
	}
}

// wantErr exige el codigo exacto.
func wantErr(t *testing.T, err *protocol.Error, code protocol.Code) {
	t.Helper()
	if err == nil {
		t.Fatalf("sin error, quiero %s", code)
	}
	if err.Code != code {
		t.Fatalf("error %s, quiero %s", err.Code, code)
	}
}

func wantChanged(t *testing.T, got, want bool) {
	t.Helper()
	if got != want {
		t.Fatalf("changed = %v, quiero %v", got, want)
	}
}

// valid exige que el estado pase Validate (lo que el router guardaria).
func valid(t *testing.T, st *store.State) {
	t.Helper()
	if err := st.Validate(); err != nil {
		t.Fatal(err)
	}
}

// wrongCode devuelve un codigo con el formato correcto distinto de code.
func wrongCode(code string) string {
	if code == "000000" {
		return "000001"
	}
	return "000000"
}

// ids devuelve los installationId de la lista en su orden.
func ids(list []protocol.InstallationInfo) []string {
	out := make([]string, 0, len(list))
	for _, in := range list {
		out = append(out, in.InstallationID)
	}
	return out
}

func mustJSON(t *testing.T, v any) string {
	t.Helper()
	out, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return string(out)
}

func TestStartFirstPairing(t *testing.T) {
	e := newEnv(t)
	st, res, err := pairing.Start(nil, "inst-a", "", e.c)
	noErr(t, err)
	if !protocol.ValidCode(res.Code) || res.ExpiresAt != "2026-10-08T12:02:00.000Z" || !protocol.ValidToken(res.Token) {
		t.Fatalf("resultado %+v", res)
	}
	want := store.Installation{
		InstallationID: "inst-a",
		TokenHash:      pairing.HashSecret(res.Token),
		PairedAt:       "2026-10-08T12:00:00.000Z",
	}
	if len(st.Paired) != 1 || st.Paired[0] != want {
		t.Fatalf("Paired = %+v, quiero [%+v]", st.Paired, want)
	}
	wantCode := store.PairCode{CodeHash: pairing.HashSecret(res.Code), ExpiresAt: "2026-10-08T12:02:00.000Z"}
	if st.PairCode == nil || *st.PairCode != wantCode {
		t.Fatalf("PairCode = %+v, quiero %+v", st.PairCode, wantCode)
	}
	if st.Revision != 0 || string(st.Data) != "null" || string(st.Bindings) != "{}" || st.MaxPairedProfiles != 2 ||
		st.PendingProofs == nil || len(st.PendingProofs) != 0 {
		t.Fatalf("el almacen nuevo no es NewState: %+v", st)
	}
	valid(t, st)
	wantJSON := `{"code":"` + res.Code + `","expiresAt":"2026-10-08T12:02:00.000Z","token":"` + res.Token + `"}`
	if got := mustJSON(t, res); got != wantJSON {
		t.Fatalf("resultado %s, quiero %s", got, wantJSON)
	}
}

func TestStateHasNoSecrets(t *testing.T) {
	e := newEnv(t)
	st, res := e.first() // el codigo sigue activo
	e.declare(st, res.Token, "Profile 1", "")
	nonce := e.verify(st, res.Token)
	text := mustJSON(t, st)
	for name, secret := range map[string]string{"token": res.Token, "codigo": res.Code, "nonce": nonce} {
		if strings.Contains(text, secret) {
			t.Errorf("el estado contiene el %s en claro", name)
		}
		if !strings.Contains(text, pairing.HashSecret(secret)) {
			t.Errorf("el estado no contiene el hash del %s", name)
		}
	}
}

func TestStartWithoutToken(t *testing.T) {
	t.Run("sin token con una emparejada", func(t *testing.T) {
		e := newEnv(t)
		st, res := e.first()
		for _, id := range []string{"inst-b", "inst-a"} {
			got, out, err := pairing.Start(st, id, "", e.c)
			wantErr(t, err, protocol.NotPaired)
			if got != nil || out != (protocol.PairStartResult{}) {
				t.Fatalf("Start con error devuelve %v y %+v", got, out)
			}
		}
		if len(st.Paired) != 1 || st.PairCode == nil || st.PairCode.CodeHash != pairing.HashSecret(res.Code) {
			t.Fatalf("el estado cambio: %+v", st)
		}
	})

	t.Run("tras Reset vuelve a ser el primero y conserva los datos", func(t *testing.T) {
		e := newEnv(t)
		st, _, _ := e.pair()
		st.Revision = 5
		st.Data = json.RawMessage(`{"containers":[{"id":"c1","name":"Trabajo"}]}`)
		st.Bindings = json.RawMessage(`{"c1":{"url":"https://example.com/"}}`)
		pairing.Reset(st)
		got, res, err := pairing.Start(st, "inst-b", "", e.c)
		noErr(t, err)
		if got != st {
			t.Fatal("Start no devuelve el mismo estado")
		}
		if got.Revision != 5 || string(got.Data) != `{"containers":[{"id":"c1","name":"Trabajo"}]}` ||
			string(got.Bindings) != `{"c1":{"url":"https://example.com/"}}` {
			t.Fatalf("se perdieron los datos: %+v", got)
		}
		if len(got.Paired) != 1 || got.Paired[0].InstallationID != "inst-b" ||
			got.Paired[0].TokenHash != pairing.HashSecret(res.Token) {
			t.Fatalf("Paired = %+v", got.Paired)
		}
		valid(t, got)
	})

	t.Run("tras quitar todas vuelve a ser el primero", func(t *testing.T) {
		e := newEnv(t)
		st, res := e.first()
		if _, err := pairing.Remove(st, res.Token, "inst-a"); err != nil {
			t.Fatal(err.Code)
		}
		got, _, err := pairing.Start(st, "inst-c", "", e.c)
		noErr(t, err)
		if len(got.Paired) != 1 || got.Paired[0].InstallationID != "inst-c" {
			t.Fatalf("Paired = %+v", got.Paired)
		}
	})
}

func TestStartWithToken(t *testing.T) {
	e := newEnv(t)
	st, first := e.first()
	tokenA := first.Token
	// Un fallo con el primer codigo: el codigo nuevo vuelve a empezar con 0 fallos.
	_, _, err := pairing.Join(st, "inst-b", wrongCode(first.Code), e.c)
	wantErr(t, err, protocol.BadCode)
	if st.PairCode.Failures != 1 {
		t.Fatalf("Failures = %d, quiero 1", st.PairCode.Failures)
	}

	e.at(30 * time.Second)
	got, res, err := pairing.Start(st, "inst-a", tokenA, e.c)
	noErr(t, err)
	if got != st {
		t.Fatal("Start con token no devuelve el mismo estado")
	}
	if res.Code == first.Code || !protocol.ValidCode(res.Code) {
		t.Fatalf("codigo nuevo %q (el anterior era %q)", res.Code, first.Code)
	}
	wantJSON := `{"code":"` + res.Code + `","expiresAt":"2026-10-08T12:02:30.000Z"}`
	if out := mustJSON(t, res); out != wantJSON {
		t.Fatalf("resultado %s, quiero %s (sin token)", out, wantJSON)
	}
	want := store.PairCode{CodeHash: pairing.HashSecret(res.Code), ExpiresAt: "2026-10-08T12:02:30.000Z"}
	if *st.PairCode != want {
		t.Fatalf("PairCode = %+v, quiero %+v", *st.PairCode, want)
	}
	valid(t, st)
	// El codigo anterior quedo reemplazado.
	_, _, err = pairing.Join(st, "inst-b", first.Code, e.c)
	wantErr(t, err, protocol.BadCode)

	before := *st.PairCode
	cases := []struct {
		name  string
		st    *store.State
		id    string
		token string
	}{
		{"otra instalacion", st, "inst-x", tokenA},
		{"token desconocido", st, "inst-a", unknownToken},
		{"sin almacen", nil, "inst-a", tokenA},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, out, err := pairing.Start(tc.st, tc.id, tc.token, e.c)
			wantErr(t, err, protocol.NotPaired)
			if got != nil || out != (protocol.PairStartResult{}) {
				t.Fatalf("Start con error devuelve %v y %+v", got, out)
			}
			if *st.PairCode != before {
				t.Fatal("el codigo activo cambio")
			}
		})
	}
}

func TestStartWithTokenLimit(t *testing.T) {
	e := newEnv(t)
	st, tokenA, _ := e.pair() // 2 emparejadas, maximo 2, sin codigo activo
	got, _, err := pairing.Start(st, "inst-a", tokenA, e.c)
	wantErr(t, err, protocol.LimitReached)
	if got != nil || st.PairCode != nil {
		t.Fatal("con el limite alcanzado se emitio un codigo")
	}
	// La instalacion se comprueba antes que el limite (D6).
	_, _, err = pairing.Start(st, "inst-x", tokenA, e.c)
	wantErr(t, err, protocol.NotPaired)
	// Con una plaza libre (maximo 3) si se emite.
	st.MaxPairedProfiles = 3
	e.code(st, tokenA)
	if st.PairCode == nil {
		t.Fatal("con una plaza libre no se emitio el codigo")
	}
}

func TestJoin(t *testing.T) {
	e := newEnv(t)
	st, first := e.first()
	e.at(10 * time.Second)
	res, changed, err := pairing.Join(st, "inst-b", first.Code, e.c)
	noErr(t, err)
	wantChanged(t, changed, true)
	if !protocol.ValidToken(res.Token) || res.Token == first.Token {
		t.Fatalf("token de B %q (el de A es %q)", res.Token, first.Token)
	}
	want := store.Installation{
		InstallationID: "inst-b",
		TokenHash:      pairing.HashSecret(res.Token),
		PairedAt:       "2026-10-08T12:00:10.000Z",
	}
	if len(st.Paired) != 2 || st.Paired[1] != want {
		t.Fatalf("Paired = %+v, quiero B = %+v", st.Paired, want)
	}
	if st.PairCode != nil {
		t.Fatal("el codigo no se consumio")
	}
	if i, ok := pairing.Authenticate(st, res.Token); !ok || i != 1 {
		t.Fatalf("Authenticate(B) = %d, %v", i, ok)
	}
	valid(t, st)

	// El mismo codigo otra vez.
	_, changed, err = pairing.Join(st, "inst-c", first.Code, e.c)
	wantErr(t, err, protocol.BadCode)
	wantChanged(t, changed, false)
	if len(st.Paired) != 2 {
		t.Fatalf("Paired tiene %d", len(st.Paired))
	}
}

func TestJoinExpiry(t *testing.T) {
	t.Run("12:01:59.999 vale", func(t *testing.T) {
		e := newEnv(t)
		st, first := e.first()
		e.at(2*time.Minute - time.Millisecond)
		e.join(st, "inst-b", first.Code)
	})
	t.Run("12:02:00.000 caducado", func(t *testing.T) {
		e := newEnv(t)
		st, first := e.first()
		e.at(2 * time.Minute)
		_, changed, err := pairing.Join(st, "inst-b", first.Code, e.c)
		wantErr(t, err, protocol.BadCode)
		wantChanged(t, changed, false)
		if len(st.Paired) != 1 || st.PairCode != nil {
			t.Fatalf("Paired %d, PairCode %+v", len(st.Paired), st.PairCode)
		}
	})
	t.Run("caducidad ilegible cuenta como caducada", func(t *testing.T) {
		e := newEnv(t)
		st, first := e.first()
		st.PairCode.ExpiresAt = "2026-10-08T12:02:00Z"
		_, _, err := pairing.Join(st, "inst-b", first.Code, e.c)
		wantErr(t, err, protocol.BadCode)
	})
}

func TestJoinFailures(t *testing.T) {
	t.Run("4 fallos y el correcto", func(t *testing.T) {
		e := newEnv(t)
		st, first := e.first()
		for i := 1; i <= 4; i++ {
			_, changed, err := pairing.Join(st, "inst-b", wrongCode(first.Code), e.c)
			wantErr(t, err, protocol.BadCode)
			wantChanged(t, changed, true)
			if st.PairCode == nil || st.PairCode.Failures != i {
				t.Fatalf("tras %d fallos PairCode = %+v", i, st.PairCode)
			}
			valid(t, st)
		}
		e.join(st, "inst-b", first.Code)
	})
	t.Run("5 fallos anulan el codigo", func(t *testing.T) {
		e := newEnv(t)
		st, first := e.first()
		for range store.MaxJoinFailures {
			_, changed, err := pairing.Join(st, "inst-b", wrongCode(first.Code), e.c)
			wantErr(t, err, protocol.BadCode)
			wantChanged(t, changed, true)
		}
		if st.PairCode != nil {
			t.Fatalf("tras 5 fallos PairCode = %+v", st.PairCode)
		}
		valid(t, st)
		_, changed, err := pairing.Join(st, "inst-b", first.Code, e.c)
		wantErr(t, err, protocol.BadCode)
		wantChanged(t, changed, false)
		if len(st.Paired) != 1 {
			t.Fatalf("Paired tiene %d", len(st.Paired))
		}
	})
}

func TestJoinLimit(t *testing.T) {
	e := newEnv(t)
	st, tokenA, _ := e.pair()
	st.MaxPairedProfiles = 3
	code := e.code(st, tokenA) // emitido con una plaza libre
	st.MaxPairedProfiles = 2   // como "pairing --max 2"
	_, changed, err := pairing.Join(st, "inst-c", code, e.c)
	wantErr(t, err, protocol.LimitReached)
	wantChanged(t, changed, true)
	if st.PairCode != nil || len(st.Paired) != 2 {
		t.Fatalf("PairCode %+v, Paired %d", st.PairCode, len(st.Paired))
	}
	valid(t, st)
	// El codigo quedo consumido.
	_, changed, err = pairing.Join(st, "inst-c", code, e.c)
	wantErr(t, err, protocol.BadCode)
	wantChanged(t, changed, false)
}

func TestJoinReplacesInstallation(t *testing.T) {
	e := newEnv(t)
	st, tokenA, tokenB := e.pair()
	e.declare(st, tokenA, "Profile 1", "")
	e.declare(st, tokenB, "Default", "id-b")
	e.prove(st, tokenB, e.verify(st, tokenB)) // B verificada
	e.verify(st, tokenB)                      // y con una prueba pendiente
	e.verify(st, tokenA)
	st.MaxPairedProfiles = 3
	code := e.code(st, tokenA)
	st.MaxPairedProfiles = 2 // el limite se cuenta despues de quitar la entrada de B (D8)

	e.at(30 * time.Second)
	tokenB2 := e.join(st, "inst-b", code)
	if _, ok := pairing.Authenticate(st, tokenB); ok {
		t.Fatal("el token antiguo de B sigue autenticando")
	}
	if i, ok := pairing.Authenticate(st, tokenB2); !ok || i != 1 {
		t.Fatalf("Authenticate(B nuevo) = %d, %v", i, ok)
	}
	want := store.Installation{
		InstallationID: "inst-b",
		TokenHash:      pairing.HashSecret(tokenB2),
		PairedAt:       "2026-10-08T12:00:30.000Z",
	}
	if len(st.Paired) != 2 || st.Paired[1] != want {
		t.Fatalf("Paired = %+v, quiero B = %+v (sin verifiedAt, carpeta ni identidad)", st.Paired, want)
	}
	if len(st.PendingProofs) != 1 || st.PendingProofs[0].InstallationID != "inst-a" {
		t.Fatalf("PendingProofs = %+v, quiero solo la de A", st.PendingProofs)
	}
	valid(t, st)
}

func TestJoinWithoutStoreOrCode(t *testing.T) {
	e := newEnv(t)
	_, changed, err := pairing.Join(nil, "inst-a", "123456", e.c)
	wantErr(t, err, protocol.BadCode)
	wantChanged(t, changed, false)

	st := store.NewState()
	_, changed, err = pairing.Join(st, "inst-a", "123456", e.c)
	wantErr(t, err, protocol.BadCode)
	wantChanged(t, changed, false)
	if len(st.Paired) != 0 {
		t.Fatalf("Paired tiene %d", len(st.Paired))
	}
}

func TestDeclare(t *testing.T) {
	e := newEnv(t)
	st, tokenA, _ := e.pair()
	changed, err := pairing.Declare(st, tokenA, "Profile 1", "id-1", e.known)
	noErr(t, err)
	wantChanged(t, changed, true)
	if st.Paired[0].ProfileDirectory != "Profile 1" || st.Paired[0].IdentityID != "id-1" {
		t.Fatalf("A = %+v", st.Paired[0])
	}
	if st.Paired[1].ProfileDirectory != "" || st.Paired[1].IdentityID != "" {
		t.Fatalf("B cambio: %+v", st.Paired[1])
	}
	valid(t, st)

	changed, err = pairing.Declare(st, tokenA, "Profile 1", "id-1", e.known)
	noErr(t, err)
	wantChanged(t, changed, false)

	changed, err = pairing.Declare(st, tokenA, "Nope", "", e.known)
	wantErr(t, err, protocol.UnknownProfile)
	wantChanged(t, changed, false)
	if st.Paired[0].ProfileDirectory != "Profile 1" || st.Paired[0].IdentityID != "id-1" {
		t.Fatalf("A cambio con un perfil desconocido: %+v", st.Paired[0])
	}

	// Sin identityId se borra la identidad guardada.
	changed, err = pairing.Declare(st, tokenA, "Profile 1", "", e.known)
	noErr(t, err)
	wantChanged(t, changed, true)
	if st.Paired[0].IdentityID != "" || st.Paired[0].ProfileDirectory != "Profile 1" {
		t.Fatalf("A = %+v", st.Paired[0])
	}

	for _, s := range []*store.State{st, nil} {
		tok := unknownToken
		if s == nil {
			tok = tokenA
		}
		changed, err = pairing.Declare(s, tok, "Default", "", e.known)
		wantErr(t, err, protocol.NotPaired)
		wantChanged(t, changed, false)
	}
}

func TestDeclareKeepsOrClearsVerification(t *testing.T) {
	e := newEnv(t)
	st, tokenA, tokenB := e.pair()
	e.declare(st, tokenA, "Profile 1", "")
	e.prove(st, tokenA, e.verify(st, tokenA))
	verifiedAt := st.Paired[0].VerifiedAt
	if verifiedAt == "" {
		t.Fatal("A no quedo verificada")
	}
	nonceA := e.verify(st, tokenA)
	e.declare(st, tokenB, "Default", "")
	e.verify(st, tokenB)

	// La misma carpeta conserva la verificacion y la prueba pendiente (D11).
	changed, err := pairing.Declare(st, tokenA, "Profile 1", "id-2", e.known)
	noErr(t, err)
	wantChanged(t, changed, true)
	if st.Paired[0].VerifiedAt != verifiedAt || len(st.PendingProofs) != 2 {
		t.Fatalf("A = %+v, pruebas %+v", st.Paired[0], st.PendingProofs)
	}

	// Otra carpeta borra la verificacion y las pruebas de A; las de B siguen.
	changed, err = pairing.Declare(st, tokenA, "Default", "id-2", e.known)
	noErr(t, err)
	wantChanged(t, changed, true)
	if st.Paired[0].VerifiedAt != "" || st.Paired[0].ProfileDirectory != "Default" {
		t.Fatalf("A = %+v", st.Paired[0])
	}
	if len(st.PendingProofs) != 1 || st.PendingProofs[0].InstallationID != "inst-b" {
		t.Fatalf("PendingProofs = %+v, quiero solo la de B", st.PendingProofs)
	}
	valid(t, st)
	_, _, err = pairing.Prove(st, tokenA, nonceA, e.c)
	wantErr(t, err, protocol.BadNonce)
}

func TestList(t *testing.T) {
	e := newEnv(t)
	st, first := e.first()
	tokenA := first.Token
	e.at(10 * time.Second)
	tokenB := e.join(st, "inst-b", first.Code)
	e.declare(st, tokenB, "Default", "id-b")
	e.at(20 * time.Second)
	e.prove(st, tokenB, e.verify(st, tokenB))

	res, err := pairing.List(st, tokenB)
	noErr(t, err)
	want := `{"maxPairedProfiles":2,"installations":[` +
		`{"installationId":"inst-a","pairedAt":"2026-10-08T12:00:00.000Z","self":false},` +
		`{"installationId":"inst-b","identityId":"id-b","profileDirectory":"Default",` +
		`"pairedAt":"2026-10-08T12:00:10.000Z","verifiedAt":"2026-10-08T12:00:20.000Z","self":true}]}`
	if got := mustJSON(t, res); got != want {
		t.Fatalf("List(B) = %s\nquiero %s", got, want)
	}

	res, err = pairing.List(st, tokenA)
	noErr(t, err)
	if len(res.Installations) != 2 || !res.Installations[0].Self || res.Installations[1].Self {
		t.Fatalf("List(A) = %+v", res.Installations)
	}

	for _, tc := range []struct {
		st    *store.State
		token string
	}{{st, unknownToken}, {nil, tokenA}} {
		_, err := pairing.List(tc.st, tc.token)
		wantErr(t, err, protocol.NotPaired)
	}
}

func TestListCapsAtMaxInstallations(t *testing.T) {
	st := store.NewState()
	for i := range protocol.MaxInstallations + 1 {
		st.Paired = append(st.Paired, store.Installation{
			InstallationID: fmt.Sprintf("inst-%02d", i),
			TokenHash:      pairing.HashSecret(fmt.Sprintf("%043d", i)),
			PairedAt:       "2026-10-08T12:00:00.000Z",
		})
	}
	res, err := pairing.List(st, fmt.Sprintf("%043d", 0))
	noErr(t, err)
	if len(res.Installations) != protocol.MaxInstallations || !res.Installations[0].Self {
		t.Fatalf("List devuelve %d instalaciones", len(res.Installations))
	}
}

func TestRemove(t *testing.T) {
	e := newEnv(t)
	st, tokenA, tokenB := e.pair()
	e.declare(st, tokenA, "Profile 1", "")
	e.verify(st, tokenA)
	e.declare(st, tokenB, "Default", "")
	e.verify(st, tokenB)

	changed, err := pairing.Remove(st, tokenA, "inst-b")
	noErr(t, err)
	wantChanged(t, changed, true)
	if !slices.Equal(ids(mustList(t, st, tokenA)), []string{"inst-a"}) {
		t.Fatalf("Paired = %+v", st.Paired)
	}
	if len(st.PendingProofs) != 1 || st.PendingProofs[0].InstallationID != "inst-a" {
		t.Fatalf("PendingProofs = %+v, quiero solo la de A", st.PendingProofs)
	}
	if _, ok := pairing.Authenticate(st, tokenB); ok {
		t.Fatal("el token de B sigue autenticando")
	}
	valid(t, st)

	changed, err = pairing.Remove(st, tokenA, "inst-z")
	wantErr(t, err, protocol.NotFound)
	wantChanged(t, changed, false)
	changed, err = pairing.Remove(st, tokenB, "inst-a")
	wantErr(t, err, protocol.NotPaired)
	wantChanged(t, changed, false)
	_, err = pairing.Remove(nil, tokenA, "inst-a")
	wantErr(t, err, protocol.NotPaired)

	// Puede quitarse a si misma.
	changed, err = pairing.Remove(st, tokenA, "inst-a")
	noErr(t, err)
	wantChanged(t, changed, true)
	_, err = pairing.List(st, tokenA)
	wantErr(t, err, protocol.NotPaired)
	valid(t, st)
	if text := mustJSON(t, st); !strings.Contains(text, `"paired":[]`) || !strings.Contains(text, `"pendingProofs":[]`) {
		t.Fatalf("listas vacias mal escritas: %s", text)
	}
}

func mustList(t *testing.T, st *store.State, token string) []protocol.InstallationInfo {
	t.Helper()
	res, err := pairing.List(st, token)
	noErr(t, err)
	return res.Installations
}

// Review Focus 3: una instalacion reinstalada que perdio su token ocupa el limite de 2.
func TestLostTokenRecovery(t *testing.T) {
	e := newEnv(t)
	st, tokenA, _ := e.pair() // B se reinstala como inst-b2 y pierde su token
	_, _, err := pairing.Start(st, "inst-b2", "", e.c)
	wantErr(t, err, protocol.NotPaired)
	_, _, err = pairing.Start(st, "inst-a", tokenA, e.c)
	wantErr(t, err, protocol.LimitReached)

	if got := ids(mustList(t, st, tokenA)); !slices.Equal(got, []string{"inst-a", "inst-b"}) {
		t.Fatalf("List(A) = %v", got)
	}
	if _, err := pairing.Remove(st, tokenA, "inst-b"); err != nil {
		t.Fatal(err.Code)
	}
	tokenB2 := e.join(st, "inst-b2", e.code(st, tokenA))
	list := mustList(t, st, tokenB2)
	if !slices.Equal(ids(list), []string{"inst-a", "inst-b2"}) || !list[1].Self {
		t.Fatalf("List(B2) = %+v", list)
	}
	valid(t, st)
}

func TestVerify(t *testing.T) {
	e := newEnv(t)
	st, tokenA, _ := e.pair()

	_, changed, err := pairing.Verify(st, tokenA, e.c, e.known)
	wantErr(t, err, protocol.NotFound) // sin Declare (D10)
	wantChanged(t, changed, false)

	e.declare(st, tokenA, "Profile 1", "")
	delete(e.profiles, "Profile 1")
	_, changed, err = pairing.Verify(st, tokenA, e.c, e.known)
	wantErr(t, err, protocol.UnknownProfile)
	wantChanged(t, changed, false)
	if len(st.PendingProofs) != 0 {
		t.Fatalf("PendingProofs = %+v", st.PendingProofs)
	}
	e.profiles["Profile 1"] = true

	req, changed, err := pairing.Verify(st, tokenA, e.c, e.known)
	noErr(t, err)
	wantChanged(t, changed, true)
	if len(req.Nonce) != 43 || !protocol.ValidNonce(req.Nonce) || req.ProfileDirectory != "Profile 1" ||
		req.ExpiresAt != "2026-10-08T12:01:00.000Z" {
		t.Fatalf("ProofRequest = %+v", req)
	}
	want := store.Proof{
		NonceHash:        pairing.HashSecret(req.Nonce),
		InstallationID:   "inst-a",
		ProfileDirectory: "Profile 1",
		ExpiresAt:        "2026-10-08T12:01:00.000Z",
	}
	if len(st.PendingProofs) != 1 || st.PendingProofs[0] != want {
		t.Fatalf("PendingProofs = %+v, quiero [%+v]", st.PendingProofs, want)
	}
	valid(t, st)

	// Un segundo Verify reemplaza la prueba: el primer nonce ya no vale.
	e.at(10 * time.Second)
	req2, _, err := pairing.Verify(st, tokenA, e.c, e.known)
	noErr(t, err)
	want = store.Proof{
		NonceHash:        pairing.HashSecret(req2.Nonce),
		InstallationID:   "inst-a",
		ProfileDirectory: "Profile 1",
		ExpiresAt:        "2026-10-08T12:01:10.000Z",
	}
	if req2.Nonce == req.Nonce || len(st.PendingProofs) != 1 || st.PendingProofs[0] != want {
		t.Fatalf("PendingProofs = %+v, quiero [%+v]", st.PendingProofs, want)
	}
	_, _, err = pairing.Prove(st, tokenA, req.Nonce, e.c)
	wantErr(t, err, protocol.BadNonce)
	e.prove(st, tokenA, req2.Nonce)

	for _, tc := range []struct {
		st    *store.State
		token string
	}{{st, unknownToken}, {nil, tokenA}} {
		_, changed, err := pairing.Verify(tc.st, tc.token, e.c, e.known)
		wantErr(t, err, protocol.NotPaired)
		wantChanged(t, changed, false)
	}
}

func TestVerifyKeepsAtMostMaxProofs(t *testing.T) {
	e := newEnv(t)
	st, tokenA, _ := e.pair()
	e.declare(st, tokenA, "Default", "")
	// Pruebas vigentes de instalaciones que ya no existen (solo con un shared.json manipulado), hasta el maximo.
	for i := range store.MaxPendingProofs {
		st.PendingProofs = append(st.PendingProofs, store.Proof{
			NonceHash:        pairing.HashSecret(fmt.Sprint(i)),
			InstallationID:   fmt.Sprintf("old-%02d", i),
			ProfileDirectory: "Default",
			ExpiresAt:        "2026-10-08T12:00:30.000Z",
		})
	}
	nonce := e.verify(st, tokenA)
	n := len(st.PendingProofs)
	if n != store.MaxPendingProofs || st.PendingProofs[0].InstallationID != "old-01" ||
		st.PendingProofs[n-1].NonceHash != pairing.HashSecret(nonce) {
		t.Fatalf("PendingProofs (%d) = %+v", n, st.PendingProofs)
	}
	valid(t, st)
}

func TestIssueProof(t *testing.T) {
	e := newEnv(t)
	st, _, tokenB := e.pair()
	e.declare(st, tokenB, "Default", "")
	req, err := pairing.IssueProof(st, 1, e.c, e.known)
	noErr(t, err)
	if req.ProfileDirectory != "Default" || len(st.PendingProofs) != 1 || st.PendingProofs[0].InstallationID != "inst-b" {
		t.Fatalf("ProofRequest %+v, pruebas %+v", req, st.PendingProofs)
	}
	_, err = pairing.IssueProof(st, 0, e.c, e.known) // A no declaro carpeta
	wantErr(t, err, protocol.NotFound)
	for _, i := range []int{-1, 2} {
		_, err = pairing.IssueProof(st, i, e.c, e.known)
		wantErr(t, err, protocol.Internal)
	}
	_, err = pairing.IssueProof(nil, 0, e.c, e.known)
	wantErr(t, err, protocol.Internal)
	e.prove(st, tokenB, req.Nonce)
}

func TestRandomnessFailure(t *testing.T) {
	broken := pairing.Clock{Now: func() time.Time { return t0 }, Rand: failing{}}
	got, _, err := pairing.Start(nil, "inst-a", "", broken)
	wantErr(t, err, protocol.Internal)
	if got != nil {
		t.Fatal("Start sin aleatoriedad devuelve un estado para guardar")
	}

	e := newEnv(t)
	st, tokenA, tokenB := e.pair()
	st.MaxPairedProfiles = 3
	code := e.code(st, tokenA)
	before := *st.PairCode

	got, _, err = pairing.Start(st, "inst-a", tokenA, broken)
	wantErr(t, err, protocol.Internal)
	if got != nil || *st.PairCode != before {
		t.Fatal("el codigo activo cambio")
	}

	// Join correcto sin aleatoriedad: ni se consume el codigo ni se anade nadie.
	_, changed, err := pairing.Join(st, "inst-c", code, broken)
	wantErr(t, err, protocol.Internal)
	wantChanged(t, changed, false)
	if st.PairCode == nil || *st.PairCode != before || len(st.Paired) != 2 {
		t.Fatalf("PairCode %+v, Paired %d", st.PairCode, len(st.Paired))
	}

	e.declare(st, tokenB, "Default", "")
	e.verify(st, tokenB)
	proofs := slices.Clone(st.PendingProofs)
	_, changed, err = pairing.Verify(st, tokenB, broken, e.known)
	wantErr(t, err, protocol.Internal)
	wantChanged(t, changed, false)
	if !slices.Equal(st.PendingProofs, proofs) {
		t.Fatalf("PendingProofs = %+v, quiero %+v", st.PendingProofs, proofs)
	}

	// Primer emparejamiento con el token generado pero sin bytes para el codigo: no se anade la instalacion.
	pairing.Reset(st)
	short := pairing.Clock{Now: func() time.Time { return t0 }, Rand: bytes.NewReader(make([]byte, 32))}
	got, _, err = pairing.Start(st, "inst-a", "", short)
	wantErr(t, err, protocol.Internal)
	if got != nil || len(st.Paired) != 0 || st.PairCode != nil {
		t.Fatalf("Start a medias cambio el estado: %+v", st)
	}
}

func TestProve(t *testing.T) {
	// setup: A en Profile 1 y B en Default, con una prueba pendiente de A emitida a las 12:00:00.000.
	setup := func(t *testing.T) (*env, *store.State, string, string, string) {
		e := newEnv(t)
		st, tokenA, tokenB := e.pair()
		e.declare(st, tokenA, "Profile 1", "")
		e.declare(st, tokenB, "Default", "")
		return e, st, tokenA, tokenB, e.verify(st, tokenA)
	}
	// proofOfA dice si sigue pendiente la prueba de A con nonce.
	proofOfA := func(st *store.State, nonce string) bool {
		return slices.ContainsFunc(st.PendingProofs, func(p store.Proof) bool {
			return p.InstallationID == "inst-a" && p.NonceHash == pairing.HashSecret(nonce)
		})
	}

	t.Run("correcto y un solo uso", func(t *testing.T) {
		e, st, tokenA, _, nonce := setup(t)
		e.at(30 * time.Second)
		res, changed, err := pairing.Prove(st, tokenA, nonce, e.c)
		noErr(t, err)
		wantChanged(t, changed, true)
		if res.VerifiedAt != "2026-10-08T12:00:30.000Z" || st.Paired[0].VerifiedAt != res.VerifiedAt {
			t.Fatalf("VerifiedAt %q, A = %+v", res.VerifiedAt, st.Paired[0])
		}
		if proofOfA(st, nonce) || len(st.PendingProofs) != 0 {
			t.Fatalf("la prueba sigue: %+v", st.PendingProofs)
		}
		valid(t, st)
		_, changed, err = pairing.Prove(st, tokenA, nonce, e.c)
		wantErr(t, err, protocol.BadNonce)
		wantChanged(t, changed, false)
	})
	t.Run("12:00:59.999 vale", func(t *testing.T) {
		e, st, tokenA, _, nonce := setup(t)
		e.at(time.Minute - time.Millisecond)
		e.prove(st, tokenA, nonce)
	})
	t.Run("12:01:00.000 caducado", func(t *testing.T) {
		e, st, tokenA, _, nonce := setup(t)
		e.at(time.Minute)
		_, changed, err := pairing.Prove(st, tokenA, nonce, e.c)
		wantErr(t, err, protocol.BadNonce)
		wantChanged(t, changed, false)
		if st.Paired[0].VerifiedAt != "" {
			t.Fatal("A quedo verificada con un nonce caducado")
		}
	})
	t.Run("nonce de A con el token de B", func(t *testing.T) {
		e, st, _, tokenB, nonce := setup(t)
		_, changed, err := pairing.Prove(st, tokenB, nonce, e.c)
		wantErr(t, err, protocol.BadNonce)
		wantChanged(t, changed, false)
		if !proofOfA(st, nonce) || st.Paired[1].VerifiedAt != "" {
			t.Fatalf("pruebas %+v, B = %+v", st.PendingProofs, st.Paired[1])
		}
	})
	t.Run("nonce de A con el token de B en la misma carpeta", func(t *testing.T) {
		e, st, _, tokenB, nonce := setup(t)
		e.declare(st, tokenB, "Profile 1", "")
		_, _, err := pairing.Prove(st, tokenB, nonce, e.c)
		wantErr(t, err, protocol.BadNonce)
		if !proofOfA(st, nonce) || st.Paired[1].VerifiedAt != "" {
			t.Fatalf("pruebas %+v, B = %+v", st.PendingProofs, st.Paired[1])
		}
	})
	t.Run("otra carpeta entre Verify y Prove", func(t *testing.T) {
		e, st, tokenA, _, nonce := setup(t)
		e.declare(st, tokenA, "Default", "")
		_, _, err := pairing.Prove(st, tokenA, nonce, e.c)
		wantErr(t, err, protocol.BadNonce)
		if st.Paired[0].VerifiedAt != "" {
			t.Fatal("A quedo verificada")
		}
	})
	t.Run("perfil que se volvio a declarar", func(t *testing.T) {
		e, st, tokenA, _, nonce := setup(t)
		e.declare(st, tokenA, "Default", "")
		e.declare(st, tokenA, "Profile 1", "")
		_, _, err := pairing.Prove(st, tokenA, nonce, e.c)
		wantErr(t, err, protocol.BadNonce)
	})
	t.Run("carpeta de la prueba distinta de la declarada", func(t *testing.T) {
		e, st, tokenA, _, nonce := setup(t)
		st.Paired[0].ProfileDirectory = "Default" // sin pasar por Declare, que ya borraria la prueba
		_, changed, err := pairing.Prove(st, tokenA, nonce, e.c)
		wantErr(t, err, protocol.BadNonce)
		wantChanged(t, changed, true)
		if proofOfA(st, nonce) || st.Paired[0].VerifiedAt != "" {
			t.Fatalf("pruebas %+v, A = %+v", st.PendingProofs, st.Paired[0])
		}
		valid(t, st)
	})
	t.Run("nonce desconocido", func(t *testing.T) {
		e, st, tokenA, _, nonce := setup(t)
		_, changed, err := pairing.Prove(st, tokenA, strings.Repeat("n", 43), e.c)
		wantErr(t, err, protocol.BadNonce)
		wantChanged(t, changed, false)
		if !proofOfA(st, nonce) {
			t.Fatal("la prueba de A desaparecio")
		}
	})
	t.Run("token desconocido o sin almacen", func(t *testing.T) {
		e, st, tokenA, _, nonce := setup(t)
		for _, tc := range []struct {
			st    *store.State
			token string
		}{{st, unknownToken}, {nil, tokenA}} {
			_, changed, err := pairing.Prove(tc.st, tc.token, nonce, e.c)
			wantErr(t, err, protocol.NotPaired)
			wantChanged(t, changed, false)
		}
		if !proofOfA(st, nonce) {
			t.Fatal("la prueba de A desaparecio")
		}
	})
}

func TestAuthenticate(t *testing.T) {
	e := newEnv(t)
	st, tokenA, tokenB := e.pair()
	if i, ok := pairing.Authenticate(st, tokenA); !ok || i != 0 {
		t.Fatalf("Authenticate(A) = %d, %v", i, ok)
	}
	// B antes que A en la lista.
	st.Paired[0], st.Paired[1] = st.Paired[1], st.Paired[0]
	if i, ok := pairing.Authenticate(st, tokenA); !ok || i != 1 {
		t.Fatalf("Authenticate(A) con B delante = %d, %v", i, ok)
	}
	if i, ok := pairing.Authenticate(st, tokenB); !ok || i != 0 {
		t.Fatalf("Authenticate(B) = %d, %v", i, ok)
	}

	if _, err := pairing.Remove(st, tokenA, "inst-b"); err != nil {
		t.Fatal(err.Code)
	}
	cases := []struct {
		name  string
		st    *store.State
		token string
	}{
		{"revocado", st, tokenB},
		{"sin almacen", nil, tokenA},
		{"vacio", st, ""},
		{"desconocido", st, unknownToken},
		{"el hash guardado", st, st.Paired[0].TokenHash},
	}
	for _, tc := range cases {
		if i, ok := pairing.Authenticate(tc.st, tc.token); ok || i != -1 {
			t.Errorf("%s: Authenticate = %d, %v", tc.name, i, ok)
		}
	}
}

func TestReset(t *testing.T) {
	e := newEnv(t)
	st, tokenA, _ := e.pair()
	st.MaxPairedProfiles = 3
	e.code(st, tokenA)
	e.declare(st, tokenA, "Default", "")
	e.verify(st, tokenA)
	st.Revision = 9
	st.Data = json.RawMessage(`{"containers":[]}`)
	st.Bindings = json.RawMessage(`{"c1":{"url":"https://github.com/"}}`)

	pairing.Reset(st)
	if st.Paired == nil || len(st.Paired) != 0 || st.PairCode != nil || st.PendingProofs == nil || len(st.PendingProofs) != 0 {
		t.Fatalf("Reset no vacio el emparejamiento: %+v", st)
	}
	if st.Revision != 9 || string(st.Data) != `{"containers":[]}` ||
		string(st.Bindings) != `{"c1":{"url":"https://github.com/"}}` || st.MaxPairedProfiles != 3 {
		t.Fatalf("Reset perdio datos: %+v", st)
	}
	if _, ok := pairing.Authenticate(st, tokenA); ok {
		t.Fatal("el token de A sigue autenticando")
	}
	valid(t, st)
	pairing.Reset(nil) // no entra en panico
}
