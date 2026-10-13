package profiles_test

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/DanielSantos495/launcher/native-host/internal/jsonx"
	"github.com/DanielSantos495/launcher/native-host/internal/profiles"
	"github.com/DanielSantos495/launcher/native-host/internal/protocol"
)

// testdata son copias inventadas de los archivos del navegador (macOS): ninguna prueba toca ~/Library.
const testdata = "../../testdata/macos"

// esc devuelve el escape JSON de cuatro digitos hexadecimales (barra invertida, "u" y los digitos). Se construye
// por partes para que ninguna herramienta lo convierta en el caracter que representa.
func esc(hex string) string { return "\\" + "u" + hex }

// emoji es U+1F3A8: dos unidades UTF-16 y cuatro bytes UTF-8. Se construye con su numero para no escribirlo en
// el codigo fuente.
var emoji = string(rune(0x1F3A8))

func mustParse(t *testing.T, in string) *profiles.LocalState {
	t.Helper()
	ls, err := profiles.ParseLocalState([]byte(in))
	if err != nil {
		t.Fatalf("ParseLocalState(%q): %v", in, err)
	}
	return ls
}

func testdataLocalState(t *testing.T) *profiles.LocalState {
	t.Helper()
	b, err := os.ReadFile(filepath.Join(testdata, "Local State"))
	if err != nil {
		t.Fatal(err)
	}
	return mustParse(t, string(b))
}

func dirs(list []protocol.ProfileInfo) []string {
	out := make([]string, 0, len(list))
	for _, p := range list {
		out = append(out, p.Directory)
	}
	return out
}

func TestListTestdata(t *testing.T) {
	want := []protocol.ProfileInfo{
		{Directory: "Default", Name: "Trabajo", IsUsingDefaultName: false, Color: "#1f1f23"},
		{Directory: "Launcher-1a2b3c4d", Name: "Personal", IsUsingDefaultName: false, Color: ""},
		{Directory: "Profile 1", Name: "Persona 1", IsUsingDefaultName: true, Color: "#e4e4e5"},
	}
	got := testdataLocalState(t).List()
	if !slices.Equal(got, want) {
		t.Fatalf("List() = %+v\nwant %+v", got, want)
	}
}

func TestKnownTestdata(t *testing.T) {
	ls := testdataLocalState(t)
	cases := []struct {
		dir  string
		want bool
	}{
		{"Default", true},
		{"Launcher-1a2b3c4d", true},
		{"Profile 1", true},
		{"Guest Profile", false},
		{"System Profile", false},
		{"Profile 3", false},
		{"-raro", false},
		{"Sin nombre", false},
		{"No objeto", false},
		{"../Default", false},
		{"", false},
		{"default", false}, // Known distingue mayusculas: es la carpeta exacta
		{"Profile 2", false},
	}
	for _, tc := range cases {
		if got := ls.Known(tc.dir); got != tc.want {
			t.Errorf("Known(%q) = %v, want %v", tc.dir, got, tc.want)
		}
	}
}

func TestTakenTestdata(t *testing.T) {
	ls := testdataLocalState(t)
	cases := []struct {
		dir  string
		want bool
	}{
		{"Profile 3", true},     // borrado
		{"guest profile", true}, // en info_cache, otra capitalizacion
		{"DEFAULT", true},       // en info_cache, otra capitalizacion
		{"No objeto", true},     // en info_cache aunque su valor no sea un objeto
		{"Sin nombre", true},    // en info_cache aunque no tenga nombre
		{"-raro", true},         // en info_cache aunque no sea una carpeta valida
		{"launcher-1A2B3C4D", true},
		{"Launcher-00000000", false},
		{"Profile 2", false},
		{"", false},
	}
	for _, tc := range cases {
		if got := ls.Taken(tc.dir); got != tc.want {
			t.Errorf("Taken(%q) = %v, want %v", tc.dir, got, tc.want)
		}
	}
}

