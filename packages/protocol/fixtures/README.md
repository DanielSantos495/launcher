# Contrato del host: fixtures

Esta carpeta es el contrato entre la extensión (TypeScript) y el host nativo (Go, F1-B). Los esquemas de
`packages/protocol/src` (Valibot, estrictos) y los dos archivos JSON de aquí definen qué mensajes acepta y qué
mensajes devuelve el host. **El host en Go debe pasar todos los casos y devolver exactamente el código de error
indicado**: si Go acepta algo que aquí es inválido, o rechaza con otro código, el contrato se ha roto.

Fuentes de verdad, por orden: este README (orden de comprobación y códigos), los fixtures (casos concretos) y los
esquemas (`src/host.ts`, `src/limits.ts` y, para `data`, `bindings`, ids y carpetas, `packages/core/src/schema.ts`,
`url.ts` y `text.ts`). Si dos discrepan, es un fallo del contrato: se corrige aquí y en el esquema, no solo en Go.

## Archivos

### `host-requests.json`

Lista de casos de petición. Cada caso es un objeto con estos campos:

| Campo     | Significado                                                                                               |
| --------- | --------------------------------------------------------------------------------------------------------- |
| `name`    | Descripción corta del caso (en español). Solo sirve para leer los resultados de las pruebas.              |
| `valid`   | `true`: el host debe aceptar la petición. `false`: debe rechazarla.                                       |
| `error`   | Solo con `valid: false`: el código de error exacto que debe devolver el host (uno de `HOST_ERROR_CODES`). |
| `request` | El mensaje tal cual llega al host, ya decodificado de JSON. Puede ser cualquier valor JSON.               |

Las pruebas de TypeScript (`test/host.test.ts`) comprueban que `valid` coincide con los esquemas de Valibot y que
cada comando tiene al menos un caso válido. No calculan el código de error: ese código lo fija el orden de
comprobación de este README, y es lo que Go debe cumplir además de `valid`.

### `host-responses.json`

Lista de respuestas que el host puede emitir. Cada caso es un objeto:

| Campo      | Significado                                                                           |
| ---------- | ------------------------------------------------------------------------------------- |
| `name`     | Descripción corta del caso.                                                           |
| `cmd`      | El comando al que responde (el que decide qué forma tiene `result`).                  |
| `response` | La respuesta completa: `{ "ok": true, "result": … }` o `{ "ok": false, "error": … }`. |

Todos los casos son respuestas **válidas**: lo que Go emita debe tener exactamente esa forma (mismos campos, sin
campos de más). Hay al menos una respuesta correcta (`ok: true`) por cada uno de los 17 comandos, y la prueba
lo exige. La extensión valida cada respuesta con un esquema estricto y descarta la que traiga campos de más, un
resultado de otro comando o un `result` que sea un array en lugar de un objeto.

Forma de las respuestas:

- Correcta: `{ "ok": true, "result": <objeto> }`. Si el comando no devuelve datos, `result` es `{}` (nunca un array).
- Error: `{ "ok": false, "error": { "code": <código> } }`. Sin mensaje ni ningún otro campo (los errores no incluyen
  URLs, emails, notas ni valores recibidos). Solo `conflict` lleva además `"revision"` (entero ≥ 0 con la revisión
  actual del host), y `revision` no se admite con ningún otro código.

### Cómo compararlos

Los fixtures son JSON ya decodificado: compara valores, no bytes (el orden de las claves y los espacios no
importan). Los caracteres escapados, como `\u0007` o `\ufeff` (la marca U+FEFF), son los caracteres reales una
vez decodificados.

## Orden de comprobación

Cuando una petición tiene varios errores, el código lo decide **el primer paso que falla**, en este orden:

1. Mensaje de más de `MAX_HOST_REQUEST_BYTES` (1048576) bytes → `too_large`. Se mide el cuerpo JSON en UTF-8 (sin
   el prefijo de longitud del framing) y se comprueba **antes de parsear**.
2. JSON inválido, o JSON que no es un objeto (un array, un texto, un número o `null`) → `bad_request`.
3. `v` ausente o con cualquier valor distinto del número `1` → `unsupported_version`.
4. `cmd` ausente o que no es texto → `bad_request`. Texto que no es uno de los 17 comandos → `unknown_command`.
5. Campos de más en el sobre (cualquiera que no sea `v`, `cmd` o `args`), `args` ausente o `args` que no es un
   objeto (un array no lo es) → `bad_request`.
