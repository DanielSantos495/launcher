package caller_test

import (
	"encoding/json"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/DanielSantos495/launcher/native-host/internal/caller"
	"github.com/DanielSantos495/launcher/native-host/internal/jsonx"
)

const (
	goodExe  = "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"
	goodData = "/Users/ejemplo/Library/Application Support/BraveSoftware/Brave-Browser"
	goodID   = "abcdefghijklmnopabcdefghijklmnop"
)

var goodSHA = strings.Repeat("0123456789abcdef", 4)

// esc devuelve el escape JSON de cuatro digitos hexadecimales (barra invertida, "u" y los digitos). Se construye
// por partes para que ninguna herramienta lo convierta en el caracter que representa.
func esc(hex string) string { return "\\" + "u" + hex }

func goodConfig() caller.Config {
	return caller.Config{
		Browser:      "brave",
		Exe:          goodExe,
		UserDataDir:  goodData,
		ExtensionID:  goodID,
		BinarySHA256: goodSHA,
	}
}

// configJSON escribe un config.json valido y aplica los cambios: un valor nil quita el campo.
func configJSON(t *testing.T, changes map[string]any) []byte {
	t.Helper()
	m := map[string]any{
		"browser":      "brave",
		"exe":          goodExe,
		"userDataDir":  goodData,
		"extensionId":  goodID,
		"binarySha256": goodSHA,
	}
	for k, v := range changes {
		if v == nil {
			delete(m, k)
		} else {
			m[k] = v
		}
	}
	b, err := json.Marshal(m)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func TestParseConfigValid(t *testing.T) {
	c, err := caller.ParseConfig(configJSON(t, nil))
	if err != nil {
		t.Fatal(err)
	}
	if c != goodConfig() {
		t.Fatalf("ParseConfig = %+v", c)
	}

	c, err = caller.ParseConfig(configJSON(t, map[string]any{"log": true}))
	if err != nil || !c.Log {
		t.Fatalf("con log: %+v, %v", c, err)
	}
	c, err = caller.ParseConfig(configJSON(t, map[string]any{"log": false}))
	if err != nil || c.Log {
		t.Fatalf("con log false: %+v, %v", c, err)
	}

	for _, browser := range caller.Browsers {
		if _, err := caller.ParseConfig(configJSON(t, map[string]any{"browser": browser})); err != nil {
			t.Errorf("browser %q: %v", browser, err)
		}
	}
}

func TestBrowsers(t *testing.T) {
	if want := []string{"brave", "chrome", "edge"}; !slices.Equal(caller.Browsers, want) {
		t.Fatalf("Browsers = %v, want %v", caller.Browsers, want)
	}
}

func TestParseConfigWhitespaceAndOrder(t *testing.T) {
	in := "\n  {\n \"binarySha256\": \"" + goodSHA + "\", \"extensionId\": \"" + goodID + "\",\n" +
		"\"userDataDir\": \"" + goodData + "\", \"exe\": \"" + goodExe + "\", \"browser\": \"brave\"}\n\n"
	c, err := caller.ParseConfig([]byte(in))
	if err != nil || c != goodConfig() {
		t.Fatalf("ParseConfig = %+v, %v", c, err)
	}
}

func TestParseConfigRejects(t *testing.T) {
	cases := []struct {
		name    string
		changes map[string]any
		field   string // campo que debe nombrar el error
	}{
		{"browser vacio", map[string]any{"browser": ""}, "browser"},
		{"browser ausente", map[string]any{"browser": nil}, "browser"},
		{"browser firefox", map[string]any{"browser": "firefox"}, "browser"},
		{"browser en mayusculas", map[string]any{"browser": "Brave"}, "browser"},
		{"browser con espacio", map[string]any{"browser": "brave "}, "browser"},

		{"exe vacio", map[string]any{"exe": ""}, "exe"},
		{"exe ausente", map[string]any{"exe": nil}, "exe"},
		{"exe relativo", map[string]any{"exe": "Brave Browser.app/Contents/MacOS/Brave Browser"}, "exe"},
		{"exe solo el nombre", map[string]any{"exe": "brave"}, "exe"},
		{"exe con ./", map[string]any{"exe": "./brave"}, "exe"},
		{"exe .bat", map[string]any{"exe": "/x/brave.bat"}, "exe"},
		{"exe .cmd", map[string]any{"exe": "/x/brave.cmd"}, "exe"},
		{"exe .BAT", map[string]any{"exe": "/x/brave.BAT"}, "exe"},
		{"exe .Cmd", map[string]any{"exe": "/x/brave.Cmd"}, "exe"},
		{"exe con NUL", map[string]any{"exe": "/x/brave\x00"}, "exe"},
		{"exe con salto de linea", map[string]any{"exe": "/x/brave\n"}, "exe"},

		{"userDataDir vacio", map[string]any{"userDataDir": ""}, "userDataDir"},
		{"userDataDir ausente", map[string]any{"userDataDir": nil}, "userDataDir"},
		{"userDataDir relativo", map[string]any{"userDataDir": "Library/Application Support/Brave"}, "userDataDir"},
		{"userDataDir con NUL", map[string]any{"userDataDir": "/x\x00"}, "userDataDir"},

		{"extensionId con mayusculas", map[string]any{"extensionId": strings.ToUpper(goodID)}, "extensionId"},
		{"extensionId con q", map[string]any{"extensionId": goodID[:31] + "q"}, "extensionId"},
		{"extensionId de 31", map[string]any{"extensionId": goodID[:31]}, "extensionId"},
		{"extensionId de 33", map[string]any{"extensionId": goodID + "a"}, "extensionId"},
		{"extensionId vacio", map[string]any{"extensionId": ""}, "extensionId"},
		{"extensionId ausente", map[string]any{"extensionId": nil}, "extensionId"},
		{"extensionId con digito", map[string]any{"extensionId": goodID[:31] + "1"}, "extensionId"},

		{"sha de 63", map[string]any{"binarySha256": goodSHA[:63]}, "binarySha256"},
		{"sha de 65", map[string]any{"binarySha256": goodSHA + "a"}, "binarySha256"},
		{"sha con g", map[string]any{"binarySha256": goodSHA[:63] + "g"}, "binarySha256"},
		{"sha en mayusculas", map[string]any{"binarySha256": strings.ToUpper(goodSHA)}, "binarySha256"},
		{"sha vacio", map[string]any{"binarySha256": ""}, "binarySha256"},
		{"sha ausente", map[string]any{"binarySha256": nil}, "binarySha256"},

		{"campo desconocido", map[string]any{"foo": 1}, ""},
		{"launchMode (campo del spike)", map[string]any{"launchMode": "direct"}, ""},
		{"log no booleano", map[string]any{"log": "yes"}, ""},
		{"browser no es texto", map[string]any{"browser": 5}, ""},
		{"campo con otra capitalizacion", map[string]any{"Foo": 1}, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			c, err := caller.ParseConfig(configJSON(t, tc.changes))
			if err == nil {
				t.Fatalf("ParseConfig = %+v, want error", c)
			}
			if c != (caller.Config{}) {
				t.Fatalf("con error debe devolver la configuracion vacia: %+v", c)
			}
			if tc.field != "" && !strings.Contains(err.Error(), tc.field) {
				t.Fatalf("el error %q no nombra el campo %q", err, tc.field)
			}
		})
	}
}

