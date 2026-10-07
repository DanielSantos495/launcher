#!/usr/bin/env bash
# Uso: ./scripts/install-mac.sh <brave|chrome|edge> [direct|open]
set -euo pipefail
cd "$(dirname "$0")/.."
browser="${1:?navegador: brave|chrome|edge}"
mode="${2:-direct}"
case "$mode" in direct|open) ;; *) echo "launchMode desconocido: $mode (direct|open)" >&2; exit 1 ;; esac
id="$(cat extension-id.txt)"
[[ "$id" =~ ^[a-p]{32}$ ]] || { echo "extension-id.txt no contiene un ID válido; ejecuta scripts/make-key.sh" >&2; exit 1; }
name="com.curyapps.launcher.spike"
case "$browser" in
  brave)  app="/Applications/Brave Browser.app";  exe="$app/Contents/MacOS/Brave Browser";   data="$HOME/Library/Application Support/BraveSoftware/Brave-Browser" ;;
  chrome) app="/Applications/Google Chrome.app";  exe="$app/Contents/MacOS/Google Chrome";   data="$HOME/Library/Application Support/Google/Chrome" ;;
  edge)   app="/Applications/Microsoft Edge.app"; exe="$app/Contents/MacOS/Microsoft Edge"; data="$HOME/Library/Application Support/Microsoft Edge" ;;
  *) echo "navegador desconocido: $browser" >&2; exit 1 ;;
esac
dest="$HOME/Library/Application Support/AccountLauncherSpike/$browser"
mkdir -p "$dest" "$data/NativeMessagingHosts"
# Se borra antes de copiar: sobrescribir un binario firmado en el mismo inodo hace que macOS lo mate al ejecutarlo.
rm -f "$dest/launcher-host"
cp host/bin/launcher-host-darwin "$dest/launcher-host"
cat > "$dest/config.json" <<EOF
{ "browser": "$browser", "exe": "$exe", "appPath": "$app", "userDataDir": "$data", "launchMode": "$mode" }
EOF
cat > "$data/NativeMessagingHosts/$name.json" <<EOF
{
  "name": "$name",
  "description": "Account Launcher spike host",
  "path": "$dest/launcher-host",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$id/"]
}
EOF
echo "Instalado para $browser ($mode): $data/NativeMessagingHosts/$name.json"
