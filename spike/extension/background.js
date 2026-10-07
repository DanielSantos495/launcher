const HOST = 'com.curyapps.launcher.spike'

chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('spike.html') })
})

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || msg?.type !== 'native') return false
  const started = performance.now()
  chrome.runtime.sendNativeMessage(HOST, msg.payload, (resp) => {
    const ms = Math.round(performance.now() - started)
    if (chrome.runtime.lastError) {
      sendResponse({ ok: false, error: chrome.runtime.lastError.message, ms })
      return
    }
    sendResponse({ ok: true, resp, ms })
  })
  return true
})
