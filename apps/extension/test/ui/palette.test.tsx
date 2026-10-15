// @vitest-environment happy-dom
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestEnv } from '../helpers/env'
import { createFakeHost } from '../helpers/fake-host'
import { localOf, makeAccount, makeIdentity, mount } from '../helpers/ui-setup'

const IDENTITIES = [
  makeIdentity('ana', 'Trabajo', { email: 'ana@empresa.example' }),
  makeIdentity('bea', 'Personal', { order: 1 }),
]
const ACCOUNTS = [
  makeAccount('g1', 'ana', 'GitHub trabajo'),
  makeAccount('g2', 'bea', 'GitHub personal', { username: 'beacode', order: 1 }),
  makeAccount('m1', 'ana', 'Correo', { serviceId: 'google.gmail', order: 2 }),
  makeAccount('c1', 'bea', 'Asistente', { serviceId: 'claude', order: 3 }),
]

// Monta el dashboard con cuentas y espera a que se pinte.
async function open(extra: Parameters<typeof localOf>[0] = {}) {
  const t = createTestEnv({ local: localOf({ identities: IDENTITIES, accounts: ACCOUNTS, ...extra }) })
  const mounted = mount(t)
  await screen.findByRole('heading', { name: 'Trabajo' })
  return { t, ...mounted }
}

const labelsOf = (): string[] =>
  screen.getAllByRole('option').map((option) => option.querySelector('.palette__label')?.textContent ?? '')