func TestListNameLengthIsUTF16(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want bool
	}{
		{"256 unidades", strings.Repeat("a", 256), true},
		{"257 unidades", strings.Repeat("a", 257), false},
		{"128 emoji son 256 unidades", strings.Repeat(emoji, 128), true},
		{"129 emoji son 258 unidades", strings.Repeat(emoji, 129), false},
		{"255 letras y un emoji son 257 unidades", strings.Repeat("a", 255) + emoji, false},
		{"254 letras y un emoji son 256 unidades", strings.Repeat("a", 254) + emoji, true},
		{"nombre vacio (el esquema lo admite)", "", true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ls := mustParse(t, fmt.Sprintf(`{"profile":{"info_cache":{"Default":{"name":%q}}}}`, tc.in))
			got := ls.Known("Default")
			if got != tc.want {
				t.Fatalf("Known = %v, want %v", got, tc.want)
			}
			if listed := len(ls.List()) == 1; listed != tc.want {
				t.Fatalf("List() = %+v", ls.List())
			}
			if tc.want && ls.List()[0].Name != tc.in {
				t.Fatalf("name = %q", ls.List()[0].Name)
			}
		})
	}
}

func TestListIsUsingDefaultName(t *testing.T) {
	cases := []struct {
		name  string
		field string
		want  bool
	}{
		{"ausente (D15)", ``, true},
		{"texto (D15)", `,"is_using_default_name":"x"`, true},
		{"numero (D15)", `,"is_using_default_name":0`, true},
		{"null (D15)", `,"is_using_default_name":null`, true},
		{"true", `,"is_using_default_name":true`, true},
		{"false", `,"is_using_default_name":false`, false},
		{"claves distinguen mayusculas", `,"Is_Using_Default_Name":false`, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ls := mustParse(t, `{"profile":{"info_cache":{"Default":{"name":"Trabajo"`+tc.field+`}}}}`)
			list := ls.List()
			if len(list) != 1 || list[0].IsUsingDefaultName != tc.want {
				t.Fatalf("List() = %+v, want IsUsingDefaultName %v", list, tc.want)
			}
		})
	}
}

func TestListColor(t *testing.T) {
	cases := []struct {
		name  string
		field string
		want  string
	}{
		{"argb con signo", `-14737629`, "#1f1f23"},
		{"argb con signo (otro)", `-1776411`, "#e4e4e5"},
		{"sin signo", `4280229667`, "#1f1f23"},
		{"cero", `0`, "#000000"},
		{"blanco opaco", `-1`, "#ffffff"},
		{"24 bits", `16777215`, "#ffffff"},
		{"texto", `"#fff"`, ""},
		{"texto con numero", `"123"`, ""},
		{"fraccion", `1.5`, ""},
		{"exponente", `1e3`, ""},
		{"menos cero", `-0`, ""},
		{"null", `null`, ""},
		{"booleano", `true`, ""},
		{"fuera de int64", `99999999999999999999`, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ls := mustParse(t, `{"profile":{"info_cache":{"Default":{"name":"Trabajo","profile_highlight_color":`+tc.field+`}}}}`)
			list := ls.List()
			if len(list) != 1 || list[0].Color != tc.want {
				t.Fatalf("List() = %+v, want color %q", list, tc.want)
			}
			if tc.want != "" && !protocol.ValidColor(list[0].Color) {
				t.Fatalf("color %q no cumple el contrato", list[0].Color)
			}
		})
	}
}

func TestDeletedProfilesAreHidden(t *testing.T) {
	cases := []struct {
		name    string
		deleted string
	}{
		{"nombre", `["Profile 1"]`},
		{"ruta completa: se usa Base", `["/x/y/Profile 1"]`},
		{"elementos que no son texto se ignoran", `[5,null,{},"Profile 1"]`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ls := mustParse(t, `{"profile":{"info_cache":{"Default":{"name":"A"},"Profile 1":{"name":"B"}}},`+
				`"profiles":{"profile_basenames_deleted":`+tc.deleted+`}}`)
			if got := dirs(ls.List()); !slices.Equal(got, []string{"Default"}) {
				t.Fatalf("List() = %v", got)
			}
			if ls.Known("Profile 1") {
				t.Fatal("Known(Profile 1) = true")
			}
			if !ls.Taken("Profile 1") {
				t.Fatal("Taken(Profile 1) = false")
			}
		})
	}
}

func TestDeletedWithoutProfileInInfoCacheIsTaken(t *testing.T) {
	ls := mustParse(t, `{"profiles":{"profile_basenames_deleted":["/x/Launcher-AABBCCDD"]}}`)
	if !ls.Taken("launcher-aabbccdd") {
		t.Fatal("Taken = false")
	}
	if len(ls.List()) != 0 {
		t.Fatalf("List() = %+v", ls.List())
	}
}

