import { describe, expect, it } from 'vitest'
import { createTestEnv, EXTENSION_ID, type TestEnv } from '../helpers/env'
import { createFakeHost, type FakeHost } from '../helpers/fake-host'
import { image, imageBytes, pngImage, toBase64 } from '../helpers/images'
import {
  dataWith,
  pairedLocal,
  registerInstallation,
  requestsOf,
  TOKEN_A,
  unpairedLocal,
} from '../helpers/shared-setup'

const KEY = 'icon:img-1'
const AT = '2026-10-01T10:00:00.000Z'

function put(key: string, payload: { mime: string; base64: string }) {
  return { type: 'icon.put', key, ...payload }
}

function account(id: string, icon: unknown) {
  return {
    id,
    identityId: 'ana',
    groupId: null,
    serviceId: 'github',
    label: id,
    icon,
    favorite: false,
    order: 0,
    createdAt: AT,
    updatedAt: AT,
  }
}

function localEnv(): TestEnv {
  return createTestEnv({ local: unpairedLocal('inst-a', dataWith('single', ['ana'])) })
}

function pairedEnv(options: { maxIcons?: number } = {}): { t: TestEnv; fake: FakeHost } {
  const fake = createFakeHost(options)
  registerInstallation(fake, 'inst-a', TOKEN_A)
  fake.state.store = { revision: 1, data: dataWith('multi', ['ana']), bindings: {} }
  const t = createTestEnv({ host: fake, local: pairedLocal('inst-a', TOKEN_A, dataWith('multi', ['ana'])) })
  return { t, fake }
}

function stored(t: TestEnv, key: string): unknown {
  return t.local.dump()[key]
}

describe('imágenes con datos locales', () => {
  it('ida y vuelta: icon.put guarda en storage.local (icon:<id>) e icon.get devuelve lo mismo', async () => {
    const t = localEnv()
    const png = pngImage(40)
    expect(await t.route(put(KEY, png))).toEqual({ ok: true, result: {} })
    expect(stored(t, KEY)).toEqual(png)
    expect(await t.route({ type: 'icon.get', key: KEY })).toEqual({ ok: true, result: png })
  })

  it('icon.get de una clave sin imagen es not_found; icon.delete la borra y es idempotente', async () => {
    const t = localEnv()
    expect(await t.route({ type: 'icon.get', key: KEY })).toEqual({ ok: false, error: { code: 'not_found' } })
    await t.route(put(KEY, pngImage()))
    expect(await t.route({ type: 'icon.delete', key: KEY })).toEqual({ ok: true, result: {} })
    expect(await t.route({ type: 'icon.delete', key: KEY })).toEqual({ ok: true, result: {} })
    expect(stored(t, KEY)).toBeUndefined()
  })

  it('lo guardado se vuelve a validar al leer: un valor dañado en storage.local es not_found', async () => {
    const t = createTestEnv({
      local: { ...unpairedLocal('inst-a', dataWith('single')), [KEY]: { mime: 'image/svg+xml', base64: 'AAAA' } },
    })
    expect(await t.route({ type: 'icon.get', key: KEY })).toEqual({ ok: false, error: { code: 'not_found' } })
  })

  it('acepta png, jpeg y webp', async () => {
    const t = localEnv()
    for (const kind of ['png', 'jpeg', 'webp'] as const) {
      expect(await t.route(put(`icon:${kind}`, image(kind)))).toEqual({ ok: true, result: {} })
    }
  })

  it('un remitente ajeno no puede usar ningún mensaje de imágenes', async () => {
    const t = localEnv()
    const messages = [{ type: 'icon.get', key: KEY }, put(KEY, pngImage()), { type: 'icon.delete', key: KEY }]
    for (const message of messages) {
      for (const url of [`chrome-extension://otra/launcher.html`, `chrome-extension://${EXTENSION_ID}/whoami.html`]) {
        expect(await t.route(message, url)).toEqual({ ok: false, error: { code: 'invalid', hint: 'sender' } })
      }
    }
    expect(stored(t, KEY)).toBeUndefined()
  })
})

