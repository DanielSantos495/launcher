import { chromium, expect, test as base, type BrowserContext, type Locator, type Page } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

// Compilación que se carga: la que deja `pnpm build` (wxt build) en .output/chrome-mv3.
const BUILD_DIR = resolve(import.meta.dirname, '..', '.output', 'chrome-mv3')

// Página que sustituye a cualquier web externa: las pruebas no salen a internet.
const STUB_PAGE = '<!doctype html><title>stub</title><p>stub</p>'

interface Fixtures {
  // Carpeta con la extensión descomprimida; es una opción para poder cambiarla desde la configuración.
  extensionPath: string
  // Navegador con perfil temporal propio y la extensión cargada.
  context: BrowserContext
  // Dashboard de la extensión, ya cargado.
  dashboard: Page
}

export const test = base.extend<Fixtures>({
  extensionPath: [BUILD_DIR, { option: true }],

  context: async ({ extensionPath }, use) => {
    // Perfil nuevo en cada prueba: nada de lo que hace una prueba llega a la siguiente ni a los perfiles reales.
    const userDataDir = mkdtempSync(join(tmpdir(), 'account-launcher-e2e-'))
    const context = await chromium.launchPersistentContext(userDataDir, {
      // El Chromium de Playwright en el modo headless nuevo, el único que carga extensiones.
      channel: 'chromium',
      headless: true,
      // La interfaz está en español; con idioma automático sigue al del navegador.
      locale: 'es-ES',
      acceptDownloads: true,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    })
    // Las webs que abre la extensión se sustituyen por una página vacía: sin tráfico externo.
    await context.route(/^https?:\/\//, (route) => route.fulfill({ contentType: 'text/html', body: STUB_PAGE }))
    try {
      await use(context)
    } finally {
      await context.close()
      rmSync(userDataDir, { recursive: true, force: true })
    }
  },

  dashboard: async ({ context }, use) => {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'))
    // La extensión abre sola su dashboard al instalarse; se cierra para empezar siempre desde una pestaña propia.
    const page = await context.newPage()
    await page.goto(new URL('/launcher.html', worker.url()).href)
    for (const other of context.pages()) {
      if (other !== page && other.url().endsWith('/launcher.html')) await other.close()
    }
    await expect(page.getByRole('heading', { name: 'Account Launcher' })).toBeVisible()
    await use(page)
  },
})

export { expect }

// Crea una identidad desde el formulario de «Nueva identidad» (el diálogo ya abierto o el botón que lo abre).
export async function createIdentity(page: Page, name: string, email?: string): Promise<void> {
  const dialog = page.getByRole('dialog', { name: 'Nueva identidad' })
  if (!(await dialog.isVisible())) {
    const first = page.getByRole('button', { name: 'Crear identidad' })
    if (await first.isVisible()) await first.click()
    else await page.getByRole('button', { name: 'Añadir identidad' }).click()
  }
  await dialog.getByLabel('Nombre').fill(name)
  if (email !== undefined) await dialog.getByLabel('Email (opcional)').fill(email)
  await dialog.getByRole('button', { name: 'Crear identidad' }).click()
  await expect(dialog).toBeHidden()
}

interface NewAccount {
  readonly service: string
  readonly label: string
  readonly username?: string
}

// Añade una cuenta con el botón «Añadir cuenta» de la cabecera.
export async function addAccount(page: Page, account: NewAccount): Promise<void> {
  await page.getByRole('banner').getByRole('button', { name: 'Añadir cuenta' }).click()
  const dialog = page.getByRole('dialog', { name: 'Añadir cuenta' })
  await dialog.getByLabel('Servicio').selectOption({ label: account.service })
  await dialog.getByLabel('Etiqueta').fill(account.label)
  if (account.username !== undefined) await dialog.getByLabel('Usuario o email (opcional)').fill(account.username)
  await dialog.getByRole('button', { name: 'Guardar cuenta' }).click()
  await expect(dialog).toBeHidden()
}

// Botón principal de una tarjeta de cuenta (el que la abre), sin confundirlo con su estrella ni su menú.
export function tile(page: Page, label: string): Locator {
  return page.getByRole('button', { name: label, exact: true })
}

// Abre Configuración.
export async function openSettings(page: Page): Promise<void> {
  await page.getByRole('banner').getByRole('button', { name: 'Configuración' }).click()
  await expect(page.getByRole('heading', { name: 'Configuración', level: 2 })).toBeVisible()
}
