import { LabelSchema, LIMITS, type Binding, type ProfileInfo } from '@account-launcher/core'
import * as v from 'valibot'
import type { MessageKey } from '../../i18n/i18n'

// Estado del nombre que el usuario pidió para el perfil de un vínculo (§5.2). Brave no deja ponerle nombre a un perfil
// nuevo desde fuera, así que la interfaz pide hacerlo a mano y comprueba si ya está.
//   none: sin vínculo, vínculo "current" o vínculo sin nombre pedido.
//   missing: la carpeta del vínculo ya no está entre los perfiles.
//   matches: el perfil ya tiene ese nombre y lo eligió el usuario (el nombre por defecto no cuenta).
//   pending: el resto (nombre por defecto o distinto).
export type RenameStatus = 'none' | 'matches' | 'pending' | 'missing'

export function renameStatus(binding: Binding | undefined, profiles: readonly ProfileInfo[]): RenameStatus {
  if (binding?.kind !== 'chromium-profile' || binding.desiredName === undefined) return 'none'
  const profile = profiles.find((candidate) => candidate.directory === binding.profileDirectory)
  if (profile === undefined) return 'missing'
  return !profile.isUsingDefaultName && profile.name === binding.desiredName ? 'matches' : 'pending'
}

// Nombre que se le pide a un perfil nuevo: acaba como desiredName del vínculo, así que cumple la misma regla que una
// etiqueta (no vacía, sin controles, hasta 80 caracteres). Devuelve la clave del error, o undefined si vale.
export function desiredNameError(raw: string): MessageKey | undefined {
  const name = raw.trim()
  if (name === '') return 'field.required'
  if (name.length > LIMITS.label) return 'field.too_long'
  return v.safeParse(LabelSchema, name).success ? undefined : 'field.invalid_text'
}