describe('validación del mensaje icon.put', () => {
  const invalid = { ok: false, error: { code: 'invalid' } }

  it('un mime falso con bytes de otro tipo se rechaza', async () => {
    const t = localEnv()
    const png = imageBytes('png')
    expect(await t.route(put(KEY, { mime: 'image/jpeg', base64: toBase64(png) }))).toEqual(invalid)
    expect(await t.route(put(KEY, { mime: 'image/webp', base64: toBase64(png) }))).toEqual(invalid)
    expect(await t.route(put(KEY, { mime: 'image/png', base64: toBase64(imageBytes('jpeg')) }))).toEqual(invalid)
    // WebP necesita RIFF y WEBP: RIFF solo no basta.
    const riff = imageBytes('webp')
    riff.set([0x41, 0x56, 0x49, 0x20], 8)
    expect(await t.route(put(KEY, { mime: 'image/webp', base64: toBase64(riff) }))).toEqual(invalid)
    expect(stored(t, KEY)).toBeUndefined()
  })

  it('fuera de la lista blanca (svg, gif, vacío) se rechaza aunque los bytes sean válidos', async () => {
    const t = localEnv()
    for (const mime of ['image/svg+xml', 'image/gif', 'text/html', '', 'IMAGE/PNG', 'image/png ']) {
      expect(await t.route(put(KEY, { mime, base64: pngImage().base64 }))).toEqual(invalid)
    }
  })

  it('32 KiB exactos se aceptan y 32 KiB + 1 se rechazan', async () => {
    const t = localEnv()
    expect(await t.route(put(KEY, pngImage(32 * 1024)))).toEqual({ ok: true, result: {} })
    expect(await t.route(put('icon:grande', pngImage(32 * 1024 + 1)))).toEqual(invalid)
    expect(await t.route(put('icon:grande', pngImage(32 * 1024 + 2)))).toEqual(invalid)
    expect(stored(t, 'icon:grande')).toBeUndefined()
  })

  it('un base64 enorme se rechaza por tamaño sin decodificarlo', async () => {
    const t = localEnv()
    const huge = 'A'.repeat(4_000_000)
    const decoder = globalThis.atob
    let calls = 0
    globalThis.atob = (data: string) => {
      calls++
      return decoder(data)
    }
    try {
      expect(await t.route(put(KEY, { mime: 'image/png', base64: huge }))).toEqual(invalid)
    } finally {
      globalThis.atob = decoder
    }
    expect(calls).toBe(0)
  })

  it('un base64 no canónico se rechaza', async () => {
    const t = localEnv()
    const canonical = pngImage(8).base64 // 8 bytes: termina en "=" con bits de relleno a cero
    expect(canonical.endsWith('=')).toBe(true)
    const stem = canonical.slice(0, -2)
    // Último carácter con bits sobrantes distintos de cero: decodifica a los mismos bytes pero no es canónico.
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
    const last = canonical.charAt(canonical.length - 2)
    const tampered = alphabet.charAt(alphabet.indexOf(last) + 1)
    const cases = [
      stem + tampered + '=',
      canonical.slice(0, -1), // sin relleno
      canonical.replaceAll('+', '-').replaceAll('/', '_') + '=', // base64url con relleno
      ` ${canonical}`,
      `${canonical}\n`,
      canonical.slice(0, 4) + '\n' + canonical.slice(4),
      'iVBORw0KGgo',
      '',
    ]
    for (const base64 of cases) expect(await t.route(put(KEY, { mime: 'image/png', base64 }))).toEqual(invalid)
    expect(stored(t, KEY)).toBeUndefined()
  })

  it('las claves inválidas o de prototipo se rechazan', async () => {
    const t = localEnv()
    const keys = [
      'icon:__proto__',
      'icon:constructor',
      'icon:prototype',
      'icon:',
      'img-1',
      'icon:a/b',
      'icon:' + 'a'.repeat(65),
      'ICON:a',
    ]
    for (const key of keys) {
      expect(await t.route(put(key, pngImage()))).toEqual(invalid)
      expect(await t.route({ type: 'icon.get', key })).toEqual(invalid)
      expect(await t.route({ type: 'icon.delete', key })).toEqual(invalid)
    }
    expect(Object.keys(t.local.dump()).filter((key) => key.startsWith('icon:'))).toEqual([])
  })

  it('un campo extra o un mensaje sin mime se rechaza (objeto estricto)', async () => {
    const t = localEnv()
    expect(await t.route({ ...put(KEY, pngImage()), extra: 1 })).toEqual(invalid)
    expect(await t.route({ type: 'icon.put', key: KEY, base64: pngImage().base64 })).toEqual(invalid)
  })
})

