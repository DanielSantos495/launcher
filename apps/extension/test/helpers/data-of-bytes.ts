import { createEmptyData, LIMITS, parseLauncherData, type LauncherData } from '@account-launcher/core'
import { jsonBytes } from '../../src/storage/usage'

const AT = '2026-10-01T10:00:00.000Z'

// Una identidad y una cuenta por cada `notes` indicada. Las notas son solo "a": un byte por carácter.
function build(notesLengths: readonly number[]): LauncherData {
  return {
    ...createEmptyData(),
    revision: 1,
    identities: [{ id: 'ana', label: 'Ana', color: '#336699', order: 0, createdAt: AT, updatedAt: AT }],
    accounts: notesLengths.map((length, index) => ({
      id: `acc-${String(index)}`,
      identityId: 'ana',
      groupId: null,
      serviceId: 'github',
      label: 'Cuenta',
      notes: 'a'.repeat(length),
      icon: { type: 'auto' },
      favorite: false,
      order: index,
      createdAt: AT,
      updatedAt: AT,
    })),
  }
}

const zeros = (count: number): number[] => Array.from({ length: count }, () => 0)

// Datos válidos con una identidad y tantas cuentas como hagan falta (las notas admiten LIMITS.notes caracteres cada
// una), con las notas rellenadas hasta que jsonBytes(data) === bytes. Lanza si `bytes` es menor que el mínimo.
export function dataOfBytes(bytes: number): LauncherData {
  let count = 1
  while (jsonBytes(build(zeros(count))) + count * LIMITS.notes < bytes) count++
  let remaining = bytes - jsonBytes(build(zeros(count)))
  if (remaining < 0) throw new Error('dataOfBytes: el tamaño pedido es menor que el mínimo')
  const lengths = zeros(count).map(() => {
    const length = Math.min(LIMITS.notes, remaining)
    remaining -= length
    return length
  })
  const data = build(lengths)
  if (jsonBytes(data) !== bytes || !parseLauncherData(data).ok) throw new Error('dataOfBytes: datos no válidos')
  return data
}
