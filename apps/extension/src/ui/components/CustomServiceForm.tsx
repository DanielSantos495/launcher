import type { CustomService, LauncherData } from '@account-launcher/core'
import type { UiError } from '@account-launcher/protocol'
import { useId } from 'react'
import type { MessageKey } from '../../i18n/i18n'
import { useClock } from '../clock-context'
import { useI18n } from '../i18n-context'
import { buildContext, buildCustomService, customServiceToInput } from '../lib/forms'
import { useEntityForm } from '../state/useEntityForm'
import { Dialog } from './Dialog'
import { Field, fieldAria } from './Field'
import { FormFooter } from './FormFooter'

interface CustomServiceFormProps {
  // Sin servicio se crea uno nuevo.
  readonly service?: CustomService
  readonly data: LauncherData
  readonly onSave: (service: CustomService) => Promise<UiError | undefined>
  readonly onCancel: () => void
}

const MULTI_OPTIONS: readonly (readonly [CustomService['multiAccount'], MessageKey])[] = [
  ['parallel', 'services.multi.parallel'],
  ['switch', 'services.multi.switch'],
  ['none', 'services.multi.none'],
]

export function CustomServiceForm({ service, data, onSave, onCancel }: CustomServiceFormProps) {
  const { t } = useI18n()
  const now = useClock()
  const base = useId()
  const form = useEntityForm({
    initial:
      service === undefined ? { name: '', urlTemplate: '', multiAccount: 'none' } : customServiceToInput(service),
    build: (input) => buildCustomService(input, buildContext(data, now()), service),
    save: onSave,
  })
  const { input, patch, fieldError } = form
  const name = fieldError('name')
  const template = fieldError('urlTemplate')
  const multi = fieldError('multiAccount')

  return (
    <Dialog title={t(service === undefined ? 'services.form.new' : 'services.form.edit')} onClose={onCancel}>
      <form ref={form.formRef} noValidate onSubmit={(event) => void form.submit(event)}>
        <Field id={`${base}-name`} label={t('services.name')} error={name}>
          <input
            {...fieldAria(`${base}-name`, false, name !== undefined)}
            name="name"
            spellCheck={false}
            value={input.name}
            autoComplete="off"
            onChange={(event) => {
              patch({ name: event.target.value })
            }}
          />
        </Field>
        <Field
          id={`${base}-template`}
          label={t('services.template')}
          hint={t('services.template.hint')}
          error={template}
        >
          <input
            {...fieldAria(`${base}-template`, true, template !== undefined)}
            name="urlTemplate"
            type="url"
            inputMode="url"
            value={input.urlTemplate}
            autoComplete="off"
            onChange={(event) => {
              patch({ urlTemplate: event.target.value })
            }}
          />
        </Field>
        <Field id={`${base}-multi`} label={t('services.multi')} error={multi}>
          <select
            {...fieldAria(`${base}-multi`, false, multi !== undefined)}
            name="multiAccount"
            value={input.multiAccount}
            onChange={(event) => {
              patch({ multiAccount: event.target.value })
            }}
          >
            {MULTI_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>
                {t(label)}
              </option>
            ))}
          </select>
        </Field>
        <FormFooter
          failure={form.failure}
          saving={form.saving}
          submitLabel={t(service === undefined ? 'services.create' : 'common.save')}
          onCancel={onCancel}
        />
      </form>
    </Dialog>
  )
}
