package protocol

import (
	"encoding/json"
	"slices"
	"strconv"

	"github.com/DanielSantos495/launcher/native-host/internal/jsonx"
)

// Commands son los 17 comandos del contrato, en el orden de la tabla de fixtures/README.md.
var Commands = []string{"ping", "listProfiles", "open", "openTemporary", "createProfile", "pair.start", "pair.join",
	"pair.declare", "pair.list", "pair.remove", "pair.verify", "pair.prove", "sync.get", "sync.put", "icons.get",
	"icons.put", "icons.delete"}

// Request es la petición ya validada. Los opcionales ausentes quedan en "": ningún valor válido es "".
type Request struct {
	Cmd              string
	ProfileDirectory string
	URL              string
	Name             string // openTemporary
	InstallationID   string
	Token            string
	Code             string
	IdentityID       string
	Nonce            string
	BaseRevision     int64
	Data             json.RawMessage // bytes recibidos del valor
	Bindings         json.RawMessage // bytes recibidos del valor
	Key              string
	Mime             string
	Base64           string
}

// field es un argumento de un comando. check valida el valor y lo guarda en la petición; devuelve el error del
// contrato (bad_request, bad_url o bad_name) o nil.
type field struct {
	name     string
	required bool
	check    func(raw json.RawMessage, req *Request) *Error
}

// Validate comprueba un cuerpo (sin el prefijo de longitud) en el orden del contrato y devuelve la petición o el
// primer error. Con error la petición queda vacía, y el error nunca lleva datos del mensaje.
func Validate(body []byte) (Request, *Error) {
	// 1. Tamaño, antes de parsear.
	if len(body) > MaxRequestBytes {
		return Request{}, Fail(TooLarge)
	}
	// 2. Un solo objeto JSON, con UTF-8 válido y sin sustitutos sueltos.
	if !jsonx.CheckText(body) {
		return Request{}, Fail(BadRequest)
	}
	top, ok := jsonx.Object(body)
	if !ok {
		return Request{}, Fail(BadRequest)
	}
	// 3. Versión: exactamente el entero 1 (D1: "1.0" y "1e0" no valen).
	if v, present := top["v"]; !present || string(v) != strconv.Itoa(ProtocolVersion) {
		return Request{}, Fail(UnsupportedVersion)
	}
	// 4. Comando.
	rawCmd, present := top["cmd"]
	if !present {
		return Request{}, Fail(BadRequest)
	}
	cmd, ok := jsonx.String(rawCmd)
	if !ok {
		return Request{}, Fail(BadRequest)
	}
	if !slices.Contains(Commands, cmd) {
		return Request{}, Fail(UnknownCommand)
	}
	// 5. Sobre estricto: solo v, cmd y args, y args es un objeto.
	for key := range top {
		if key != "v" && key != "cmd" && key != "args" {
			return Request{}, Fail(BadRequest)
		}
	}
	rawArgs, present := top["args"]
	if !present {
		return Request{}, Fail(BadRequest)
	}
	args, ok := jsonx.Object(rawArgs)
	if !ok {
		return Request{}, Fail(BadRequest)
	}
	// 6. Argumentos, campo por campo en el orden de la tabla; decide el primero que falla.
	fields, ok := schemas[cmd]
	if !ok {
		// Un comando de Commands sin esquema es un fallo del host: se cierra en falso.
		return Request{}, Fail(Internal)
	}
	req := Request{Cmd: cmd}
	for _, f := range fields {
		raw, present := args[f.name]
		if !present {
			if f.required {
				return Request{}, Fail(BadRequest)
			}
			continue
		}
		if e := f.check(raw, &req); e != nil {
			return Request{}, e
		}
	}
	// Los campos desconocidos se miran al final, cuando todos los del esquema han pasado.
	for key := range args {
		if !slices.ContainsFunc(fields, func(f field) bool { return f.name == key }) {
			return Request{}, Fail(BadRequest)
		}
	}
	// 7. Tamaños de data y bindings: los bytes recibidos de cada valor, solo con la forma ya válida.
	if len(req.Data) > MaxSharedDataBytes || len(req.Bindings) > MaxSharedBindingsBytes {
		return Request{}, Fail(TooLarge)
	}
	return req, nil
}

