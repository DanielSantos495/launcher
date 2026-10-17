// Package install instala y diagnostica el host nativo en macOS y Windows: copia el binario, escribe config.json y el manifest
// de native messaging, y comprueba que todo siga en su sitio (doctor). Los mensajes van al usuario que ejecuta el
// subcomando, así que pueden llevar sus rutas; nunca llevan tokens ni nombres de perfil.
package install

import "path/filepath"

// Browser es un navegador admitido en macOS (§7.4 del diseño).
type Browser struct {
	Name        string // brave | chrome | edge
	Exe         string // ejecutable del navegador
	UserDataDir string // datos del navegador (Local State, perfiles)
	ManifestDir string // carpeta de manifests de native messaging que lee ese navegador (en Windows, la del host)
	// RegistryKeys son las claves de HKCU que apuntan al manifest (solo Windows).
	RegistryKeys []string
}

// Browsers devuelve los navegadores para el usuario cuya carpeta personal es home (en Windows, %LOCALAPPDATA%), en el
// orden brave, chrome, edge. En macOS Brave lee los manifests de la carpeta de Chrome (medido en el spike); Edge, los
// suyos. En Windows, véase windowsBrowsers.
func Browsers(home string) []Browser {
	if goos == "windows" {
		return windowsBrowsers(winEnvFromOS(home), regularFile)
	}
	support := filepath.Join(home, "Library", "Application Support")
	chromeHosts := filepath.Join(support, "Google", "Chrome", "NativeMessagingHosts")
	return []Browser{
		{
			Name:        "brave",
			Exe:         "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
			UserDataDir: filepath.Join(support, "BraveSoftware", "Brave-Browser"),
			ManifestDir: chromeHosts,
		},
		{
			Name:        "chrome",
			Exe:         "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
			UserDataDir: filepath.Join(support, "Google", "Chrome"),
			ManifestDir: chromeHosts,
		},
		{
			Name:        "edge",
			Exe:         "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
			UserDataDir: filepath.Join(support, "Microsoft Edge"),
			ManifestDir: filepath.Join(support, "Microsoft Edge", "NativeMessagingHosts"),
		},
	}
}

// AppDir es la carpeta de instalación del host de un navegador: launcher-host, config.json, shared.json, shared.lock,
// icons/ y host.log. Cada navegador tiene la suya.
func AppDir(home, browser string) string {
	if goos == "windows" {
		return windowsAppDir(home, browser)
	}
	return filepath.Join(home, "Library", "Application Support", "AccountLauncher", browser)
}
