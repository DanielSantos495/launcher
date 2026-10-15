import type { Identity, LauncherData } from '@account-launcher/core'
import type { UiError } from '@account-launcher/protocol'
import { useId } from 'react'
import { useI18n } from '../i18n-context'
import { buildContext, buildIdentity, defaultColor, identityToInput } from '../lib/forms'
import { useEntityForm } from '../state/useEntityForm'
import { Dialog } from './Dialog'
import { Field, fieldAria } from './Field'
import { FormFooter } from './FormFooter'

interface IdentityFormProps {
  // Sin identidad se crea una nueva.
  readonly identity?: Identity
  readonly data: LauncherData
  readonly onSave: (identity: Identity) => Promise<UiError | undefined>
  readonly onCancel: () => void
}

export function IdentityForm({ identity, data, onSave, onCancel }: IdentityFormProps) {
  const { t } = useI18n()
  const base = useId()
  const form = useEntityForm({
    initial:
      identity === undefined
        ? { label: '', email: '', color: defaultColor(data.identities.length) }
        : identityToInput(identity),
    build: (input) => buildIdentity(input, buildContext(data), identity),
    save: onSave,
  })
  const { input, patch, fieldError } = form
  const label = fieldError('label')
  const email = fieldError('email')
  const color = fieldError('color')

  return (
    <Dialog title={t(identity === undefined ? 'identity.form.new' : 'identity.form.edit')} onClose={onCancel}>
      <form ref={form.formRef} noValidate onSubmit={(event) => void form.submit(event)}>
        <Field id={`${base}-label`} label={t('identity.name')} error={label}>
          <input
            {...fieldAria(`${base}-label`, false, label !== undefined)}
            name="label"
            value={input.label}
            autoComplete="off"
            onChange={(event) => {
              patch({ label: event.target.value })
            }}
          />
        </Field>
        <Field id={`${base}-email`} label={t('identity.email')} error={email}>
          <input
            {...fieldAria(`${base}-email`, false, email !== undefined)}
            name="email"
            type="email"
            value={input.email}
            autoComplete="off"
            onChange={(event) => {
              patch({ email: event.target.value })
            }}
          />
        </Field>
        <Field id={`${base}-color`} label={t('identity.color')} hint={t('identity.color.hint')} error={color}>
          <input
            {...fieldAria(`${base}-color`, true, color !== undefined)}
            name="color"
            type="color"
            className="color-input"
            value={input.color}
            onChange={(event) => {
              patch({ color: event.target.value })
            }}
          />
        </Field>
        <FormFooter
          failure={form.failure}
          saving={form.saving}
          submitLabel={t(identity === undefined ? 'identity.create' : 'common.save')}
          onCancel={onCancel}
        />
      </form>
    </Dialog>
  )
}
