package host

import (
	"strings"
	"testing"
	"time"

	"github.com/DanielSantos495/launcher/native-host/internal/store"
)

// loadStore lee el estado guardado (nil si no hay almacén).
func (te *testEnv) loadStore() *store.State {
	te.t.Helper()
	s, err := store.Open(te.dataDir, time.Second)
	if err != nil {
		te.t.Fatal(err)
	}
	defer s.Close()
	st, err := s.Load()
	if err != nil {
		te.t.Fatal(err)
	}
	return st
}

// mutateStore cambia el estado guardado, como haría el subcomando pairing.
func (te *testEnv) mutateStore(fn func(st *store.State)) {
	te.t.Helper()
	s, err := store.Open(te.dataDir, time.Second)
	if err != nil {
		te.t.Fatal(err)
	}
	defer s.Close()
	st, err := s.Load()
	if err != nil || st == nil {
		te.t.Fatalf("no se pudo cargar el almacén: %v", err)
	}
	fn(st)
	if err := s.Save(st); err != nil {
		te.t.Fatal(err)
	}
}

func joinArgs(id, code string) string {
	return `{"installationId":"` + id + `","code":"` + code + `"}`
}

func declareArgs(token, dir string) string {
	return `{"token":"` + token + `","profileDirectory":"` + dir + `"}`
}

// pairTwo empareja inst-a (primera) e inst-b (con el código de A) y devuelve sus tokens.
func (te *testEnv) pairTwo() (tokenA, tokenB string) {
	te.t.Helper()
	tokenA, code := te.firstPairing("inst-a")
	res := result(te.t, te.do("pair.join", joinArgs("inst-b", code)))
	return tokenA, str(te.t, res, "token")
}

// nonceOf saca el nonce de la URL de whoami de una llamada al lanzador.
func nonceOf(t *testing.T, c call) string {
	t.Helper()
	if len(c.args) != 3 {
		t.Fatalf("argumentos de whoami = %v", c.args)
	}
	prefix := "chrome-extension://" + testExtensionID + "/whoami.html#"
	nonce, ok := strings.CutPrefix(c.args[2], prefix)
	if !ok {
		t.Fatalf("la URL de whoami no tiene la forma esperada: %q", c.args[2])
	}
	return nonce
}

func TestPairingFlowThroughRouter(t *testing.T) {
	te := newEnv(t, "brave", "155.1.97.56")

	// A: pair.start sin token.
	res := result(t, te.do("pair.start", `{"installationId":"inst-a"}`))
	tokenA, code := str(t, res, "token"), str(t, res, "code")
	if len(tokenA) != 43 || len(code) != 6 || str(t, res, "expiresAt") != "2026-10-08T12:02:00.000Z" {
		t.Fatalf("pair.start = %v", res)
	}
	// B: pair.join con el código.
	resB := result(t, te.do("pair.join", joinArgs("inst-b", code)))
	tokenB := str(t, resB, "token")
	if len(tokenB) != 43 || tokenB == tokenA {
		t.Fatalf("pair.join = %v", resB)
	}
	// A y B declaran su perfil.
	if got := te.do("pair.declare", declareArgs(tokenA, "Default")); got != okEmpty {
		t.Fatalf("pair.declare A = %s", got)
	}
	if got := te.do("pair.declare", declareArgs(tokenB, "Profile 1")); got != okEmpty {
		t.Fatalf("pair.declare B = %s", got)
	}
	// A: pair.verify abre whoami en el perfil declarado.
	const verified = `{"ok":true,"result":{"expiresAt":"2026-10-08T12:01:00.000Z"}}`
	if got := te.do("pair.verify", tokenArgs(tokenA)); got != verified {
		t.Fatalf("pair.verify = %s, quiero %s", got, verified)
	}
	if len(te.starter.calls) != 1 {
		t.Fatalf("llamadas = %v", te.starter.calls)
	}
	c := te.starter.calls[0]
	nonce := nonceOf(t, c)
	wantArgs := []string{"--profile-directory=Default", "--", "chrome-extension://" + testExtensionID + "/whoami.html#" + nonce}
	if c.exe != browserExe || strings.Join(c.args, "\x00") != strings.Join(wantArgs, "\x00") {
		t.Fatalf("llamada = %v, quiero %s %v", c, browserExe, wantArgs)
	}
	// La página whoami (en el perfil de A) hace pair.prove con el token de A.
	te.now = t0.Add(5 * time.Second)
	if got := te.do("pair.prove", `{"token":"`+tokenA+`","nonce":"`+nonce+`"}`); got != `{"ok":true,"result":{"verifiedAt":"2026-10-08T12:00:05.000Z"}}` {
		t.Fatalf("pair.prove = %s", got)
	}
	// El nonce es de un solo uso.
	if got := te.do("pair.prove", `{"token":"`+tokenA+`","nonce":"`+nonce+`"}`); got != errBody("bad_nonce") {
		t.Fatalf("segundo pair.prove = %s, quiero bad_nonce", got)
	}
	// pair.list: A verificada y B sin verificar.
	const list = `{"ok":true,"result":{"maxPairedProfiles":2,"installations":[` +
		`{"installationId":"inst-a","profileDirectory":"Default","pairedAt":"2026-10-08T12:00:00.000Z","verifiedAt":"2026-10-08T12:00:05.000Z","self":true},` +
		`{"installationId":"inst-b","profileDirectory":"Profile 1","pairedAt":"2026-10-08T12:00:00.000Z","self":false}]}}`
	if got := te.do("pair.list", tokenArgs(tokenA)); got != list {
		t.Fatalf("pair.list = %s\nquiero      %s", got, list)
	}
	// Con el máximo alcanzado no se emite un código para una tercera instalación.
	if got := te.do("pair.start", `{"installationId":"inst-a","token":"`+tokenA+`"}`); got != errBody("limit_reached") {
		t.Fatalf("pair.start con el máximo = %s, quiero limit_reached", got)
	}
}

