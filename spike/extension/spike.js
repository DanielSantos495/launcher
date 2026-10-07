const logEl = document.getElementById('log')

function print(label, value) {
  logEl.textContent = `${new Date().toISOString()} ${label}\n${JSON.stringify(value, null, 2)}\n\n` + logEl.textContent
}

async function callHost(payload) {
  const res = await chrome.runtime.sendMessage({ type: 'native', payload })
  print(payload.cmd, res)
  return res
}

function openPayload() {
  const open = {
    v: 1,
    profileDirectory: document.getElementById('profile').value,
    url: document.getElementById('url').value,
  }
  const container = document.getElementById('container').value
  if (container !== '') open.container = container
  return { cmd: 'open', open }
}

document.getElementById('ping').addEventListener('click', () => callHost({ cmd: 'ping' }))
document.getElementById('list').addEventListener('click', () => callHost({ cmd: 'listProfiles' }))
document.getElementById('open').addEventListener('click', () => callHost(openPayload()))
document.getElementById('open2').addEventListener('click', () => {
  callHost(openPayload())
  callHost(openPayload())
})

const fav = new URL(chrome.runtime.getURL('/_favicon/'))
fav.searchParams.set('pageUrl', 'https://github.com')
fav.searchParams.set('size', '32')
document.getElementById('fav').src = fav.toString()
