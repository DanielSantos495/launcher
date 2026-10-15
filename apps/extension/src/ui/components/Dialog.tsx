import { useEffect, useId, useRef, type ReactNode } from 'react'

interface DialogProps {
  readonly title: string
  readonly onClose: () => void
  readonly children: ReactNode
}

// <dialog> nativo en modal: el navegador atrapa el foco y deja inerte el resto. Se monta solo mientras está abierto;
// al desmontarse se cierra y el foco vuelve al elemento que lo abrió.
export function Dialog({ title, onClose, children }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  useEffect(() => {
    const dialog = ref.current
    if (dialog === null) return
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialog.showModal()
    // Los navegadores ya enfocan el primer control; si no lo han hecho, se enfoca aquí para que el teclado actúe dentro.
    if (!dialog.contains(document.activeElement)) {
      dialog.querySelector<HTMLElement>('input, select, textarea, button')?.focus()
    }
    return () => {
      dialog.close()
      if (opener?.isConnected === true) opener.focus()
    }
  }, [])

  return (
    <dialog
      ref={ref}
      className="dialog"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return
        event.preventDefault()
        onClose()
      }}
    >
      <h2 id={titleId} className="dialog__title">
        {title}
      </h2>
      {children}
    </dialog>
  )
}
