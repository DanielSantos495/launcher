// @vitest-environment happy-dom
import { act, cleanup, waitFor, within } from '@testing-library/react'
import type { BoundFunctions, queries } from '@testing-library/dom'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { es } from '../../src/i18n/messages.es'
import { createTestEnv, EXTENSION_ID, type TestEnv } from '../helpers/env'
import { createFakeHost, type FakeHost } from '../helpers/fake-host'
import { dataWith, registerInstallation, TOKEN_B } from '../helpers/shared-setup'
import { mount } from '../helpers/ui-setup'

const START = new Date('2026-10-08T12:00:00.000Z')
const WHOAMI_URL = `chrome-extension://${EXTENSION_ID}/whoami.html`

// Consultas limitadas al contenedor de una de las instalaciones montadas.
type View = BoundFunctions<typeof queries>

let fake: FakeHost
let user: ReturnType<typeof userEvent.setup>

// R3: el reloj del service worker, el del host falso y los temporizadores de la prueba son el mismo. El tiempo real
// también avanza (shouldAdvanceTime) para que findBy y waitFor sigan funcionando con temporizadores falsos.
const clock = (): Date => new Date()

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(START)
  vi.spyOn(navigator, 'language', 'get').mockReturnValue('es-ES')
  user = userEvent.setup({
    advanceTimers: (ms) => {
      vi.advanceTimersByTime(ms)
    },
  })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  // Ninguna prueba debe haber enviado al host algo fuera del contrato.
  expect(fake.invalidRequests).toBe(0)
})

// Instalación en "Varios perfiles" con una identidad y, si se indica, el perfil declarado.
function installationEnv(id: string, identity: string, declared?: string, host: FakeHost = fake): TestEnv {
  return createTestEnv({
    host,
    now: clock,
    local: {
      installation: {
        installationId: id,
        paired: false,
        ...(declared === undefined ? {} : { ownProfileDirectory: declared }),
      },
      localData: dataWith('multi', [identity]),
    },
  })
}

// Monta el dashboard de una instalación y abre Configuración.
async function openSettings(t: TestEnv) {
  const mounted = mount(t, { user })
  const view = within(mounted.container)
  await user.click(await view.findByRole('button', { name: 'Configuración' }))
  await view.findByRole('heading', { name: 'Sincronización entre perfiles' })
  return { ...mounted, view }
}

// Avanza el reloj dentro de act, para que React pinte lo que cambian los temporizadores.
async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

async function activate(view: View): Promise<string> {
  await user.click(view.getByRole('button', { name: 'Activar sincronización' }))
  return (await view.findByText(/^\d{6}$/)).textContent
}

async function join(view: View, code: string): Promise<void> {
  await user.type(view.getByLabelText('Código de 6 dígitos'), code)
  await user.click(view.getByRole('button', { name: 'Unirse' }))
}

