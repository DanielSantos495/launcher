#!/usr/bin/env bash
# Uso: ./scripts/install-mac.sh <brave|chrome|edge> [direct|open]
set -euo pipefail
cd "$(dirname "$0")/.."
browser="${1:?navegador: brave|chrome|edge}"
mode="${2:-direct}"
case "$mode" in direct|open) ;; *) echo "launchMode desconocido: $mode (direct|open)" >&2; exit 1 ;; esac
id="$(cat extension-id.txt)"
[[ "$id" =~ ^[a-p]{32}$ ]] || { echo "extension-id.txt no contiene un ID válido; ejecuta scripts/make-key.sh" >&2; exit 1; }
# Un nombre de host por navegador: Brave en macOS lee los manifests de la carpeta de Chrome (medido),
# y con el mismo ID de extensión un nombre único haría que un manifest pisara al otro.
chrome_nmh="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
case "$browser" in
  brave)  app="/Applications/Brave Browser.app";  exe="$app/Contents/MacOS/Brave Browser";   data="$HOME/Library/Application Support/BraveSoftware/Brave-Browser"; nmh="$chrome_nmh" ;;
  chrome) app="/Applications/Google Chrome.app";  exe="$app/Contents/MacOS/Google Chrome";   data="$HOME/Library/Application Support/Google/Chrome"; nmh="$chrome_nmh" ;;
  edge)   app="/Applications/Microsoft Edge.app"; exe="$app/Contents/MacOS/Microsoft Edge"; data="$HOME/Library/Application Support/Microsoft Edge"; nmh="$data/NativeMessagingHosts" ;;
  *) echo "navegador desconocido: $browser" >&2; exit 1 ;;
esac
name="com.curyapps.launcher.spike.$browser"
dest="$HOME/Library/Application Support/AccountLauncherSpike/$browser"
mkdir -p "$dest" "$nmh"
# Se borra antes de copiar: sobrescribir un binario firmado en el mismo inodo hace que macOS lo mate al ejecutarlo.
rm -f "$dest/launcher-host"
cp host/bin/launcher-host-darwin "$dest/launcher-host"
cat > "$dest/config.json" <<EOF
{ "browser": "$browser", "exe": "$exe", "appPath": "$app", "userDataDir": "$data", "launchMode": "$mode" }
EOF
cat > "$nmh/$name.json" <<EOF
{
  "name": "$name",
  "description": "Account Launcher spike host",
  "path": "$dest/launcher-host",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$id/"]
}
EOF
echo "Instalado para $browser ($mode): $nmh/$name.json"
for old in "$chrome_nmh" "$HOME/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts"; do
  [ ! -f "$old/com.curyapps.launcher.spike.json" ] || echo "Aviso: queda el manifest antiguo $old/com.curyapps.launcher.spike.json (bórralo con scripts/uninstall-mac.sh)" >&2
done
