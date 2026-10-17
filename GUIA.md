# Account Launcher: guía de uso

## Qué es

Account Launcher es una extensión para Brave (también funciona en Chrome) que guarda tus cuentas ordenadas por identidad y las abre con un clic en el sitio correcto. Una identidad reúne las cuentas de una persona o de un rol, por ejemplo «Trabajo» o «Personal». Cada identidad puede tener su Gmail, su GitHub, su Claude, etc.

Para buscar una cuenta pulsa `Ctrl K` (o `Cmd K` en Mac) dentro del panel, y para abrir el panel pulsa su icono o `Cmd Shift K`.

El programa de apoyo `launcher-host` solo hace falta en el modo «Varios perfiles». Por ahora funciona en macOS.

## Instalación

### La extensión

1. Instala la extensión desde la página donde la hayas descargado.
2. Al terminar se abre el panel. Crea tu primera identidad y añade tu primera cuenta.

Con eso ya puedes usar el modo «Perfil único». No necesitas nada más.

### El programa `launcher-host` (solo para «Varios perfiles»)

1. En Configuración, en «Modo», elige «Varios perfiles». Si el programa no está instalado, la propia extensión te muestra los pasos.
2. Descarga `launcher-host` para macOS desde la página de versiones.
3. Abre Terminal en la carpeta donde lo descargaste y ejecuta:

   ```
   ./launcher-host install --extension-id lkiagpaidnmkiaabacdcmfkfhmjloocf
   ```

4. Vuelve a la extensión y pulsa «Comprobar de nuevo». Debe mostrar la versión del programa.

Si el programa es de otra versión que la extensión, la extensión te lo dice: actualiza o reinstala, es decir, descarga la última versión y repite los pasos. Para revisar la instalación puedes ejecutar `./launcher-host doctor`.

## Ordenar y volver a lo último

- **Reordenar cuentas**: arrastra una tarjeta sobre otra de su misma sección, o enfócala y pulsa `Alt ↑` o `Alt ↓`. El menú de acciones también tiene «Mover arriba» y «Mover abajo». Las favoritas se ordenan entre sí y no cruzan a las demás.
- **Reordenar identidades**: arrastra la cabecera de una sección sobre otra, o usa «Mover arriba» y «Mover abajo» en su menú de acciones.
- **Recientes**: en la cabecera, «Recientes» muestra las últimas 10 cuentas que has abierto. Hasta que abras alguna dice «Aún no has abierto ninguna cuenta».
- **Perfiles nuevos** (modo «Varios perfiles»): si aparece un perfil del navegador que no conocías, el panel avisa con «Perfil nuevo» y el botón «Ir a Vínculos» te lleva a vincularlo a una identidad. El aviso se puede descartar.

## Los dos modos

### Perfil único

Es el modo por defecto. Todo se abre en pestañas nuevas de la ventana en la que estás. No instala nada.

Úsalo si solo tienes una identidad o no te importa que las sesiones se compartan. Hay un límite: en un mismo perfil del navegador, un servicio que no admite varias cuentas a la vez (Claude, por ejemplo) mantiene una sola sesión. Si abres dos cuentas de ese servicio, la extensión te avisa en la tarjeta («Comparte sesión con…»).

### Varios perfiles

Cada identidad se abre en su propio perfil del navegador, así las sesiones no se mezclan. Necesita el programa `launcher-host`.

- En «Vínculos» eliges el perfil de cada identidad, o pulsas «Crear perfil» para que el launcher cree uno nuevo.
- El navegador no deja darle nombre a un perfil nuevo desde fuera: la extensión te dice qué nombre ponerle (en el perfil, icono y Editar) y detecta cuándo ya coincide.
- Al abrir una cuenta de una identidad vinculada, se abre en la ventana de su perfil. La cabecera de cada sección indica en qué perfil abre.
- Si dejas una identidad sin vincular, abre en la ventana en la que estás («Sin aislar»).
- Siempre puedes volver a «Perfil único»: tus cuentas siguen ahí.

## Por qué un perfil por identidad

Un perfil del navegador tiene sus propias cookies, extensiones y sesiones. Si metes dos cuentas del mismo servicio en el mismo perfil, una de las dos sesiones pisa a la otra o el servicio te las mezcla. Con un perfil por identidad, «Trabajo» y «Personal» pueden tener abiertas a la vez sus cuentas de Gmail, de GitHub o de Claude, cada una con su sesión y sin cerrar la otra.

Para Gmail y Gemini no hace falta separar los perfiles: la extensión abre cada cuenta con su propio email y cada una muestra su bandeja. Para el resto de servicios, un perfil por identidad es lo más seguro.

## Contenedor temporal

En Brave puedes abrir una cuenta o una dirección aislada con «Abrir en un contenedor temporal (aislado)». Se abre en la ventana en la que estás, pero con sus cookies y su sesión aparte.

