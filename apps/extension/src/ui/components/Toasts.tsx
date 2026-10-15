import { useEffect } from 'react'

export interface ToastItem {
  readonly id: number
  readonly text: string
}

const TOAST_MS = 4000

interface ToastsProps {
  readonly toasts: readonly ToastItem[]
  readonly onDismiss: (id: number) => void
}

// Región aria-live="polite" siempre presente (los lectores solo anuncian lo que cambia en una región ya existente).
// Cada aviso se retira solo a los 4 s: el temporizador va por el más antiguo.
export function Toasts({ toasts, onDismiss }: ToastsProps) {
  const oldest = toasts[0]?.id
  useEffect(() => {
    if (oldest === undefined) return
    const timer = setTimeout(() => {
      onDismiss(oldest)
    }, TOAST_MS)
    return () => {
      clearTimeout(timer)
    }
  }, [oldest, onDismiss])

  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((toast) => (
        <p key={toast.id} className="toast">
          {toast.text}
        </p>
      ))}
    </div>
  )
}
