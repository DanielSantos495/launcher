package store_test

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"github.com/DanielSantos495/launcher/native-host/internal/protocol"
	"github.com/DanielSantos495/launcher/native-host/internal/store"
)

const (
	ts1 = "2026-10-08T12:00:00.000Z"
	ts2 = "2026-10-08T12:01:00.000Z"
)

// esc devuelve el escape JSON de cuatro digitos hexadecimales (barra invertida, "u" y los digitos). Se construye
// por partes para que ninguna herramienta lo convierta en el caracter que representa.
func esc(hex string) string { return "\\" + "u" + hex }

// hash64 devuelve un hash SHA-256 hexadecimal valido (64 digitos en minusculas) distinto para cada letra.
func hash64(c string) string { return strings.Repeat(c, 64) }

// validState es un estado completo y valido: dos instalaciones, un codigo de emparejamiento y una prueba pendiente.
func validState() *store.State {
	st := store.NewState()
	st.Revision = 7
	st.Data = json.RawMessage(`{"containers":[{"id":"c1","name":"Trabajo"}]}`)
	st.Bindings = json.RawMessage(`{"c1":{"url":"https://example.com"}}`)
	st.MaxPairedProfiles = 2
	st.Paired = []store.Installation{
		{InstallationID: "inst-a", TokenHash: hash64("a"), IdentityID: "id-1", ProfileDirectory: "Default", PairedAt: ts1, VerifiedAt: ts2},
		{InstallationID: "inst-b", TokenHash: hash64("b"), PairedAt: ts1},
	}
	st.PairCode = &store.PairCode{CodeHash: hash64("c"), ExpiresAt: ts2, Failures: 2}
	st.PendingProofs = []store.Proof{
		{NonceHash: hash64("d"), InstallationID: "inst-a", ProfileDirectory: "Profile 1", ExpiresAt: ts2},
	}
	return st
}

// objectOfSize devuelve un objeto JSON de exactamente n bytes.
func objectOfSize(n int) json.RawMessage {
	const wrap = len(`{"a":""}`)
	return json.RawMessage(`{"a":"` + strings.Repeat("x", n-wrap) + `"}`)
}

func TestNewState(t *testing.T) {
	st := store.NewState()
	if err := st.Validate(); err != nil {
		t.Fatalf("NewState().Validate() = %v", err)
	}
	if st.Format != 1 || st.Revision != 0 || st.MaxPairedProfiles != 2 {
		t.Errorf("NewState() = format %d, revision %d, max %d; want 1, 0, 2", st.Format, st.Revision, st.MaxPairedProfiles)
	}
	if string(st.Data) != "null" {
		t.Errorf("Data = %q, want null", st.Data)
	}
	if string(st.Bindings) != "{}" {
		t.Errorf("Bindings = %q, want {}", st.Bindings)
	}
	if st.Paired == nil || len(st.Paired) != 0 || st.PendingProofs == nil || len(st.PendingProofs) != 0 || st.PairCode != nil {
		t.Errorf("las listas deben nacer vacias y no nil, sin codigo: %+v", st)
	}
}

func TestValidateAcceptsValidStates(t *testing.T) {
	cases := []struct {
		name   string
		mutate func(*store.State)
	}{
		{"estado completo", func(*store.State) {}},
		{"revision 0", func(st *store.State) { st.Revision = 0 }},
		{"revision maxima segura", func(st *store.State) { st.Revision = protocol.MaxSafeInteger }},
		{"data nil se trata como null", func(st *store.State) { st.Data = nil }},
		{"data null", func(st *store.State) { st.Data = json.RawMessage("null") }},
		{"data objeto vacio", func(st *store.State) { st.Data = json.RawMessage("{}") }},
		{"data en el maximo", func(st *store.State) { st.Data = objectOfSize(protocol.MaxSharedDataBytes) }},
		{"bindings en el maximo", func(st *store.State) { st.Bindings = objectOfSize(protocol.MaxSharedBindingsBytes) }},
		{"un perfil emparejado como maximo", func(st *store.State) { st.MaxPairedProfiles = 1 }},
		{"16 perfiles emparejados como maximo", func(st *store.State) { st.MaxPairedProfiles = 16 }},
		{"sin instalaciones", func(st *store.State) { st.Paired = nil }},
		{"16 instalaciones", func(st *store.State) {
			st.Paired = nil
			for i := range 16 {
				st.Paired = append(st.Paired, store.Installation{InstallationID: fmt.Sprintf("i%d", i), TokenHash: hash64("a"), PairedAt: ts1})
			}
		}},
		{"instalacion sin identidad, perfil ni verificacion", func(st *store.State) {
			st.Paired[0].IdentityID, st.Paired[0].ProfileDirectory, st.Paired[0].VerifiedAt = "", "", ""
		}},
		{"codigo sin fallos", func(st *store.State) { st.PairCode.Failures = 0 }},
		{"codigo con 5 fallos", func(st *store.State) { st.PairCode.Failures = store.MaxJoinFailures }},
		{"sin codigo", func(st *store.State) { st.PairCode = nil }},
		{"sin pruebas pendientes", func(st *store.State) { st.PendingProofs = nil }},
		{"16 pruebas pendientes", func(st *store.State) {
			st.PendingProofs = nil
			for range 16 {
				st.PendingProofs = append(st.PendingProofs, store.Proof{NonceHash: hash64("d"), InstallationID: "inst-a", ProfileDirectory: "Default", ExpiresAt: ts2})
			}
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			st := validState()
			tc.mutate(st)
			if err := st.Validate(); err != nil {
				t.Errorf("Validate() = %v, want nil", err)
			}
		})
	}
}

