package store_test

import (
	"bytes"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/DanielSantos495/launcher/native-host/internal/jsonx"
	"github.com/DanielSantos495/launcher/native-host/internal/protocol"
	"github.com/DanielSantos495/launcher/native-host/internal/store"
)

// open abre el almacen de dir y lo cierra al terminar la prueba.
func open(t *testing.T, dir string) *store.Store {
	t.Helper()
	s, err := store.Open(dir, 5*time.Second)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { _ = s.Close() })
	return s
}

func readShared(t *testing.T, dir string) []byte {
	t.Helper()
	b, err := os.ReadFile(filepath.Join(dir, store.FileName))
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func writeShared(t *testing.T, dir string, content []byte) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(dir, store.FileName), content, 0o600); err != nil {
		t.Fatal(err)
	}
}

func perm(t *testing.T, path string) os.FileMode {
	t.Helper()
	fi, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	return fi.Mode().Perm()
}

// tempFiles lista los temporales ".shared-*.tmp" de dir.
func tempFiles(t *testing.T, dir string) []string {
	t.Helper()
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	var out []string
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), ".shared-") && strings.HasSuffix(e.Name(), ".tmp") {
			out = append(out, e.Name())
		}
	}
	return out
}

func TestLoadWithoutFile(t *testing.T) {
	s := open(t, t.TempDir())
	st, err := s.Load()
	if st != nil || err != nil {
		t.Fatalf("Load sin archivo = %v, %v; want nil, nil", st, err)
	}
}

func TestSaveLoadRoundTrip(t *testing.T) {
	for name, st := range map[string]*store.State{"nuevo": store.NewState(), "completo": validState()} {
		t.Run(name, func(t *testing.T) {
			dir := t.TempDir()
			s := open(t, dir)
			if err := s.Save(st); err != nil {
				t.Fatalf("Save: %v", err)
			}
			got, err := s.Load()
			if err != nil {
				t.Fatalf("Load: %v", err)
			}
			if !reflect.DeepEqual(got, st) {
				t.Errorf("Load = %+v, want %+v", got, st)
			}
			if string(got.Data) != string(st.Data) || string(got.Bindings) != string(st.Bindings) {
				t.Errorf("data %q / bindings %q, want %q / %q", got.Data, got.Bindings, st.Data, st.Bindings)
			}
			if p := perm(t, filepath.Join(dir, store.FileName)); p != 0o600 {
				t.Errorf("permisos de shared.json = %o, want 600", p)
			}
			if p := perm(t, filepath.Join(dir, store.LockName)); p != 0o600 {
				t.Errorf("permisos de shared.lock = %o, want 600", p)
			}
		})
	}
}

func TestSaveWritesWithoutEscapingHTML(t *testing.T) {
	dir := t.TempDir()
	s := open(t, dir)
	st := store.NewState()
	original := `{ "n" : "<a href=\"x\">&</a>",  "k" : [1,  2] }`
	st.Data = json.RawMessage(original)
	st.Bindings = json.RawMessage(`{"b": "x > y"}`)
	if err := s.Save(st); err != nil {
		t.Fatal(err)
	}
	file := readShared(t, dir)
	if !bytes.Contains(file, []byte(`"n":"<a href=\"x\">&</a>"`)) || !bytes.Contains(file, []byte(`"x > y"`)) {
		t.Errorf("el archivo debe llevar <, > y & literales: %s", file)
	}
	for _, escaped := range []string{esc("003c"), esc("003e"), esc("0026")} {
		if bytes.Contains(file, []byte(escaped)) {
			t.Errorf("el archivo escapo el HTML (%s): %s", escaped, file)
		}
	}
	if bytes.HasSuffix(file, []byte("\n")) {
		t.Error("el archivo no debe terminar en salto de linea")
	}
	got, err := s.Load()
	if err != nil {
		t.Fatal(err)
	}
	var want bytes.Buffer
	if err := json.Compact(&want, []byte(original)); err != nil {
		t.Fatal(err)
	}
	if string(got.Data) != want.String() {
		t.Errorf("Data = %q, want el valor compactado %q", got.Data, want.String())
	}
	if string(got.Bindings) != `{"b":"x > y"}` {
		t.Errorf("Bindings = %q", got.Bindings)
	}
}

// mustReplace cambia old por new en s y falla si old no estaba, para que cada caso toque lo que dice.
func mustReplace(t *testing.T, s, old, repl string) string {
	t.Helper()
	if !strings.Contains(s, old) {
		t.Fatalf("%q no aparece en el archivo base", old)
	}
	return strings.Replace(s, old, repl, 1)
}

