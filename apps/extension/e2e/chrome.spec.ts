import { chromium, expect, test } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

// Prueba de humo con el Google Chrome instalado. Se pide a propósito (E2E_CHROME=1): abre una ventana real de Chrome,
// aunque con un perfil temporal, así que no corre en `pnpm e2e` a secas ni en CI.
test.skip(process.env['E2E_CHROME'] !== '1', 'Solo con E2E_CHROME=1: abre el Google Chrome instalado')

test('Chrome carga la extensión y crea una identidad', async () => {
  const extensionPath = resolve(import.meta.dirname, '..', '.output', 'chrome-mv3')
  const userDataDir = mkdtempSync(join(tmpdir(), 'account-launcher-e2e-chrome-'))
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chrome',
    headless: false,
    locale: 'es-ES',
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  })
  try {
    const worker = await context.waitForEvent('serviceworker', { timeout: 10_000 }).catch(() => undefined)
    if (worker === undefined) {
      // Observado con Google Chrome 155: no carga extensiones descomprimidas por flag. Es una limitación del navegador,
      // no un fallo de la extensión. Queda documentado en e2e/README.md.
      const page = context.pages()[0] ?? (await context.newPage())
      const version = await page.evaluate(() => navigator.userAgent)
      test.skip(true, `Este Chrome no carga extensiones descomprimidas por flag (${version})`)
      return
    }
    const page = await context.newPage()
    await page.goto(new URL('/launcher.html', worker.url()).href)
    await expect(page.getByRole('heading', { name: 'Crea tu primera identidad para empezar' })).toBeVisible()
    await page.getByRole('button', { name: 'Crear identidad' }).click()
    const dialog = page.getByRole('dialog', { name: 'Nueva identidad' })
    await dialog.getByLabel('Nombre').fill('Trabajo')
    await dialog.getByRole('button', { name: 'Crear identidad' }).click()
    await expect(page.getByRole('heading', { name: 'Trabajo', level: 2 })).toBeVisible()
  } finally {
    await context.close()
    rmSync(userDataDir, { recursive: true, force: true })
  }
})
