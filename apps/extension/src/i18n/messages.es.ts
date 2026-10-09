// Catálogo en español: es la fuente de las claves (MessageKey). Las plurales llevan los sufijos .one y .other.
export const es = {
  'app.title': 'Account Launcher',
  'app.loading': 'Cargando…',
  'common.hello': 'Hola, {name}',
  'common.items.one': '{count} elemento',
  'common.items.other': '{count} elementos',
  'whoami.title': 'Verificación del perfil',
  'whoami.checking': 'Comprobando este perfil…',
  'whoami.verified': 'Perfil verificado. Ya puedes cerrar esta pestaña.',
  'whoami.failed': 'No se pudo verificar este perfil.',
  'whoami.invalid': 'El enlace de verificación no es válido.',
  'whoami.close': 'Cerrar esta pestaña',
} as const satisfies Record<string, string>
