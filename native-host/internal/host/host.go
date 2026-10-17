// Package host es el router de comandos del host nativo: recibe una petición ya validada por protocol.Validate y
// devuelve la respuesta. Une la configuración, los perfiles del navegador, el lanzador y el almacén compartido. Ningún
// error de Go llega a la respuesta: todos se traducen a un código del contrato (internal casi siempre), porque los
// errores del sistema de archivos llevan rutas con el nombre de usuario.
package host

import (
	"io"
	"time"

	"github.com/DanielSantos495/launcher/native-host/internal/caller"
	"github.com/DanielSantos495/launcher/native-host/internal/launch"
	"github.com/DanielSantos495/launcher/native-host/internal/pairing"
	"github.com/DanielSantos495/launcher/native-host/internal/protocol"
	"github.com/DanielSantos495/launcher/native-host/internal/store"
)

// Env es todo lo que el router necesita del exterior. Las pruebas inyectan el reloj, la aleatoriedad, el lanzador y la
// comprobación de rutas.
type Env struct {
	Config      caller.Config
	DataDir     string // carpeta del binario: shared.json, icons/, host.log
	Version     string // hostVersion de ping (como mucho 32 caracteres)
	Now         func() time.Time
	Rand        io.Reader
	Starter     launch.Starter
	Exists      func(path string) bool
	LockTimeout time.Duration // 5 s en producción
}

// maxHostVersion es el máximo de hostVersion en la respuesta de ping.
const maxHostVersion = 32

// fail y internal crean las respuestas de error. Los errores se guardan siempre como *protocol.Error y nunca en una
// interfaz error: un *Error nil dentro de un error haría entrar en pánico a Error().
func fail(c protocol.Code) protocol.Response { return protocol.Failure(protocol.Fail(c)) }

func internal() protocol.Response { return fail(protocol.Internal) }

// Handle ejecuta una petición ya validada. Un pánico (un fallo del host) sale como internal en lugar de cerrar la
// tubería sin respuesta.
func Handle(env Env, req protocol.Request) (resp protocol.Response) {
	defer func() {
		if recover() != nil {
			resp = internal()
		}
	}()
	switch req.Cmd {
	case "ping":
		return ping(env)
	case "listProfiles":
		return listProfiles(env)
	case "open":
		return open(env, req)
	case "openTemporary":
		return openTemporary(env, req)
	case "createProfile":
		return createProfile(env)
	case "pair.start":
		return pairStart(env, req)
	case "pair.join":
		return pairJoin(env, req)
	case "pair.declare":
		return pairDeclare(env, req)
	case "pair.list":
		return pairList(env, req)
	case "pair.remove":
		return pairRemove(env, req)
	case "pair.verify":
		return pairVerify(env, req)
	case "pair.prove":
		return pairProve(env, req)
	case "sync.get":
		return syncGet(env, req)
	case "sync.put":
		return syncPut(env, req)
	case "icons.get":
		return iconsGet(env, req)
	case "icons.put":
		return iconsPut(env, req)
	case "icons.delete":
		return iconsDelete(env, req)
	}
	// Validate ya rechazó los comandos desconocidos: llegar aquí es un fallo del host.
	return internal()
}

// clock es el reloj y la aleatoriedad que usa el emparejamiento.
func (env Env) clock() pairing.Clock { return pairing.Clock{Now: env.Now, Rand: env.Rand} }

// withStore abre el almacén (con el bloqueo exclusivo), carga el estado (nil si shared.json no existe) y ejecuta fn.
// Suelta el bloqueo al terminar. Cualquier fallo del almacén es internal.
func withStore(env Env, fn func(s *store.Store, st *store.State) protocol.Response) protocol.Response {
	s, err := store.Open(env.DataDir, env.LockTimeout)
	if err != nil {
		return internal()
	}
	defer s.Close()
	st, err := s.Load()
	if err != nil {
		return internal()
	}
	return fn(s, st)
}

// authenticate devuelve la respuesta not_paired si token no es de ninguna instalación emparejada. Los comandos con
// token lo llaman antes de mirar nada más del estado (revisión, claves, límites).
func authenticate(st *store.State, token string) *protocol.Error {
	if _, ok := pairing.Authenticate(st, token); !ok {
		return protocol.Fail(protocol.NotPaired)
	}
	return nil
}

// saveIf guarda el estado si changed. Los comandos de pairing lo llaman también cuando devuelven un error del
// protocolo: un intento fallido de pair.join, un código consumido con limit_reached, tienen que persistir.
func saveIf(s *store.Store, st *store.State, changed bool) bool {
	return !changed || s.Save(st) == nil
}
