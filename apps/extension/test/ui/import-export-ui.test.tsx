// @vitest-environment happy-dom
import {
  MAX_IMPORT_BYTES,
  type Account,
  type Bindings,
  type LauncherData,
  type ProfileInfo,
} from '@account-launcher/core'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildExport, readImportText } from '../../src/ui/lib/import-export'
import { createTestEnv } from '../helpers/env'
import { createFakeHost, type FakeHost } from '../helpers/fake-host'
import { dataOf, failing, localOf, makeAccount, makeIdentity, mount, storedData } from '../helpers/ui-setup'

const ANA = makeIdentity('ana', 'Trabajo')
const FIXED = new Date('2026-10-08T12:00:00.000Z')

function file(text: string, name = 'copia.json'): File {
  return new File([text], name, { type: 'application/json' })
}

// Texto de un archivo de exportación con esos datos y vínculos.
function exportText(data: LauncherData, bindings: Bindings = {}, profiles: readonly ProfileInfo[] = []): string {
  return buildExport(data, bindings, profiles, FIXED).text
}

function copyWith(accounts: Account[]): LauncherData {
  return dataOf({ identities: [ANA], accounts })
}

interface OpenOptions {
  readonly mode?: 'single' | 'multi'
  readonly fake?: FakeHost
  readonly failImport?: boolean
}

// Abre Configuración con una identidad y las cuentas a1 y a4, y un programa de descargas falso.
async function openSettings(options: OpenOptions = {}) {
  const download = vi.fn<(filename: string, text: string) => void>()
  const t = createTestEnv({
    local: localOf({
      identities: [ANA],
      accounts: [makeAccount('a1', 'ana', 'Alfa'), makeAccount('a4', 'ana', 'Delta', { order: 1 })],
      ...(options.mode === undefined ? {} : { mode: options.mode }),
    }),
    ...(options.fake === undefined ? {} : { host: options.fake }),
  })
  const mounted = mount(t, {
    download,
    ...(options.failImport === true ? { wrap: (client) => failing(client, (r) => r.type === 'data.import') } : {}),
  })
  await screen.findByRole('heading', { name: 'Trabajo' })
  await mounted.user.click(screen.getByRole('button', { name: 'Configuración' }))
  await screen.findByRole('heading', { name: 'Copia de seguridad' })
  return { t, download, ...mounted }
}

const fileInput = (): HTMLInputElement => screen.getByLabelText<HTMLInputElement>('Importar copia')

// Valor de un recuento (Añadidos, Quitados…) dentro del bloque de un modo de la vista previa.
function count(mode: 'Fusionar' | 'Reemplazar', label: string): string | null | undefined {
  const region = screen.getByRole('region', { name: mode })
  return within(region).queryByText(label)?.nextElementSibling?.textContent
}

