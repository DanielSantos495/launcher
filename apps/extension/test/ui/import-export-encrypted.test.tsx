// @vitest-environment happy-dom
import { createEmptyData, decryptText, encryptText, MAX_IMPORT_BYTES, serializeEnvelope } from '@account-launcher/core'
import { cleanup, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildEncryptedExport,
  buildPlainExport,
  checkExportText,
  checkNewPassword,
  unlockImport,
} from '../../src/ui/lib/import-export'
import { createTestEnv } from '../helpers/env'
import { localOf, makeAccount, makeIdentity, mount } from '../helpers/ui-setup'

const ANA = makeIdentity('ana', 'Trabajo')
const PASSWORD = 'una-contraseña-larga'

async function openSettings() {
  const download = vi.fn<(filename: string, text: string) => void>()
  const t = createTestEnv({ local: localOf({ identities: [ANA], accounts: [makeAccount('a1', 'ana', 'Alfa')] }) })
  const mounted = mount(t, { download })
  await screen.findByRole('heading', { name: 'Trabajo' })
  await mounted.user.click(screen.getByRole('button', { name: 'Configuración' }))
  await screen.findByRole('heading', { name: 'Copia de seguridad' })
  return { download, ...mounted }
}

beforeEach(() => {
  vi.spyOn(navigator, 'language', 'get').mockReturnValue('es-ES')
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('lib: contraseña nueva', () => {
  it('fronteras de longitud y confirmación', () => {
    expect(checkNewPassword('a'.repeat(9), 'a'.repeat(9))).toBe('length')
    expect(checkNewPassword('a'.repeat(10), 'a'.repeat(10))).toBeUndefined()
    expect(checkNewPassword('a'.repeat(1024), 'a'.repeat(1024))).toBeUndefined()
    expect(checkNewPassword('a'.repeat(1025), 'a'.repeat(1025))).toBe('length')
    expect(checkNewPassword('a'.repeat(10), 'a'.repeat(11))).toBe('mismatch')
  })

  it('la confirmación se compara ya normalizada a NFC, como la contraseña', () => {
    // «é» compuesta frente a «e» + acento combinado: son la misma contraseña para el cifrado.
    const composed = 'contraseña-é-larga'.normalize('NFC')
    expect(checkNewPassword(composed, composed.normalize('NFD'))).toBeUndefined()
  })
})

describe('exportar cifrado', () => {
  it('cifra con la casilla y la contraseña, y el archivo se descifra', async () => {
    const { user, download } = await openSettings()
    await user.click(screen.getByRole('checkbox', { name: 'Cifrar con contraseña' }))
    await user.type(screen.getByLabelText('Contraseña'), PASSWORD)
    await user.type(screen.getByLabelText('Repite la contraseña'), PASSWORD)
    await user.click(screen.getByRole('button', { name: 'Exportar copia' }))
    await vi.waitFor(() => {
      expect(download).toHaveBeenCalledTimes(1)
    })
    const [filename, text = ''] = download.mock.calls[0] ?? []
    expect(filename).toMatch(/^account-launcher-\d{4}-\d{2}-\d{2}\.encrypted\.json$/)
    expect(text).toContain('account-launcher-encrypted')
    expect(text).not.toContain('Alfa')
    expect(text).not.toContain(PASSWORD)
    const opened = await decryptText(text, PASSWORD)
    expect(opened.ok && opened.value).toContain('Alfa')
    // La contraseña se descartó.
    expect(screen.queryByLabelText('Contraseña')).toBeNull()
  })

  it('contraseña corta o confirmación distinta: no descarga y avisa', async () => {
    const { user, download } = await openSettings()
    await user.click(screen.getByRole('checkbox', { name: 'Cifrar con contraseña' }))
    await user.type(screen.getByLabelText('Contraseña'), 'corta')
    await user.type(screen.getByLabelText('Repite la contraseña'), 'corta')
    await user.click(screen.getByRole('button', { name: 'Exportar copia' }))
    expect(await screen.findByText('La contraseña debe tener entre 10 y 1024 caracteres.')).toBeTruthy()
    await user.clear(screen.getByLabelText('Contraseña'))
    await user.clear(screen.getByLabelText('Repite la contraseña'))
    await user.type(screen.getByLabelText('Contraseña'), PASSWORD)
    await user.type(screen.getByLabelText('Repite la contraseña'), PASSWORD + 'x')
    await user.click(screen.getByRole('button', { name: 'Exportar copia' }))
    expect(await screen.findByText('Las contraseñas no coinciden.')).toBeTruthy()
    expect(download).not.toHaveBeenCalled()
  })
})

describe('importar cifrado', () => {
  const encrypted = async (): Promise<string> => {
    const { user, download } = await openSettings()
    await user.click(screen.getByRole('checkbox', { name: 'Cifrar con contraseña' }))
    await user.type(screen.getByLabelText('Contraseña'), PASSWORD)
    await user.type(screen.getByLabelText('Repite la contraseña'), PASSWORD)
    await user.click(screen.getByRole('button', { name: 'Exportar copia' }))
    await vi.waitFor(() => {
      expect(download).toHaveBeenCalledTimes(1)
    })
    cleanup()
    return download.mock.calls[0]?.[1] ?? ''
  }

  it('pide la contraseña: la incorrecta no abre nada y la correcta lleva a la vista previa', async () => {
    const text = await encrypted()
    const { user } = await openSettings()
    await user.upload(
      screen.getByLabelText<HTMLInputElement>('Importar copia'),
      new File([text], 'copia.json', { type: 'application/json' }),
    )
    await screen.findByRole('dialog', { name: 'Copia cifrada' })
    await user.type(screen.getByLabelText('Contraseña de la copia'), 'contraseña-equivocada')
    await user.click(screen.getByRole('button', { name: 'Descifrar' }))
    expect(await screen.findByText('No se pudo abrir: contraseña incorrecta o archivo alterado.')).toBeTruthy()
    expect(screen.queryByRole('dialog', { name: 'Importar copia' })).toBeNull()
    await user.clear(screen.getByLabelText('Contraseña de la copia'))
    await user.type(screen.getByLabelText('Contraseña de la copia'), PASSWORD)
    await user.click(screen.getByRole('button', { name: 'Descifrar' }))
    await screen.findByRole('dialog', { name: 'Importar copia' })
    expect(screen.queryByRole('dialog', { name: 'Copia cifrada' })).toBeNull()
  })

  it('el campo de contraseña del diálogo usa autoComplete=current-password', async () => {
    const { user } = await openSettings()
    const bad = JSON.stringify({ format: 'account-launcher-encrypted', v: 1 })
    await user.upload(
      screen.getByLabelText<HTMLInputElement>('Importar copia'),
      new File([bad], 'copia.json', { type: 'application/json' }),
    )
    await screen.findByRole('dialog', { name: 'Copia cifrada' })
    expect(screen.getByLabelText('Contraseña de la copia').getAttribute('autocomplete')).toBe('current-password')
  })

  it('un sobre inválido muestra su mensaje en el diálogo', async () => {
    const { user } = await openSettings()
    const bad = JSON.stringify({ format: 'account-launcher-encrypted', v: 1 })
    await user.upload(
      screen.getByLabelText<HTMLInputElement>('Importar copia'),
      new File([bad], 'copia.json', { type: 'application/json' }),
    )
    await screen.findByRole('dialog', { name: 'Copia cifrada' })
    await user.type(screen.getByLabelText('Contraseña de la copia'), PASSWORD)
    await user.click(screen.getByRole('button', { name: 'Descifrar' }))
    expect(await screen.findByText('El archivo cifrado no es válido.')).toBeTruthy()
  })
})

describe('lib: abrir una copia cifrada', () => {
  it('un contenido descifrado que no es una copia da el error de importación de siempre', async () => {
    const sealed = await encryptText('{"hola":1}', PASSWORD)
    if (!sealed.ok) throw new Error('no se pudo cifrar')
    const opened = await unlockImport(serializeEnvelope(sealed.value), PASSWORD)
    expect(opened).toEqual({ ok: false, error: { code: 'not_launcher_file' } })
  })

  it('buildEncryptedExport rechaza una contraseña corta', async () => {
    const built = await buildEncryptedExport(createEmptyData(), {}, [], new Date(0), 'corta')
    expect(built).toEqual({ ok: false, error: { code: 'invalid_password' } })
  })
})

describe('lib: tamaño de la exportación', () => {
  // Datos con una etiqueta de relleno para controlar el tamaño de la copia.
  const padded = (pad: number) => ({ ...createEmptyData(), identities: [{ ...ANA, label: 'x'.repeat(pad) }] })

  it('checkExportText: el máximo exacto cabe y un byte más no, en bytes UTF-8', () => {
    expect(checkExportText('a'.repeat(MAX_IMPORT_BYTES))).toEqual({ ok: true, value: undefined })
    expect(checkExportText('a'.repeat(MAX_IMPORT_BYTES + 1))).toEqual({ ok: false, error: { code: 'too_large' } })
    // Dos bytes por carácter: pocas unidades UTF-16, pero demasiados bytes.
    expect(checkExportText('ñ'.repeat(MAX_IMPORT_BYTES / 2))).toEqual({ ok: true, value: undefined })
    expect(checkExportText('ñ'.repeat(MAX_IMPORT_BYTES / 2) + 'a')).toEqual({ ok: false, error: { code: 'too_large' } })
  })

  it('copia en claro: en el máximo exacto se construye y con un byte más devuelve too_large', () => {
    const base = buildPlainExport(padded(0), {}, [], new Date(0))
    if (!base.ok) throw new Error('no se pudo construir')
    const pad = MAX_IMPORT_BYTES - base.value.text.length
    const exact = buildPlainExport(padded(pad), {}, [], new Date(0))
    expect(exact.ok && exact.value.text.length).toBe(MAX_IMPORT_BYTES)
    expect(buildPlainExport(padded(pad + 1), {}, [], new Date(0))).toEqual({ ok: false, error: { code: 'too_large' } })
  })

  it('copia cifrada: el sobre que cabe se devuelve y el que pasa del máximo da too_large', async () => {
    // Cada 3 bytes de contenido añaden 4 caracteres de base64: se busca el último relleno que cabe.
    const base = await buildEncryptedExport(padded(0), {}, [], new Date(0), PASSWORD)
    if (!base.ok) throw new Error('no se pudo cifrar')
    const pad = Math.floor(((MAX_IMPORT_BYTES - base.value.text.length) * 3) / 4)
    let fit = pad - 3
    let overflow = false
    for (let i = 0; i < 12 && !overflow; i++) {
      const next = await buildEncryptedExport(padded(fit + 1), {}, [], new Date(0), PASSWORD)
      if (next.ok) fit += 1
      else {
        expect(next.error).toEqual({ code: 'too_large' })
        overflow = true
      }
    }
    expect(overflow).toBe(true)
    const last = await buildEncryptedExport(padded(fit), {}, [], new Date(0), PASSWORD)
    expect(last.ok && new TextEncoder().encode(last.value.text).length <= MAX_IMPORT_BYTES).toBe(true)
    if (last.ok) expect(last.value.text.length).toBeGreaterThan(MAX_IMPORT_BYTES - 4)
  }, 60_000)

  it('una copia en claro de 4 MB (cabe en claro) no se puede cifrar: el sobre pasaría de 5 MiB', async () => {
    const plain = buildPlainExport(padded(4_000_000), {}, [], new Date(0))
    expect(plain.ok).toBe(true)
    const built = await buildEncryptedExport(padded(4_000_000), {}, [], new Date(0), PASSWORD)
    expect(built.ok ? 'ok' : built.error).toEqual({ code: 'too_large' })
  }, 30_000)
})

describe('contraseña Unicode', () => {
  it('una contraseña en NFD abre una copia cifrada con su forma NFC', async () => {
    const nfc = 'contraseña-ñandú-é'.normalize('NFC')
    const nfd = nfc.normalize('NFD')
    expect(nfd).not.toBe(nfc)
    const sealed = await encryptText('{"hola":1}', nfc)
    if (!sealed.ok) throw new Error('no se pudo cifrar')
    expect(await decryptText(serializeEnvelope(sealed.value), nfd)).toEqual({ ok: true, value: '{"hola":1}' })
  })
})
