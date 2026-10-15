import type { UiError } from '@account-launcher/protocol'

// Problemas con los datos que merecen un aviso propio, con acciones, en lugar del error genérico (Tarea 9).
export type DataProblemKind = 'too_large' | 'newer' | 'damaged' | 'host'

// Una escritura rechazada porque los datos ya no caben en el almacén compartido.
export function isStoreFull(error: UiError): boolean {
  return error.code === 'too_large' && error.hint === 'shared_data_full'
}

// Qué problema de datos describe un error de data.get / bindings.get (la carga de la pantalla). Un fallo del programa
// solo es "no se puede leer la lista compartida" si esta instalación está emparejada: si no, no hay lista compartida.
export function loadProblem(
  error: UiError,
  installation: { readonly paired: boolean } | undefined,
): DataProblemKind | undefined {
  if (isStoreFull(error)) return 'too_large'
  if (error.hint === 'shared_data_newer') return 'newer'
  if (error.hint === 'shared_data_invalid' || error.hint === 'shared_bindings_invalid') return 'damaged'
  const hostFailed = error.code === 'host_missing' || error.code === 'host_error'
  return hostFailed && installation?.paired === true ? 'host' : undefined
}
