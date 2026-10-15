import type { Capabilities } from '@account-launcher/protocol'
import { useI18n } from '../../i18n-context'
import { InstallGuide } from '../InstallGuide'

interface HostStatusProps {
  // undefined mientras se consultan.
  readonly capabilities: Capabilities | undefined
  readonly onRecheck: () => Promise<void>
}

// Estado del programa launcher-host: versión, navegador y contenedores temporales; o la guía de instalación si no responde.
export function HostStatus({ capabilities, onRecheck }: HostStatusProps) {
  const { t } = useI18n()
  if (capabilities === undefined) {
    return (
      <p className="settings__note" role="status">
        {t('settings.mode.checking')}
      </p>
    )
  }
  if (!capabilities.host.available) {
    const reason = capabilities.providers.find((provider) => provider.id === 'chromium-profile')?.reason
    return <InstallGuide reason={reason} onRecheck={onRecheck} />
  }
  const { ping } = capabilities.host
  const browser = t(`browser.${ping.browser}`)
  return (
    <dl className="facts">
      <div className="facts__item">
        <dt>{t('host.version')}</dt>
        <dd>{ping.hostVersion}</dd>
      </div>
      <div className="facts__item">
        <dt>{t('host.browser')}</dt>
        <dd>{ping.browserVersion === undefined ? browser : `${browser} ${ping.browserVersion}`}</dd>
      </div>
      <div className="facts__item">
        <dt>{t('host.temporary')}</dt>
        <dd>{t(ping.features.temporaryContainer ? 'host.temporary.yes' : 'host.temporary.no')}</dd>
      </div>
    </dl>
  )
}
