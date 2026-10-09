import { browser } from 'wxt/browser'
import { defineBackground } from 'wxt/utils/define-background'
import { openOrFocusDashboard } from '../src/platform/dashboard-tab'

// Provisional: solo abre o enfoca el dashboard. Los listeners se registran de forma síncrona.
export default defineBackground(() => {
  browser.action.onClicked.addListener(() => {
    void openOrFocusDashboard()
  })
  browser.runtime.onInstalled.addListener(({ reason }) => {
    if (reason === 'install') void openOrFocusDashboard()
  })
})