func TestValidateRejects(t *testing.T) {
	longID := strings.Repeat("a", 65)
	manyInstallations := func(n int) []store.Installation {
		var out []store.Installation
		for i := range n {
			out = append(out, store.Installation{InstallationID: fmt.Sprintf("i%d", i), TokenHash: hash64("a"), PairedAt: ts1})
		}
		return out
	}
	manyProofs := func(n int) []store.Proof {
		var out []store.Proof
		for range n {
			out = append(out, store.Proof{NonceHash: hash64("d"), InstallationID: "inst-a", ProfileDirectory: "Default", ExpiresAt: ts2})
		}
		return out
	}
	cases := []struct {
		name   string
		mutate func(*store.State)
	}{
		{"format 2", func(st *store.State) { st.Format = 2 }},
		{"format 0", func(st *store.State) { st.Format = 0 }},
		{"revision -1", func(st *store.State) { st.Revision = -1 }},
		{"revision 2^53", func(st *store.State) { st.Revision = protocol.MaxSafeInteger + 1 }},

		{"data array", func(st *store.State) { st.Data = json.RawMessage("[]") }},
		{"data texto", func(st *store.State) { st.Data = json.RawMessage(`"x"`) }},
		{"data numero", func(st *store.State) { st.Data = json.RawMessage("1") }},
		{"data json invalido", func(st *store.State) { st.Data = json.RawMessage("{") }},
		{"data objeto seguido de otro", func(st *store.State) { st.Data = json.RawMessage("{}{}") }},
		{"data null truncado", func(st *store.State) { st.Data = json.RawMessage("nul") }},
		{"data null con sobrante", func(st *store.State) { st.Data = json.RawMessage("nullx") }},
		{"data con sustituto suelto", func(st *store.State) { st.Data = json.RawMessage(`{"a":"` + esc("d800") + `"}`) }},
		{"data por encima del maximo", func(st *store.State) { st.Data = objectOfSize(protocol.MaxSharedDataBytes + 1) }},

		{"bindings nil", func(st *store.State) { st.Bindings = nil }},
		{"bindings null", func(st *store.State) { st.Bindings = json.RawMessage("null") }},
		{"bindings array", func(st *store.State) { st.Bindings = json.RawMessage("[]") }},
		{"bindings texto", func(st *store.State) { st.Bindings = json.RawMessage(`"x"`) }},
		{"bindings json invalido", func(st *store.State) { st.Bindings = json.RawMessage("{") }},
		{"bindings objeto seguido de otro", func(st *store.State) { st.Bindings = json.RawMessage("{}{}") }},
		{"bindings por encima del maximo", func(st *store.State) { st.Bindings = objectOfSize(protocol.MaxSharedBindingsBytes + 1) }},

		{"max perfiles 0", func(st *store.State) { st.MaxPairedProfiles = 0 }},
		{"max perfiles -1", func(st *store.State) { st.MaxPairedProfiles = -1 }},
		{"max perfiles 17", func(st *store.State) { st.MaxPairedProfiles = 17 }},

		{"17 instalaciones", func(st *store.State) { st.Paired = manyInstallations(17) }},
		{"instalaciones repetidas", func(st *store.State) { st.Paired[1].InstallationID = st.Paired[0].InstallationID }},
		{"installationId vacio", func(st *store.State) { st.Paired[0].InstallationID = "" }},
		{"installationId con espacio", func(st *store.State) { st.Paired[0].InstallationID = "a b" }},
		{"installationId __proto__", func(st *store.State) { st.Paired[0].InstallationID = "__proto__" }},
		{"installationId de 65", func(st *store.State) { st.Paired[0].InstallationID = longID }},
		{"tokenHash vacio", func(st *store.State) { st.Paired[0].TokenHash = "" }},
		{"tokenHash en mayusculas", func(st *store.State) { st.Paired[0].TokenHash = strings.ToUpper(hash64("a")) }},
		{"tokenHash de 63", func(st *store.State) { st.Paired[0].TokenHash = hash64("a")[:63] }},
		{"tokenHash de 65", func(st *store.State) { st.Paired[0].TokenHash = hash64("a") + "a" }},
		{"tokenHash no hexadecimal", func(st *store.State) { st.Paired[0].TokenHash = hash64("a")[:63] + "g" }},
		{"identityId __proto__", func(st *store.State) { st.Paired[0].IdentityID = "__proto__" }},
		{"identityId constructor", func(st *store.State) { st.Paired[0].IdentityID = "constructor" }},
		{"identityId con espacio", func(st *store.State) { st.Paired[0].IdentityID = "a b" }},
		{"profileDirectory -x", func(st *store.State) { st.Paired[0].ProfileDirectory = "-x" }},
		{"profileDirectory con barra", func(st *store.State) { st.Paired[0].ProfileDirectory = "a/b" }},
		{"profileDirectory ..", func(st *store.State) { st.Paired[0].ProfileDirectory = ".." }},
		{"pairedAt sin milisegundos", func(st *store.State) { st.Paired[0].PairedAt = "2026-10-08T12:00:00Z" }},
		{"pairedAt vacio", func(st *store.State) { st.Paired[0].PairedAt = "" }},
		{"verifiedAt sin milisegundos", func(st *store.State) { st.Paired[0].VerifiedAt = "2026-10-08T12:00:00Z" }},

		{"codeHash en mayusculas", func(st *store.State) { st.PairCode.CodeHash = strings.ToUpper(hash64("c")) }},
		{"codeHash de 63", func(st *store.State) { st.PairCode.CodeHash = hash64("c")[:63] }},
		{"codeHash vacio", func(st *store.State) { st.PairCode.CodeHash = "" }},
		{"codigo caducado sin fecha", func(st *store.State) { st.PairCode.ExpiresAt = "" }},
		{"codigo con fecha sin milisegundos", func(st *store.State) { st.PairCode.ExpiresAt = "2026-10-08T12:00:00Z" }},
		{"fallos 6", func(st *store.State) { st.PairCode.Failures = store.MaxJoinFailures + 1 }},
		{"fallos -1", func(st *store.State) { st.PairCode.Failures = -1 }},

		{"17 pruebas pendientes", func(st *store.State) { st.PendingProofs = manyProofs(17) }},
		{"nonceHash en mayusculas", func(st *store.State) { st.PendingProofs[0].NonceHash = strings.ToUpper(hash64("d")) }},
		{"nonceHash de 63", func(st *store.State) { st.PendingProofs[0].NonceHash = hash64("d")[:63] }},
		{"nonceHash vacio", func(st *store.State) { st.PendingProofs[0].NonceHash = "" }},
		{"prueba con installationId invalido", func(st *store.State) { st.PendingProofs[0].InstallationID = "__proto__" }},
		{"prueba sin installationId", func(st *store.State) { st.PendingProofs[0].InstallationID = "" }},
		{"prueba sin perfil", func(st *store.State) { st.PendingProofs[0].ProfileDirectory = "" }},
		{"prueba con perfil -x", func(st *store.State) { st.PendingProofs[0].ProfileDirectory = "-x" }},
		{"prueba con fecha sin milisegundos", func(st *store.State) { st.PendingProofs[0].ExpiresAt = "2026-10-08T12:00:00Z" }},
		{"prueba sin fecha", func(st *store.State) { st.PendingProofs[0].ExpiresAt = "" }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			st := validState()
			if err := st.Validate(); err != nil {
				t.Fatalf("el estado base debe ser valido: %v", err)
			}
			tc.mutate(st)
			err := st.Validate()
			if err == nil {
				t.Fatal("Validate() = nil, want error")
			}
			// Los errores no repiten valores del estado.
			for _, secret := range []string{"inst-a", "id-1", "Profile 1", "Trabajo", "example.com", hash64("a"), hash64("c"), hash64("d")} {
				if strings.Contains(err.Error(), secret) {
					t.Errorf("el error repite un valor del estado: %q", err)
				}
			}
		})
	}
}