describe('emparejar y unirse', () => {
  it('A activa la sincronización: aparece un código de 6 dígitos con su cuenta atrás', async () => {
    fake = createFakeHost({ now: clock })
    const a = await openSettings(installationEnv('inst-a', 'ana'))
    const code = await activate(a.view)
    expect(code).toMatch(/^\d{6}$/)
    expect(await a.view.findByText('Emparejada')).toBeTruthy()
    expect(a.view.getByText('Caduca en 2:00')).toBeTruthy()
    await advance(1000)
    expect(a.view.getByText('Caduca en 1:59')).toBeTruthy()
    // La cuenta atrás es un temporizador, no una región que se anuncie cada segundo.
    expect(a.view.getByText('Caduca en 1:59').getAttribute('role')).toBe('timer')
    await advance(120_000)
    expect(a.view.getByText('El código ha caducado. Pide uno nuevo.')).toBeTruthy()
  })

  it('B escribe el código y queda emparejada; A, al actualizar, lista las dos instalaciones con "Este perfil" en la suya', async () => {
    fake = createFakeHost({ now: clock })
    const a = await openSettings(installationEnv('inst-a', 'ana'))
    const b = await openSettings(installationEnv('inst-b', 'ana'))
    const code = await activate(a.view)
    await join(b.view, code)
    expect(await b.view.findByText('Emparejada')).toBeTruthy()
    expect(b.view.queryByRole('button', { name: 'Activar sincronización' })).toBeNull()

    await user.click(a.view.getByRole('button', { name: 'Actualizar' }))
    const rows = await a.view.findAllByRole('listitem')
    const installations = rows.filter((row) => within(row).queryByRole('button', { name: /^Quitar / }) !== null)
    expect(installations).toHaveLength(2)
    const own = installations.filter((row) => within(row).queryByText('Este perfil') !== null)
    expect(own).toHaveLength(1)
    expect(within(own[0] as HTMLElement).getByText('Perfil 1')).toBeTruthy()
    expect(a.view.getByText('Hasta 2 perfiles')).toBeTruthy()
    expect(within(installations[0] as HTMLElement).getByText('Sin verificar')).toBeTruthy()
  })

  it('A quita a B; B, tras sync.refresh, vuelve a "sin emparejar"', async () => {
    fake = createFakeHost({ now: clock })
    const tB = installationEnv('inst-b', 'ana')
    const a = await openSettings(installationEnv('inst-a', 'ana'))
    const b = await openSettings(tB)
    await join(b.view, await activate(a.view))
    await b.view.findByText('Emparejada')

    await user.click(a.view.getByRole('button', { name: 'Actualizar' }))
    await user.click(await a.view.findByRole('button', { name: 'Quitar Perfil 2' }))
    const dialog = await a.view.findByRole('dialog', { name: 'Quitar «Perfil 2» del emparejamiento' })
    await user.click(within(dialog).getByRole('button', { name: 'Quitar perfil' }))
    await waitFor(() => {
      expect(a.view.queryByRole('button', { name: 'Quitar Perfil 2' })).toBeNull()
    })
    expect(fake.state.installations.map((i) => i.installationId)).toEqual(['inst-a'])

    await act(async () => {
      await tB.route({ type: 'sync.refresh' })
    })
    expect(await b.view.findByRole('button', { name: 'Activar sincronización' })).toBeTruthy()
    expect(b.view.queryByText('Emparejada')).toBeNull()
  })

  it('al emparejar, el perfil declarado antes se declara también en el programa', async () => {
    fake = createFakeHost({ now: clock })
    const a = await openSettings(installationEnv('inst-a', 'ana', 'Default'))
    const b = await openSettings(installationEnv('inst-b', 'ana', 'Profile 1'))
    await join(b.view, await activate(a.view))
    await b.view.findByText('Emparejada')
    // Tanto quien activa la sincronización como quien se une.
    const declared = fake.state.installations.map((i) => [i.installationId, i.profileDirectory])
    expect(declared).toEqual([
      ['inst-a', 'Default'],
      ['inst-b', 'Profile 1'],
    ])
  })

  it('un código incorrecto muestra el texto de bad_code y uno con el máximo alcanzado, el de limit_reached', async () => {
    fake = createFakeHost({ now: clock, maxPairedProfiles: 1 })
    const a = await openSettings(installationEnv('inst-a', 'ana'))
    const b = await openSettings(installationEnv('inst-b', 'ana'))
    const code = await activate(a.view)

    await join(b.view, '000000')
    expect((await b.view.findByRole('alert')).textContent).toContain(es['error.bad_code'])
    expect(b.view.queryByText('Emparejada')).toBeNull()

    await user.clear(b.view.getByLabelText('Código de 6 dígitos'))
    await join(b.view, code)
    await waitFor(() => {
      expect(b.view.getByRole('alert').textContent).toContain(es['error.limit_reached'])
    })
    expect(b.view.queryByText('Emparejada')).toBeNull()
  })

  it('un código con menos de 6 dígitos no se envía', async () => {
    fake = createFakeHost({ now: clock })
    const b = await openSettings(installationEnv('inst-b', 'ana'))
    await user.type(b.view.getByLabelText('Código de 6 dígitos'), '12a4')
    await user.click(b.view.getByRole('button', { name: 'Unirse' }))
    expect(b.view.getByText('Escribe los 6 dígitos del código.')).toBeTruthy()
    expect(fake.requests.filter((request) => request.cmd === 'pair.join')).toEqual([])
    const field = b.view.getByLabelText<HTMLInputElement>('Código de 6 dígitos')
    expect(field.inputMode).toBe('numeric')
    expect(field.maxLength).toBe(6)
  })

  it('pair.start sin token con el almacén ya creado explica que hay que unirse con un código', async () => {
    fake = createFakeHost({ now: clock })
    fake.state.store = { revision: 1, data: null, bindings: {} }
    registerInstallation(fake, 'inst-x', TOKEN_B)
    const a = await openSettings(installationEnv('inst-a', 'ana'))
    await user.click(a.view.getByRole('button', { name: 'Activar sincronización' }))
    expect(await a.view.findByText('Ya hay perfiles emparejados: únete con un código')).toBeTruthy()
    expect(a.view.queryByRole('alert')).toBeNull()
    expect(a.view.queryByText('Emparejada')).toBeNull()
  })

  it('"Emparejar otro perfil" con el máximo de perfiles muestra el texto de limit_reached y ningún código', async () => {
    fake = createFakeHost({ now: clock })
    const a = await openSettings(installationEnv('inst-a', 'ana'))
    const b = await openSettings(installationEnv('inst-b', 'ana'))
    await join(b.view, await activate(a.view))
    await b.view.findByText('Emparejada')
    // El primer código ya se usó: su panel sigue en pantalla hasta pedir otro.
    await user.click(a.view.getByRole('button', { name: 'Emparejar otro perfil' }))
    expect((await a.view.findByRole('alert')).textContent).toContain(es['error.limit_reached'])
  })

  it('"Emparejar otro perfil" emite un código nuevo cuando todavía cabe otro perfil', async () => {
    fake = createFakeHost({ now: clock, maxPairedProfiles: 3 })
    const a = await openSettings(installationEnv('inst-a', 'ana'))
    const first = await activate(a.view)
    await user.click(a.view.getByRole('button', { name: 'Emparejar otro perfil' }))
    await waitFor(() => {
      expect(a.view.getByText(/^\d{6}$/).textContent).not.toBe(first)
    })
  })
})

