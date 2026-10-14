import { browser } from 'wxt/browser'
import { createTranslator, resolveLanguage } from '../../src/i18n/i18n'
import { runWhoami, toWhoamiResponse, type WhoamiState } from '../../src/whoami/whoami'

// Página de verificación del perfil (§4.7): el host la abre con el nonce en el fragmento. Todo el texto se escribe con
// textContent y el nonce no se muestra nunca.
const language = resolveLanguage('auto', navigator.language)
const { t } = createTranslator(language)
document.documentElement.lang = language
document.title = t('whoami.title')

const KEYS = {
  checking: 'whoami.checking',
  verified: 'whoami.verified',
  failed: 'whoami.failed',
  invalid: 'whoami.invalid',
} as const satisfies Record<WhoamiState, string>

const root = document.getElementById('root')

void runWhoami({
  hash: location.hash,
  send: async (message) => toWhoamiResponse(await browser.runtime.sendMessage(message)),
  clearHash: () => {
    history.replaceState(null, '', `${location.pathname}${location.search}`)
  },
  render: (state) => {
    if (root) root.textContent = t(KEYS[state])
  },
  closeTab: async () => {
    const tab = await browser.tabs.getCurrent()
    if (tab?.id !== undefined) await browser.tabs.remove(tab.id)
  },
  sleep: (ms) =>
    new Promise((resolve) => {
      setTimeout(resolve, ms)
    }),
})