func TestLoadRejects(t *testing.T) {
	dir := t.TempDir()
	s := open(t, dir)
	if err := s.Save(validState()); err != nil {
		t.Fatal(err)
	}
	base := string(readShared(t, dir))

	cases := []struct {
		name    string
		content string
	}{
		{"vacio", ""},
		{"json invalido", `{`},
		{"null", `null`},
		{"objeto vacio", `{}`},
		{"array", `[]`},
		{"campo desconocido", mustReplace(t, base, `{"format":1,`, `{"format":1,"extra":1,`)},
		{"campo desconocido anidado", mustReplace(t, base, `"inst-b"`, `"inst-b","extra":1`)},
		{"datos despues del valor", base + ` {}`},
		{"basura despues del valor", base + `x`},
		{"llave de cierre sobrante", base + `}`},
		{"formato 2", mustReplace(t, base, `"format":1`, `"format":2`)},
		{"revision negativa", mustReplace(t, base, `"revision":7`, `"revision":-1`)},
		{"revision con fraccion", mustReplace(t, base, `"revision":7`, `"revision":7.5`)},
		{"data array", mustReplace(t, base, `"data":{"containers"`, `"data":[{"containers"`)},
		{"sin bindings", mustReplace(t, base, `"bindings":{"c1":{"url":"https://example.com"}},`, ``)},
		{"bindings null", mustReplace(t, base, `"bindings":{"c1":{"url":"https://example.com"}}`, `"bindings":null`)},
		{"tipo equivocado", mustReplace(t, base, `"revision":7`, `"revision":"7"`)},
		{"hash en mayusculas", mustReplace(t, base, hash64("b"), strings.ToUpper(hash64("b")))},
		{"sustituto suelto en el data", mustReplace(t, base, `"name":"Trabajo"`, `"name":"`+esc("d800")+`"`)},
		{"utf8 invalido", mustReplace(t, base, `"name":"Trabajo"`, "\"name\":\"\xff\"")},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			writeShared(t, dir, []byte(tc.content))
			st, err := s.Load()
			if err == nil {
				t.Fatal("Load = nil, want error")
			}
			if st != nil {
				t.Errorf("con error Load no debe devolver estado: %+v", st)
			}
			// El error no repite el contenido del archivo.
			for _, secret := range []string{"extra", "inst-b", "Trabajo", "example.com"} {
				if strings.Contains(err.Error(), secret) {
					t.Errorf("el error repite contenido del archivo: %q", err)
				}
			}
		})
	}
}

func TestLoadFileSizeBoundary(t *testing.T) {
	dir := t.TempDir()
	s := open(t, dir)
	if err := s.Save(validState()); err != nil {
		t.Fatal(err)
	}
	base := readShared(t, dir)

	// Un estado valido rellenado con espacios al final hasta el maximo se lee; con un byte mas, no.
	writeShared(t, dir, slices.Concat(base, bytes.Repeat([]byte(" "), store.MaxFileBytes-len(base))))
	if _, err := s.Load(); err != nil {
		t.Errorf("Load de un archivo de exactamente %d bytes: %v", store.MaxFileBytes, err)
	}
	writeShared(t, dir, slices.Concat(base, bytes.Repeat([]byte(" "), store.MaxFileBytes-len(base)+1)))
	st, err := s.Load()
	if !errors.Is(err, jsonx.ErrFileTooLarge) || st != nil {
		t.Errorf("Load de un archivo de %d bytes = %v, %v; want nil, ErrFileTooLarge", store.MaxFileBytes+1, st, err)
	}
}

func TestLoadToleratesTrailingNewline(t *testing.T) {
	dir := t.TempDir()
	s := open(t, dir)
	if err := s.Save(validState()); err != nil {
		t.Fatal(err)
	}
	writeShared(t, dir, append(readShared(t, dir), '\n'))
	if _, err := s.Load(); err != nil {
		t.Errorf("Load con salto de linea final: %v", err)
	}
}

func TestLoadNormalizes(t *testing.T) {
	dir := t.TempDir()
	s := open(t, dir)
	// Sin "data", con listas null y con espacios dentro de los valores: el estado cargado es el canonico.
	writeShared(t, dir, []byte(`{"format":1,"revision":3,"bindings": { "a": 1 },"maxPairedProfiles":2,"paired":null,"pendingProofs":null}`))
	got, err := s.Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if string(got.Data) != "null" || string(got.Bindings) != `{"a":1}` {
		t.Errorf("Data %q, Bindings %q; want null y {\"a\":1}", got.Data, got.Bindings)
	}
	if got.Paired == nil || len(got.Paired) != 0 || got.PendingProofs == nil || len(got.PendingProofs) != 0 {
		t.Errorf("las listas null deben cargarse vacias y no nil: %+v", got)
	}
}

