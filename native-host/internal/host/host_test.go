package host

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"encoding/json"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/DanielSantos495/launcher/native-host/internal/caller"
	"github.com/DanielSantos495/launcher/native-host/internal/launch"
	"github.com/DanielSantos495/launcher/native-host/internal/protocol"
)

// t0 es la hora fija de las pruebas: 2026-10-08T12:00:00.000Z.
var t0 = time.Date(2026, 10, 8, 12, 0, 0, 0, time.UTC)

// testExtensionID cumple ^[a-p]{32}$.
const testExtensionID = "abcdefghijklmnopabcdefghijklmnop"

// browserExe es la ruta (falsa, nunca se ejecuta) del navegador configurado.
const browserExe = "/Applications/Fake Browser.app/Contents/MacOS/Fake Browser"

// unknownToken tiene el formato de un token pero no es de nadie.
var unknownToken = strings.Repeat("Z", 43)

type call struct {
	exe  string
	args []string
}

// fakeStarter apunta las llamadas y puede fallar. onStart se ejecuta en cada llamada (antes de devolver err).
type fakeStarter struct {
	calls   []call
	err     error
	onStart func(exe string, args []string)
}

func (f *fakeStarter) Start(exe string, args []string) error {
	f.calls = append(f.calls, call{exe: exe, args: slices.Clone(args)})
	if f.onStart != nil {
		f.onStart(exe, args)
	}
	return f.err
}

// detRand es una aleatoriedad determinista e infinita: SHA-256 de 0, 1, 2, ... seguidos.
type detRand struct {
	n   uint64
	buf []byte
}

func (r *detRand) Read(p []byte) (int, error) {
	for len(r.buf) < len(p) {
		sum := sha256.Sum256(binary.BigEndian.AppendUint64(nil, r.n))
		r.n++
		r.buf = append(r.buf, sum[:]...)
	}
	n := copy(p, r.buf)
	r.buf = r.buf[n:]
	return n, nil
}

// testEnv es el entorno de una prueba: copia de testdata/macos como userDataDir, una carpeta de datos vacía, reloj
// fijo (now, que la prueba puede mover), aleatoriedad determinista y un lanzador falso.
type testEnv struct {
	t       *testing.T
	env     Env
	now     time.Time
	starter *fakeStarter
	userDir string
	dataDir string
}

