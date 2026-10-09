package protocol_test

import (
	"testing"
	"time"

	"github.com/DanielSantos495/launcher/native-host/internal/protocol"
)

// TestLimits fija cada constante con su valor en packages/protocol/src/limits.ts y en el README del contrato:
// cambiar una obliga a cambiar la prueba, el contrato y la extension.
func TestLimits(t *testing.T) {
	tests := []struct {
		name string
		got  int64
		want int64
	}{
		{"ProtocolVersion", protocol.ProtocolVersion, 1},
		{"MaxRequestBytes", protocol.MaxRequestBytes, 1024 * 1024},
		{"MaxRequestBytes literal", protocol.MaxRequestBytes, 1048576},
		{"MaxResponseBytes", protocol.MaxResponseBytes, 1000000},
		{"MaxSharedDataBytes", protocol.MaxSharedDataBytes, 512 * 1024},
		{"MaxSharedDataBytes literal", protocol.MaxSharedDataBytes, 524288},
		{"MaxSharedBindingsBytes", protocol.MaxSharedBindingsBytes, 128 * 1024},
		{"MaxSharedBindingsBytes literal", protocol.MaxSharedBindingsBytes, 131072},
		{"MaxIconBytes", protocol.MaxIconBytes, 32 * 1024},
		{"MaxIconBytes literal", protocol.MaxIconBytes, 32768},
		// ceil(32768 / 3) * 4: lo que ocupa en base64 con relleno el icono mas grande.
		{"MaxBase64Chars", protocol.MaxBase64Chars, 43692},
		{"MaxBase64Chars derivado", protocol.MaxBase64Chars, (protocol.MaxIconBytes + 2) / 3 * 4},
		{"DefaultMaxPairedProfiles", protocol.DefaultMaxPairedProfiles, 2},
		{"MaxPairedProfilesLimit", protocol.MaxPairedProfilesLimit, 16},
		{"MaxContainerName", protocol.MaxContainerName, 64},
		{"MaxBindings", protocol.MaxBindings, 100},
		{"MaxURLLength", protocol.MaxURLLength, 2048},
		{"MaxProfiles", protocol.MaxProfiles, 500},
		{"MaxInstallations", protocol.MaxInstallations, 16},
		{"MaxProfileName", protocol.MaxProfileName, 256},
		{"MaxSafeInteger", protocol.MaxSafeInteger, 9007199254740991},
		{"MaxSafeInteger derivado", protocol.MaxSafeInteger, 1<<53 - 1},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if tc.got != tc.want {
				t.Fatalf("got %d, want %d", tc.got, tc.want)
			}
		})
	}

	if protocol.PairCodeTTL != 120*time.Second {
		t.Fatalf("PairCodeTTL = %v, want 120s", protocol.PairCodeTTL)
	}
	if protocol.ProofTTL != 60*time.Second {
		t.Fatalf("ProofTTL = %v, want 60s", protocol.ProofTTL)
	}
}

// TestErrorCodes fija los 17 codigos y su orden (HOST_ERROR_CODES de packages/protocol/src/host.ts).
func TestErrorCodes(t *testing.T) {
	want := []string{
		"bad_request", "unsupported_version", "unknown_command", "too_large", "bad_url", "bad_name", "name_in_use",
		"unknown_profile", "unsupported_browser", "not_paired", "bad_code", "limit_reached", "conflict", "bad_nonce",
		"not_found", "launch_failed", "internal",
	}
	if len(protocol.AllCodes) != len(want) {
		t.Fatalf("AllCodes tiene %d codigos, want %d", len(protocol.AllCodes), len(want))
	}
	for i, c := range protocol.AllCodes {
		if string(c) != want[i] {
			t.Errorf("AllCodes[%d] = %q, want %q", i, c, want[i])
		}
	}

	named := map[protocol.Code]string{
		protocol.BadRequest: "bad_request", protocol.UnsupportedVersion: "unsupported_version",
		protocol.UnknownCommand: "unknown_command", protocol.TooLarge: "too_large", protocol.BadURL: "bad_url",
		protocol.BadName: "bad_name", protocol.NameInUse: "name_in_use", protocol.UnknownProfile: "unknown_profile",
		protocol.UnsupportedBrowser: "unsupported_browser", protocol.NotPaired: "not_paired",
		protocol.BadCode: "bad_code", protocol.LimitReached: "limit_reached", protocol.Conflict: "conflict",
		protocol.BadNonce: "bad_nonce", protocol.NotFound: "not_found", protocol.LaunchFailed: "launch_failed",
		protocol.Internal: "internal",
	}
	for c, s := range named {
		if string(c) != s {
			t.Errorf("la constante de %q vale %q", s, c)
		}
	}
	if len(named) != len(want) {
		t.Errorf("hay %d constantes con nombre, want %d", len(named), len(want))
	}
}

// TestErrorHasNoData: el texto del error es solo el codigo, nunca datos (lista de calidad, punto 1).
func TestErrorHasNoData(t *testing.T) {
	for _, c := range protocol.AllCodes {
		if got := protocol.Fail(c).Error(); got != string(c) {
			t.Errorf("Fail(%q).Error() = %q", c, got)
		}
	}
	e := protocol.ConflictAt(7)
	if e.Code != protocol.Conflict || e.Revision != 7 || e.Error() != "conflict" {
		t.Fatalf("ConflictAt(7) = %+v (%q)", *e, e.Error())
	}
	if f := protocol.Fail(protocol.NotFound); f.Revision != 0 {
		t.Fatalf("Fail no debe llevar revision, got %d", f.Revision)
	}
}
