package host

import (
	"github.com/DanielSantos495/launcher/native-host/internal/launch"
	"github.com/DanielSantos495/launcher/native-host/internal/pairing"
	"github.com/DanielSantos495/launcher/native-host/internal/profiles"
	"github.com/DanielSantos495/launcher/native-host/internal/protocol"
	"github.com/DanielSantos495/launcher/native-host/internal/store"
)

func pairStart(env Env, req protocol.Request) protocol.Response {
	return withStore(env, func(s *store.Store, st *store.State) protocol.Response {
		// Start devuelve el estado que hay que guardar (nuevo o el mismo) y nil si falla.
		next, res, perr := pairing.Start(st, req.InstallationID, req.Token, env.clock())
		if perr != nil {
			return protocol.Failure(perr)
		}
		if s.Save(next) != nil {
			return internal()
		}
		return protocol.OK(res)
	})
}

func pairJoin(env Env, req protocol.Request) protocol.Response {
	return withStore(env, func(s *store.Store, st *store.State) protocol.Response {
		res, changed, perr := pairing.Join(st, req.InstallationID, req.Code, env.clock())
		// Se guarda aunque haya un error: un intento fallido o un código consumido tienen que persistir.
		if !saveIf(s, st, changed) {
			return internal()
		}
		if perr != nil {
			return protocol.Failure(perr)
		}
		return protocol.OK(res)
	})
}

func pairDeclare(env Env, req protocol.Request) protocol.Response {
	ls, err := profiles.ReadLocalState(env.Config.UserDataDir)
	if err != nil {
		return internal()
	}
	return withStore(env, func(s *store.Store, st *store.State) protocol.Response {
		changed, perr := pairing.Declare(st, req.Token, req.ProfileDirectory, req.IdentityID, ls.Known)
		if !saveIf(s, st, changed) {
			return internal()
		}
		if perr != nil {
			return protocol.Failure(perr)
		}
		return protocol.OK(protocol.Empty{})
	})
}

func pairList(env Env, req protocol.Request) protocol.Response {
	return withStore(env, func(_ *store.Store, st *store.State) protocol.Response {
		res, perr := pairing.List(st, req.Token)
		if perr != nil {
			return protocol.Failure(perr)
		}
		return protocol.OK(res)
	})
}

func pairRemove(env Env, req protocol.Request) protocol.Response {
	return withStore(env, func(s *store.Store, st *store.State) protocol.Response {
		changed, perr := pairing.Remove(st, req.Token, req.InstallationID)
		if !saveIf(s, st, changed) {
			return internal()
		}
		if perr != nil {
			return protocol.Failure(perr)
		}
		return protocol.OK(protocol.Empty{})
	})
}

func pairVerify(env Env, req protocol.Request) protocol.Response {
	ls, err := profiles.ReadLocalState(env.Config.UserDataDir)
	if err != nil {
		return internal()
	}
	var proof pairing.ProofRequest
	resp := withStore(env, func(s *store.Store, st *store.State) protocol.Response {
		p, changed, perr := pairing.Verify(st, req.Token, env.clock(), ls.Known)
		if !saveIf(s, st, changed) {
			return internal()
		}
		if perr != nil {
			return protocol.Failure(perr)
		}
		proof = p
		return protocol.OK(protocol.PairVerifyResult{ExpiresAt: p.ExpiresAt})
	})
	// El navegador se lanza después de guardar y con el bloqueo ya suelto (withStore lo soltó al volver): whoami
	// hace pair.prove enseguida y necesita abrir el almacén.
	if resp.Err != nil {
		return resp
	}
	args, err := launch.WhoamiArgs(proof.ProfileDirectory, env.Config.ExtensionID, proof.Nonce)
	if err != nil {
		return internal()
	}
	if perr := startBrowser(env, args); perr != nil {
		return protocol.Failure(perr)
	}
	return resp
}

func pairProve(env Env, req protocol.Request) protocol.Response {
	return withStore(env, func(s *store.Store, st *store.State) protocol.Response {
		res, changed, perr := pairing.Prove(st, req.Token, req.Nonce, env.clock())
		if !saveIf(s, st, changed) {
			return internal()
		}
		if perr != nil {
			return protocol.Failure(perr)
		}
		return protocol.OK(res)
	})
}
