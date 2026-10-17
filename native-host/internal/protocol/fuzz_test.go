package protocol_test

import (
	"encoding/json"
	"net/url"
	"reflect"
	"slices"
	"strings"
	"testing"

	"github.com/DanielSantos495/launcher/native-host/internal/protocol"
)

// FuzzValidate: Validate no entra en panico, es determinista y lo que acepta cumple los formatos del contrato.
func FuzzValidate(f *testing.F) {
	for _, c := range loadRequestCases(f) {
		f.Add([]byte(c.Request))
	}
	f.Add([]byte(pingBody))
	f.Add([]byte(putBody(okData, `{}`)))
	f.Add([]byte(putBody(`{ "schemaVersion" : 1 , "revision" : 0 }`, `{ "a" : {} }`)))
	f.Add([]byte(tempBody(`"` + esc("d83c") + esc("dfa8") + `"`)))
	f.Add([]byte(`{"v":2,"v":1,"cmd":"ping","args":{}}`))
	f.Add([]byte(iconBody("AAAA")))
	f.Add([]byte("\xff"))
	f.Add([]byte(""))

	f.Fuzz(func(t *testing.T, body []byte) {
		req1, err1 := protocol.Validate(body)
		req2, err2 := protocol.Validate(body)
		if (err1 == nil) != (err2 == nil) || (err1 != nil && *err1 != *err2) || !reflect.DeepEqual(req1, req2) {
			t.Fatalf("dos llamadas dan resultados distintos")
		}

		if err1 != nil {
			if !slices.Contains(protocol.AllCodes, err1.Code) || err1.Revision != 0 || err1.Error() != string(err1.Code) {
				t.Fatalf("error no valido: %+v", *err1)
			}
			if !reflect.DeepEqual(req1, protocol.Request{}) {
				t.Fatalf("con error la peticion debe quedar vacia")
			}
			return
		}

		// Aceptada: el comando es conocido, el cuerpo cabe y cada campo presente cumple su formato.
		if len(body) > protocol.MaxRequestBytes {
			t.Fatalf("acepta un cuerpo de %d bytes", len(body))
		}
		if !slices.Contains(protocol.Commands, req1.Cmd) {
			t.Fatalf("comando no conocido: %q", req1.Cmd)
		}
		if req1.URL != "" && !protocol.ValidURL(req1.URL) {
			t.Fatalf("URL fuera de G aceptada")
		}
		checks := []struct {
			value string
			valid func(string) bool
		}{
			{req1.ProfileDirectory, protocol.ValidProfileDirectory},
			{req1.Name, protocol.ValidContainerName},
			{req1.InstallationID, protocol.ValidID},
			{req1.IdentityID, protocol.ValidID},
			{req1.Token, protocol.ValidToken},
			{req1.Code, protocol.ValidCode},
			{req1.Nonce, protocol.ValidNonce},
			{req1.Key, protocol.ValidIconKey},
			{req1.Mime, protocol.ValidMime},
			{req1.Base64, protocol.ValidBase64},
		}
		for i, c := range checks {
			if c.value != "" && !c.valid(c.value) {
				t.Fatalf("campo %d aceptado con formato no valido: %q", i, c.value)
			}
		}
		if req1.BaseRevision < 0 || req1.BaseRevision > protocol.MaxSafeInteger {
			t.Fatalf("BaseRevision fuera de rango: %d", req1.BaseRevision)
		}
		if req1.Cmd == "sync.put" {
			if len(req1.Data) > protocol.MaxSharedDataBytes || len(req1.Bindings) > protocol.MaxSharedBindingsBytes {
				t.Fatalf("data o bindings por encima del tope")
			}
			if !json.Valid(req1.Data) || !json.Valid(req1.Bindings) || req1.Data[0] != '{' || req1.Bindings[0] != '{' {
				t.Fatalf("data o bindings no son objetos JSON")
			}
		} else if req1.Data != nil || req1.Bindings != nil {
			t.Fatalf("%s no lleva data ni bindings", req1.Cmd)
		}
	})
}

// FuzzValidURL: lo que esta en G es ASCII imprimible, corto, http(s) y lo acepta url.Parse.
func FuzzValidURL(f *testing.F) {
	for _, c := range loadRequestCases(f) {
		var env struct {
			Args struct {
				URL string `json:"url"`
			} `json:"args"`
		}
		if json.Unmarshal(c.Request, &env) == nil && env.Args.URL != "" {
			f.Add(env.Args.URL)
		}
	}
	for _, s := range []string{
		"https://github.com/", "http://example.com:8443/a?b#c", "https://example.com/%7e", "https://xn--a.example/",
		"https://0.0.0.0/", "https://example.com./", "https://example.com/#a?b", "", "https://", "%", "https://a/%",
		"https://" + strings.Repeat("a", 70) + "/",
	} {
		f.Add(s)
	}

	f.Fuzz(func(t *testing.T, s string) {
		if !protocol.ValidURL(s) {
			return
		}
		if len(s) > protocol.MaxURLLength {
			t.Fatalf("URL de %d bytes", len(s))
		}
		if !strings.HasPrefix(s, "https://") && !strings.HasPrefix(s, "http://") {
			t.Fatalf("esquema no permitido: %q", s)
		}
		for i := 0; i < len(s); i++ {
			if s[i] < 0x21 || s[i] > 0x7e {
				t.Fatalf("byte no imprimible 0x%02x en %q", s[i], s)
			}
		}
		if _, err := url.Parse(s); err != nil {
			t.Fatalf("url.Parse rechaza una URL de G: %q: %v", s, err)
		}
	})
}
