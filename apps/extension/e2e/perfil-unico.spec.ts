import { addAccount, createIdentity, expect, test, tile } from './fixtures'

test.describe('Perfil único', () => {
  test('el primer arranque pide crear una identidad y la cuenta nueva sobrevive a una recarga', async ({
    dashboard,
  }) => {
    await expect(dashboard.getByRole('heading', { name: 'Crea tu primera identidad para empezar' })).toBeVisible()
    // Sin identidades no se puede añadir ninguna cuenta.
    await expect(dashboard.getByRole('button', { name: 'Añadir cuenta' })).toBeDisabled()

    await createIdentity(dashboard, 'Trabajo')
    await expect(dashboard.getByRole('heading', { name: 'Trabajo', level: 2 })).toBeVisible()
    await addAccount(dashboard, { service: 'GitHub', label: 'GitHub trabajo', username: 'ana-dev' })
    await expect(tile(dashboard, 'GitHub trabajo')).toBeVisible()

    await dashboard.reload()
    await expect(dashboard.getByRole('heading', { name: 'Trabajo', level: 2 })).toBeVisible()
    await expect(tile(dashboard, 'GitHub trabajo')).toBeVisible()
  })

  test('un clic en la tarjeta abre la dirección del servicio en una pestaña nueva', async ({ context, dashboard }) => {
    await createIdentity(dashboard, 'Personal')
    await addAccount(dashboard, { service: 'GitHub', label: 'GitHub personal' })

    const [opened] = await Promise.all([context.waitForEvent('page'), tile(dashboard, 'GitHub personal').click()])
    await expect(opened).toHaveURL('https://github.com/')
  })

  test('Ctrl+K busca una cuenta, Intro la abre y Escape cierra la paleta', async ({ context, dashboard }) => {
    await createIdentity(dashboard, 'Trabajo')
    await addAccount(dashboard, { service: 'GitHub', label: 'GitHub trabajo' })
    await addAccount(dashboard, { service: 'Claude', label: 'Claude trabajo' })

    await dashboard.keyboard.press('Control+K')
    const search = dashboard.getByRole('combobox', { name: 'Buscar por nombre, servicio, email o usuario' })
    await expect(search).toBeFocused()
    await search.fill('claude')
    await expect(dashboard.getByRole('option')).toHaveCount(1)

    const [opened] = await Promise.all([context.waitForEvent('page'), search.press('Enter')])
    await expect(opened).toHaveURL('https://claude.ai/')
    await expect(search).toBeHidden()

    await dashboard.bringToFront()
    await dashboard.keyboard.press('Control+K')
    await expect(search).toBeVisible()
    await dashboard.keyboard.press('Escape')
    await expect(search).toBeHidden()
  })
})
