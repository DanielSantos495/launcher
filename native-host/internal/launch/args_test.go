package launch_test

import (
	"slices"
	"strings"
	"testing"

	"github.com/DanielSantos495/launcher/native-host/internal/launch"
)

const (
	extID = "abcdefghijklmnopabcdefghijklmnop"
	nonce = "nonce_de_prueba_0123456789"
)

// Los switches fijos que puede contener la lista de argumentos. Todo lo demas que empiece por "-" es un fallo.
func isFixedSwitch(arg string) bool {
	return arg == "--" || arg == "--temporary-container" ||
		strings.HasPrefix(arg, "--profile-directory=") || strings.HasPrefix(arg, "--container=")
}

func TestOpenArgs(t *testing.T) {
	got, err := launch.OpenArgs("Profile 1", "https://github.com/")
	want := []string{"--profile-directory=Profile 1", "--", "https://github.com/"}
	if err != nil || !slices.Equal(got, want) {
		t.Fatalf("OpenArgs = %q, %v; want %q", got, err, want)
	}
}

func TestTemporaryArgs(t *testing.T) {
	got, err := launch.TemporaryArgs("Default", "https://example.com/", "")
	want := []string{"--profile-directory=Default", "--temporary-container", "--", "https://example.com/"}
	if err != nil || !slices.Equal(got, want) {
		t.Fatalf("TemporaryArgs sin nombre = %q, %v; want %q", got, err, want)
	}

	got, err = launch.TemporaryArgs("Default", "https://example.com/", "Mi temp")
	want = []string{"--profile-directory=Default", "--temporary-container", "--container=Mi temp", "--", "https://example.com/"}
	if err != nil || !slices.Equal(got, want) {
		t.Fatalf("TemporaryArgs con nombre = %q, %v; want %q", got, err, want)
	}
}

func TestCreateProfileArgs(t *testing.T) {
	got, err := launch.CreateProfileArgs("Launcher-1a2b3c4d")
	want := []string{"--profile-directory=Launcher-1a2b3c4d"}
	if err != nil || !slices.Equal(got, want) {
		t.Fatalf("CreateProfileArgs = %q, %v; want %q", got, err, want)
	}
}

func TestWhoami(t *testing.T) {
	if got, want := launch.WhoamiURL(extID, nonce), "chrome-extension://"+extID+"/whoami.html#"+nonce; got != want {
		t.Fatalf("WhoamiURL = %q, want %q", got, want)
	}
	got, err := launch.WhoamiArgs("Default", extID, nonce)
	want := []string{"--profile-directory=Default", "--", "chrome-extension://" + extID + "/whoami.html#" + nonce}
	if err != nil || !slices.Equal(got, want) {
		t.Fatalf("WhoamiArgs = %q, %v; want %q", got, err, want)
	}
}

