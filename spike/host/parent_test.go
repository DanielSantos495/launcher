package main

import (
	"bytes"
	"log"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestParseLsofTxt(t *testing.T) {
	// Salida real de `lsof -a -p <pid> -d txt -Fn` (macOS): la primera entrada txt es el ejecutable.
	out := "p91980\nftxt\nn/Applications/Brave Browser.app/Contents/MacOS/Brave Browser\nftxt\nn/usr/lib/dyld\n"
	got, err := parseLsofTxt([]byte(out))
	if err != nil || got != "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser" {
		t.Fatalf("got %q, %v", got, err)
	}
	for _, bad := range []string{"", "p1\n", "p1\nftxt\nnBrave Browser\n"} {
		if _, err := parseLsofTxt([]byte(bad)); err == nil {
			t.Errorf("%q: want error (sin entrada o ruta no absoluta)", bad)
		}
	}
}

func TestParentMatch(t *testing.T) {
	exe := "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"
	cases := []struct {
		parent, exe string
		want        bool
	}{
		{exe, exe, true},
		{"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", exe, false},
		{"", exe, false},
		{exe, "", false},
		{"", "", false},
	}
	for _, tc := range cases {
		if got := parentMatch(tc.parent, tc.exe); got != tc.want {
			t.Errorf("parentMatch(%q, %q) = %v, want %v", tc.parent, tc.exe, got, tc.want)
		}
	}
}

func TestParentExeOfSelf(t *testing.T) {
	if runtime.GOOS != "darwin" {
		t.Skip("solo macOS")
	}
	self, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	got, err := parentExe(os.Getpid())
	if err != nil || filepath.Base(got) != filepath.Base(self) {
		t.Fatalf("got %q, %v; want base %q", got, err, filepath.Base(self))
	}
}

func TestParentExeRejectsBadPID(t *testing.T) {
	for _, pid := range []int{-1, 0, 1} {
		if _, err := parentExe(pid); err == nil {
			t.Errorf("pid %d: want error", pid)
		}
	}
}

func TestHandlePingReportsParentWithoutLoggingPath(t *testing.T) {
	var buf bytes.Buffer
	resp := handle(request{Cmd: "ping"}, testCfg, log.New(&buf, "", 0))
	parent, ok := resp["parentExe"].(string)
	if resp["ok"] != true || !ok || parent == "" {
		t.Fatalf("resp = %v", resp)
	}
	if _, ok := resp["parentMs"]; !ok {
		t.Fatalf("resp sin parentMs: %v", resp)
	}
	logged := buf.String()
	if !strings.Contains(logged, "ping parent match=") {
		t.Fatalf("log = %q", logged)
	}
	if strings.HasPrefix(parent, "/") && strings.Contains(logged, parent) {
		t.Fatalf("el log contiene la ruta del padre: %q", logged)
	}
	if runtime.GOOS == "darwin" && resp["parentMatch"] != false {
		// testCfg no tiene exe: el padre (go test) nunca coincide.
		t.Fatalf("parentMatch = %v, want false (parentExe=%v)", resp["parentMatch"], resp["parentExe"])
	}
}
