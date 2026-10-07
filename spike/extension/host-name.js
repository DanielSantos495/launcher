// Un nombre de host por navegador: en macOS Brave lee los manifests de la carpeta de Chrome y la
// extensión tiene el mismo ID en ambos, así que un nombre único haría que un manifest pisara al otro.
export const HOST_PREFIX = 'com.curyapps.launcher.spike'

// Marcas exactas de User-Agent Client Hints. "Chromium" y las marcas GREASE se ignoran.
const BRANDS = new Map([
  ['Brave', 'brave'],
  ['Microsoft Edge', 'edge'],
  ['Google Chrome', 'chrome'],
])

// hostNameFor recibe navigator.userAgentData.brands. Si no hay exactamente una marca conocida,
// lanza un error: elegir mal el host lanzaría otro navegador.
export function hostNameFor(brands) {
  const names = Array.isArray(brands) ? brands.map((b) => b?.brand).filter((b) => typeof b === 'string') : []
  const found = names.filter((name) => BRANDS.has(name))
  if (found.length !== 1) {
    throw new Error(`No se puede detectar el navegador (marcas: ${names.join(', ') || 'ninguna'})`)
  }
  return `${HOST_PREFIX}.${BRANDS.get(found[0])}`
}
