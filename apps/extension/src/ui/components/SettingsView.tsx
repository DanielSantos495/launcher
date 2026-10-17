import type { LauncherData, Settings } from '@account-launcher/core'
import type { UiError } from '@account-launcher/protocol'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { MessageKey } from '../../i18n/i18n'
import { useI18n } from '../i18n-context'
import { BINDINGS_SECTION_ID } from '../lib/anchors'
import { formatList } from '../lib/format'
import { httpBlockers } from '../lib/http-blockers'
import { orderedIdentities } from '../lib/sections'
import type { Launcher } from '../state/useLauncher'
import { CustomServices } from './CustomServices'
import { ErrorBanner } from './ErrorBanner'
import { ImportExport } from './ImportExport'
import { ModeSwitch } from './ModeSwitch'
import { Bindings } from './multi/Bindings'
import { HostStatus } from './multi/HostStatus'
import { Pairing } from './multi/Pairing'
import { StorageMeter } from './multi/StorageMeter'
import { ThisInstallation } from './multi/ThisInstallation'
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
  const installation = state.installation
  const identities = useMemo(
    () => orderedIdentities(data, installation?.ownIdentityId),
    [data, installation?.ownIdentityId],
  )
  // Declarar el perfil, emparejar y vincular hablan con el programa: solo se ofrecen cuando responde.
  const hostReady = capabilities?.host.available === true
  const browser = capabilities?.host.available === true ? t(`browser.${capabilities.host.ping.browser}`) : ''

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
          {settings.mode === 'single' && installation?.paired === true ? (
            <p className="settings__note">{t('pairing.pairedNote')}</p>
          ) : null}
        </ModeSwitch>
      </SettingsSection>

      {settings.mode === 'multi' ? (
        <>
          <SettingsSection title={t('host.title')}>
            <HostStatus capabilities={capabilities} onRecheck={reload} />
          </SettingsSection>
          {hostReady ? (
            <>
              <SettingsSection title={t('installation.title')}>
                <ThisInstallation
                  installation={installation}
                  profiles={state.profiles}
                  identities={identities}
                  send={send}
                  reload={reload}
                />
              </SettingsSection>
              <SettingsSection title={t('pairing.title')}>
                <Pairing
                  installation={installation}
                  profiles={state.profiles}
                  identities={identities}
                  send={send}
                  reload={reload}
                />
              </SettingsSection>
              <SettingsSection title={t('bindings.title')} id={BINDINGS_SECTION_ID}>
                <Bindings
                  identities={identities}
                  bindings={state.bindings}
                  profiles={state.profiles}
                  browser={browser}
                  send={send}
                  mutate={mutate}
                  reload={reload}
                />
              </SettingsSection>
            </>
          ) : null}
        </>
      ) : null}

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

      <SettingsSection title={t('storage.title')}>
        <StorageMeter
          data={data}
          source={state.source ?? 'local'}
          backupBytes={state.backupBytes ?? 0}
          imageBytes={state.imageBytes ?? 0}
        />
      </SettingsSection>
    </div>
  )
}