beforeEach(() => {
  vi.spyOn(navigator, 'language', 'get').mockReturnValue('es-ES')
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('exportar', () => {
  it('descarga account-launcher-<fecha>.json con un texto que se puede importar y avisa de los datos personales', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(FIXED)
    const { user, download } = await openSettings()
    expect(screen.getByText('El archivo incluye emails y notas: guárdalo en un lugar seguro.')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Exportar copia' }))
    expect(download).toHaveBeenCalledTimes(1)
    const [filename, text] = download.mock.calls[0] ?? []
    expect(filename).toBe('account-launcher-2026-10-08.json')
    const parsed = readImportText(text ?? '')
    expect(parsed.ok && parsed.value.data.accounts.map((a) => a.id)).toEqual(['a1', 'a4'])
  })
})

describe('importar: archivos que no valen', () => {
  it('un archivo de más de 5 MB se rechaza sin leerlo', async () => {
    const { user } = await openSettings()
    const big = new File([new Uint8Array(MAX_IMPORT_BYTES + 1)], 'grande.json', { type: 'application/json' })
    const read = vi.spyOn(big, 'text')
    await user.upload(fileInput(), big)
    expect(await screen.findByText('El archivo pesa más de 5 MB')).toBeTruthy()
    expect(read).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('un archivo de exactamente 5 MB sí se lee (y aquí no es JSON)', async () => {
    const { user } = await openSettings()
    const limit = new File([new Uint8Array(MAX_IMPORT_BYTES)], 'limite.json', { type: 'application/json' })
    const read = vi.spyOn(limit, 'text')
    await user.upload(fileInput(), limit)
    expect(await screen.findByText('El archivo no es un JSON válido.')).toBeTruthy()
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('un JSON roto muestra su mensaje', async () => {
    const { user } = await openSettings()
    await user.upload(fileInput(), file('{ no es json'))
    expect(await screen.findByText('El archivo no es un JSON válido.')).toBeTruthy()
  })

  it('un JSON que no es una copia muestra su mensaje', async () => {
    const { user } = await openSettings()
    await user.upload(fileInput(), file('{"hola":1}'))
    expect(await screen.findByText('Este archivo no es una copia de Account Launcher.')).toBeTruthy()
  })

  it('una copia de una versión más nueva muestra su mensaje', async () => {
    const { user } = await openSettings()
    const newer = JSON.stringify({ app: 'account-launcher', schemaVersion: 99, data: { schemaVersion: 99 } })
    await user.upload(fileInput(), file(newer))
    expect(
      await screen.findByText('La copia es de una versión más nueva de Account Launcher. Actualiza la extensión.'),
    ).toBeTruthy()
  })

  it('una dirección javascript: muestra los datos no válidos y la lista de problemas, sin repetirla, y no cambia nada', async () => {
    const { user, client } = await openSettings()
    const trap = makeAccount('x1', 'ana', 'Trampa', { serviceId: 'generic', url: 'https://ok.example/' })
    const hostile = exportText(copyWith([trap])).replace('https://ok.example/', 'javascript:alert(1)')
    expect(hostile).toContain('javascript:alert(1)')
    await user.upload(fileInput(), file(hostile))
    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText('El archivo tiene datos no válidos.')).toBeTruthy()
    expect(within(alert).getByText('Problemas encontrados')).toBeTruthy()
    expect(within(alert).getByText('accounts.x1: URL no válida')).toBeTruthy()
    expect(document.body.textContent).not.toContain('javascript:')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect((await storedData(client)).accounts.map((a) => a.id)).toEqual(['a1', 'a4'])
  })

  it('un error de un archivo se sustituye por el del siguiente', async () => {
    const { user } = await openSettings()
    await user.upload(fileInput(), file('{ no es json'))
    await screen.findByText('El archivo no es un JSON válido.')
    await user.upload(fileInput(), file('{"hola":1}'))
    await screen.findByText('Este archivo no es una copia de Account Launcher.')
    expect(screen.queryByText('El archivo no es un JSON válido.')).toBeNull()
  })
})

describe('importar: archivo válido', () => {
  // El archivo trae a1 (igual), a2 y a3 (nuevas); la lista actual tiene además a4, que el archivo no trae.
  const incoming = (): string =>
    exportText(
      copyWith([makeAccount('a1', 'ana', 'Alfa'), makeAccount('a2', 'ana', 'Beta'), makeAccount('a3', 'ana', 'Gamma')]),
    )

  it('muestra los recuentos de fusionar y de reemplazar y su explicación', async () => {
    const { user } = await openSettings()
    await user.upload(fileInput(), file(incoming()))
    const dialog = await screen.findByRole('dialog', { name: 'Importar copia' })
    expect(
      within(dialog).getByText(/Si algo está en los dos sitios, gana lo modificado más recientemente/),
    ).toBeTruthy()
    expect(within(dialog).getByText(/Lo que no esté en el archivo se quita/)).toBeTruthy()
    expect(count('Fusionar', 'Añadidos')).toBe('2')
    expect(count('Fusionar', 'Actualizados')).toBe('0')
    expect(count('Fusionar', 'Sin cambios')).toBe('2')
    expect(count('Fusionar', 'Quitados')).toBeUndefined()
    expect(count('Reemplazar', 'Añadidos')).toBe('2')
    expect(count('Reemplazar', 'Sin cambios')).toBe('2')
    expect(count('Reemplazar', 'Quitados')).toBe('1')
  })

  it('Fusionar añade lo nuevo, conserva lo demás y anuncia los recuentos', async () => {
    const { user, client } = await openSettings()
    await user.upload(fileInput(), file(incoming()))
    await screen.findByRole('dialog', { name: 'Importar copia' })
    await user.click(screen.getByRole('button', { name: 'Fusionar' }))
    const status = await screen.findByText(
      'Importación terminada: 2 añadidos, 0 actualizados, 2 sin cambios y 0 quitados.',
    )
    expect(status.closest('[role="status"]')).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect((await storedData(client)).accounts.map((a) => a.id).sort()).toEqual(['a1', 'a2', 'a3', 'a4'])
    // Las cuentas aparecen en la lista al volver.
    await user.click(screen.getByRole('button', { name: 'Volver a las cuentas' }))
    expect(await screen.findByRole('button', { name: 'Gamma' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Delta' })).toBeTruthy()
  })

  it('Reemplazar deja exactamente lo del archivo', async () => {
    const { user, client } = await openSettings()
    await user.upload(fileInput(), file(incoming()))
    await screen.findByRole('dialog', { name: 'Importar copia' })
    await user.click(screen.getByRole('button', { name: 'Reemplazar' }))
    await screen.findByText('Importación terminada: 2 añadidos, 0 actualizados, 2 sin cambios y 1 quitados.')
    expect((await storedData(client)).accounts.map((a) => a.id).sort()).toEqual(['a1', 'a2', 'a3'])
  })

  it('Cancelar cierra la vista previa sin importar nada', async () => {
    const { user, client } = await openSettings()
    await user.upload(fileInput(), file(incoming()))
    const dialog = await screen.findByRole('dialog', { name: 'Importar copia' })
    await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }))
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
    expect((await storedData(client)).accounts).toHaveLength(2)
    expect(screen.queryByText(/Importación terminada/)).toBeNull()
  })

  it('un modo imposible por los límites se explica y no se puede elegir', async () => {
    const { user } = await openSettings()
    // Fusionar supera el máximo de identidades; reemplazar no (el archivo trae 100 y la lista tiene 1 que se quita).
    const identities = Array.from({ length: 100 }, (_, i) => makeIdentity(`i${String(i)}`, `Identidad ${String(i)}`))
    const text = exportText(dataOf({ identities }))
    await user.upload(fileInput(), file(text))
    await screen.findByRole('dialog', { name: 'Importar copia' })
    expect(screen.getByText('No se puede fusionar: la lista resultante superaría los límites.')).toBeTruthy()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Fusionar' }).disabled).toBe(true)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Reemplazar' }).disabled).toBe(false)
  })

  it('si el service worker falla, el error sale en el diálogo, que sigue abierto', async () => {
    const { user } = await openSettings({ failImport: true })
    await user.upload(fileInput(), file(incoming()))
    const dialog = await screen.findByRole('dialog', { name: 'Importar copia' })
    await user.click(within(dialog).getByRole('button', { name: 'Fusionar' }))
    expect((await within(dialog).findByRole('alert')).textContent).toContain('No se pudo guardar en el navegador')
    expect(screen.queryByText(/Importación terminada/)).toBeNull()
  })
})

describe('importar en Varios perfiles', () => {
  // Archivo con una pista por nombre de perfil que el navegador de la prueba tiene o no.
  const withHint = (name: string): string =>
    exportText(
      copyWith([makeAccount('a1', 'ana', 'Alfa')]),
      { ana: { kind: 'chromium-profile', profileDirectory: 'Profile 9', desiredName: name } },
      [],
    )

  it('lista la identidad cuya pista no coincide con ningún perfil y enlaza a Vínculos', async () => {
    const { user } = await openSettings({ mode: 'multi', fake: createFakeHost() })
    await user.upload(fileInput(), file(withHint('Oficina')))
    await screen.findByRole('dialog', { name: 'Importar copia' })
    await user.click(screen.getByRole('button', { name: 'Fusionar' }))
    const status = (await screen.findByText(/Importación terminada/)).closest('[role="status"]')
    expect(status?.textContent).toContain('Estas identidades siguen sin perfil: Trabajo. Vincúlalas a mano.')
    const link = within(status as HTMLElement).getByRole('link', { name: 'Ir a Vínculos' })
    expect(link.getAttribute('href')).toBe('#bindings')
  })

  it('una pista que coincide con un perfil se vincula y no queda pendiente', async () => {
    const { user, client } = await openSettings({ mode: 'multi', fake: createFakeHost() })
    await user.upload(fileInput(), file(withHint('Personal')))
    await screen.findByRole('dialog', { name: 'Importar copia' })
    await user.click(screen.getByRole('button', { name: 'Fusionar' }))
    await screen.findByText(/Importación terminada/)
    expect(screen.queryByText(/siguen sin perfil/)).toBeNull()
    const bindings = await client.send({ type: 'bindings.get' })
    expect(bindings.ok && bindings.result.bindings).toEqual({
      ana: { kind: 'chromium-profile', profileDirectory: 'Default' },
    })
  })

  it('en Perfil único no se pide revincular nada', async () => {
    const { user } = await openSettings()
    await user.upload(fileInput(), file(withHint('Oficina')))
    await screen.findByRole('dialog', { name: 'Importar copia' })
    await user.click(screen.getByRole('button', { name: 'Fusionar' }))
    await screen.findByText(/Importación terminada/)
    expect(screen.queryByText(/siguen sin perfil/)).toBeNull()
  })
})
