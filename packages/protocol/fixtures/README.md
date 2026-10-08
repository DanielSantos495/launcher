# Contrato del host: fixtures

Esta carpeta es el contrato entre la extensión (TypeScript) y el host nativo (Go, F1-B). Los esquemas de
`packages/protocol/src` (Valibot, estrictos) y los dos archivos JSON de aquí definen qué mensajes acepta y qué
mensajes devuelve el host. **El host en Go debe pasar todos los casos y devolver exactamente el código de error
indicado**: si Go acepta algo que aquí es inválido, o rechaza con otro código, el contrato se ha roto.

Fuentes de verdad, por orden: este README (orden de comprobación, códigos, gramática de URL, decodificación y
escritura en Go), los fixtures (casos concretos) y los esquemas (`src/host.ts`, `src/limits.ts` y, para ids, carpetas,
nombres y URLs, `packages/core/src/schema.ts`, `url.ts` y `text.ts`). De `data` y `bindings` el host solo comprueba la
estructura que fija la sección «`data` y `bindings` de `sync.put`»: el esquema completo de `core` lo aplica la
extensión, no el host. Si dos fuentes discrepan, es un fallo del contrato: se corrige aquí y en el esquema, no solo en
Go.

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
resultado de otro comando o un `result` que sea un array en lugar de un objeto. La excepción es el contenido de `data`
y `bindings` de `sync.get`, que solo se comprueba en su estructura (ver «`data` y `bindings` de `sync.put`»).

Forma de las respuestas:

- Correcta: `{ "ok": true, "result": <objeto> }`. Si el comando no devuelve datos, `result` es `{}` (nunca un array).
- Error: `{ "ok": false, "error": { "code": <código> } }`. Sin mensaje ni ningún otro campo (los errores no incluyen
  URLs, emails, notas ni valores recibidos). Solo `conflict` lleva además `"revision"` (entero ≥ 0 con la revisión
  actual del host), y `revision` no se admite con ningún otro código.

### Cómo compararlos

Los fixtures son JSON ya decodificado: compara valores, no bytes (el orden de las claves y los espacios no
importan). Los caracteres escapados, como `\u0007` o `\ufeff` (la marca U+FEFF), son los caracteres reales una
vez decodificados. Las claves se comparan exactas, distinguiendo mayúsculas: ver «Decodificación en Go».

## Orden de comprobación

Cuando una petición tiene varios errores, el código lo decide **el primer paso que falla**, en este orden:

1. Mensaje de más de `MAX_HOST_REQUEST_BYTES` (1048576) bytes → `too_large`. Se mide el cuerpo JSON en UTF-8 (sin
   el prefijo de longitud del framing) y se comprueba **antes de parsear**.
2. JSON inválido, o JSON que no es un objeto (un array, un texto, un número o `null`) → `bad_request`. También es
   JSON inválido un marco con datos después del valor, con UTF-8 inválido o con sustitutos sueltos (ver
   «Decodificación en Go»).
3. `v` ausente o con cualquier valor distinto del número `1` → `unsupported_version`.
4. `cmd` ausente o que no es texto → `bad_request`. Texto que no es uno de los 17 comandos → `unknown_command`.
5. Campos de más en el sobre (cualquiera que no sea `v`, `cmd` o `args`), `args` ausente o `args` que no es un
   objeto (un array no lo es) → `bad_request`.
6. `args` del comando, **campo por campo en el orden en que aparece en el esquema** (el orden de la columna
   «args» de la tabla de comandos). Decide el primer campo que falla:
   - Campo ausente (si es obligatorio) o de tipo JSON incorrecto (incluido `null` en un campo opcional, que solo
     puede estar ausente) → `bad_request`.
   - `url` que es un texto pero no está en la gramática G (ver «URL (`url`): gramática G») → `bad_url`.
   - `name` (de `openTemporary`) que es un texto pero no un nombre de contenedor válido → `bad_name`.
   - Cualquier otro formato inválido (carpeta de perfil, id, token, código, nonce, clave o `base64` de icono,
     `mime`…) → `bad_request`. De `data` y `bindings` (`sync.put`) el host solo comprueba la estructura que fija
     «`data` y `bindings` de `sync.put`» más abajo (incluido el máximo de 100 vínculos); si falla, `bad_request`.
   - Los **campos desconocidos** de `args` se comprueban al final, cuando todos los campos del esquema han pasado
     → `bad_request`.
