import {
  decryptText,
  encryptText,
  err,
  exportData,
  isEncryptedText,
  passwordLength,
  PASSWORD_MAX,
  PASSWORD_MIN,
  MAX_IMPORT_BYTES,
  ok,
  parseImport,
  planImport,
  serializeEnvelope,
  serializeExport,
  type Bindings,
  type CryptoError,
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

// Error de una exportación cuyo texto no cabría en la importación.
export interface ExportSizeError {
  readonly code: 'too_large'
}

// El texto descargable debe poder importarse luego: como mucho MAX_IMPORT_BYTES, medido igual que parseImport.
export function checkExportText(text: string): Result<undefined, ExportSizeError> {
  // Cada unidad UTF-16 ocupa al menos 1 byte: si ya hay más unidades que el límite, no hace falta codificar.
  if (text.length > MAX_IMPORT_BYTES || new TextEncoder().encode(text).length > MAX_IMPORT_BYTES) {
    return err({ code: 'too_large' })
  }
  return ok(undefined)
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

// Copia en claro, rechazada con too_large si luego no se podría importar.
export function buildPlainExport(
  data: LauncherData,
  bindings: Bindings,
  profiles: readonly ProfileInfo[],
  now: Date,
): Result<{ readonly filename: string; readonly text: string }, ExportSizeError> {
  const built = buildExport(data, bindings, profiles, now)
  const size = checkExportText(built.text)
  return size.ok ? ok(built) : size
}

// Copia cifrada con contraseña (T4). El texto descargable es el sobre; la contraseña no se guarda en ningún sitio.
export async function buildEncryptedExport(
  data: LauncherData,
  bindings: Bindings,
  profiles: readonly ProfileInfo[],
  now: Date,
  password: string,
): Promise<Result<{ readonly filename: string; readonly text: string }, CryptoError | ExportSizeError>> {
  const plain = buildExport(data, bindings, profiles, now)
  const sealed = await encryptText(plain.text, password)
  if (!sealed.ok) return sealed
  // El sobre pesa más que el contenido (base64 y etiqueta): se mide el texto final, no el de partida.
  const text = serializeEnvelope(sealed.value)
  const size = checkExportText(text)
  if (!size.ok) return size
  return ok({ filename: plain.filename.replace(/\.json$/, '.encrypted.json'), text })
}

// Valida la contraseña nueva y su confirmación antes de cifrar. La longitud cuenta puntos de código, como encryptText.
export function checkNewPassword(password: string, confirmation: string): 'length' | 'mismatch' | undefined {
  const length = passwordLength(password)
  if (length < PASSWORD_MIN || length > PASSWORD_MAX) return 'length'
  return password === confirmation ? undefined : 'mismatch'
}

// Primer filtro, antes de leer el archivo: parseImport vuelve a medir el texto, pero así no se carga en memoria.
export function checkFileSize(size: number): Result<undefined, { readonly code: 'too_large' }> {
  return size > MAX_IMPORT_BYTES ? err({ code: 'too_large' }) : ok(undefined)
}

// Algunos editores guardan el JSON con un BOM inicial, que JSON.parse no admite.
function stripBom(text: string): string {
  return text.startsWith('\uFEFF') ? text.slice(1) : text
}

export function readImportText(text: string): Result<ExportFile, ImportError> {
  return parseImport(stripBom(text))
}

// ¿Es una copia cifrada? Se mira antes del parseo normal: si lo es, hay que pedir la contraseña.
export function isEncryptedImport(text: string): boolean {
  return isEncryptedText(stripBom(text))
}

// Descifra una copia cifrada y sigue por el flujo normal de importación. Los errores de cifrado no revelan si falló
// la contraseña o los datos; los del contenido ya descifrado son los de siempre.
export async function unlockImport(
  text: string,
  password: string,
): Promise<Result<ExportFile, ImportError | CryptoError>> {
  const plain = await decryptText(stripBom(text), password)
  return plain.ok ? readImportText(plain.value) : plain
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
