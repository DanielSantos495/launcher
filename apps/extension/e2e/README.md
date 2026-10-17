# Pruebas e2e de la extensión

Playwright (`@playwright/test`) carga la compilación `.output/chrome-mv3` en el Chromium de Playwright, con un perfil
temporal nuevo en cada prueba (se borra al terminar). Las webs externas se sustituyen por una página vacía: no hay
tráfico a internet. Nada toca los perfiles reales ni `~/Library/Application Support/AccountLauncher`.

## Ejecutar

```bash
pnpm -C apps/extension e2e:install   # una vez: descarga solo el Chromium de Playwright
pnpm e2e                             # compila la extensión y corre las pruebas (no forma parte de `pnpm check`)
```

## Qué cubre

- `perfil-unico.spec.ts`: alta de identidad y cuenta, persistencia tras recargar, abrir una cuenta y la paleta Ctrl+K.
- `copia.spec.ts`: exportar, importar de vuelta, JSON inválido, archivo ajeno y una dirección `javascript:` rechazada.
- `sin-host.spec.ts`: Varios perfiles sin el programa (el Chromium de Playwright se presenta como «Chromium», una
  marca que la extensión rechaza, así que sale el aviso de navegador no compatible y no los pasos de instalación).
- `chrome.spec.ts`: prueba de humo con el Google Chrome instalado; solo con `E2E_CHROME=1`.

## Google Chrome (Chrome 155.0.8059.82)

No se puede automatizar. Observado en esta versión: con `--load-extension` y `--disable-extensions-except` la
extensión no se carga y no aparece su service worker (no se comprobó desde qué versión ocurre). `E2E_CHROME=1 pnpm e2e` lo comprueba y marca la prueba como
omitida con la versión. Paso manual: `chrome://extensions`, modo desarrollador, «Cargar descomprimida»
con `apps/extension/.output/chrome-mv3`.

## Host real (launcher-host): no se prueba aquí

Sí se puede aislar la instalación: `install` usa `os.UserHomeDir`, así que con `HOME=<temporal>` y `--user-data-dir`
temporal escribe todo en la carpeta temporal. Lo que no se puede aislar es que el navegador lo encuentre:

1. Hace falta un navegador con marca Brave, Chrome o Edge (`src/platform/host-name.ts` ignora «Chromium»). Chrome no
   carga la extensión (arriba) y no se puede falsear la marca del service worker sin tocar el código del producto.
2. Brave 155.1.97.56 sí carga la extensión con el flag y se presenta como Brave. Se probó con `HOME` y `--user-data-dir`
   temporales, con el manifest también copiado a `<user-data-dir>/NativeMessagingHosts`: el host no se lanzó. Brave solo
   lee los manifests de `~/Library/Application Support/Google/Chrome/NativeMessagingHosts` (ver `native-host/README.md`),
   la carpeta real del usuario, donde no se puede escribir desde una prueba.

Queda manual (ver `native-host/README.md`, «Prueba manual»): instalar el host en Brave, emparejar dos perfiles, `sync`
y abrir una identidad en su perfil. El contrato del host lo cubren sus pruebas en Go y las de la extensión con el
host falso (`test/helpers/fake-host.ts`).
