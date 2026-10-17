// @vitest-environment happy-dom
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { es } from '../../src/i18n/messages.es'
import type { LauncherClient } from '../../src/ui/client'
import { createTestEnv, type TestEnv } from '../helpers/env'
import { imageBytes, pngImage } from '../helpers/images'
import { failing, localOf, makeAccount, makeIdentity, mount, storedData } from '../helpers/ui-setup'

const KEY = 'icon:vieja'

function setup(
  options: { image?: boolean; wrap?: (client: LauncherClient) => LauncherClient; anyFile?: boolean } = {},
) {
  const accounts = [
    makeAccount('a1', 'ana', 'Alfa', options.image === true ? { icon: { type: 'image', key: KEY } } : {}),
  ]
  const t: TestEnv = createTestEnv({
    local: {
      ...localOf({ identities: [makeIdentity('ana', 'Trabajo')], accounts }),
      ...(options.image === true ? { [KEY]: pngImage(24) } : {}),
    },
  })
  // anyFile: el selector deja pasar archivos que el atributo accept filtraría, para probar la defensa del código.
  const user = options.anyFile === true ? userEvent.setup({ applyAccept: false }) : undefined
  return {
    t,
    ...mount(t, {
      ...(options.wrap === undefined ? {} : { wrap: options.wrap }),
      ...(user === undefined ? {} : { user }),
    }),
  }
}

function pngFile(size = 16, type = 'image/png', name = 'icono.png'): File {
  return new File([imageBytes('png', size)], name, { type })
}

const imageInput = (dialog: HTMLElement): HTMLInputElement =>
  within(dialog).getByLabelText<HTMLInputElement>('Imagen (opcional)')

