import { useI18n } from '../i18n-context'
import type { Destination } from '../lib/sections'

// Dónde se abrirá, mostrado antes de abrir (T11). El color del perfil es un punto: el texto es la señal real.
export function DestinationLabel({ destination }: { readonly destination: Destination }) {
  const { t } = useI18n()
  if (destination.kind === 'current') return <span className="destination">{t('destination.current')}</span>
  return (
    <span className="destination">
      {destination.color === undefined ? null : (
        <span className="dot" style={{ backgroundColor: destination.color }} aria-hidden="true" />
      )}
      {t('destination.profile', { name: destination.name ?? destination.directory })}
    </span>
  )
}
