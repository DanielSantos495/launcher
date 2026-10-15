import type { ReactNode } from 'react'

interface FieldProps {
  readonly id: string
  readonly label: string
  readonly hint?: string
  readonly error?: string
  readonly children: ReactNode
}

// Etiqueta, control, ayuda y error de un campo. El control lleva el id y aria-describedby de fieldAria.
export function Field({ id, label, hint, error, children }: FieldProps) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children}
      {hint === undefined ? null : (
        <p id={`${id}-hint`} className="field__hint">
          {hint}
        </p>
      )}
      {error === undefined ? null : (
        <p id={`${id}-error`} className="field__error">
          {error}
        </p>
      )}
    </div>
  )
}

// Atributos de accesibilidad del control de un Field: marca el error y enlaza la ayuda y el error como descripción.
export function fieldAria(
  id: string,
  hint: boolean,
  error: boolean,
): { readonly id: string; readonly 'aria-invalid': boolean; readonly 'aria-describedby': string | undefined } {
  const described = [hint ? `${id}-hint` : undefined, error ? `${id}-error` : undefined].filter(
    (part) => part !== undefined,
  )
  return { id, 'aria-invalid': error, 'aria-describedby': described.length === 0 ? undefined : described.join(' ') }
}
