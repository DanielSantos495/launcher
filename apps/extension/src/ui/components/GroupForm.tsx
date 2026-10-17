import type { Group, LauncherData } from '@account-launcher/core'
import type { UiError } from '@account-launcher/protocol'
import { useId } from 'react'
import { useClock } from '../clock-context'
import { useI18n } from '../i18n-context'
import { buildContext, buildGroup, defaultColor, groupToInput } from '../lib/forms'
import { useEntityForm } from '../state/useEntityForm'
import { Dialog } from './Dialog'
import { Field, fieldAria } from './Field'
import { FormFooter } from './FormFooter'

interface GroupFormProps {
  // Sin grupo se crea uno nuevo.
  readonly group?: Group
  readonly data: LauncherData
  readonly onSave: (group: Group) => Promise<UiError | undefined>
  readonly onCancel: () => void
}

export function GroupForm({ group, data, onSave, onCancel }: GroupFormProps) {
  const { t } = useI18n()
  const now = useClock()
  const base = useId()
  const form = useEntityForm({
    initial:
      group === undefined ? { name: '', color: defaultColor(data.groups.length), icon: '' } : groupToInput(group),
    build: (input) => buildGroup(input, buildContext(data, now()), group),
    save: onSave,
  })
  const { input, patch, fieldError } = form
  const name = fieldError('name')
  const color = fieldError('color')
  const icon = fieldError('icon')

  return (
    <Dialog title={t(group === undefined ? 'group.form.new' : 'group.form.edit')} onClose={onCancel}>
      <form ref={form.formRef} noValidate onSubmit={(event) => void form.submit(event)}>
        <Field id={`${base}-name`} label={t('group.name')} error={name}>
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
        <Field id={`${base}-color`} label={t('group.color')} error={color}>
          <input
            {...fieldAria(`${base}-color`, false, color !== undefined)}
            name="color"
            type="color"
            className="color-input"
            value={input.color}
            onChange={(event) => {
              patch({ color: event.target.value })
            }}
          />
        </Field>
        <Field id={`${base}-icon`} label={t('group.icon')} error={icon}>
          <input
            {...fieldAria(`${base}-icon`, false, icon !== undefined)}
            name="icon"
            value={input.icon}
            autoComplete="off"
            onChange={(event) => {
              patch({ icon: event.target.value })
            }}
          />
        </Field>
        <FormFooter
          failure={form.failure}
          saving={form.saving}
          submitLabel={t(group === undefined ? 'group.create' : 'common.save')}
          onCancel={onCancel}
        />
      </form>
    </Dialog>
  )
}