6. `args` del comando, **campo por campo en el orden en que aparece en el esquema** (el orden de la columna
   «args» de la tabla de comandos). Decide el primer campo que falla:
   - Campo ausente (si es obligatorio) o de tipo JSON incorrecto (incluido `null` en un campo opcional, que solo
     puede estar ausente) → `bad_request`.
   - `url` que es un texto pero no una URL canónica válida → `bad_url`.
   - `name` (de `openTemporary`) que es un texto pero no un nombre de contenedor válido → `bad_name`.
   - Cualquier otro formato inválido (carpeta de perfil, id, token, código, nonce, clave o `base64` de icono,
     `mime`…) → `bad_request`. De `data` y `bindings` (`sync.put`) el host solo comprueba la estructura que fija
     «`data` y `bindings` de `sync.put`» más abajo; si falla, `bad_request`.
   - Los **campos desconocidos** de `args` se comprueban al final, cuando todos los campos del esquema han pasado
     → `bad_request`.
7. Solo cuando la petición ya es válida en forma (pasos 1 a 6), `sync.put` cuyo `data` supera
   `MAX_SHARED_DATA_BYTES` (524288) → `too_large`. El tamaño son los **bytes recibidos del valor `data`**, es decir,
   el trozo de JSON en bruto tal como llegó (en Go, `json.RawMessage`: desde el primer carácter del valor hasta el
   último, sin los espacios ni la coma de alrededor), no los de una re-serialización. Los códigos que dependen del
   estado del host (sección «Códigos que dependen del estado del host») vienen también después del paso 6; su orden
   respecto a este paso lo decide el host.

Ejemplos del orden (todos se deducen de las reglas anteriores):

| Petición                                                                           | Código                | Por qué                                                              |
| ---------------------------------------------------------------------------------- | --------------------- | -------------------------------------------------------------------- |
| `{ "v": 2, "cmd": 5 }`                                                             | `unsupported_version` | El paso 3 va antes que el 4.                                         |
| `{ "v": 1, "cmd": "exec", "args": [] }`                                            | `unknown_command`     | El paso 4 va antes que el 5.                                         |
| `open` con `profileDirectory: "../x"` y `url: "javascript:x"`                      | `bad_request`         | Falla antes `profileDirectory`, que es el primer campo.              |
| `open` con `profileDirectory: "Default"`, `url: "javascript:x"` y un campo `extra` | `bad_url`             | Los campos desconocidos se miran al final.                           |
| `openTemporary` con `url` válida y `name: "-x"`                                    | `bad_name`            | `url` pasa; falla `name`.                                            |
| `openTemporary` con `url` inválida y `name: 5`                                     | `bad_url`             | `url` va antes que `name`; el tipo de `name` ya no se llega a mirar. |
| `open` con `profileDirectory` válida y `url: 5`                                    | `bad_request`         | Tipo incorrecto: `bad_url` es solo para textos.                      |

## Comandos

Orden de los campos de `args` = orden de comprobación del paso 6. `?` marca un campo opcional (puede estar ausente,
pero no ser `null`). Los objetos del sobre, de `args` y de `result` son estrictos: sin campos de más. `data` y
`bindings` son la excepción que explica la sección siguiente.

