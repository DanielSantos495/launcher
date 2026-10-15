import { useEffect } from 'react'
import { resolveLanguage } from '../i18n/i18n'
import { Dashboard } from './components/Dashboard'
import type { LauncherClient } from './client'
import { I18nProvider } from './i18n-context'
import { useLauncher } from './state/useLauncher'

// Raíz del dashboard: lee el estado, fija el idioma y el tema del documento y pinta la pantalla principal.
export function App({ client }: { readonly client: LauncherClient }) {
  const launcher = useLauncher(client)
  const settings = launcher.state.data?.settings
  const language = resolveLanguage(settings?.language ?? 'auto', navigator.language)
  const theme = settings?.theme ?? 'system'

  useEffect(() => {
    document.documentElement.lang = language
  }, [language])
  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  return (
    <I18nProvider language={language}>
      <Dashboard launcher={launcher} />
    </I18nProvider>
  )
}
