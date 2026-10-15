import type { UiError } from '@account-launcher/protocol'
import { useI18n } from '../i18n-context'
import { ErrorBanner } from './ErrorBanner'

interface FormFooterProps {
  readonly failure: UiError | undefined
  readonly saving: boolean
  readonly submitLabel: string
  readonly onCancel: () => void
}

// Pie común de los formularios en diálogo: el error del guardado (si lo hay) y los botones Cancelar y Guardar.
export function FormFooter({ failure, saving, submitLabel, onCancel }: FormFooterProps) {
  const { t } = useI18n()
  return (
    <>
      {failure === undefined ? null : <ErrorBanner error={failure} />}
      <div className="dialog__actions">
        <button type="button" className="button" onClick={onCancel}>
          {t('common.cancel')}
        </button>
        <button type="submit" className="button button--primary" disabled={saving}>
          {saving ? t('form.saving') : submitLabel}
        </button>
      </div>
    </>
  )
}
