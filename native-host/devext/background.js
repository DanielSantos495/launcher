// El icono de la extensión abre el panel de pruebas en una pestaña.
chrome.action.onClicked.addListener(() => {
  void chrome.tabs.create({ url: chrome.runtime.getURL('panel.html') })
})
