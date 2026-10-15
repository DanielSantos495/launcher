// @vitest-environment happy-dom
import type { LauncherData } from '@account-launcher/core'
import { MAX_SHARED_DATA_BYTES } from '@account-launcher/protocol'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { jsonBytes } from '../../src/storage/usage'
import { dataOfBytes } from '../helpers/data-of-bytes'
import { createTestEnv, type TestEnv } from '../helpers/env'
import { createFakeHost, type FakeHost } from '../helpers/fake-host'
import { dataWith, pairedLocal, registerInstallation, TOKEN_A } from '../helpers/shared-setup'
import { dataOf, localOf, makeAccount, makeIdentity, mount, storedData } from '../helpers/ui-setup'

let fake: FakeHost

// Instalación inst-1 emparejada en Varios perfiles; el almacén compartido guarda `shared` y los datos locales son `local`.
function pairedEnv(shared: unknown, local: LauncherData = dataWith('multi')): TestEnv {
  fake = createFakeHost()
  registerInstallation(fake, 'inst-1', TOKEN_A)
  fake.state.store = { revision: 1, data: shared, bindings: {} }
  return createTestEnv({ host: fake, local: pairedLocal('inst-1', TOKEN_A, local) })
}

const withView = (data: LauncherData, defaultView: 'identity' | 'group'): LauncherData => ({
  ...data,
  settings: { ...data.settings, defaultView },
})

async function openSettings(t: TestEnv) {
  const mounted = mount(t)
  await mounted.user.click(await screen.findByRole('button', { name: 'Configuración' }))
  await screen.findByRole('heading', { name: 'Almacenamiento' })
  return mounted
}

beforeEach(() => {
  vi.spyOn(navigator, 'language', 'get').mockReturnValue('es-ES')
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  expect(fake.invalidRequests).toBe(0)
})

describe('medidor de almacenamiento', () => {
  it('al 96 % del almacén compartido: valores del medidor y aviso de casi lleno', async () => {
    const t = pairedEnv(dataOfBytes(Math.ceil(0.96 * MAX_SHARED_DATA_BYTES)))
    const { client } = await openSettings(t)
    const shown = await storedData(client)
    const meter = screen.getByRole('meter', { name: 'Almacenamiento' })
    expect(meter.getAttribute('aria-valuemin')).toBe('0')
    expect(meter.getAttribute('aria-valuemax')).toBe(String(MAX_SHARED_DATA_BYTES))
    expect(meter.getAttribute('aria-valuenow')).toBe(String(jsonBytes(shown)))
    expect(Number(meter.getAttribute('aria-valuenow'))).toBeGreaterThanOrEqual(Math.ceil(0.95 * MAX_SHARED_DATA_BYTES))
    expect(screen.getByText('491,5 KB de 512,0 KB')).toBeTruthy()
    expect(meter.getAttribute('aria-valuetext')).toBe('491,5 KB de 512,0 KB')
    expect(screen.getByText('El almacén compartido está casi lleno')).toBeTruthy()
    expect(screen.queryByText('El almacén compartido se está llenando')).toBeNull()
  })

  it('entre el 80 % y el 95 % avisa de que se está llenando; por debajo no avisa de nada', async () => {
    const t = pairedEnv(dataOfBytes(Math.ceil(0.85 * MAX_SHARED_DATA_BYTES)))
    await openSettings(t)
    expect(screen.getByText('El almacén compartido se está llenando')).toBeTruthy()
    expect(screen.queryByText('El almacén compartido está casi lleno')).toBeNull()
    cleanup()

    const low = pairedEnv(dataOfBytes(Math.ceil(0.5 * MAX_SHARED_DATA_BYTES)))
    await openSettings(low)
    expect(screen.queryByText(/El almacén compartido (se está llenando|está casi lleno)/)).toBeNull()
    expect(screen.getByRole('meter').getAttribute('aria-valuemax')).toBe(String(MAX_SHARED_DATA_BYTES))
  })

  it('con datos locales mide contra la cuota de 10 MiB y no avisa del almacén compartido', async () => {
    fake = createFakeHost()
    const t = createTestEnv({ local: localOf({ identities: [makeIdentity('ana', 'Ana')] }) })
    await openSettings(t)
    const meter = screen.getByRole('meter')
    expect(meter.getAttribute('aria-valuemax')).toBe('10485760')
    expect(screen.queryByText(/almacén compartido/)).toBeNull()
  })
})

