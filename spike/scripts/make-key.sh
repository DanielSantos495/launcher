#!/usr/bin/env bash
# Genera la clave del spike, el manifest con "key" y el ID de la extensión.
set -euo pipefail
cd "$(dirname "$0")/.."
if [ ! -f spike-key.pem ]; then
  # La clave privada solo la lee el usuario (0600) y *.pem está en .gitignore.
  (umask 077 && openssl genrsa 2048 2>/dev/null | openssl pkcs8 -topk8 -nocrypt -out spike-key.pem)
fi
pub=$(openssl rsa -in spike-key.pem -pubout -outform DER 2>/dev/null | openssl base64 -A)
id=$(openssl rsa -in spike-key.pem -pubout -outform DER 2>/dev/null | shasum -a 256 | head -c 32 | tr '0-9a-f' 'a-p')
cat > extension/manifest.json <<EOF
{
  "manifest_version": 3,
  "name": "Account Launcher Spike",
  "version": "0.0.1",
  "key": "$pub",
  "permissions": ["nativeMessaging", "favicon", "storage"],
  "background": { "service_worker": "background.js", "type": "module" },
  "action": { "default_title": "Account Launcher Spike" }
}
EOF
echo "$id" > extension-id.txt
echo "ID de la extensión: $id"