func TestPairStartRules(t *testing.T) {
	te := newEnv(t, "brave", "155.1.97.56")
	tokenA, _ := te.firstPairing("inst-a")
	// D5: sin token, con instalaciones emparejadas, no vale.
	if got := te.do("pair.start", `{"installationId":"inst-z"}`); got != errBody("not_paired") {
		t.Fatalf("pair.start sin token = %s, quiero not_paired", got)
	}
	// D6: un token que no es de ese installationId, o desconocido.
	if got := te.do("pair.start", `{"installationId":"inst-z","token":"`+tokenA+`"}`); got != errBody("not_paired") {
		t.Fatalf("pair.start con el token de otra = %s", got)
	}
	if got := te.do("pair.start", `{"installationId":"inst-a","token":"`+unknownToken+`"}`); got != errBody("not_paired") {
		t.Fatalf("pair.start con token desconocido = %s", got)
	}
	// Con su token, la instalación pide un código nuevo (sin token en el resultado) que sustituye al anterior.
	res := result(t, te.do("pair.start", `{"installationId":"inst-a","token":"`+tokenA+`"}`))
	if _, hasToken := res["token"]; hasToken || len(str(t, res, "code")) != 6 {
		t.Fatalf("pair.start con token = %v", res)
	}
}

func TestPairJoinFailuresArePersisted(t *testing.T) {
	// Cada intento fallido se guarda aunque la respuesta sea un error: tras 5, el código deja de valer (D7) y ni el
	// código correcto sirve.
	te := newEnv(t, "brave", "155.1.97.56")
	_, code := te.firstPairing("inst-a")
	wrong := "111111"
	if code == wrong {
		wrong = "222222"
	}
	for i := range 5 {
		if got := te.do("pair.join", joinArgs("inst-b", wrong)); got != errBody("bad_code") {
			t.Fatalf("intento %d = %s, quiero bad_code", i, got)
		}
	}
	if got := te.do("pair.join", joinArgs("inst-b", code)); got != errBody("bad_code") {
		t.Fatalf("el código correcto tras 5 fallos = %s, quiero bad_code", got)
	}
}

func TestPairJoinWithoutStoreOrCode(t *testing.T) {
	te := newEnv(t, "brave", "155.1.97.56")
	if got := te.do("pair.join", joinArgs("inst-b", "123456")); got != errBody("bad_code") {
		t.Fatalf("sin almacén = %s, quiero bad_code", got)
	}
	_, code := te.firstPairing("inst-a")
	te.now = t0.Add(120 * time.Second) // caduca justo a los 120 s
	if got := te.do("pair.join", joinArgs("inst-b", code)); got != errBody("bad_code") {
		t.Fatalf("código caducado = %s, quiero bad_code", got)
	}
}