func TestListCapsAt500AndKnownDoesNot(t *testing.T) {
	var sb strings.Builder
	sb.WriteString(`{"profile":{"info_cache":{`)
	// Se escriben al reves para comprobar que el tope se aplica tras ordenar.
	for i := 500; i >= 0; i-- {
		if i != 500 {
			sb.WriteString(",")
		}
		fmt.Fprintf(&sb, `"P%03d":{"name":"n%d"}`, i, i)
	}
	sb.WriteString(`}}}`)
	ls := mustParse(t, sb.String())

	list := ls.List()
	if len(list) != protocol.MaxProfiles {
		t.Fatalf("len(List()) = %d, want %d", len(list), protocol.MaxProfiles)
	}
	if list[0].Directory != "P000" || list[499].Directory != "P499" {
		t.Fatalf("limites: %q .. %q", list[0].Directory, list[499].Directory)
	}
	if !ls.Known("P499") || !ls.Known("P500") {
		t.Fatal("Known debe valer para P499 y P500 (sin el tope)")
	}
	if ls.Known("P501") {
		t.Fatal("Known(P501) = true")
	}
}

func TestListExactly500(t *testing.T) {
	var sb strings.Builder
	sb.WriteString(`{"profile":{"info_cache":{`)
	for i := 0; i < 500; i++ {
		if i != 0 {
			sb.WriteString(",")
		}
		fmt.Fprintf(&sb, `"P%03d":{"name":"n"}`, i)
	}
	sb.WriteString(`}}}`)
	if got := len(mustParse(t, sb.String()).List()); got != 500 {
		t.Fatalf("len(List()) = %d, want 500", got)
	}
}

func TestListOrderIsByBytes(t *testing.T) {
	ls := mustParse(t, `{"profile":{"info_cache":{`+
		`"b":{"name":"1"},"a":{"name":"1"},"B":{"name":"1"},"A":{"name":"1"},`+
		`"Profile 2":{"name":"1"},"Profile 10":{"name":"1"},"Profile 1":{"name":"1"}}}}`)
	want := []string{"A", "B", "Profile 1", "Profile 10", "Profile 2", "a", "b"}
	if got := dirs(ls.List()); !slices.Equal(got, want) {
		t.Fatalf("List() = %v, want %v", got, want)
	}
}

func TestListIsACopy(t *testing.T) {
	ls := mustParse(t, `{"profile":{"info_cache":{"Default":{"name":"Trabajo"}}}}`)
	first := ls.List()
	first[0].Name = "cambiado"
	first = append(first[:0], protocol.ProfileInfo{Directory: "X", Name: "Y"})
	if got := ls.List(); len(got) != 1 || got[0].Name != "Trabajo" {
		t.Fatalf("List() = %+v tras modificar la copia anterior (%+v)", got, first)
	}
}

func TestEmptyShapes(t *testing.T) {
	for _, in := range []string{
		`{}`,
		`{"profile":{}}`,
		`{"profile":{"info_cache":{}}}`,
		`{"profiles":{}}`,
		`{"profiles":{"profile_basenames_deleted":[]}}`,
		`{"Profile":{"info_cache":{"Default":{"name":"A"}}}}`,        // las claves distinguen mayusculas
		`{"profile":{"INFO_CACHE":{"Default":{"name":"A"}}}}`,        // idem
		`{"profile":{"info_cache":{"Default":{"NAME":"A"}}}}`,        // idem en cada perfil
		`{"profile":{"info_cache":{"Default":{"name":5}}}}`,          // nombre que no es texto
		`{"profile":{"info_cache":{"Default":[],"Other":null}}}`,     // perfiles que no son objetos
		`{"profile":{"info_cache":{"Default":{"name":null}}}}`,       // nombre null
		`{"profile":{"info_cache":{"Guest Profile":{"name":"G"}}}}`,  // perfil de invitado
		`{"profile":{"info_cache":{"System Profile":{"name":"S"}}}}`, // perfil de sistema
	} {
		ls := mustParse(t, in)
		if got := ls.List(); got == nil || len(got) != 0 {
			t.Errorf("%s: List() = %#v, want vacio y no nil", in, got)
		}
	}
}

func TestDuplicateKeysLastWins(t *testing.T) {
	ls := mustParse(t, `{"profile":{"info_cache":{"A":{"name":"x"},"A":{"name":"y"}}}}`)
	list := ls.List()
	if len(list) != 1 || list[0].Name != "y" {
		t.Fatalf("List() = %+v", list)
	}
}

