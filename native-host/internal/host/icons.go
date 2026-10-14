package host

import (
	"github.com/DanielSantos495/launcher/native-host/internal/protocol"
	"github.com/DanielSantos495/launcher/native-host/internal/store"
)

func iconsGet(env Env, req protocol.Request) protocol.Response {
	return withStore(env, func(s *store.Store, st *store.State) protocol.Response {
		if perr := authenticate(st, req.Token); perr != nil {
			return protocol.Failure(perr)
		}
		icon, found, err := s.GetIcon(req.Key)
		if err != nil {
			return internal()
		}
		if !found {
			return fail(protocol.NotFound)
		}
		return protocol.OK(protocol.IconsGetResult{Key: req.Key, Mime: icon.Mime, Base64: icon.Base64})
	})
}

func iconsPut(env Env, req protocol.Request) protocol.Response {
	return withStore(env, func(s *store.Store, st *store.State) protocol.Response {
		if perr := authenticate(st, req.Token); perr != nil {
			return protocol.Failure(perr)
		}
		if perr := s.PutIcon(req.Key, store.Icon{Mime: req.Mime, Base64: req.Base64}); perr != nil {
			return protocol.Failure(perr)
		}
		return protocol.OK(protocol.Empty{})
	})
}

func iconsDelete(env Env, req protocol.Request) protocol.Response {
	return withStore(env, func(s *store.Store, st *store.State) protocol.Response {
		if perr := authenticate(st, req.Token); perr != nil {
			return protocol.Failure(perr)
		}
		if err := s.DeleteIcon(req.Key); err != nil {
			return internal()
		}
		return protocol.OK(protocol.Empty{})
	})
}