describe('imágenes con la instalación emparejada', () => {
  it('ida y vuelta por el host (icons.*) y nada en storage.local', async () => {
    const { t, fake } = pairedEnv()
    const png = pngImage(40)
    expect(await t.route(put(KEY, png))).toEqual({ ok: true, result: {} })
    expect(fake.state.icons.get(KEY)).toEqual(png)
    expect(stored(t, KEY)).toBeUndefined()
    expect(await t.route({ type: 'icon.get', key: KEY })).toEqual({ ok: true, result: png })
    expect(await t.route({ type: 'icon.delete', key: KEY })).toEqual({ ok: true, result: {} })
    expect(fake.state.icons.size).toBe(0)
    expect(await t.route({ type: 'icon.get', key: KEY })).toEqual({ ok: false, error: { code: 'not_found' } })
    expect(fake.invalidRequests).toBe(0)
  })

  it('con modo Varios perfiles pero sin emparejar, va a storage.local y no llama al host', async () => {
    const fake = createFakeHost()
    const t = createTestEnv({ host: fake, local: unpairedLocal('inst-a', dataWith('multi', ['ana'])) })
    expect(await t.route(put(KEY, pngImage()))).toEqual({ ok: true, result: {} })
    expect(stored(t, KEY)).toEqual(pngImage())
    expect(fake.requests).toEqual([])
  })

  it('not_paired: devuelve el código y borra el emparejamiento local', async () => {
    const { t, fake } = pairedEnv()
    fake.state.installations.splice(0)
    expect(await t.route(put(KEY, pngImage()))).toEqual({ ok: false, error: { code: 'not_paired' } })
    expect(t.local.dump().installation).toEqual({ installationId: 'inst-a', paired: false })
    expect(Object.keys(t.local.dump())).not.toContain('pairing')
  })

  it('too_large del host llega con su pista y limit_reached respeta el tope (reemplazar no suma)', async () => {
    const { t, fake } = pairedEnv({ maxIcons: 2 })
    fake.override = ({ cmd }) => (cmd === 'icons.put' ? { ok: false, error: { code: 'too_large' } } : undefined)
    expect(await t.route(put(KEY, pngImage()))).toEqual({
      ok: false,
      error: { code: 'too_large', hint: 'icon_too_large' },
    })
    fake.override = undefined
    expect((await t.route(put('icon:a', pngImage()))).ok).toBe(true)
    expect((await t.route(put('icon:b', pngImage()))).ok).toBe(true)
    expect(await t.route(put('icon:c', pngImage()))).toEqual({
      ok: false,
      error: { code: 'limit_reached', hint: 'icon_limit' },
    })
    expect((await t.route(put('icon:a', pngImage(32)))).ok).toBe(true)
    expect(fake.state.icons.size).toBe(2)
  })

  it('una respuesta del host con bytes de otro tipo no llega a la interfaz', async () => {
    const { t, fake } = pairedEnv()
    fake.state.icons.set(KEY, { mime: 'image/png', base64: toBase64(imageBytes('jpeg')) })
    expect(await t.route({ type: 'icon.get', key: KEY })).toEqual({
      ok: false,
      error: { code: 'host_error', hint: 'bad_response' },
    })
  })
})