func TestParseLocalStateErrors(t *testing.T) {
	cases := []struct {
		name string
		in   string
	}{
		{"vacio", ``},
		{"no es JSON", `not json`},
		{"array", `[]`},
		{"null", `null`},
		{"texto", `"x"`},
		{"datos sobrantes", `{} x`},
		{"UTF-8 invalido en un valor", "{\"profile\":{\"info_cache\":{\"Default\":{\"name\":\"\xff\"}}}}"},
		{"UTF-8 invalido en una clave", "{\"profile\":{\"info_cache\":{\"\xff\":{\"name\":\"a\"}}}}"},
		{"sustituto suelto", `{"profile":{"info_cache":{"Default":{"name":"` + esc("d800") + `"}}}}`},
		{"sustituto bajo suelto", `{"profile":{"info_cache":{"Default":{"name":"` + esc("dc00") + `"}}}}`},
		{"profile no es objeto", `{"profile":5}`},
		{"profile es array", `{"profile":[]}`},
		{"profile es null", `{"profile":null}`},
		{"info_cache no es objeto", `{"profile":{"info_cache":[]}}`},
		{"info_cache es texto", `{"profile":{"info_cache":"x"}}`},
		{"profiles no es objeto", `{"profiles":[]}`},
		{"deleted no es array", `{"profiles":{"profile_basenames_deleted":"Profile 1"}}`},
		{"deleted es objeto", `{"profiles":{"profile_basenames_deleted":{}}}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ls, err := profiles.ParseLocalState([]byte(tc.in))
			if err == nil || ls != nil {
				t.Fatalf("ParseLocalState = %v, %v; want error", ls, err)
			}
		})
	}
}

func TestParseLocalStateErrorsCarryNoData(t *testing.T) {
	secret := "Secreto-" + "Zulu"
	in := `{"profile":{"info_cache":{"` + secret + `":5}},"profiles":{"profile_basenames_deleted":"` + secret + `"}}`
	_, err := profiles.ParseLocalState([]byte(in))
	if err == nil {
		t.Fatal("want error")
	}
	if strings.Contains(err.Error(), secret) {
		t.Fatalf("el error repite datos del archivo: %v", err)
	}
}

func TestParseLocalStateTooLarge(t *testing.T) {
	big := []byte(`{}` + strings.Repeat(" ", profiles.MaxFileBytes))
	if _, err := profiles.ParseLocalState(big); err == nil {
		t.Fatal("ParseLocalState de mas de 16 MiB: want error")
	}
	if _, err := profiles.ParseLocalState(big[:profiles.MaxFileBytes]); err != nil {
		t.Fatalf("ParseLocalState de exactamente 16 MiB: %v", err)
	}
}

func TestReadLocalState(t *testing.T) {
	ls, err := profiles.ReadLocalState(testdata)
	if err != nil {
		t.Fatal(err)
	}
	if got := dirs(ls.List()); !slices.Equal(got, []string{"Default", "Launcher-1a2b3c4d", "Profile 1"}) {
		t.Fatalf("List() = %v", got)
	}
}

func TestReadLocalStateMissing(t *testing.T) {
	ls, err := profiles.ReadLocalState(t.TempDir())
	if ls != nil || !errors.Is(err, fs.ErrNotExist) {
		t.Fatalf("ReadLocalState = %v, %v; want fs.ErrNotExist", ls, err)
	}
}

func TestReadLocalStateSizeLimit(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "Local State")
	pad := func(n int) []byte { return append([]byte(`{}`), []byte(strings.Repeat(" ", n-2))...) }

	if err := os.WriteFile(path, pad(profiles.MaxFileBytes), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := profiles.ReadLocalState(dir); err != nil {
		t.Fatalf("16 MiB exactos: %v", err)
	}

	if err := os.WriteFile(path, pad(profiles.MaxFileBytes+1), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := profiles.ReadLocalState(dir); !errors.Is(err, jsonx.ErrFileTooLarge) {
		t.Fatalf("16 MiB + 1: err = %v, want ErrFileTooLarge", err)
	}
}

func TestReadLocalStateInvalid(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "Local State"), []byte(`[]`), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := profiles.ReadLocalState(dir); err == nil {
		t.Fatal("want error")
	}
}

func TestParseContainers(t *testing.T) {
	b, err := os.ReadFile(filepath.Join(testdata, "Default", "Preferences"))
	if err != nil {
		t.Fatal(err)
	}
	got, err := profiles.ParseContainers(b)
	if err != nil || !slices.Equal(got, []string{"Work", "Personal"}) {
		t.Fatalf("ParseContainers = %v, %v", got, err)
	}
}

func TestParseContainersEmptyShapes(t *testing.T) {
	for _, in := range []string{
		`{}`,
		`{"brave":{}}`,
		`{"brave":{"containers":{}}}`,
		`{"brave":{"containers":{"list":[]}}}`,
		`{"Brave":{"containers":{"list":[{"name":"A"}]}}}`,           // las claves distinguen mayusculas
		`{"brave":{"containers":{"list":[{"Name":"A"}]}}}`,           // idem
		`{"brave":{"containers":{"list":[1,"x",null,[],{"id":1}]}}}`, // elementos sin nombre
	} {
		got, err := profiles.ParseContainers([]byte(in))
		if err != nil || got == nil || len(got) != 0 {
			t.Errorf("%s: got %#v, %v; want vacio y no nil", in, got, err)
		}
	}
}

func TestParseContainersSkipsBadElements(t *testing.T) {
	got, err := profiles.ParseContainers([]byte(`{"brave":{"containers":{"list":[1,{"name":"A"},{"name":5},null,{"name":"B"}]}}}`))
	if err != nil || !slices.Equal(got, []string{"A", "B"}) {
		t.Fatalf("got %v, %v", got, err)
	}
}

func TestParseContainersErrors(t *testing.T) {
	cases := []struct {
		name string
		in   string
	}{
		{"list es objeto", `{"brave":{"containers":{"list":{}}}}`},
		{"list es texto", `{"brave":{"containers":{"list":"x"}}}`},
		{"list es null", `{"brave":{"containers":{"list":null}}}`},
		{"containers no es objeto", `{"brave":{"containers":5}}`},
		{"brave no es objeto", `{"brave":[]}`},
		{"vacio", ``},
		{"no es JSON", `{`},
		{"array", `[]`},
		{"null", `null`},
		{"UTF-8 invalido", "{\"brave\":{\"containers\":{\"list\":[{\"name\":\"\xff\"}]}}}"},
		{"sustituto suelto", `{"brave":{"containers":{"list":[{"name":"` + esc("d800") + `"}]}}}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got, err := profiles.ParseContainers([]byte(tc.in)); err == nil {
				t.Fatalf("got %v, want error", got)
			}
		})
	}
}

