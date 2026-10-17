import {
  createEmptyData,
  MAX_IMPORT_BYTES,
  type Account,
  type Bindings,
  type Identity,
  type LauncherData,
  type ProfileInfo,
} from '@account-launcher/core'
import { describe, expect, it } from 'vitest'
import {
  buildExport,
  checkFileSize,
  exportFilename,
  previewImport,
  readImportText,
} from '../../src/ui/lib/import-export'

const T1 = '2026-10-01T10:00:00.000Z'
const T2 = '2026-10-02T10:00:00.000Z'
const NOW = new Date('2026-10-08T23:30:00.000Z')

function identity(id: string, updatedAt = T1): Identity {
  return { id, label: id, color: '#336699', order: 0, createdAt: T1, updatedAt }
}

function account(id: string, identityId: string, updatedAt = T1, url?: string): Account {
  return {
    id,
    identityId,
    groupId: null,
    serviceId: 'github',
    label: id,
    ...(url === undefined ? {} : { url }),
    icon: { type: 'auto' },
    favorite: false,
    order: 0,
    createdAt: T1,
    updatedAt,
  }
}

function dataOf(identities: Identity[], accounts: Account[] = []): LauncherData {
  return { ...createEmptyData(), revision: 1, identities, accounts }
}

describe('checkFileSize', () => {
  it('acepta el tamaño máximo', () => {
    expect(checkFileSize(MAX_IMPORT_BYTES)).toEqual({ ok: true, value: undefined })
  })

  it('rechaza un byte más con too_large', () => {
    expect(checkFileSize(MAX_IMPORT_BYTES + 1)).toEqual({ ok: false, error: { code: 'too_large' } })
  })
})

describe('exportFilename', () => {
  it('usa la fecha UTC', () => {
    expect(exportFilename(NOW)).toBe('account-launcher-2026-10-08.json')
  })

  it('a las 00:00 UTC sigue siendo ese día, y un segundo antes, el anterior', () => {
    expect(exportFilename(new Date('2026-10-09T00:00:00.000Z'))).toBe('account-launcher-2026-10-09.json')
    expect(exportFilename(new Date('2026-10-08T23:59:59.999Z'))).toBe('account-launcher-2026-10-08.json')
  })
})

describe('buildExport y readImportText', () => {
  const profiles: ProfileInfo[] = [
    { directory: 'Default', name: 'Personal', isUsingDefaultName: false },
    { directory: 'Profile 1', name: 'Persona 1', isUsingDefaultName: true },
  ]
  const data = dataOf([identity('i1'), identity('i2'), identity('i3')], [account('a1', 'i1')])
  const bindings: Bindings = {
    i1: { kind: 'chromium-profile', profileDirectory: 'Default' },
    i2: { kind: 'chromium-profile', profileDirectory: 'Profile 1', desiredName: 'Trabajo' },
    i3: { kind: 'current' },
  }

  it('devuelve el nombre de archivo y un texto que vuelve a leerse con los mismos datos', () => {
    const built = buildExport(data, bindings, profiles, NOW)
    expect(built.filename).toBe('account-launcher-2026-10-08.json')
    const read = readImportText(built.text)
    expect(read.ok).toBe(true)
    if (!read.ok) return
    expect(read.value.data).toEqual(data)
    expect(read.value.exportedAt).toBe(NOW.toISOString())
  })

  it('la pista de un perfil con nombre por defecto lleva el desiredName del vínculo', () => {
    const read = readImportText(buildExport(data, bindings, profiles, NOW).text)
    expect(read.ok && read.value.bindingHints).toEqual([
      { identityId: 'i1', kind: 'chromium-profile', name: 'Personal' },
      { identityId: 'i2', kind: 'chromium-profile', name: 'Trabajo' },
      { identityId: 'i3', kind: 'current' },
    ])
  })
})

describe('imágenes subidas en la exportación', () => {
  const key = 'icon:subida'

  it('el archivo no lleva los bytes ni el tipo de la imagen y conserva su referencia', () => {
    const withImage: Account = { ...account('a1', 'i1'), icon: { type: 'image', key } }
    const { text } = buildExport(dataOf([identity('i1')], [withImage]), {}, [], NOW)
    expect(text).not.toContain('base64')
    expect(text).not.toContain('image/png')
    const read = readImportText(text)
    expect(read.ok && read.value.data.accounts[0]?.icon).toEqual({ type: 'image', key })
  })
})

describe('readImportText', () => {
  const text = buildExport(dataOf([identity('i1')]), {}, [], NOW).text

  it('acepta un texto válido y lo mismo con un BOM inicial', () => {
    expect(readImportText(text).ok).toBe(true)
    expect(readImportText('\uFEFF' + text).ok).toBe(true)
  })

  it('un texto que no es JSON es invalid_json', () => {
    expect(readImportText('no es json')).toEqual({ ok: false, error: { code: 'invalid_json' } })
  })

  it('una URL javascript: es invalid y el aviso no repite la URL', () => {
    const hostile = buildExport(
      dataOf([identity('i1')], [account('a1', 'i1', T1, 'javascript:alert(1)')]),
      {},
      [],
      NOW,
    ).text
    const read = readImportText(hostile)
    expect(read).toEqual({ ok: false, error: { code: 'invalid', issues: ['accounts.a1: URL no válida'] } })
    expect(JSON.stringify(read)).not.toContain('javascript')
  })

  it('un texto de exactamente 5 MB no es too_large (aquí no es JSON)', () => {
    expect(readImportText('a'.repeat(MAX_IMPORT_BYTES))).toEqual({ ok: false, error: { code: 'invalid_json' } })
  })

  it('un texto de más de 5 MB es too_large', () => {
    expect(readImportText('a'.repeat(MAX_IMPORT_BYTES + 1))).toEqual({ ok: false, error: { code: 'too_large' } })
  })
})

describe('previewImport', () => {
  const current = dataOf([identity('i1')], [account('a1', 'i1'), account('solo-actual', 'i1')])
  const file = readImportText(buildExport(dataOf([identity('i1')], [account('a1', 'i1', T2)]), {}, [], NOW).text)

  it('merge y replace dan recuentos exactos y distintos: la entidad solo actual se conserva o se quita', () => {
    if (!file.ok) throw new Error('el archivo de prueba no es válido')
    expect(previewImport(current, file.value)).toEqual({
      merge: { ok: true, value: { added: 0, updated: 1, unchanged: 1, removed: 0 } },
      replace: { ok: true, value: { added: 0, updated: 1, unchanged: 1, removed: 1 } },
    })
  })

  it('un merge que supera los límites es invalid y el replace sigue siendo posible', () => {
    if (!file.ok) throw new Error('el archivo de prueba no es válido')
    const many = (prefix: string, count: number) =>
      Array.from({ length: count }, (_, index) => identity(`${prefix}${String(index)}`))
    const big = readImportText(buildExport(dataOf(many('n', 50)), {}, [], NOW).text)
    if (!big.ok) throw new Error('el archivo de prueba no es válido')
    const preview = previewImport(dataOf(many('c', 60)), big.value)
    expect(preview.merge).toMatchObject({ ok: false, error: { code: 'invalid' } })
    expect(preview.replace).toEqual({ ok: true, value: { added: 50, updated: 0, unchanged: 0, removed: 60 } })
  })
})
