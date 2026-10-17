// @vitest-environment happy-dom
import type { Account, Identity } from '@account-launcher/core'
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestEnv } from '../helpers/env'
import { failing, localOf, makeAccount, makeIdentity, mount, storedData } from '../helpers/ui-setup'

beforeEach(() => {
  vi.spyOn(navigator, 'language', 'get').mockReturnValue('es-ES')
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const ana = makeIdentity('ana', 'Ana')
const beto = makeIdentity('beto', 'Beto', { order: 1 })

async function open(accounts: Account[], identities: Identity[] = [ana]) {
  const t = createTestEnv({ local: localOf({ identities, accounts }) })
  const mutations: string[] = []
  const mounted = mount(t, {
    wrap: (client) => ({
      ...client,
      send(request) {
        if (request.type === 'data.mutate') mutations.push(JSON.stringify(request.ops.map((op) => op.type)))
        return client.send(request)
      },
    }),
  })
  await screen.findAllByRole('listitem')
  return { t, mutations, ...mounted }
}

const abc = () => [
  makeAccount('a', 'ana', 'Alfa', { order: 0 }),
  makeAccount('b', 'ana', 'Beta', { order: 1 }),
  makeAccount('c', 'ana', 'Gamma', { order: 2 }),
]

const labels = (container: HTMLElement): string[] =>
  [...container.querySelectorAll('li.tile .tile__label')].map((node) => node.textContent)

function tile(container: HTMLElement, id: string): HTMLElement {
  const found = container.querySelector<HTMLElement>(`li[data-account-id="${id}"]`)
  if (found === null) throw new Error(`falta la tarjeta ${id}`)
  return found
}

const dataTransfer = () => ({ setData: vi.fn(), getData: vi.fn(), effectAllowed: '', dropEffect: '' })

describe('ordenar cuentas con el teclado', () => {
  it('Alt+flecha mueve la cuenta, la anuncia, conserva el foco y manda un solo data.mutate', async () => {
    const { container, user, mutations, client } = await open(abc())
    const button = within(tile(container, 'b')).getByRole('button', { name: 'Beta' })
    button.focus()
    await user.keyboard('{Alt>}{ArrowUp}{/Alt}')
    await waitFor(() => {
      expect(labels(container)).toEqual(['Beta', 'Alfa', 'Gamma'])
    })
    expect(screen.getByText(/«Beta» está ahora en la posición 1 de 3\./)).toBeTruthy()
    expect(mutations).toEqual(['["account.reorder"]'])
    const orders = (await storedData(client)).accounts.map((a) => [a.id, a.order])
    expect(orders).toEqual([
      ['a', 1],
      ['b', 0],
      ['c', 2],
    ])
    await waitFor(() => {
      expect(document.activeElement).toBe(within(tile(container, 'b')).getByRole('button', { name: 'Beta' }))
    })
  })

  it('dos Alt+flecha seguidos, antes de que lleguen los datos nuevos, suman dos puestos', async () => {
    const { container } = await open(abc())
    const button = within(tile(container, 'a')).getByRole('button', { name: 'Alfa' })
    button.focus()
    // Sin esperar entre las dos pulsaciones: la segunda parte de la pantalla vieja si no se tiene en cuenta la primera.
    fireEvent.keyDown(button, { key: 'ArrowDown', altKey: true })
    fireEvent.keyDown(button, { key: 'ArrowDown', altKey: true })
    await waitFor(() => {
      expect(labels(container)).toEqual(['Beta', 'Gamma', 'Alfa'])
    })
  })

  it('Alt+flecha abajo mueve un puesto hacia el final', async () => {
    const { container, user } = await open(abc())
    within(tile(container, 'a')).getByRole('button', { name: 'Alfa' }).focus()
    await user.keyboard('{Alt>}{ArrowDown}{/Alt}')
    await waitFor(() => {
      expect(labels(container)).toEqual(['Beta', 'Alfa', 'Gamma'])
    })
  })

  it('en los extremos no escribe nada y lo dice', async () => {
    const { container, user, mutations } = await open(abc())
    within(tile(container, 'a')).getByRole('button', { name: 'Alfa' }).focus()
    await user.keyboard('{Alt>}{ArrowUp}{/Alt}')
    expect(screen.getByText(/«Alfa» no se puede mover más en esa dirección\./)).toBeTruthy()
    within(tile(container, 'c')).getByRole('button', { name: 'Gamma' }).focus()
    await user.keyboard('{Alt>}{ArrowDown}{/Alt}')
    expect(screen.getByText(/«Gamma» no se puede mover más/)).toBeTruthy()
    expect(mutations).toEqual([])
    expect(labels(container)).toEqual(['Alfa', 'Beta', 'Gamma'])
  })

  it('las flechas sin Alt no mueven', async () => {
    const { container, user, mutations } = await open(abc())
    within(tile(container, 'b')).getByRole('button', { name: 'Beta' }).focus()
    await user.keyboard('{ArrowUp}')
    expect(mutations).toEqual([])
  })

  it('el menú ofrece Mover arriba y abajo, y oculta la que no se puede', async () => {
    const { container, user } = await open(abc())
    await user.click(within(tile(container, 'a')).getByRole('button', { name: 'Acciones de Alfa' }))
    expect(screen.queryByRole('menuitem', { name: 'Mover arriba' })).toBeNull()
    await user.click(screen.getByRole('menuitem', { name: 'Mover abajo' }))
    await waitFor(() => {
      expect(labels(container)).toEqual(['Beta', 'Alfa', 'Gamma'])
    })
    await user.click(within(tile(container, 'c')).getByRole('button', { name: 'Acciones de Gamma' }))
    expect(screen.queryByRole('menuitem', { name: 'Mover abajo' })).toBeNull()
    await user.click(screen.getByRole('menuitem', { name: 'Mover arriba' }))
    await waitFor(() => {
      expect(labels(container)).toEqual(['Beta', 'Gamma', 'Alfa'])
    })
  })

  it('una favorita no cruza a las que no lo son', async () => {
    const { container, user, mutations } = await open([
      makeAccount('f', 'ana', 'Fija', { favorite: true, order: 5 }),
      makeAccount('a', 'ana', 'Alfa', { order: 0 }),
    ])
    expect(labels(container)).toEqual(['Fija', 'Alfa'])
    within(tile(container, 'f')).getByRole('button', { name: 'Fija' }).focus()
    await user.keyboard('{Alt>}{ArrowDown}{/Alt}')
    expect(mutations).toEqual([])
  })

  it('muestra el error si la escritura falla y no cambia el orden', async () => {
    const t = createTestEnv({ local: localOf({ identities: [ana], accounts: abc() }) })
    const { container, user } = mount(t, { wrap: (client) => failing(client, (r) => r.type === 'data.mutate') })
    await screen.findAllByRole('listitem')
    within(tile(container, 'b')).getByRole('button', { name: 'Beta' }).focus()
    await user.keyboard('{Alt>}{ArrowUp}{/Alt}')
    await screen.findByRole('alert')
    expect(labels(container)).toEqual(['Alfa', 'Beta', 'Gamma'])
  })
})

describe('ordenar cuentas arrastrando', () => {
  it('soltar una cuenta sobre otra la coloca en su puesto', async () => {
    const { container, client } = await open(abc())
    const dt = dataTransfer()
    fireEvent.dragStart(tile(container, 'c'), { dataTransfer: dt })
    expect(dt.setData).toHaveBeenCalled()
    fireEvent.dragOver(tile(container, 'a'), { dataTransfer: dt })
    expect(tile(container, 'a').className).toContain('tile--over')
    fireEvent.drop(tile(container, 'a'), { dataTransfer: dt })
    fireEvent.dragEnd(tile(container, 'c'), { dataTransfer: dt })
    await waitFor(() => {
      expect(labels(container)).toEqual(['Gamma', 'Alfa', 'Beta'])
    })
    expect((await storedData(client)).accounts.map((a) => [a.id, a.order])).toEqual([
      ['a', 1],
      ['b', 2],
      ['c', 0],
    ])
  })

  it('soltar sobre sí misma, o fuera de su sección, no escribe', async () => {
    const { container, mutations } = await open([...abc(), makeAccount('z', 'beto', 'Zeta')], [ana, beto])
    const dt = dataTransfer()
    fireEvent.dragStart(tile(container, 'b'), { dataTransfer: dt })
    fireEvent.drop(tile(container, 'b'), { dataTransfer: dt })
    fireEvent.dragEnd(tile(container, 'b'), { dataTransfer: dt })
    fireEvent.dragStart(tile(container, 'b'), { dataTransfer: dt })
    fireEvent.drop(tile(container, 'z'), { dataTransfer: dt })
    fireEvent.dragEnd(tile(container, 'b'), { dataTransfer: dt })
    expect(mutations).toEqual([])
  })

  it('soltar sin haber arrastrado nada de la lista no hace nada', async () => {
    const { container, mutations } = await open(abc())
    fireEvent.drop(tile(container, 'a'), { dataTransfer: dataTransfer() })
    expect(mutations).toEqual([])
  })
})

describe('ordenar identidades', () => {
  const two = () => [makeAccount('a', 'ana', 'Alfa'), makeAccount('z', 'beto', 'Zeta')]
  const names = (container: HTMLElement): string[] =>
    [...container.querySelectorAll('h2.section__name')].map((node) => node.textContent)

  it('Mover arriba en el menú de la sección sube la identidad', async () => {
    const { container, user, client, mutations } = await open(two(), [ana, beto])
    expect(names(container)).toEqual(['Ana', 'Beto'])
    await user.click(screen.getByRole('button', { name: 'Acciones de Beto' }))
    expect(screen.queryByRole('menuitem', { name: 'Mover abajo' })).toBeNull()
    await user.click(screen.getByRole('menuitem', { name: 'Mover arriba' }))
    await waitFor(() => {
      expect(names(container)).toEqual(['Beto', 'Ana'])
    })
    expect(mutations).toEqual(['["identity.reorder"]'])
    expect((await storedData(client)).identities.map((i) => [i.id, i.order])).toEqual([
      ['ana', 1],
      ['beto', 0],
    ])
  })

  it('arrastrar la cabecera sobre otra sección las intercambia', async () => {
    const { container } = await open(two(), [ana, beto])
    const dt = dataTransfer()
    const header = (name: string): HTMLElement => {
      const found = screen.getByRole('heading', { name }).closest<HTMLElement>('.section__header')
      if (found === null) throw new Error('falta la cabecera')
      return found
    }
    fireEvent.dragStart(header('Beto'), { dataTransfer: dt })
    const target = screen.getByRole('heading', { name: 'Ana' }).closest('section')
    if (target === null) throw new Error('falta la sección')
    fireEvent.dragOver(target, { dataTransfer: dt })
    fireEvent.drop(target, { dataTransfer: dt })
    fireEvent.dragEnd(header('Beto'), { dataTransfer: dt })
    await waitFor(() => {
      expect(names(container)).toEqual(['Beto', 'Ana'])
    })
  })

  it('soltar la cabecera sobre una tarjeta de otra sección también las intercambia', async () => {
    const { container } = await open(two(), [ana, beto])
    const dt = dataTransfer()
    const header = screen.getByRole('heading', { name: 'Beto' }).closest<HTMLElement>('.section__header')
    if (header === null) throw new Error('falta la cabecera')
    fireEvent.dragStart(header, { dataTransfer: dt })
    // La tarjeta es casi toda la superficie de la sección: su drop no debe tragarse el arrastre de la identidad.
    fireEvent.dragOver(tile(container, 'a'), { dataTransfer: dt })
    fireEvent.drop(tile(container, 'a'), { dataTransfer: dt })
    fireEvent.dragEnd(header, { dataTransfer: dt })
    await waitFor(() => {
      expect(names(container)).toEqual(['Beto', 'Ana'])
    })
  })

  it('arrastrar una cuenta no mueve identidades', async () => {
    const { container, mutations } = await open(two(), [ana, beto])
    const dt = dataTransfer()
    fireEvent.dragStart(tile(container, 'z'), { dataTransfer: dt })
    const target = screen.getByRole('heading', { name: 'Ana' }).closest('section')
    if (target === null) throw new Error('falta la sección')
    fireEvent.drop(target, { dataTransfer: dt })
    expect(mutations).toEqual([])
  })
})
