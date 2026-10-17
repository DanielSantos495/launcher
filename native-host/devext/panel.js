// Panel de pruebas manuales del host nativo (F1-B). Un botón por comando del contrato, con los argumentos que el
// host espera. Todo lo que se muestra entra con textContent: nunca innerHTML.

const HOST_PREFIX = 'com.curyapps.launcher'

// Marcas exactas de User-Agent Client Hints; "Chromium" y las marcas GREASE se ignoran.
const BRANDS = new Map([
  ['Brave', 'brave'],
  ['Microsoft Edge', 'edge'],
  ['Google Chrome', 'chrome'],
])

// hostName elige el host por navegador. Si no hay exactamente una marca conocida lanza un error: elegir mal el host
// lanzaría otro navegador.
function hostName() {
  const brands = navigator.userAgentData?.brands
  const names = Array.isArray(brands) ? brands.map((b) => b.brand).filter((b) => typeof b === 'string') : []
  const found = names.filter((name) => BRANDS.has(name))
  if (found.length !== 1) {
    throw new Error(`No se puede detectar el navegador (marcas: ${names.join(', ') || 'ninguna'})`)
  }
  return `${HOST_PREFIX}.${BRANDS.get(found[0])}`
}

// Campos editables y su valor inicial. token e installationId se rellenan desde storage.local.
const FIELDS = [
  ['token', ''],
  ['installationId', ''],
  ['profileDirectory', 'Default'],
  ['url', 'https://github.com/'],
  ['name', ''],
  ['code', ''],
  ['identityId', ''],
  ['nonce', ''],
  ['baseRevision', '0'],
  ['data', '{"schemaVersion":1,"revision":0}'],
  ['bindings', '{}'],
  ['key', 'icon:prueba'],
  ['mime', 'image/png'],
  ['base64', 'iVBORw0KGgo='],
]

// Los 17 comandos y los campos de sus args; el prefijo ? marca un campo opcional.
const COMMANDS = [
  ['ping', []],
  ['listProfiles', []],
  ['open', ['profileDirectory', 'url']],
  ['openTemporary', ['profileDirectory', 'url', '?name']],
  ['createProfile', []],
  ['pair.start', ['installationId', '?token']],
  ['pair.join', ['installationId', 'code']],
  ['pair.declare', ['token', 'profileDirectory', '?identityId']],
  ['pair.list', ['token']],
  ['pair.remove', ['token', 'installationId']],
  ['pair.verify', ['token']],
  ['pair.prove', ['token', 'nonce']],
  ['sync.get', ['token']],
  ['sync.put', ['token', 'baseRevision', 'data', 'bindings']],
  ['icons.get', ['token', 'key']],
  ['icons.put', ['token', 'key', 'mime', 'base64']],
  ['icons.delete', ['token', 'key']],
]

const inputs = new Map()
const resultEl = document.getElementById('result')

function show(text) {
  resultEl.textContent = text
}

// buildArgs arma los args de un comando con el valor actual de los campos.
function buildArgs(fields) {
  const args = {}
  for (const spec of fields) {
    const optional = spec.startsWith('?')
    const name = optional ? spec.slice(1) : spec
    const value = inputs.get(name).value
    if (optional && value === '') continue
    if (name === 'baseRevision') {
      args[name] = Number(value)
    } else if (name === 'data' || name === 'bindings') {
      args[name] = JSON.parse(value)
    } else {
      args[name] = value
    }
  }
  return args
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

// saveToken guarda el token que devuelven pair.start (primer emparejamiento) y pair.join.
async function saveToken(response) {
  const token = response?.result?.token
  if (response?.ok !== true || typeof token !== 'string') return
  inputs.get('token').value = token
  await chrome.storage.local.set({ token })
}

async function runCommand(cmd, fields) {
  show(`${cmd}: enviando…`)
  try {
    const args = buildArgs(fields)
    const started = performance.now()
    const response = await sendNative(hostName(), { v: 1, cmd, args })
    const ms = Math.round(performance.now() - started)
    show(`${cmd} (${ms} ms)\n${JSON.stringify(response, null, 2)}`)
    if (cmd === 'pair.start' || cmd === 'pair.join') await saveToken(response)
  } catch (e) {
    show(`${cmd}: ${e instanceof Error ? e.message : String(e)}`)
  }
}

function addField(container, name, initial) {
  const label = document.createElement('label')
  const caption = document.createElement('span')
  caption.textContent = name
  const input = document.createElement('input')
  input.type = 'text'
  input.value = initial
  input.spellcheck = false
  label.append(caption, input)
  container.append(label)
  inputs.set(name, input)
}

function addButton(container, text, onClick) {
  const button = document.createElement('button')
  button.type = 'button'
  button.textContent = text
  button.addEventListener('click', () => void onClick())
  container.append(button)
}

async function init() {
  const stored = await chrome.storage.local.get(['installationId', 'token'])
  let installationId = stored.installationId
  if (typeof installationId !== 'string' || installationId === '') {
    installationId = crypto.randomUUID()
    await chrome.storage.local.set({ installationId })
  }
  const fieldsEl = document.getElementById('fields')
  for (const [name, initial] of FIELDS) addField(fieldsEl, name, initial)
  inputs.get('installationId').value = installationId
  inputs.get('token').value = typeof stored.token === 'string' ? stored.token : ''

  const commandsEl = document.getElementById('commands')
  for (const [cmd, fields] of COMMANDS) addButton(commandsEl, cmd, () => runCommand(cmd, fields))

  const toolsEl = document.getElementById('tools')
  addButton(toolsEl, 'Olvidar token', async () => {
    await chrome.storage.local.remove('token')
    inputs.get('token').value = ''
    show('Token olvidado (solo en esta instalación de la extensión).')
  })

  document.getElementById('extension').textContent = chrome.runtime.id
  try {
    document.getElementById('host').textContent = hostName()
  } catch (e) {
    show(e instanceof Error ? e.message : String(e))
  }
}

init().catch((e) => show(`Error al iniciar: ${e instanceof Error ? e.message : String(e)}`))
