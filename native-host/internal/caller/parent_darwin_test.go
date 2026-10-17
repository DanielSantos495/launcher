//go:build darwin

package caller

import (
	"os"
	"path/filepath"
	"testing"
)

// TestParentExeOfSelf lanza /usr/sbin/lsof contra el propio proceso de prueba: la ruta que da debe ser la de este
// ejecutable (tras resolver enlaces simbolicos, porque /var es un enlace a /private/var).
func TestParentExeOfSelf(t *testing.T) {
	self, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	want, err := filepath.EvalSymlinks(self)
	if err != nil {
		t.Fatal(err)
	}
	got, err := ParentExe(os.Getpid())
	if err != nil {
		t.Fatal(err)
	}
	if !filepath.IsAbs(got) {
		t.Fatalf("ParentExe = %q, no es absoluta", got)
	}
	if resolved, err := filepath.EvalSymlinks(got); err != nil || resolved != want {
		t.Fatalf("ParentExe = %q (%v), want %q", got, err, want)
	}
}

// TestCheckParentWithRealLookup junta CheckParent y ParentExe: este proceso es su propio "padre".
func TestCheckParentWithRealLookup(t *testing.T) {
	self, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	if err := CheckParent(testConfig(self), os.Getpid(), ParentExe); err != nil {
		t.Fatalf("CheckParent = %v, want nil", err)
	}
	other := testConfig(braveExe)
	if err := CheckParent(other, os.Getpid(), ParentExe); err == nil {
		t.Fatal("CheckParent con otro exe: want error")
	}
}

func TestParentExeUnknownPID(t *testing.T) {
	// Un pid que casi seguro no existe: lsof no da ninguna entrada txt y debe haber error.
	if got, err := ParentExe(0x7ffffffe); err == nil {
		t.Fatalf("ParentExe = %q, want error", got)
	}
}
