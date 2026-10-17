import { createIdentity, expect, openSettings, test } from './fixtures'

test.describe('Sin el programa launcher-host', () => {
  test('Varios perfiles explica que el Chromium de Playwright no es un navegador compatible', async ({ dashboard }) => {
    await createIdentity(dashboard, 'Trabajo')
    await openSettings(dashboard)

    await expect(dashboard.getByRole('radio', { name: 'Perfil único' })).toBeChecked()
    await dashboard.getByRole('radio', { name: 'Varios perfiles' }).click()

    // Chromium se presenta como «Chromium», una marca que la extensión no acepta: no elige host y lo explica.
    // La guía con pasos (descarga, comando y «Comprobar de nuevo») solo sale en Brave, Chrome o Edge sin el programa.
    const guide = dashboard.getByRole('region', { name: 'Instala el programa launcher-host' })
    await expect(guide).toBeVisible()
    await expect(guide.getByText('Este navegador no es Brave, Chrome ni Edge.')).toBeVisible()
  })
})