func TestConstructorsRejectInvalidInput(t *testing.T) {
	const okURL = "https://example.com/"
	cases := []struct {
		name string
		call func() ([]string, error)
	}{
		{"Open: carpeta que empieza por -", func() ([]string, error) { return launch.OpenArgs("-x", okURL) }},
		{"Open: carpeta vacia", func() ([]string, error) { return launch.OpenArgs("", okURL) }},
		{"Open: carpeta con barra", func() ([]string, error) { return launch.OpenArgs("a/b", okURL) }},
		{"Open: carpeta ..", func() ([]string, error) { return launch.OpenArgs("..", okURL) }},
		{"Open: carpeta con salto de linea", func() ([]string, error) { return launch.OpenArgs("a\nb", okURL) }},
		{"Open: URL --incognito", func() ([]string, error) { return launch.OpenArgs("Default", "--incognito") }},
		{"Open: URL vacia", func() ([]string, error) { return launch.OpenArgs("Default", "") }},
		{"Open: URL file", func() ([]string, error) { return launch.OpenArgs("Default", "file:///etc/passwd") }},
		{"Open: URL con espacio", func() ([]string, error) { return launch.OpenArgs("Default", "https://example.com/a b") }},
		{"Open: URL sin ruta", func() ([]string, error) { return launch.OpenArgs("Default", "https://example.com") }},

		{"Temporary: carpeta que empieza por -", func() ([]string, error) { return launch.TemporaryArgs("-x", okURL, "") }},
		{"Temporary: URL --incognito", func() ([]string, error) { return launch.TemporaryArgs("Default", "--incognito", "") }},
		{"Temporary: nombre que empieza por -", func() ([]string, error) { return launch.TemporaryArgs("Default", okURL, "-x") }},
		{"Temporary: nombre con =", func() ([]string, error) { return launch.TemporaryArgs("Default", okURL, "a=b") }},
		{"Temporary: nombre en blanco", func() ([]string, error) { return launch.TemporaryArgs("Default", okURL, "   ") }},
		{"Temporary: nombre de 65", func() ([]string, error) { return launch.TemporaryArgs("Default", okURL, strings.Repeat("a", 65)) }},
		{"Temporary: nombre con control", func() ([]string, error) { return launch.TemporaryArgs("Default", okURL, "a\x07b") }},

		{"Create: carpeta que empieza por -", func() ([]string, error) { return launch.CreateProfileArgs("-x") }},
		{"Create: carpeta vacia", func() ([]string, error) { return launch.CreateProfileArgs("") }},
		{"Create: carpeta con barra", func() ([]string, error) { return launch.CreateProfileArgs("../x") }},

		{"Whoami: carpeta que empieza por -", func() ([]string, error) { return launch.WhoamiArgs("-x", extID, nonce) }},
		{"Whoami: id vacio", func() ([]string, error) { return launch.WhoamiArgs("Default", "", nonce) }},
		{"Whoami: id con mayusculas", func() ([]string, error) { return launch.WhoamiArgs("Default", strings.ToUpper(extID), nonce) }},
		{"Whoami: id con q", func() ([]string, error) { return launch.WhoamiArgs("Default", extID[:31]+"q", nonce) }},
		{"Whoami: id con barra", func() ([]string, error) { return launch.WhoamiArgs("Default", extID[:30]+"a/", nonce) }},
		{"Whoami: nonce vacio", func() ([]string, error) { return launch.WhoamiArgs("Default", extID, "") }},
		{"Whoami: nonce de 15", func() ([]string, error) { return launch.WhoamiArgs("Default", extID, strings.Repeat("a", 15)) }},
		{"Whoami: nonce de 65", func() ([]string, error) { return launch.WhoamiArgs("Default", extID, strings.Repeat("a", 65)) }},
		{"Whoami: nonce con #", func() ([]string, error) { return launch.WhoamiArgs("Default", extID, strings.Repeat("a", 15)+"#") }},
		{"Whoami: nonce con espacio", func() ([]string, error) { return launch.WhoamiArgs("Default", extID, strings.Repeat("a", 15)+" ") }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got, err := tc.call(); err == nil || got != nil {
				t.Fatalf("got %q, %v; want nil y error", got, err)
			}
		})
	}
}

func TestConstructorErrorsCarryNoData(t *testing.T) {
	secret := "secreto-" + "zulu"
	calls := []func() ([]string, error){
		func() ([]string, error) { return launch.OpenArgs("-"+secret, "https://example.com/") },
		func() ([]string, error) { return launch.OpenArgs("Default", "ftp://"+secret+"/") },
		func() ([]string, error) { return launch.TemporaryArgs("Default", "https://example.com/", "-"+secret) },
		func() ([]string, error) { return launch.WhoamiArgs("Default", secret, nonce) },
		func() ([]string, error) { return launch.WhoamiArgs("Default", extID, secret) },
	}
	for i, call := range calls {
		_, err := call()
		if err == nil {
			t.Errorf("llamada %d: want error", i)
			continue
		}
		if strings.Contains(err.Error(), secret) {
			t.Errorf("llamada %d: el error repite datos: %v", i, err)
		}
	}
}

