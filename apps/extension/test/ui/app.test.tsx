// @vitest-environment happy-dom
import {
  createEmptyData,
  type Account,
  type Bindings,
  type Group,
  type Identity,
  type LauncherData,
} from '@account-launcher/core'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { es } from '../../src/i18n/messages.es'
import type { UiRequest } from '@account-launcher/protocol'
import { toUiResponse, type LauncherClient } from '../../src/ui/client'
import { App } from '../../src/ui/App'
import { createTestEnv, type TestEnv } from '../helpers/env'
import { createFakeHost, type FakeHost, type FakeHostOptions } from '../helpers/fake-host'
import { createRouterClient } from '../helpers/router-client'

const AT = '2026-10-01T10:00:00.000Z'

function identity(id: string, label: string, extra: Partial<Identity> = {}): Identity {
  return { id, label, color: '#336699', order: 0, createdAt: AT, updatedAt: AT, ...extra }
}

function group(id: string, name: string, order = 0): Group {
  return { id, name, color: '#aa5500', order, createdAt: AT, updatedAt: AT }
}

function account(id: string, identityId: string, label: string, extra: Partial<Account> = {}): Account {
  return {
    id,
    identityId,
    groupId: null,
    serviceId: 'github',
    label,
    icon: { type: 'auto' },
    favorite: false,
    order: 0,
    createdAt: AT,
    updatedAt: AT,
    ...extra,
  }
}

interface Seed {
  readonly identities?: Identity[]
  readonly groups?: Group[]
  readonly accounts?: Account[]
  readonly mode?: 'single' | 'multi'
  readonly bindings?: Bindings
  readonly host?: FakeHostOptions
  readonly hostMode?: FakeHost['mode']
  readonly ownProfileDirectory?: string
  // Envuelve el cliente del router (por ejemplo, para hacer fallar una petición concreta).
  readonly wrap?: (client: LauncherClient) => LauncherClient
}

interface Setup {
  readonly t: TestEnv
  readonly client: LauncherClient
  readonly fake: FakeHost | undefined
  readonly user: ReturnType<typeof userEvent.setup>
}

const fakes: FakeHost[] = []

// Cliente que responde con un error a las peticiones que cumplan `fails` y deja pasar el resto.
function failing(client: LauncherClient, fails: (request: UiRequest) => boolean): LauncherClient {
  return {
    ...client,
    send(request) {
      const message: UiRequest = request
      if (!fails(message)) return client.send(request)
      return Promise.resolve(
        toUiResponse<typeof request>({ ok: false, error: { code: 'internal', hint: 'storage_write' } }),
      )
    },
  }
}

const BOUND: Bindings = { ana: { kind: 'chromium-profile', profileDirectory: 'Default' } }

// Monta el dashboard sobre el router real del service worker. Sin `seed`, es una instalación nueva.
function setup(seed?: Seed): Setup {
  let fake: FakeHost | undefined
  if (seed?.host !== undefined || seed?.hostMode !== undefined || seed?.mode === 'multi') {
    fake = createFakeHost(seed.host)
    if (seed.hostMode !== undefined) fake.mode = seed.hostMode
    fakes.push(fake)
  }
  const empty = createEmptyData()
  const local =
    seed === undefined
      ? undefined
      : {
          installation: {
            installationId: 'inst-1',
            paired: false,
            ...(seed.ownProfileDirectory === undefined ? {} : { ownProfileDirectory: seed.ownProfileDirectory }),
          },
          localData: {
            ...empty,
            revision: 1,
            identities: seed.identities ?? [],
            groups: seed.groups ?? [],
            accounts: seed.accounts ?? [],
            settings: { ...empty.settings, mode: seed.mode ?? 'single' },
          } satisfies LauncherData,
          localBindings: seed.bindings ?? {},
        }
  const t = createTestEnv({ ...(local === undefined ? {} : { local }), ...(fake === undefined ? {} : { host: fake }) })
  const client = createRouterClient(t)
  render(<App client={seed?.wrap === undefined ? client : seed.wrap(client)} />)
  return { t, client, fake, user: userEvent.setup() }
}