func TestPairJoinAtLimitConsumesCode(t *testing.T) {
	// D9: con el código correcto pero sin plaza, limit_reached y el código queda consumido. Eso exige guardar el
	// estado junto a un error.
	te := newEnv(t, "brave", "155.1.97.56")
	_, code := te.firstPairing("inst-a")
	te.mutateStore(func(st *store.State) { st.MaxPairedProfiles = 1 })
	if got := te.do("pair.join", joinArgs("inst-c", code)); got != errBody("limit_reached") {
		t.Fatalf("pair.join = %s, quiero limit_reached", got)
	}
	if got := te.do("pair.join", joinArgs("inst-c", code)); got != errBody("bad_code") {
		t.Fatalf("segundo pair.join = %s, quiero bad_code (código consumido)", got)
	}
	if st := te.loadStore(); len(st.Paired) != 1 || st.PairCode != nil {
		t.Fatalf("estado guardado inesperado: %d instalaciones, código %v", len(st.Paired), st.PairCode)
	}
}

func TestPairDeclare(t *testing.T) {
	te := newEnv(t, "brave", "155.1.97.56")
	tokenA, _ := te.firstPairing("inst-a")
	if got := te.do("pair.declare", declareArgs(unknownToken, "Default")); got != errBody("not_paired") {
		t.Fatalf("token desconocido = %s", got)
	}
	for _, dir := range []string{"Nope", "Guest Profile", "Profile 3"} {
		if got := te.do("pair.declare", declareArgs(tokenA, dir)); got != errBody("unknown_profile") {
			t.Fatalf("pair.declare %q = %s, quiero unknown_profile", dir, got)
		}
	}
	if got := te.do("pair.declare", `{"token":"`+tokenA+`","profileDirectory":"Default","identityId":"id-1"}`); got != okEmpty {
		t.Fatalf("pair.declare = %s", got)
	}
	st := te.loadStore()
	if in := st.Paired[0]; in.ProfileDirectory != "Default" || in.IdentityID != "id-1" {
		t.Fatalf("instalación guardada = %+v", in)
	}
	// Sin identityId se borra la guardada (D11).
	if got := te.do("pair.declare", declareArgs(tokenA, "Default")); got != okEmpty {
		t.Fatalf("pair.declare = %s", got)
	}
	if in := te.loadStore().Paired[0]; in.IdentityID != "" {
		t.Fatalf("identityId = %q, quiero vacío", in.IdentityID)
	}
}

func TestPairDeclareAndVerifyNeedLocalState(t *testing.T) {
	te := newEnv(t, "brave", "155.1.97.56")
	tokenA, _ := te.firstPairing("inst-a")
	writeLocalState(t, te, `[]`)
	if got := te.do("pair.declare", declareArgs(tokenA, "Default")); got != errBody("internal") {
		t.Fatalf("pair.declare = %s, quiero internal", got)
	}
	if got := te.do("pair.verify", tokenArgs(tokenA)); got != errBody("internal") {
		t.Fatalf("pair.verify = %s, quiero internal", got)
	}
	te.wantCalls()
}

func TestPairVerifyRules(t *testing.T) {
	te := newEnv(t, "brave", "155.1.97.56")
	tokenA, _ := te.firstPairing("inst-a")
	if got := te.do("pair.verify", tokenArgs(unknownToken)); got != errBody("not_paired") {
		t.Fatalf("token desconocido = %s", got)
	}
	// D10: sin pair.declare previo, not_found y no se lanza nada.
	if got := te.do("pair.verify", tokenArgs(tokenA)); got != errBody("not_found") {
		t.Fatalf("sin declarar = %s, quiero not_found", got)
	}
	te.wantCalls()
	te.do("pair.declare", declareArgs(tokenA, "Profile 1"))
	// D10: el perfil declarado que ya no está en Local State.
	writeLocalState(t, te, `{"profile":{"info_cache":{"Default":{"name":"Trabajo"}}}}`)
	if got := te.do("pair.verify", tokenArgs(tokenA)); got != errBody("unknown_profile") {
		t.Fatalf("perfil desaparecido = %s, quiero unknown_profile", got)
	}
	te.wantCalls()
}

func TestPairVerifyLaunchesAfterSavingAndReleasingTheStore(t *testing.T) {
	te := newEnv(t, "brave", "155.1.97.56")
	tokenA, _ := te.firstPairing("inst-a")
	te.do("pair.declare", declareArgs(tokenA, "Default"))

	// Cuando el navegador arranca, la prueba ya tiene que estar guardada y el bloqueo suelto: whoami hace
	// pair.prove enseguida y necesita abrir el almacén.
	proofs := -1
	te.starter.onStart = func(string, []string) {
		s, err := store.Open(te.dataDir, 100*time.Millisecond)
		if err != nil {
			t.Errorf("el bloqueo sigue tomado al lanzar el navegador: %v", err)
			return
		}
		defer s.Close()
		if st, err := s.Load(); err == nil && st != nil {
			proofs = len(st.PendingProofs)
		}
	}
	te.do("pair.verify", tokenArgs(tokenA))
	if proofs != 1 {
		t.Fatalf("pruebas guardadas al lanzar = %d, quiero 1", proofs)
	}
}

