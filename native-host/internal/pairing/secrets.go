// Package pairing implementa el emparejamiento de las instalaciones de la extensión con el host (pair.*) y la
// prueba de que cada instalación vive en el perfil que declara. Es lógica pura sobre store.State: no abre archivos,
// no bloquea ni lanza procesos (lo hace el router). Los secretos (token, código y nonce) solo se guardan como hash
// SHA-256 y se comparan en tiempo constante; ningún error repite un valor recibido.
package pairing

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
)

// secretBytes es la entropía de un token o un nonce: 256 bits (43 caracteres en base64url sin relleno).
const secretBytes = 32

// codeLimit es el mayor múltiplo de 10^6 que cabe en un uint32 (4294 · 10^6): los valores desde ahí se descartan
// para que los 10^6 códigos sean equiprobables.
const codeLimit = 4294000000

// HashSecret devuelve el SHA-256 de s en hexadecimal y minúsculas: lo único que se guarda de un token, un código o
// un nonce.
func HashSecret(s string) string {
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:])
}

// NewToken devuelve un token de 32 bytes de r en base64url sin relleno (43 caracteres).
func NewToken(r io.Reader) (string, error) { return newSecret(r) }

// NewNonce devuelve un nonce de 32 bytes de r en base64url sin relleno (43 caracteres).
func NewNonce(r io.Reader) (string, error) { return newSecret(r) }

func newSecret(r io.Reader) (string, error) {
	var b [secretBytes]byte
	if _, err := io.ReadFull(r, b[:]); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b[:]), nil
}

// NewCode devuelve 6 cifras equiprobables: descarta los valores >= 4294000000 (4294 · 10^6) para no sesgar.
func NewCode(r io.Reader) (string, error) {
	var b [4]byte
	for range 64 {
		if _, err := io.ReadFull(r, b[:]); err != nil {
			return "", err
		}
		n := binary.BigEndian.Uint32(b[:])
		if n < codeLimit {
			return fmt.Sprintf("%06d", n%1000000), nil
		}
	}
	return "", errors.New("pairing: aleatoriedad agotada")
}