beforeEach(() => {
  vi.spyOn(navigator, 'language', 'get').mockReturnValue('es-ES')
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

async function openNew(user: ReturnType<typeof setup>['user']) {
  await screen.findByRole('heading', { name: 'Trabajo' })
  await user.click(screen.getByRole('button', { name: 'Añadir cuenta' }))
  return screen.findByRole('dialog', { name: 'Añadir cuenta' })
}

describe('imagen como icono de una cuenta', () => {
  it('el campo solo acepta png, jpeg y webp, y explica que no se exporta', async () => {
    const { user } = setup()
    const dialog = await openNew(user)
    expect(imageInput(dialog).type).toBe('file')
    expect(imageInput(dialog).accept).toBe('image/png,image/jpeg,image/webp')
    expect(within(dialog).getByText(es['account.image.hint'])).toBeTruthy()
  })

  it('elegir una imagen muestra la vista previa, se sube al guardar y la tarjeta la pinta con <img data:>', async () => {
    const { user, t, client } = setup()
    const dialog = await openNew(user)
    await user.upload(imageInput(dialog), pngFile())
    const preview = await within(dialog).findByAltText(es['account.image.preview'])
    expect(preview.getAttribute('src')).toMatch(/^data:image\/png;base64,/)
    // Hasta guardar no se sube nada: cancelar no deja imágenes huérfanas.
    expect(Object.keys(t.local.dump()).filter((key) => key.startsWith('icon:'))).toEqual([])

    await user.click(within(dialog).getByRole('button', { name: 'Guardar cuenta' }))
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
    const saved = (await storedData(client)).accounts.find((account) => account.id !== 'a1')
    expect(saved?.icon.type).toBe('image')
    const key = saved?.icon.type === 'image' ? saved.icon.key : ''
    expect(t.local.dump()[key]).toEqual(pngImage())
    const tile = await screen.findByRole('button', { name: saved?.label ?? '' })
    await waitFor(() => {
      expect(tile.querySelector('img')?.getAttribute('src')).toBe(`data:image/png;base64,${pngImage().base64}`)
    })
  })

  it('rechaza archivos que no son png, jpeg o webp válidos, con un error claro y sin subir nada', async () => {
    const { user, t } = setup({ anyFile: true })
    const dialog = await openNew(user)
    const input = imageInput(dialog)
    const svg = new File(['<svg xmlns="http://www.w3.org/2000/svg"/>'], 'x.svg', { type: 'image/svg+xml' })
    // happy-dom/userEvent filtran por accept: se fuerza el cambio para probar la defensa del código.
    for (const file of [
      svg,
      pngFile(16, 'image/gif'),
      new File([imageBytes('jpeg')], 'f.png', { type: 'image/png' }),
    ]) {
      await user.upload(input, file)
      await within(dialog).findByText(es['account.image.invalid'])
      expect(within(dialog).queryByAltText(es['account.image.preview'])).toBeNull()
    }
    expect(Object.keys(t.local.dump()).filter((key) => key.startsWith('icon:'))).toEqual([])
  })

  it('una imagen de más de 32 KiB da un error de tamaño; de 32 KiB exactos se acepta', async () => {
    const { user } = setup()
    const dialog = await openNew(user)
    await user.upload(imageInput(dialog), pngFile(32 * 1024 + 1))
    await within(dialog).findByText(es['account.image.too_large'])
    await user.upload(imageInput(dialog), pngFile(32 * 1024))
    await within(dialog).findByAltText(es['account.image.preview'])
    expect(within(dialog).queryByText(es['account.image.too_large'])).toBeNull()
  })

  it('si la cuenta no se guarda, la imagen subida se retira', async () => {
    const { user, t } = setup({ wrap: (client) => failing(client, (r) => r.type === 'data.mutate') })
    const dialog = await openNew(user)
    await user.upload(imageInput(dialog), pngFile())
    await user.click(within(dialog).getByRole('button', { name: 'Guardar cuenta' }))
    await within(dialog).findByRole('alert')
    expect(Object.keys(t.local.dump()).filter((key) => key.startsWith('icon:'))).toEqual([])
  })

  it('al quitar la imagen de una cuenta y guardar, se borra la anterior', async () => {
    const { user, t, client } = setup({ image: true })
    await user.click(await screen.findByRole('button', { name: 'Acciones de Alfa' }))
    await user.click(screen.getByRole('menuitem', { name: 'Editar' }))
    const dialog = await screen.findByRole('dialog', { name: 'Editar cuenta' })
    await user.click(within(dialog).getByRole('button', { name: es['account.image.remove'] }))
    await user.click(within(dialog).getByRole('button', { name: 'Guardar cambios' }))
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
    expect((await storedData(client)).accounts[0]?.icon).toEqual({ type: 'auto' })
    expect(t.local.dump()[KEY]).toBeUndefined()
  })

  it('al editar otro campo de una cuenta con imagen, la imagen se conserva', async () => {
    const { user, t, client } = setup({ image: true })
    await user.click(await screen.findByRole('button', { name: 'Acciones de Alfa' }))
    await user.click(screen.getByRole('menuitem', { name: 'Editar' }))
    const dialog = await screen.findByRole('dialog', { name: 'Editar cuenta' })
    await user.type(within(dialog).getByLabelText('Usuario o email (opcional)'), 'ana')
    await user.click(within(dialog).getByRole('button', { name: 'Guardar cambios' }))
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
    expect((await storedData(client)).accounts[0]?.icon).toEqual({ type: 'image', key: KEY })
    expect(t.local.dump()[KEY]).toEqual(pngImage(24))
  })
})

describe('mostrar imágenes', () => {
  it('si falta la imagen se pinta el icono automático del servicio', async () => {
    const t = createTestEnv({
      local: localOf({
        identities: [makeIdentity('ana', 'Trabajo')],
        accounts: [makeAccount('a1', 'ana', 'Alfa', { icon: { type: 'image', key: 'icon:no-esta' } })],
      }),
    })
    mount(t)
    const tile = await screen.findByRole('button', { name: 'Alfa' })
    await waitFor(() => {
      expect(tile.querySelector('img')?.getAttribute('src')).toBe('/icons/services/github.svg')
    })
  })

  it('carga perezosa con caché: dos cuentas con la misma clave piden la imagen una vez', async () => {
    const requests: string[] = []
    const t = createTestEnv({
      local: {
        ...localOf({
          identities: [makeIdentity('ana', 'Trabajo')],
          accounts: [
            makeAccount('a1', 'ana', 'Alfa', { icon: { type: 'image', key: KEY } }),
            makeAccount('a2', 'ana', 'Beta', { icon: { type: 'image', key: KEY }, order: 1 }),
          ],
        }),
        [KEY]: pngImage(24),
      },
    })
    mount(t, {
      wrap: (client) => ({
        ...client,
        send(request) {
          requests.push(request.type)
          return client.send(request)
        },
      }),
    })
    for (const label of ['Alfa', 'Beta']) {
      const tile = await screen.findByRole('button', { name: label })
      await waitFor(() => {
        expect(tile.querySelector('img')?.getAttribute('src')).toMatch(/^data:image\/png;base64,/)
      })
    }
    expect(requests.filter((type) => type === 'icon.get')).toHaveLength(1)
  })

  it('las fuentes de la interfaz no usan dangerouslySetInnerHTML ni innerHTML', () => {
    const files = ['src/ui/components/Icon.tsx', 'src/ui/components/AccountForm.tsx', 'src/ui/image-icons.tsx']
    for (const file of files) {
      const source = readFileSync(join(import.meta.dirname, '..', '..', file), 'utf8')
      expect(source).not.toMatch(/dangerouslySetInnerHTML|innerHTML/)
    }
  })
})