7. Solo cuando la petición ya es válida en forma (pasos 1 a 6), `sync.put` cuyo `data` supera
   `MAX_SHARED_DATA_BYTES` (524288) o cuyos `bindings` superan `MAX_SHARED_BINDINGS_BYTES` (131072) → `too_large`.
   Cada tamaño son los **bytes recibidos de su valor**, es decir, el trozo de JSON en bruto tal como llegó (en Go,
   `json.RawMessage`: desde el primer carácter del valor hasta el último, sin los espacios ni la coma de alrededor), no
   los de una re-serialización. Los códigos que dependen del estado del host (sección «Códigos que dependen del estado
   del host») vienen también después del paso 6; su orden respecto a este paso lo decide el host.

Ejemplos del orden (todos se deducen de las reglas anteriores; cada uno es un fixture cuyo nombre empieza por
«orden:»):

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
| `sync.get`      | `token`                                     | `revision`, `data` (`null` o los datos guardados), `bindings` (los vínculos guardados); ver la sección siguiente                                   |
| `sync.put`      | `token`, `baseRevision`, `data`, `bindings` | `revision`                                                                                                                                         |
| `icons.get`     | `token`, `key`                              | `key`, `mime`, `base64` (implementación en F2)                                                                                                     |
| `icons.put`     | `token`, `key`, `mime`, `base64`            | `{}` (implementación en F2)                                                                                                                        |
| `icons.delete`  | `token`, `key`                              | `{}` (implementación en F2)                                                                                                                        |

Los formatos de cada campo están en «Reglas que Go debe replicar al carácter».

Los comandos `icons.*` forman parte del contrato (esquemas y fixtures), pero se implementan en F2: en F1 la extensión
solo usa iconos empaquetados y emoji, y no envía imágenes subidas.

`listProfiles` y `pair.list`: el host omite los perfiles de `Local State` (y las instalaciones) que no cumplen
`ProfileDirectorySchema` o `ProfileInfoSchema` (una carpeta que empieza por `-`, un nombre de más de 256 unidades
UTF-16…) y nunca devuelve más de 500 perfiles ni más de 16 instalaciones. Así un perfil raro no convierte toda la
respuesta en `bad_response` para la extensión.

### `data` y `bindings` de `sync.put`

Aquí el trabajo se reparte a propósito. El host valida **solo la estructura** y guarda `data` y `bindings` tal como
los recibió (en Go, `json.RawMessage` con los bytes recibidos):

- `data` es un objeto JSON (un array no lo es) de como mucho `MAX_SHARED_DATA_BYTES` bytes recibidos (`too_large`,
  paso 7).
- `data.schemaVersion` es el entero `1`.
- `data.revision` es un entero entre 0 y 9007199254740991, como cualquier revisión.
- `bindings` es un objeto JSON (un array no lo es) con como mucho 100 claves (`LIMITS.identities`) y como mucho
  `MAX_SHARED_BINDINGS_BYTES` bytes recibidos (`too_large`, paso 7). El host no valida cada vínculo.

Si falla alguna de las comprobaciones de estructura, `bad_request`. Los fixtures `sync.put con schemaVersion 2`,
`sync.put con bindings como array`, `sync.put con data como array` y `sync.put con 101 vínculos` fijan cuatro de ellas
(y `sync.put con baseRevision negativa`, un entero inválido del propio `args`). El esquema completo de `LauncherData` y
de los vínculos (`packages/core/src/schema.ts`: `LauncherDataSchema`, `BindingsSchema`, más las reglas cruzadas de
`validateData`) lo aplica la **extensión**: valida lo que envía y valida al leer. Es una decisión deliberada,
registrada en ADR-004: mantiene pequeño el host en Go, y las instalaciones emparejadas están autenticadas por su token.
Por eso `HostRequestSchema` (TypeScript) es más estricto con `data` y `bindings` que lo que el host debe exigir, y un
host que guarda un `data` que la extensión rechazaría al leerlo no incumple este contrato.