// Defensa en profundidad: ningun argumento libre (carpeta, URL, nombre, nonce) puede empezar por "-" y confundirse
// con un switch. Solo los switches fijos y "--" empiezan por "-", y la URL va siempre justo despues de "--".
func TestNoFreeArgumentLooksLikeASwitch(t *testing.T) {
	var all [][]string
	add := func(args []string, err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
		all = append(all, args)
	}
	for _, dir := range []string{"Default", "Profile 1", "Launcher-1a2b3c4d", "a=b", "x y", "no-ha-lugar"} {
		add(launch.OpenArgs(dir, "https://github.com/a?b=c#d"))
		add(launch.TemporaryArgs(dir, "http://127.0.0.1:8080/", ""))
		add(launch.TemporaryArgs(dir, "https://example.com/", "Mi temp"))
		add(launch.CreateProfileArgs(dir))
		add(launch.WhoamiArgs(dir, extID, nonce))
	}
	for _, args := range all {
		for i, arg := range args {
			if strings.HasPrefix(arg, "-") && !isFixedSwitch(arg) {
				t.Errorf("%q: el argumento %d (%q) empieza por - y no es un switch fijo", args, i, arg)
			}
		}
		// Si hay URL, es el ultimo argumento y va justo despues de "--".
		if i := slices.Index(args, "--"); i != -1 && (i != len(args)-2) {
			t.Errorf("%q: tras \"--\" debe ir solo la URL", args)
		}
		separators := 0
		for _, arg := range args {
			if arg == "--" {
				separators++
			}
		}
		if separators > 1 {
			t.Errorf("%q: mas de un \"--\"", args)
		}
	}
}

// El valor de un switch no puede traer un segundo argumento: la carpeta y el nombre van pegados a su switch.
func TestSwitchValuesStayInOneArgument(t *testing.T) {
	got, err := launch.TemporaryArgs("Mi perfil", "https://example.com/", "Mi temp con espacios")
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 5 || got[0] != "--profile-directory=Mi perfil" || got[2] != "--container=Mi temp con espacios" {
		t.Fatalf("TemporaryArgs = %q", got)
	}
}

func TestSupportsTemporaryContainer(t *testing.T) {
	cases := []struct {
		browser, version string
		want             bool
	}{
		{"brave", "155.1.95.0", true},
		{"brave", "155.1.94.99", false},
		{"brave", "155.1.100.1", true},
		{"brave", "156.2.0.0", true},
		{"brave", "155.1.97.56", true},
		{"brave", "155.1.9.99", false},
		{"brave", "155.1.95", false},
		{"brave", "155.1", false},
		{"brave", "155.1.95.0.1", false},
		{"brave", "", false},
		{"brave", "abc", false},
		{"brave", "155.1.95.", false},
		{"brave", "155.1.x.0", false},
		{"brave", "155.1.-1.0", false},
		{"brave", "155.0.200.0", false},
		{"brave", "155.1.99999999999999999999.0", false},
		{"brave", " 155.1.97.56\n", true},
		{"chrome", "155.1.97.56", false},
		{"edge", "155.1.97.56", false},
		{"Brave", "155.1.97.56", false},
		{"", "155.1.97.56", false},
	}
	for _, tc := range cases {
		if got := launch.SupportsTemporaryContainer(tc.browser, tc.version); got != tc.want {
			t.Errorf("SupportsTemporaryContainer(%q, %q) = %v, want %v", tc.browser, tc.version, got, tc.want)
		}
	}
}

func TestContainerNameTaken(t *testing.T) {
	// "W" + O con dieresis / o con dieresis: EqualFold las empareja; se construyen con su numero.
	upper := "W" + string(rune(0x00D6)) + "RK"
	lower := "W" + string(rune(0x00F6)) + "rk"
	cases := []struct {
		name       string
		container  string
		containers []string
		want       bool
	}{
		{"misma capitalizacion", "Work", []string{"Work"}, true},
		{"otra capitalizacion", "work", []string{"Work"}, true},
		{"mayusculas", "WORK", []string{"Personal", "Work"}, true},
		{"con dieresis", upper, []string{lower}, true},
		{"otro nombre", "Work2", []string{"Work"}, false},
		{"prefijo", "Wor", []string{"Work"}, false},
		{"lista vacia", "Work", []string{}, false},
		{"lista nil", "Work", nil, false},
		{"varios sin coincidencia", "Work", []string{"Personal", "Otro"}, false},
		{"espacios cuentan", "Work ", []string{"Work"}, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := launch.ContainerNameTaken(tc.container, tc.containers); got != tc.want {
				t.Fatalf("ContainerNameTaken(%q, %q) = %v, want %v", tc.container, tc.containers, got, tc.want)
			}
		})
	}
}