func TestPut(t *testing.T) {
	data := json.RawMessage("{ \"a\" : \"<&>\" }")
	bindings := json.RawMessage(`{"c1":{"url":"https://example.com/?a=1&b=2"}}`)

	t.Run("base igual a la revision guarda byte a byte", func(t *testing.T) {
		st := store.NewState()
		rev, perr := st.Put(0, data, bindings)
		if perr != nil || rev != 1 {
			t.Fatalf("Put(0) = %d, %v; want 1, nil", rev, perr)
		}
		if st.Revision != 1 || string(st.Data) != string(data) || string(st.Bindings) != string(bindings) {
			t.Errorf("estado tras Put: revision %d, data %q, bindings %q", st.Revision, st.Data, st.Bindings)
		}
		if err := st.Validate(); err != nil {
			t.Errorf("el estado tras Put debe seguir siendo valido: %v", err)
		}
	})

	t.Run("no comparte memoria con los argumentos", func(t *testing.T) {
		st := store.NewState()
		d := json.RawMessage(`{"a":1}`)
		b := json.RawMessage(`{"b":2}`)
		if _, perr := st.Put(0, d, b); perr != nil {
			t.Fatal(perr)
		}
		d[2], b[2] = 'x', 'x'
		if string(st.Data) != `{"a":1}` || string(st.Bindings) != `{"b":2}` {
			t.Errorf("Put debe copiar: data %q, bindings %q", st.Data, st.Bindings)
		}
	})

	t.Run("base distinta es conflicto con la revision actual y nada cambia", func(t *testing.T) {
		st := store.NewState()
		st.Revision = 1
		st.Data = json.RawMessage(`{"viejo":true}`)
		rev, perr := st.Put(0, data, bindings)
		if perr == nil || perr.Code != protocol.Conflict || perr.Revision != 1 || rev != 0 {
			t.Fatalf("Put(0) sobre revision 1 = %d, %+v; want 0, conflict en 1", rev, perr)
		}
		if st.Revision != 1 || string(st.Data) != `{"viejo":true}` || string(st.Bindings) != "{}" {
			t.Errorf("el conflicto cambio el estado: %+v", st)
		}
	})

	t.Run("base por delante de la revision tambien es conflicto", func(t *testing.T) {
		st := store.NewState()
		_, perr := st.Put(5, data, bindings)
		if perr == nil || perr.Code != protocol.Conflict || perr.Revision != 0 {
			t.Fatalf("Put(5) sobre revision 0 = %+v, want conflict en 0", perr)
		}
	})

	t.Run("en la revision maxima es internal", func(t *testing.T) {
		st := store.NewState()
		st.Revision = protocol.MaxSafeInteger
		rev, perr := st.Put(protocol.MaxSafeInteger, data, bindings)
		if perr == nil || perr.Code != protocol.Internal || rev != 0 {
			t.Fatalf("Put en 2^53-1 = %d, %+v; want 0, internal", rev, perr)
		}
		if st.Revision != protocol.MaxSafeInteger || string(st.Data) != "null" {
			t.Errorf("el fallo cambio el estado: %+v", st)
		}
	})

	t.Run("justo antes de la revision maxima aun funciona", func(t *testing.T) {
		st := store.NewState()
		st.Revision = protocol.MaxSafeInteger - 1
		rev, perr := st.Put(protocol.MaxSafeInteger-1, data, bindings)
		if perr != nil || rev != protocol.MaxSafeInteger {
			t.Fatalf("Put en 2^53-2 = %d, %v; want 2^53-1, nil", rev, perr)
		}
	})

	t.Run("en la revision maxima con base distinta gana el conflicto", func(t *testing.T) {
		st := store.NewState()
		st.Revision = protocol.MaxSafeInteger
		_, perr := st.Put(0, data, bindings)
		if perr == nil || perr.Code != protocol.Conflict || perr.Revision != protocol.MaxSafeInteger {
			t.Fatalf("Put(0) en 2^53-1 = %+v, want conflict", perr)
		}
	})

	t.Run("data nil se guarda como null", func(t *testing.T) {
		st := store.NewState()
		if _, perr := st.Put(0, nil, bindings); perr != nil {
			t.Fatal(perr)
		}
		if string(st.Data) != "null" {
			t.Errorf("Data = %q, want null", st.Data)
		}
	})

	t.Run("formas que Validate rechazaria son internal y no cambian nada", func(t *testing.T) {
		cases := []struct {
			name           string
			data, bindings json.RawMessage
		}{
			{"bindings nil", data, nil},
			{"bindings null", data, json.RawMessage("null")},
			{"bindings array", data, json.RawMessage("[]")},
			{"data array", json.RawMessage("[]"), bindings},
			{"data invalido", json.RawMessage("{"), bindings},
			{"data demasiado grande", objectOfSize(protocol.MaxSharedDataBytes + 1), bindings},
			{"bindings demasiado grandes", data, objectOfSize(protocol.MaxSharedBindingsBytes + 1)},
		}
		for _, tc := range cases {
			t.Run(tc.name, func(t *testing.T) {
				st := store.NewState()
				rev, perr := st.Put(0, tc.data, tc.bindings)
				if perr == nil || perr.Code != protocol.Internal || rev != 0 {
					t.Fatalf("Put = %d, %+v; want 0, internal", rev, perr)
				}
				if st.Revision != 0 || string(st.Data) != "null" || string(st.Bindings) != "{}" {
					t.Errorf("el fallo cambio el estado: %+v", st)
				}
			})
		}
	})
}
