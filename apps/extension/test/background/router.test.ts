import { createEmptyData, type Identity } from '@account-launcher/core'
import { describe, expect, it, vi } from 'vitest'
import { withMode } from '../../src/background/mode'
import { createRouter } from '../../src/background/router'
import { createTestEnv, EXTENSION_ID, LAUNCHER_URL } from '../helpers/env'
import { slowReads } from '../helpers/slow-reads'

const AT = '2026-10-01T10:00:00.000Z'

function identity(id: string): Identity {
  return { id, label: id, color: '#336699', order: 0, createdAt: AT, updatedAt: AT }
}

const putIdentity = (id: string) => ({ type: 'identity.put', identity: identity(id) })

describe('router: remitente', () => {
  it('un id de extensión distinto es sender y no toca el almacenamiento', async () => {
    const t = createTestEnv()
    const route = createRouter(t.env)
    const response = await route({ type: 'data.get' }, { id: 'otroid', url: LAUNCHER_URL })
    expect(response).toEqual({ ok: false, error: { code: 'invalid', hint: 'sender' } })
    expect(t.local.dump()).toEqual({})
    expect(t.session.dump()).toEqual({})
  })

  it('un origen distinto es sender', async () => {
    const t = createTestEnv()
    const response = await t.route({ type: 'data.get' }, 'chrome-extension://otroid/launcher.html')
    expect(response).toEqual({ ok: false, error: { code: 'invalid', hint: 'sender' } })
    expect(t.local.dump()).toEqual({})
  })

  it('el mismo origen en /whoami.html no puede enviar mensajes de la UI', async () => {
    const t = createTestEnv()
    const response = await t.route({ type: 'data.get' }, `chrome-extension://${EXTENSION_ID}/whoami.html`)
    expect(response).toEqual({ ok: false, error: { code: 'invalid', hint: 'sender' } })
    expect(t.local.dump()).toEqual({})
  })

  it('sin url es sender', async () => {
    const t = createTestEnv()
    const route = createRouter(t.env)
    const response = await route({ type: 'data.get' }, { id: EXTENSION_ID })
    expect(response).toEqual({ ok: false, error: { code: 'invalid', hint: 'sender' } })
    expect(t.local.dump()).toEqual({})
  })

  it('sin id es sender', async () => {
    const t = createTestEnv()
    const route = createRouter(t.env)
    const response = await route({ type: 'data.get' }, { url: LAUNCHER_URL })
    expect(response).toEqual({ ok: false, error: { code: 'invalid', hint: 'sender' } })
  })

  it.each([
    ['una url que no se puede interpretar', 'no es una url'],
    ['otro esquema con el mismo id', `https://${EXTENSION_ID}/launcher.html`],
    ['moz-extension', `moz-extension://${EXTENSION_ID}/launcher.html`],
    ['credenciales en la url', `chrome-extension://usuario@${EXTENSION_ID}/launcher.html`],
    ['un puerto', `chrome-extension://${EXTENSION_ID}:80/launcher.html`],
    ['el id como prefijo de otro host', `chrome-extension://${EXTENSION_ID}x/launcher.html`],
    ['otra ruta', `chrome-extension://${EXTENSION_ID}/launcher.html/extra`],
    ['una ruta que solo contiene launcher.html', `chrome-extension://${EXTENSION_ID}//launcher.html`],
  ])('%s es sender', async (_name, url) => {
    const t = createTestEnv()
    const response = await t.route({ type: 'data.get' }, url)
    expect(response).toEqual({ ok: false, error: { code: 'invalid', hint: 'sender' } })
    expect(t.local.dump()).toEqual({})
  })

  it('acepta el launcher con hash o consulta', async () => {
    const t = createTestEnv()
    const response = await t.route({ type: 'data.get' }, `${LAUNCHER_URL}?x=1#vista`)
    expect(response.ok).toBe(true)
  })
})