func TestParseConfigRejectsMalformedJSON(t *testing.T) {
	good := string(configJSON(t, nil))
	cases := []struct {
		name string
		in   string
	}{
		{"vacio", ``},
		{"no es JSON", `not json`},
		{"objeto vacio", `{}`},
		{"null", `null`},
		{"array", `[]`},
		{"texto", `"x"`},
		{"truncado", good[:len(good)-1]},
		{"datos sobrantes", good + ` x`},
		{"dos objetos", good + good},
		{"llave de mas", good + `}`},
		{"UTF-8 invalido", strings.Replace(good, "Brave Browser.app", "Brave\xff.app", 1)},
		{"sustituto suelto", strings.Replace(good, "Brave Browser.app", "Brave"+esc("d800")+".app", 1)},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if c, err := caller.ParseConfig([]byte(tc.in)); err == nil {
				t.Fatalf("ParseConfig = %+v, want error", c)
			}
		})
	}
}

func TestParseConfigErrorsCarryNoData(t *testing.T) {
	secret := "secreto-" + "zulu"
	cases := []map[string]any{
		{"exe": "relativo/" + secret},
		{"exe": "/x/" + secret + ".bat"},
		{"userDataDir": "relativo/" + secret},
		{"browser": secret},
		{"extensionId": secret},
		{"binarySha256": secret},
		{secret: 1},
	}
	for _, changes := range cases {
		_, err := caller.ParseConfig(configJSON(t, changes))
		if err == nil {
			t.Errorf("%v: want error", changes)
			continue
		}
		if strings.Contains(err.Error(), secret) {
			t.Errorf("el error repite datos del archivo: %v", err)
		}
	}
}

