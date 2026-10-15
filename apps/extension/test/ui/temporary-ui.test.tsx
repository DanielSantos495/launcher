// @vitest-environment happy-dom
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { en } from '../../src/i18n/messages.en'
import { es } from '../../src/i18n/messages.es'
import { createTestEnv } from '../helpers/env'
import { createFakeHost, type FakeHost, type FakeHostOptions } from '../helpers/fake-host'
import { localOf, makeAccount, makeIdentity, mount } from '../helpers/ui-setup'

let fake: FakeHost

interface Options {
  readonly host?: FakeHostOptions
  readonly mode?: 'single' | 'multi'
  readonly ownProfileDirectory?: string | null
}

// Dashboard con una cuenta de GitHub («Alfa») en Varios perfiles; el perfil propio es Default salvo que se diga lo contrario.
async function open(options: Options = {}) {
  fake = createFakeHost(options.host)
  const t = createTestEnv({
    host: fake,
    local: localOf({
      mode: options.mode ?? 'multi',
      identities: [makeIdentity('ana', 'Trabajo')],
      accounts: [makeAccount('a1', 'ana', 'Alfa')],
      ...(options.ownProfileDirectory === null
        ? {}
        : { ownProfileDirectory: options.ownProfileDirectory ?? 'Default' }),
    }),
  })
  const mounted = mount(t)
  await screen.findByRole('button', { name: 'Alfa' })
  return { t, ...mounted }
}

const temporaryLaunches = (): unknown[] => fake.state.launches.filter((launch) => launch.cmd === 'openTemporary')

beforeEach(() => {
  vi.spyOn(navigator, 'language', 'get').mockReturnValue('es-ES')
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  expect(fake.invalidRequests).toBe(0)
})

