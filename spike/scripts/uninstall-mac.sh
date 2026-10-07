#!/usr/bin/env bash
# Uso: ./scripts/uninstall-mac.sh <brave|chrome|edge>
set -euo pipefail
browser="${1:?navegador: brave|chrome|edge}"
chrome_nmh="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
brave_nmh="$HOME/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts"
case "$browser" in
  brave|chrome) nmh="$chrome_nmh" ;;   # Brave en macOS lee la carpeta de Chrome
  edge)         nmh="$HOME/Library/Application Support/Microsoft Edge/NativeMessagingHosts" ;;
  *) echo "navegador desconocido: $browser" >&2; exit 1 ;;
esac
rm -f "$nmh/com.curyapps.launcher.spike.$browser.json"
# Manifests antiguos con el nombre único (antes de usar un nombre por navegador).
rm -f "$chrome_nmh/com.curyapps.launcher.spike.json" "$brave_nmh/com.curyapps.launcher.spike.json"
rm -rf "$HOME/Library/Application Support/AccountLauncherSpike/$browser"
echo "Desinstalado de $browser"