func TestParseConfigSizeLimit(t *testing.T) {
	// 64 KiB exactos (relleno con espacios tras el objeto) valen; uno mas no.
	good := configJSON(t, nil)
	pad := func(n int) []byte { return append(slices.Clone(good), []byte(strings.Repeat(" ", n-len(good)))...) }
	if _, err := caller.ParseConfig(pad(64 << 10)); err != nil {
		t.Fatalf("64 KiB: %v", err)
	}
	if _, err := caller.ParseConfig(pad(64<<10 + 1)); err == nil {
		t.Fatal("64 KiB + 1: want error")
	}
}

func TestEncode(t *testing.T) {
	c := goodConfig()
	c.Log = true
	b, err := c.Encode()
	if err != nil {
		t.Fatal(err)
	}
	back, err := caller.ParseConfig(b)
	if err != nil || back != c {
		t.Fatalf("ParseConfig(Encode) = %+v, %v; want %+v", back, err, c)
	}
	// Sangria de dos espacios y salto de linea final.
	if !strings.HasPrefix(string(b), "{\n  \"browser\": \"brave\",\n") || !strings.HasSuffix(string(b), "\n}\n") {
		t.Fatalf("formato inesperado:\n%s", b)
	}

	// Sin log no se escribe el campo.
	b, err = goodConfig().Encode()
	if err != nil || strings.Contains(string(b), "log") {
		t.Fatalf("Encode sin log: %s, %v", b, err)
	}
	back, err = caller.ParseConfig(b)
	if err != nil || back != goodConfig() {
		t.Fatalf("ParseConfig(Encode) sin log = %+v, %v", back, err)
	}
}

func TestEncodeDoesNotEscapeHTML(t *testing.T) {
	c := goodConfig()
	c.Exe = "/Applications/A&B <x>/Brave"
	b, err := c.Encode()
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(b), `"/Applications/A&B <x>/Brave"`) {
		t.Fatalf("Encode escapo HTML:\n%s", b)
	}
	back, err := caller.ParseConfig(b)
	if err != nil || back != c {
		t.Fatalf("ParseConfig(Encode) = %+v, %v", back, err)
	}
}

func TestEncodeRejectsInvalidConfig(t *testing.T) {
	for _, c := range []caller.Config{
		{},
		func() caller.Config { c := goodConfig(); c.Exe = "relativo"; return c }(),
		func() caller.Config { c := goodConfig(); c.Browser = "firefox"; return c }(),
		func() caller.Config { c := goodConfig(); c.ExtensionID = "ABC"; return c }(),
	} {
		if b, err := c.Encode(); err == nil {
			t.Errorf("Encode(%+v) = %s, want error", c, b)
		}
	}
}

func TestLoadConfig(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, caller.ConfigFile), configJSON(t, nil), 0o600); err != nil {
		t.Fatal(err)
	}
	c, err := caller.LoadConfig(dir)
	if err != nil || c != goodConfig() {
		t.Fatalf("LoadConfig = %+v, %v", c, err)
	}
	if caller.ConfigFile != "config.json" {
		t.Fatalf("ConfigFile = %q", caller.ConfigFile)
	}
}

func TestLoadConfigMissing(t *testing.T) {
	c, err := caller.LoadConfig(t.TempDir())
	if !errors.Is(err, fs.ErrNotExist) || c != (caller.Config{}) {
		t.Fatalf("LoadConfig = %+v, %v; want fs.ErrNotExist", c, err)
	}
}

func TestLoadConfigInvalid(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, caller.ConfigFile), configJSON(t, map[string]any{"exe": "relativo"}), 0o600); err != nil {
		t.Fatal(err)
	}
	if c, err := caller.LoadConfig(dir); err == nil {
		t.Fatalf("LoadConfig = %+v, want error", c)
	}
}

