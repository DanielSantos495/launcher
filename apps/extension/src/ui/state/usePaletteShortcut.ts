import { useEffect } from 'react'

// Atajo Ctrl+K / Meta+K (keydown en window). No actúa si ya hay un diálogo abierto: dentro de un formulario, Ctrl+K
// conserva su significado de edición. Ctrl+Shift+K es el atajo de la extensión y lo atiende el navegador.
export function usePaletteShortcut(enabled: boolean, onTrigger: () => void): void {
  useEffect(() => {
    if (!enabled) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey) return
      if (event.key.toLowerCase() !== 'k') return
      if (document.querySelector('dialog[open]') !== null) return
      event.preventDefault()
      onTrigger()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [enabled, onTrigger])
}
