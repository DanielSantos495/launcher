// Un nombre de host por navegador: en macOS Brave lee los manifests de la carpeta de Chrome y la
// extensión tiene el mismo ID en ambos, así que un nombre único haría que un manifest pisara al otro.
export const HOST_PREFIX = 'com.curyapps.launcher'

export type BrowserBrand = 'brave' | 'chrome' | 'edge'

// Marcas exactas de User-Agent Client Hints. "Chromium" y las marcas GREASE se ignoran.
const BRANDS: ReadonlyMap<string, BrowserBrand> = new Map([
  ['Brave', 'brave'],
  ['Microsoft Edge', 'edge'],
  ['Google Chrome', 'chrome'],
])

// Recibe navigator.userAgentData.brands (forma no fiable, por eso unknown). Con cero o varias marcas conocidas,
// o con una forma inesperada, devuelve undefined: elegir mal el host lanzaría otro navegador.
export function hostNameFor(brands: unknown): string | undefined {
  if (!Array.isArray(brands)) return undefined
  const entries: unknown[] = brands
  const found: BrowserBrand[] = []
  for (const entry of entries) {
    if (typeof entry !== 'object' || entry === null) continue
    const brand: unknown = Reflect.get(entry, 'brand')
    const known = typeof brand === 'string' ? BRANDS.get(brand) : undefined
    if (known !== undefined) found.push(known)
  }
  const [only] = found
  return found.length === 1 && only !== undefined ? `${HOST_PREFIX}.${only}` : undefined
}

// Lee navigator.userAgentData?.brands sin conversiones de tipo. El service worker lo tiene (WorkerNavigator).
export function readBrands(nav: object): unknown {
  const data: unknown = Reflect.get(nav, 'userAgentData')
  if (typeof data !== 'object' || data === null) return undefined
  const brands: unknown = Reflect.get(data, 'brands')
  return brands
}
