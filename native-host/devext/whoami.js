// Página whoami: el host la abre en el perfil declarado de una instalación (pair.verify) con el nonce en el
// fragmento. Lee el token de esta instalación, envía pair.prove y, si el host lo acepta, cierra su pestaña.

const HOST_PREFIX = 'com.curyapps.launcher'
const NONCE_PATTERN = /^[A-Za-z0-9_-]{16,64}$/
const CLOSE_AFTER_MS = 1500

// Marcas exactas de User-Agent Client Hints; "Chromium" y las marcas GREASE se ignoran.
const BRANDS = new Map([
  ['Brave', 'brave'],
  ['Microsoft Edge', 'edge'],
  ['Google Chrome', 'chrome'],
])

function hostName() {
  const brands = navigator.userAgentData?.brands
  const names = Array.isArray(brands) ? brands.map((b) => b.brand).filter((b) => typeof b === 'string') : []
  const found = names.filter((name) => BRANDS.has(name))
  if (found.length !== 1) {
    throw new Error(`No se puede detectar el navegador (marcas: ${names.join(', ') || 'ninguna'})`)
  }
  return `${HOST_PREFIX}.${BRANDS.get(found[0])}`
}

const resultEl = document.getElementById('result')

function show(text) {
  resultEl.textContent = text
}

function sendNative(host, payload) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendNativeMessage(host, payload, (response) => {
      const error = chrome.runtime.lastError
      if (error) reject(new Error(error.message))
      else resolve(response)
    })
  })
}

async function closeThisTab() {
  const tab = await chrome.tabs.getCurrent()
  if (tab?.id !== undefined) await chrome.tabs.remove(tab.id)
}

async function main() {
  const nonce = location.hash.slice(1)
  if (!NONCE_PATTERN.test(nonce)) {
    show('El fragmento de la URL no es un nonce válido.')
    return
  }
  const { token } = await chrome.storage.local.get('token')
  if (typeof token !== 'string' || token === '') {
    show('Esta instalación no tiene token: empareja desde el panel primero.')
    return
  }
  const response = await sendNative(hostName(), { v: 1, cmd: 'pair.prove', args: { token, nonce } })
  show(JSON.stringify(response, null, 2))
  if (response?.ok === true) setTimeout(() => void closeThisTab(), CLOSE_AFTER_MS)
}

main().catch((e) => show(e instanceof Error ? e.message : String(e)))
