// El nonce llega en el fragmento (#…) y es un dato no confiable: solo se aceptan de 16 a 64 caracteres base64url.
const NONCE = /^[A-Za-z0-9_-]{16,64}$/

export function parseNonce(hash) {
  const raw = typeof hash === 'string' && hash.startsWith('#') ? hash.slice(1) : ''
  return NONCE.test(raw) ? raw : null
}

// Marcador de 128 bits en hexadecimal para buscarlo en los archivos del perfil (Step 0, prueba 4e).
export function newMarker(getRandomValues = (a) => crypto.getRandomValues(a)) {
  const bytes = getRandomValues(new Uint8Array(16))
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}
