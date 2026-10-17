// @vitest-environment happy-dom
import type { ProfileInfo } from '@account-launcher/core'
import { cleanup, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestEnv } from '../helpers/env'
import { createFakeHost } from '../helpers/fake-host'
import { localOf, makeAccount, makeIdentity, mount } from '../helpers/ui-setup'

beforeEach(() => {
  vi.spyOn(navigator, 'language', 'get').mockReturnValue('es-ES')
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const profile = (directory: string, name: string): ProfileInfo => ({ directory, name, isUsingDefaultName: false })

async function open(options: {
  seen?: string[]
  profiles: ProfileInfo[]
  mode?: 'single' | 'multi'
  bindings?: Parameters<typeof localOf>[0] extends infer S ? (S extends { bindings?: infer B } ? B : never) : never
}) {
  const fake = createFakeHost({ profiles: options.profiles })
  const t = createTestEnv({
    host: fake,
    local: {
      ...localOf({
        mode: options.mode ?? 'multi',
        identities: [makeIdentity('ana', 'Ana')],
        accounts: [makeAccount('a', 'ana', 'Alfa')],
        ...(options.bindings === undefined ? {} : { bindings: options.bindings }),
      }),
      ...(options.seen === undefined ? {} : { seenProfiles: options.seen }),
    },
  })
  const mounted = mount(t)
  await screen.findByText('Alfa')
  return { t, fake, ...mounted }
}

const seenOf = (t: Awaited<ReturnType<typeof open>>['t']) => t.local.get('seenProfiles')

describe('aviso de perfil nuevo', () => {
  it('la primera vez marca todas como vistas, sin aviso', async () => {
    const { t } = await open({ profiles: [profile('Default', 'Personal'), profile('Profile 1', 'Trabajo')] })
    await waitFor(async () => {
      expect(await seenOf(t)).toEqual(['Default', 'Profile 1'])
    })
    expect(screen.queryByText(/Perfil nuevo/)).toBeNull()
  })

  it('avisa de una carpeta nueva y ofrece ir a Vínculos', async () => {
    const { user, t } = await open({
      seen: ['Default'],
      profiles: [profile('Default', 'Personal'), profile('Profile 1', 'Trabajo')],
    })
    expect(await screen.findByText('Perfil nuevo «Trabajo»: vincular a una identidad')).toBeTruthy()
    expect(await seenOf(t)).toEqual(['Default'])
    await user.click(screen.getByRole('button', { name: 'Vincular el perfil nuevo «Trabajo» a una identidad' }))
    const section = await screen.findByRole('heading', { name: 'Vínculos' })
    await waitFor(() => {
      expect(document.activeElement).toBe(section)
    })
  })

  it('descartar lo guarda como visto y no vuelve a avisar', async () => {
    const { user, t, unmount } = await open({
      seen: ['Default'],
      profiles: [profile('Default', 'Personal'), profile('Profile 1', 'Trabajo')],
    })
    await user.click(await screen.findByRole('button', { name: 'Descartar el aviso del perfil «Trabajo»' }))
    expect(screen.queryByText(/Perfil nuevo/)).toBeNull()
    await waitFor(async () => {
      expect(await seenOf(t)).toEqual(['Default', 'Profile 1'])
    })
    unmount()
    const again = mount(t)
    await screen.findByText('Alfa')
    expect(screen.queryByText(/Perfil nuevo/)).toBeNull()
    again.unmount()
  })

  it('el nombre del perfil se muestra como texto, no como HTML', async () => {
    await open({
      seen: ['Default'],
      profiles: [profile('Default', 'Personal'), profile('Profile 1', '<img src=x onerror=alert(1)>')],
    })
    const notice = (await screen.findByText(/Perfil nuevo/)).closest('.banner')
    expect(notice?.querySelector('img')).toBeNull()
    expect(screen.getByText('Perfil nuevo «<img src=x onerror=alert(1)>»: vincular a una identidad')).toBeTruthy()
  })

  it('no avisa en Perfil único', async () => {
    const { t } = await open({
      mode: 'single',
      seen: ['Default'],
      profiles: [profile('Default', 'A'), profile('P1', 'B')],
    })
    expect(screen.queryByText(/Perfil nuevo/)).toBeNull()
    expect(await seenOf(t)).toEqual(['Default'])
  })

  it('no avisa de un perfil que ya tiene vínculo', async () => {
    await open({
      seen: ['Default'],
      profiles: [profile('Default', 'Personal'), profile('Profile 1', 'Trabajo')],
      bindings: { ana: { kind: 'chromium-profile', profileDirectory: 'Profile 1' } },
    })
    expect(screen.queryByText(/Perfil nuevo/)).toBeNull()
  })

  it('el tope de carpetas vistas es 200: al descartar se pierde la más antigua', async () => {
    const seen = Array.from({ length: 200 }, (_, i) => `Old ${String(i)}`)
    const { user, t } = await open({
      seen,
      profiles: [profile('Default', 'Personal'), profile('Profile 1', 'Trabajo')],
    })
    await user.click(await screen.findByRole('button', { name: 'Descartar el aviso del perfil «Personal»' }))
    await user.click(await screen.findByRole('button', { name: 'Descartar el aviso del perfil «Trabajo»' }))
    await waitFor(async () => {
      const stored = await seenOf(t)
      expect(Array.isArray(stored) ? stored.length : -1).toBe(200)
    })
    const stored = await seenOf(t)
    expect(Array.isArray(stored) ? stored.slice(-2) : []).toEqual(['Default', 'Profile 1'])
    expect(Array.isArray(stored) ? stored[0] : '').toBe('Old 2')
  })
})
