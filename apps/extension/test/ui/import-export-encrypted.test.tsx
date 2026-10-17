// @vitest-environment happy-dom
import { createEmptyData, decryptText, encryptText, serializeEnvelope } from '@account-launcher/core'
import { cleanup, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildEncryptedExport, checkNewPassword, unlockImport } from '../../src/ui/lib/import-export'
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