describe('Este perfil es…', () => {
  it('elegir Default y una identidad la declara y la deja visible', async () => {
    fake = createFakeHost({ now: clock })
    const t = installationEnv('inst-a', 'ana')
    const a = await openSettings(t)
    expect(a.view.getByText('Aún no has indicado qué perfil es este.')).toBeTruthy()
    await user.selectOptions(a.view.getByLabelText('Perfil del navegador'), 'Personal (Default)')
    await user.selectOptions(a.view.getByLabelText('Identidad de este perfil (opcional)'), 'ana')
    await user.click(a.view.getByRole('button', { name: 'Guardar cambios' }))
    expect(await a.view.findByText('Declarado: este perfil es «Personal» con la identidad «ana».')).toBeTruthy()
    expect(t.local.dump().installation).toEqual({
      installationId: 'inst-a',
      paired: false,
      ownProfileDirectory: 'Default',
      ownIdentityId: 'ana',
    })
    expect(a.view.getByLabelText<HTMLSelectElement>('Perfil del navegador').value).toBe('Default')
  })

  it('sin identidad solo declara el perfil, y no se puede guardar sin elegir uno', async () => {
    fake = createFakeHost({ now: clock })
    const t = installationEnv('inst-a', 'ana')
    const a = await openSettings(t)
    expect(a.view.getByRole<HTMLButtonElement>('button', { name: 'Guardar cambios' }).disabled).toBe(true)
    await user.selectOptions(a.view.getByLabelText('Perfil del navegador'), 'Persona 1 (Profile 1)')
    await user.click(a.view.getByRole('button', { name: 'Guardar cambios' }))
    expect(await a.view.findByText('Declarado: este perfil es «Persona 1».')).toBeTruthy()
    expect(t.local.dump().installation).toEqual({
      installationId: 'inst-a',
      paired: false,
      ownProfileDirectory: 'Profile 1',
    })
  })
})

describe('verificar este perfil', () => {
  // A y B emparejadas; A tiene declarado el perfil Default.
  async function pairedWithDeclared() {
    fake = createFakeHost({ now: clock })
    const tA = installationEnv('inst-a', 'ana', 'Default')
    const a = await openSettings(tA)
    await activate(a.view)
    return { a, tA }
  }

  it('sin perfil declarado el botón está desactivado y lo explica', async () => {
    fake = createFakeHost({ now: clock })
    const a = await openSettings(installationEnv('inst-a', 'ana'))
    await activate(a.view)
    expect(a.view.getByRole<HTMLButtonElement>('button', { name: 'Verificar este perfil' }).disabled).toBe(true)
    expect(a.view.getByText(es['hint.declare_profile'])).toBeTruthy()
  })

  it('si la página de verificación prueba el nonce, se ve "Verificado" y la lista lo recoge', async () => {
    const { a, tA } = await pairedWithDeclared()
    // La propia instalación prueba el nonce con su router, como hace la página whoami.
    fake.onVerify = (nonce) => {
      void tA.route({ type: 'whoami.prove', nonce }, WHOAMI_URL)
    }
    await user.click(a.view.getByRole('button', { name: 'Verificar este perfil' }))
    expect(await a.view.findByText('Verificando…')).toBeTruthy()
    expect(a.view.getByRole<HTMLButtonElement>('button', { name: 'Verificar este perfil' }).disabled).toBe(true)
    await advance(2000)
    expect(await a.view.findByText('Verificado')).toBeTruthy()
    expect(a.view.queryByText('Verificando…')).toBeNull()
    expect(await a.view.findByText(/^Verificado el /)).toBeTruthy()
  })

  it('sin prueba del nonce, a los 60 s dice que el perfil declarado no tiene la extensión emparejada', async () => {
    const { a } = await pairedWithDeclared()
    await user.click(a.view.getByRole('button', { name: 'Verificar este perfil' }))
    await a.view.findByText('Verificando…')
    await advance(58_000)
    expect(a.view.getByText('Verificando…')).toBeTruthy()
    await advance(3000)
    expect(
      await a.view.findByText('No verificado: el perfil declarado no tiene esta extensión emparejada'),
    ).toBeTruthy()
    expect(a.view.queryByText('Verificando…')).toBeNull()
    // Se puede volver a intentar.
    expect(a.view.getByRole<HTMLButtonElement>('button', { name: 'Verificar este perfil' }).disabled).toBe(false)
  })

  it('si el perfil declarado ya no existe en el navegador muestra el texto de unknown_profile', async () => {
    const { a } = await pairedWithDeclared()
    fake.state.profiles = fake.state.profiles.filter((profile) => profile.directory !== 'Default')
    await user.click(a.view.getByRole('button', { name: 'Verificar este perfil' }))
    expect((await a.view.findByRole('alert')).textContent).toContain(es['error.unknown_profile'])
    expect(a.view.queryByText('Verificando…')).toBeNull()
  })
})
