import type { CustomService, LauncherData, Op } from '@account-launcher/core'
import type { UiError, UiResponse, UiResults } from '@account-launcher/protocol'
import { useState } from 'react'
import type { MessageKey } from '../../i18n/i18n'
import { useI18n } from '../i18n-context'
import { ConfirmDialog } from './ConfirmDialog'
import { CustomServiceForm } from './CustomServiceForm'

interface CustomServicesProps {
  readonly data: LauncherData
  readonly mutate: (ops: Op[]) => Promise<UiResponse<UiResults['data.mutate']>>
  readonly notify: (key: MessageKey) => void
}

type ServiceDialog =
  | { readonly kind: 'edit'; readonly service?: CustomService }
  | { readonly kind: 'delete'; readonly service: CustomService }

const MULTI_KEYS: Readonly<Record<CustomService['multiAccount'], MessageKey>> = {
  parallel: 'services.multi.parallel',
  switch: 'services.multi.switch',
  none: 'services.multi.none',
}

// Lista de servicios propios con crear, editar y borrar. Borrar uno que una cuenta usa lo rechaza el service worker
// con la pista in_use, que el diálogo muestra.
export function CustomServices({ data, mutate, notify }: CustomServicesProps) {
  const { t } = useI18n()
  const [dialog, setDialog] = useState<ServiceDialog | undefined>()

  const close = (): void => {
    setDialog(undefined)
  }
  // Aplica la operación; devuelve el error si falla (el diálogo sigue abierto y lo muestra).
  const apply = async (op: Op, toast: MessageKey): Promise<UiError | undefined> => {
    const response = await mutate([op])
    if (!response.ok) return response.error
    setDialog(undefined)
    notify(toast)
    return undefined
  }

  return (
    <div className="services">
      {data.customServices.length === 0 ? (
        <p className="settings__note">{t('services.empty')}</p>
      ) : (
        <ul className="rows">
          {data.customServices.map((service) => (
            <li key={service.id} className="rows__item">
              <div className="rows__text">
                <span className="rows__title">{service.name}</span>
                <code className="rows__detail">{service.urlTemplate}</code>
                <span className="rows__detail">{t(MULTI_KEYS[service.multiAccount])}</span>
              </div>
              <div className="rows__actions">
                <button
                  type="button"
                  className="button"
                  aria-label={t('services.edit', { name: service.name })}
                  onClick={() => {
                    setDialog({ kind: 'edit', service })
                  }}
                >
                  {t('common.edit')}
                </button>
                <button
                  type="button"
                  className="button"
                  aria-label={t('services.delete', { name: service.name })}
                  onClick={() => {
                    setDialog({ kind: 'delete', service })
                  }}
                >
                  {t('common.delete')}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        className="button"
        onClick={() => {
          setDialog({ kind: 'edit' })
        }}
      >
        {t('services.add')}
      </button>
      {dialog?.kind === 'edit' ? (
        <CustomServiceForm
          {...(dialog.service === undefined ? {} : { service: dialog.service })}
          data={data}
          onSave={(service) => apply({ type: 'customService.put', service }, 'toast.service.saved')}
          onCancel={close}
        />
      ) : null}
      {dialog?.kind === 'delete' ? (
        <ConfirmDialog
          title={t('confirm.service.title', { name: dialog.service.name })}
          message={t('confirm.service.body')}
          confirmLabel={t('confirm.service.action')}
          onConfirm={() => apply({ type: 'customService.delete', id: dialog.service.id }, 'toast.service.deleted')}
          onCancel={close}
        />
      ) : null}
    </div>
  )
}
