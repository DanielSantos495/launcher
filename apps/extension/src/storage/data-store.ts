import type { Bindings, LauncherData, Result } from '@account-launcher/core'
import type { UiError } from '@account-launcher/protocol'

export interface Snapshot {
  readonly data: LauncherData
  readonly bindings: Bindings
}

export interface WriteOutcome<T> {
  readonly snapshot: Snapshot
  readonly value: T
}

// Origen de los datos de la instalación: el almacén local o el compartido (Tarea 5).
export interface DataStore {
  readonly source: 'local' | 'shared'
  read(): Promise<Result<Snapshot, UiError>>
  // change debe ser pura: el almacén compartido la reaplica tras un conflict (hasta 3 intentos).
  write<T>(
    change: (current: Snapshot) => Result<{ next: Snapshot; value: T }, UiError>,
    options?: { beforeCommit?: (current: Snapshot) => Promise<void> },
  ): Promise<Result<WriteOutcome<T>, UiError>>
}
