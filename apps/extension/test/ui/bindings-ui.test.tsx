// @vitest-environment happy-dom
import type { Bindings, ProfileInfo } from '@account-launcher/core'
import { act, cleanup, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { es } from '../../src/i18n/messages.es'
import { createTestEnv } from '../helpers/env'
import { createFakeHost, type FakeHost } from '../helpers/fake-host'
import { failing, localOf, makeIdentity, mount, storedData } from '../helpers/ui-setup'

let fake: FakeHost

interface Options {
  readonly bindings?: Bindings
  readonly profiles?: ProfileInfo[]
  readonly browser?: 'brave' | 'chrome' | 'edge'
  readonly identityColor?: string
  readonly failBindings?: boolean
}

// Abre Configuración en Varios perfiles con la identidad «Ana» (y «Beto» sin vínculo).
async function openSettings(options: Options = {}) {
  fake = createFakeHost({
    ...(options.profiles === undefined ? {} : { profiles: options.profiles }),
    ...(options.browser === undefined ? {} : { browser: options.browser }),
  })
  const t = createTestEnv({
    host: fake,
    local: localOf({
      mode: 'multi',
      identities: [
        makeIdentity('ana', 'Ana', {
          ...(options.identityColor === undefined ? {} : { color: options.identityColor }),
        }),
        makeIdentity('beto', 'Beto', { order: 1 }),
      ],
      bindings: options.bindings ?? {},
    }),
  })
  const mounted = mount(t, {
    ...(options.failBindings === true ? { wrap: (client) => failing(client, (r) => r.type === 'bindings.set') } : {}),
  })
  await mounted.user.click(await screen.findByRole('button', { name: 'Configuración' }))
  await screen.findByRole('heading', { name: 'Vínculos' })
  return { t, ...mounted }
}

// Fila de una identidad en la sección de vínculos.
function rowOf(identity: string): HTMLElement {
  const row = screen
    .getAllByRole('listitem')
    .find((item) => within(item).queryByRole('combobox', { name: `Perfil de ${identity}` }) !== null)
  if (row === undefined) throw new Error(`falta la fila de ${identity}`)
  return row
}

const bindingsOf = async (client: Awaited<ReturnType<typeof openSettings>>['client']): Promise<Bindings> => {
  const response = await client.send({ type: 'bindings.get' })
  if (!response.ok) throw new Error('bindings.get falló')
  return response.result.bindings
}

beforeEach(() => {
  vi.spyOn(navigator, 'language', 'get').mockReturnValue('es-ES')
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  expect(fake.invalidRequests).toBe(0)
})

describe('crear perfil y detectar el nombre', () => {
  it('crea el perfil, lo vincula, pide ponerle nombre y detecta el cambio al volver a la ventana', async () => {
    const { user, client } = await openSettings()
    await user.click(screen.getByRole('button', { name: 'Crear perfil para Ana' }))
    const dialog = await screen.findByRole('dialog', { name: 'Crear un perfil para «Ana»' })
    const name = within(dialog).getByLabelText('Nombre del perfil')
    // El nombre propuesto es la etiqueta de la identidad.
    expect((name as HTMLInputElement).value).toBe('Ana')
    await user.clear(name)
    await user.type(name, 'Trabajo')
    await user.click(within(dialog).getByRole('button', { name: 'Crear perfil' }))
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })

    const bindings = await bindingsOf(client)
    expect(bindings.ana).toEqual({
      kind: 'chromium-profile',
      profileDirectory: 'Launcher-1a2b3c4d',
      desiredName: 'Trabajo',
    })
    const row = await waitFor(() => {
      const candidate = rowOf('Ana')
      within(candidate).getByText('Ponle el nombre «Trabajo» en Brave: abre ese perfil, pulsa su icono y elige Editar')
      return candidate
    })
    expect(within(row).getByText('Abre en el perfil «Persona 2»')).toBeTruthy()

    // Brave ya muestra el nombre elegido; al volver a la ventana se comprueba solo.
    fake.state.profiles = fake.state.profiles.map((profile) =>
      profile.directory === 'Launcher-1a2b3c4d' ? { ...profile, name: 'Trabajo', isUsingDefaultName: false } : profile,
    )
    act(() => {
      window.dispatchEvent(new Event('focus'))
    })
    expect(await within(rowOf('Ana')).findByText('El perfil ya se llama «Trabajo»')).toBeTruthy()
    expect(within(rowOf('Ana')).queryByText(/Ponle el nombre/)).toBeNull()
  })

  it('mientras espera dice que está creando el perfil y no deja pulsar dos veces', async () => {
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    fake = createFakeHost()
    const t = createTestEnv({
      host: fake,
      local: localOf({ mode: 'multi', identities: [makeIdentity('ana', 'Ana')] }),
    })
    const { user } = mount(t, {
      wrap: (client) => ({
        ...client,
        async send(request) {
          if (request.type === 'profiles.create') await gate
          return client.send(request)
        },
      }),
    })
    await user.click(await screen.findByRole('button', { name: 'Configuración' }))
    await user.click(await screen.findByRole('button', { name: 'Crear perfil para Ana' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Crear perfil' }))
    expect(await within(dialog).findByText('Creando el perfil…')).toBeTruthy()
    expect(within(dialog).getByRole<HTMLButtonElement>('button', { name: 'Crear perfil' }).disabled).toBe(true)
    expect(within(dialog).getByRole<HTMLButtonElement>('button', { name: 'Cancelar' }).disabled).toBe(true)
    release()
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
    expect(fake.requests.filter((request) => request.cmd === 'createProfile')).toHaveLength(1)
  })

  it('un nombre vacío no crea nada y un perfil que no aparece en el navegador explica qué hacer', async () => {
    const { user } = await openSettings()
    await user.click(screen.getByRole('button', { name: 'Crear perfil para Ana' }))
    const dialog = await screen.findByRole('dialog')
    await user.clear(within(dialog).getByLabelText('Nombre del perfil'))
    await user.click(within(dialog).getByRole('button', { name: 'Crear perfil' }))
    expect(within(dialog).getByText(es['field.required'])).toBeTruthy()
    expect(fake.requests.filter((request) => request.cmd === 'createProfile')).toEqual([])

    // El navegador nunca muestra el perfil nuevo: tras 20 intentos, error y vínculo a mano.
    fake.createProfileVisibleAfter = 1000
    await user.type(within(dialog).getByLabelText('Nombre del perfil'), 'Trabajo')
    await user.click(within(dialog).getByRole('button', { name: 'Crear perfil' }))
    expect((await within(dialog).findByRole('alert')).textContent).toContain(es['hint.profile_not_listed'])
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('el aviso nombra el navegador del programa', async () => {
    await openSettings({
      browser: 'chrome',
      profiles: [{ directory: 'Profile 1', name: 'Persona 1', isUsingDefaultName: true }],
      bindings: { ana: { kind: 'chromium-profile', profileDirectory: 'Profile 1', desiredName: 'Trabajo' } },
    })
    expect(
      await within(rowOf('Ana')).findByText(
        'Ponle el nombre «Trabajo» en Chrome: abre ese perfil, pulsa su icono y elige Editar',
      ),
    ).toBeTruthy()
  })

  it('"Comprobar" vuelve a leer los perfiles', async () => {
    const { user } = await openSettings({
      profiles: [{ directory: 'Profile 1', name: 'Persona 1', isUsingDefaultName: true }],
      bindings: { ana: { kind: 'chromium-profile', profileDirectory: 'Profile 1', desiredName: 'Trabajo' } },
    })
    await within(rowOf('Ana')).findByText(/Ponle el nombre «Trabajo»/)
    fake.state.profiles = [{ directory: 'Profile 1', name: 'Trabajo', isUsingDefaultName: false }]
    await user.click(screen.getByRole('button', { name: 'Comprobar' }))
    expect(await within(rowOf('Ana')).findByText('El perfil ya se llama «Trabajo»')).toBeTruthy()
  })

  it('un perfil con el nombre por defecto no cuenta como ya renombrado', async () => {
    await openSettings({
      profiles: [{ directory: 'Profile 1', name: 'Trabajo', isUsingDefaultName: true }],
      bindings: { ana: { kind: 'chromium-profile', profileDirectory: 'Profile 1', desiredName: 'Trabajo' } },
    })
    expect(await within(rowOf('Ana')).findByText(/Ponle el nombre «Trabajo»/)).toBeTruthy()
    expect(within(rowOf('Ana')).queryByText(/ya se llama/)).toBeNull()
  })
})

describe('vincular y desvincular', () => {
  it('elegir un perfil existente lo vincula y "Quitar vínculo" vuelve a Sin aislar', async () => {
    const { user, client } = await openSettings()
    expect(within(rowOf('Ana')).getByText('Sin aislar: abre en esta ventana')).toBeTruthy()
    expect(within(rowOf('Ana')).queryByRole('button', { name: /Quitar vínculo/ })).toBeNull()

    await user.selectOptions(within(rowOf('Ana')).getByRole('combobox'), 'Personal (Default)')
    await waitFor(async () => {
      expect(await bindingsOf(client)).toEqual({ ana: { kind: 'chromium-profile', profileDirectory: 'Default' } })
    })
    expect(await within(rowOf('Ana')).findByText('Abre en el perfil «Personal»')).toBeTruthy()
    // Beto sigue sin vínculo.
    expect(within(rowOf('Beto')).getByText('Sin aislar: abre en esta ventana')).toBeTruthy()

    await user.click(within(rowOf('Ana')).getByRole('button', { name: 'Quitar vínculo de Ana' }))
    await waitFor(() => {
      expect(within(rowOf('Ana')).getByText('Sin aislar: abre en esta ventana')).toBeTruthy()
    })
    expect(await bindingsOf(client)).toEqual({})
  })

  it('un vínculo "current" se muestra como Sin aislar', async () => {
    await openSettings({ bindings: { ana: { kind: 'current' } } })
    expect(within(rowOf('Ana')).getByText('Sin aislar: abre en esta ventana')).toBeTruthy()
    expect(within(rowOf('Ana')).getByRole('button', { name: 'Quitar vínculo de Ana' })).toBeTruthy()
  })

  it('un perfil vinculado que ya no existe lo dice, con o sin nombre pedido', async () => {
    await openSettings({
      bindings: {
        ana: { kind: 'chromium-profile', profileDirectory: 'Borrada', desiredName: 'Trabajo' },
        beto: { kind: 'chromium-profile', profileDirectory: 'Otra' },
      },
    })
    expect(await within(rowOf('Ana')).findByText('El perfil vinculado ya no existe')).toBeTruthy()
    expect(within(rowOf('Beto')).getByText('El perfil vinculado ya no existe')).toBeTruthy()
    expect(within(rowOf('Ana')).queryByText(/Ponle el nombre/)).toBeNull()
  })

  it('si no se puede guardar el vínculo se muestra el error en la fila', async () => {
    const { user } = await openSettings({ failBindings: true })
    await user.selectOptions(within(rowOf('Ana')).getByRole('combobox'), 'Personal (Default)')
    expect((await within(rowOf('Ana')).findByRole('alert')).textContent).toContain(es['hint.storage_write'])
    expect(within(rowOf('Beto')).queryByRole('alert')).toBeNull()
  })
})

describe('usar el color del perfil', () => {
  const colored: ProfileInfo[] = [
    { directory: 'Default', name: 'Personal', isUsingDefaultName: false, color: '#aa2255' },
  ]

  it('cambia el color de la identidad al del perfil y el botón desaparece', async () => {
    const { user, client } = await openSettings({
      profiles: colored,
      bindings: { ana: { kind: 'chromium-profile', profileDirectory: 'Default' } },
    })
    await user.click(await within(rowOf('Ana')).findByRole('button', { name: 'Usar el color del perfil para Ana' }))
    await waitFor(async () => {
      expect((await storedData(client)).identities.find((i) => i.id === 'ana')?.color).toBe('#aa2255')
    })
    await waitFor(() => {
      expect(within(rowOf('Ana')).queryByRole('button', { name: /Usar el color/ })).toBeNull()
    })
    // El resto de la identidad no cambia.
    expect((await storedData(client)).identities.find((i) => i.id === 'beto')?.color).toBe('#336699')
  })

  it('no se ofrece si el color ya es el mismo (sin distinguir mayúsculas) ni si el perfil no tiene color', async () => {
    await openSettings({
      profiles: colored,
      identityColor: '#AA2255',
      bindings: { ana: { kind: 'chromium-profile', profileDirectory: 'Default' } },
    })
    await within(rowOf('Ana')).findByText('Abre en el perfil «Personal»')
    expect(within(rowOf('Ana')).queryByRole('button', { name: /Usar el color/ })).toBeNull()
    cleanup()

    await openSettings({
      bindings: { ana: { kind: 'chromium-profile', profileDirectory: 'Default' } },
    })
    await within(rowOf('Ana')).findByText('Abre en el perfil «Personal»')
    expect(within(rowOf('Ana')).queryByRole('button', { name: /Usar el color/ })).toBeNull()
  })
})
