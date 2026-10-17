import type { IconRef } from '@account-launcher/core'
import { bundledIconUrl } from '../icons'
import { useUploadedImage } from '../image-icons'
import { imageDataUrl } from '../lib/image-file'

interface IconProps {
  readonly icon: IconRef
  // Icono empaquetado del servicio (CATALOG[].icon); lo usa 'auto' y es el respaldo de los demás tipos.
  readonly serviceIcon?: string | undefined
  readonly size?: number
}

// Imagen subida: solo un <img> con una URL data: del mime de la lista blanca (T6). Mientras carga, o si falta (por
// ejemplo tras importar, porque la exportación no lleva imágenes), se pinta el icono automático.
function UploadedImage({
  imageKey,
  serviceIcon,
  size,
}: {
  imageKey: string
  serviceIcon?: string | undefined
  size: number
}) {
  const image = useUploadedImage(imageKey)
  if (image === undefined) return <Icon icon={{ type: 'auto' }} serviceIcon={serviceIcon} size={size} />
  return <img className="icon icon--image" src={imageDataUrl(image)} width={size} height={size} alt="" />
}

// Decorativo: la etiqueta de al lado ya dice qué es. Solo pinta iconos empaquetados, un emoji como texto o una
// imagen subida en un <img> (T6); nunca HTML ni SVG.
export function Icon({ icon, serviceIcon, size = 28 }: IconProps) {
  if (icon.type === 'image') return <UploadedImage imageKey={icon.key} serviceIcon={serviceIcon} size={size} />
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
