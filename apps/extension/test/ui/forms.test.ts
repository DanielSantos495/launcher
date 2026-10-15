import { createEmptyData, type Account, type Identity, type LauncherData } from '@account-launcher/core'
import { describe, expect, it } from 'vitest'
import {
  buildAccount,
  buildCustomService,
  buildGroup,
  buildIdentity,
  nextOrder,
  type AccountInput,
  type BuildContext,
  type CustomServiceInput,
  type GroupInput,
  type IdentityInput,
} from '../../src/ui/lib/forms'

const NOW = new Date('2026-10-08T12:00:00.000Z')
const EARLIER = '2026-10-01T10:00:00.000Z'

function context(data: LauncherData = createEmptyData()): BuildContext {
  return { now: NOW, newId: () => 'nuevo-1', data }
}

const IDENTITY_INPUT: IdentityInput = { label: 'Trabajo', email: '', color: '#336699' }
const GROUP_INPUT: GroupInput = { name: 'Correo', color: '#aa5500', icon: '' }
const ACCOUNT_INPUT: AccountInput = {
  label: 'GitHub',
  url: '',
  username: '',
  notes: '',
  serviceId: 'github',
  identityId: 'ana',
  groupId: '',
  icon: '',
  favorite: false,
  contextOverride: '',
}
const SERVICE_INPUT: CustomServiceInput = {
  name: 'Intranet',
  urlTemplate: 'https://intranet.example/{username}',
  multiAccount: 'none',
}

function failures(result: { readonly ok: boolean; readonly error?: unknown }): unknown {
  return result.ok ? undefined : result.error
}

