package main

import (
	"errors"
	"strings"
	"testing"
)

func TestValidateOpen(t *testing.T) {
	profiles := map[string]string{"Default": "Work", "Profile 1": "Spike B"}
	containers := map[string]bool{"SpikeA": true, "Spike B": true, "Diseño": true}
	cases := []struct {
		name    string
		req     OpenRequest
		wantErr error
		wantURL string
	}{
		{"ok https", OpenRequest{V: 1, ProfileDirectory: "Default", URL: "https://github.com/"}, nil, "https://github.com/"},
		{"ok container with accent", OpenRequest{V: 1, ProfileDirectory: "Default", Container: "Diseño", URL: "https://example.com"}, nil, "https://example.com"},
		{"ok container with space", OpenRequest{V: 1, ProfileDirectory: "Default", Container: "Spike B", URL: "https://example.com"}, nil, "https://example.com"},
		{"escapes spaces", OpenRequest{V: 1, ProfileDirectory: "Default", URL: "https://example.com/a b#frag"}, nil, "https://example.com/a%20b#frag"},
		{"unknown profile", OpenRequest{V: 1, ProfileDirectory: "Profile 9", URL: "https://example.com"}, errUnknownProfile, ""},
		{"guest profile", OpenRequest{V: 1, ProfileDirectory: "Guest Profile", URL: "https://example.com"}, errUnknownProfile, ""},
		{"javascript scheme", OpenRequest{V: 1, ProfileDirectory: "Default", URL: "javascript:alert(1)"}, errBadURL, ""},
		{"file scheme", OpenRequest{V: 1, ProfileDirectory: "Default", URL: "file:///etc/passwd"}, errBadURL, ""},
		{"userinfo", OpenRequest{V: 1, ProfileDirectory: "Default", URL: "https://user:pass@example.com"}, errBadURL, ""},
		{"leading dash", OpenRequest{V: 1, ProfileDirectory: "Default", URL: "--incognito"}, errBadURL, ""},
		{"control char", OpenRequest{V: 1, ProfileDirectory: "Default", URL: "https://example.com/\n--incognito"}, errBadURL, ""},
		{"too long", OpenRequest{V: 1, ProfileDirectory: "Default", URL: "https://example.com/" + strings.Repeat("a", maxURLLen)}, errBadURL, ""},
		{"container wrong case", OpenRequest{V: 1, ProfileDirectory: "Default", Container: "spikea", URL: "https://example.com"}, errUnknownContainer, ""},
		{"container unknown", OpenRequest{V: 1, ProfileDirectory: "Default", Container: "NoExiste", URL: "https://example.com"}, errUnknownContainer, ""},
		{"container with equals", OpenRequest{V: 1, ProfileDirectory: "Default", Container: "a=b", URL: "https://example.com"}, errBadContainer, ""},
		{"container leading dash", OpenRequest{V: 1, ProfileDirectory: "Default", Container: "--incognito", URL: "https://example.com"}, errBadContainer, ""},
		{"container blank", OpenRequest{V: 1, ProfileDirectory: "Default", Container: "   ", URL: "https://example.com"}, errBadContainer, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := validateOpen(tc.req, profiles, containers)
			if !errors.Is(err, tc.wantErr) {
				t.Fatalf("err = %v, want %v", err, tc.wantErr)
			}
			if got != tc.wantURL {
				t.Fatalf("url = %q, want %q", got, tc.wantURL)
			}
		})
	}
}
