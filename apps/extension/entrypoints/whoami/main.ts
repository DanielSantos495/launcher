import { createTranslator, resolveLanguage } from '../../src/i18n/i18n'

// Provisional: texto fijo traducido. La Tarea 5 añade aquí la prueba de identidad (whoami.prove).
const language = resolveLanguage('auto', navigator.language)
const { t } = createTranslator(language)
document.documentElement.lang = language
document.title = t('whoami.title')

const root = document.getElementById('root')
if (root) root.textContent = t('whoami.checking')
