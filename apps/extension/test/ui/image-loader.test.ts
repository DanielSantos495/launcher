import { describe, expect, it, vi } from 'vitest'
import { createImageLoader } from '../../src/ui/image-icons'
import type { LauncherClient } from '../../src/ui/client'
import { pngImage } from '../helpers/images'

type Send = LauncherClient['send']

// Un send falso que responde siempre lo mismo y cuenta las llamadas.
function sendOf(response: unknown) {
  const send = vi.fn(() => Promise.resolve(response))
  // El tipo genérico de send depende del mensaje: las pruebas solo envían icon.get.
  return { send, loader: createImageLoader(send as unknown as Send) }
}

describe('createImageLoader', () => {
  it('una imagen leída se pide una sola vez', async () => {
    const { send, loader } = sendOf({ ok: true, result: pngImage() })
    expect(await loader.load('icon:a')).toEqual(pngImage())
    expect(await loader.load('icon:a')).toEqual(pngImage())
    expect(send).toHaveBeenCalledTimes(1)
  })

  it.each(['not_found', 'invalid'])('%s es definitivo: no se vuelve a pedir', async (code) => {
    const { send, loader } = sendOf({ ok: false, error: { code } })
    expect(await loader.load('icon:a')).toBeUndefined()
    expect(await loader.load('icon:a')).toBeUndefined()
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('un fallo pasajero se vuelve a intentar', async () => {
    const { send, loader } = sendOf({ ok: false, error: { code: 'host_error' } })
    await loader.load('icon:a')
    await loader.load('icon:a')
    expect(send).toHaveBeenCalledTimes(2)
  })
})
