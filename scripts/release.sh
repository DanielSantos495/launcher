#!/usr/bin/env bash
# Genera los artefactos de una versión en dist/: binarios del host, zip de la extensión y SHA256SUMS.
# Uso: scripts/release.sh 0.1.0   (sin red: usa node_modules ya instalado)
set -euo pipefail

version="${1:-}"
if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "uso: scripts/release.sh X.Y.Z (versión recibida: '${version}')" >&2
  exit 1
fi

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
dist="$root/dist"
rm -rf "$dist"
mkdir -p "$dist"

# Host en Go: binarios estáticos y reproducibles para macOS y Windows.
for target in darwin/arm64 darwin/amd64 windows/amd64 windows/arm64; do
  os="${target%/*}"
  arch="${target#*/}"
  ext=""
  [[ "$os" == "windows" ]] && ext=".exe"
  out="$dist/launcher-host-${version}-${os}-${arch}${ext}"
  echo "host: $os/$arch"
  (cd "$root/native-host" && CGO_ENABLED=0 GOOS="$os" GOARCH="$arch" \
    go build -trimpath -ldflags "-s -w -X main.Version=${version}" -o "$out" ./cmd/launcher-host)
done

# Extensión: compila y comprueba que la versión del manifest coincide con la pedida.
(cd "$root" && pnpm --filter @account-launcher/extension build)
built="$root/apps/extension/.output/chrome-mv3"
manifest_version="$(node -e 'process.stdout.write(String(JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).version))' "$built/manifest.json")"
if [[ "$manifest_version" != "$version" ]]; then
  echo "error: la versión del manifest ($manifest_version) no coincide con $version" >&2
  exit 1
fi
# Zip reproducible: fechas fijas (las del último commit) y lista de archivos ordenada.
export TZ=UTC
stamp="$(git -C "$root" log -1 --format=%cd --date=format-local:%Y%m%d%H%M.%S)"
(cd "$built" && find . -exec touch -h -t "$stamp" {} + \
  && find . -type f | LC_ALL=C sort | zip -X -q "$dist/account-launcher-extension-${version}.zip" -@)

# Sumas de verificación.
if command -v sha256sum >/dev/null 2>&1; then
  sum_cmd=(sha256sum)
else
  sum_cmd=(shasum -a 256)
fi
(cd "$dist" && LC_ALL=C ls | xargs "${sum_cmd[@]}" > "$root/SHA256SUMS.tmp")
mv "$root/SHA256SUMS.tmp" "$dist/SHA256SUMS"
echo "listo: $dist"