describe('buildAccount', () => {
  it('una cuenta genérica sin URL pide la dirección', () => {
    const result = buildAccount({ ...ACCOUNT_INPUT, serviceId: 'generic', label: 'Intranet' }, context())
    expect(failures(result)).toEqual({ url: 'field.url.required' })
  })

  it('rechaza javascript: con el esquema de la URL', () => {
    const result = buildAccount({ ...ACCOUNT_INPUT, url: 'javascript:alert(1)' }, context())
    expect(failures(result)).toEqual({ url: 'field.url.scheme' })
  })

  it.each([
    ['https://user:pass@example.com/', 'field.url.userinfo'],
    ['https://exa mple.com/', 'field.url.invalid'],
    ['https://example.com/a\u0001b', 'field.url.chars'],
    [`https://example.com/${'a'.repeat(2100)}`, 'field.url.length'],
    ['http://example.com/', 'field.url.scheme'],
  ])('traduce el error de la URL %#', (url, key) => {
    const result = buildAccount({ ...ACCOUNT_INPUT, url }, context())
    expect(failures(result)).toEqual({ url: key })
  })

  it('permite http solo si los ajustes lo permiten', () => {
    const data: LauncherData = { ...createEmptyData(), settings: { ...createEmptyData().settings, allowHttp: true } }
    const result = buildAccount({ ...ACCOUNT_INPUT, url: 'http://intranet.example/' }, context(data))
    expect(result.ok && result.value.url).toBe('http://intranet.example/')
  })

  it('guarda la URL normalizada y recortada', () => {
    const result = buildAccount({ ...ACCOUNT_INPUT, url: '  https://GitHub.com/x  ' }, context())
    expect(result.ok && result.value.url).toBe('https://github.com/x')
  })

  it('omite los textos opcionales vacíos', () => {
    const result = buildAccount({ ...ACCOUNT_INPUT, username: '   ', notes: '  \n ' }, context())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(Object.hasOwn(result.value, 'url')).toBe(false)
    expect(Object.hasOwn(result.value, 'username')).toBe(false)
    expect(Object.hasOwn(result.value, 'notes')).toBe(false)
    expect(Object.hasOwn(result.value, 'contextOverride')).toBe(false)
  })

  it('construye la cuenta completa', () => {
    const result = buildAccount(
      {
        ...ACCOUNT_INPUT,
        label: '  Mi GitHub ',
        username: ' anadev ',
        notes: 'línea 1\n\tlínea 2',
        groupId: 'g1',
        icon: '🐙',
        favorite: true,
        contextOverride: 'current',
      },
      { ...context(), data: { ...createEmptyData(), accounts: [account('otra', 3)] } },
    )
    expect(result).toEqual({
      ok: true,
      value: {
        id: 'nuevo-1',
        identityId: 'ana',
        groupId: 'g1',
        serviceId: 'github',
        label: 'Mi GitHub',
        username: 'anadev',
        notes: 'línea 1\n\tlínea 2',
        icon: { type: 'emoji', value: '🐙' },
        favorite: true,
        contextOverride: 'current',
        order: 4,
        createdAt: NOW.toISOString(),
        updatedAt: NOW.toISOString(),
      },
    })
  })

  it('una etiqueta con un sustituto suelto no es texto válido', () => {
    expect(failures(buildAccount({ ...ACCOUNT_INPUT, label: '\ud800' }, context()))).toEqual({
      label: 'field.invalid_text',
    })
  })

  it('una etiqueta con caracteres de control no es texto válido', () => {
    expect(failures(buildAccount({ ...ACCOUNT_INPUT, label: 'a\u0007b' }, context()))).toEqual({
      label: 'field.invalid_text',
    })
  })

  it('una etiqueta vacía o en blanco es obligatoria', () => {
    expect(failures(buildAccount({ ...ACCOUNT_INPUT, label: '' }, context()))).toEqual({ label: 'field.required' })
    expect(failures(buildAccount({ ...ACCOUNT_INPUT, label: '   ' }, context()))).toEqual({ label: 'field.required' })
  })

  it('la etiqueta admite 80 caracteres y rechaza 81', () => {
    expect(buildAccount({ ...ACCOUNT_INPUT, label: 'a'.repeat(80) }, context()).ok).toBe(true)
    expect(failures(buildAccount({ ...ACCOUNT_INPUT, label: 'a'.repeat(81) }, context()))).toEqual({
      label: 'field.too_long',
    })
  })

  it('el emoji admite 16 unidades UTF-16 y rechaza 17', () => {
    expect(buildAccount({ ...ACCOUNT_INPUT, icon: '😀'.repeat(8) }, context()).ok).toBe(true)
    expect(failures(buildAccount({ ...ACCOUNT_INPUT, icon: 'a'.repeat(17) }, context()))).toEqual({
      icon: 'field.emoji.invalid',
    })
  })

  it('las notas admiten saltos de línea y tabuladores pero no otros controles', () => {
    expect(buildAccount({ ...ACCOUNT_INPUT, notes: 'a\nb\tc' }, context()).ok).toBe(true)
    expect(failures(buildAccount({ ...ACCOUNT_INPUT, notes: 'a\u0000b' }, context()))).toEqual({
      notes: 'field.invalid_text',
    })
    expect(failures(buildAccount({ ...ACCOUNT_INPUT, notes: 'a'.repeat(2001) }, context()))).toEqual({
      notes: 'field.too_long',
    })
  })

  it('el usuario tiene un máximo de 128 caracteres', () => {
    expect(buildAccount({ ...ACCOUNT_INPUT, username: 'u'.repeat(128) }, context()).ok).toBe(true)
    expect(failures(buildAccount({ ...ACCOUNT_INPUT, username: 'u'.repeat(129) }, context()))).toEqual({
      username: 'field.too_long',
    })
  })

  it('recoge varios errores a la vez, uno por campo', () => {
    const result = buildAccount(
      { ...ACCOUNT_INPUT, label: '', url: 'ftp://x.example/', icon: 'a'.repeat(17) },
      context(),
    )
    expect(failures(result)).toEqual({
      label: 'field.required',
      url: 'field.url.scheme',
      icon: 'field.emoji.invalid',
    })
  })

  it('la identidad, el servicio y el contexto no válidos son errores de su campo', () => {
    expect(failures(buildAccount({ ...ACCOUNT_INPUT, identityId: '' }, context()))).toEqual({
      identityId: 'field.required',
    })
    expect(failures(buildAccount({ ...ACCOUNT_INPUT, identityId: 'no válida' }, context()))).toEqual({
      identityId: 'field.invalid',
    })
    expect(failures(buildAccount({ ...ACCOUNT_INPUT, serviceId: 'nada' }, context()))).toEqual({
      serviceId: 'field.invalid',
    })
    expect(failures(buildAccount({ ...ACCOUNT_INPUT, contextOverride: 'otro' }, context()))).toEqual({
      contextOverride: 'field.invalid',
    })
  })

  it('al editar conserva id, orden, createdAt y lastOpenedAt, y actualiza updatedAt', () => {
    const existing: Account = {
      ...account('a1', 7),
      lastOpenedAt: EARLIER,
      username: 'viejo',
      url: 'https://x.example/',
    }
    const result = buildAccount({ ...ACCOUNT_INPUT, label: 'Nuevo nombre' }, context(), existing)
    expect(result).toEqual({
      ok: true,
      value: {
        id: 'a1',
        identityId: 'ana',
        groupId: null,
        serviceId: 'github',
        label: 'Nuevo nombre',
        icon: { type: 'auto' },
        favorite: false,
        order: 7,
        lastOpenedAt: EARLIER,
        createdAt: EARLIER,
        updatedAt: NOW.toISOString(),
      },
    })
  })
})

