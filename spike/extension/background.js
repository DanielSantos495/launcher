import { hostNameFor } from './host-name.js'

chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('spike.html') })
})

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || msg?.type !== 'native') return false
  // userAgentData existe en el service worker (WorkerNavigator); navigator.brave puede no existir aquí.
  const brands = navigator.userAgentData?.brands
  let host
  try {
    host = hostNameFor(brands)
  } catch (e) {
    sendResponse({ ok: false, error: e.message, brands })
    return false
  }
  const started = performance.now()
  chrome.runtime.sendNativeMessage(host, msg.payload, (resp) => {
    const ms = Math.round(performance.now() - started)
    if (chrome.runtime.lastError) {
      sendResponse({ ok: false, error: chrome.runtime.lastError.message, host, brands, ms })
      return
    }
    sendResponse({ ok: true, host, brands, resp, ms })
  })
  return true
})
