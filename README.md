# Account Launcher

Extensión para Brave, Chrome y Edge que agrupa tus cuentas por identidad y abre cada una en el perfil del navegador que le corresponde. En desarrollo (fase F1).

A browser extension for Brave, Chrome and Edge that groups your accounts by identity and opens each one in its own browser profile. Work in progress.

## Desarrollo

Requisitos: Node ≥ 22.13 y pnpm 11.

    pnpm install --frozen-lockfile
    pnpm check

Guía de uso (instalación, modos, copia de seguridad y privacidad): [GUIA.md](GUIA.md).

Versiones: `scripts/release.sh X.Y.Z` (o un tag `vX.Y.Z`, que crea un borrador de release) genera en `dist/` los binarios del host, el zip de la extensión y `SHA256SUMS`; se verifica con `shasum -a 256 -c SHA256SUMS` (o `sha256sum -c`) dentro de `dist/`.

Licencia MIT.