func TestParseContainersTooLarge(t *testing.T) {
	big := []byte(`{}` + strings.Repeat(" ", profiles.MaxFileBytes))
	if _, err := profiles.ParseContainers(big); err == nil {
		t.Fatal("ParseContainers de mas de 16 MiB: want error")
	}
}

func TestReadContainers(t *testing.T) {
	got, err := profiles.ReadContainers(testdata, "Default")
	if err != nil || !slices.Equal(got, []string{"Work", "Personal"}) {
		t.Fatalf("ReadContainers = %v, %v", got, err)
	}
}

func TestReadContainersWithoutPreferences(t *testing.T) {
	dir := t.TempDir()
	// Ni siquiera existe la carpeta del perfil.
	if got, err := profiles.ReadContainers(dir, "Profile 9"); got != nil || err != nil {
		t.Fatalf("sin carpeta: %#v, %v; want nil, nil", got, err)
	}
	// La carpeta existe pero no tiene Preferences.
	if err := os.Mkdir(filepath.Join(dir, "Profile 9"), 0o700); err != nil {
		t.Fatal(err)
	}
	if got, err := profiles.ReadContainers(dir, "Profile 9"); got != nil || err != nil {
		t.Fatalf("sin Preferences: %#v, %v; want nil, nil", got, err)
	}
}

func TestReadContainersRejectsBadProfileDirectory(t *testing.T) {
	dir := t.TempDir()
	// Una Preferences que si valdria, fuera del perfil: no debe leerse.
	if err := os.MkdirAll(filepath.Join(dir, "sub"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "Preferences"), []byte(`{}`), 0o600); err != nil {
		t.Fatal(err)
	}
	for _, bad := range []string{"", ".", "..", "../sub", "sub/..", "-x", "a/b", `a\b`, "/etc"} {
		if got, err := profiles.ReadContainers(dir, bad); err == nil {
			t.Errorf("ReadContainers(%q) = %v, nil; want error", bad, got)
		}
	}
}