describe('router: mensajes', () => {
  it.each([
    ['un campo de más', { type: 'data.get', extra: 'secreto@example.com' }],
    ['un tipo desconocido', { type: 'nope' }],
    ['null', null],
    ['un array', []],
    ['una cadena', 'data.get'],
  ])('%s: invalid sin pistas ni datos', async (_name, message) => {
    const t = createTestEnv()
    const response = await t.route(message)
    expect(response).toEqual({ ok: false, error: { code: 'invalid' } })
    expect(JSON.stringify(response)).not.toContain('secreto')
    expect(t.local.dump()).toEqual({})
  })

  it('un mensaje inválido no revela el valor recibido', async () => {
    const t = createTestEnv()
    const response = await t.route({ type: 'bindings.set', identityId: 'ana@example.com', binding: null })
    expect(response).toEqual({ ok: false, error: { code: 'invalid' } })
    expect(JSON.stringify(response)).not.toContain('example.com')
  })

  it('una excepción interna es internal sin el mensaje de la excepción', async () => {
    const t = createTestEnv()
    vi.spyOn(t.local, 'get').mockRejectedValue(new Error('boom /Users/ana'))
    const response = await t.route({ type: 'data.get' })
    expect(response).toEqual({ ok: false, error: { code: 'internal' } })
    const text = JSON.stringify(response)
    expect(text).not.toContain('boom')
    expect(text).not.toContain('/Users')
  })

  it('una excepción no cambia lo ya guardado y la cola sigue funcionando', async () => {
    const t = createTestEnv()
    const spy = vi.spyOn(t.local, 'get').mockRejectedValueOnce(new Error('boom'))
    expect(await t.route({ type: 'data.mutate', revision: 0, ops: [putIdentity('ana')] })).toEqual({
      ok: false,
      error: { code: 'internal' },
    })
    spy.mockRestore()
    const response = await t.route({ type: 'data.mutate', revision: 0, ops: [putIdentity('ana')] })
    expect(response).toEqual({ ok: true, result: { revision: 1 } })
  })
})

describe('router: data.get', () => {
  it('en una instalación nueva devuelve datos vacíos de origen local', async () => {
    const t = createTestEnv()
    const response = await t.route({ type: 'data.get' })
    expect(response).toEqual({ ok: true, result: { data: createEmptyData(), source: 'local' } })
    expect(t.local.dump()).toEqual({ installation: { installationId: 'id-1', paired: false } })
  })

  it('datos locales dañados son internal con la pista y no se tocan', async () => {
    const t = createTestEnv({ local: { localData: { ...createEmptyData(), schemaVersion: 2 } } })
    const response = await t.route({ type: 'data.get' })
    expect(response).toEqual({ ok: false, error: { code: 'internal', hint: 'local_data_newer' } })
    expect(t.local.dump().localData).toEqual({ ...createEmptyData(), schemaVersion: 2 })
  })

  it('dos get a la vez en una instalación nueva crean una sola instalación', async () => {
    const t = createTestEnv()
    slowReads(t.local)
    await Promise.all([t.route({ type: 'data.get' }), t.route({ type: 'data.get' })])
    expect(t.local.dump().installation).toEqual({ installationId: 'id-1', paired: false })
    expect(t.deps.randomId()).toBe('id-2')
  })
})