describe('buildIdentity', () => {
  it('un email que no lo es da error en su campo', () => {
    expect(failures(buildIdentity({ ...IDENTITY_INPUT, email: 'no-es-email' }, context()))).toEqual({
      email: 'field.email.invalid',
    })
  })

  it('con el email vacío la identidad no tiene email', () => {
    const result = buildIdentity({ ...IDENTITY_INPUT, email: '  ' }, context())
    expect(result.ok).toBe(true)
    if (result.ok) expect(Object.hasOwn(result.value, 'email')).toBe(false)
  })

  it('guarda el email recortado y calcula el orden entre las identidades', () => {
    const data: LauncherData = { ...createEmptyData(), identities: [identity('a', 2), identity('b', 5)] }
    const result = buildIdentity({ ...IDENTITY_INPUT, email: ' ana@empresa.example ' }, context(data))
    expect(result).toEqual({
      ok: true,
      value: {
        id: 'nuevo-1',
        label: 'Trabajo',
        email: 'ana@empresa.example',
        color: '#336699',
        order: 6,
        createdAt: NOW.toISOString(),
        updatedAt: NOW.toISOString(),
      },
    })
  })

  it('un color que no es #rrggbb da error', () => {
    expect(failures(buildIdentity({ ...IDENTITY_INPUT, color: 'rojo' }, context()))).toEqual({
      color: 'field.color.invalid',
    })
  })

  it('al editar conserva createdAt, orden y avatar y pone updatedAt a now', () => {
    const existing: Identity = { ...identity('ana', 3), avatar: { type: 'auto' } }
    const result = buildIdentity({ ...IDENTITY_INPUT, label: 'Ana' }, context(), existing)
    expect(result).toEqual({
      ok: true,
      value: {
        id: 'ana',
        label: 'Ana',
        color: '#336699',
        avatar: { type: 'auto' },
        order: 3,
        createdAt: EARLIER,
        updatedAt: NOW.toISOString(),
      },
    })
  })
})

describe('buildGroup', () => {
  it('construye el grupo con su emoji opcional', () => {
    const result = buildGroup({ ...GROUP_INPUT, icon: '📬' }, context())
    expect(result).toEqual({
      ok: true,
      value: {
        id: 'nuevo-1',
        name: 'Correo',
        color: '#aa5500',
        icon: { type: 'emoji', value: '📬' },
        order: 0,
        createdAt: NOW.toISOString(),
        updatedAt: NOW.toISOString(),
      },
    })
  })

  it('sin emoji el grupo no tiene icono', () => {
    const result = buildGroup(GROUP_INPUT, context())
    expect(result.ok && Object.hasOwn(result.value, 'icon')).toBe(false)
  })

  it('el nombre es obligatorio y el emoji tiene límite', () => {
    expect(failures(buildGroup({ ...GROUP_INPUT, name: ' ' }, context()))).toEqual({ name: 'field.required' })
    expect(failures(buildGroup({ ...GROUP_INPUT, icon: 'a'.repeat(17) }, context()))).toEqual({
      icon: 'field.emoji.invalid',
    })
  })

  it('al editar conserva createdAt', () => {
    const existing = { ...GROUP_VALUE }
    const result = buildGroup({ ...GROUP_INPUT, name: 'Otro' }, context(), existing)
    expect(result.ok && result.value.createdAt).toBe(EARLIER)
    expect(result.ok && result.value.updatedAt).toBe(NOW.toISOString())
    expect(result.ok && result.value.order).toBe(4)
  })
})

