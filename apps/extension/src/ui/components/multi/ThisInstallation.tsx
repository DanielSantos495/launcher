import type { Identity, ProfileInfo } from '@account-launcher/core'
import type { UiError } from '@account-launcher/protocol'
import { useId, useState, type SyntheticEvent } from 'react'
import { useI18n } from '../../i18n-context'
import type { InstallationView } from '../../client'
import type { Launcher } from '../../state/useLauncher'
import { ErrorBanner } from '../ErrorBanner'
import { Field, fieldAria } from '../Field'

interface ThisInstallationProps {
  readonly installation: InstallationView | undefined
  readonly profiles: readonly ProfileInfo[]
  // Identidades en el orden de la pantalla.
  readonly identities: readonly Identity[]
  readonly send: Launcher['send']
  readonly reload: () => Promise<void>
}

// "Este perfil es…": qué carpeta del navegador es esta instalación y, si se quiere, su identidad (pair.declare).
export function ThisInstallation({ installation, profiles, identities, send, reload }: ThisInstallationProps) {
  const { t } = useI18n()
  const base = useId()
  const declaredDirectory = installation?.ownProfileDirectory
  const declaredIdentityId = installation?.ownIdentityId
  // Lo elegido en los selectores; empieza en lo declarado y sigue lo declarado mientras no se toque nada.
  const [directory, setDirectory] = useState<string | undefined>()
  const [identityId, setIdentityId] = useState<string | undefined>()
  const [failure, setFailure] = useState<UiError | undefined>()
  const [saving, setSaving] = useState(false)

  const declaredIdentity = identities.find((identity) => identity.id === declaredIdentityId)
  const chosenDirectory = directory ?? declaredDirectory ?? ''
  // Una identidad declarada que ya no está en la lista no se puede elegir: el selector la da por ninguna y se guarda así.
  const chosenIdentity = identityId ?? declaredIdentity?.id ?? ''
  // Si la carpeta declarada ya no aparece en el navegador, sigue siendo una opción para no perderla sin querer.
  const known = profiles.some((profile) => profile.directory === declaredDirectory)
  const declaredProfile = profiles.find((profile) => profile.directory === declaredDirectory)

  const save = async (event: SyntheticEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (chosenDirectory === '') return
    setSaving(true)
    setFailure(undefined)
    const response = await send({
      type: 'pair.declare',
      profileDirectory: chosenDirectory,
      ...(chosenIdentity === '' ? {} : { identityId: chosenIdentity }),
    })
    setSaving(false)
    if (!response.ok) {
      setFailure(response.error)
      return
    }
    setDirectory(undefined)
    setIdentityId(undefined)
    await reload()
  }

  return (
    <div>
      <p className="settings__note">{t('installation.hint')}</p>
      <form
        onSubmit={(event) => {
          void save(event)
        }}
      >
        <Field id={`${base}-profile`} label={t('installation.profile')}>
          <select
            {...fieldAria(`${base}-profile`, false, false)}
            value={chosenDirectory}
            onChange={(event) => {
              setDirectory(event.target.value)
            }}
          >
            <option value="">{t('installation.profile.none')}</option>
            {declaredDirectory === undefined || known ? null : (
              <option value={declaredDirectory}>{declaredDirectory}</option>
            )}
            {profiles.map((profile) => (
              <option key={profile.directory} value={profile.directory}>
                {t('profile.option', { name: profile.name, directory: profile.directory })}
              </option>
            ))}
          </select>
        </Field>
        <Field id={`${base}-identity`} label={t('installation.identity')}>
          <select
            {...fieldAria(`${base}-identity`, false, false)}
            value={chosenIdentity}
            onChange={(event) => {
              setIdentityId(event.target.value)
            }}
          >
            <option value="">{t('installation.identity.none')}</option>
            {identities.map((identity) => (
              <option key={identity.id} value={identity.id}>
                {identity.label}
              </option>
            ))}
          </select>
        </Field>
        {failure === undefined ? null : <ErrorBanner error={failure} />}
        <button type="submit" className="button" disabled={saving || chosenDirectory === ''}>
          {t('common.save')}
        </button>
      </form>
      <p className="settings__note installation__declared" role="status">
        {declaredDirectory === undefined ? (
          t('installation.undeclared')
        ) : (
          <>
            {declaredProfile?.color === undefined ? null : (
              <span className="dot" style={{ backgroundColor: declaredProfile.color }} aria-hidden="true" />
            )}
            {declaredIdentity === undefined
              ? t('installation.declared', { profile: declaredProfile?.name ?? declaredDirectory })
              : t('installation.declared.identity', {
                  profile: declaredProfile?.name ?? declaredDirectory,
                  identity: declaredIdentity.label,
                })}
          </>
        )}
      </p>
    </div>
  )
}
