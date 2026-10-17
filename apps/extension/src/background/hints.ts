import type { UiError, UiErrorCode } from '@account-launcher/protocol'

// Vocabulario cerrado de pistas (UiError.hint). La UI tiene un texto para cada una.
export const HINTS = [
  'sender',
  'in_use',
  'op_invalid',
  'url_invalid',
  'url_scheme',
  'url_host',
  'url_userinfo',
  'url_length',
  'url_chars',
  'url_no_url',
  'open_failed',
  'storage_write',
  'local_data_newer',
  'local_data_invalid',
  'local_bindings_invalid',
  'unsupported_browser',
  'single_mode',
  'declare_profile',
  'bad_host_request',
  'request_too_large',
  'timeout',
  'host_failed',
  'bad_response',
  'profile_not_listed',
  'shared_data_newer',
  'shared_data_invalid',
  'shared_bindings_invalid',
  'shared_data_full',
  'shared_bindings_full',
  'already_paired',
  'import_invalid',
  'icon_limit',
  'icon_too_large',
] as const

export type Hint = (typeof HINTS)[number]

// Único camino para construir un error: solo código y pista del vocabulario, nunca mensajes ni datos.
export function uiError(code: UiErrorCode, hint?: Hint): UiError {
  return hint === undefined ? { code } : { code, hint }
}