const GROUP_VALUE = {
  id: 'g1',
  name: 'Correo',
  color: '#aa5500',
  order: 4,
  createdAt: EARLIER,
  updatedAt: EARLIER,
}

describe('buildCustomService', () => {
  it('una plantilla con un marcador desconocido no vale', () => {
    const result = buildCustomService({ ...SERVICE_INPUT, urlTemplate: 'https://x.example/{name}' }, context())
    expect(failures(result)).toEqual({ urlTemplate: 'field.template.invalid' })
  })

  it('una plantilla vacía es obligatoria', () => {
    expect(failures(buildCustomService({ ...SERVICE_INPUT, urlTemplate: ' ' }, context()))).toEqual({
      urlTemplate: 'field.required',
    })
  })

  it('una plantilla http solo vale si los ajustes la permiten', () => {
    const input = { ...SERVICE_INPUT, urlTemplate: 'http://intranet.example/{username}' }
    expect(failures(buildCustomService(input, context()))).toEqual({ urlTemplate: 'field.template.invalid' })
    const data: LauncherData = { ...createEmptyData(), settings: { ...createEmptyData().settings, allowHttp: true } }
    expect(buildCustomService(input, context(data)).ok).toBe(true)
  })

  it('construye el servicio y rechaza un modo de varias cuentas desconocido', () => {
    expect(buildCustomService({ ...SERVICE_INPUT, multiAccount: 'parallel' }, context())).toEqual({
      ok: true,
      value: {
        id: 'nuevo-1',
        name: 'Intranet',
        urlTemplate: 'https://intranet.example/{username}',
        multiAccount: 'parallel',
        createdAt: NOW.toISOString(),
        updatedAt: NOW.toISOString(),
      },
    })
    expect(failures(buildCustomService({ ...SERVICE_INPUT, multiAccount: 'todas' }, context()))).toEqual({
      multiAccount: 'field.invalid',
    })
  })

  it('el nombre es obligatorio y al editar conserva createdAt', () => {
    expect(failures(buildCustomService({ ...SERVICE_INPUT, name: '' }, context()))).toEqual({ name: 'field.required' })
    const existing = { id: 's1', ...SERVICE_VALUE }
    const result = buildCustomService({ ...SERVICE_INPUT, name: 'Otro' }, context(), existing)
    expect(result.ok && result.value.id).toBe('s1')
    expect(result.ok && result.value.createdAt).toBe(EARLIER)
    expect(result.ok && result.value.updatedAt).toBe(NOW.toISOString())
  })
})

const SERVICE_VALUE = {
  name: 'Viejo',
  urlTemplate: 'https://v.example/{email}',
  multiAccount: 'none' as const,
  createdAt: EARLIER,
  updatedAt: EARLIER,
}

describe('nextOrder', () => {
  it('es 0 si no hay elementos', () => {
    expect(nextOrder([])).toBe(0)
  })

  it('es el máximo más uno', () => {
    expect(nextOrder([{ order: 4 }, { order: 9 }])).toBe(10)
  })

  it('no pasa del tope', () => {
    expect(nextOrder([{ order: 1_000_000 }])).toBe(1_000_000)
    expect(nextOrder([{ order: 999_999 }])).toBe(1_000_000)
  })
})

function identity(id: string, order: number): Identity {
  return { id, label: id, color: '#336699', order, createdAt: EARLIER, updatedAt: EARLIER }
}

function account(id: string, order: number): Account {
  return {
    id,
    identityId: 'ana',
    groupId: null,
    serviceId: 'github',
    label: id,
    icon: { type: 'auto' },
    favorite: false,
    order,
    createdAt: EARLIER,
    updatedAt: EARLIER,
  }
}
