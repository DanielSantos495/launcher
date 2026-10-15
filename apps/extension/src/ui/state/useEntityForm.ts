import type { Result } from '@account-launcher/core'
import type { UiError } from '@account-launcher/protocol'
import { useCallback, useRef, useState, type SyntheticEvent } from 'react'
import { useI18n } from '../i18n-context'
import type { FieldErrors } from '../lib/forms'

interface EntityFormOptions<I, T> {
  readonly initial: I
  // Convierte los campos en la entidad completa, o en errores por campo.
  readonly build: (input: I) => Result<T, FieldErrors>
  // Guarda la entidad; devuelve el error si falla (el formulario lo muestra y sigue abierto).
  readonly save: (entity: T) => Promise<UiError | undefined>
}

// Estado común de los formularios de entidades: campos, errores por campo, error del guardado y envío. Los campos
// con error reciben el foco en el orden del DOM.
export function useEntityForm<I extends object, T>({ initial, build, save }: EntityFormOptions<I, T>) {
  const [input, setInput] = useState<I>(initial)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [failure, setFailure] = useState<UiError | undefined>()
  const [saving, setSaving] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)
  const { t } = useI18n()

  const patch = useCallback((values: Partial<I>): void => {
    setInput((current) => ({ ...current, ...values }))
  }, [])

  const submit = async (event: SyntheticEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    const built = build(input)
    if (!built.ok) {
      setErrors(built.error)
      setFailure(undefined)
      focusFirstInvalid(formRef.current, built.error)
      return
    }
    setErrors({})
    setFailure(undefined)
    setSaving(true)
    const error = await save(built.value)
    setSaving(false)
    if (error !== undefined) setFailure(error)
  }

  // Texto del error de un campo, si lo tiene.
  const fieldError = (name: string): string | undefined => {
    const key = Object.hasOwn(errors, name) ? errors[name] : undefined
    return key === undefined ? undefined : t(key)
  }

  return { input, patch, fieldError, failure, saving, formRef, submit }
}

function focusFirstInvalid(form: HTMLFormElement | null, errors: FieldErrors): void {
  if (form === null) return
  for (const element of form.elements) {
    const named =
      element instanceof HTMLInputElement ||
      element instanceof HTMLSelectElement ||
      element instanceof HTMLTextAreaElement
    if (named && Object.hasOwn(errors, element.name)) {
      element.focus()
      return
    }
  }
}
