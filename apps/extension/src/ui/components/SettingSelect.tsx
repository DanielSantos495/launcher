import { useId } from 'react'
import { Field, fieldAria } from './Field'

interface SettingSelectProps<T extends string> {
  readonly label: string
  readonly value: T
  readonly options: readonly { readonly value: T; readonly label: string }[]
  readonly onChange: (value: T) => void
}

// Selector de un ajuste con valores cerrados. El valor elegido se busca entre las opciones: nunca se convierte el texto.
export function SettingSelect<T extends string>({ label, value, options, onChange }: SettingSelectProps<T>) {
  const id = useId()
  return (
    <Field id={id} label={label}>
      <select
        {...fieldAria(id, false, false)}
        value={value}
        onChange={(event) => {
          const chosen = options.find((option) => option.value === event.target.value)
          if (chosen !== undefined) onChange(chosen.value)
        }}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </Field>
  )
}
