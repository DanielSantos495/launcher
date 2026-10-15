import type { LauncherData, Settings } from '@account-launcher/core'
import type { UiError } from '@account-launcher/protocol'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { MessageKey } from '../../i18n/i18n'
import { useI18n } from '../i18n-context'
import { formatList } from '../lib/format'
import { httpBlockers } from '../lib/http-blockers'
import type { Launcher } from '../state/useLauncher'
import { CustomServices } from './CustomServices'
import { ErrorBanner } from './ErrorBanner'
import { ImportExport } from './ImportExport'
import { InstallGuide } from './InstallGuide'
import { ModeSwitch } from './ModeSwitch'
import { SettingSelect } from './SettingSelect'
import { SettingsSection } from './SettingsSection'

interface SettingsViewProps {
  readonly launcher: Launcher
  readonly data: LauncherData
  readonly download: (filename: string, text: string) => void
  readonly notify: (key: MessageKey) => void
  readonly onBack: () => void
}

// Pantalla de Configuración. Cada ajuste se guarda con su propio settings.set; el estado que se muestra es siempre el
// que devuelve el service worker.
export function SettingsView({ launcher, data, download, notify, onBack }: SettingsViewProps) {
  const { t, language } = useI18n()
  const { state, mutate, send, reload } = launcher
  const [error, setError] = useState<UiError | undefined>()
  const headingRef = useRef<HTMLHeadingElement>(null)
  const httpId = useId()
  const { settings } = data
  const blockers = useMemo(() => httpBlockers(data), [data])

  // Al abrir la pantalla, el teclado y los lectores empiezan por su título.
  useEffect(() => {
    headingRef.current?.focus()
  }, [])

  const change = async (patch: Partial<Settings>): Promise<void> => {
    const response = await mutate([{ type: 'settings.set', settings: patch }])
    setError(response.ok ? undefined : response.error)
  }

  // Mientras alguna cuenta o servicio use http, el ajuste no se puede desactivar (el service worker lo rechazaría).
  const blockedBy = settings.allowHttp
    ? [...blockers.accounts.map((account) => account.label), ...blockers.services.map((service) => service.name)]
    : []
  const capabilities = state.capabilities
  const hostMissing = settings.mode === 'multi' && capabilities !== undefined && !capabilities.host.available
  const hostReason = capabilities?.providers.find((provider) => provider.id === 'chromium-profile')?.reason

  return (
    <div className="settings">
      <div className="settings__top">
        <h2 ref={headingRef} className="settings__title" tabIndex={-1}>
          {t('settings.title')}
        </h2>
        <button type="button" className="button" onClick={onBack}>
          {t('settings.back')}
        </button>
      </div>
      {error === undefined ? null : (
        <ErrorBanner
          error={error}
          onDismiss={() => {
            setError(undefined)
          }}
        />
      )}

      <SettingsSection title={t('settings.general')}>
        <SettingSelect
          label={t('settings.language')}
          value={settings.language}
          options={[
            { value: 'auto', label: t('settings.language.auto') },
            { value: 'es', label: t('settings.language.es') },
            { value: 'en', label: t('settings.language.en') },
          ]}
          onChange={(value) => {
            void change({ language: value })
          }}
        />
        <SettingSelect
          label={t('settings.theme')}
          value={settings.theme}
          options={[
            { value: 'system', label: t('settings.theme.system') },
            { value: 'light', label: t('settings.theme.light') },
            { value: 'dark', label: t('settings.theme.dark') },
          ]}
          onChange={(value) => {
            void change({ theme: value })
          }}
        />
        <SettingSelect
          label={t('settings.defaultView')}
          value={settings.defaultView}
          options={[
            { value: 'identity', label: t('view.identity') },
            { value: 'group', label: t('view.group') },
          ]}
          onChange={(value) => {
            void change({ defaultView: value })
          }}
        />
        <div className="choice">
          <input
            id={httpId}
            type="checkbox"
            checked={settings.allowHttp}
            disabled={blockedBy.length > 0}
            aria-describedby={`${httpId}-hint`}
            onChange={(event) => {
              void change({ allowHttp: event.target.checked })
            }}
          />
          <label htmlFor={httpId} className="choice__title">
            {t('settings.allowHttp')}
          </label>
          <p id={`${httpId}-hint`} className="choice__hint">
            {blockedBy.length > 0
              ? t('settings.allowHttp.blocked', { list: formatList(language, blockedBy) })
              : t('settings.allowHttp.hint')}
          </p>
        </div>
      </SettingsSection>

      <SettingsSection title={t('settings.mode')}>
        <ModeSwitch
          mode={settings.mode}
          onChange={(mode) => {
            void change({ mode })
          }}
        >
          {settings.mode === 'multi' && capabilities === undefined ? (
            <p className="settings__note" role="status">
              {t('settings.mode.checking')}
            </p>
          ) : null}
          {hostMissing ? (
            <InstallGuide
              reason={hostReason}
              onRecheck={async () => {
                await reload()
              }}
            />
          ) : null}
        </ModeSwitch>
      </SettingsSection>

      <SettingsSection title={t('services.title')}>
        <p className="settings__note">{t('services.intro')}</p>
        <CustomServices data={data} mutate={mutate} notify={notify} />
      </SettingsSection>

      <SettingsSection title={t('backup.title')}>
        <ImportExport
          data={data}
          bindings={state.bindings}
          profiles={state.profiles}
          send={send}
          reload={reload}
          download={download}
        />
      </SettingsSection>
    </div>
  )
}
