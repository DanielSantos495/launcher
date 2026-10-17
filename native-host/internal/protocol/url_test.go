package protocol_test

import (
	"strconv"
	"strings"
	"testing"

	"github.com/DanielSantos495/launcher/native-host/internal/protocol"
)

func TestValidURLInGrammar(t *testing.T) {
	label63 := strings.Repeat("a", 63)
	cases := []string{
		"https://github.com/",
		"http://example.com/",
		"https://example.com:8443/",
		"https://example.com:1/",
		"https://example.com:65535/",
		"https://example.com:80/",  // 80 no es el puerto por defecto de https
		"http://example.com:443/",  // 443 no es el puerto por defecto de http
		"https://example.com:444/", // cerca del 443, pero no es
		"https://0.0.0.0/",
		"https://255.255.255.255/",
		"https://1.2.3.4/",
		"https://example.com./",
		"https://a_b-c.example/",
		"https://1.2.3.example/",
		"https://example.123a/",
		"https://xn--a.example/", // excepcion punycode: Go no valida IDNA
		"https://xn--bcher-kva.example/",
		"https://example.com/?",
		"https://example.com/#",
		"https://example.com/#a?b",
		"https://example.com/?a#b?c",
		"https://example.com/#a#b",
		"https://example.com/%7e",
		"https://example.com/%7E",
		"https://example.com/%7e%7E%aB%Ab",
		"https://example.com/...",
		"https://example.com/%2e.%2e",
		"https://example.com/^|",
		"https://example.com/a'b",
		"https://example.com/?q={x}",
		"https://example.com/?q=%60",
		"https://example.com/?q=`", // el acento grave vale en la consulta
		"https://example.com/#'",
		"https://example.com/#{x}",
		"https://example.com/?/../",
		"https://example.com/?a=%40",
		"https://mail.google.com/mail/?authuser=ana%40example.com",
		"https://" + label63 + ".example/",
		"https://example." + label63 + "/",
		"https://example.com/" + strings.Repeat("a", 2028), // 2048 caracteres exactos
	}
	for _, u := range cases {
		t.Run(shorten(u), func(t *testing.T) {
			if !protocol.ValidURL(u) {
				t.Fatalf("ValidURL(%q) = false, want true", shorten(u))
			}
		})
	}
	if n := len("https://example.com/" + strings.Repeat("a", 2028)); n != 2048 {
		t.Fatalf("la URL de prueba mide %d, want 2048", n)
	}
}

func TestValidURLOutsideGrammar(t *testing.T) {
	label64 := strings.Repeat("a", 64)
	cases := []string{
		"",
		"https://",
		"http://",
		"https://github.com",
		"https://github.com?x",
		"https://github.com#x",
		"HTTPS://github.com/",
		"Https://github.com/",
		"https://GitHub.com/",
		"https://user@github.com/",
		"https://u:p@github.com/",
		"https://github.com:443/",
		"http://github.com:80/",
		"https://github.com:0/",
		"https://github.com:0443/",
		"https://github.com:/",
		"https://github.com:65536/",
		"https://github.com:100000/",
		"https://github.com:1a/",
		"https://github.com:1:2/",
		"https://[::1]/",
		"https://010.0.0.1/",
		"https://127.1/",
		"https://1.2.3/",
		"https://1.2.3.4.5/",
		"https://0x7f.0.0.1/",
		"https://256.0.0.1/",
		"https://1.2.3.256/",
		"https://example.0xab/",
		"https://0x/",
		"https://example.123/",
		"https://a..b/",
		"https://.example/",
		"https://example../",
		"https://./",
		"https:///x",
		"https://" + label64 + ".example/",
		"https://example." + label64 + "/",
		"https://ex!ample.com/",
		"https://exámple.com/",
		"https://example.com/á",
		"https://example.com/a b",
		"https://example.com/ ",
		"https://example.com/a\tb",
		"https://example.com/a\nb",
		"https://example.com/\x7f",
		"https://example.com/\x00",
		"https://example.com/a\xffb",
		"javascript:alert(1)",
		"file:///etc/passwd",
		"--incognito",
		"chrome-extension://abc/x",
		"ftp://example.com/",
		"//example.com/",
		"example.com/",
		"https:/example.com/",
		"https:example.com/",
		" https://example.com/",
		"https://example.com/ x",
		"https://example.com/" + strings.Repeat("a", 2029), // 2049 caracteres
		"https://example.com/" + strings.Repeat("a", 2030),
	}
	for _, u := range cases {
		t.Run(shorten(u), func(t *testing.T) {
			if protocol.ValidURL(u) {
				t.Fatalf("ValidURL(%q) = true, want false", shorten(u))
			}
		})
	}
	if n := len("https://example.com/" + strings.Repeat("a", 2029)); n != 2049 {
		t.Fatalf("la URL de prueba mide %d, want 2049", n)
	}
}

