import type { UiError } from '@account-launcher/protocol'
import { useI18n } from '../i18n-context'
import { errorText } from '../lib/errors'

interface ErrorBannerProps {
  readonly error: UiError
  readonly onRetry?: () => void
  readonly onDismiss?: () => void
}

// Error con role="alert": dice qué pasó (título) y, si hay pista, cómo arreglarlo. Nunca muestra datos recibidos.
export function ErrorBanner({ error, onRetry, onDismiss }: ErrorBannerProps) {
  const { t } = useI18n()
  const { title, detail } = errorText(error, t)
  return (
    <div className="banner" role="alert">
      <div className="banner__text">
        <p className="banner__title">{title}</p>
        {detail === undefined ? null : <p className="banner__detail">{detail}</p>}
      </div>
      {onRetry === undefined && onDismiss === undefined ? null : (
        <div className="banner__actions">
          {onRetry === undefined ? null : (
            <button type="button" className="button" onClick={onRetry}>
              {t('app.retry')}
            </button>
          )}
          {onDismiss === undefined ? null : (
            <button type="button" className="button button--quiet" onClick={onDismiss}>
              {t('common.dismiss')}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
