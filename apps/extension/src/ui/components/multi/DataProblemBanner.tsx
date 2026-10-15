import type { LauncherData } from '@account-launcher/core'
import { MAX_SHARED_DATA_BYTES, type UiError } from '@account-launcher/protocol'
import { useState } from 'react'
import type { MessageKey } from '../../../i18n/i18n'
import { useI18n } from '../../i18n-context'
import type { DataProblemKind } from '../../lib/data-problem'
import { formatKb } from '../../lib/format'
import { ErrorBanner } from '../ErrorBanner'
import { StorageMeter } from './StorageMeter'

interface DataProblemBannerProps {
  readonly kind: DataProblemKind
  // Con el almacén lleno se enseña el medidor: hacen falta los datos y de dónde son.
  readonly data?: LauncherData | undefined
  readonly source?: 'local' | 'shared' | undefined
  // Vuelve a leer la lista compartida.
  readonly onRetry: () => Promise<void>
  // Cambia a Perfil único; devuelve el error si falla.
  readonly onUseSingle: () => Promise<UiError | undefined>
  // Solo el aviso de almacén lleno se puede descartar (los demás son el estado de la pantalla).
  readonly onDismiss?: () => void
}

const TEXT_KEYS: Readonly<Record<Exclude<DataProblemKind, 'too_large'>, MessageKey>> = {
  newer: 'problem.newer',
  damaged: 'problem.damaged',
  host: 'problem.host',
}

// Aviso de un problema con la lista compartida (role="alert"): dice qué pasa y ofrece reintentar o volver a Perfil único.
export function DataProblemBanner({ kind, data, source, onRetry, onUseSingle, onDismiss }: DataProblemBannerProps) {
  const { t, language } = useI18n()
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<UiError | undefined>()

  const run = async (action: () => Promise<UiError | undefined>): Promise<void> => {
    setBusy(true)
    setFailure(undefined)
    const error = await action()
    setBusy(false)
    if (error !== undefined) setFailure(error)
  }

  return (
    <>
      <div className="banner" role="alert">
        <div className="banner__text">
          <p className="banner__title">
            {kind === 'too_large'
              ? t('problem.full', { limit: formatKb(language, MAX_SHARED_DATA_BYTES, 0) })
              : t(TEXT_KEYS[kind])}
          </p>
          {kind === 'too_large' && data !== undefined && source !== undefined ? (
            <StorageMeter data={data} source={source} />
          ) : null}
        </div>
        <div className="banner__actions">
          {kind === 'too_large' ? null : (
            <>
              <button
                type="button"
                className="button"
                disabled={busy}
                onClick={() => {
                  void run(async () => {
                    await onRetry()
                    return undefined
                  })
                }}
              >
                {t('app.retry')}
              </button>
              <button
                type="button"
                className="button"
                disabled={busy}
                onClick={() => {
                  void run(onUseSingle)
                }}
              >
                {t('problem.useSingle')}
              </button>
            </>
          )}
          {onDismiss === undefined ? null : (
            <button type="button" className="button button--quiet" onClick={onDismiss}>
              {t('common.dismiss')}
            </button>
          )}
        </div>
      </div>
      {failure === undefined ? null : <ErrorBanner error={failure} />}
    </>
  )
}
