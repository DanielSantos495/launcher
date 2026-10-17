import type { Download, Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { addAccount, createIdentity, expect, openSettings, test, tile } from './fixtures'

// Descarga la copia con «Exportar copia» y devuelve su texto.
async function exportCopy(page: Page): Promise<{ readonly download: Download; readonly text: string }> {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Exportar copia' }).click(),
  ])
  return { download, text: readFileSync(await download.path(), 'utf8') }
}

// Elige un archivo en «Importar copia» (el input va oculto dentro de la etiqueta del botón).
async function chooseImportFile(page: Page, name: string, text: string): Promise<void> {
  await page
    .locator('input[type="file"]')
    .setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(text) })
}

test.describe('Copia de seguridad', () => {
  test('exporta la lista, se borra todo y al importar la copia vuelve', async ({ dashboard }) => {
    await createIdentity(dashboard, 'Trabajo')
    await addAccount(dashboard, { service: 'GitHub', label: 'GitHub trabajo' })
    await openSettings(dashboard)

    const { download, text } = await exportCopy(dashboard)
    expect(download.suggestedFilename()).toMatch(/^account-launcher-\d{4}-\d{2}-\d{2}\.json$/)
    expect(text).toContain('GitHub trabajo')

    // Se vacía la lista borrando la identidad y su cuenta.
    await dashboard.getByRole('button', { name: 'Volver a las cuentas' }).click()
    await dashboard.getByRole('button', { name: 'Acciones de Trabajo' }).click()
    await dashboard.getByRole('menuitem', { name: 'Borrar identidad' }).click()
    await dashboard.getByRole('button', { name: 'Borrar la identidad y su cuenta' }).click()
    await expect(dashboard.getByRole('heading', { name: 'Crea tu primera identidad para empezar' })).toBeVisible()

    await openSettings(dashboard)
    await chooseImportFile(dashboard, 'copia.json', text)
    const dialog = dashboard.getByRole('dialog', { name: 'Importar copia' })
    await dialog.getByRole('button', { name: 'Fusionar' }).click()
    await expect(dashboard.getByRole('status').filter({ hasText: 'Importación terminada' })).toBeVisible()

    await dashboard.getByRole('button', { name: 'Volver a las cuentas' }).click()
    await expect(tile(dashboard, 'GitHub trabajo')).toBeVisible()
  })

  test('rechaza un JSON inválido y deja la lista como estaba', async ({ dashboard }) => {
    await createIdentity(dashboard, 'Trabajo')
    await openSettings(dashboard)

    await chooseImportFile(dashboard, 'roto.json', '{"esto no es json')
    await expect(dashboard.getByRole('alert').getByText('El archivo no es un JSON válido.')).toBeVisible()
    await expect(dashboard.getByRole('dialog')).toHaveCount(0)

    await chooseImportFile(dashboard, 'otro.json', '{"hola": 1}')
    await expect(
      dashboard.getByRole('alert').getByText('Este archivo no es una copia de Account Launcher.'),
    ).toBeVisible()

    await dashboard.getByRole('button', { name: 'Volver a las cuentas' }).click()
    await expect(dashboard.getByRole('heading', { name: 'Trabajo', level: 2 })).toBeVisible()
  })

  test('rechaza una copia con una dirección javascript: y no guarda nada', async ({ dashboard }) => {
    await createIdentity(dashboard, 'Trabajo')
    await addAccount(dashboard, { service: 'GitHub', label: 'GitHub trabajo' })
    await openSettings(dashboard)
    const { text } = await exportCopy(dashboard)

    // La cuenta pasa a llevar una dirección javascript:, que no es una dirección web admitida.
    const withUrl = (url: string): string =>
      text.replace('"label": "GitHub trabajo"', `"label": "GitHub trabajo", "url": "${url}"`)
    const hostile = withUrl('javascript:alert(1)')
    expect(hostile).not.toBe(text)
    await chooseImportFile(dashboard, 'hostil.json', hostile)

    await expect(dashboard.getByRole('alert').getByText('El archivo tiene datos no válidos.')).toBeVisible()
    await expect(dashboard.getByRole('dialog')).toHaveCount(0)
    await expect(dashboard.getByText('javascript:alert(1)')).toHaveCount(0)

    await dashboard.getByRole('button', { name: 'Volver a las cuentas' }).click()
    await expect(tile(dashboard, 'GitHub trabajo')).toBeVisible()

    // Control: la misma copia con una dirección https sí llega a la vista previa (el rechazo es por javascript:).
    await openSettings(dashboard)
    await chooseImportFile(dashboard, 'https.json', withUrl('https://example.com/entrar'))
    await expect(dashboard.getByRole('dialog', { name: 'Importar copia' })).toBeVisible()
  })
})
