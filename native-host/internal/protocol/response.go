package protocol

import (
	"bytes"
	"encoding/json"
	"slices"
)

// Empty es el result de los comandos que no devuelven datos: se escribe como {}.
type Empty struct{}

type PingFeatures struct {
	TemporaryContainer bool `json:"temporaryContainer"`
}

type PingResult struct {
	HostVersion    string       `json:"hostVersion"`
	Protocol       int          `json:"protocol"`
	Browser        string       `json:"browser"`
	BrowserVersion string       `json:"browserVersion,omitempty"`
	Features       PingFeatures `json:"features"`
}

type ProfileInfo struct {
	Directory          string `json:"directory"`
	Name               string `json:"name"`
	IsUsingDefaultName bool   `json:"isUsingDefaultName"`
	Color              string `json:"color,omitempty"`
}

// ListProfilesResult.Profiles debe crearse con make([]ProfileInfo, 0): un slice nil se escribiría como null.
type ListProfilesResult struct {
	Profiles []ProfileInfo `json:"profiles"`
}

type CreateProfileResult struct {
	Directory string `json:"directory"`
}

type PairStartResult struct {
	Code      string `json:"code"`
	ExpiresAt string `json:"expiresAt"`
	Token     string `json:"token,omitempty"`
}

type PairJoinResult struct {
	Token string `json:"token"`
}

type InstallationInfo struct {
	InstallationID   string `json:"installationId"`
	IdentityID       string `json:"identityId,omitempty"`
	ProfileDirectory string `json:"profileDirectory,omitempty"`
	PairedAt         string `json:"pairedAt"`
	VerifiedAt       string `json:"verifiedAt,omitempty"`
	Self             bool   `json:"self"`
}

// PairListResult.Installations debe crearse con make([]InstallationInfo, 0): un slice nil se escribiría como null.
type PairListResult struct {
	MaxPairedProfiles int                `json:"maxPairedProfiles"`
	Installations     []InstallationInfo `json:"installations"`
}

type PairVerifyResult struct {
	ExpiresAt string `json:"expiresAt"`
}

type PairProveResult struct {
	VerifiedAt string `json:"verifiedAt"`
}

// SyncGetResult lleva data y bindings tal como los recibió el host (json.RawMessage), sin decodificarlos. Data nil se
// escribe null (el almacén vacío); Bindings nunca puede ser nil: tiene que ser al menos {}.
type SyncGetResult struct {
	Revision int64           `json:"revision"`
	Data     json.RawMessage `json:"data"`
	Bindings json.RawMessage `json:"bindings"`
}

type SyncPutResult struct {
	Revision int64 `json:"revision"`
}

type IconsGetResult struct {
	Key    string `json:"key"`
	Mime   string `json:"mime"`
	Base64 string `json:"base64"`
}

// Response es lo que el host contesta: un resultado o un error (si Err no es nil, gana el error).
type Response struct {
	Result any
	Err    *Error
}

// OK crea una respuesta correcta. Un result nil se escribe como {}.
func OK(result any) Response { return Response{Result: result} }

// Failure crea una respuesta de error. Un error nil se trata como internal: nunca puede salir como correcta.
func Failure(e *Error) Response {
	if e == nil {
		e = Fail(Internal)
	}
	return Response{Err: e}
}

type okEnvelope struct {
	OK     bool `json:"ok"`
	Result any  `json:"result"`
}

type errorEnvelope struct {
	OK    bool      `json:"ok"`
	Error errorBody `json:"error"`
}

// errorBody solo lleva revision con conflict.
type errorBody struct {
	Code     Code   `json:"code"`
	Revision *int64 `json:"revision,omitempty"`
}

// internalResponse es la respuesta de la salvaguarda, escrita a mano para que no pueda fallar.
var internalResponse = []byte(`{"ok":false,"error":{"code":"internal"}}`)

// Encode escribe {"ok":true,"result":…} o {"ok":false,"error":{"code":…[,"revision":n]}} con json.Encoder,
// SetEscapeHTML(false) y sin el salto de línea final. Nunca json.Marshal: escaparía <, > y & dentro de data. Si el
// resultado no se puede codificar, no es un objeto o la respuesta supera MaxResponseBytes, devuelve la respuesta
// de Internal.
func Encode(resp Response) []byte {
	out, ok := encode(resp)
	if !ok || len(out) > MaxResponseBytes {
		return slices.Clone(internalResponse)
	}
	return out
}

func encode(resp Response) ([]byte, bool) {
	var envelope any
	if e := resp.Err; e != nil {
		if !slices.Contains(AllCodes, e.Code) {
			return nil, false
		}
		body := errorBody{Code: e.Code}
		if e.Code == Conflict {
			if e.Revision < 0 || e.Revision > MaxSafeInteger {
				return nil, false
			}
			revision := e.Revision
			body.Revision = &revision
		}
		envelope = errorEnvelope{OK: false, Error: body}
	} else {
		result := resp.Result
		if result == nil {
			result = Empty{}
		}
		envelope = okEnvelope{OK: true, Result: result}
	}

	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(envelope); err != nil {
		return nil, false
	}
	out := bytes.TrimSuffix(buf.Bytes(), []byte("\n"))
	// El result de una respuesta correcta es siempre un objeto (la extensión descarta un array o un null).
	if resp.Err == nil && !bytes.HasPrefix(out, []byte(`{"ok":true,"result":{`)) {
		return nil, false
	}
	return out, true
}
