package host

import (
	"encoding/json"

	"github.com/DanielSantos495/launcher/native-host/internal/protocol"
	"github.com/DanielSantos495/launcher/native-host/internal/store"
)

// syncGetResult arma el resultado de sync.get con data y bindings tal como están guardados. Data nil se escribe null
// (almacén vacío). Bindings nunca puede ser nil: un RawMessage nil se escribe null y la extensión rechaza ese
// resultado, así que como mínimo es {}.
func syncGetResult(st *store.State) protocol.SyncGetResult {
	bindings := st.Bindings
	if len(bindings) == 0 {
		bindings = json.RawMessage("{}")
	}
	return protocol.SyncGetResult{Revision: st.Revision, Data: st.Data, Bindings: bindings}
}

func syncGet(env Env, req protocol.Request) protocol.Response {
	return withStore(env, func(_ *store.Store, st *store.State) protocol.Response {
		if perr := authenticate(st, req.Token); perr != nil {
			return protocol.Failure(perr)
		}
		return protocol.OK(syncGetResult(st))
	})
}

func syncPut(env Env, req protocol.Request) protocol.Response {
	return withStore(env, func(s *store.Store, st *store.State) protocol.Response {
		// Primero la identidad: con un token desconocido no se revela la revisión (conflict) ni se toca nada.
		if perr := authenticate(st, req.Token); perr != nil {
			return protocol.Failure(perr)
		}
		revision, perr := st.Put(req.BaseRevision, req.Data, req.Bindings)
		if perr != nil {
			return protocol.Failure(perr)
		}
		if s.Save(st) != nil {
			return internal()
		}
		return protocol.OK(protocol.SyncPutResult{Revision: revision})
	})
}
