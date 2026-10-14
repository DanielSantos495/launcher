package main

import (
	"bytes"
	"strings"
	"testing"
)

func TestRunUsage(t *testing.T) {
	for _, args := range [][]string{nil, {}, {"nope"}, {"--version"}, {"chrome-extension:/"}} {
		var stdout, stderr bytes.Buffer
		if code := run(args, strings.NewReader(""), &stdout, &stderr); code != 2 {
			t.Fatalf("run(%q) = %d, quiero 2", args, code)
		}
		if stdout.Len() != 0 || !strings.Contains(stderr.String(), "uso: launcher-host") {
			t.Fatalf("run(%q): stdout %q, stderr %q", args, stdout.String(), stderr.String())
		}
	}
}

func TestRunVersion(t *testing.T) {
	var stdout, stderr bytes.Buffer
	if code := run([]string{"version"}, strings.NewReader(""), &stdout, &stderr); code != 0 {
		t.Fatalf("run(version) = %d", code)
	}
	if stdout.String() != Version+"\n" || stderr.Len() != 0 {
		t.Fatalf("stdout %q, stderr %q", stdout.String(), stderr.String())
	}
}
