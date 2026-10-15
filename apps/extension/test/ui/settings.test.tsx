// @vitest-environment happy-dom
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { es } from '../../src/i18n/messages.es'
import { createTestEnv, EXTENSION_ID } from '../helpers/env'
import { createFakeHost, type FakeHost } from '../helpers/fake-host'
import { localOf, makeAccount, makeIdentity, makeService, mount, storedData } from '../helpers/ui-setup'

const ANA = makeIdentity('ana', 'Trabajo')

interface Options {
  readonly local?: Parameters<typeof localOf>[0]
  readonly fake?: FakeHost
}

// Abre Configuración sobre una instalación con una identidad.
async function openSettings(options: Options = {}) {
  const t = createTestEnv({
    local: localOf({ identities: [ANA], ...options.local }),
    ...(options.fake === undefined ? {} : { host: options.fake }),
  })
  const mounted = mount(t)
  await screen.findByRole('heading', { name: 'Trabajo' })
  await mounted.user.click(screen.getByRole('button', { name: 'Configuración' }))
  await screen.findByRole('heading', { name: 'Configuración', level: 2 })
  return { t, ...mounted }
}

beforeEach(() => {
  vi.spyOn(navigator, 'language', 'get').mockReturnValue('es-ES')
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  document.documentElement.removeAttribute('data-theme')
})

