import type { IconRef } from '@account-launcher/core'
import { bundledIconUrl } from '../icons'

interface IconProps {
  readonly icon: IconRef
  // Icono empaquetado del servicio (CATALOG[].icon); lo usa 'auto' y es el respaldo de los demás tipos.
  readonly serviceIcon?: string | undefined
  readonly size?: number
}

// Decorativo: la etiqueta de al lado ya dice qué es. Solo pinta iconos empaquetados o un emoji como texto (T6).
export function Icon({ icon, serviceIcon, size = 28 }: IconProps) {
  if (icon.type === 'emoji') {
    return (
      <span className="icon icon--emoji" style={{ width: size, height: size, fontSize: size * 0.7 }} aria-hidden="true">
        {icon.value}
      </span>
    )
  }
  const name = icon.type === 'bundled' ? icon.name : (serviceIcon ?? 'web')
  const url = bundledIconUrl(name) ?? bundledIconUrl('web')
  return url === undefined ? null : <img className="icon" src={url} width={size} height={size} alt="" />
}
