import type { UiError } from '@account-launcher/protocol'
import { useState } from 'react'
import { useI18n } from '../i18n-context'
import { Dialog } from './Dialog'
import { ErrorBanner } from './ErrorBanner'

interface ConfirmDialogProps {
  readonly title: string
  readonly message: string
  // Sin etiqueta de confirmación el diálogo solo informa y se cierra con "Cerrar".
  readonly confirmLabel?: string
  // Devuelve el error si falla; si no, el que lo abrió cierra el diálogo.
  readonly onConfirm?: () => Promise<UiError | undefined>
  readonly onCancel: () => void
}

export function ConfirmDialog({ title, message, confirmLabel, onConfirm, onCancel }: ConfirmDialogProps) {
  const { t } = useI18n()
  const [pending, setPending] = useState(false)
  const [failure, setFailure] = useState<UiError | undefined>()

  const confirm = async (): Promise<void> => {
    if (onConfirm === undefined) return
    setPending(true)
    setFailure(undefined)
    const error = await onConfirm()
    setPending(false)
    if (error !== undefined) setFailure(error)
  }

  return (
    <Dialog title={title} onClose={onCancel}>
      <p className="dialog__message">{message}</p>
      {failure === undefined ? null : <ErrorBanner error={failure} />}
      <div className="dialog__actions">
        <button type="button" className="button" onClick={onCancel}>
          {confirmLabel === undefined ? t('common.close') : t('common.cancel')}
        </button>
        {confirmLabel === undefined ? null : (
          <button
            type="button"
            className="button button--danger"
            disabled={pending}
            onClick={() => {
              void confirm()
            }}
          >
            {confirmLabel}
          </button>
        )}
      </div>
    </Dialog>
  )
}
