import { useI18n } from '../../i18n-context'
import { formatCountdown } from '../../lib/format'
import { useNow } from '../../state/useNow'

interface PairingCodeProps {
  readonly code: string
  // Marca ISO en la que caduca.
  readonly expiresAt: string
}

// El código de emparejamiento en grande, con la cuenta atrás hasta que caduque. Las cifras son tabulares para que no
// baile al contar, y la cuenta atrás es un role="timer" (no se anuncia a cada segundo).
export function PairingCode({ code, expiresAt }: PairingCodeProps) {
  const { t } = useI18n()
  const remaining = Math.ceil((Date.parse(expiresAt) - useNow(true)) / 1000)
  const expired = remaining <= 0
  return (
    <div className="paircode">
      <p className="paircode__hint">{t('pairing.code.hint')}</p>
      <p className={expired ? 'paircode__code paircode__code--expired' : 'paircode__code'}>{code}</p>
      <p className="paircode__countdown" role="timer">
        {expired ? t('pairing.code.expired') : t('pairing.code.expires', { time: formatCountdown(remaining) })}
      </p>
    </div>
  )
}
