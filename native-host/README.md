# Host nativo de Account Launcher

Programa en Go (solo librería estándar) que la extensión usa por native messaging para abrir perfiles del navegador y
guardar el estado compartido entre perfiles. En F1 solo funciona en macOS (Brave, Chrome y Edge). El contrato con la
extensión está en [`packages/protocol/fixtures/README.md`](../packages/protocol/fixtures/README.md).

## Compilar

```bash
cd native-host
go build -trimpath -o bin/launcher-host ./cmd/launcher-host
```

`-ldflags "-X main.Version=0.1.0"` fija la versión que informa `ping` (como mucho 32 caracteres). `bin/` no se sube.

## Instalar

```bash
./bin/launcher-host install --browser brave --extension-id <ID de la extensión>
```

- Copia el binario a `~/Library/Application Support/AccountLauncher/<navegador>/`, escribe `config.json` y el manifest de
  native messaging (`com.curyapps.launcher.<navegador>`).
- Sin `--browser` instala en los navegadores que encuentra (ejecutable presente). Con un solo `--browser` se puede
  indicar `--exe` y `--user-data-dir` si no están en su sitio de siempre.
- Reinstalar es seguro: da los mismos archivos y no toca `shared.json` ni `icons/`. Hay que reinstalar cada vez que se
  recompila el binario: la copia instalada no cambia sola. `doctor` compara la copia instalada con el hash que
  `config.json` guardó al instalar, así que detecta que alguien la manipule después, no que `bin/launcher-host` se haya
  recompilado sin reinstalar.

## Comprobar, desinstalar, emparejamiento

```bash
./bin/launcher-host doctor --browser brave            # OK / FALLO por comprobación; sale con 1 si hay algún FALLO
./bin/launcher-host doctor --browser brave --verify   # abre whoami en el perfil de cada instalación y espera hasta 65 s
./bin/launcher-host uninstall --browser brave         # borra manifest, binario y config.json; conserva shared.json e icons/
./bin/launcher-host uninstall --browser brave --purge # borra también la carpeta de instalación entera
./bin/launcher-host pairing --browser brave --reset   # borra los emparejamientos (conserva datos e iconos)
./bin/launcher-host pairing --browser brave --max 3   # máximo de perfiles emparejados (de 1 a 16, por defecto 2)
```

`doctor` no muestra nombres de perfil ni el código de emparejamiento. Códigos de salida: 0 bien, 1 fallo, 2 uso incorrecto.

## Dónde vive cada archivo

En `~/Library/Application Support/AccountLauncher/<navegador>/` (carpeta 0700, archivos 0600):

| Archivo         | Contenido                                                                                 |
| --------------- | ----------------------------------------------------------------------------------------- |
| `launcher-host` | El binario (0700).                                                                        |
| `config.json`   | Navegador, ejecutable, datos del navegador, id de la extensión, hash del binario y `log`. |
| `shared.json`   | Estado compartido: revisión, datos, vínculos y emparejamientos (tokens solo como hash).   |
| `shared.lock`   | Bloqueo entre procesos del host.                                                          |
| `icons/`        | Un archivo por icono (`icons.*`).                                                         |
| `host.log`      | Registro opcional; rota a `host.log.1` al pasar de 1 MiB.                                 |

Manifests: Brave y Chrome en `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/` (Brave lee esa
carpeta en macOS); Edge en `~/Library/Application Support/Microsoft Edge/NativeMessagingHosts/`.

## Registro

Desactivado por defecto. Se activa poniendo `"log": true` en `config.json` (reinstalar lo conserva). Escribe una línea
por mensaje: `<fecha> cmd=<comando> code=<ok|código> ms=<n>`. El comando es el ya validado (o `-`). Nunca lleva URLs,
carpetas de perfil, tokens ni rutas.

## Extensión de desarrollo

`native-host/devext/` es una extensión mínima solo para probar el host a mano (no es el producto). Tiene un ID fijo,
gracias a su `key`:

```text
bneoaiemijlpeiphloaencojmmjhlcni
```

Se carga sin empaquetar en `brave://extensions` (modo desarrollador). El icono abre un panel con un botón por comando.

## Prueba manual

1. `cd native-host && go build -trimpath -o bin/launcher-host ./cmd/launcher-host`.
2. En Brave, cargar `native-host/devext` sin empaquetar en dos perfiles (A y B) y abrir su panel con el icono.
3. `./bin/launcher-host install --browser brave --extension-id bneoaiemijlpeiphloaencojmmjhlcni` y
   `./bin/launcher-host doctor --browser brave`: todo `OK`.
4. Panel de A → `ping`: `browser` `brave`, `temporaryContainer` `true`. `listProfiles`: aparecen A y B con su nombre.
5. `open` con la carpeta de B y `https://github.com/`: se abre en la ventana de B en menos de 1,5 s.
6. `createProfile`: devuelve `Launcher-…`; en unos segundos aparece en `listProfiles`.
7. A: `pair.start` → código. B: `pair.join` con el código. A y B: `pair.declare` con su carpeta. A y B: `pair.verify`:
   se abre `whoami` en su propio perfil, se cierra sola y `pair.list` muestra los dos verificados.
8. A: `pair.declare` con la carpeta de un perfil sin devext: `pair.list` muestra a A sin verificar al instante (declarar
   otra carpeta borra la verificación). `pair.verify`: página de error en ese perfil; el desafío caduca sin respuesta a
   los 60 s y A sigue sin verificar.
9. A: `sync.put`; B: `sync.get` devuelve lo mismo.
10. `openTemporary` sin nombre dos veces: dos contenedores distintos y vacíos. Con nombre `Prueba` dos veces: el mismo.
    Con nombre `Work`: `name_in_use` solo si el perfil ya tiene un contenedor persistente `Work`. Antes, crear
    `Work` en `brave://settings/containers` del perfil A, esperar unos segundos a que Brave guarde las preferencias y
    usar la carpeta de A como `profileDirectory`. Sin ese contenedor el host abre un contenedor temporal llamado `Work`
    (es lo previsto).
11. Un tercer perfil C con devext, con A y B emparejados: A: `pair.start` → `limit_reached` (no se emite código); C:
    `pair.join` con cualquier código → `bad_code`.
12. `./bin/launcher-host uninstall --browser brave`: `doctor` informa que no está instalado; `ping` desde el panel →
    error de host no encontrado.

## Pruebas

```bash
cd native-host
test -z "$(gofmt -l .)" && go vet ./... && go test ./...
```

Las pruebas no tocan `~/Library`, no lanzan ningún navegador y no guardan ninguna clave. La prueba de extremo a
extremo (`cmd/launcher-host/e2e_darwin_test.go`) solo corre en macOS.
