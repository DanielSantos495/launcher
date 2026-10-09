import { createRoot } from 'react-dom/client'
import { createTranslator, resolveLanguage } from '../../src/i18n/i18n'

// Provisional: la Tarea 7 monta aquí el dashboard completo.
const language = resolveLanguage('auto', navigator.language)
const { t } = createTranslator(language)
document.documentElement.lang = language
document.title = t('app.title')

const container = document.getElementById('root')
if (container) createRoot(container).render(<h1>{t('app.title')}</h1>)