describe('router: data.mutate', () => {
  it('aplica las operaciones, ignora la revisión del mensaje y devuelve la nueva', async () => {
    const t = createTestEnv()
    const response = await t.route({ type: 'data.mutate', revision: 999, ops: [putIdentity('ana')] })
    expect(response).toEqual({ ok: true, result: { revision: 1 } })
    const got = await t.route({ type: 'data.get' })
    expect(got).toEqual({
      ok: true,
      result: { data: { ...createEmptyData(), revision: 1, identities: [identity('ana')] }, source: 'local' },
    })
  })

  it('una cuenta con identidad desconocida es op_invalid y no guarda nada', async () => {
    const t = createTestEnv()
    const account = {
      id: 'acc',
      identityId: 'fantasma',
      groupId: null,
      serviceId: 'github',
      label: 'GitHub',
      icon: { type: 'auto' },
      favorite: false,
      order: 0,
      createdAt: AT,
      updatedAt: AT,
    }
    const response = await t.route({ type: 'data.mutate', revision: 0, ops: [{ type: 'account.put', account }] })
    expect(response).toEqual({ ok: false, error: { code: 'invalid', hint: 'op_invalid' } })
    expect(Object.keys(t.local.dump())).not.toContain('localData')
  })

  it('borrar una identidad con cuentas es in_use', async () => {
    const t = createTestEnv()
    const account = {
      id: 'acc',
      identityId: 'ana',
      groupId: null,
      serviceId: 'github',
      label: 'GitHub',
      icon: { type: 'auto' },
      favorite: false,
      order: 0,
      createdAt: AT,
      updatedAt: AT,
    }
    await t.route({ type: 'data.mutate', revision: 0, ops: [putIdentity('ana'), { type: 'account.put', account }] })
    const response = await t.route({ type: 'data.mutate', revision: 0, ops: [{ type: 'identity.delete', id: 'ana' }] })
    expect(response).toEqual({ ok: false, error: { code: 'invalid', hint: 'in_use' } })
    const got = await t.route({ type: 'data.get' })
    expect(got).toMatchObject({ ok: true, result: { data: { revision: 1 } } })
  })

  it('borrar una cuenta inexistente es not_found', async () => {
    const t = createTestEnv()
    const response = await t.route({ type: 'data.mutate', revision: 0, ops: [{ type: 'account.delete', id: 'nada' }] })
    expect(response).toEqual({ ok: false, error: { code: 'not_found' } })
  })

  it('un set que falla es storage_write y no cambia los datos', async () => {
    const t = createTestEnv()
    await t.route({ type: 'data.get' })
    t.local.failNextSet()
    const response = await t.route({ type: 'data.mutate', revision: 0, ops: [putIdentity('ana')] })
    expect(response).toEqual({ ok: false, error: { code: 'internal', hint: 'storage_write' } })
    const got = await t.route({ type: 'data.get' })
    expect(got).toEqual({ ok: true, result: { data: createEmptyData(), source: 'local' } })
  })

  it('dos mutaciones a la vez se serializan: las dos identidades quedan y la revisión es 2', async () => {
    const t = createTestEnv()
    const [a, b] = await Promise.all([
      t.route({ type: 'data.mutate', revision: 0, ops: [putIdentity('a')] }),
      t.route({ type: 'data.mutate', revision: 0, ops: [putIdentity('b')] }),
    ])
    expect(a).toEqual({ ok: true, result: { revision: 1 } })
    expect(b).toEqual({ ok: true, result: { revision: 2 } })
    // La cola respeta el orden de llegada: la identidad a queda antes que la b.
    const got = await t.route({ type: 'data.get' })
    expect(got).toEqual({
      ok: true,
      result: {
        data: { ...createEmptyData(), revision: 2, identities: [identity('a'), identity('b')] },
        source: 'local',
      },
    })
  })

  it('cambiar settings.mode con settings.set se refleja en data.get', async () => {
    const t = createTestEnv()
    await t.route({ type: 'data.mutate', revision: 0, ops: [{ type: 'settings.set', settings: { mode: 'multi' } }] })
    const got = await t.route({ type: 'data.get' })
    expect(got).toMatchObject({ ok: true, result: { data: { settings: { mode: 'multi' } } } })
  })
})

