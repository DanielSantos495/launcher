import type { LauncherData } from '@account-launcher/core'
import { useMemo } from 'react'
import { storeUsage } from '../../../storage/usage'
import { useI18n } from '../../i18n-context'
import { formatKb } from '../../lib/format'

interface StorageMeterProps {
  readonly data: LauncherData
  readonly source: 'local' | 'shared'
}

// Cuánto ocupan los datos frente al límite de donde viven. La barra es un medidor accesible (role="meter") y el estado
// no depende del color: el texto dice cuánto es y, en el almacén compartido, avisa cuando se llena.
export function StorageMeter({ data, source }: StorageMeterProps) {
  const { t, language } = useI18n()
  const usage = useMemo(() => storeUsage(data, source), [data, source])
  const text = t('storage.usage', {
    used: formatKb(language, usage.bytes, 1),
    limit: formatKb(language, usage.limit, 1),
  })
  const warning = source === 'shared' && usage.level !== 'ok'
  return (
    <div className="meter">
      <div
        className="meter__bar"
        role="meter"
        aria-label={t('storage.title')}
        aria-valuemin={0}
        aria-valuemax={usage.limit}
        aria-valuenow={usage.bytes}
        aria-valuetext={text}
      >
        <div
          className={`meter__fill meter__fill--${usage.level}`}
          style={{ width: `${String(Math.min(usage.ratio, 1) * 100)}%` }}
        />
      </div>
      <p className="meter__text">{text}</p>
      {warning ? (
        <p className={usage.level === 'full' ? 'meter__warning meter__warning--full' : 'meter__warning'}>
          {t(usage.level === 'full' ? 'storage.full' : 'storage.warn')}
        </p>
      ) : null}
    </div>
  )
}
