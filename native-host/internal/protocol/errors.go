package protocol

// Code es un código de error estable del contrato (HOST_ERROR_CODES de packages/protocol/src/host.ts).
type Code string

const (
	BadRequest         Code = "bad_request"
	UnsupportedVersion Code = "unsupported_version"
	UnknownCommand     Code = "unknown_command"
	TooLarge           Code = "too_large"
	BadURL             Code = "bad_url"
	BadName            Code = "bad_name"
	NameInUse          Code = "name_in_use"
	UnknownProfile     Code = "unknown_profile"
	UnsupportedBrowser Code = "unsupported_browser"
	NotPaired          Code = "not_paired"
	BadCode            Code = "bad_code"
	LimitReached       Code = "limit_reached"
	Conflict           Code = "conflict"
	BadNonce           Code = "bad_nonce"
	NotFound           Code = "not_found"
	LaunchFailed       Code = "launch_failed"
	Internal           Code = "internal"
)

// AllCodes son los 17 códigos, en el orden de HOST_ERROR_CODES.
var AllCodes = []Code{
	BadRequest, UnsupportedVersion, UnknownCommand, TooLarge, BadURL, BadName, NameInUse, UnknownProfile,
	UnsupportedBrowser, NotPaired, BadCode, LimitReached, Conflict, BadNonce, NotFound, LaunchFailed, Internal,
}

// Error es un fallo del protocolo: solo lleva el código (y la revisión actual con Conflict). Nunca lleva datos
// recibidos: los errores no incluyen URLs, emails, notas ni valores del mensaje.
type Error struct {
	Code Code
	// Revision solo cuenta con Code == Conflict (la revisión actual del almacén).
	Revision int64
}

// Error devuelve el código y nada más.
func (e *Error) Error() string { return string(e.Code) }

// Fail crea un error con el código c.
func Fail(c Code) *Error { return &Error{Code: c} }

// ConflictAt crea el error conflict con la revisión actual del almacén.
func ConflictAt(revision int64) *Error { return &Error{Code: Conflict, Revision: revision} }