func TestSaveInvalidStateKeepsOldFile(t *testing.T) {
	dir := t.TempDir()
	s := open(t, dir)
	if err := s.Save(validState()); err != nil {
		t.Fatal(err)
	}
	before := readShared(t, dir)

	bad := validState()
	bad.Revision = 8
	bad.Paired[0].TokenHash = "xx"
	if err := s.Save(bad); err == nil {
		t.Fatal("Save de un estado invalido = nil, want error")
	}
	if after := readShared(t, dir); !bytes.Equal(after, before) {
		t.Errorf("el archivo anterior cambio:\n%s\n%s", before, after)
	}
	if tmp := tempFiles(t, dir); len(tmp) != 0 {
		t.Errorf("quedaron temporales: %v", tmp)
	}
}

func TestSaveIsAtomic(t *testing.T) {
	t.Run("un temporal huerfano no afecta a Load y Save no deja temporales", func(t *testing.T) {
		dir := t.TempDir()
		s := open(t, dir)
		orphan := filepath.Join(dir, ".shared-123.tmp")
		if err := os.WriteFile(orphan, []byte(`basura {{{`), 0o600); err != nil {
			t.Fatal(err)
		}
		if st, err := s.Load(); st != nil || err != nil {
			t.Fatalf("Load con solo un temporal huerfano = %v, %v; want nil, nil", st, err)
		}
		if err := s.Save(validState()); err != nil {
			t.Fatal(err)
		}
		if _, err := s.Load(); err != nil {
			t.Fatal(err)
		}
		if got := tempFiles(t, dir); !slices.Equal(got, []string{".shared-123.tmp"}) {
			t.Errorf("tras Save solo debe quedar el huerfano ajeno, hay %v", got)
		}
	})

	t.Run("Save de varias revisiones no deja temporales", func(t *testing.T) {
		dir := t.TempDir()
		s := open(t, dir)
		for rev := range int64(3) {
			st := validState()
			st.Revision = rev
			if err := s.Save(st); err != nil {
				t.Fatal(err)
			}
		}
		if tmp := tempFiles(t, dir); len(tmp) != 0 {
			t.Errorf("quedaron temporales: %v", tmp)
		}
	})

	t.Run("con la carpeta de solo lectura Save falla y el archivo anterior sigue igual", func(t *testing.T) {
		if os.Geteuid() == 0 {
			t.Skip("root ignora los permisos de la carpeta")
		}
		dir := t.TempDir()
		s := open(t, dir)
		if err := s.Save(validState()); err != nil {
			t.Fatal(err)
		}
		before := readShared(t, dir)

		if err := os.Chmod(dir, 0o500); err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = os.Chmod(dir, 0o700) })

		next := validState()
		next.Revision = 8
		next.Data = json.RawMessage(`{"nuevo":true}`)
		if err := s.Save(next); err == nil {
			t.Fatal("Save en una carpeta 0500 = nil, want error")
		}
		if after := readShared(t, dir); !bytes.Equal(after, before) {
			t.Errorf("el archivo anterior cambio:\n%s\n%s", before, after)
		}
		if tmp := tempFiles(t, dir); len(tmp) != 0 {
			t.Errorf("quedaron temporales: %v", tmp)
		}
	})
}

func TestConcurrentWriters(t *testing.T) {
	const n = 20
	dir := t.TempDir()
	var wg sync.WaitGroup
	var mu sync.Mutex
	var revisions []int64
	failures := make(chan string, n)
	for range n {
		wg.Add(1)
		go func() {
			defer wg.Done()
			s, err := store.Open(dir, 5*time.Second)
			if err != nil {
				failures <- "Open: " + err.Error()
				return
			}
			defer s.Close()
			st, err := s.Load()
			if err != nil {
				failures <- "Load: " + err.Error()
				return
			}
			if st == nil {
				st = store.NewState()
			}
			// Una pausa dentro de la seccion critica ensancha la ventana: sin el bloqueo, los demas leen la misma revision.
			time.Sleep(2 * time.Millisecond)
			rev, perr := st.Put(st.Revision, json.RawMessage(`{"w":1}`), json.RawMessage(`{}`))
			if perr != nil {
				failures <- "Put: " + perr.Error()
				return
			}
			if err := s.Save(st); err != nil {
				failures <- "Save: " + err.Error()
				return
			}
			mu.Lock()
			revisions = append(revisions, rev)
			mu.Unlock()
		}()
	}
	wg.Wait()
	close(failures)
	for f := range failures {
		t.Errorf("fallo en una escritora: %s", f)
	}

	s := open(t, dir)
	st, err := s.Load()
	if err != nil || st == nil {
		t.Fatalf("Load final = %v, %v", st, err)
	}
	if st.Revision != n {
		t.Errorf("revision final = %d, want %d", st.Revision, n)
	}
	slices.Sort(revisions)
	want := make([]int64, n)
	for i := range want {
		want[i] = int64(i + 1)
	}
	if !slices.Equal(revisions, want) {
		t.Errorf("revisiones obtenidas = %v, want 1..%d sin repetir", revisions, n)
	}
}