| Comando         | `args`                                      | `result`                                                                                                                                           |
| --------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ping`          | `{}`                                        | `hostVersion` (≤ 32), `protocol` (= 1), `browser` (`brave`, `chrome` o `edge`), `browserVersion?` (≤ 32), `features: { temporaryContainer: bool }` |
| `listProfiles`  | `{}`                                        | `profiles` (≤ 500): `{ directory, name (≤ 256), isUsingDefaultName: bool, color? }`                                                                |
| `open`          | `profileDirectory`, `url`                   | `{}`                                                                                                                                               |
| `openTemporary` | `profileDirectory`, `url`, `name?`          | `{}`                                                                                                                                               |
| `createProfile` | `{}`                                        | `directory`                                                                                                                                        |
| `pair.start`    | `installationId`, `token?`                  | `code`, `expiresAt`, `token?`                                                                                                                      |
| `pair.join`     | `installationId`, `code`                    | `token`                                                                                                                                            |
| `pair.declare`  | `token`, `profileDirectory`, `identityId?`  | `{}`                                                                                                                                               |
| `pair.list`     | `token`                                     | `maxPairedProfiles` (entero 1–16), `installations` (≤ 16): `{ installationId, identityId?, profileDirectory?, pairedAt, verifiedAt?, self: bool }` |
| `pair.remove`   | `token`, `installationId`                   | `{}`                                                                                                                                               |
| `pair.verify`   | `token`                                     | `expiresAt`                                                                                                                                        |
| `pair.prove`    | `token`, `nonce`                            | `verifiedAt`                                                                                                                                       |
| `sync.get`      | `token`                                     | `revision`, `data` (datos o `null`), `bindings`                                                                                                    |
| `sync.put`      | `token`, `baseRevision`, `data`, `bindings` | `revision`                                                                                                                                         |
| `icons.get`     | `token`, `key`                              | `key`, `mime`, `base64`                                                                                                                            |
| `icons.put`     | `token`, `key`, `mime`, `base64`            | `{}`                                                                                                                                               |
| `icons.delete`  | `token`, `key`                              | `{}`                                                                                                                                               |

Los formatos de cada campo están en «Reglas que Go debe replicar al carácter».

### `data` y `bindings` de `sync.put`

Aquí el trabajo se reparte a propósito. El host valida **solo la estructura** y guarda `data` tal como la recibió:

- `data` es un objeto JSON (un array no lo es) de como mucho `MAX_SHARED_DATA_BYTES` bytes recibidos (`too_large`,
  paso 7).
- `data.schemaVersion` es el entero `1`.
- `data.revision` es un entero entre 0 y 9007199254740991, como cualquier revisión.
- `bindings` es un objeto JSON; un array no lo es.

Si falla alguna de las comprobaciones de estructura, `bad_request`. Los fixtures `sync.put con schemaVersion 2`,
`sync.put con bindings como array` y `sync.put con data como array` fijan tres de ellas (y
`sync.put con baseRevision negativa`, un entero inválido del propio `args`). El esquema completo de `LauncherData` y
de los vínculos (`packages/core/src/schema.ts`: `LauncherDataSchema`, `BindingsSchema`, más las reglas cruzadas de
`validateData`) lo aplica la **extensión**: valida lo que envía y pasa todo lo que lee con `sync.get` por
`parseLauncherData`, y rechaza lo que no cumpla. Es una decisión deliberada, registrada en ADR-004: mantiene pequeño
el host en Go, y las instalaciones emparejadas están autenticadas por su token. Por eso `HostRequestSchema`
(TypeScript) es más estricto con `data` y `bindings` que lo que el host debe exigir, y un host que guarda un `data`
que la extensión rechazaría al leerlo no incumple este contrato.

## Reglas que Go debe replicar al carácter

Las expresiones regulares están ancladas al texto completo (`^…$`, sin modo multilínea): un salto de línea final
no es válido. `\d` es solo `0-9`.

Enteros: `v`, `baseRevision`, `revision` y `maxPairedProfiles` son enteros JSON. TypeScript los lee con
`JSON.parse`, que acepta `1.0` y `1e0` como el entero 1. La extensión nunca los escribe así: `JSON.stringify` emite
un entero (hasta 2^53 − 1) siempre como dígitos, sin fracción ni exponente. Por eso Go puede rechazar con
`bad_request` cualquier entero escrito con fracción o exponente (también en `v`). Los fixtures no incluyen esas
formas y este contrato no las fija.

### URL canónica (`url`)

La regla de referencia es la del estándar **WHATWG URL**: `s` es válida si y solo si se cumplen todas estas
condiciones:

- `new URL(s).href === s`: la URL ya está escrita tal y como la serializa el estándar WHATWG URL (la forma de los
  navegadores y de Node). No es la forma de `net/url` de Go, que normaliza distinto.
- El esquema es `https` o `http`. El host acepta `http` siempre; que solo se use con `allowHttp` es política del
  core, que la aplica antes de enviar.
- Host no vacío y sin _userinfo_ (ni usuario ni contraseña).
- Como mucho 2048 caracteres (`MAX_URL_LENGTH`).
- Solo ASCII imprimible, U+0021 a U+007E: sin espacios, sin caracteres de control y sin espacios en los extremos.
- No puede ser vacía ni empezar por `-` (no tiene esquema, así que no es una URL).

Referencia en TypeScript: `normalizeUrl(s, { allowHttp: true })` de core devuelve `ok` con un valor igual a `s`.

**Lo que fijan los fixtures, y nada más.** Se rechazan con `bad_url`: un esquema que no es http(s) (`javascript:`,
`file:`), un texto sin esquema (`--incognito`), _userinfo_, un host sin ruta (`https://github.com`), un salto de
línea, el esquema en mayúsculas, el host en mayúsculas, el puerto por defecto (`:443` en `https`, `:80` en `http`),
segmentos `.` o `..` (`/a/../b` y su forma codificada `/%2e%2e/`), un espacio sin codificar, un dominio con letras
Unicode sin pasar a punycode y una IPv4 abreviada (`127.1`, que WHATWG reescribe como `127.0.0.1`). Se aceptan la ruta
`/`, una consulta con un `%40`, un dominio en punycode (`xn--`) y `http:`.

