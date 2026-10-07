#!/usr/bin/env bash
# Uso: ./scripts/uninstall-mac.sh <brave|chrome|edge>
set -euo pipefail
browser="${1:?navegador: brave|chrome|edge}"
name="com.curyapps.launcher.spike"
case "$browser" in
  brave)  data="$HOME/Library/Application Support/BraveSoftware/Brave-Browser" ;;
  chrome) data="$HOME/Library/Application Support/Google/Chrome" ;;
  edge)   data="$HOME/Library/Application Support/Microsoft Edge" ;;
  *) echo "navegador desconocido: $browser" >&2; exit 1 ;;
esac
rm -f "$data/NativeMessagingHosts/$name.json"
rm -rf "$HOME/Library/Application Support/AccountLauncherSpike/$browser"
echo "Desinstalado de $browser"
