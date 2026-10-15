import { useId, type ReactNode } from 'react'
import type { MessageKey } from '../../i18n/i18n'
import { useI18n } from '../i18n-context'

type Mode = 'single' | 'multi'

interface ModeSwitchProps {
  readonly mode: Mode
  readonly onChange: (mode: Mode) => void
  // Lo que se explica debajo del interruptor (la guía de instalación, la nota de la lista compartida…).
  readonly children?: ReactNode
}

const OPTIONS: readonly (readonly [Mode, MessageKey, MessageKey])[] = [
  ['single', 'settings.mode.single', 'settings.mode.single.hint'],
  ['multi', 'settings.mode.multi', 'settings.mode.multi.hint'],
]

// Interruptor de modo: dos opciones excluyentes, cada una con su explicación enlazada como descripción.
export function ModeSwitch({ mode, onChange, children }: ModeSwitchProps) {
  const { t } = useI18n()
  const base = useId()
  return (
    <div>
      <fieldset className="choices">
        <legend className="visually-hidden">{t('settings.mode')}</legend>
        {OPTIONS.map(([value, label, hint]) => (
          <div key={value} className="choice">
            <input
              id={`${base}-${value}`}
              type="radio"
              name={`${base}-mode`}
              checked={mode === value}
              aria-describedby={`${base}-${value}-hint`}
              onChange={() => {
                onChange(value)
              }}
            />
            <label htmlFor={`${base}-${value}`} className="choice__title">
              {t(label)}
            </label>
            <p id={`${base}-${value}-hint`} className="choice__hint">
              {t(hint)}
            </p>
          </div>
        ))}
      </fieldset>
      {children}
    </div>
  )
}
