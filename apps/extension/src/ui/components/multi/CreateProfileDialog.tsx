import type { Identity } from '@account-launcher/core'
import type { UiError } from '@account-launcher/protocol'
import { useId, useState, type SyntheticEvent } from 'react'
import { useI18n } from '../../i18n-context'
import { desiredNameError } from '../../lib/rename'
import type { Launcher } from '../../state/useLauncher'
import { Dialog } from '../Dialog'
import { ErrorBanner } from '../ErrorBanner'
import { Field, fieldAria } from '../Field'

interface CreateProfileDialogProps {
  readonly identity: Identity
  readonly send: Launcher['send']
  // El perfil se creó y quedó vinculado.
  readonly onCreated: () => void
  readonly onCancel: () => void
}

// Crear un perfil nuevo del navegador para una identidad (profiles.create). El servicio espera a que el navegador
// lo muestre antes de vincularlo, y eso puede tardar unos segundos.
export function CreateProfileDialog({ identity, send, onCreated, onCancel }: CreateProfileDialogProps) {
  const { t } = useI18n()
  const base = useId()
  const [name, setName] = useState(identity.label)
  const [nameError, setNameError] = useState<string | undefined>()
  const [failure, setFailure] = useState<UiError | undefined>()
  const [creating, setCreating] = useState(false)

  const submit = async (event: SyntheticEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    const invalid = desiredNameError(name)
    if (invalid !== undefined) {
      setNameError(t(invalid))
      return
    }
    setNameError(undefined)
    setFailure(undefined)
    setCreating(true)
    const response = await send({ type: 'profiles.create', identityId: identity.id, name: name.trim() })
    setCreating(false)
    if (response.ok) onCreated()
    else setFailure(response.error)
  }

  return (
    <Dialog title={t('bindings.create.title', { identity: identity.label })} onClose={onCancel}>
      <form
        noValidate
        onSubmit={(event) => {
          void submit(event)
        }}
      >
        <Field
          id={`${base}-name`}
          label={t('bindings.create.name')}
          hint={t('bindings.create.hint')}
          {...(nameError === undefined ? {} : { error: nameError })}
        >
          <input
            {...fieldAria(`${base}-name`, true, nameError !== undefined)}
            name="name"
            spellCheck={false}
            value={name}
            autoComplete="off"
            onChange={(event) => {
              setName(event.target.value)
            }}
          />
        </Field>
        {failure === undefined ? null : <ErrorBanner error={failure} />}
        <p className="settings__note" role="status">
          {creating ? t('bindings.creating') : null}
        </p>
        <div className="dialog__actions">
          <button type="button" className="button" disabled={creating} onClick={onCancel}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="button button--primary" disabled={creating}>
            {t('bindings.create')}
          </button>
        </div>
      </form>
    </Dialog>
  )
}
