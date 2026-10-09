import {
  BindingsSchema,
  createEmptyData,
  err,
  loadData,
  ok,
  type Bindings,
  type LauncherData,
  type Result,
} from '@account-launcher/core'
import type { UiError } from '@account-launcher/protocol'
import * as v from 'valibot'
import type { SwDeps } from '../background/deps'
import { uiError } from '../background/hints'
import type { DataStore, Snapshot, WriteOutcome } from './data-store'
import { LOCAL_KEYS } from './keys'

async function readData(deps: SwDeps): Promise<Result<LauncherData, UiError>> {
  const raw = await deps.local.get(LOCAL_KEYS.localData)
  if (raw === undefined) return ok(createEmptyData())
  const loaded = loadData(raw)
  if (loaded.ok) return loaded
  // Datos dañados o de una versión más nueva: error claro, sin sobrescribir ni descartar nada (DC8).
  return err(
    uiError('internal', loaded.error.code === 'unsupported_version' ? 'local_data_newer' : 'local_data_invalid'),
  )
}

async function readBindings(deps: SwDeps): Promise<Result<Bindings, UiError>> {
  const raw = await deps.local.get(LOCAL_KEYS.localBindings)
  if (raw === undefined) return ok({})
  const parsed = v.safeParse(BindingsSchema, raw)
  return parsed.success ? ok(parsed.output) : err(uiError('internal', 'local_bindings_invalid'))
}

// Almacén de la instalación: datos y vínculos en storage.local. Escribe las dos claves en una sola llamada.
export function createLocalStore(deps: SwDeps): DataStore {
  async function read(): Promise<Result<Snapshot, UiError>> {
    const data = await readData(deps)
    if (!data.ok) return data
    const bindings = await readBindings(deps)
    if (!bindings.ok) return bindings
    return ok({ data: data.value, bindings: bindings.value })
  }

  async function write<T>(
    change: (current: Snapshot) => Result<{ next: Snapshot; value: T }, UiError>,
    options?: { beforeCommit?: (current: Snapshot) => Promise<void> },
  ): Promise<Result<WriteOutcome<T>, UiError>> {
    const current = await read()
    if (!current.ok) return current
    const changed = change(current.value)
    if (!changed.ok) return changed
    const { next, value } = changed.value
    await options?.beforeCommit?.(current.value)
    try {
      await deps.local.set({ [LOCAL_KEYS.localData]: next.data, [LOCAL_KEYS.localBindings]: next.bindings })
    } catch {
      return err(uiError('internal', 'storage_write'))
    }
    return ok({ snapshot: next, value })
  }

  return { source: 'local', read, write }
}
