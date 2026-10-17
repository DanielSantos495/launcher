import { IconImageSchema, type IconImage } from '@account-launcher/protocol'
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import * as v from 'valibot'
import type { LauncherClient } from './client'

type Send = LauncherClient['send']

// Carga perezosa de las imágenes subidas, con caché en memoria por clave (icon:<id>). Las claves son únicas por
// subida, así que la caché nunca queda vieja: cambiar la imagen de una cuenta cambia la clave.
export interface ImageLoader {
  load(key: string): Promise<IconImage | undefined>
  // Guarda en la caché una imagen recién subida, para no volver a pedirla.
  remember(key: string, image: IconImage): void
}

export function createImageLoader(send: Send): ImageLoader {
  const cache = new Map<string, Promise<IconImage | undefined>>()
  return {
    load(key) {
      const cached = cache.get(key)
      if (cached !== undefined) return cached
      const pending = send({ type: 'icon.get', key }).then(
        (response) => {
          if (response.ok) {
            const image = v.safeParse(IconImageSchema, response.result)
            return image.success ? image.output : undefined
          }
          // Solo "no existe" es definitivo (p. ej. tras importar): un fallo pasajero se vuelve a intentar.
          if (response.error.code !== 'not_found') cache.delete(key)
          return undefined
        },
        () => {
          cache.delete(key)
          return undefined
        },
      )
      cache.set(key, pending)
      return pending
    },
    remember(key, image) {
      cache.set(key, Promise.resolve(image))
    },
  }
}

const NO_IMAGES: ImageLoader = { load: () => Promise.resolve(undefined), remember: () => undefined }
const ImageLoaderContext = createContext<ImageLoader>(NO_IMAGES)

export function ImageLoaderProvider({
  loader,
  children,
}: {
  readonly loader: ImageLoader
  readonly children: ReactNode
}) {
  return <ImageLoaderContext value={loader}>{children}</ImageLoaderContext>
}

export function useImageLoader(): ImageLoader {
  return useContext(ImageLoaderContext)
}

// Imagen de la clave, o undefined mientras carga o si falta (el llamante muestra entonces el icono automático).
export function useUploadedImage(key: string): IconImage | undefined {
  const loader = useImageLoader()
  const [loaded, setLoaded] = useState<{ readonly key: string; readonly image: IconImage | undefined }>()
  useEffect(() => {
    let current = true
    void loader.load(key).then((image) => {
      if (current) setLoaded({ key, image })
    })
    return () => {
      current = false
    }
  }, [loader, key])
  return loaded?.key === key ? loaded.image : undefined
}