**La respuesta de `sync.get` también es estructural.** `parseHostResponse` (`HOST_RESULT_SCHEMAS['sync.get']`) solo
comprueba que `data` es `null` o un objeto (no un array) con `schemaVersion` entero ≥ 1, sin mirar el resto de sus
campos, y que `bindings` es un objeto (no un array) con como mucho 100 claves, sin validar cada vínculo. Unos datos que
escribió otra versión de la extensión no son una respuesta rota del host. Después el SW valida: `loadData` de core
(migra y aplica el esquema completo; con una versión más nueva, `unsupported_version`) para `data`, y `BindingsSchema`
para `bindings`. El fixture `sync.get con datos y vínculos` es una respuesta con los dos campos llenos.

## Decodificación en Go

Normativo. Usado como de costumbre, `encoding/json` rompe la regla de objetos estrictos (comprobado con Go 1.27.1):

- **Claves exactas, distinguiendo mayúsculas.** `json.Unmarshal` a un struct empareja las claves sin distinguir
  mayúsculas, también con `DisallowUnknownFields`, y si dos claves coinciden así gana la última:
  `{"profileDirectory":"Default","url":"https://ok.example/","URL":"--x"}` deja `--x` en el campo de la URL. Por eso
  el host decodifica cada objeto (el sobre, `args`, `data` y `bindings`) como `map[string]json.RawMessage` y compara
  las claves tal cual. **Nunca** hace `json.Unmarshal` a un struct. `V`, `CMD`, `Args` o `URL` son claves desconocidas
  (y la de verdad falta), con el código que toque según el orden de comprobación. Lo fijan los fixtures
  `V en mayúsculas` (`unsupported_version`), `CMD en mayúsculas`, `Args en lugar de args`,
  `open con URL en lugar de url` y `open con url válida y URL de más` (los cuatro, `bad_request`; un host que decodifica
  a structs devolvería `bad_url` en el último).
- **Un marco es exactamente un valor JSON.** Datos después del valor → `bad_request` (paso 2). `json.Unmarshal` ya los
  rechaza. `json.Decoder.Decode` no (lee el primer valor y deja el resto): si se usa, hay que comprobar que después
  solo queda espacio en blanco.
- **UTF-8 inválido o sustitutos sueltos → `bad_request`** (paso 2). `json.Unmarshal` los convierte en U+FFFD sin
  avisar y `json.Valid` los da por buenos. El host comprueba `utf8.Valid` sobre el marco y rechaza los escapes
  `\uD800` a `\uDFFF` que no formen un par (uno alto seguido de uno bajo) antes de decodificar.
- **Claves duplicadas: gana la última**, como en `JSON.parse`. Es lo que hace `json.Unmarshal` a un `map`:
  `{"v":2,"v":1,…}` es la versión 1.

Las claves duplicadas y el UTF-8 inválido no caben en un fixture (un archivo JSON válido no los puede llevar y
`JSON.parse` deja solo la última clave): Go los cubre con pruebas unitarias.

## Escritura de respuestas en Go

Normativo (comprobado con Go 1.27.1):

- El host escribe cada respuesta con `json.Encoder` y `SetEscapeHTML(false)`, y quita el salto de línea final que
  añade `Encode` antes de calcular el prefijo de longitud. **Nunca** `json.Marshal`: escapa `<`, `>` y `&` como
  `\u003c`, `\u003e` y `\u0026` (6 bytes en lugar de 1) también dentro de un `json.RawMessage`. Con 512 KiB de `<` en
  `data`, `json.Marshal` escribe más de 3 MB y `sync.get` superaría `MAX_HOST_RESPONSE_BYTES`: el almacén quedaría
  ilegible.
- `data` y `bindings` se guardan como `json.RawMessage` con los bytes recibidos y `sync.get` los devuelve así, sin
  decodificarlos ni volver a codificarlos. Byte a byte, con dos excepciones que introduce `json.Encoder` en cualquier
  `json.RawMessage`: quita los espacios en blanco (nunca crece) y escribe U+2028 y U+2029 como `\u2028` y `\u2029`
  (de 3 a 6 bytes, aun con `SetEscapeHTML(false)`).
- El host tiene una prueba unitaria en la que un `data` de 512 KiB formado casi solo por `<` cabe en la respuesta de
  `sync.get` (con `json.Encoder` sin escape HTML ocupa unos 524 300 bytes).