// newEnv prepara el entorno. lastVersion "" borra el archivo Last Version.
func newEnv(t *testing.T, browser, lastVersion string) *testEnv {
	t.Helper()
	te := &testEnv{t: t, now: t0, starter: &fakeStarter{}, userDir: t.TempDir(), dataDir: t.TempDir()}
	copyTree(t, filepath.Join("..", "..", "testdata", "macos"), te.userDir)
	lv := filepath.Join(te.userDir, "Last Version")
	if lastVersion == "" {
		if err := os.Remove(lv); err != nil {
			t.Fatal(err)
		}
	} else if err := os.WriteFile(lv, []byte(lastVersion+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	te.env = Env{
		Config: caller.Config{
			Browser: browser, Exe: browserExe, UserDataDir: te.userDir, ExtensionID: testExtensionID,
			BinarySHA256: strings.Repeat("0", 64),
		},
		DataDir:     te.dataDir,
		Version:     "0.1.0",
		Now:         func() time.Time { return te.now },
		Rand:        &detRand{},
		Starter:     te.starter,
		Exists:      launch.PathExists,
		LockTimeout: time.Second,
	}
	return te
}

func copyTree(t *testing.T, src, dst string) {
	t.Helper()
	err := filepath.WalkDir(src, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(src, path)
		if err != nil {
			return err
		}
		target := filepath.Join(dst, rel)
		if d.IsDir() {
			return os.MkdirAll(target, 0o700)
		}
		b, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		return os.WriteFile(target, b, 0o600)
	})
	if err != nil {
		t.Fatal(err)
	}
}

// request arma el cuerpo de una petición.
func request(cmd, args string) string {
	return `{"v":1,"cmd":"` + cmd + `","args":` + args + `}`
}

// handle valida el cuerpo con el validador real y lo pasa al router.
func (te *testEnv) handle(body string) protocol.Response {
	te.t.Helper()
	req, perr := protocol.Validate([]byte(body))
	if perr != nil {
		te.t.Fatalf("la petición de la prueba no es válida (%s): %.200s", perr.Code, body)
	}
	return Handle(te.env, req)
}

// do ejecuta una petición y devuelve la respuesta tal como saldría por stdout. Comprueba además que ninguna
// respuesta lleva rutas de las carpetas de la prueba.
func (te *testEnv) do(cmd, args string) string {
	te.t.Helper()
	out := string(protocol.Encode(te.handle(request(cmd, args))))
	for _, dir := range []string{te.userDir, te.dataDir} {
		if strings.Contains(out, dir) {
			te.t.Fatalf("la respuesta de %s lleva una ruta de la prueba: %.200s", cmd, out)
		}
	}
	return out
}

// result comprueba que la respuesta es correcta y devuelve el objeto result.
func result(t *testing.T, body string) map[string]json.RawMessage {
	t.Helper()
	var env struct {
		OK     bool                       `json:"ok"`
		Result map[string]json.RawMessage `json:"result"`
	}
	if err := json.Unmarshal([]byte(body), &env); err != nil || !env.OK {
		t.Fatalf("se esperaba una respuesta correcta: %.300s", body)
	}
	return env.Result
}

// str devuelve el campo de texto name de un result.
func str(t *testing.T, res map[string]json.RawMessage, name string) string {
	t.Helper()
	var s string
	if err := json.Unmarshal(res[name], &s); err != nil {
		t.Fatalf("el campo %s no es un texto: %s", name, res[name])
	}
	return s
}

// errBody es la respuesta de error de un código.
func errBody(code string) string {
	return `{"ok":false,"error":{"code":"` + code + `"}}`
}

const okEmpty = `{"ok":true,"result":{}}`

func (te *testEnv) wantCalls(want ...call) {
	te.t.Helper()
	if len(te.starter.calls) != len(want) {
		te.t.Fatalf("llamadas al lanzador = %v, quiero %v", te.starter.calls, want)
	}
	for i, c := range want {
		if te.starter.calls[i].exe != c.exe || !slices.Equal(te.starter.calls[i].args, c.args) {
			te.t.Fatalf("llamada %d = %v, quiero %v", i, te.starter.calls[i], c)
		}
	}
}

func TestPing(t *testing.T) {
	const (
		braveOK = `{"ok":true,"result":{"hostVersion":"0.1.0","protocol":1,"browser":"brave","browserVersion":"155.1.97.56","features":{"temporaryContainer":true}}}`
		brave94 = `{"ok":true,"result":{"hostVersion":"0.1.0","protocol":1,"browser":"brave","browserVersion":"155.1.94.0","features":{"temporaryContainer":false}}}`
		chrome  = `{"ok":true,"result":{"hostVersion":"0.1.0","protocol":1,"browser":"chrome","browserVersion":"155.1.97.56","features":{"temporaryContainer":false}}}`
		noVer   = `{"ok":true,"result":{"hostVersion":"0.1.0","protocol":1,"browser":"brave","features":{"temporaryContainer":false}}}`
	)
	for _, tc := range []struct{ name, browser, lastVersion, want string }{
		{"brave 1.97", "brave", "155.1.97.56", braveOK},
		{"brave 1.94 no admite contenedores temporales", "brave", "155.1.94.0", brave94},
		{"chrome nunca los admite", "chrome", "155.1.97.56", chrome},
		{"sin Last Version", "brave", "", noVer},
		{"Last Version que no es una versión", "brave", "basura", noVer},
	} {
		t.Run(tc.name, func(t *testing.T) {
			te := newEnv(t, tc.browser, tc.lastVersion)
			if got := te.do("ping", `{}`); got != tc.want {
				t.Fatalf("ping = %s\nquiero  %s", got, tc.want)
			}
		})
	}
}

func TestPingVersionOutOfContract(t *testing.T) {
	// hostVersion mide como mucho 32: una versión fuera del contrato no sale por la tubería.
	for _, v := range []string{"", strings.Repeat("1", 33)} {
		te := newEnv(t, "brave", "155.1.97.56")
		te.env.Version = v
		if got := te.do("ping", `{}`); got != errBody("internal") {
			t.Fatalf("ping con versión %q = %s, quiero internal", v, got)
		}
	}
	te := newEnv(t, "brave", "155.1.97.56")
	te.env.Version = strings.Repeat("1", 32)
	result(t, te.do("ping", `{}`))
}

func TestListProfiles(t *testing.T) {
	te := newEnv(t, "brave", "155.1.97.56")
	const want = `{"ok":true,"result":{"profiles":[` +
		`{"directory":"Default","name":"Trabajo","isUsingDefaultName":false,"color":"#1f1f23"},` +
		`{"directory":"Launcher-1a2b3c4d","name":"Personal","isUsingDefaultName":false},` +
		`{"directory":"Profile 1","name":"Persona 1","isUsingDefaultName":true,"color":"#e4e4e5"}]}}`
	if got := te.do("listProfiles", `{}`); got != want {
		t.Fatalf("listProfiles = %s\nquiero        %s", got, want)
	}
}

func TestLocalStateFailuresAreInternal(t *testing.T) {
	// Un Local State que falta, que no es un objeto o con una sección del tipo equivocado es un fallo del
	// navegador o del disco: internal en todos los comandos que lo leen, sin lanzar nada.
	broken := map[string]func(t *testing.T, te *testEnv){
		"sin Local State": func(t *testing.T, te *testEnv) {
			if err := os.Remove(filepath.Join(te.userDir, "Local State")); err != nil {
				t.Fatal(err)
			}
		},
		"Local State que es un array": func(t *testing.T, te *testEnv) {
			writeLocalState(t, te, `[]`)
		},
		"profile que no es un objeto": func(t *testing.T, te *testEnv) {
			writeLocalState(t, te, `{"profile":5}`)
		},
		"info_cache que no es un objeto": func(t *testing.T, te *testEnv) {
			writeLocalState(t, te, `{"profile":{"info_cache":[]}}`)
		},
		"profiles que no es un objeto": func(t *testing.T, te *testEnv) {
			writeLocalState(t, te, `{"profiles":"x"}`)
		},
	}
	commands := map[string]string{
		"listProfiles":  `{}`,
		"open":          `{"profileDirectory":"Default","url":"https://github.com/"}`,
		"openTemporary": `{"profileDirectory":"Default","url":"https://github.com/"}`,
		"createProfile": `{}`,
	}
	for name, breakIt := range broken {
		for cmd, args := range commands {
			t.Run(name+"/"+cmd, func(t *testing.T) {
				te := newEnv(t, "brave", "155.1.97.56")
				breakIt(t, te)
				if got := te.do(cmd, args); got != errBody("internal") {
					t.Fatalf("%s = %s, quiero internal", cmd, got)
				}
				te.wantCalls()
			})
		}
	}
}

func writeLocalState(t *testing.T, te *testEnv, content string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(te.userDir, "Local State"), []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
}

func TestOpen(t *testing.T) {
	te := newEnv(t, "brave", "155.1.97.56")
	got := te.do("open", `{"profileDirectory":"Profile 1","url":"https://github.com/"}`)
	if got != okEmpty {
		t.Fatalf("open = %s, quiero %s", got, okEmpty)
	}
	te.wantCalls(call{browserExe, []string{"--profile-directory=Profile 1", "--", "https://github.com/"}})
}

func TestOpenUnknownProfile(t *testing.T) {
	// Perfil de invitado, borrado o inexistente: unknown_profile y no se lanza nada.
	for _, dir := range []string{"Guest Profile", "Profile 3", "Nope", "default"} {
		t.Run(dir, func(t *testing.T) {
			te := newEnv(t, "brave", "155.1.97.56")
			got := te.do("open", `{"profileDirectory":"`+dir+`","url":"https://github.com/"}`)
			if got != errBody("unknown_profile") {
				t.Fatalf("open = %s, quiero unknown_profile", got)
			}
			te.wantCalls()
		})
	}
}

func TestOpenLaunchFailed(t *testing.T) {
	te := newEnv(t, "brave", "155.1.97.56")
	te.starter.err = io.ErrClosedPipe
	got := te.do("open", `{"profileDirectory":"Default","url":"https://github.com/"}`)
	if got != errBody("launch_failed") {
		t.Fatalf("open = %s, quiero launch_failed", got)
	}
	if len(te.starter.calls) != 1 {
		t.Fatalf("llamadas = %d, quiero 1", len(te.starter.calls))
	}
}

func TestOpenTemporary(t *testing.T) {
	const args = `{"profileDirectory":"Default","url":"https://example.com/"`
	t.Run("chrome no lo admite", func(t *testing.T) {
		te := newEnv(t, "chrome", "155.1.97.56")
		if got := te.do("openTemporary", args+`}`); got != errBody("unsupported_browser") {
			t.Fatalf("got %s", got)
		}
		te.wantCalls()
	})
	t.Run("brave 1.94 no lo admite", func(t *testing.T) {
		te := newEnv(t, "brave", "155.1.94.0")
		if got := te.do("openTemporary", args+`}`); got != errBody("unsupported_browser") {
			t.Fatalf("got %s", got)
		}
		te.wantCalls()
	})
	t.Run("sin Last Version no lo admite", func(t *testing.T) {
		te := newEnv(t, "brave", "")
		if got := te.do("openTemporary", args+`}`); got != errBody("unsupported_browser") {
			t.Fatalf("got %s", got)
		}
		te.wantCalls()
	})
	t.Run("el navegador se mira antes que el perfil", func(t *testing.T) {
		te := newEnv(t, "chrome", "155.1.97.56")
		if got := te.do("openTemporary", `{"profileDirectory":"Nope","url":"https://example.com/"}`); got != errBody("unsupported_browser") {
			t.Fatalf("got %s", got)
		}
	})
	t.Run("perfil desconocido", func(t *testing.T) {
		te := newEnv(t, "brave", "155.1.97.56")
		if got := te.do("openTemporary", `{"profileDirectory":"Nope","url":"https://example.com/"}`); got != errBody("unknown_profile") {
			t.Fatalf("got %s", got)
		}
		te.wantCalls()
	})
	t.Run("nombre en uso, sin distinguir mayúsculas", func(t *testing.T) {
		te := newEnv(t, "brave", "155.1.97.56")
		if got := te.do("openTemporary", args+`,"name":"work"}`); got != errBody("name_in_use") {
			t.Fatalf("got %s", got)
		}
		te.wantCalls()
	})
	t.Run("nombre libre", func(t *testing.T) {
		te := newEnv(t, "brave", "155.1.97.56")
		if got := te.do("openTemporary", args+`,"name":"Temp"}`); got != okEmpty {
			t.Fatalf("got %s", got)
		}
		te.wantCalls(call{browserExe, []string{
			"--profile-directory=Default", "--temporary-container", "--container=Temp", "--", "https://example.com/",
		}})
	})
	t.Run("sin nombre no pasa --container", func(t *testing.T) {
		te := newEnv(t, "brave", "155.1.97.56")
		if got := te.do("openTemporary", args+`}`); got != okEmpty {
			t.Fatalf("got %s", got)
		}
		te.wantCalls(call{browserExe, []string{
			"--profile-directory=Default", "--temporary-container", "--", "https://example.com/",
		}})
	})
	t.Run("perfil sin Preferences", func(t *testing.T) {
		te := newEnv(t, "brave", "155.1.97.56")
		got := te.do("openTemporary", `{"profileDirectory":"Profile 1","url":"https://example.com/","name":"Work"}`)
		if got != okEmpty {
			t.Fatalf("got %s", got)
		}
		te.wantCalls(call{browserExe, []string{
			"--profile-directory=Profile 1", "--temporary-container", "--container=Work", "--", "https://example.com/",
		}})
	})
	t.Run("Preferences que no es JSON", func(t *testing.T) {
		te := newEnv(t, "brave", "155.1.97.56")
		if err := os.WriteFile(filepath.Join(te.userDir, "Default", "Preferences"), []byte(`{`), 0o600); err != nil {
			t.Fatal(err)
		}
		if got := te.do("openTemporary", args+`,"name":"Temp"}`); got != errBody("internal") {
			t.Fatalf("got %s", got)
		}
		te.wantCalls()
	})
	t.Run("Preferences con una sección del tipo equivocado", func(t *testing.T) {
		te := newEnv(t, "brave", "155.1.97.56")
		if err := os.WriteFile(filepath.Join(te.userDir, "Default", "Preferences"), []byte(`{"brave":{"containers":5}}`), 0o600); err != nil {
			t.Fatal(err)
		}
		if got := te.do("openTemporary", args+`,"name":"Temp"}`); got != errBody("internal") {
			t.Fatalf("got %s", got)
		}
		te.wantCalls()
	})
	t.Run("sin nombre no se leen las Preferences", func(t *testing.T) {
		te := newEnv(t, "brave", "155.1.97.56")
		if err := os.WriteFile(filepath.Join(te.userDir, "Default", "Preferences"), []byte(`{`), 0o600); err != nil {
			t.Fatal(err)
		}
		if got := te.do("openTemporary", args+`}`); got != okEmpty {
			t.Fatalf("got %s", got)
		}
	})
	t.Run("el lanzador falla", func(t *testing.T) {
		te := newEnv(t, "brave", "155.1.97.56")
		te.starter.err = io.ErrClosedPipe
		if got := te.do("openTemporary", args+`}`); got != errBody("launch_failed") {
			t.Fatalf("got %s", got)
		}
	})
}

var launcherDir = regexp.MustCompile(`^Launcher-[0-9a-f]{8}$`)

func TestCreateProfile(t *testing.T) {
	te := newEnv(t, "brave", "155.1.97.56")
	res := result(t, te.do("createProfile", `{}`))
	dir := str(t, res, "directory")
	if !launcherDir.MatchString(dir) {
		t.Fatalf("directory = %q", dir)
	}
	te.wantCalls(call{browserExe, []string{"--profile-directory=" + dir}})
}

func TestCreateProfileSkipsTakenDirectories(t *testing.T) {
	te := newEnv(t, "brave", "155.1.97.56")
	// 1a2b3c4d está en Local State; 01020304 existe en disco; el tercer candidato es el bueno.
	te.env.Rand = bytes.NewReader([]byte{0x1a, 0x2b, 0x3c, 0x4d, 0x01, 0x02, 0x03, 0x04, 0x0a, 0x0b, 0x0c, 0x0d})
	if err := os.Mkdir(filepath.Join(te.userDir, "Launcher-01020304"), 0o700); err != nil {
		t.Fatal(err)
	}
	got := te.do("createProfile", `{}`)
	if want := `{"ok":true,"result":{"directory":"Launcher-0a0b0c0d"}}`; got != want {
		t.Fatalf("createProfile = %s, quiero %s", got, want)
	}
	te.wantCalls(call{browserExe, []string{"--profile-directory=Launcher-0a0b0c0d"}})
}

func TestCreateProfileFailures(t *testing.T) {
	t.Run("el lanzador falla", func(t *testing.T) {
		te := newEnv(t, "brave", "155.1.97.56")
		te.starter.err = io.ErrClosedPipe
		if got := te.do("createProfile", `{}`); got != errBody("launch_failed") {
			t.Fatalf("got %s", got)
		}
	})
	t.Run("sin aleatoriedad", func(t *testing.T) {
		te := newEnv(t, "brave", "155.1.97.56")
		te.env.Rand = bytes.NewReader(nil)
		if got := te.do("createProfile", `{}`); got != errBody("internal") {
			t.Fatalf("got %s", got)
		}
		te.wantCalls()
	})
}

func TestHandleNeverPanics(t *testing.T) {
	// Un fallo del host (aquí, un lanzador nil) sale como internal, no como un pánico que cierra la tubería.
	te := newEnv(t, "brave", "155.1.97.56")
	te.env.Starter = nil
	if got := te.do("open", `{"profileDirectory":"Default","url":"https://github.com/"}`); got != errBody("internal") {
		t.Fatalf("got %s", got)
	}
}

func TestHandleUnknownCommandIsInternal(t *testing.T) {
	// Validate ya rechazó los comandos desconocidos; si uno llegara, es un fallo del host.
	te := newEnv(t, "brave", "155.1.97.56")
	if got := string(protocol.Encode(Handle(te.env, protocol.Request{Cmd: "exec"}))); got != errBody("internal") {
		t.Fatalf("got %s", got)
	}
}
