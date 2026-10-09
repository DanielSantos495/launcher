// Package protocol implementa el contrato del host con la extensión (packages/protocol/fixtures/README.md):
// valida cada petición con el mismo código de error que los fixtures de TypeScript y escribe las respuestas con la
// forma exacta que la extensión espera. No hace nada con el sistema: solo recibe bytes y devuelve datos.
package protocol

import "time"

// Límites del protocolo. Espejo de packages/protocol/src/limits.ts y de packages/core (LIMITS, MAX_URL_LENGTH);
// limits_test.go fija cada valor.
const (
	ProtocolVersion          = 1
	MaxRequestBytes          = 1048576
	MaxResponseBytes         = 1000000
	MaxSharedDataBytes       = 524288
	MaxSharedBindingsBytes   = 131072
	MaxIconBytes             = 32768
	MaxBase64Chars           = 43692 // ceil(MaxIconBytes / 3) * 4
	PairCodeTTL              = 120 * time.Second
	ProofTTL                 = 60 * time.Second
	DefaultMaxPairedProfiles = 2
	MaxPairedProfilesLimit   = 16
	MaxContainerName         = 64 // puntos de código
	MaxBindings              = 100
	MaxURLLength             = 2048
	MaxProfiles              = 500
	MaxInstallations         = 16
	MaxProfileName           = 256 // unidades UTF-16
	MaxSafeInteger           = 9007199254740991
)
