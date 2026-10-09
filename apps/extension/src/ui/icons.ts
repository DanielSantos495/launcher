// Iconos empaquetados en public/icons (T6: nada de recursos de terceros). Los nombres de servicio son los de
// CATALOG[].icon de core; los glifos son para carpetas e identidades.
export const SERVICE_ICONS = ['gmail', 'gemini', 'github', 'claude', 'chatgpt', 'shopify', 'cloudflare', 'web'] as const

export const GLYPH_ICONS = [
  'folder',
  'briefcase',
  'home',
  'star',
  'code',
  'cart',
  'chat',
  'mail',
  'globe',
  'user',
  'heart',
  'bolt',
] as const

const SERVICE_SET: ReadonlySet<string> = new Set(SERVICE_ICONS)
const GLYPH_SET: ReadonlySet<string> = new Set(GLYPH_ICONS)

// URL del icono empaquetado, o undefined si el nombre no es uno de ellos (nunca construye rutas con texto libre).
export function bundledIconUrl(name: string): string | undefined {
  if (SERVICE_SET.has(name)) return `/icons/services/${name}.svg`
  if (GLYPH_SET.has(name)) return `/icons/glyphs/${name}.svg`
  return undefined
}