beforeEach(() => {
  vi.spyOn(navigator, 'language', 'get').mockReturnValue('es-ES')
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('abrir la paleta', () => {
  it('Ctrl+K la abre con el foco en el combobox', async () => {
    const { user } = await open()
    expect(screen.queryByRole('dialog')).toBeNull()
    await user.keyboard('{Control>}k{/Control}')
    const dialog = await screen.findByRole('dialog', { name: 'Buscar una cuenta' })
    expect(document.activeElement).toBe(within(dialog).getByRole('combobox'))
  })

  it('Meta+K también la abre', async () => {
    const { user } = await open()
    await user.keyboard('{Meta>}k{/Meta}')
    const dialog = await screen.findByRole('dialog', { name: 'Buscar una cuenta' })
    expect(document.activeElement).toBe(within(dialog).getByRole('combobox'))
  })

  it('el botón Buscar la abre y el atajo se anuncia en él', async () => {
    const { user } = await open()
    const button = screen.getByRole('button', { name: /Buscar/ })
    expect(button.getAttribute('aria-keyshortcuts')).toBe('Control+K Meta+K')
    await user.click(button)
    expect(await screen.findByRole('combobox')).toBeTruthy()
  })

  it('Ctrl+Mayús+K no la abre: es el atajo de la extensión', async () => {
    const { user } = await open()
    await user.keyboard('{Control>}{Shift>}k{/Shift}{/Control}')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('con un diálogo de formulario abierto, Ctrl+K no abre la paleta', async () => {
    const { user } = await open()
    await user.click(screen.getByRole('button', { name: 'Añadir grupo' }))
    await screen.findByRole('dialog', { name: 'Nuevo grupo' })
    await user.keyboard('{Control>}k{/Control}')
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(screen.queryByRole('combobox')).toBeNull()
  })

  it('Escape la cierra y el foco vuelve al elemento que lo tenía', async () => {
    const { user } = await open()
    const before = screen.getByRole('button', { name: 'Añadir grupo' })
    before.focus()
    await user.keyboard('{Control>}k{/Control}')
    await screen.findByRole('combobox')
    await user.keyboard('{Escape}')
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
    expect(document.activeElement).toBe(before)
  })
})

describe('búsqueda', () => {
  it('sin consulta lista las cuentas y escribir "git" deja solo las de GitHub', async () => {
    const { user } = await open()
    await user.keyboard('{Control>}k{/Control}')
    await screen.findByRole('combobox')
    expect(screen.getAllByRole('option')).toHaveLength(4)
    await user.keyboard('git')
    await waitFor(() => {
      expect(labelsOf().sort()).toEqual(['GitHub personal', 'GitHub trabajo'])
    })
  })

  it('encuentra por el email de la identidad y por el usuario', async () => {
    const { user } = await open()
    await user.keyboard('{Control>}k{/Control}')
    const combobox = await screen.findByRole('combobox')
    await user.type(combobox, 'ana@empresa')
    await waitFor(() => {
      expect(labelsOf().sort()).toEqual(['Correo', 'GitHub trabajo'])
    })
    await user.clear(combobox)
    await user.type(combobox, 'beacode')
    await waitFor(() => {
      expect(labelsOf()).toEqual(['GitHub personal'])
    })
  })

  it('cada opción muestra el servicio y la identidad de la cuenta', async () => {
    const { user } = await open()
    await user.keyboard('{Control>}k{/Control}')
    await screen.findByRole('combobox')
    const option = screen.getAllByRole('option').find((o) => o.textContent.includes('Asistente'))
    expect(option?.textContent).toContain('Claude')
    expect(option?.textContent).toContain('Personal')
  })

  it('en Varios perfiles cada opción muestra dónde abre la cuenta', async () => {
    const fake = createFakeHost({ profiles: [{ directory: 'Profile 1', name: 'Oficina', isUsingDefaultName: false }] })
    const t = createTestEnv({
      host: fake,
      local: localOf({
        identities: IDENTITIES,
        accounts: ACCOUNTS,
        mode: 'multi',
        bindings: { ana: { kind: 'chromium-profile', profileDirectory: 'Profile 1' } },
      }),
    })
    const { user } = mount(t)
    await screen.findByText('Abre en el perfil «Oficina»')
    await user.keyboard('{Control>}k{/Control}')
    const dialog = await screen.findByRole('dialog', { name: 'Buscar una cuenta' })
    await waitFor(() => {
      expect(within(dialog).getAllByText('Abre en el perfil «Oficina»').length).toBeGreaterThan(0)
    })
    expect(within(dialog).getAllByText('Esta ventana').length).toBeGreaterThan(0)
  })

  it('una consulta con HTML se muestra como texto y no crea elementos', async () => {
    const { user } = await open()
    await user.keyboard('{Control>}k{/Control}')
    await user.paste('<b>x')
    const message = await screen.findByText('Sin resultados para «<b>x»')
    expect(message.querySelector('b')).toBeNull()
    expect(document.querySelector('dialog b')).toBeNull()
    expect(screen.queryAllByRole('option')).toHaveLength(0)
  })

  it.each(['(', '.*', '['])('la consulta %s no lanza y no encuentra nada', async (query) => {
    const { user } = await open()
    await user.keyboard('{Control>}k{/Control}')
    await user.paste(query)
    expect(await screen.findByText(`Sin resultados para «${query}»`)).toBeTruthy()
  })

  it('sin resultados el combobox se anuncia contraído y sin opción activa', async () => {
    const { user } = await open()
    await user.keyboard('{Control>}k{/Control}')
    const combobox = await screen.findByRole('combobox')
    await user.paste('zzzz')
    await screen.findByText('Sin resultados para «zzzz»')
    expect(combobox.getAttribute('aria-expanded')).toBe('false')
    expect(combobox.hasAttribute('aria-activedescendant')).toBe(false)
  })
})

describe('teclado y ARIA', () => {
  it('el combobox apunta a su listbox y la lista se anuncia expandida', async () => {
    const { user } = await open()
    await user.keyboard('{Control>}k{/Control}')
    const combobox = await screen.findByRole('combobox')
    const listbox = screen.getByRole('listbox')
    expect(combobox.getAttribute('aria-expanded')).toBe('true')
    expect(combobox.getAttribute('aria-controls')).toBe(listbox.id)
    expect(combobox.getAttribute('aria-autocomplete')).toBe('list')
    expect(screen.getByRole('dialog').getAttribute('aria-label')).toBe('Buscar una cuenta')
  })

  it('las flechas mueven la opción activa y se detienen en los extremos', async () => {
    const { user } = await open()
    await user.keyboard('{Control>}k{/Control}')
    const combobox = await screen.findByRole('combobox')
    const options = screen.getAllByRole('option')
    expect(options).toHaveLength(4)
    const active = (): string | null => combobox.getAttribute('aria-activedescendant')
    expect(active()).toBe(options[0]?.id)
    expect(options[0]?.getAttribute('aria-selected')).toBe('true')

    await user.keyboard('{ArrowDown}')
    expect(active()).toBe(options[1]?.id)
    expect(options[1]?.getAttribute('aria-selected')).toBe('true')
    expect(options[0]?.getAttribute('aria-selected')).toBe('false')

    await user.keyboard('{ArrowDown}{ArrowDown}')
    expect(active()).toBe(options[3]?.id)
    await user.keyboard('{ArrowDown}')
    expect(active()).toBe(options[3]?.id)

    await user.keyboard('{ArrowUp}')
    expect(active()).toBe(options[2]?.id)
    await user.keyboard('{Home}')
    expect(active()).toBe(options[0]?.id)
    await user.keyboard('{ArrowUp}')
    expect(active()).toBe(options[0]?.id)
    await user.keyboard('{End}')
    expect(active()).toBe(options[3]?.id)
    // El foco no sale del campo.
    expect(document.activeElement).toBe(combobox)
  })

  it('al cambiar la consulta la opción activa vuelve a la primera', async () => {
    const { user } = await open()
    await user.keyboard('{Control>}k{/Control}')
    const combobox = await screen.findByRole('combobox')
    await user.keyboard('{End}')
    await user.keyboard('git')
    await waitFor(() => {
      expect(screen.getAllByRole('option')).toHaveLength(2)
    })
    expect(combobox.getAttribute('aria-activedescendant')).toBe(screen.getAllByRole('option')[0]?.id)
  })

  it('Enter abre la cuenta activa y cierra la paleta', async () => {
    const { user, t } = await open()
    await user.keyboard('{Control>}k{/Control}')
    await screen.findByRole('combobox')
    await user.keyboard('claude')
    await waitFor(() => {
      expect(labelsOf()).toEqual(['Asistente'])
    })
    await user.keyboard('{Enter}')
    await waitFor(() => {
      expect(t.deps.opened).toEqual(['https://claude.ai/'])
    })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('con flechas se elige otra cuenta y Enter abre esa', async () => {
    const { user, t } = await open()
    await user.keyboard('{Control>}k{/Control}')
    await screen.findByRole('combobox')
    await user.keyboard('git{ArrowDown}')
    await waitFor(() => {
      expect(labelsOf()).toHaveLength(2)
    })
    const second = screen.getAllByRole('option')[1]?.querySelector('.palette__label')?.textContent
    await user.keyboard('{Enter}')
    await waitFor(() => {
      expect(t.deps.opened).toHaveLength(1)
    })
    expect(t.deps.opened).toEqual(['https://github.com/'])
    expect(second).toBeTruthy()
  })

  it('hacer clic en una opción abre la cuenta', async () => {
    const { user, t } = await open()
    await user.keyboard('{Control>}k{/Control}')
    await screen.findByRole('combobox')
    await user.click(screen.getByRole('option', { name: /Correo/ }))
    await waitFor(() => {
      expect(t.deps.opened).toHaveLength(1)
    })
    expect(t.deps.opened[0]).toContain('https://mail.google.com/mail/')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('Enter sin resultados no hace nada', async () => {
    const { user, t } = await open()
    await user.keyboard('{Control>}k{/Control}')
    await screen.findByRole('combobox')
    await user.paste('zzzz')
    await screen.findByText('Sin resultados para «zzzz»')
    await user.keyboard('{Enter}{ArrowDown}{End}')
    expect(t.deps.opened).toEqual([])
    expect(screen.getByRole('combobox')).toBeTruthy()
  })
})
