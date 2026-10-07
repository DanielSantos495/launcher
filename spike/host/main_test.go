package main

import (
	"io"
	"log"
	"testing"
)

var testCfg = config{Browser: "brave", UserDataDir: "testdata/userdata", LaunchMode: "direct"}

func TestHandleRejectsUnknownVersion(t *testing.T) {
	req := request{Cmd: "open", Open: OpenRequest{V: 2, ProfileDirectory: "Default", URL: "https://example.com"}}
	resp := handle(req, testCfg, log.New(io.Discard, "", 0))
	if resp["ok"] != false || resp["error"] != "unsupported protocol version" {
		t.Fatalf("resp = %v", resp)
	}
}

func TestHandleRejectsUnknownCommand(t *testing.T) {
	resp := handle(request{Cmd: "rm"}, testCfg, log.New(io.Discard, "", 0))
	if resp["ok"] != false || resp["error"] != "unknown command" {
		t.Fatalf("resp = %v", resp)
	}
}

func TestHandleOpenRejectsContainerMissingInTargetProfile(t *testing.T) {
	// "SpikeA" existe en Default, pero no en Profile 1: los contenedores son por perfil.
	req := request{Cmd: "open", Open: OpenRequest{V: 1, ProfileDirectory: "Profile 1", Container: "SpikeA", URL: "https://example.com"}}
	resp := handle(req, testCfg, log.New(io.Discard, "", 0))
	if resp["ok"] != false || resp["error"] != errUnknownContainer.Error() {
		t.Fatalf("resp = %v", resp)
	}
}

func TestHandleListProfiles(t *testing.T) {
	resp := handle(request{Cmd: "listProfiles"}, testCfg, log.New(io.Discard, "", 0))
	profiles, ok := resp["profiles"].(map[string]string)
	if resp["ok"] != true || !ok || profiles["Profile 1"] != "Spike B" || len(profiles) != 2 {
		t.Fatalf("resp = %v", resp)
	}
}
