import { BindingsSchema, LauncherDataSchema, TimestampSchema } from '@account-launcher/core'
import * as v from 'valibot'
import type { SwDeps } from '../background/deps'
import type { Snapshot } from './data-store'
import { LOCAL_KEYS } from './keys'

// Copia de seguridad única (la última gana): se guarda antes de un cambio que reemplaza los datos locales, como
// volver a "Perfil único" estando emparejado (DC2) o importar un archivo.
export const BackupSchema = v.strictObject({
  createdAt: TimestampSchema,
  source: v.picklist(['local', 'shared']),
  data: LauncherDataSchema,
  bindings: BindingsSchema,
})

export type Backup = v.InferOutput<typeof BackupSchema>

// Un fallo al escribir rechaza la promesa: quien llama no debe continuar con el cambio que iba a respaldar.
export async function saveBackup(deps: SwDeps, snapshot: Snapshot, source: 'local' | 'shared'): Promise<void> {
  const backup: Backup = {
    createdAt: deps.now().toISOString(),
    source,
    data: snapshot.data,
    bindings: snapshot.bindings,
  }
  await deps.local.set({ [LOCAL_KEYS.backup]: backup })
}
