import { useEffect, useMemo } from 'react'
import { resolveLanguage } from '../i18n/i18n'
import { downloadText } from '../platform/download'
import { Dashboard } from './components/Dashboard'
import type { LauncherClient } from './client'
import { ClockProvider, type Clock } from './clock-context'
import { I18nProvider } from './i18n-context'
import { createImageLoader, ImageLoaderProvider } from './image-icons'
import { useLauncher } from './state/useLauncher'

// Raíz del dashboard: lee el estado, fija el idioma y el tema del documento y pinta la pantalla principal.
export function App({
  client,
  download = downloadText,
  now = () => new Date(),
}: {
  readonly client: LauncherClient
  // Guarda un texto como archivo; las pruebas pasan el suyo.
  readonly download?: (filename: string, text: string) => void
  // Reloj de la interfaz; las pruebas pasan uno fijo. Por defecto, el real.
  readonly now?: Clock
}) {
  const launcher = useLauncher(client)
  // Una caché de imágenes por cliente (por montaje del dashboard).
  const images = useMemo(() => createImageLoader(launcher.send), [launcher.send])
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
    <ClockProvider now={now}>
      <I18nProvider language={language}>
        <ImageLoaderProvider loader={images}>
          <Dashboard launcher={launcher} download={download} />
        </ImageLoaderProvider>
      </I18nProvider>
    </ClockProvider>
  )
}