func TestReadContainersErrors(t *testing.T) {
	dir := t.TempDir()
	profile := filepath.Join(dir, "Default")
	if err := os.Mkdir(profile, 0o700); err != nil {
		t.Fatal(err)
	}
	prefs := filepath.Join(profile, "Preferences")

	if err := os.WriteFile(prefs, []byte(`{"brave":{"containers":{"list":{}}}}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if got, err := profiles.ReadContainers(dir, "Default"); err == nil {
		t.Fatalf("Preferences con forma incorrecta: %v, want error", got)
	}

	pad := append([]byte(`{}`), []byte(strings.Repeat(" ", profiles.MaxFileBytes-1))...) // 16 MiB + 1
	if err := os.WriteFile(prefs, pad, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := profiles.ReadContainers(dir, "Default"); !errors.Is(err, jsonx.ErrFileTooLarge) {
		t.Fatalf("16 MiB + 1: err = %v, want ErrFileTooLarge", err)
	}

	// Preferences es una carpeta: un error distinto de "no existe" no se confunde con "sin contenedores".
	if err := os.Remove(prefs); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(prefs, 0o700); err != nil {
		t.Fatal(err)
	}
	if got, err := profiles.ReadContainers(dir, "Default"); err == nil || got != nil {
		t.Fatalf("Preferences es una carpeta: %v, %v; want error", got, err)
	}
}

func TestParseLastVersion(t *testing.T) {
	cases := []struct {
		in   string
		want string
		ok   bool
	}{
		{"155.1.97.56\n", "155.1.97.56", true},
		{"155.1.97.56", "155.1.97.56", true},
		{" \t155.1.97.56 \r\n", "155.1.97.56", true},
		{"1.2", "1.2", true},
		{"1.2.3", "1.2.3", true},
		{"1.2.3.4", "1.2.3.4", true},
		{"1." + strings.Repeat("9", 30), "1." + strings.Repeat("9", 30), true}, // 32 caracteres
		{"1." + strings.Repeat("9", 31), "", false},                            // 33 caracteres
		{"abc", "", false},
		{"", "", false},
		{"   \n", "", false},
		{"1.", "", false},
		{".1", "", false},
		{"1", "", false},
		{"1..2", "", false},
		{"1.2.", "", false},
		{"1.2.3.4.5", "", false},
		{"-1.2", "", false},
		{"+1.2", "", false},
		{"1.2a", "", false},
		{"v1.2", "", false},
		{"1.2\n3", "", false},
		{"1 .2", "", false},
		{"1.2-beta", "", false},
		{"1." + string(rune(0x0663)), "", false}, // digito arabigo-indico: solo cifras ASCII
		{string(rune(0x00A0)) + "1.2", "", false},
	}
	for _, tc := range cases {
		got, ok := profiles.ParseLastVersion(tc.in)
		if got != tc.want || ok != tc.ok {
			t.Errorf("ParseLastVersion(%q) = %q, %v; want %q, %v", tc.in, got, ok, tc.want, tc.ok)
		}
	}
}

func TestReadLastVersion(t *testing.T) {
	if got, ok := profiles.ReadLastVersion(testdata); !ok || got != "155.1.97.56" {
		t.Fatalf("ReadLastVersion = %q, %v", got, ok)
	}
}

func TestReadLastVersionFailures(t *testing.T) {
	dir := t.TempDir()
	if got, ok := profiles.ReadLastVersion(dir); ok || got != "" {
		t.Fatalf("sin archivo: %q, %v", got, ok)
	}
	path := filepath.Join(dir, "Last Version")
	for name, content := range map[string]string{
		"basura":       "no es una version\n",
		"vacio":        "",
		"demasiado":    strings.Repeat("1", 1<<20),
		"dos lineas":   "155.1.97.56\n155.1.97.57\n",
		"binario":      "\x00\x01\x02",
		"con prefijo":  "Brave 1.97.56",
		"solo espacio": "   ",
	} {
		if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
			t.Fatal(err)
		}
		if got, ok := profiles.ReadLastVersion(dir); ok || got != "" {
			t.Errorf("%s: ReadLastVersion = %q, %v; want \"\", false", name, got, ok)
		}
	}
}
