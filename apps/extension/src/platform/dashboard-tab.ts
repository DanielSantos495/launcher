import { browser } from 'wxt/browser'

// Abre el dashboard o, si ya hay una pestaña con él, la enfoca. getContexts no necesita el permiso "tabs".
export async function openOrFocusDashboard(): Promise<void> {
  const url = browser.runtime.getURL('/launcher.html')
  const [existing] = await browser.runtime.getContexts({ contextTypes: ['TAB'], documentUrls: [url] })
  if (existing === undefined) {
    await browser.tabs.create({ url })
    return
  }
  await browser.tabs.update(existing.tabId, { active: true })
  await browser.windows.update(existing.windowId, { focused: true })
}
