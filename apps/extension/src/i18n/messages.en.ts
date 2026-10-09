import type { MessageKey } from './i18n'

// Catálogo en inglés: el tipo obliga a tener exactamente las mismas claves que el español.
export const en: Record<MessageKey, string> = {
  'app.title': 'Account Launcher',
  'app.loading': 'Loading…',
  'common.hello': 'Hello, {name}',
  'common.items.one': '{count} item',
  'common.items.other': '{count} items',
  'whoami.title': 'Profile check',
  'whoami.checking': 'Checking this profile…',
  'whoami.verified': 'Profile verified. You can close this tab now.',
  'whoami.failed': 'This profile could not be verified.',
  'whoami.invalid': 'The verification link is not valid.',
  'whoami.close': 'Close this tab',
}
