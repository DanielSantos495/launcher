import type { IconRef } from '@account-launcher/core'
import { useI18n } from '../i18n-context'
import type { Destination } from '../lib/sections'
import { DestinationLabel } from './DestinationLabel'
import { Icon } from './Icon'
import { Menu, type MenuItem } from './Menu'

interface SectionHeaderProps {
  readonly title: string
  // Email de la identidad, si lo tiene.
  readonly subtitle?: string
  readonly count: number
  readonly icon?: IconRef
  readonly destination?: Destination
  readonly menuItems: readonly MenuItem[]
}

// Cabecera de una sección: nombre, email, número de cuentas, destino (en Varios perfiles) y menú de acciones.
export function SectionHeader({ title, subtitle, count, icon, destination, menuItems }: SectionHeaderProps) {
  const { t, tp } = useI18n()
  return (
    <div className="section__header">
      <div className="section__title">
        {icon === undefined ? null : <Icon icon={icon} size={22} />}
        <h2 className="section__name">{title}</h2>
        {subtitle === undefined ? null : <span className="section__meta">{subtitle}</span>}
        <span className="section__count">{tp('section.count', count, { count })}</span>
      </div>
      <div className="section__end">
        {destination === undefined ? null : (
          <span className="section__destination">
            <DestinationLabel destination={destination} />
          </span>
        )}
        {menuItems.length === 0 ? null : <Menu label={t('section.actions', { name: title })} items={menuItems} />}
      </div>
    </div>
  )
}