describe('borrado en cascada', () => {
  const ana = { id: 'ana', label: 'ana', color: '#336699', order: 0, createdAt: AT, updatedAt: AT }

  async function withAccount(t: TestEnv, key: string) {
    await t.route(put(key, pngImage()))
    return t.route({
      type: 'data.mutate',
      revision: 0,
      ops: [
        { type: 'identity.put', identity: ana },
        { type: 'account.put', account: account('a1', { type: 'image', key }) },
      ],
    })
  }

  it('al borrar la cuenta se borra su imagen (local)', async () => {
    const t = localEnv()
    expect((await withAccount(t, KEY)).ok).toBe(true)
    expect(stored(t, KEY)).toBeDefined()
    expect((await t.route({ type: 'data.mutate', revision: 0, ops: [{ type: 'account.delete', id: 'a1' }] })).ok).toBe(
      true,
    )
    expect(stored(t, KEY)).toBeUndefined()
  })

  it('al cambiar el icono se borra la imagen anterior y se conserva la nueva', async () => {
    const t = localEnv()
    await withAccount(t, 'icon:vieja')
    await t.route(put('icon:nueva', pngImage()))
    const changed = await t.route({
      type: 'data.mutate',
      revision: 0,
      ops: [{ type: 'account.put', account: account('a1', { type: 'image', key: 'icon:nueva' }) }],
    })
    expect(changed.ok).toBe(true)
    expect(stored(t, 'icon:vieja')).toBeUndefined()
    expect(stored(t, 'icon:nueva')).toBeDefined()
    // Pasar a emoji o a automático también libera la imagen.
    await t.route({
      type: 'data.mutate',
      revision: 0,
      ops: [{ type: 'account.put', account: account('a1', { type: 'auto' }) }],
    })
    expect(stored(t, 'icon:nueva')).toBeUndefined()
  })

  it('una imagen que otra cuenta sigue usando no se borra', async () => {
    const t = localEnv()
    await withAccount(t, KEY)
    await t.route({
      type: 'data.mutate',
      revision: 0,
      ops: [{ type: 'account.put', account: account('a2', { type: 'image', key: KEY }) }],
    })
    await t.route({ type: 'data.mutate', revision: 0, ops: [{ type: 'account.delete', id: 'a1' }] })
    expect(stored(t, KEY)).toBeDefined()
  })

  it('una operación que falla no borra nada', async () => {
    const t = localEnv()
    await withAccount(t, KEY)
    const failed = await t.route({
      type: 'data.mutate',
      revision: 0,
      ops: [{ type: 'account.delete', id: 'no-existe' }],
    })
    expect(failed.ok).toBe(false)
    expect(stored(t, KEY)).toBeDefined()
  })

  it('emparejado: la cascada borra la imagen en el host', async () => {
    const { t, fake } = pairedEnv()
    await withAccount(t, KEY)
    expect(fake.state.icons.has(KEY)).toBe(true)
    expect((await t.route({ type: 'data.mutate', revision: 0, ops: [{ type: 'account.delete', id: 'a1' }] })).ok).toBe(
      true,
    )
    expect(fake.state.icons.size).toBe(0)
    expect(requestsOf(fake, 'icons.delete')).toBe(1)
  })

  it('la importación que deja una imagen sin uso también la borra', async () => {
    const t = localEnv()
    await withAccount(t, KEY)
    const data = dataWith('single', ['ana'])
    const imported = await t.route({ type: 'data.import', revision: 0, mode: 'replace', data })
    expect(imported.ok).toBe(true)
    expect(stored(t, KEY)).toBeUndefined()
  })

  it('una imagen que falta (p. ej. tras importar) deja la cuenta con icono automático: icon.get es not_found', async () => {
    const t = localEnv()
    await t.route({
      type: 'data.mutate',
      revision: 0,
      ops: [
        { type: 'identity.put', identity: ana },
        { type: 'account.put', account: account('a1', { type: 'image', key: KEY }) },
      ],
    })
    expect(await t.route({ type: 'icon.get', key: KEY })).toEqual({ ok: false, error: { code: 'not_found' } })
  })
})
