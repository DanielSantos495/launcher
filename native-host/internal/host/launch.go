package host

import (
	"github.com/DanielSantos495/launcher/native-host/internal/launch"
	"github.com/DanielSantos495/launcher/native-host/internal/profiles"
	"github.com/DanielSantos495/launcher/native-host/internal/protocol"
)

// ping devuelve la versión del host, el navegador y la versión (Last Version) si es válida.
func ping(env Env) protocol.Response {
	if n := len(env.Version); n == 0 || n > maxHostVersion {
		return internal()
	}
	res := protocol.PingResult{
		HostVersion: env.Version,
		Protocol:    protocol.ProtocolVersion,
		Browser:     env.Config.Browser,
	}
	if v, ok := profiles.ReadLastVersion(env.Config.UserDataDir); ok {
		res.BrowserVersion = v
		res.Features.TemporaryContainer = launch.SupportsTemporaryContainer(env.Config.Browser, v)
	}
	return protocol.OK(res)
}

func listProfiles(env Env) protocol.Response {
	ls, err := profiles.ReadLocalState(env.Config.UserDataDir)
	if err != nil {
		return internal()
	}
	return protocol.OK(protocol.ListProfilesResult{Profiles: ls.List()})
}

// startBrowser lanza el navegador configurado con args. El ejecutable sale siempre de la configuración.
func startBrowser(env Env, args []string) *protocol.Error {
	if err := env.Starter.Start(env.Config.Exe, args); err != nil {
		return protocol.Fail(protocol.LaunchFailed)
	}
	return nil
}

func open(env Env, req protocol.Request) protocol.Response {
	ls, err := profiles.ReadLocalState(env.Config.UserDataDir)
	if err != nil {
		return internal()
	}
	if !ls.Known(req.ProfileDirectory) {
		return fail(protocol.UnknownProfile)
	}
	args, err := launch.OpenArgs(req.ProfileDirectory, req.URL)
	if err != nil {
		return internal()
	}
	if perr := startBrowser(env, args); perr != nil {
		return protocol.Failure(perr)
	}
	return protocol.OK(protocol.Empty{})
}

func openTemporary(env Env, req protocol.Request) protocol.Response {
	// D16: solo Brave con Last Version legible y >= 1.95.
	lastVersion, _ := profiles.ReadLastVersion(env.Config.UserDataDir)
	if !launch.SupportsTemporaryContainer(env.Config.Browser, lastVersion) {
		return fail(protocol.UnsupportedBrowser)
	}
	ls, err := profiles.ReadLocalState(env.Config.UserDataDir)
	if err != nil {
		return internal()
	}
	if !ls.Known(req.ProfileDirectory) {
		return fail(protocol.UnknownProfile)
	}
	if req.Name != "" {
		containers, err := profiles.ReadContainers(env.Config.UserDataDir, req.ProfileDirectory)
		if err != nil {
			return internal()
		}
		if launch.ContainerNameTaken(req.Name, containers) {
			return fail(protocol.NameInUse)
		}
	}
	args, err := launch.TemporaryArgs(req.ProfileDirectory, req.URL, req.Name)
	if err != nil {
		return internal()
	}
	if perr := startBrowser(env, args); perr != nil {
		return protocol.Failure(perr)
	}
	return protocol.OK(protocol.Empty{})
}

func createProfile(env Env) protocol.Response {
	ls, err := profiles.ReadLocalState(env.Config.UserDataDir)
	if err != nil {
		return internal()
	}
	dir, err := launch.NewProfileDirectory(env.Rand, ls, env.Config.UserDataDir, env.Exists)
	if err != nil {
		return internal()
	}
	args, err := launch.CreateProfileArgs(dir)
	if err != nil {
		return internal()
	}
	if perr := startBrowser(env, args); perr != nil {
		return protocol.Failure(perr)
	}
	return protocol.OK(protocol.CreateProfileResult{Directory: dir})
}
