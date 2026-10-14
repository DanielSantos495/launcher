package pairing_test

import (
	"bytes"
	"encoding/binary"
	"errors"
	"io"
	"strings"
	"testing"

	"github.com/DanielSantos495/launcher/native-host/internal/pairing"
	"github.com/DanielSantos495/launcher/native-host/internal/protocol"
)

// zeros es un lector que siempre devuelve bytes 0.
type zeros struct{}

func (zeros) Read(p []byte) (int, error) {
	clear(p)
	return len(p), nil
}

// errRand es el error del lector roto.
var errRand = errors.New("aleatoriedad rota")

// failing es un lector que siempre falla.
type failing struct{}

func (failing) Read([]byte) (int, error) { return 0, errRand }

// be32 escribe cada valor como 4 bytes big-endian seguidos.
func be32(values ...uint32) io.Reader {
	var buf []byte
	for _, v := range values {
		buf = binary.BigEndian.AppendUint32(buf, v)
	}
	return bytes.NewReader(buf)
}

func TestHashSecret(t *testing.T) {
	const want = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
	if got := pairing.HashSecret("abc"); got != want {
		t.Fatalf("HashSecret(abc) = %s, quiero %s", got, want)
	}
}

func TestNewToken(t *testing.T) {
	tok, err := pairing.NewToken(zeros{})
	if err != nil {
		t.Fatal(err)
	}
	if want := strings.Repeat("A", 43); tok != want {
		t.Fatalf("token con ceros = %q, quiero %q", tok, want)
	}
	if !protocol.ValidToken(tok) {
		t.Fatal("el token no cumple ValidToken")
	}

	// Alfabeto URL sin relleno: 0xfb repetido da "-" y "_" (nunca "+", "/" ni "=").
	tok, err = pairing.NewToken(bytes.NewReader(bytes.Repeat([]byte{0xfb}, 32)))
	if err != nil {
		t.Fatal(err)
	}
	if want := strings.Repeat("-_v7", 10) + "-_s"; tok != want {
		t.Fatalf("token con 0xfb = %q, quiero %q", tok, want)
	}
	if !protocol.ValidToken(tok) {
		t.Fatal("el token con 0xfb no cumple ValidToken")
	}

	// Necesita 32 bytes enteros.
	if _, err := pairing.NewToken(bytes.NewReader(make([]byte, 31))); !errors.Is(err, io.ErrUnexpectedEOF) {
		t.Fatalf("con 31 bytes: error %v, quiero io.ErrUnexpectedEOF", err)
	}
	if _, err := pairing.NewToken(failing{}); !errors.Is(err, errRand) {
		t.Fatalf("con un lector roto: error %v, quiero el del lector", err)
	}
}

func TestNewNonce(t *testing.T) {
	nonce, err := pairing.NewNonce(zeros{})
	if err != nil {
		t.Fatal(err)
	}
	if want := strings.Repeat("A", 43); nonce != want {
		t.Fatalf("nonce con ceros = %q, quiero %q", nonce, want)
	}
	if !protocol.ValidNonce(nonce) {
		t.Fatal("el nonce no cumple ValidNonce")
	}
	if _, err := pairing.NewNonce(failing{}); !errors.Is(err, errRand) {
		t.Fatalf("con un lector roto: error %v, quiero el del lector", err)
	}
}

func TestNewCode(t *testing.T) {
	cases := []struct {
		name string
		r    io.Reader
		want string
	}{
		{"42", be32(0x2a), "000042"},
		{"cero", be32(0), "000000"},
		{"ff ff ff ff se descarta", be32(0xffffffff, 999999), "999999"},
		// Frontera del rechazo por los dos lados: 4293999999 vale y 4294000000 se descarta.
		{"4293999999 vale", be32(4293999999, 7), "999999"},
		{"4294000000 se descarta", be32(4294000000, 7), "000007"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := pairing.NewCode(tc.r)
			if err != nil {
				t.Fatal(err)
			}
			if got != tc.want {
				t.Fatalf("NewCode = %q, quiero %q", got, tc.want)
			}
			if !protocol.ValidCode(got) {
				t.Fatalf("%q no cumple ValidCode", got)
			}
		})
	}
}

func TestNewCodeErrors(t *testing.T) {
	if _, err := pairing.NewCode(failing{}); !errors.Is(err, errRand) {
		t.Fatalf("con un lector roto: error %v, quiero el del lector", err)
	}
	if _, err := pairing.NewCode(bytes.NewReader([]byte{0, 0, 0})); !errors.Is(err, io.ErrUnexpectedEOF) {
		t.Fatalf("con 3 bytes: error %v, quiero io.ErrUnexpectedEOF", err)
	}

	// 63 descartes seguidos todavia dejan un intento; 64 agotan los intentos sin leer el siguiente valor.
	rejected := func(n int, last uint32) io.Reader {
		values := make([]uint32, 0, n+1)
		for range n {
			values = append(values, 0xffffffff)
		}
		return be32(append(values, last)...)
	}
	got, err := pairing.NewCode(rejected(63, 5))
	if err != nil || got != "000005" {
		t.Fatalf("63 descartes: %q, %v; quiero 000005", got, err)
	}
	if got, err := pairing.NewCode(rejected(64, 5)); err == nil {
		t.Fatalf("64 descartes: %q sin error", got)
	}
}