func TestLoadConfigSizeLimit(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, caller.ConfigFile)
	good := configJSON(t, nil)
	pad := func(n int) []byte { return append(slices.Clone(good), []byte(strings.Repeat(" ", n-len(good)))...) }

	if err := os.WriteFile(path, pad(64<<10), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := caller.LoadConfig(dir); err != nil {
		t.Fatalf("64 KiB: %v", err)
	}
	if err := os.WriteFile(path, pad(64<<10+1), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := caller.LoadConfig(dir); !errors.Is(err, jsonx.ErrFileTooLarge) {
		t.Fatalf("64 KiB + 1: err = %v, want ErrFileTooLarge", err)
	}
}

func TestHostName(t *testing.T) {
	cases := map[string]string{
		"brave":  "com.curyapps.launcher.brave",
		"chrome": "com.curyapps.launcher.chrome",
		"edge":   "com.curyapps.launcher.edge",
	}
	for browser, want := range cases {
		if got := caller.HostName(browser); got != want {
			t.Errorf("HostName(%q) = %q, want %q", browser, got, want)
		}
	}
}

func TestValidExtensionID(t *testing.T) {
	cases := []struct {
		in   string
		want bool
	}{
		{goodID, true},
		{strings.Repeat("a", 32), true},
		{strings.Repeat("p", 32), true},
		{strings.Repeat("a", 31), false},
		{strings.Repeat("a", 33), false},
		{"", false},
		{strings.Repeat("q", 32), false},
		{strings.Repeat("`", 32), false}, // el caracter anterior a la a
		{strings.Repeat("A", 32), false},
		{goodID[:31] + "0", false},
		{goodID[:31] + "-", false},
		{goodID[:31] + "\n", false},
		{goodID + "\n", false},
		{" " + goodID[:31], false},
		{goodID[:31] + string(rune(0x00E1)), false},
	}
	for _, tc := range cases {
		if got := caller.ValidExtensionID(tc.in); got != tc.want {
			t.Errorf("ValidExtensionID(%q) = %v, want %v", tc.in, got, tc.want)
		}
	}
}

func TestOrigin(t *testing.T) {
	if got, want := caller.Origin(goodID), "chrome-extension://"+goodID+"/"; got != want {
		t.Fatalf("Origin = %q, want %q", got, want)
	}
}

func TestCheckOrigin(t *testing.T) {
	c := goodConfig()
	otherID := strings.Repeat("b", 32)
	cases := []struct {
		name string
		arg  string
		want bool
	}{
		{"exacto", "chrome-extension://" + goodID + "/", true},
		{"sin barra final", "chrome-extension://" + goodID, false},
		{"otro id", "chrome-extension://" + otherID + "/", false},
		{"id en mayusculas", "chrome-extension://" + strings.ToUpper(goodID) + "/", false},
		{"esquema en mayusculas", "CHROME-EXTENSION://" + goodID + "/", false},
		{"espacio al final", "chrome-extension://" + goodID + "/ ", false},
		{"espacio al principio", " chrome-extension://" + goodID + "/", false},
		{"salto de linea", "chrome-extension://" + goodID + "/\n", false},
		{"con ruta", "chrome-extension://" + goodID + "/whoami.html", false},
		{"dos barras", "chrome-extension://" + goodID + "//", false},
		{"https", "https://" + goodID + "/", false},
		{"vacio", "", false},
		{"solo el id", goodID, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := caller.CheckOrigin(tc.arg, c); got != tc.want {
				t.Fatalf("CheckOrigin(%q) = %v, want %v", tc.arg, got, tc.want)
			}
		})
	}
}

func TestCheckOriginNeedsAValidExtensionID(t *testing.T) {
	// Una configuracion sin id (no pasa por ParseConfig) no debe dar por bueno el origen vacio.
	c := goodConfig()
	c.ExtensionID = ""
	if caller.CheckOrigin("chrome-extension:///", c) {
		t.Fatal("CheckOrigin con ExtensionID vacio = true")
	}
	c.ExtensionID = "ABC"
	if caller.CheckOrigin("chrome-extension://ABC/", c) {
		t.Fatal("CheckOrigin con ExtensionID no valido = true")
	}
}
