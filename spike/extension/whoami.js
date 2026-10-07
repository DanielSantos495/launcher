import { parseNonce, newMarker } from './whoami-lib.js'

const MARKER_KEY = 'step0Marker'
const logEl = document.getElementById('log')

function print(line) {
  logEl.textContent = `${new Date().toISOString()} ${line}\n` + logEl.textContent
}

function showNonce() {
  document.getElementById('nonce').textContent = parseNonce(location.hash) ?? '(ninguno o no válido)'
}

async function showMarker() {
  const { [MARKER_KEY]: marker } = await chrome.storage.local.get(MARKER_KEY)
  document.getElementById('marker').textContent = marker ?? '(sin marcador)'
}

document.getElementById('ext').textContent = chrome.runtime.id
document.getElementById('new-marker').addEventListener('click', async () => {
  await chrome.storage.local.set({ [MARKER_KEY]: newMarker() })
  await showMarker()
  print('marcador guardado en storage.local')
})
// Prueba 4f: cerrar la propia pestaña sin el permiso "tabs" (getCurrent y remove no lo exigen).
document.getElementById('close').addEventListener('click', async () => {
  try {
    const tab = await chrome.tabs.getCurrent()
    if (!tab) {
      print('no se pudo cerrar: la página no está en una pestaña')
      return
    }
    await chrome.tabs.remove(tab.id)
  } catch (e) {
    print(`no se pudo cerrar: ${e.message}`)
  }
})
window.addEventListener('hashchange', showNonce)
showNonce()
showMarker().catch((e) => print(`storage: ${e.message}`))