**Go puede ser más estricto (fallar cerrado).** Go no tiene un serializador WHATWG, y no hace falta que lo escriba: el
host puede aceptar solo un subconjunto canónico que sepa comprobar y rechazar todo lo demás con `bad_url`. Un
subconjunto razonable: esquema y host en minúsculas, sin puerto por defecto, sin segmentos `.` ni `..` (tampoco
codificados, como `%2e`), solo ASCII imprimible y percent-encoding válido (`%` seguido de dos dígitos hexadecimales).
Lo que **no** puede hacer es rechazar una URL de los casos válidos de los fixtures.

### Nombre de contenedor (`name` de `openTemporary`)

Es válido si y solo si se cumplen todas estas condiciones:

- Como mucho 64 **puntos de código** (`MAX_CONTAINER_NAME`), no unidades UTF-16 ni bytes: 64 `🎨` valen, 65 no.
- No está «en blanco». «En blanco» es exactamente lo que quita `String.prototype.trim`: la cadena vacía o formada
  solo por espacios Unicode y terminadores de línea, es decir U+0009 a U+000D, U+0020, U+00A0, U+1680,
  U+2000 a U+200A, U+2028, U+2029, U+202F, U+205F, U+3000 y U+FEFF.
  `strings.TrimSpace` de Go **no** coincide: no cuenta U+FEFF como espacio (los fixtures lo exigen) y sí cuenta U+0085,
  que de todos modos es un control C1 y se rechaza por la última regla.
- No empieza por `-`.
- No contiene `=`.
- No contiene caracteres de control: C0 (U+0000 a U+001F), DEL (U+007F) y C1 (U+0080 a U+009F).

Un nombre que no es un texto → `bad_request`; un texto que incumple alguna regla (incluido `""`) → `bad_name`.

### Id (`installationId`, `identityId`)

`^[A-Za-z0-9_-]{1,64}$` y distinto de `__proto__`, `constructor` y `prototype`.

### Carpeta de perfil (`profileDirectory`)

- Entre 1 y 255 caracteres, medidos en unidades UTF-16 (como `String.length` de JavaScript: un emoji cuenta 2).
  El vacío no vale.
- No es `.` ni `..`.
- No contiene `/` ni `\`.
- No empieza por `-`.
- No contiene caracteres de control (C0, DEL y C1, como en el nombre de contenedor).

### Token, código, nonce

| Campo   | Formato                                                   |
| ------- | --------------------------------------------------------- |
| `token` | `^[A-Za-z0-9_-]{43}$` (256 bits en base64url sin relleno) |
| `code`  | `^\d{6}$` (seis cifras ASCII)                             |
| `nonce` | `^[A-Za-z0-9_-]{16,64}$`                                  |

### Iconos (`key`, `mime`, `base64`)

- `key`: `^icon:[A-Za-z0-9_-]{1,64}$`.
- `mime`: exactamente `image/png`, `image/jpeg` o `image/webp` (nada de `image/svg+xml`).
- `base64`: alfabeto estándar (`+` y `/`, no el de URL), con relleno `=` y sin saltos de línea. Entre 4 y 43692
  caracteres, forma `^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$` y **tamaño decodificado
  ≤ `MAX_ICON_BYTES` (32768)**, calculado como `longitud / 4 * 3 - relleno`. 32768 bytes valen; 32769 (43692
  caracteres sin relleno, que caben en el tope de caracteres) no. No se comprueba que los bits sobrantes del último
  carácter sean cero: no uses `base64.StdEncoding.Strict()`.

### Marcas de tiempo, revisiones y colores

- Marca de tiempo (`expiresAt`, `pairedAt`, `verifiedAt`): la forma de `Date.prototype.toISOString()`,
  `YYYY-MM-DDTHH:mm:ss.sssZ` con milisegundos y `Z`, y una fecha real del calendario.
- Revisión (`baseRevision`, `revision`): entero entre 0 y 9007199254740991 (2^53 − 1).
- Color (`color` de un perfil): `^#[0-9a-fA-F]{6}$`. El `name` de un perfil tiene como mucho 256 unidades UTF-16.

### Límites (`limits.ts`)