- Defensa en profundidad: si una respuesta fuera a superar `MAX_HOST_RESPONSE_BYTES`, el host devuelve `internal` en
  su lugar. Con las reglas anteriores solo puede pasar con datos patológicos: unos 512 KiB formados casi solo por
  U+2028 o U+2029 se duplican al escribirse.

## Reglas que Go debe replicar al carácter

Las expresiones regulares están ancladas al texto completo (`^…$`, sin modo multilínea): un salto de línea final
no es válido. `\d` es solo `0-9`.

Enteros de las peticiones (solo de ellas): `v`, `baseRevision`, `data.schemaVersion` y `data.revision` son enteros
JSON. TypeScript los lee con `JSON.parse`, que acepta `1.0` y `1e0` como el entero 1. La extensión nunca los escribe
así: `JSON.stringify` emite un entero (hasta 2^53 − 1) siempre como dígitos, sin fracción ni exponente. Por eso Go
puede rechazar con `bad_request` cualquier entero escrito con fracción o exponente (también en `v`). Los fixtures no
incluyen esas formas y este contrato no las fija. En las respuestas, el host escribe sus enteros (`revision`,
`maxPairedProfiles`) siempre como dígitos.

### URL (`url`): gramática G

La regla es una gramática explícita, **G**. El host la comprueba **tal cual** (sin serializador WHATWG: Go no lo
tiene) y rechaza con `bad_url` todo texto que no esté en G, ni más ni menos. `core.normalizeUrl` la cumple **por
construcción**: serializa con el estándar WHATWG URL y rechaza lo que no esté en G. Así, toda URL que envía la
extensión está en G, y todo lo que está en G es canónico para WHATWG (`new URL(s).href === s`, la forma de los
navegadores y de Node), con la única excepción del punycode de más abajo. Referencia en TypeScript: `isUrlInGrammar`
de core, que es lo que usa `HostUrlSchema`.

Un texto está en G si y solo si cumple todo esto:

- Como mucho 2048 caracteres (`MAX_URL_LENGTH`), todos ASCII imprimible (U+0021 a U+007E): sin espacios ni
  caracteres de control.
- Empieza por `https://` o `http://`, en minúsculas. El host acepta `http` siempre; que solo se use con `allowHttp`
  es política del core, que la aplica antes de enviar.
- Siguen el host, un puerto opcional y la **ruta, que es obligatoria**: el host y el puerto acaban en el primer `/`,
  `?` o `#`, y ese carácter tiene que ser `/` (`https://github.com` no vale).
- **Host**, de una de estas dos formas (nunca IPv6 ni _userinfo_):
  - IPv4 canónica: cuatro números decimales de 0 a 255 separados por `.`, sin ceros a la izquierda (`0.0.0.0` vale,
    `010.0.0.1` no).
  - Dominio: etiquetas de 1 a 63 caracteres de `[a-z0-9_-]` separadas por `.`, con un `.` final opcional. La última
    etiqueta (sin contar ese `.` final) no puede ser solo dígitos ni empezar por `0x`: WHATWG leería el host como una
    IPv4 y lo reescribiría (`1.2.3` → `1.2.0.3`, `0x7f.0.0.1` → `127.0.0.1`).
- **Puerto** (opcional): `:` seguido de un número de 1 a 65535 sin ceros a la izquierda, y nunca el puerto por
  defecto del esquema (`443` en `https`, `80` en `http`). `:` solo, `:0` y `:0443` no valen.
- **Ruta, consulta y fragmento:** el primer `?` abre la consulta y el primer `#` abre el fragmento (los dos son
  opcionales y pueden estar vacíos: `https://example.com/?` y `https://example.com/#` valen). Cada componente admite
  todo el ASCII imprimible salvo los caracteres de esta tabla:

