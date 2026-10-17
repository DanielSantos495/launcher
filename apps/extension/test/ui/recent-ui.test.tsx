// @vitest-environment happy-dom
import type { Account } from '@account-launcher/core'
import { cleanup, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestEnv } from '../helpers/env'
import { localOf, makeAccount, makeIdentity, mount } from '../helpers/ui-setup'

beforeEach(() => {
  vi.spyOn(navigator, 'language', 'get').mockReturnValue('es-ES')
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const day = (n: number) => `2026-10-${String(n).padStart(2, '0')}T10:00:00.000Z`

async function openRecent(accounts: Account[]) {
  const t = createTestEnv({ local: localOf({ identities: [makeIdentity('ana', 'Ana')], accounts }) })
  const mounted = mount(t)
  await mounted.user.click(await screen.findByRole('button', { name: 'Recientes' }))
  return mounted
}

const shown = (container: HTMLElement): string[] =>
  [...container.querySelectorAll('li.tile .tile__label')].map((node) => node.textContent)

describe('vista Recientes', () => {
  it('lista por apertura reciente, con empates por id, y omite las nunca abiertas', async () => {
    const { container } = await openRecent([
      makeAccount('b', 'ana', 'Beta', { lastOpenedAt: day(5) }),
      makeAccount('a', 'ana', 'Alfa', { lastOpenedAt: day(5) }),
      makeAccount('c', 'ana', 'Gamma', { lastOpenedAt: day(9) }),
      makeAccount('n', 'ana', 'Nunca'),
    ])
    expect(shown(container)).toEqual(['Gamma', 'Alfa', 'Beta'])
    expect(screen.getByRole('button', { name: 'Recientes' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('muestra solo las 10 últimas', async () => {
    const { container } = await openRecent(
      Array.from({ length: 11 }, (_, i) =>
        makeAccount(`a${String(i).padStart(2, '0')}`, 'ana', `Cuenta ${String(i)}`, { lastOpenedAt: day(i + 1) }),
      ),
    )
    const labels = shown(container)
    expect(labels).toHaveLength(10)
    expect(labels[0]).toBe('Cuenta 10')
    expect(labels).not.toContain('Cuenta 0')
  })

  it('sin ninguna abierta enseña un estado vacío', async () => {
    await openRecent([makeAccount('a', 'ana', 'Alfa')])
    expect(screen.getByText('Aún no has abierto ninguna cuenta')).toBeTruthy()
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
  })

  it('volver a una vista normal sale de Recientes', async () => {
    const { user, container } = await openRecent([makeAccount('a', 'ana', 'Alfa', { lastOpenedAt: day(1) })])
    await user.click(screen.getByRole('button', { name: 'Grupo' }))
    expect(screen.getByRole('button', { name: 'Recientes' }).getAttribute('aria-pressed')).toBe('false')
    expect(within(container).queryByText('Aún no has abierto ninguna cuenta')).toBeNull()
  })
})