| Constante                     | Valor   | Dónde se aplica                                                                       |
| ----------------------------- | ------- | ------------------------------------------------------------------------------------- |
| `PROTOCOL_VERSION`            | 1       | Valor de `v` y de `protocol` en `ping`.                                               |
| `MAX_HOST_REQUEST_BYTES`      | 1048576 | Tamaño máximo de una petición (paso 1 del orden de comprobación).                     |
| `MAX_HOST_RESPONSE_BYTES`     | 1000000 | Tamaño máximo de una respuesta: Chromium no acepta más de 1 MB del host al navegador. |
| `MAX_SHARED_DATA_BYTES`       | 524288  | Tamaño máximo del `data` de `sync.put`, medido sobre los bytes recibidos (paso 7).    |
| `MAX_ICON_BYTES`              | 32768   | Tamaño decodificado de un icono.                                                      |
| `PAIR_CODE_TTL_SECONDS`       | 120     | Vida del código de emparejamiento (`pair.start` → `expiresAt`).                       |
| `PROOF_TTL_SECONDS`           | 60      | Vida de la verificación de perfil (`pair.verify` → `expiresAt`, y su `nonce`).        |
| `DEFAULT_MAX_PAIRED_PROFILES` | 2       | Valor por defecto de `maxPairedProfiles` en `pair.list`.                              |
| `MAX_CONTAINER_NAME`          | 64      | Puntos de código de un nombre de contenedor.                                          |

`test/limits.test.ts` fija estos nueve valores: cambiar uno obliga a cambiar la prueba, este README y el host.

## Códigos que dependen del estado del host

Los fixtures no pueden cubrir estos códigos porque dependen de lo que el host tiene guardado o del sistema. Go los
cubre con sus pruebas unitarias. La columna «cuándo» es solo una guía: las pruebas de Go y el estado del host la
concretan.

| Código                | Cuándo                                                                                                                                                |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `too_large`           | Petición de más de `MAX_HOST_REQUEST_BYTES` (paso 1), o `sync.put` con `data` recibido de más de `MAX_SHARED_DATA_BYTES` (paso 7).                    |
| `name_in_use`         | El nombre pedido ya existe y debe ser único.                                                                                                          |
| `unknown_profile`     | `profileDirectory` no es un perfil existente del navegador.                                                                                           |
| `unsupported_browser` | El navegador del host no admite el comando (por ejemplo `openTemporary` fuera de Brave).                                                              |
| `not_paired`          | El `token` no corresponde a ninguna instalación emparejada.                                                                                           |
| `bad_code`            | El código de `pair.join` es incorrecto, ha caducado o ya se usó: **no se distingue** entre los tres casos, para no dar pistas a quien prueba códigos. |
| `limit_reached`       | Se alcanzó el máximo de perfiles emparejados.                                                                                                         |
| `conflict`            | `sync.put` con una `baseRevision` que no es la actual. Siempre lleva `revision` (la actual del host).                                                 |
| `bad_nonce`           | El `nonce` de `pair.prove` es desconocido, ha caducado o no corresponde.                                                                              |
| `not_found`           | El recurso pedido no existe (por ejemplo un icono).                                                                                                   |
| `launch_failed`       | El navegador no se pudo lanzar.                                                                                                                       |
| `internal`            | Cualquier otro fallo del host.                                                                                                                        |

Los códigos de formato (`bad_request`, `unsupported_version`, `unknown_command`, `bad_url`, `bad_name`) salen del
orden de comprobación y sí los cubren los fixtures.

## Qué no cubren los fixtures

- Los tamaños grandes (un mensaje de más de 1 MiB, una URL de 2048 y 2049 caracteres, un icono de 32768 y 32769
  bytes) ocuparían decenas de KB de JSON. La URL y el icono se prueban en TypeScript (`core/test/url.test.ts` y
  `test/host.test.ts`); el límite del mensaje solo lo cubre Go. Go debe probar los tres en sus pruebas unitarias.
- `data` y `bindings` de `sync.put` solo tienen un caso válido y tres negativos de estructura (`schemaVersion` 2,
  `bindings` y `data` que son arrays), más uno de `baseRevision` negativa. El tamaño de `data` (`too_large`) no tiene
  fixture, y el esquema completo de `LauncherData` lo aplica la extensión, no el host. Go cubre el resto con sus
  pruebas unitarias.

## Añadir un caso

1. Añade el caso al JSON (sin tocar los existentes) con el estilo de Prettier del proyecto.
2. Comprueba que falla o pasa por el campo que quieres probar y no por otro.
3. Si cambia una regla, cambia también el esquema, este README y la prueba que la fija; y avisa al responsable del
   host en Go.
