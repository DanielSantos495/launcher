package framing_test

import (
	"bytes"
	"encoding/binary"
	"errors"
	"io"
	"testing"

	"github.com/DanielSantos495/launcher/native-host/internal/framing"
)

// frame construye un marco con la longitud n (en orden nativo, como Chromium) seguida de body.
// n y body son independientes para poder fabricar marcos que mienten sobre su longitud.
func frame(n uint32, body []byte) []byte {
	out := make([]byte, 4, 4+len(body))
	binary.NativeEndian.PutUint32(out, n)
	return append(out, body...)
}

func TestReadMessage(t *testing.T) {
	const oneMiB = 1048576

	tests := []struct {
		name string
		in   []byte
		max  uint32
		want []byte
		err  error
		// left es lo que debe quedar sin leer en el lector (solo se comprueba si checkLeft).
		checkLeft bool
		left      int
	}{
		{name: "vacio", in: []byte{}, max: 1024, err: io.EOF},
		{name: "cabecera de 1 byte", in: []byte{5}, max: 1024, err: io.ErrUnexpectedEOF},
		{name: "cabecera corta (3 bytes)", in: []byte{5, 0, 0}, max: 1024, err: io.ErrUnexpectedEOF},
		{name: "longitud 0", in: []byte{0, 0, 0, 0}, max: 1024, want: []byte{}},
		{name: "normal", in: frame(5, []byte("hello")), max: 1024, want: []byte("hello")},
		{name: "cuerpo corto", in: frame(5, []byte("hel")), max: 1024, err: io.ErrUnexpectedEOF},
		{name: "cuerpo ausente", in: frame(5, nil), max: 1024, err: io.ErrUnexpectedEOF},
		{
			name: "maximo exacto",
			in:   frame(8, []byte("12345678")),
			max:  8,
			want: []byte("12345678"),
		},
		{
			name:      "maximo + 1 no lee el cuerpo",
			in:        frame(9, []byte("123456789")),
			max:       8,
			err:       framing.ErrTooLarge,
			checkLeft: true,
			left:      9,
		},
		{
			name: "1 MiB exacto",
			in:   frame(oneMiB, bytes.Repeat([]byte("a"), oneMiB)),
			max:  oneMiB,
			want: bytes.Repeat([]byte("a"), oneMiB),
		},
		{
			name:      "1 MiB + 1 no lee el cuerpo",
			in:        frame(oneMiB+1, bytes.Repeat([]byte("a"), oneMiB+1)),
			max:       oneMiB,
			err:       framing.ErrTooLarge,
			checkLeft: true,
			left:      oneMiB + 1,
		},
		{
			name:      "longitud enorme sin cuerpo no reserva memoria",
			in:        []byte{0xff, 0xff, 0xff, 0xff},
			max:       oneMiB,
			err:       framing.ErrTooLarge,
			checkLeft: true,
			left:      0,
		},
		{
			name:      "sobrante: lo demas no se lee",
			in:        frame(2, []byte("abXYZ")),
			max:       1024,
			want:      []byte("ab"),
			checkLeft: true,
			left:      3,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			r := bytes.NewReader(tc.in)
			got, err := framing.ReadMessage(r, tc.max)
			if !errors.Is(err, tc.err) {
				t.Fatalf("error = %v, quiero %v", err, tc.err)
			}
			if tc.err != nil {
				if got != nil {
					t.Errorf("con error el cuerpo debe ser nil, no %q", got)
				}
			} else {
				if got == nil {
					t.Fatalf("sin error el cuerpo no puede ser nil")
				}
				if !bytes.Equal(got, tc.want) {
					t.Errorf("cuerpo = %q, quiero %q", got, tc.want)
				}
			}
			if tc.checkLeft && r.Len() != tc.left {
				t.Errorf("quedan %d bytes sin leer, quiero %d", r.Len(), tc.left)
			}
		})
	}
}

// El marco usa el orden de bytes nativo: la longitud 5 se escribe 05 00 00 00 en little-endian.
func TestReadMessageUsesNativeByteOrder(t *testing.T) {
	var header [4]byte
	binary.NativeEndian.PutUint32(header[:], 5)
	got, err := framing.ReadMessage(bytes.NewReader(append(header[:], "hello"...)), 1024)
	if err != nil {
		t.Fatalf("error inesperado: %v", err)
	}
	if string(got) != "hello" {
		t.Errorf("cuerpo = %q, quiero %q", got, "hello")
	}
}

// writerFunc adapta una función a io.Writer.
type writerFunc func(p []byte) (int, error)

func (f writerFunc) Write(p []byte) (int, error) { return f(p) }

