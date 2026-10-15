interface EmptyStateProps {
  readonly title: string
  readonly body?: string
  readonly action?: { readonly label: string; readonly onClick: () => void }
  // En una sección con pocas cosas: sin encabezado ni tanto aire.
  readonly compact?: boolean
}

// Un vacío invita a actuar: dice qué falta y ofrece el siguiente paso.
export function EmptyState({ title, body, action, compact = false }: EmptyStateProps) {
  return (
    <div className={compact ? 'empty empty--compact' : 'empty'}>
      {compact ? <p className="empty__title">{title}</p> : <h2 className="empty__title">{title}</h2>}
      {body === undefined ? null : <p className="empty__body">{body}</p>}
      {action === undefined ? null : (
        <button type="button" className="button button--primary" onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  )
}