describe('disponibilidad', () => {
  it('en Brave el menú de la cuenta y la cabecera ofrecen el contenedor temporal', async () => {
    const { user } = await open()
    await user.click(await screen.findByRole('button', { name: 'Acciones de Alfa' }))
    expect(screen.getByRole('menuitem', { name: 'Abrir en un contenedor temporal (aislado)' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Abrir una URL aislada' })).toBeTruthy()
  })

  it('en Chrome no aparece ni en el menú ni en la cabecera', async () => {
    const { user } = await open({ host: { browser: 'chrome' } })
    await user.click(await screen.findByRole('button', { name: 'Acciones de Alfa' }))
    expect(screen.getByRole('menuitem', { name: 'Editar' })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: /contenedor temporal/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Abrir una URL aislada' })).toBeNull()
  })

  it('en Brave sin la función del programa, o en Perfil único, tampoco aparece', async () => {
    const { user } = await open({ host: { temporaryContainer: false } })
    await user.click(await screen.findByRole('button', { name: 'Acciones de Alfa' }))
    expect(screen.queryByRole('menuitem', { name: /contenedor temporal/ })).toBeNull()
    cleanup()

    const single = await open({ mode: 'single' })
    await single.user.click(await screen.findByRole('button', { name: 'Acciones de Alfa' }))
    expect(screen.queryByRole('menuitem', { name: /contenedor temporal/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Abrir una URL aislada' })).toBeNull()
  })
})

describe('abrir una URL aislada', () => {
  async function openUrlDialog() {
    const opened = await open()
    await opened.user.click(await screen.findByRole('button', { name: 'Abrir una URL aislada' }))
    const dialog = await screen.findByRole('dialog', { name: 'Abrir una URL aislada' })
    return { ...opened, dialog }
  }

  it('javascript:x se rechaza con el texto de hint.url_scheme y no lanza nada', async () => {
    const { user, dialog } = await openUrlDialog()
    await user.type(within(dialog).getByLabelText('Dirección web'), 'javascript:x')
    await user.click(within(dialog).getByRole('button', { name: 'Abrir' }))
    expect((await within(dialog).findByRole('alert')).textContent).toContain(es['hint.url_scheme'])
    expect(temporaryLaunches()).toEqual([])
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('una URL y un nombre lanzan el contenedor con ese nombre en el perfil propio', async () => {
    const { user, dialog } = await openUrlDialog()
    await user.type(within(dialog).getByLabelText('Dirección web'), 'https://example.com/')
    await user.type(within(dialog).getByLabelText('Nombre (opcional)'), 'Banco')
    await user.click(within(dialog).getByRole('button', { name: 'Abrir' }))
    await waitFor(() => {
      expect(temporaryLaunches()).toEqual([
        { cmd: 'openTemporary', profileDirectory: 'Default', url: 'https://example.com/', name: 'Banco' },
      ])
    })
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
    expect(screen.getByText('Abierto en un contenedor temporal.')).toBeTruthy()
  })

  it('sin nombre el lanzamiento no lleva name, y los espacios del nombre no cuentan', async () => {
    const { user, dialog } = await openUrlDialog()
    await user.type(within(dialog).getByLabelText('Dirección web'), 'https://example.com/')
    await user.type(within(dialog).getByLabelText('Nombre (opcional)'), '   ')
    await user.click(within(dialog).getByRole('button', { name: 'Abrir' }))
    await waitFor(() => {
      expect(temporaryLaunches()).toEqual([
        { cmd: 'openTemporary', profileDirectory: 'Default', url: 'https://example.com/' },
      ])
    })
  })

  it('un nombre como -x es un error del campo y no envía nada', async () => {
    const { user, dialog } = await openUrlDialog()
    await user.type(within(dialog).getByLabelText('Dirección web'), 'https://example.com/')
    const name = within(dialog).getByLabelText('Nombre (opcional)')
    await user.type(name, '-x')
    await user.click(within(dialog).getByRole('button', { name: 'Abrir' }))
    expect(within(dialog).getByText(es['temporary.name.invalid'])).toBeTruthy()
    expect(name.getAttribute('aria-invalid')).toBe('true')
    expect(fake.requests.filter((request) => request.cmd === 'openTemporary')).toEqual([])
    // El nombre válido más largo (64) pasa y uno de 65 no.
    await user.clear(name)
    await user.type(name, 'a'.repeat(65))
    await user.click(within(dialog).getByRole('button', { name: 'Abrir' }))
    expect(within(dialog).getByText(es['temporary.name.invalid'])).toBeTruthy()
    expect(fake.requests.filter((request) => request.cmd === 'openTemporary')).toEqual([])
  })

  it('una dirección vacía pide escribirla', async () => {
    const { user, dialog } = await openUrlDialog()
    await user.click(within(dialog).getByRole('button', { name: 'Abrir' }))
    expect(within(dialog).getByText(es['field.required'])).toBeTruthy()
    expect(fake.requests.filter((request) => request.cmd === 'openTemporary')).toEqual([])
  })

  it('un nombre ya usado por un contenedor persistente muestra el texto de name_in_use', async () => {
    fake = createFakeHost({ persistentContainers: { Default: ['Banco'] } })
    const t = createTestEnv({
      host: fake,
      local: localOf({
        mode: 'multi',
        identities: [makeIdentity('ana', 'Trabajo')],
        ownProfileDirectory: 'Default',
      }),
    })
    const { user } = mount(t)
    await user.click(await screen.findByRole('button', { name: 'Abrir una URL aislada' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('Dirección web'), 'https://example.com/')
    await user.type(within(dialog).getByLabelText('Nombre (opcional)'), 'banco')
    await user.click(within(dialog).getByRole('button', { name: 'Abrir' }))
    expect((await within(dialog).findByRole('alert')).textContent).toContain(es['error.name_in_use'])
  })
})

describe('abrir una cuenta en un contenedor temporal', () => {
  it('desde el menú de la cuenta: sin campo de dirección y con la URL de la cuenta', async () => {
    const { user } = await open()
    await user.click(await screen.findByRole('button', { name: 'Acciones de Alfa' }))
    await user.click(screen.getByRole('menuitem', { name: 'Abrir en un contenedor temporal (aislado)' }))
    const dialog = await screen.findByRole('dialog', { name: 'Contenedor temporal para «Alfa»' })
    expect(within(dialog).queryByLabelText('Dirección web')).toBeNull()
    await user.click(within(dialog).getByRole('button', { name: 'Abrir' }))
    await waitFor(() => {
      expect(temporaryLaunches()).toEqual([
        { cmd: 'openTemporary', profileDirectory: 'Default', url: 'https://github.com/' },
      ])
    })
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
  })

  it('sin perfil propio declarado, el diálogo pide declararlo primero y no envía nada', async () => {
    const { user } = await open({ ownProfileDirectory: null })
    await user.click(await screen.findByRole('button', { name: 'Abrir una URL aislada' }))
    const dialog = await screen.findByRole('dialog', { name: 'Abrir una URL aislada' })
    expect(within(dialog).getByText(es['temporary.declareFirst'])).toBeTruthy()
    expect(within(dialog).queryByLabelText('Dirección web')).toBeNull()
    expect(within(dialog).queryByRole('button', { name: 'Abrir' })).toBeNull()
    await user.click(within(dialog).getByRole('button', { name: 'Cerrar' }))
    expect(fake.requests.filter((request) => request.cmd === 'openTemporary')).toEqual([])
  })
})

describe('texto del diálogo (T13)', () => {
  it('dice "aislado" y nunca que se borra al cerrar', async () => {
    const { user } = await open()
    await user.click(await screen.findByRole('button', { name: 'Abrir una URL aislada' }))
    const dialog = await screen.findByRole('dialog')
    const text = dialog.textContent.toLowerCase()
    expect(text).toContain('aislado')
    expect(text).not.toContain('se borra')
    expect(text).not.toContain('borra al cerrar')
    expect(text).toContain('brave guarda sus datos en disco')
    expect(text).toContain('no inicies sesión en cuentas importantes')
  })

  it('ninguna cadena de la interfaz, en español o en inglés, promete borrar al cerrar', () => {
    const forbidden =
      /se borra(n)? al cerrar|borra al cerrar|deleted (when|on) clos|deletes (when|on) clos|erased (when|on) clos/i
    for (const [key, text] of [...Object.entries(es), ...Object.entries(en)]) {
      expect(text, key).not.toMatch(forbidden)
    }
    expect(en['temporary.explain']).toMatch(/isolated/)
  })
})