func TestPairVerifyLaunchFailed(t *testing.T) {
	te := newEnv(t, "brave", "155.1.97.56")
	tokenA, _ := te.firstPairing("inst-a")
	te.do("pair.declare", declareArgs(tokenA, "Default"))
	te.starter.err = errBoom
	if got := te.do("pair.verify", tokenArgs(tokenA)); got != errBody("launch_failed") {
		t.Fatalf("pair.verify = %s, quiero launch_failed", got)
	}
	if len(te.starter.calls) != 1 {
		t.Fatalf("llamadas = %d, quiero 1", len(te.starter.calls))
	}
}

type boom struct{}

func (boom) Error() string { return "boom" }

var errBoom error = boom{}

func TestPairProveRules(t *testing.T) {
	te := newEnv(t, "brave", "155.1.97.56")
	tokenA, tokenB := te.pairTwo()
	te.do("pair.declare", declareArgs(tokenA, "Default"))
	te.do("pair.declare", declareArgs(tokenB, "Profile 1"))
	te.do("pair.verify", tokenArgs(tokenA))
	nonce := nonceOf(t, te.starter.calls[0])

	if got := te.do("pair.prove", `{"token":"`+unknownToken+`","nonce":"`+nonce+`"}`); got != errBody("not_paired") {
		t.Fatalf("token desconocido = %s", got)
	}
	// Un nonce inventado, y el nonce de A con el token de B (otra instalación): bad_nonce.
	if got := te.do("pair.prove", `{"token":"`+tokenA+`","nonce":"`+strings.Repeat("x", 43)+`"}`); got != errBody("bad_nonce") {
		t.Fatalf("nonce inventado = %s", got)
	}
	if got := te.do("pair.prove", `{"token":"`+tokenB+`","nonce":"`+nonce+`"}`); got != errBody("bad_nonce") {
		t.Fatalf("nonce de otra instalación = %s", got)
	}
	// Caducado a los 60 s.
	te.now = t0.Add(60 * time.Second)
	if got := te.do("pair.prove", `{"token":"`+tokenA+`","nonce":"`+nonce+`"}`); got != errBody("bad_nonce") {
		t.Fatalf("nonce caducado = %s", got)
	}
}

func TestPairRemove(t *testing.T) {
	te := newEnv(t, "brave", "155.1.97.56")
	tokenA, tokenB := te.pairTwo()
	if got := te.do("pair.remove", `{"token":"`+unknownToken+`","installationId":"inst-b"}`); got != errBody("not_paired") {
		t.Fatalf("token desconocido = %s", got)
	}
	if got := te.do("pair.remove", `{"token":"`+tokenA+`","installationId":"inst-z"}`); got != errBody("not_found") {
		t.Fatalf("instalación inexistente = %s", got)
	}
	if got := te.do("pair.remove", `{"token":"`+tokenA+`","installationId":"inst-b"}`); got != okEmpty {
		t.Fatalf("pair.remove = %s", got)
	}
	// El token de la instalación quitada deja de valer y la lista solo tiene a A.
	if got := te.do("pair.list", tokenArgs(tokenB)); got != errBody("not_paired") {
		t.Fatalf("pair.list con el token quitado = %s", got)
	}
	if st := te.loadStore(); len(st.Paired) != 1 || st.Paired[0].InstallationID != "inst-a" {
		t.Fatalf("estado guardado: %+v", st.Paired)
	}
}

func TestPairCommandsWithUnknownTokenAreNotPaired(t *testing.T) {
	te := newEnv(t, "brave", "155.1.97.56")
	te.firstPairing("inst-a")
	for cmd, args := range map[string]string{
		"pair.declare": declareArgs(unknownToken, "Default"),
		"pair.list":    tokenArgs(unknownToken),
		"pair.remove":  `{"token":"` + unknownToken + `","installationId":"inst-a"}`,
		"pair.verify":  tokenArgs(unknownToken),
		"pair.prove":   `{"token":"` + unknownToken + `","nonce":"` + strings.Repeat("x", 43) + `"}`,
		"sync.get":     tokenArgs(unknownToken),
	} {
		if got := te.do(cmd, args); got != errBody("not_paired") {
			t.Fatalf("%s = %s, quiero not_paired", cmd, got)
		}
	}
	te.wantCalls()
}
