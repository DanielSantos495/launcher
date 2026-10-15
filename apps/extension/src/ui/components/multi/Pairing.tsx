import type { Identity, ProfileInfo } from '@account-launcher/core'
import type { UiError } from '@account-launcher/protocol'
import { useId, useState, type SyntheticEvent } from 'react'
import { useI18n } from '../../i18n-context'
import type { InstallationView } from '../../client'
import type { Launcher } from '../../state/useLauncher'
import { usePairList } from '../../state/usePairList'
import { ErrorBanner } from '../ErrorBanner'
import { Field, fieldAria } from '../Field'
import { PairedList } from './PairedList'
import { PairingCode } from './PairingCode'
import { VerifyProfile } from './VerifyProfile'

interface PairingProps {
  readonly installation: InstallationView | undefined
  readonly profiles: readonly ProfileInfo[]
  readonly identities: readonly Identity[]
  readonly send: Launcher['send']
  readonly reload: () => Promise<void>
}

const CODE_FORMAT = /^\d{6}$/

// Emparejamiento entre perfiles (§4). Sin emparejar: activar la sincronización (primer perfil) o unirse con el código
// de otro. Emparejada: la lista de perfiles, emparejar otro, verificar este y quitar.
export function Pairing({ installation, profiles, identities, send, reload }: PairingProps) {
  const { t } = useI18n()
  const base = useId()
  const paired = installation?.paired === true
  const pairs = usePairList(send, paired)
  const { refresh } = pairs
  const [issued, setIssued] = useState<{ readonly code: string; readonly expiresAt: string } | undefined>()
  const [failure, setFailure] = useState<UiError | undefined>()
  // pair.start sin token responde not_paired cuando ya hay perfiles emparejados (DC13): hay que unirse con un código.
  const [alreadyPaired, setAlreadyPaired] = useState(false)
  const [busy, setBusy] = useState(false)
  const [code, setCode] = useState('')
  const [codeError, setCodeError] = useState(false)

  // El perfil declarado antes de emparejar solo está en esta instalación: el host no lo conoce hasta declararlo con el
  // token. Se repite la declaración al emparejar para que "Verificar este perfil" funcione. Un fallo aquí no deshace
  // el emparejamiento: el usuario puede volver a declararlo en "Este perfil es…".
  const redeclare = async (): Promise<void> => {
    const directory = installation?.ownProfileDirectory
    if (directory === undefined) return
    const identityId = installation?.ownIdentityId
    await send({
      type: 'pair.declare',
      profileDirectory: directory,
      ...(identityId === undefined ? {} : { identityId }),
    })
  }

  const start = async (): Promise<void> => {
    setBusy(true)
    setFailure(undefined)
    setAlreadyPaired(false)
    const response = await send({ type: 'pair.start' })
    if (response.ok) {
      setIssued(response.result)
      if (!paired) await redeclare()
      await reload()
    } else if (response.error.code === 'not_paired' && !paired) {
      setAlreadyPaired(true)
    } else {
      setFailure(response.error)
    }
    setBusy(false)
  }

  const join = async (event: SyntheticEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    setFailure(undefined)
    const typed = code.trim()
    if (!CODE_FORMAT.test(typed)) {
      setCodeError(true)
      return
    }
    setCodeError(false)
    setBusy(true)
    const response = await send({ type: 'pair.join', code: typed })
    if (response.ok) {
      setCode('')
      await redeclare()
      await reload()
    } else {
      setFailure(response.error)
    }
    setBusy(false)
  }

  if (!paired) {
    return (
      <div className="pairing">
        <p className="settings__note">{t('pairing.intro')}</p>
        <button
          type="button"
          className="button button--primary"
          disabled={busy}
          onClick={() => {
            void start()
          }}
        >
          {t('pairing.activate')}
        </button>
        {alreadyPaired ? (
          <p className="settings__note" role="status">
            {t('pairing.alreadyPaired')}
          </p>
        ) : null}
        <h4 className="settings__subheading">{t('pairing.join.title')}</h4>
        <form
          noValidate
          onSubmit={(event) => {
            void join(event)
          }}
        >
          <Field
            id={`${base}-code`}
            label={t('pairing.join.code')}
            {...(codeError ? { error: t('pairing.join.format') } : {})}
          >
            <input
              {...fieldAria(`${base}-code`, false, codeError)}
              className="code-input"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(event) => {
                setCode(event.target.value)
              }}
            />
          </Field>
          <button type="submit" className="button" disabled={busy}>
            {t('pairing.join.action')}
          </button>
        </form>
        {failure === undefined ? null : <ErrorBanner error={failure} />}
      </div>
    )
  }

  return (
    <div className="pairing">
      <p className="pairing__state" role="status">
        <strong>{t('pairing.paired')}</strong>
        {pairs.list === undefined ? null : <span>{t('pairing.max', { max: pairs.list.maxPairedProfiles })}</span>}
      </p>
      {pairs.error === undefined ? null : <ErrorBanner error={pairs.error} />}
      {pairs.list === undefined ? null : (
        <>
          <h4 className="settings__subheading">{t('pairing.profiles')}</h4>
          <PairedList
            installations={pairs.list.installations}
            profiles={profiles}
            identities={identities}
            onRemove={async (removed) => {
              const response = await send({ type: 'pair.remove', installationId: removed.installationId })
              if (!response.ok) return response.error
              // Quitar este perfil lo deja sin emparejar: el estado cambia entero.
              if (removed.self) await reload()
              else await refresh()
              return undefined
            }}
          />
        </>
      )}
      <div className="pairing__actions">
        <button
          type="button"
          className="button"
          disabled={busy}
          onClick={() => {
            void start()
          }}
        >
          {t('pairing.another')}
        </button>
        <button
          type="button"
          className="button button--quiet"
          onClick={() => {
            void refresh()
          }}
        >
          {t('pairing.refresh')}
        </button>
      </div>
      {failure === undefined ? null : <ErrorBanner error={failure} />}
      {issued === undefined ? null : <PairingCode code={issued.code} expiresAt={issued.expiresAt} />}
      <VerifyProfile declared={installation.ownProfileDirectory !== undefined} send={send} onVerified={refresh} />
    </div>
  )
}
