package main

import (
	"bytes"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/DanielSantos495/launcher/native-host/internal/caller"
	"github.com/DanielSantos495/launcher/native-host/internal/framing"
	"github.com/DanielSantos495/launcher/native-host/internal/protocol"
)

// buildHost compila el binario del host en una carpeta temporal y le escribe un config.json con exe.
func buildHost(t *testing.T, exe string) (bin string) {
	t.Helper()
	dir := t.TempDir()
	bin = filepath.Join(dir, "launcher-host")
	build := exec.Command("go", "build", "-o", bin, ".")
	if out, err := build.CombinedOutput(); err != nil {
		t.Fatalf("go build: %v\n%s", err, out)
	}
	userDir := t.TempDir()
	copyTree(t, filepath.Join("..", "..", "testdata", "macos"), userDir)
	cfg := caller.Config{
		Browser: "brave", Exe: exe, UserDataDir: userDir, ExtensionID: testExtensionID,
		BinarySHA256: strings.Repeat("0", 64),
	}
	b, err := cfg.Encode()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, caller.ConfigFile), b, 0o600); err != nil {
		t.Fatal(err)
	}
	return bin
}

// runHostBinary ejecuta el binario con un mensaje enmarcado en stdin y devuelve la respuesta. El proceso padre del
// host es este binario de prueba, que es lo que verifica caller.ParentExe con lsof.
func runHostBinary(t *testing.T, bin, message string) string {
	t.Helper()
	cmd := exec.Command(bin, caller.Origin(testExtensionID))
	cmd.Stdin = bytes.NewReader(frame([]byte(message)))
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	done := make(chan error, 1)
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	go func() { done <- cmd.Wait() }()
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("el host terminó con error: %v\nstderr: %s", err, stderr.String())
		}
	case <-time.After(30 * time.Second):
		_ = cmd.Process.Kill()
		t.Fatal("el host no terminó")
	}
	if stderr.Len() != 0 {
		t.Fatalf("el host escribió en stderr: %s", stderr.String())
	}
	body, err := framing.ReadMessage(&stdout, protocol.MaxResponseBytes)
	if err != nil {
		t.Fatalf("respuesta ilegible: %v", err)
	}
	return string(body)
}

func TestEndToEndPing(t *testing.T) {
	self, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	bin := buildHost(t, self)
	if got := runHostBinary(t, bin, pingRequest); got != pingResponse {
		t.Fatalf("ping = %s\nquiero  %s", got, pingResponse)
	}
}

func TestEndToEndRejectsAnotherParent(t *testing.T) {
	// El padre real (este binario de prueba) no es el ejecutable que dice la configuración.
	bin := buildHost(t, "/Applications/Fake Browser.app/Contents/MacOS/Fake Browser")
	if got := runHostBinary(t, bin, pingRequest); got != errBody("unsupported_browser") {
		t.Fatalf("ping = %s, quiero unsupported_browser", got)
	}
}
