import type { LauncherData, Op } from '@account-launcher/core'

export type Mode = 'single' | 'multi'

// Copia de los datos con el modo efectivo de la instalación (DC1): el modo guardado en unos datos compartidos
// se ignora, manda el de los datos locales.
export function withMode(data: LauncherData, mode: Mode): LauncherData {
  return { ...data, settings: { ...data.settings, mode } }
}

// Separa el cambio de modo del resto de operaciones: el modo es de cada instalación (DC1) y no viaja al host.
// Quita settings.mode de cada settings.set (gana el último) y descarta los settings.set que se quedan vacíos por ello.
// Sin cambio de modo devuelve `rest` igual a la entrada y sin la clave `mode`.
export function splitModeChange(ops: readonly Op[]): { readonly mode?: Mode; readonly rest: Op[] } {
  let mode: Mode | undefined
  const rest: Op[] = []
  for (const op of ops) {
    if (op.type !== 'settings.set' || !Object.hasOwn(op.settings, 'mode')) {
      rest.push(op)
      continue
    }
    const { mode: requested, ...others } = op.settings
    if (requested !== undefined) mode = requested
    if (Object.keys(others).length > 0) rest.push({ type: 'settings.set', settings: others })
  }
  return mode === undefined ? { rest } : { mode, rest }
}
