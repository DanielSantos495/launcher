package caller_test

import (
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/DanielSantos495/launcher/native-host/internal/caller"
)

// FuzzParseConfig: nunca entra en pánico y todo lo aceptado cumple las reglas y se escribe y se lee igual.
func FuzzParseConfig(f *testing.F) {
	f.Add([]byte(`{"browser":"brave","exe":"/Applications/Brave Browser.app/Contents/MacOS/Brave Browser","userDataDir":"/Users/ejemplo/x","extensionId":"abcdefghijklmnopabcdefghijklmnop","binarySha256":"` + strings.Repeat("0a", 32) + `"}`))
	f.Add([]byte(`{}`))
	f.Add([]byte(`null`))
	f.Fuzz(func(t *testing.T, b []byte) {
		c, err := caller.ParseConfig(b)
		if err != nil {
			if c != (caller.Config{}) {
				t.Fatal("con error debe devolver la configuracion vacia")
			}
			return
		}
		ext := strings.ToLower(filepath.Ext(c.Exe))
		if !slices.Contains(caller.Browsers, c.Browser) || !filepath.IsAbs(c.Exe) || !filepath.IsAbs(c.UserDataDir) ||
			!caller.ValidExtensionID(c.ExtensionID) || len(c.BinarySHA256) != 64 || ext == ".bat" || ext == ".cmd" {
			t.Fatalf("configuracion aceptada fuera de las reglas: %+v", c)
		}
		enc, err := c.Encode()
		if err != nil {
			t.Fatalf("Encode de una configuracion aceptada: %v", err)
		}
		back, err := caller.ParseConfig(enc)
		if err != nil || back != c {
			t.Fatalf("ida y vuelta: %+v, %v; want %+v", back, err, c)
		}
	})
}