describe('pantalla de Configuración', () => {
  it('se abre desde la cabecera con el foco en el título y se cierra con Volver, devolviendo el foco al contenido', async () => {
    const { user } = await openSettings()
    const title = screen.getByRole('heading', { name: 'Configuración', level: 2 })
    expect(document.activeElement).toBe(title)
    expect(screen.getByRole('button', { name: 'Configuración' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.queryByRole('heading', { name: 'Trabajo' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Volver a las cuentas' }))
    expect(await screen.findByRole('heading', { name: 'Trabajo' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Configuración', level: 2 })).toBeNull()
    expect(document.activeElement?.tagName).toBe('MAIN')
  })

  it('el botón Configuración de la cabecera también la cierra', async () => {
    const { user } = await openSettings()
    await user.click(screen.getByRole('button', { name: 'Configuración' }))
    expect(await screen.findByRole('heading', { name: 'Trabajo' })).toBeTruthy()
  })

  it('añadir una cuenta o cambiar de vista desde la cabecera vuelve a la lista', async () => {
    const { user } = await openSettings()
    await user.click(screen.getByRole('button', { name: 'Añadir cuenta' }))
    expect(await screen.findByRole('dialog', { name: 'Añadir cuenta' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Configuración', level: 2 })).toBeNull()
  })
})

describe('idioma, tema y vista', () => {
  it('cambiar el idioma a English traduce la interfaz y se guarda', async () => {
    const { user, client } = await openSettings()
    await user.selectOptions(screen.getByLabelText('Idioma'), 'English')
    expect(await screen.findByRole('heading', { name: 'Settings', level: 2 })).toBeTruthy()
    expect((await storedData(client)).settings.language).toBe('en')
    expect(document.documentElement.lang).toBe('en')
  })

  it('el tema oscuro pone data-theme="dark" y la vista por defecto se guarda', async () => {
    const { user, client } = await openSettings()
    await user.selectOptions(screen.getByLabelText('Tema'), 'Oscuro')
    await waitFor(() => {
      expect(document.documentElement.dataset.theme).toBe('dark')
    })
    await user.selectOptions(screen.getByLabelText('Vista por defecto'), 'Grupo')
    await waitFor(async () => {
      expect((await storedData(client)).settings.defaultView).toBe('group')
    })
    expect((await storedData(client)).settings.theme).toBe('dark')
  })
})

describe('modo', () => {
  it('Varios perfiles con el programa ausente muestra la guía con los tres pasos', async () => {
    const fake = createFakeHost()
    fake.mode = 'missing'
    const { user } = await openSettings({ fake })
    expect(screen.getByRole<HTMLInputElement>('radio', { name: 'Perfil único' }).checked).toBe(true)
    expect(screen.queryByText(es['install.title'])).toBeNull()
    await user.click(screen.getByRole('radio', { name: 'Varios perfiles' }))
    const guide = await screen.findByRole('region', { name: es['install.title'] })
    const steps = within(guide).getAllByRole('listitem')
    expect(steps).toHaveLength(3)
    expect(steps[0]?.textContent).toContain('Descarga launcher-host para macOS')
    expect(within(guide).getByRole('link').getAttribute('href')).toBe(
      'https://github.com/DanielSantos495/launcher/releases',
    )
    // El comando lleva el ID de la extensión: sin --extension-id el programa no se instala.
    expect(within(guide).getByText(`./launcher-host install --extension-id ${EXTENSION_ID}`)).toBeTruthy()
    expect(steps[1]?.textContent).toContain('./launcher-host install --extension-id')
    expect(steps[2]?.textContent).toContain('Comprobar de nuevo')
    expect(screen.getByRole<HTMLInputElement>('radio', { name: 'Varios perfiles' }).checked).toBe(true)
  })

  it('con el programa instalado, "Comprobar de nuevo" hace desaparecer la guía', async () => {
    const fake = createFakeHost()
    fake.mode = 'missing'
    const { user } = await openSettings({ fake })
    await user.click(screen.getByRole('radio', { name: 'Varios perfiles' }))
    await screen.findByRole('region', { name: es['install.title'] })
    // Mientras siga ausente, pulsar el botón lo dice.
    await user.click(screen.getByRole('button', { name: 'Comprobar de nuevo' }))
    expect(await screen.findByText(es['install.stillMissing'])).toBeTruthy()
    fake.mode = 'normal'
    await user.click(screen.getByRole('button', { name: 'Comprobar de nuevo' }))
    await waitFor(() => {
      expect(screen.queryByRole('region', { name: es['install.title'] })).toBeNull()
    })
  })

  it('un programa de otra versión lo explica; un navegador no compatible no ofrece los pasos', async () => {
    const outdated = createFakeHost()
    // Un ping fuera del contrato se trata como un programa antiguo.
    outdated.override = (request) => (request.cmd === 'ping' ? { ok: true, result: { inesperado: true } } : undefined)
    const first = await openSettings({ fake: outdated })
    await first.user.click(screen.getByRole('radio', { name: 'Varios perfiles' }))
    const guide = await screen.findByRole('region', { name: es['install.title'] })
    expect(within(guide).getByText(es['install.outdated'])).toBeTruthy()
    expect(within(guide).getAllByRole('listitem')).toHaveLength(3)
    cleanup()

    // Sin cliente del host (navegador no reconocido) no hay nada que instalar.
    const second = await openSettings()
    await second.user.click(screen.getByRole('radio', { name: 'Varios perfiles' }))
    const unsupported = await screen.findByRole('region', { name: es['install.title'] })
    expect(within(unsupported).getByText(es['hint.unsupported_browser'])).toBeTruthy()
    expect(within(unsupported).queryByRole('button', { name: 'Comprobar de nuevo' })).toBeNull()
  })

  it('volver a Perfil único con el programa ausente funciona y la lista sigue visible', async () => {
    const fake = createFakeHost()
    fake.mode = 'missing'
    const { user, client } = await openSettings({
      fake,
      local: { identities: [ANA], accounts: [makeAccount('a1', 'ana', 'Alfa')] },
    })
    await user.click(screen.getByRole('radio', { name: 'Varios perfiles' }))
    await screen.findByRole('region', { name: es['install.title'] })
    await user.click(screen.getByRole('radio', { name: 'Perfil único' }))
    await waitFor(() => {
      expect(screen.queryByRole('region', { name: es['install.title'] })).toBeNull()
    })
    expect((await storedData(client)).settings.mode).toBe('single')
    expect(screen.queryByRole('alert')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Volver a las cuentas' }))
    expect(await screen.findByRole('button', { name: 'Alfa' })).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('allowHttp', () => {
  it('con una cuenta http no se puede desactivar y se explica con su etiqueta', async () => {
    const { user, client } = await openSettings({
      local: {
        identities: [ANA],
        allowHttp: true,
        accounts: [makeAccount('a1', 'ana', 'Intranet', { serviceId: 'generic', url: 'http://intranet.example/' })],
      },
    })
    const toggle = screen.getByRole<HTMLInputElement>('checkbox', { name: 'Permitir direcciones http' })
    expect(toggle.checked).toBe(true)
    expect(toggle.disabled).toBe(true)
    const text = 'No se puede desactivar mientras estas cuentas usen http: Intranet'
    expect(screen.getByText(text)).toBeTruthy()
    expect(toggle.getAttribute('aria-describedby')).toBe(screen.getByText(text).id)
    await user.click(toggle)
    expect(toggle.checked).toBe(true)
    expect((await storedData(client)).settings.allowHttp).toBe(true)
  })

  it('nombra a la vez cuentas y servicios propios que usan http', async () => {
    await openSettings({
      local: {
        identities: [ANA],
        allowHttp: true,
        accounts: [makeAccount('a1', 'ana', 'Intranet', { serviceId: 'generic', url: 'http://intranet.example/' })],
        customServices: [makeService('wiki', 'Wiki', 'http://{username}.example/')],
      },
    })
    expect(screen.getByText('No se puede desactivar mientras estas cuentas usen http: Intranet y Wiki')).toBeTruthy()
  })

  it('sin cuentas http se desactiva y data.get lo refleja; activarlo vuelve a guardarse', async () => {
    const { user, client } = await openSettings({
      local: { identities: [ANA], allowHttp: true, accounts: [makeAccount('a1', 'ana', 'Alfa')] },
    })
    const toggle = screen.getByRole<HTMLInputElement>('checkbox', { name: 'Permitir direcciones http' })
    expect(toggle.disabled).toBe(false)
    await user.click(toggle)
    await waitFor(async () => {
      expect((await storedData(client)).settings.allowHttp).toBe(false)
    })
    await waitFor(() => {
      expect(toggle.checked).toBe(false)
    })
    await user.click(toggle)
    await waitFor(async () => {
      expect((await storedData(client)).settings.allowHttp).toBe(true)
    })
  })
})

describe('servicios propios', () => {
  it('crea un servicio y aparece en el selector de servicio del formulario de cuenta', async () => {
    const { user, client } = await openSettings()
    expect(screen.getByText('Aún no tienes servicios propios.')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Añadir servicio' }))
    const dialog = await screen.findByRole('dialog', { name: 'Nuevo servicio' })
    await user.type(within(dialog).getByLabelText('Nombre'), 'Wiki interna')
    // Las llaves son sintaxis especial de user.type: se pega el texto.
    await user.click(within(dialog).getByLabelText('Plantilla de dirección'))
    await user.paste('https://wiki.example/{username}')
    await user.selectOptions(within(dialog).getByLabelText('Varias cuentas'), 'Admite varias cuentas a la vez')
    await user.click(within(dialog).getByRole('button', { name: 'Crear servicio' }))
    expect(await screen.findByText('Servicio guardado.')).toBeTruthy()
    expect((await storedData(client)).customServices.map((s) => [s.name, s.multiAccount])).toEqual([
      ['Wiki interna', 'parallel'],
    ])
    expect(await screen.findByText('https://wiki.example/{username}')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Añadir cuenta' }))
    const form = await screen.findByRole('dialog', { name: 'Añadir cuenta' })
    const options = within(within(form).getByLabelText('Servicio')).getAllByRole('option')
    expect(options.map((o) => o.textContent)).toContain('Wiki interna')
  })

  it('una plantilla no válida se muestra como error del campo y no se guarda', async () => {
    const { user, client } = await openSettings()
    await user.click(screen.getByRole('button', { name: 'Añadir servicio' }))
    const dialog = await screen.findByRole('dialog', { name: 'Nuevo servicio' })
    await user.type(within(dialog).getByLabelText('Nombre'), 'Roto')
    await user.type(within(dialog).getByLabelText('Plantilla de dirección'), 'javascript:alert(1)')
    await user.click(within(dialog).getByRole('button', { name: 'Crear servicio' }))
    expect(within(dialog).getByText(es['field.template.invalid'])).toBeTruthy()
    expect(document.activeElement).toBe(within(dialog).getByLabelText('Plantilla de dirección'))
    expect((await storedData(client)).customServices).toEqual([])
  })

  it('edita un servicio existente', async () => {
    const { user, client } = await openSettings({
      local: { identities: [ANA], customServices: [makeService('wiki', 'Wiki', 'https://wiki.example/')] },
    })
    await user.click(screen.getByRole('button', { name: 'Editar Wiki' }))
    const dialog = await screen.findByRole('dialog', { name: 'Editar servicio' })
    const name = within(dialog).getByLabelText('Nombre')
    await user.clear(name)
    await user.type(name, 'Wiki del equipo')
    await user.click(within(dialog).getByRole('button', { name: 'Guardar cambios' }))
    await screen.findByText('Servicio guardado.')
    expect((await storedData(client)).customServices.map((s) => s.name)).toEqual(['Wiki del equipo'])
  })

  it('borrar un servicio que una cuenta usa muestra el texto de in_use y no lo borra', async () => {
    const { user, client } = await openSettings({
      local: {
        identities: [ANA],
        customServices: [makeService('wiki', 'Wiki', 'https://wiki.example/')],
        accounts: [makeAccount('a1', 'ana', 'Mi wiki', { serviceId: 'custom:wiki' })],
      },
    })
    await user.click(screen.getByRole('button', { name: 'Borrar Wiki' }))
    const dialog = await screen.findByRole('dialog', { name: 'Borrar el servicio «Wiki»' })
    await user.click(within(dialog).getByRole('button', { name: 'Borrar servicio' }))
    expect((await within(dialog).findByRole('alert')).textContent).toContain(es['hint.in_use'])
    expect((await storedData(client)).customServices).toHaveLength(1)
  })

  it('borrar un servicio sin uso lo quita de la lista', async () => {
    const { user, client } = await openSettings({
      local: { identities: [ANA], customServices: [makeService('wiki', 'Wiki', 'https://wiki.example/')] },
    })
    await user.click(screen.getByRole('button', { name: 'Borrar Wiki' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Borrar servicio' }))
    expect(await screen.findByText('Servicio borrado.')).toBeTruthy()
    expect((await storedData(client)).customServices).toEqual([])
    expect(screen.getByText('Aún no tienes servicios propios.')).toBeTruthy()
  })
})
