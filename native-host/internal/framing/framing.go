// Package framing implementa el marco de la mensajería nativa de Chromium: cuatro bytes con la longitud del
// cuerpo, en el orden de bytes nativo, seguidos del cuerpo (JSON en UTF-8).
package framing

import (
	"encoding/binary"
	"errors"
	"io"
	"math"
)

// headerSize es el tamaño del prefijo de longitud.
const headerSize = 4

// ErrTooLarge indica que un mensaje supera el máximo permitido.
var ErrTooLarge = errors.New("framing: mensaje demasiado grande")

// ReadMessage lee 4 bytes de longitud en el orden nativo (binary.NativeEndian, como Chromium) y el cuerpo.
// Con longitud > max devuelve ErrTooLarge SIN leer el cuerpo (ni reservar memoria para él). Sin ningún byte:
// io.EOF. Cabecera o cuerpo incompletos: io.ErrUnexpectedEOF. Con longitud 0 devuelve un cuerpo vacío no nil.
func ReadMessage(r io.Reader, max uint32) ([]byte, error) {
	var header [headerSize]byte
	// io.ReadFull devuelve io.EOF solo si no llegó ningún byte e io.ErrUnexpectedEOF si la cabecera quedó a medias.
	if _, err := io.ReadFull(r, header[:]); err != nil {
		return nil, err
	}
	n := binary.NativeEndian.Uint32(header[:])
	if n > max {
		return nil, ErrTooLarge
	}
	body := make([]byte, n)
	if _, err := io.ReadFull(r, body); err != nil {
		// Con la cabecera ya leída, un cuerpo sin ningún byte también es un marco incompleto.
		if errors.Is(err, io.EOF) {
			err = io.ErrUnexpectedEOF
		}
		return nil, err
	}
	return body, nil
}

// WriteMessage escribe longitud + cuerpo en una sola llamada a w.Write (Chromium lee el marco entero).
// len(body) > max → ErrTooLarge sin escribir nada.
func WriteMessage(w io.Writer, body []byte, max int) error {
	// La segunda condición protege la conversión a uint32 si el llamador pasara un máximo mayor que 4 GiB - 1.
	if len(body) > max || uint64(len(body)) > math.MaxUint32 {
		return ErrTooLarge
	}
	buf := make([]byte, headerSize+len(body))
	binary.NativeEndian.PutUint32(buf, uint32(len(body)))
	copy(buf[headerSize:], body)
	n, err := w.Write(buf)
	if err != nil {
		return err
	}
	if n < len(buf) {
		return io.ErrShortWrite
	}
	return nil
}