describe('el almacén compartido se llena', () => {
  // Datos de MAX_SHARED_DATA_BYTES - 2 bytes con la vista por grupo: pasar a la vista por identidad suma 3 bytes.
  const nearlyFull = (): LauncherData => withView(dataOfBytes(MAX_SHARED_DATA_BYTES + 1), 'group')

  it('un cambio que lo supera muestra el aviso de almacén lleno con el medidor, y se puede descartar', async () => {
    const t = pairedEnv(nearlyFull())
    const { user } = mount(t)
    await user.click(await screen.findByRole('button', { name: 'Identidad' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain(
      'El almacén compartido está lleno (512 KB). Borra cuentas o acorta notas largas para seguir guardando cambios.',
    )
    expect(within(alert).getByRole('meter').getAttribute('aria-valuemax')).toBe(String(MAX_SHARED_DATA_BYTES))
    expect(within(alert).queryByRole('button', { name: 'Reintentar' })).toBeNull()
    await user.click(within(alert).getByRole('button', { name: 'Descartar' }))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('un formulario que lo supera enseña el aviso en el propio diálogo', async () => {
    const t = pairedEnv(nearlyFull())
    const { user } = mount(t)
    await user.click(await screen.findByRole('button', { name: 'Añadir grupo' }))
    const dialog = await screen.findByRole('dialog', { name: 'Nuevo grupo' })
    await user.type(within(dialog).getByLabelText('Nombre'), 'Un grupo más')
    await user.click(within(dialog).getByRole('button', { name: 'Crear grupo' }))
    expect((await within(dialog).findByRole('alert')).textContent).toContain('El almacén compartido está lleno')
  })
})

describe('problemas con la lista compartida', () => {
  const local = (): LauncherData =>
    dataOf({
      mode: 'multi',
      identities: [makeIdentity('ana', 'Trabajo')],
      accounts: [makeAccount('a1', 'ana', 'Cuenta local')],
    })

  it('datos de una versión más nueva: aviso con Reintentar y Usar Perfil único; este último muestra la lista local', async () => {
    const t = pairedEnv({ ...dataWith('multi'), schemaVersion: 2 }, local())
    const { user, client } = mount(t)
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain(
      'La lista compartida es de una versión más nueva de la extensión: actualízala en este perfil',
    )
    expect(within(alert).getByRole('button', { name: 'Reintentar' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Cuenta local' })).toBeNull()

    await user.click(within(alert).getByRole('button', { name: 'Usar Perfil único' }))
    expect(await screen.findByRole('button', { name: 'Cuenta local' })).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
    expect((await storedData(client)).settings.mode).toBe('single')
  })

  it('Reintentar vuelve a leer la lista y se recupera cuando el programa ya la tiene bien', async () => {
    const shared = dataOf({
      mode: 'multi',
      identities: [makeIdentity('ana', 'Compartida')],
      accounts: [makeAccount('s1', 'ana', 'Cuenta compartida')],
    })
    const t = pairedEnv({ ...shared, schemaVersion: 2 }, local())
    const { user } = mount(t)
    const alert = await screen.findByRole('alert')
    await user.click(within(alert).getByRole('button', { name: 'Reintentar' }))
    // Sigue igual mientras el programa tenga los datos de la versión más nueva.
    expect((await screen.findByRole('alert')).textContent).toContain('versión más nueva')

    if (fake.state.store === undefined) throw new Error('falta el almacén')
    fake.state.store.data = shared
    await user.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByRole('button', { name: 'Cuenta compartida' })).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('datos o vínculos dañados: la lista compartida está dañada', async () => {
    const t = pairedEnv({ schemaVersion: 1, dañado: true }, local())
    mount(t)
    expect((await screen.findByRole('alert')).textContent).toContain('La lista compartida está dañada')
    cleanup()

    const bindings = pairedEnv(dataWith('multi'), local())
    if (fake.state.store === undefined) throw new Error('falta el almacén')
    fake.state.store.bindings = { ana: { kind: 'desconocido' } }
    mount(bindings)
    expect((await screen.findByRole('alert')).textContent).toContain('La lista compartida está dañada')
  })

  it('emparejada, con el programa ausente y sin caché: no se puede leer la lista; Usar Perfil único funciona', async () => {
    const t = pairedEnv(dataWith('multi'), local())
    fake.mode = 'missing'
    const { user } = mount(t)
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('No se puede leer la lista compartida: el programa no responde')
    await user.click(within(alert).getByRole('button', { name: 'Reintentar' }))
    expect((await screen.findByRole('alert')).textContent).toContain('el programa no responde')
    await user.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Usar Perfil único' }))
    expect(await screen.findByRole('button', { name: 'Cuenta local' })).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('un fallo del programa sin emparejar no es un problema de la lista compartida', async () => {
    fake = createFakeHost()
    fake.mode = 'missing'
    const t = createTestEnv({
      host: fake,
      local: localOf({
        mode: 'multi',
        identities: [makeIdentity('ana', 'Trabajo')],
        accounts: [makeAccount('a1', 'ana', 'Alfa')],
        bindings: { ana: { kind: 'chromium-profile', profileDirectory: 'Default' } },
      }),
    })
    const { user } = mount(t)
    await user.click(await screen.findByRole('button', { name: 'Alfa' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).not.toContain('lista compartida')
    expect(within(alert).queryByRole('button', { name: 'Usar Perfil único' })).toBeNull()
  })
})

describe('volver a Perfil único estando emparejada', () => {
  it('explica que se sigue viendo una copia de la lista compartida', async () => {
    const shared = dataOf({ mode: 'multi', identities: [makeIdentity('ana', 'Trabajo')] })
    const t = pairedEnv(shared, shared)
    const { user, client } = await openSettings(t)
    const note =
      'Seguirás viendo una copia de la lista compartida; los cambios no se sincronizan hasta que vuelvas a Varios perfiles'
    expect(screen.queryByText(note)).toBeNull()
    await user.click(screen.getByRole('radio', { name: 'Perfil único' }))
    expect(await screen.findByText(note)).toBeTruthy()
    await waitFor(async () => {
      expect((await storedData(client)).settings.mode).toBe('single')
    })
    // La nota desaparece al volver a Varios perfiles.
    await user.click(screen.getByRole('radio', { name: 'Varios perfiles' }))
    await waitFor(() => {
      expect(screen.queryByText(note)).toBeNull()
    })
  })

  it('sin emparejar no hay nota', async () => {
    fake = createFakeHost()
    const t = createTestEnv({ host: fake, local: localOf({ identities: [makeIdentity('ana', 'Trabajo')] }) })
    const { user } = await openSettings(t)
    await user.click(screen.getByRole('radio', { name: 'Varios perfiles' }))
    await user.click(await screen.findByRole('radio', { name: 'Perfil único' }))
    await waitFor(() => {
      expect(screen.getByRole<HTMLInputElement>('radio', { name: 'Perfil único' }).checked).toBe(true)
    })
    expect(screen.queryByText(/Seguirás viendo una copia/)).toBeNull()
  })
})
