package install

import (
	"os"
	"path/filepath"

	"github.com/DanielSantos495/launcher/native-host/internal/caller"
)

// winEnv son las carpetas de Windows de las que salen las rutas. Las que estén vacías se ignoran.
type winEnv struct {
	LocalAppData    string // %LOCALAPPDATA%
	ProgramFiles    string // %ProgramFiles%
	ProgramFilesX86 string // %ProgramFiles(x86)%
}

func winEnvFromOS(localAppData string) winEnv {
	return winEnv{
		LocalAppData:    localAppData,
		ProgramFiles:    os.Getenv("ProgramFiles"),
		ProgramFilesX86: os.Getenv("ProgramFiles(x86)"),
	}
}

// windowsAppDir es la carpeta de instalación del host de un navegador: %LOCALAPPDATA%\AccountLauncher\<navegador>.
func windowsAppDir(localAppData, browser string) string {
	return filepath.Join(localAppData, "AccountLauncher", browser)
}

// windowsBrowsers devuelve los navegadores de Windows en el orden brave, chrome, edge (§7.4 del diseño). El ejecutable
// por defecto es el primero de las rutas estándar que existe según isFile o, si ninguno existe, el primero de la
// lista. El manifest va en la carpeta de instalación del host: en Windows el navegador lo encuentra por el registro.
func windowsBrowsers(env winEnv, isFile func(string) bool) []Browser {
	join := func(base string, elems ...string) string {
		if base == "" {
			return ""
		}
		return filepath.Join(append([]string{base}, elems...)...)
	}
	pick := func(candidates ...string) string {
		first := ""
		for _, c := range candidates {
			if c == "" {
				continue
			}
			if first == "" {
				first = c
			}
			if isFile(c) {
				return c
			}
		}
		return first
	}
	mk := func(name, userData string, exes ...string) Browser {
		app := windowsAppDir(env.LocalAppData, name)
		return Browser{
			Name:         name,
			Exe:          pick(exes...),
			UserDataDir:  userData,
			ManifestDir:  app,
			RegistryKeys: registryKeys(name),
		}
	}
	return []Browser{
		mk("brave", join(env.LocalAppData, "BraveSoftware", "Brave-Browser", "User Data"),
			join(env.ProgramFiles, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
			join(env.LocalAppData, "BraveSoftware", "Brave-Browser", "Application", "brave.exe")),
		mk("chrome", join(env.LocalAppData, "Google", "Chrome", "User Data"),
			join(env.ProgramFiles, "Google", "Chrome", "Application", "chrome.exe"),
			join(env.ProgramFilesX86, "Google", "Chrome", "Application", "chrome.exe"),
			join(env.LocalAppData, "Google", "Chrome", "Application", "chrome.exe")),
		mk("edge", join(env.LocalAppData, "Microsoft", "Edge", "User Data"),
			join(env.ProgramFilesX86, "Microsoft", "Edge", "Application", "msedge.exe"),
			join(env.ProgramFiles, "Microsoft", "Edge", "Application", "msedge.exe")),
	}
}

// registryKeys son las claves de HKCU donde se registra el manifest de browser. Chrome y Edge: documentación oficial
// (Edge además consulta la de Chrome si no encuentra la suya). Brave no tiene documentación: se escribe su clave y la
// de Chrome, como en macOS, donde Brave lee la carpeta de Chrome (F0 pendiente en Windows).
func registryKeys(browser string) []string {
	const tail = `\NativeMessagingHosts\`
	name := caller.HostName(browser)
	chrome := `HKCU\Software\Google\Chrome` + tail + name
	switch browser {
	case "brave":
		return []string{`HKCU\Software\BraveSoftware\Brave-Browser` + tail + name, chrome}
	case "chrome":
		return []string{chrome}
	case "edge":
		return []string{`HKCU\Software\Microsoft\Edge` + tail + name}
	}
	return nil
}