func TestWriteMessage(t *testing.T) {
	t.Run("escribe longitud + cuerpo", func(t *testing.T) {
		var buf bytes.Buffer
		if err := framing.WriteMessage(&buf, []byte("hello"), 1024); err != nil {
			t.Fatalf("error inesperado: %v", err)
		}
		want := make([]byte, 4, 9)
		binary.NativeEndian.PutUint32(want, 5)
		want = append(want, "hello"...)
		if !bytes.Equal(buf.Bytes(), want) {
			t.Errorf("escrito %v, quiero %v", buf.Bytes(), want)
		}
	})

	t.Run("una sola llamada a Write", func(t *testing.T) {
		calls := 0
		var written []byte
		w := writerFunc(func(p []byte) (int, error) {
			calls++
			written = append(written, p...)
			return len(p), nil
		})
		if err := framing.WriteMessage(w, []byte("hello"), 1024); err != nil {
			t.Fatalf("error inesperado: %v", err)
		}
		if calls != 1 {
			t.Errorf("Write llamado %d veces, quiero 1", calls)
		}
		if len(written) != 9 {
			t.Errorf("escritos %d bytes, quiero 9", len(written))
		}
	})

	t.Run("cuerpo vacio", func(t *testing.T) {
		var buf bytes.Buffer
		if err := framing.WriteMessage(&buf, nil, 1024); err != nil {
			t.Fatalf("error inesperado: %v", err)
		}
		if !bytes.Equal(buf.Bytes(), []byte{0, 0, 0, 0}) {
			t.Errorf("escrito %v, quiero cuatro ceros", buf.Bytes())
		}
	})

	t.Run("len(body) == max escribe", func(t *testing.T) {
		var buf bytes.Buffer
		if err := framing.WriteMessage(&buf, []byte("12345678"), 8); err != nil {
			t.Fatalf("error inesperado: %v", err)
		}
		if buf.Len() != 12 {
			t.Errorf("escritos %d bytes, quiero 12", buf.Len())
		}
	})

	t.Run("max + 1 es ErrTooLarge y no escribe nada", func(t *testing.T) {
		var buf bytes.Buffer
		err := framing.WriteMessage(&buf, []byte("123456789"), 8)
		if !errors.Is(err, framing.ErrTooLarge) {
			t.Fatalf("error = %v, quiero ErrTooLarge", err)
		}
		if buf.Len() != 0 {
			t.Errorf("el buffer debe quedar vacio, tiene %d bytes", buf.Len())
		}
	})

	t.Run("max negativo es ErrTooLarge", func(t *testing.T) {
		var buf bytes.Buffer
		err := framing.WriteMessage(&buf, nil, -1)
		if !errors.Is(err, framing.ErrTooLarge) {
			t.Fatalf("error = %v, quiero ErrTooLarge", err)
		}
		if buf.Len() != 0 {
			t.Errorf("el buffer debe quedar vacio, tiene %d bytes", buf.Len())
		}
	})

	t.Run("devuelve el error del escritor", func(t *testing.T) {
		boom := errors.New("tuberia rota")
		w := writerFunc(func([]byte) (int, error) { return 0, boom })
		if err := framing.WriteMessage(w, []byte("hello"), 1024); !errors.Is(err, boom) {
			t.Errorf("error = %v, quiero %v", err, boom)
		}
	})

	t.Run("escritura corta sin error es io.ErrShortWrite", func(t *testing.T) {
		w := writerFunc(func(p []byte) (int, error) { return len(p) - 1, nil })
		if err := framing.WriteMessage(w, []byte("hello"), 1024); !errors.Is(err, io.ErrShortWrite) {
			t.Errorf("error = %v, quiero io.ErrShortWrite", err)
		}
	})
}

func TestRoundTrip(t *testing.T) {
	bodies := [][]byte{
		{},
		[]byte("hello"),
		[]byte(`{"v":1,"cmd":"ping","args":{}}`),
		bytes.Repeat([]byte("<>&"), 1000),
	}
	for _, body := range bodies {
		var buf bytes.Buffer
		if err := framing.WriteMessage(&buf, body, 1<<20); err != nil {
			t.Fatalf("WriteMessage: %v", err)
		}
		got, err := framing.ReadMessage(&buf, 1<<20)
		if err != nil {
			t.Fatalf("ReadMessage: %v", err)
		}
		if !bytes.Equal(got, body) {
			t.Errorf("ida y vuelta distinta: %q != %q", got, body)
		}
		if buf.Len() != 0 {
			t.Errorf("quedan %d bytes sin leer", buf.Len())
		}
	}
}

// Dos marcos seguidos se leen uno a uno.
func TestReadMessageSequence(t *testing.T) {
	var buf bytes.Buffer
	for _, body := range []string{"uno", "dos"} {
		if err := framing.WriteMessage(&buf, []byte(body), 1024); err != nil {
			t.Fatalf("WriteMessage: %v", err)
		}
	}
	for _, want := range []string{"uno", "dos"} {
		got, err := framing.ReadMessage(&buf, 1024)
		if err != nil || string(got) != want {
			t.Fatalf("ReadMessage = %q, %v; quiero %q", got, err, want)
		}
	}
	if _, err := framing.ReadMessage(&buf, 1024); !errors.Is(err, io.EOF) {
		t.Errorf("tras el ultimo marco: error = %v, quiero io.EOF", err)
	}
}

func FuzzReadMessage(f *testing.F) {
	f.Add([]byte{})
	f.Add([]byte{5, 0, 0})
	f.Add([]byte{0, 0, 0, 0})
	f.Add(frame(5, []byte("hello")))
	f.Add(frame(5, []byte("hel")))
	f.Add(frame(2, []byte("abXYZ")))
	f.Add(frame(1024, bytes.Repeat([]byte("a"), 1024)))
	f.Add(frame(1025, bytes.Repeat([]byte("a"), 1025)))
	f.Add([]byte{0xff, 0xff, 0xff, 0xff})

	f.Fuzz(func(t *testing.T, data []byte) {
		const max = 1024
		body, err := framing.ReadMessage(bytes.NewReader(data), max)
		if err != nil {
			if body != nil {
				t.Fatalf("con error el cuerpo debe ser nil")
			}
			return
		}
		if len(body) > max {
			t.Fatalf("cuerpo de %d bytes, mas que el maximo %d", len(body), max)
		}
		if got := binary.NativeEndian.Uint32(data[:4]); got != uint32(len(body)) {
			t.Fatalf("la cabecera dice %d y el cuerpo mide %d", got, len(body))
		}
		if !bytes.Equal(body, data[4:4+len(body)]) {
			t.Fatalf("el cuerpo no es data[4:4+n]")
		}
	})
}