// TestValidURLComponents prueba, para cada caracter ASCII imprimible, si vale en la ruta, la consulta y el
// fragmento. Los conjuntos excluidos de la tabla de G se escriben aqui a mano, sin reutilizar los del host.
func TestValidURLComponents(t *testing.T) {
	const (
		pathExcluded     = "\"<>`{}\\" // "#" y "?" no pueden estar en la ruta: abren otro componente
		queryExcluded    = "\"<>'"     // "#" abre el fragmento
		fragmentExcluded = "\"<>`"
	)
	for c := 0x21; c <= 0x7e; c++ {
		ch := string(rune(c))
		if ch == "%" { // "%" solo vale como %XX; se prueba aparte
			continue
		}
		if ch != "#" && ch != "?" {
			u := "https://example.com/a" + ch + "b"
			want := !strings.Contains(pathExcluded, ch)
			if got := protocol.ValidURL(u); got != want {
				t.Errorf("ruta con %q: got %v, want %v", ch, got, want)
			}
		}
		if ch != "#" {
			u := "https://example.com/?a" + ch + "b"
			want := !strings.Contains(queryExcluded, ch)
			if got := protocol.ValidURL(u); got != want {
				t.Errorf("consulta con %q: got %v, want %v", ch, got, want)
			}
		}
		u := "https://example.com/#a" + ch + "b"
		want := !strings.Contains(fragmentExcluded, ch)
		if got := protocol.ValidURL(u); got != want {
			t.Errorf("fragmento con %q: got %v, want %v", ch, got, want)
		}
	}
}

// TestValidURLPercent: "%" solo vale como %XX, en la ruta, la consulta y el fragmento.
func TestValidURLPercent(t *testing.T) {
	prefixes := map[string]string{"ruta": "https://example.com/a", "consulta": "https://example.com/?a", "fragmento": "https://example.com/#a"}
	for place, prefix := range prefixes {
		cases := []struct {
			tail string
			want bool
		}{
			{"%41", true},
			{"%7e", true},
			{"%7E", true},
			{"%aB", true},
			{"%41%42", true},
			{"%zz", false},
			{"%2", false},
			{"%G0", false},
			{"%0G", false},
			{"%%41", false},
			{"%", false},
			{"%4", false},
			{"x%", false},
			{"%41%", false},
			{"%41%4", false},
		}
		for _, tc := range cases {
			if got := protocol.ValidURL(prefix + tc.tail); got != tc.want {
				t.Errorf("%s con %q: got %v, want %v", place, tc.tail, got, tc.want)
			}
		}
	}
}

func TestValidURLDotSegments(t *testing.T) {
	invalid := []string{
		"/./", "/../", "/.", "/..", "/%2e/", "/.%2e/", "/%2e./", "/%2e%2e/", "/%2E/", "/%2E%2E/", "/.%2E", "/%2E.",
		"/a/./b", "/a/../b", "/a/.", "/a/..", "/a/%2e", "/a/%2E%2e", "/a/b/%2e%2E/c", "/%2e", "/%2e%2e",
	}
	for _, p := range invalid {
		if protocol.ValidURL("https://example.com" + p) {
			t.Errorf("ValidURL con la ruta %q = true, want false", p)
		}
	}
	valid := []string{
		"/", "/...", "/%2e.%2e", "/a.b/", "/.a/", "/a./", "/..a", "/a..", "/%2e%2e%2e", "/%2ea", "/a%2e", "/.../.../",
		// Los segmentos punto solo cuentan en la ruta, no en la consulta ni en el fragmento.
		"/?/../", "/?/./", "/#/../", "/#/./", "/?a=..", "/?%2e%2e", "/#..",
	}
	for _, p := range valid {
		if !protocol.ValidURL("https://example.com" + p) {
			t.Errorf("ValidURL con la ruta %q = false, want true", p)
		}
	}
}

// shorten acorta las URL largas para los nombres de los subtests y los mensajes (sin repetir 2000 caracteres).
func shorten(u string) string {
	if len(u) > 80 {
		return u[:60] + "...(" + strconv.Itoa(len(u)) + ")"
	}
	return u
}