// textField valida un texto: un tipo distinto de texto es bad_request, y un texto que incumple valid da invalid
// (bad_request, bad_url o bad_name). dest dice dónde guardar el valor.
func textField(name string, required bool, valid func(string) bool, invalid Code, dest func(*Request) *string) field {
	return field{name: name, required: required, check: func(raw json.RawMessage, req *Request) *Error {
		s, ok := jsonx.String(raw)
		if !ok {
			return Fail(BadRequest)
		}
		if !valid(s) {
			return Fail(invalid)
		}
		*dest(req) = s
		return nil
	}}
}

func profileDirectoryField() field {
	return textField("profileDirectory", true, ValidProfileDirectory, BadRequest,
		func(r *Request) *string { return &r.ProfileDirectory })
}

func urlField() field {
	return textField("url", true, ValidURL, BadURL, func(r *Request) *string { return &r.URL })
}

func installationIDField() field {
	return textField("installationId", true, ValidID, BadRequest, func(r *Request) *string { return &r.InstallationID })
}

func tokenField(required bool) field {
	return textField("token", required, ValidToken, BadRequest, func(r *Request) *string { return &r.Token })
}

func keyField() field {
	return textField("key", true, ValidIconKey, BadRequest, func(r *Request) *string { return &r.Key })
}

// baseRevisionField: entero de 0 a 2^53 - 1 escrito solo con dígitos (D2).
func baseRevisionField() field {
	return field{name: "baseRevision", required: true, check: func(raw json.RawMessage, req *Request) *Error {
		n, ok := jsonx.Uint(raw, MaxSafeInteger)
		if !ok {
			return Fail(BadRequest)
		}
		req.BaseRevision = n
		return nil
	}}
}

// dataField: el host solo mira la estructura de data (ADR-004): un objeto con schemaVersion == 1 y revision entre
// 0 y 2^53 - 1. Guarda los bytes recibidos tal cual; el tamaño se comprueba en el paso 7.
func dataField() field {
	return field{name: "data", required: true, check: func(raw json.RawMessage, req *Request) *Error {
		obj, ok := jsonx.Object(raw)
		if !ok {
			return Fail(BadRequest)
		}
		// Si falta una clave, obj devuelve nil y Uint lo rechaza.
		if version, ok := jsonx.Uint(obj["schemaVersion"], 1); !ok || version != 1 {
			return Fail(BadRequest)
		}
		if _, ok := jsonx.Uint(obj["revision"], MaxSafeInteger); !ok {
			return Fail(BadRequest)
		}
		req.Data = raw
		return nil
	}}
}

// bindingsField: un objeto con como mucho MaxBindings claves distintas (las repetidas cuentan una vez, como en
// JSON.parse). El host no valida cada vínculo.
func bindingsField() field {
	return field{name: "bindings", required: true, check: func(raw json.RawMessage, req *Request) *Error {
		obj, ok := jsonx.Object(raw)
		if !ok || len(obj) > MaxBindings {
			return Fail(BadRequest)
		}
		req.Bindings = raw
		return nil
	}}
}

// schemas es la tabla de comandos de fixtures/README.md: los campos de args, en el orden en que se comprueban.
var schemas = map[string][]field{
	"ping":         {},
	"listProfiles": {},
	"open":         {profileDirectoryField(), urlField()},
	"openTemporary": {
		profileDirectoryField(),
		urlField(),
		textField("name", false, ValidContainerName, BadName, func(r *Request) *string { return &r.Name }),
	},
	"createProfile": {},
	"pair.start":    {installationIDField(), tokenField(false)},
	"pair.join": {
		installationIDField(),
		textField("code", true, ValidCode, BadRequest, func(r *Request) *string { return &r.Code }),
	},
	"pair.declare": {
		tokenField(true),
		profileDirectoryField(),
		textField("identityId", false, ValidID, BadRequest, func(r *Request) *string { return &r.IdentityID }),
	},
	"pair.list":   {tokenField(true)},
	"pair.remove": {tokenField(true), installationIDField()},
	"pair.verify": {tokenField(true)},
	"pair.prove": {
		tokenField(true),
		textField("nonce", true, ValidNonce, BadRequest, func(r *Request) *string { return &r.Nonce }),
	},
	"sync.get":  {tokenField(true)},
	"sync.put":  {tokenField(true), baseRevisionField(), dataField(), bindingsField()},
	"icons.get": {tokenField(true), keyField()},
	"icons.put": {
		tokenField(true),
		keyField(),
		textField("mime", true, ValidMime, BadRequest, func(r *Request) *string { return &r.Mime }),
		textField("base64", true, ValidBase64, BadRequest, func(r *Request) *string { return &r.Base64 }),
	},
	"icons.delete": {tokenField(true), keyField()},
}
