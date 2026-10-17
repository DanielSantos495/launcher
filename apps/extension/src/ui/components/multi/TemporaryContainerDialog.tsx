import type { Account } from '@account-launcher/core'
import { isValidContainerName, type UiError } from '@account-launcher/protocol'
import { useId, useState, type SyntheticEvent } from 'react'
import { useI18n } from '../../i18n-context'
import type { Launcher } from '../../state/useLauncher'
import { ConfirmDialog } from '../ConfirmDialog'
import { Dialog } from '../Dialog'
import { Field, fieldAria } from '../Field'
import { FormFooter } from '../FormFooter'

export type TemporaryTarget = { readonly kind: 'account'; readonly account: Account } | { readonly kind: 'url' }

interface TemporaryContainerDialogProps {
  readonly target: TemporaryTarget
  // Perfil de esta instalación; sin él no se sabe en qué perfil abrir el contenedor.
  readonly ownProfileDirectory: string | undefined
  readonly send: Launcher['send']
  readonly onClose: () => void
  // El contenedor se abrió: quien lo mostró cierra el diálogo y avisa.
  readonly onDone: () => void
}

// Abrir en un contenedor temporal de Brave (aislado de las demás pestañas), de una cuenta o de una URL escrita. El
// service worker normaliza la URL y comprueba el nombre; aquí solo se adelanta el error evidente del nombre.
export function TemporaryContainerDialog({
  target,
  ownProfileDirectory,
  send,
  onClose,
  onDone,
}: TemporaryContainerDialogProps) {
  const { t } = useI18n()
  const base = useId()
  const [url, setUrl] = useState('')
  const [name, setName] = useState('')
  const [urlError, setUrlError] = useState<string | undefined>()
  const [nameError, setNameError] = useState<string | undefined>()
  const [failure, setFailure] = useState<UiError | undefined>()
  const [opening, setOpening] = useState(false)

  const title =
    target.kind === 'account' ? t('temporary.title.account', { label: target.account.label }) : t('temporary.title.url')

  if (ownProfileDirectory === undefined) {
    return <ConfirmDialog title={title} message={t('temporary.declareFirst')} onCancel={onClose} />
  }

  const submit = async (event: SyntheticEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    const typedName = name.trim()
    const badUrl = target.kind === 'url' && url.trim() === ''
    const badName = typedName !== '' && !isValidContainerName(typedName)
    setUrlError(badUrl ? t('field.required') : undefined)
    setNameError(badName ? t('temporary.name.invalid') : undefined)
    if (badUrl || badName) return
    setFailure(undefined)
    setOpening(true)
    const response = await send({
      type: 'account.openTemporary',
      target:
        target.kind === 'account'
          ? { kind: 'account', accountId: target.account.id }
          : { kind: 'url', url: url.trim() },
      ...(typedName === '' ? {} : { name: typedName }),
    })
    setOpening(false)
    if (response.ok) onDone()
    else setFailure(response.error)
  }

  return (
    <Dialog title={title} onClose={onClose}>
      <form
        noValidate
        onSubmit={(event) => {
          void submit(event)
        }}
      >
        <p className="dialog__message">{t('temporary.explain')}</p>
        {target.kind === 'url' ? (
          <Field id={`${base}-url`} label={t('temporary.url')} {...(urlError === undefined ? {} : { error: urlError })}>
            <input
              {...fieldAria(`${base}-url`, false, urlError !== undefined)}
              name="url"
              spellCheck={false}
              type="url"
              inputMode="url"
              autoComplete="off"
              value={url}
              onChange={(event) => {
                setUrl(event.target.value)
              }}
            />
          </Field>
        ) : null}
        <Field
          id={`${base}-name`}
          label={t('temporary.name')}
          hint={t('temporary.name.hint')}
          {...(nameError === undefined ? {} : { error: nameError })}
        >
          <input
            {...fieldAria(`${base}-name`, true, nameError !== undefined)}
            name="name"
            spellCheck={false}
            autoComplete="off"
            value={name}
            onChange={(event) => {
              setName(event.target.value)
            }}
          />
        </Field>
        <FormFooter failure={failure} saving={opening} submitLabel={t('temporary.action')} onCancel={onClose} />
      </form>
    </Dialog>
  )
}
