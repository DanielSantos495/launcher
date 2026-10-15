import { useId, type ReactNode } from 'react'

interface SettingsSectionProps {
  readonly title: string
  // Id del encabezado, para enlazar desde otras partes de la pantalla (el enlace lo enfoca).
  readonly id?: string
  readonly children: ReactNode
}

// Bloque de Configuración con su encabezado.
export function SettingsSection({ title, id, children }: SettingsSectionProps) {
  const generated = useId()
  const headingId = id ?? generated
  return (
    <section className="settings__section" aria-labelledby={headingId}>
      <h3 id={headingId} className="settings__heading" tabIndex={id === undefined ? undefined : -1}>
        {title}
      </h3>
      {children}
    </section>
  )
}