| Componente                                                  | Caracteres excluidos                    | `%`        |
| ----------------------------------------------------------- | --------------------------------------- | ---------- |
| Ruta: desde el primer `/` hasta el primer `?`, `#` o el fin | `"` `#` `<` `>` `?` `` ` `` `{` `}` `\` | Solo `%XX` |
| Consulta: tras el primer `?`, hasta el primer `#` o el fin  | `"` `#` `<` `>` `'`                     | Solo `%XX` |
| Fragmento: tras el primer `#`                               | `"` `<` `>` `` ` ``                     | Solo `%XX` |

- `%XX` es `%` seguido de dos dígitos hexadecimales, en mayúsculas o minúsculas: `%7e` y `%7E` valen; `%zz`, `%2`,
  `%G0`, `%%41` y un `%` al final no.
- **Segmentos punto:** ningún segmento de la ruta (lo que hay entre dos `/`, o tras el último) es `.`, `..`, `%2e`,
  `.%2e`, `%2e.` ni `%2e%2e`, sin distinguir mayúsculas (`%2E` cuenta). `...` y `%2e.%2e` sí valen.

Las clases de la tabla son los caracteres que WHATWG deja sin codificar en cada componente con un esquema especial
(comprobado con Node 22.22.3, ada 2.9.2); por eso lo que está en G es canónico. WHATWG admite además formas que G deja
fuera, y que `normalizeUrl` por tanto rechaza: hosts con otros caracteres (`a!b.example`, `a{b}.example`), etiquetas
vacías o de más de 63, IPv6, el puerto `0` y el `%` mal formado. `core/test/url.test.ts` comprueba las dos
propiedades (lo que acepta `normalizeUrl` está en G; lo que está en G es canónico) sobre un corpus de unas 3000 URLs,
y `test/host.test.ts` sobre las URLs de los fixtures.

**Excepción: punycode.** Una etiqueta que empieza por `xn--` está en G si cumple el formato de etiqueta, aunque su
punycode no sea válido. WHATWG rechaza esas URLs (`new URL('https://xn--a.example/')` lanza un error), así que no
tienen ninguna otra forma canónica. Go no valida el punycode (haría falta IDNA, que no está en la biblioteca
estándar): las acepta, y el navegador no las abre. `normalizeUrl` nunca las produce.

**Fixtures.** Se rechazan con `bad_url`, una clase por caso: esquema que no es http(s) (`javascript:`, `file:`), texto
sin esquema (`--incognito`), _userinfo_, host sin ruta, salto de línea, esquema o host en mayúsculas, puerto por
defecto, puerto con cero a la izquierda (`:0443`), puerto vacío (`:`), segmentos `.` y `..` (también `%2e%2e`),
espacio, dominio Unicode sin punycode, IPv4 abreviada (`127.1`), de tres partes (`1.2.3`), con cero a la izquierda
(`010.0.0.1`) o hexadecimal (`0x7f.0.0.1`), IPv6 (`[::1]`), `{`, `"`, `<`, `>` y `` ` `` en la ruta, `'` y `"` en la
consulta, `` ` `` en el fragmento, `%zz` y `%` al final. Se aceptan la ruta `/`, una consulta con `%40`, `%7e` en
minúsculas, `{x}` en la consulta, `^` y `|` en la ruta, un dominio en punycode (`xn--`) y `http:`.

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
| `MAX_SHARED_BINDINGS_BYTES`   | 131072  | Tamaño máximo de los `bindings` de `sync.put`, medido igual (paso 7).                 |
| `MAX_ICON_BYTES`              | 32768   | Tamaño decodificado de un icono.                                                      |
| `PAIR_CODE_TTL_SECONDS`       | 120     | Vida del código de emparejamiento (`pair.start` → `expiresAt`).                       |
| `PROOF_TTL_SECONDS`           | 60      | Vida de la verificación de perfil (`pair.verify` → `expiresAt`, y su `nonce`).        |
| `DEFAULT_MAX_PAIRED_PROFILES` | 2       | Valor por defecto de `maxPairedProfiles` en `pair.list`.                              |
| `MAX_CONTAINER_NAME`          | 64      | Puntos de código de un nombre de contenedor.                                          |

`test/limits.test.ts` fija estos diez valores: cambiar uno obliga a cambiar la prueba, este README y el host. También
comprueba que 100 vínculos válidos en el peor caso realista (ids de 64 caracteres, carpetas de 255 y `desiredName` de
80, con caracteres de 3 bytes) ocupan unos 114 000 bytes: la extensión nunca provoca el `too_large` de los vínculos.

Cuenta de `sync.get`: 512 KiB de `data` + 128 KiB de `bindings` + el sobre (unos cien bytes) son unos 655 500 bytes,
por debajo de `MAX_HOST_RESPONSE_BYTES`. El host nunca escribe una respuesta mayor; si fuera a hacerlo, devuelve
`internal` (ver «Escritura de respuestas en Go»).

## Códigos que dependen del estado del host

Los fixtures no pueden cubrir estos códigos porque dependen de lo que el host tiene guardado o del sistema. Go los
cubre con sus pruebas unitarias. La columna «cuándo» es solo una guía: las pruebas de Go y el estado del host la
concretan.

| Código                | Cuándo                                                                                                                                                                                                          |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `too_large`           | Petición de más de `MAX_HOST_REQUEST_BYTES` (paso 1), o `sync.put` con `data` de más de `MAX_SHARED_DATA_BYTES` o `bindings` de más de `MAX_SHARED_BINDINGS_BYTES`, medidos sobre los bytes recibidos (paso 7). |
| `name_in_use`         | El nombre pedido ya existe y debe ser único.                                                                                                                                                                    |
| `unknown_profile`     | `profileDirectory` no es un perfil existente del navegador.                                                                                                                                                     |
| `unsupported_browser` | El navegador del host no admite el comando (por ejemplo `openTemporary` fuera de Brave).                                                                                                                        |
| `not_paired`          | El `token` no corresponde a ninguna instalación emparejada.                                                                                                                                                     |
| `bad_code`            | El código de `pair.join` es incorrecto, ha caducado o ya se usó: **no se distingue** entre los tres casos, para no dar pistas a quien prueba códigos.                                                           |
| `limit_reached`       | Se alcanzó el máximo de perfiles emparejados.                                                                                                                                                                   |
| `conflict`            | `sync.put` con una `baseRevision` que no es la actual. Siempre lleva `revision` (la actual del host).                                                                                                           |
| `bad_nonce`           | El `nonce` de `pair.prove` es desconocido, ha caducado o no corresponde.                                                                                                                                        |
| `not_found`           | El recurso pedido no existe (por ejemplo un icono).                                                                                                                                                             |
| `launch_failed`       | El navegador no se pudo lanzar.                                                                                                                                                                                 |
| `internal`            | Cualquier otro fallo del host, incluida una respuesta que fuera a superar `MAX_HOST_RESPONSE_BYTES`.                                                                                                            |

Los códigos de formato (`bad_request`, `unsupported_version`, `unknown_command`, `bad_url`, `bad_name`) salen del
orden de comprobación y sí los cubren los fixtures.

## Qué no cubren los fixtures

- Los tamaños grandes (un mensaje de más de 1 MiB, una URL de 2048 y 2049 caracteres, un icono de 32768 y 32769
  bytes, un `data` de más de 512 KiB, unos `bindings` de más de 128 KiB) ocuparían decenas o cientos de KB de JSON. La
  URL y el icono se prueban en TypeScript (`core/test/url.test.ts` y `test/host.test.ts`); el resto solo lo cubre Go.
  Go debe probarlos todos en sus pruebas unitarias, más la respuesta de `sync.get` con 512 KiB de `<` («Escritura de
  respuestas en Go») y el `internal` de una respuesta demasiado grande.
- `data` y `bindings` de `sync.put` solo tienen un caso válido y cuatro negativos de estructura (`schemaVersion` 2,
  `bindings` y `data` que son arrays, 101 vínculos), más uno de `baseRevision` negativa. El esquema completo de
  `LauncherData` lo aplica la extensión, no el host. Go cubre el resto con sus pruebas unitarias, incluida una que
  muestre que acepta campos extra o desconocidos dentro de `data` (el host no valida más que la estructura).
- Lo que no cabe en un archivo JSON: claves duplicadas, UTF-8 inválido, sustitutos sueltos y datos después del valor
  (ver «Decodificación en Go»). Go los cubre con pruebas unitarias.

## Añadir un caso

1. Añade el caso al JSON (sin tocar los existentes) con el estilo de Prettier del proyecto.
2. Comprueba que falla o pasa por el campo que quieres probar y no por otro.
3. Si cambia una regla, cambia también el esquema, este README y la prueba que la fija; y avisa al responsable del
   host en Go.