- **Sin nombre**, cada vez es un contenedor nuevo: tienes que iniciar sesión cada vez.
- **Con nombre**, se reutiliza: abrir dos veces «Banco» abre el mismo contenedor. El nombre admite hasta 64 caracteres, sin «=» y sin empezar por «-». Si ya existe un contenedor guardado en Brave con ese nombre, la extensión lo avisa y no lo abre.
- **Los datos quedan en disco.** No se borran al cerrar la ventana ni al reiniciar Brave. Comparte extensiones y contraseñas con tu perfil.
- No inicies sesión en cuentas importantes en un contenedor temporal.

Antes de usarlo, indica qué perfil es el actual en Configuración, en «Este perfil es…». Solo está disponible en Brave y en el modo «Varios perfiles».

## Emparejamiento

Cuando usas varios perfiles, cada uno tiene su propia copia de la extensión. El emparejamiento hace que compartan la misma lista de cuentas: un cambio en un perfil aparece en los demás al volver a su pestaña o, como mucho, en 30 segundos.

Por defecto se pueden emparejar hasta 2 perfiles. Para cambiar el límite ejecuta, por ejemplo, `./launcher-host pairing --max 3`.

Para emparejar:

1. En el primer perfil, en Configuración, indica en «Este perfil es…» cuál es y, si quieres, su identidad. Pulsa «Activar sincronización». Aparece un código de 6 dígitos que caduca a los 2 minutos.
2. En el segundo perfil, haz lo mismo con «Este perfil es…», y en «Unirse con un código» escribe el código y pulsa «Unirse».
3. Si ya hay perfiles emparejados y quieres añadir otro, usa «Emparejar otro perfil» para sacar un código nuevo. Si se alcanzó el máximo, la extensión te lo dice: quita uno antes.

### Verificación

La extensión no puede saber por sí sola en qué perfil está cada copia. Por eso, pulsa «Verificar este perfil» en cada perfil emparejado. Se abre una pestaña que se cierra sola y la lista muestra «Verificado el…». Si el perfil que declaraste no tiene la extensión emparejada, verás «No verificado».

Para dejar de compartir, pulsa «Quitar» junto a un perfil de la lista. Ese perfil sigue con la copia local que tenga y puedes volver a emparejarlo con un código.

## Copia de seguridad

En Configuración, en «Copia de seguridad», puedes exportar tu lista a un archivo y recuperarla después.

- **Exportar copia** guarda un archivo con identidades, grupos, cuentas y servicios propios. Incluye emails y notas: guárdalo en un lugar seguro.
- **Importar copia** te pregunta cómo combinarla. «Fusionar» añade lo nuevo y conserva lo que ya tienes (si algo está en los dos sitios, gana lo modificado más recientemente). «Reemplazar» deja tu lista exactamente como la del archivo. Antes de importar, la extensión guarda una copia de lo que tienes ahora.
- **Los archivos de más de 5 MB no se importan**, y tampoco los que no sean una copia de Account Launcher.
- Al importar en el modo «Varios perfiles», los vínculos a perfiles se recuperan por nombre. Si alguna identidad queda sin perfil, la extensión te lo avisa y te lleva a «Vínculos».

### Exportación cifrada

Marca «Cifrar con contraseña» al exportar y elige una contraseña de 10 a 1024 caracteres. Para importar ese archivo te pedirá la contraseña.

**Si pierdes la contraseña, no hay forma de recuperar la copia.** Nadie, ni siquiera el proyecto, puede abrirla sin ella.

### Las imágenes no se exportan

Puedes usar una imagen propia (PNG, JPEG o WebP de hasta 32 KiB) como icono de una cuenta. Esas imágenes no van en la copia exportada: al importar, esas cuentas usan el icono automático y tendrás que volver a subirlas.

## Desinstalar

1. Si usas «Varios perfiles», vuelve antes a «Perfil único» en Configuración.
2. Ejecuta `./launcher-host uninstall`. Quita el programa y su configuración, y conserva tus datos compartidos. Si quieres borrarlo todo, añade `--purge`.
3. Quita la extensión desde la página de extensiones del navegador.

Antes de desinstalar, exporta una copia de seguridad si quieres conservar tus cuentas.

## Privacidad

- La extensión no hace ninguna conexión a internet por su cuenta y no usa servicios de terceros: ni analítica, ni cuentas, ni servidores.
- Solo pide dos permisos: guardar datos en el navegador (`storage`) y hablar con el programa `launcher-host` (`nativeMessaging`).
- Tus datos se guardan en tu equipo: en el navegador y, con «Varios perfiles», también en un almacén local del programa. No salen de ahí.
- El programa `launcher-host` tampoco usa la red. Solo abre perfiles del navegador y guarda la lista compartida en tu equipo.
- El registro del programa no guarda direcciones ni nombres de cuentas.
- Una cuenta solo se abre cuando tú la abres. La extensión nunca guarda ni lee contraseñas.
