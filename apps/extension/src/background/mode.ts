import type { LauncherData } from '@account-launcher/core'

export type Mode = 'single' | 'multi'

// Copia de los datos con el modo efectivo de la instalación (DC1): el modo guardado en unos datos compartidos
// se ignora, manda el de los datos locales.
export function withMode(data: LauncherData, mode: Mode): LauncherData {
  return { ...data, settings: { ...data.settings, mode } }
}
