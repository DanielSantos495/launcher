import type { Binding, Identity, ProfileInfo } from '@account-launcher/core'
import type { UiError } from '@account-launcher/protocol'
import { useId, useState } from 'react'
import { useClock } from '../../clock-context'
import { useI18n } from '../../i18n-context'
import { renameStatus } from '../../lib/rename'
import type { Destination } from '../../lib/sections'
import type { Launcher } from '../../state/useLauncher'
import { DestinationLabel } from '../DestinationLabel'
import { ErrorBanner } from '../ErrorBanner'
import { CreateProfileDialog } from './CreateProfileDialog'

interface BindingRowProps {
  readonly identity: Identity
  readonly binding: Binding | undefined
  readonly profiles: readonly ProfileInfo[]
  // Nombre del navegador (Brave, Chrome, Edge) para la indicación de cambiar el nombre del perfil.
  readonly browser: string
  readonly send: Launcher['send']
  readonly mutate: Launcher['mutate']
  readonly reload: () => Promise<void>
}

// El vínculo de una identidad: a qué perfil abre, elegir otro, quitarlo o crear uno nuevo, y si el perfil ya tiene el
// nombre que se pidió.
export function BindingRow({ identity, binding, profiles, browser, send, mutate, reload }: BindingRowProps) {
  const { t } = useI18n()
  const now = useClock()
  const selectId = useId()
  const [failure, setFailure] = useState<UiError | undefined>()
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState(false)

  const directory = binding?.kind === 'chromium-profile' ? binding.profileDirectory : undefined
  const profile = profiles.find((candidate) => candidate.directory === directory)
  // Sin lista de perfiles (aún no responde) no se puede decir que uno falte.
  const listed = profiles.length > 0
  const missing = listed && directory !== undefined && profile === undefined
  const status = listed ? renameStatus(binding, profiles) : 'none'
  const desiredName = binding?.kind === 'chromium-profile' ? binding.desiredName : undefined
  // Solo se ofrece el color del perfil si el navegador lo conoce y es distinto del de la identidad.
  const profileColor = profile?.color
  // Dónde abre la identidad, con el nombre y el color del perfil si el navegador lo lista.
  const destination: Destination | undefined =
    directory === undefined
      ? undefined
      : {
          kind: 'profile',
          directory,
          ...(profile === undefined ? {} : { name: profile.name }),
          ...(profile?.color === undefined ? {} : { color: profile.color }),
        }
  const offerColor = profileColor !== undefined && profileColor.toLowerCase() !== identity.color.toLowerCase()

  const run = async (action: () => Promise<UiError | undefined>): Promise<void> => {
    setBusy(true)
    setFailure(undefined)
    const error = await action()
    setBusy(false)
    if (error !== undefined) setFailure(error)
  }

  const setBinding = (next: Binding | null) =>
    run(async () => {
      const response = await send({ type: 'bindings.set', identityId: identity.id, binding: next })
      if (!response.ok) return response.error
      await reload()
      return undefined
    })

  const useColor = (color: string) =>
    run(async () => {
      const response = await mutate([
        { type: 'identity.put', identity: { ...identity, color, updatedAt: now().toISOString() } },
      ])
      return response.ok ? undefined : response.error
    })

  return (
    <li className="rows__item rows__item--column">
      <div className="rows__text">
        <span className="rows__title">
          <span className="dot" style={{ backgroundColor: identity.color }} aria-hidden="true" />
          {identity.label}
        </span>
        <span className="rows__detail">
          {destination === undefined ? t('bindings.none') : <DestinationLabel destination={destination} />}
        </span>
        {status === 'pending' && desiredName !== undefined ? (
          <span className="rows__detail rows__detail--warn">
            {t('bindings.rename.pending', { name: desiredName, browser })}
          </span>
        ) : null}
        {status === 'matches' && desiredName !== undefined ? (
          <span className="rows__detail">{t('bindings.rename.matches', { name: desiredName })}</span>
        ) : null}
        {missing ? <span className="rows__detail rows__detail--warn">{t('bindings.rename.missing')}</span> : null}
      </div>
      <div className="rows__actions">
        <select
          id={selectId}
          aria-label={t('bindings.select', { identity: identity.label })}
          value={directory ?? ''}
          disabled={busy}
          onChange={(event) => {
            const chosen = event.target.value
            if (chosen === '' || chosen === directory) return
            void setBinding({ kind: 'chromium-profile', profileDirectory: chosen })
          }}
        >
          <option value="">{t('bindings.select.none')}</option>
          {missing ? <option value={directory}>{directory}</option> : null}
          {profiles.map((candidate) => (
            <option key={candidate.directory} value={candidate.directory}>
              {t('profile.option', { name: candidate.name, directory: candidate.directory })}
            </option>
          ))}
        </select>
        {binding === undefined ? null : (
          <button
            type="button"
            className="button"
            disabled={busy}
            aria-label={t('bindings.removeNamed', { identity: identity.label })}
            onClick={() => {
              void setBinding(null)
            }}
          >
            {t('bindings.remove')}
          </button>
        )}
        <button
          type="button"
          className="button"
          disabled={busy}
          aria-label={t('bindings.createNamed', { identity: identity.label })}
          onClick={() => {
            setCreating(true)
          }}
        >
          {t('bindings.create')}
        </button>
        {offerColor ? (
          <button
            type="button"
            className="button"
            disabled={busy}
            aria-label={t('bindings.useColorNamed', { identity: identity.label })}
            onClick={() => {
              void useColor(profileColor)
            }}
          >
            {t('bindings.useColor')}
          </button>
        ) : null}
      </div>
      {failure === undefined ? null : <ErrorBanner error={failure} />}
      {creating ? (
        <CreateProfileDialog
          identity={identity}
          send={send}
          onCreated={() => {
            setCreating(false)
            void reload()
          }}
          onCancel={() => {
            setCreating(false)
          }}
        />
      ) : null}
    </li>
  )
}
