import { CATALOG, type Account, type LauncherData } from '@account-launcher/core'
import type { UiError } from '@account-launcher/protocol'
import { useId, useMemo } from 'react'
import { useClock } from '../clock-context'
import { useI18n } from '../i18n-context'
import { accountToInput, buildAccount, buildContext } from '../lib/forms'
import { orderedGroups, orderedIdentities } from '../lib/sections'
import { useEntityForm } from '../state/useEntityForm'
import { Dialog } from './Dialog'
import { Field, fieldAria } from './Field'
import { FormFooter } from './FormFooter'

interface AccountFormProps {
  // Sin cuenta se crea una nueva.
  readonly account?: Account
  readonly data: LauncherData
  // Valores iniciales de una cuenta nueva (la identidad o el grupo de la sección desde la que se añade).
  readonly identityId?: string
  readonly groupId?: string
  readonly ownIdentityId?: string
  readonly onSave: (account: Account) => Promise<UiError | undefined>
  readonly onCancel: () => void
}

const FIRST_SERVICE = CATALOG[0]?.id ?? 'generic'

export function AccountForm({ account, data, identityId, groupId, ownIdentityId, onSave, onCancel }: AccountFormProps) {
  const { t } = useI18n()
  const now = useClock()
  const base = useId()
  const identities = useMemo(() => orderedIdentities(data, ownIdentityId), [data, ownIdentityId])
  const groups = useMemo(() => orderedGroups(data), [data])
  // Nombre que se muestra de cada servicio, en el orden del catálogo y los servicios propios al final.
  const services = useMemo(
    () => [
      ...CATALOG.map((service) => ({
        id: service.id,
        name: service.id === 'generic' ? t('service.generic') : service.name,
      })),
      ...data.customServices.map((service) => ({ id: `custom:${service.id}`, name: service.name })),
    ],
    [data.customServices, t],
  )
  const serviceName = (id: string): string | undefined => services.find((service) => service.id === id)?.name

  const form = useEntityForm({
    initial:
      account === undefined
        ? {
            label: serviceName(FIRST_SERVICE) ?? '',
            url: '',
            username: '',
            notes: '',
            serviceId: FIRST_SERVICE,
            identityId: identityId ?? identities[0]?.id ?? '',
            groupId: groupId ?? '',
            icon: '',
            favorite: false,
            contextOverride: '',
          }
        : accountToInput(account),
    build: (input) => buildAccount(input, buildContext(data, now()), account),
    save: onSave,
  })
  const { input, patch, fieldError } = form
  const label = fieldError('label')
  const url = fieldError('url')
  const username = fieldError('username')
  const notes = fieldError('notes')
  const icon = fieldError('icon')
  const serviceError = fieldError('serviceId')
  const identityError = fieldError('identityId')
  const groupError = fieldError('groupId')
  const contextError = fieldError('contextOverride')

  // Al cambiar de servicio, la etiqueta sigue al nombre del servicio mientras no la haya escrito el usuario.
  const changeService = (serviceId: string): void => {
    const previous = serviceName(input.serviceId)
    const follows = input.label.trim() === '' || input.label === previous
    patch(follows ? { serviceId, label: serviceName(serviceId) ?? input.label } : { serviceId })
  }

  return (
    <Dialog title={t(account === undefined ? 'account.form.new' : 'account.form.edit')} onClose={onCancel}>
      <form ref={form.formRef} noValidate onSubmit={(event) => void form.submit(event)}>
        <Field id={`${base}-service`} label={t('account.service')} error={serviceError}>
          <select
            {...fieldAria(`${base}-service`, false, serviceError !== undefined)}
            name="serviceId"
            value={input.serviceId}
            onChange={(event) => {
              changeService(event.target.value)
            }}
          >
            {services.map((service) => (
              <option key={service.id} value={service.id}>
                {service.name}
              </option>
            ))}
          </select>
        </Field>
        <Field id={`${base}-identity`} label={t('account.identity')} error={identityError}>
          <select
            {...fieldAria(`${base}-identity`, false, identityError !== undefined)}
            name="identityId"
            value={input.identityId}
            onChange={(event) => {
              patch({ identityId: event.target.value })
            }}
          >
            {identities.map((identity) => (
              <option key={identity.id} value={identity.id}>
                {identity.label}
              </option>
            ))}
          </select>
        </Field>
        <Field id={`${base}-label`} label={t('account.label')} error={label}>
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
        <Field
          id={`${base}-url`}
          label={t(input.serviceId === 'generic' ? 'account.url.required' : 'account.url')}
          {...(input.serviceId === 'generic' ? {} : { hint: t('account.url.hint') })}
          error={url}
        >
          <input
            {...fieldAria(`${base}-url`, input.serviceId !== 'generic', url !== undefined)}
            name="url"
            spellCheck={false}
            type="url"
            value={input.url}
            autoComplete="off"
            inputMode="url"
            onChange={(event) => {
              patch({ url: event.target.value })
            }}
          />
        </Field>
        <Field id={`${base}-username`} label={t('account.username')} error={username}>
          <input
            {...fieldAria(`${base}-username`, false, username !== undefined)}
            name="username"
            spellCheck={false}
            value={input.username}
            autoComplete="off"
            onChange={(event) => {
              patch({ username: event.target.value })
            }}
          />
        </Field>
        <Field id={`${base}-group`} label={t('account.group')} error={groupError}>
          <select
            {...fieldAria(`${base}-group`, false, groupError !== undefined)}
            name="groupId"
            value={input.groupId}
            onChange={(event) => {
              patch({ groupId: event.target.value })
            }}
          >
            <option value="">{t('account.group.none')}</option>
            {groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </select>
        </Field>
        <Field id={`${base}-notes`} label={t('account.notes')} error={notes}>
          <textarea
            {...fieldAria(`${base}-notes`, false, notes !== undefined)}
            name="notes"
            rows={3}
            value={input.notes}
            onChange={(event) => {
              patch({ notes: event.target.value })
            }}
          />
        </Field>
        <Field id={`${base}-icon`} label={t('account.icon')} hint={t('account.icon.hint')} error={icon}>
          <input
            {...fieldAria(`${base}-icon`, true, icon !== undefined)}
            name="icon"
            value={input.icon}
            autoComplete="off"
            onChange={(event) => {
              patch({ icon: event.target.value })
            }}
          />
        </Field>
        {data.settings.mode === 'multi' ? (
          <Field id={`${base}-context`} label={t('account.context')} error={contextError}>
            <select
              {...fieldAria(`${base}-context`, false, contextError !== undefined)}
              name="contextOverride"
              value={input.contextOverride}
              onChange={(event) => {
                patch({ contextOverride: event.target.value })
              }}
            >
              <option value="">{t('account.context.identity')}</option>
              <option value="current">{t('account.context.current')}</option>
            </select>
          </Field>
        ) : null}
        <label className="check">
          <input
            type="checkbox"
            name="favorite"
            checked={input.favorite}
            onChange={(event) => {
              patch({ favorite: event.target.checked })
            }}
          />
          <span>{t('account.favorite')}</span>
        </label>
        <FormFooter
          failure={form.failure}
          saving={form.saving}
          submitLabel={t(account === undefined ? 'account.create' : 'common.save')}
          onCancel={onCancel}
        />
      </form>
    </Dialog>
  )
}