async function storedData(client: LauncherClient): Promise<LauncherData> {
  const response = await client.send({ type: 'data.get' })
  if (!response.ok) throw new Error('data.get falló')
  return response.result.data
}

beforeEach(() => {
  vi.spyOn(navigator, 'language', 'get').mockReturnValue('es-ES')
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  document.documentElement.removeAttribute('data-theme')
  // Ninguna prueba debe haber hecho que el dashboard envíe algo fuera del contrato del host.
  for (const fake of fakes) expect(fake.invalidRequests).toBe(0)
  fakes.length = 0
})

describe('identidades y cuentas', () => {
  it('una instalación nueva invita a crear la primera identidad y la sección aparece al crearla', async () => {
    const { user, client } = setup()
    expect(await screen.findByText('Crea tu primera identidad para empezar')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Crear identidad' }))
    const dialog = await screen.findByRole('dialog', { name: 'Nueva identidad' })
    await user.type(within(dialog).getByLabelText('Nombre'), 'Trabajo')
    await user.type(within(dialog).getByLabelText('Email (opcional)'), 'ana@empresa.example')
    await user.click(within(dialog).getByRole('button', { name: 'Crear identidad' }))
    expect(await screen.findByRole('heading', { name: 'Trabajo' })).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByText('ana@empresa.example')).toBeTruthy()
    expect(screen.getByText('Identidad guardada.')).toBeTruthy()
    const saved = (await storedData(client)).identities
    expect(saved).toHaveLength(1)
    expect(saved[0]?.label).toBe('Trabajo')
    expect(saved[0]?.email).toBe('ana@empresa.example')
  })

  it('un formulario con errores los muestra por campo, enfoca el primero y no guarda nada', async () => {
    const { user, client } = setup()
    await user.click(await screen.findByRole('button', { name: 'Crear identidad' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('Email (opcional)'), 'no-es-email')
    await user.click(within(dialog).getByRole('button', { name: 'Crear identidad' }))
    expect(within(dialog).getByText(es['field.required'])).toBeTruthy()
    expect(within(dialog).getByText(es['field.email.invalid'])).toBeTruthy()
    expect(document.activeElement).toBe(within(dialog).getByLabelText('Nombre'))
    expect(within(dialog).getByLabelText('Nombre').getAttribute('aria-invalid')).toBe('true')
    expect((await storedData(client)).identities).toHaveLength(0)
  })

  it('añade una cuenta de GitHub y al hacer clic en la tarjeta se abre su dirección', async () => {
    const { user, t } = setup({ identities: [identity('ana', 'Trabajo')] })
    await screen.findByRole('heading', { name: 'Trabajo' })
    await user.click(screen.getByRole('button', { name: 'Añadir cuenta' }))
    const dialog = await screen.findByRole('dialog', { name: 'Añadir cuenta' })
    await user.selectOptions(within(dialog).getByLabelText('Servicio'), 'GitHub')
    expect(within(dialog).getByLabelText<HTMLInputElement>('Etiqueta').value).toBe('GitHub')
    await user.click(within(dialog).getByRole('button', { name: 'Guardar cuenta' }))
    await user.click(await screen.findByRole('button', { name: 'GitHub' }))
    await waitFor(() => {
      expect(t.deps.opened).toEqual(['https://github.com/'])
    })
  })

  it('la etiqueta sigue al servicio mientras no se escriba una propia', async () => {
    const { user } = setup({ identities: [identity('ana', 'Trabajo')] })
    await user.click(await screen.findByRole('button', { name: 'Añadir cuenta' }))
    const dialog = await screen.findByRole('dialog')
    const label = within(dialog).getByLabelText<HTMLInputElement>('Etiqueta')
    await user.selectOptions(within(dialog).getByLabelText('Servicio'), 'Claude')
    expect(label.value).toBe('Claude')
    await user.clear(label)
    await user.type(label, 'Mi cuenta')
    await user.selectOptions(within(dialog).getByLabelText('Servicio'), 'ChatGPT')
    expect(label.value).toBe('Mi cuenta')
  })

  it('una cuenta genérica sin dirección o con javascript: no se guarda', async () => {
    const { user, client } = setup({ identities: [identity('ana', 'Trabajo')] })
    await user.click(await screen.findByRole('button', { name: 'Añadir cuenta' }))
    const dialog = await screen.findByRole('dialog')
    await user.selectOptions(within(dialog).getByLabelText('Servicio'), 'Otra web')
    await user.click(within(dialog).getByRole('button', { name: 'Guardar cuenta' }))
    expect(within(dialog).getByText(es['field.url.required'])).toBeTruthy()
    await user.type(within(dialog).getByLabelText('Dirección web'), 'javascript:alert(1)')
    await user.click(within(dialog).getByRole('button', { name: 'Guardar cuenta' }))
    expect(within(dialog).getByText(es['field.url.scheme'])).toBeTruthy()
    expect((await storedData(client)).accounts).toHaveLength(0)
  })

  it('la estrella marca la cuenta como favorita y pasa a ser la primera de su sección', async () => {
    const { user, client } = setup({
      identities: [identity('ana', 'Trabajo')],
      accounts: [account('a1', 'ana', 'Alfa'), account('a2', 'ana', 'Beta', { order: 1 })],
    })
    const section = (await screen.findByRole('heading', { name: 'Trabajo' })).closest('section')
    if (section === null) throw new Error('falta la sección')
    expect(within(section).getAllByRole('listitem')[0]?.textContent).toContain('Alfa')
    const star = screen.getByRole('button', { name: 'Favorita: Beta' })
    expect(star.getAttribute('aria-pressed')).toBe('false')
    await user.click(star)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Favorita: Beta' }).getAttribute('aria-pressed')).toBe('true')
    })
    expect(within(section).getAllByRole('listitem')[0]?.textContent).toContain('Beta')
    const stored = (await storedData(client)).accounts.find((a) => a.id === 'a2')
    expect(stored?.favorite).toBe(true)
  })

  it('edita la etiqueta de una cuenta desde su menú', async () => {
    const { user, client } = setup({
      identities: [identity('ana', 'Trabajo')],
      accounts: [account('a1', 'ana', 'Alfa', { username: 'anadev' })],
    })
    await user.click(await screen.findByRole('button', { name: 'Acciones de Alfa' }))
    await user.click(screen.getByRole('menuitem', { name: 'Editar' }))
    const dialog = await screen.findByRole('dialog', { name: 'Editar cuenta' })
    const label = within(dialog).getByLabelText('Etiqueta')
    await user.clear(label)
    await user.type(label, 'Omega')
    await user.click(within(dialog).getByRole('button', { name: 'Guardar cambios' }))
    expect(await screen.findByRole('button', { name: 'Omega' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Alfa' })).toBeNull()
    const stored = (await storedData(client)).accounts[0]
    expect(stored?.label).toBe('Omega')
    expect(stored?.username).toBe('anadev')
  })

  it('borrar una cuenta pide confirmación y la quita', async () => {
    const { user, client } = setup({
      identities: [identity('ana', 'Trabajo')],
      accounts: [account('a1', 'ana', 'Alfa')],
    })
    await user.click(await screen.findByRole('button', { name: 'Acciones de Alfa' }))
    await user.click(screen.getByRole('menuitem', { name: 'Borrar' }))
    const dialog = await screen.findByRole('dialog', { name: 'Borrar «Alfa»' })
    // Cancelar no borra nada.
    await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect((await storedData(client)).accounts).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: 'Acciones de Alfa' }))
    await user.click(screen.getByRole('menuitem', { name: 'Borrar' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Borrar cuenta' }))
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Alfa' })).toBeNull()
    })
    expect((await storedData(client)).accounts).toHaveLength(0)
  })

  it('borrar una identidad con 2 cuentas ofrece borrarlas todas y deja el dashboard vacío', async () => {
    const { user, client } = setup({
      identities: [identity('ana', 'Trabajo')],
      accounts: [account('a1', 'ana', 'Alfa'), account('a2', 'ana', 'Beta', { order: 1 })],
      mode: 'multi',
      bindings: { ana: { kind: 'chromium-profile', profileDirectory: 'Default' } },
    })
    await user.click(await screen.findByRole('button', { name: 'Acciones de Trabajo' }))
    await user.click(screen.getByRole('menuitem', { name: 'Borrar identidad' }))
    const dialog = await screen.findByRole('dialog', { name: 'Borrar la identidad «Trabajo»' })
    await user.click(within(dialog).getByRole('button', { name: 'Borrar la identidad y sus 2 cuentas' }))
    expect(await screen.findByText('Crea tu primera identidad para empezar')).toBeTruthy()
    const data = await storedData(client)
    expect(data.identities).toHaveLength(0)
    expect(data.accounts).toHaveLength(0)
    // El vínculo de la identidad borrada tampoco queda suelto.
    expect(await client.send({ type: 'bindings.get' })).toEqual({ ok: true, result: { bindings: {} } })
  })

  it('borrar una identidad sin cuentas solo pide confirmar', async () => {
    const { user, client } = setup({
      identities: [identity('ana', 'Trabajo'), identity('bea', 'Personal', { order: 1 })],
    })
    await user.click(await screen.findByRole('button', { name: 'Acciones de Trabajo' }))
    await user.click(screen.getByRole('menuitem', { name: 'Borrar identidad' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Borrar identidad' }))
    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'Trabajo' })).toBeNull()
    })
    expect((await storedData(client)).identities.map((i) => i.id)).toEqual(['bea'])
  })

  it('con más de 99 cuentas explica que hay que mover o borrar antes y no ofrece borrar', async () => {
    const accounts = Array.from({ length: 100 }, (_, i) =>
      account(`a${String(i)}`, 'ana', `Cuenta ${String(i)}`, { order: i }),
    )
    const { user, client } = setup({ identities: [identity('ana', 'Trabajo')], accounts })
    await user.click(await screen.findByRole('button', { name: 'Acciones de Trabajo' }))
    await user.click(screen.getByRole('menuitem', { name: 'Borrar identidad' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/tiene 100 cuentas/)).toBeTruthy()
    expect(within(dialog).queryByRole('button', { name: /Borrar/ })).toBeNull()
    await user.click(within(dialog).getByRole('button', { name: 'Cerrar' }))
    expect((await storedData(client)).accounts).toHaveLength(100)
  })

  it('con exactamente 99 cuentas todavía ofrece borrarlas todas (99 + 1 = 100 operaciones) y lo borra', async () => {
    const accounts = Array.from({ length: 99 }, (_, i) =>
      account(`a${String(i)}`, 'ana', `Cuenta ${String(i)}`, { order: i }),
    )
    const { user, client } = setup({ identities: [identity('ana', 'Trabajo')], accounts })
    await user.click(await screen.findByRole('button', { name: 'Acciones de Trabajo' }))
    await user.click(screen.getByRole('menuitem', { name: 'Borrar identidad' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).queryByText(/Mueve o borra|mueve o borra/)).toBeNull()
    await user.click(within(dialog).getByRole('button', { name: 'Borrar la identidad y sus 99 cuentas' }))
    expect(await screen.findByText('Crea tu primera identidad para empezar')).toBeTruthy()
    const data = await storedData(client)
    expect(data.identities).toHaveLength(0)
    expect(data.accounts).toHaveLength(0)
  })

  it('si el borrado falla después de quitar el vínculo, el vínculo se restaura y se muestra el error', async () => {
    const { user, client } = setup({
      identities: [identity('ana', 'Trabajo')],
      accounts: [account('a1', 'ana', 'Alfa'), account('a2', 'ana', 'Beta', { order: 1 })],
      mode: 'multi',
      bindings: BOUND,
      wrap: (base) =>
        failing(
          base,
          (request) => request.type === 'data.mutate' && request.ops.some((op) => op.type === 'identity.delete'),
        ),
    })
    await user.click(await screen.findByRole('button', { name: 'Acciones de Trabajo' }))
    await user.click(screen.getByRole('menuitem', { name: 'Borrar identidad' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Borrar la identidad y sus 2 cuentas' }))
    const alert = await within(dialog).findByRole('alert')
    expect(alert.textContent).toContain(es['error.internal'])
    expect(alert.textContent).toContain(es['hint.storage_write'])
    expect(await client.send({ type: 'bindings.get' })).toEqual({ ok: true, result: { bindings: BOUND } })
    const data = await storedData(client)
    expect(data.identities.map((i) => i.id)).toEqual(['ana'])
    expect(data.accounts).toHaveLength(2)
    // El diálogo sigue abierto para poder reintentar.
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('si no se puede quitar el vínculo, no se borra nada y se muestra el error', async () => {
    const { user, client } = setup({
      identities: [identity('ana', 'Trabajo')],
      accounts: [account('a1', 'ana', 'Alfa')],
      mode: 'multi',
      bindings: BOUND,
      wrap: (base) => failing(base, (request) => request.type === 'bindings.set'),
    })
    await user.click(await screen.findByRole('button', { name: 'Acciones de Trabajo' }))
    await user.click(screen.getByRole('menuitem', { name: 'Borrar identidad' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Borrar la identidad y su cuenta' }))
    const alert = await within(dialog).findByRole('alert')
    expect(alert.textContent).toContain(es['error.internal'])
    expect(await client.send({ type: 'bindings.get' })).toEqual({ ok: true, result: { bindings: BOUND } })
    const data = await storedData(client)
    expect(data.identities.map((i) => i.id)).toEqual(['ana'])
    expect(data.accounts.map((a) => a.id)).toEqual(['a1'])
  })

  it('el fallo al guardar se muestra en el diálogo, que sigue abierto', async () => {
    const { user, t } = setup({ identities: [identity('ana', 'Trabajo')] })
    await user.click(await screen.findByRole('button', { name: 'Añadir identidad' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('Nombre'), 'Otra')
    t.local.failNextSet()
    await user.click(within(dialog).getByRole('button', { name: 'Crear identidad' }))
    const alert = await within(dialog).findByRole('alert')
    expect(alert.textContent).toContain(es['error.internal'])
    expect(alert.textContent).toContain(es['hint.storage_write'])
    expect(screen.getByRole('dialog')).toBeTruthy()
  })
})

describe('grupos y vistas', () => {
  const seed: Seed = {
    identities: [identity('ana', 'Trabajo'), identity('bea', 'Personal', { order: 1 })],
    groups: [group('g1', 'Correo')],
    accounts: [account('a1', 'ana', 'Alfa', { groupId: 'g1' }), account('b1', 'bea', 'Beta', { groupId: null })],
  }

  it('el interruptor Identidad/Grupo guarda settings.defaultView y cambia las secciones', async () => {
    const { user, client } = setup(seed)
    await screen.findByRole('heading', { name: 'Trabajo' })
    expect(screen.getByRole('button', { name: 'Identidad' }).getAttribute('aria-pressed')).toBe('true')
    await user.click(screen.getByRole('button', { name: 'Grupo' }))
    await screen.findByRole('heading', { name: 'Correo' })
    expect(screen.getByRole('heading', { name: 'Sin grupo' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Trabajo' })).toBeNull()
    expect((await storedData(client)).settings.defaultView).toBe('group')
    expect(screen.getByRole('button', { name: 'Grupo' }).getAttribute('aria-pressed')).toBe('true')
    await user.click(screen.getByRole('button', { name: 'Identidad' }))
    await screen.findByRole('heading', { name: 'Trabajo' })
    expect((await storedData(client)).settings.defaultView).toBe('identity')
  })

  it('en la vista por grupo cada tarjeta indica la identidad a la que pertenece', async () => {
    const { user } = setup(seed)
    await user.click(await screen.findByRole('button', { name: 'Grupo' }))
    const section = (await screen.findByRole('heading', { name: 'Correo' })).closest('section')
    if (section === null) throw new Error('falta la sección')
    expect(within(section).getByText('Trabajo')).toBeTruthy()
  })

  it('crea un grupo y lo borra: sus cuentas pasan a "Sin grupo"', async () => {
    const { user, client } = setup(seed)
    await user.click(await screen.findByRole('button', { name: 'Añadir grupo' }))
    const dialog = await screen.findByRole('dialog', { name: 'Nuevo grupo' })
    await user.type(within(dialog).getByLabelText('Nombre'), 'Código')
    await user.click(within(dialog).getByRole('button', { name: 'Crear grupo' }))
    await waitFor(async () => {
      expect((await storedData(client)).groups.map((g) => g.name)).toContain('Código')
    })
    await user.click(screen.getByRole('button', { name: 'Grupo' }))
    await user.click(await screen.findByRole('button', { name: 'Acciones de Correo' }))
    await user.click(screen.getByRole('menuitem', { name: 'Borrar grupo' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Borrar grupo' }))
    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'Correo' })).toBeNull()
    })
    const data = await storedData(client)
    expect(data.groups.map((g) => g.name)).toEqual(['Código'])
    expect(data.accounts.find((a) => a.id === 'a1')?.groupId).toBeNull()
  })

  it('edita una identidad desde el menú de su sección', async () => {
    const { user, client } = setup(seed)
    await user.click(await screen.findByRole('button', { name: 'Acciones de Trabajo' }))
    await user.click(screen.getByRole('menuitem', { name: 'Editar identidad' }))
    const dialog = await screen.findByRole('dialog', { name: 'Editar identidad' })
    const name = within(dialog).getByLabelText('Nombre')
    await user.clear(name)
    await user.type(name, 'Oficina')
    await user.click(within(dialog).getByRole('button', { name: 'Guardar cambios' }))
    expect(await screen.findByRole('heading', { name: 'Oficina' })).toBeTruthy()
    expect((await storedData(client)).identities.find((i) => i.id === 'ana')?.label).toBe('Oficina')
  })

  it('añadir cuenta desde una sección preselecciona su identidad', async () => {
    const { user } = setup(seed)
    await user.click(await screen.findByRole('button', { name: 'Acciones de Personal' }))
    await user.click(screen.getByRole('menuitem', { name: 'Añadir cuenta aquí' }))
    const dialog = await screen.findByRole('dialog', { name: 'Añadir cuenta' })
    expect(within(dialog).getByLabelText<HTMLSelectElement>('Identidad').value).toBe('bea')
  })
})

describe('idioma, tema y cambios externos', () => {
  it('cambiar el idioma a inglés traduce la interfaz y fija <html lang>', async () => {
    const { t } = setup({ identities: [identity('ana', 'Trabajo')] })
    expect(await screen.findByRole('button', { name: 'Buscar' })).toBeTruthy()
    expect(document.documentElement.lang).toBe('es')
    await t.route({ type: 'data.mutate', revision: 0, ops: [{ type: 'settings.set', settings: { language: 'en' } }] })
    expect(await screen.findByRole('button', { name: 'Search' })).toBeTruthy()
    expect(document.documentElement.lang).toBe('en')
    expect(screen.getByRole('button', { name: 'Add account' })).toBeTruthy()
  })

  it('el tema oscuro pone data-theme="dark"', async () => {
    const { t } = setup({ identities: [identity('ana', 'Trabajo')] })
    await screen.findByRole('heading', { name: 'Trabajo' })
    await t.route({ type: 'data.mutate', revision: 0, ops: [{ type: 'settings.set', settings: { theme: 'dark' } }] })
    await waitFor(() => {
      expect(document.documentElement.dataset.theme).toBe('dark')
    })
  })

  it('con el idioma automático sigue el del navegador', async () => {
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('en-GB')
    setup({ identities: [identity('ana', 'Trabajo')] })
    expect(await screen.findByRole('button', { name: 'Search' })).toBeTruthy()
    expect(document.documentElement.lang).toBe('en')
  })

  it('un cambio hecho por otro cliente aparece sin recargar', async () => {
    const { t } = setup({ identities: [identity('ana', 'Trabajo')] })
    await screen.findByRole('heading', { name: 'Trabajo' })
    const added = await t.route({
      type: 'data.mutate',
      revision: 1,
      ops: [{ type: 'identity.put', identity: identity('bea', 'Personal', { order: 1 }) }],
    })
    expect(added.ok).toBe(true)
    expect(await screen.findByRole('heading', { name: 'Personal' })).toBeTruthy()
  })
})

describe('avisos de contexto compartido y destinos', () => {
  it('dos cuentas de Claude de identidades distintas en Perfil único muestran el aviso con la otra etiqueta', async () => {
    setup({
      identities: [identity('ana', 'Trabajo'), identity('bea', 'Personal', { order: 1 })],
      accounts: [
        account('c1', 'ana', 'Claude trabajo', { serviceId: 'claude' }),
        account('c2', 'bea', 'Claude personal', { serviceId: 'claude' }),
      ],
    })
    expect(await screen.findByText('Comparte sesión con «Claude personal»')).toBeTruthy()
    expect(screen.getByText('Comparte sesión con «Claude trabajo»')).toBeTruthy()
  })

  it('dos cuentas de Gmail no muestran aviso: admiten sesiones en paralelo', async () => {
    setup({
      identities: [identity('ana', 'Trabajo'), identity('bea', 'Personal', { order: 1 })],
      accounts: [
        account('m1', 'ana', 'Gmail trabajo', { serviceId: 'google.gmail' }),
        account('m2', 'bea', 'Gmail personal', { serviceId: 'google.gmail' }),
      ],
    })
    await screen.findByRole('button', { name: 'Gmail personal' })
    expect(screen.queryByText(/Comparte sesión/)).toBeNull()
  })

  it('el aviso nombra hasta tres cuentas y cuenta el resto', async () => {
    const ids = ['ana', 'bea', 'cy', 'dan', 'eva']
    setup({
      identities: ids.map((id, i) => identity(id, id.toUpperCase(), { order: i })),
      accounts: ids.map((id, i) => account(`c${String(i)}`, id, `Claude ${id}`, { serviceId: 'claude' })),
    })
    expect(await screen.findAllByText(/Comparte sesión con/)).toHaveLength(5)
    expect(screen.getByText('Comparte sesión con «Claude bea», «Claude cy», «Claude dan» y 1 más')).toBeTruthy()
  })

  it('en Varios perfiles la cabecera de la sección dice en qué perfil abre', async () => {
    setup({
      identities: [identity('ana', 'Trabajo')],
      accounts: [account('a1', 'ana', 'Alfa')],
      mode: 'multi',
      bindings: { ana: { kind: 'chromium-profile', profileDirectory: 'Profile 1' } },
      host: { profiles: [{ directory: 'Profile 1', name: 'Trabajo', isUsingDefaultName: false }] },
    })
    expect(await screen.findByText('Abre en el perfil «Trabajo»')).toBeTruthy()
  })

  it('en Perfil único no se muestra ningún destino', async () => {
    setup({ identities: [identity('ana', 'Trabajo')], accounts: [account('a1', 'ana', 'Alfa')] })
    await screen.findByRole('button', { name: 'Alfa' })
    expect(screen.queryByText(/Esta ventana/)).toBeNull()
    expect(screen.queryByText(/Abre en el perfil/)).toBeNull()
  })

  it('una cuenta que abre en "esta ventana" dentro de una identidad vinculada lo indica en su tarjeta', async () => {
    setup({
      identities: [identity('ana', 'Trabajo')],
      accounts: [account('a1', 'ana', 'Alfa'), account('a2', 'ana', 'Beta', { contextOverride: 'current', order: 1 })],
      mode: 'multi',
      bindings: { ana: { kind: 'chromium-profile', profileDirectory: 'Profile 1' } },
    })
    const beta = (await screen.findByRole('button', { name: 'Beta' })).closest('li')
    if (beta === null) throw new Error('falta la tarjeta')
    expect(within(beta).getByText('Esta ventana')).toBeTruthy()
    const alfa = screen.getByRole('button', { name: 'Alfa' }).closest('li')
    if (alfa === null) throw new Error('falta la tarjeta')
    expect(within(alfa).queryByText(/Esta ventana|Abre en el perfil/)).toBeNull()
  })

  it('en Varios perfiles con el host ausente, abrir una cuenta vinculada muestra el error de host_missing', async () => {
    const { user } = setup({
      identities: [identity('ana', 'Trabajo')],
      accounts: [account('a1', 'ana', 'Alfa')],
      mode: 'multi',
      bindings: { ana: { kind: 'chromium-profile', profileDirectory: 'Profile 1' } },
      hostMode: 'missing',
    })
    await user.click(await screen.findByRole('button', { name: 'Alfa' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain(es['error.host_missing'])
    // El aviso se puede descartar.
    await user.click(within(alert).getByRole('button', { name: 'Descartar' }))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('"Abrir como…" abre la cuenta en el perfil de la otra identidad', async () => {
    const { user, fake } = setup({
      identities: [identity('ana', 'Trabajo'), identity('bea', 'Personal', { order: 1 })],
      accounts: [account('a1', 'ana', 'Alfa')],
      mode: 'multi',
      bindings: {
        ana: { kind: 'chromium-profile', profileDirectory: 'Profile 1' },
        bea: { kind: 'chromium-profile', profileDirectory: 'Default' },
      },
    })
    await user.click(await screen.findByRole('button', { name: 'Acciones de Alfa' }))
    expect(screen.queryByRole('menuitem', { name: 'Abrir como «Trabajo»' })).toBeNull()
    await user.click(screen.getByRole('menuitem', { name: 'Abrir como «Personal»' }))
    await waitFor(() => {
      expect(fake?.state.launches).toEqual([{ cmd: 'open', profileDirectory: 'Default', url: 'https://github.com/' }])
    })
  })

  it('la identidad propia va primera en la vista por identidad', async () => {
    setup({
      identities: [identity('ana', 'Trabajo'), identity('bea', 'Personal', { order: 1 })],
      mode: 'multi',
      ownProfileDirectory: 'Default',
    })
    const headings = await screen.findAllByRole('heading', { level: 2 })
    expect(headings.map((h) => h.textContent)).toEqual(['Trabajo', 'Personal'])
  })
})

describe('errores de carga y accesibilidad', () => {
  it('datos dañados muestran el error con su pista y un botón para reintentar', async () => {
    const t = createTestEnv({ local: { localData: { dañado: true } } })
    render(<App client={createRouterClient(t)} />)
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain(es['error.internal'])
    expect(alert.textContent).toContain(es['hint.local_data_invalid'])
    expect(within(alert).getByRole('button', { name: 'Reintentar' })).toBeTruthy()
  })

  it('Escape cierra el diálogo y el foco vuelve al botón que lo abrió', async () => {
    const { user } = setup({ identities: [identity('ana', 'Trabajo')] })
    const opener = await screen.findByRole('button', { name: 'Añadir grupo' })
    await user.click(opener)
    await screen.findByRole('dialog')
    await user.keyboard('{Escape}')
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
    expect(document.activeElement).toBe(opener)
  })

  it('el menú de una cuenta se maneja con el teclado', async () => {
    const { user } = setup({
      identities: [identity('ana', 'Trabajo'), identity('bea', 'Personal', { order: 1 })],
      accounts: [account('a1', 'ana', 'Alfa')],
    })
    const trigger = await screen.findByRole('button', { name: 'Acciones de Alfa' })
    trigger.focus()
    await user.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Editar' }))
    await user.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Abrir como «Personal»' }))
    await user.keyboard('{End}')
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Borrar' }))
    await user.keyboard('{Home}')
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Editar' }))
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('ningún botón tiene nombre accesible vacío y cada diálogo tiene nombre', async () => {
    const { user } = setup({
      identities: [identity('ana', 'Trabajo')],
      accounts: [account('a1', 'ana', 'Alfa')],
    })
    await screen.findByRole('button', { name: 'Alfa' })
    const named = (): void => {
      expect(screen.getAllByRole('button')).toHaveLength(screen.getAllByRole('button', { name: /\S/ }).length)
    }
    named()
    await user.click(screen.getByRole('button', { name: 'Acciones de Alfa' }))
    named()
    await user.click(screen.getByRole('menuitem', { name: 'Editar' }))
    await screen.findByRole('dialog')
    named()
    expect(screen.getAllByRole('dialog')).toHaveLength(screen.getAllByRole('dialog', { name: /\S/ }).length)
  })

  it('los avisos van en una región aria-live polite', async () => {
    setup({ identities: [identity('ana', 'Trabajo')] })
    await screen.findByRole('heading', { name: 'Trabajo' })
    expect(document.querySelector('[aria-live="polite"]')).not.toBeNull()
  })
})
