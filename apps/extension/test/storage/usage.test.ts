import { createEmptyData, type LauncherData } from '@account-launcher/core'
import { describe, expect, it } from 'vitest'
import { jsonBytes, storeUsage, utf8Bytes } from '../../src/storage/usage'
import { dataOfBytes } from '../helpers/data-of-bytes'

describe('utf8Bytes', () => {
  it('cuenta bytes UTF-8, no caracteres', () => {
    expect(utf8Bytes('')).toBe(0)
    expect(utf8Bytes('abc')).toBe(3)
    expect(utf8Bytes('é')).toBe(2)
    expect(utf8Bytes('€')).toBe(3)
    expect(utf8Bytes('😀')).toBe(4)
  })
})

describe('jsonBytes', () => {
  it('mide el JSON serializado en bytes UTF-8', () => {
    expect(jsonBytes({})).toBe(2)
    expect(jsonBytes({ a: 'é' })).toBe(10)
    expect(jsonBytes(['😀'])).toBe(8)
    expect(jsonBytes(null)).toBe(4)
  })
})

describe('storeUsage', () => {
  const LIMIT = 524_288

  it('datos vacíos en shared: bytes del JSON, límite de 512 KiB, nivel ok', () => {
    const data = createEmptyData()
    const usage = storeUsage(data, 'shared')
    expect(usage.bytes).toBe(jsonBytes(data))
    expect(usage.limit).toBe(524_288)
    expect(usage.ratio).toBe(usage.bytes / LIMIT)
    expect(usage.level).toBe('ok')
  })

  it('el aviso empieza en el 80 %: un byte menos es ok', () => {
    const warn = Math.ceil(0.8 * LIMIT)
    expect(storeUsage(dataOfBytes(warn), 'shared')).toMatchObject({ bytes: warn, level: 'warn' })
    expect(storeUsage(dataOfBytes(warn - 1), 'shared')).toMatchObject({ bytes: warn - 1, level: 'ok' })
  })

  it('casi lleno empieza en el 95 %: un byte menos es warn', () => {
    const full = Math.ceil(0.95 * LIMIT)
    expect(storeUsage(dataOfBytes(full), 'shared')).toMatchObject({ bytes: full, level: 'full' })
    expect(storeUsage(dataOfBytes(full - 1), 'shared')).toMatchObject({ bytes: full - 1, level: 'warn' })
  })

  it('en el límite exacto o por encima sigue siendo full y la proporción llega a 1', () => {
    const exact = storeUsage(dataOfBytes(LIMIT), 'shared')
    expect(exact).toMatchObject({ bytes: LIMIT, level: 'full', ratio: 1 })
  })

  it('una ñ cuenta 2 bytes, no 1', () => {
    const noteOf = (text: string): LauncherData => {
      const base = dataOfBytes(5000)
      const [first] = base.accounts
      if (first === undefined) throw new Error('falta la cuenta')
      return { ...base, accounts: [{ ...first, notes: text }] }
    }
    const plain = storeUsage(noteOf('n'.repeat(100)), 'shared').bytes
    const accented = storeUsage(noteOf('ñ'.repeat(100)), 'shared').bytes
    expect(accented - plain).toBe(100)
  })

  it('en local cuenta también la copia de seguridad; en el almacén compartido se ignora', () => {
    const data = createEmptyData()
    expect(storeUsage(data, 'local', 1000).bytes).toBe(jsonBytes(data) + 1000)
    expect(storeUsage(data, 'local', 1000).ratio).toBe((jsonBytes(data) + 1000) / 10_485_760)
    expect(storeUsage(data, 'shared', 1000).bytes).toBe(jsonBytes(data))
  })

  it('en local el límite es la cuota de 10 MiB de storage.local', () => {
    const usage = storeUsage(createEmptyData(), 'local')
    expect(usage.limit).toBe(10_485_760)
    expect(usage.level).toBe('ok')
    // El 96 % de los 512 KiB compartidos es solo el 4,8 % de la cuota local.
    expect(storeUsage(dataOfBytes(Math.ceil(0.96 * LIMIT)), 'local').level).toBe('ok')
  })
})