func TestLock(t *testing.T) {
	t.Run("con el almacen abierto otro Open espera el plazo y devuelve ErrLocked", func(t *testing.T) {
		dir := t.TempDir()
		_ = open(t, dir)
		start := time.Now()
		s, err := store.Open(dir, 100*time.Millisecond)
		elapsed := time.Since(start)
		if s != nil || !errors.Is(err, store.ErrLocked) {
			t.Fatalf("Open = %v, %v; want nil, ErrLocked", s, err)
		}
		if elapsed < 100*time.Millisecond {
			t.Errorf("Open espero %v, menos que el plazo de 100ms", elapsed)
		}
	})

	t.Run("tras Close, Open funciona", func(t *testing.T) {
		dir := t.TempDir()
		first, err := store.Open(dir, time.Second)
		if err != nil {
			t.Fatal(err)
		}
		if err := first.Close(); err != nil {
			t.Fatal(err)
		}
		second, err := store.Open(dir, 100*time.Millisecond)
		if err != nil {
			t.Fatalf("Open tras Close: %v", err)
		}
		_ = second.Close()
	})

	t.Run("un Open en espera entra cuando se suelta el bloqueo", func(t *testing.T) {
		dir := t.TempDir()
		first, err := store.Open(dir, time.Second)
		if err != nil {
			t.Fatal(err)
		}
		go func() {
			time.Sleep(60 * time.Millisecond)
			_ = first.Close()
		}()
		second, err := store.Open(dir, 5*time.Second)
		if err != nil {
			t.Fatalf("Open en espera: %v", err)
		}
		_ = second.Close()
	})

	t.Run("plazo cero: un solo intento", func(t *testing.T) {
		dir := t.TempDir()
		_ = open(t, dir)
		if _, err := store.Open(dir, 0); !errors.Is(err, store.ErrLocked) {
			t.Errorf("Open con plazo 0 = %v, want ErrLocked", err)
		}
	})

	t.Run("carpeta inexistente", func(t *testing.T) {
		s, err := store.Open(filepath.Join(t.TempDir(), "no-existe"), time.Second)
		if s != nil || err == nil || errors.Is(err, store.ErrLocked) {
			t.Errorf("Open = %v, %v; want nil y un error que no es ErrLocked", s, err)
		}
	})

	t.Run("Close es idempotente y tras Close nada funciona", func(t *testing.T) {
		dir := t.TempDir()
		s, err := store.Open(dir, time.Second)
		if err != nil {
			t.Fatal(err)
		}
		if err := s.Close(); err != nil {
			t.Fatal(err)
		}
		if err := s.Close(); err != nil {
			t.Errorf("segundo Close = %v, want nil", err)
		}
		if st, err := s.Load(); st != nil || err == nil {
			t.Errorf("Load tras Close = %v, %v; want nil y error", st, err)
		}
		if err := s.Save(store.NewState()); err == nil {
			t.Error("Save tras Close = nil, want error")
		}
		if _, err := os.Stat(filepath.Join(dir, store.FileName)); err == nil {
			t.Error("Save tras Close escribio el archivo")
		}
		if _, _, err := s.GetIcon("icon:a"); err == nil {
			t.Error("GetIcon tras Close = nil, want error")
		}
		if perr := s.PutIcon("icon:a", store.Icon{Mime: "image/png", Base64: "AAAA"}); perr == nil || perr.Code != protocol.Internal {
			t.Errorf("PutIcon tras Close = %v, want internal", perr)
		}
		if err := s.DeleteIcon("icon:a"); err == nil {
			t.Error("DeleteIcon tras Close = nil, want error")
		}
	})
}
