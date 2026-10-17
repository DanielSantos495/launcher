import {
  err,
  exportData,
  MAX_IMPORT_BYTES,
  ok,
  parseImport,
  planImport,
  serializeExport,
  type Bindings,
  type ExportFile,
  type ImportError,
  type LauncherData,
  type ProfileInfo,
  type Result,
} from '@account-launcher/core'

// Utilidades puras de exportar e importar (§5.4): sin navegador ni DOM, para que la interfaz y las pruebas las
// compartan.

// Nombre del archivo exportado, con la fecha UTC (la misma en cualquier zona horaria).
export function exportFilename(now: Date): string {
  return `account-launcher-${now.toISOString().slice(0, 10)}.json`
}

// Archivo de exportación listo para descargar. Los vínculos viajan como pistas por nombre de perfil (T11).
export function buildExport(
  data: LauncherData,
  bindings: Bindings,
  profiles: readonly ProfileInfo[],
  now: Date,
): { readonly filename: string; readonly text: string } {
  return { filename: exportFilename(now), text: serializeExport(exportData(data, bindings, profiles, now)) }
}

// Primer filtro, antes de leer el archivo: parseImport vuelve a medir el texto, pero así no se carga en memoria.
export function checkFileSize(size: number): Result<undefined, { readonly code: 'too_large' }> {
  return size > MAX_IMPORT_BYTES ? err({ code: 'too_large' }) : ok(undefined)
}

// Algunos editores guardan el JSON con un BOM inicial, que JSON.parse no admite.
export function readImportText(text: string): Result<ExportFile, ImportError> {
  return parseImport(text.startsWith('\uFEFF') ? text.slice(1) : text)
}

export interface ImportCounts {
  readonly added: number
  readonly updated: number
  readonly unchanged: number
  readonly removed: number
}

function counts(current: LauncherData, file: ExportFile, mode: 'merge' | 'replace'): Result<ImportCounts, ImportError> {
  const plan = planImport(current, file.data, mode)
  if (!plan.ok) return plan
  const { added, updated, unchanged, removed } = plan.value
  return ok({ added, updated, unchanged, removed })
}

// Resumen que se muestra antes de confirmar: los recuentos de cada modo, o el error si ese modo no es posible.
export function previewImport(
  current: LauncherData,
  file: ExportFile,
): { readonly merge: Result<ImportCounts, ImportError>; readonly replace: Result<ImportCounts, ImportError> } {
  return { merge: counts(current, file, 'merge'), replace: counts(current, file, 'replace') }
}