describe('router: bindings', () => {
  it('bindings.get devuelve un objeto vacío en una instalación nueva', async () => {
    const t = createTestEnv()
    expect(await t.route({ type: 'bindings.get' })).toEqual({ ok: true, result: { bindings: {} } })
  })

  it('bindings.set de una identidad inexistente es not_found y no guarda nada', async () => {
    const t = createTestEnv()
    const response = await t.route({ type: 'bindings.set', identityId: 'fantasma', binding: { kind: 'current' } })
    expect(response).toEqual({ ok: false, error: { code: 'not_found' } })
    expect(Object.keys(t.local.dump())).not.toContain('localBindings')
  })

  it('guarda un vínculo, lo devuelve y lo borra con null', async () => {
    const t = createTestEnv()
    await t.route({ type: 'data.mutate', revision: 0, ops: [putIdentity('ana'), putIdentity('bea')] })
    expect(await t.route({ type: 'bindings.set', identityId: 'ana', binding: { kind: 'current' } })).toEqual({
      ok: true,
      result: {},
    })
    await t.route({
      type: 'bindings.set',
      identityId: 'bea',
      binding: { kind: 'chromium-profile', profileDirectory: 'Profile 1' },
    })
    expect(await t.route({ type: 'bindings.get' })).toEqual({
      ok: true,
      result: {
        bindings: { ana: { kind: 'current' }, bea: { kind: 'chromium-profile', profileDirectory: 'Profile 1' } },
      },
    })
    expect(await t.route({ type: 'bindings.set', identityId: 'ana', binding: null })).toEqual({ ok: true, result: {} })
    expect(await t.route({ type: 'bindings.get' })).toEqual({
      ok: true,
      result: { bindings: { bea: { kind: 'chromium-profile', profileDirectory: 'Profile 1' } } },
    })
  })

  it('reemplazar un vínculo no duplica la entrada y solo hay ids propios', async () => {
    const t = createTestEnv()
    await t.route({ type: 'data.mutate', revision: 0, ops: [putIdentity('ana')] })
    await t.route({ type: 'bindings.set', identityId: 'ana', binding: { kind: 'current' } })
    await t.route({
      type: 'bindings.set',
      identityId: 'ana',
      binding: { kind: 'chromium-profile', profileDirectory: 'Default', desiredName: 'Ana' },
    })
    // toStrictEqual compara también las claves propias: no puede haber ninguna más.
    expect(await t.route({ type: 'bindings.get' })).toStrictEqual({
      ok: true,
      result: { bindings: { ana: { kind: 'chromium-profile', profileDirectory: 'Default', desiredName: 'Ana' } } },
    })
  })

  it('dos bindings.set a la vez se serializan y no pierden ninguno', async () => {
    const t = createTestEnv()
    await t.route({ type: 'data.mutate', revision: 0, ops: [putIdentity('ana'), putIdentity('bea')] })
    await Promise.all([
      t.route({ type: 'bindings.set', identityId: 'ana', binding: { kind: 'current' } }),
      t.route({
        type: 'bindings.set',
        identityId: 'bea',
        binding: { kind: 'chromium-profile', profileDirectory: 'Profile 1' },
      }),
    ])
    expect(await t.route({ type: 'bindings.get' })).toEqual({
      ok: true,
      result: {
        bindings: { ana: { kind: 'current' }, bea: { kind: 'chromium-profile', profileDirectory: 'Profile 1' } },
      },
    })
  })

  it('un id de prototipo se rechaza antes de llegar al almacén', async () => {
    const t = createTestEnv()
    for (const identityId of ['__proto__', 'constructor', 'prototype']) {
      const response = await t.route({ type: 'bindings.set', identityId, binding: { kind: 'current' } })
      expect(response).toEqual({ ok: false, error: { code: 'invalid' } })
    }
    expect(Object.keys(t.local.dump())).not.toContain('localBindings')
  })

  it('bindings.set tampoco cambia los datos', async () => {
    const t = createTestEnv()
    await t.route({ type: 'data.mutate', revision: 0, ops: [putIdentity('ana')] })
    const before = t.local.dump().localData
    await t.route({ type: 'bindings.set', identityId: 'ana', binding: { kind: 'current' } })
    expect(t.local.dump().localData).toEqual(before)
  })

  it('vínculos locales dañados son internal con la pista', async () => {
    const t = createTestEnv({ local: { localBindings: { ana: { kind: 'otro' } } } })
    expect(await t.route({ type: 'bindings.get' })).toEqual({
      ok: false,
      error: { code: 'internal', hint: 'local_bindings_invalid' },
    })
  })
})

describe('router: datos locales dañados', () => {
  const damaged = { ...createEmptyData(), schemaVersion: 2 }

  it.each([
    ['data.mutate', { type: 'data.mutate', revision: 0, ops: [putIdentity('ana')] }],
    ['bindings.get', { type: 'bindings.get' }],
    ['bindings.set', { type: 'bindings.set', identityId: 'ana', binding: null }],
    ['account.open', { type: 'account.open', accountId: 'mail' }],
  ])('%s devuelve el error de lectura y no escribe nada', async (_type, message) => {
    const t = createTestEnv({ local: { localData: damaged } })
    expect(await t.route(message)).toEqual({ ok: false, error: { code: 'internal', hint: 'local_data_newer' } })
    expect(t.local.dump().localData).toEqual(damaged)
    expect(Object.keys(t.local.dump())).not.toContain('localBindings')
    expect(t.deps.opened).toEqual([])
  })
})

describe('withMode', () => {
  it('devuelve una copia con el modo indicado y no cambia el original', () => {
    const original = createEmptyData()
    const multi = withMode(original, 'multi')
    expect(multi.settings.mode).toBe('multi')
    expect(multi).toEqual({ ...original, settings: { ...original.settings, mode: 'multi' } })
    expect(original.settings.mode).toBe('single')
    expect(withMode(multi, 'single')).toEqual(original)
  })
})
