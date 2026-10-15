import { useEffect, useRef, useState, type KeyboardEvent } from 'react'

export interface MenuItem {
  readonly key: string
  readonly label: string
  readonly onSelect: () => void
  readonly danger?: boolean
}

interface MenuProps {
  // Nombre accesible del botón (el texto visible es solo ⋯).
  readonly label: string
  readonly items: readonly MenuItem[]
  readonly className?: string
}

// Menú de acciones (WAI-ARIA menu button): flechas, Inicio, Fin, Escape y clic fuera. Al elegir, el foco vuelve al botón
// antes de ejecutar la acción, para que un diálogo que se abra después lo recuerde como origen.
export function Menu({ label, items, className }: MenuProps) {
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    listRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
    const onPointerDown = (event: PointerEvent): void => {
      if (event.target instanceof Node && wrapperRef.current?.contains(event.target) !== true) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [open])

  const move = (event: KeyboardEvent<HTMLDivElement>): void => {
    const entries = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]')]
    const current = entries.findIndex((entry) => entry === document.activeElement)
    let next: number | undefined
    if (event.key === 'ArrowDown') next = (current + 1) % entries.length
    else if (event.key === 'ArrowUp') next = (current - 1 + entries.length) % entries.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = entries.length - 1
    else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
      triggerRef.current?.focus()
      return
    }
    if (next === undefined) return
    event.preventDefault()
    entries[next]?.focus()
  }

  return (
    <div
      ref={wrapperRef}
      className={className === undefined ? 'menu' : `menu ${className}`}
      onBlur={(event) => {
        if (event.relatedTarget instanceof Node && wrapperRef.current?.contains(event.relatedTarget) === true) return
        setOpen(false)
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className="icon-button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          setOpen((current) => !current)
        }}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown') return
          event.preventDefault()
          setOpen(true)
        }}
      >
        <span aria-hidden="true">⋯</span>
      </button>
      {open ? (
        <div ref={listRef} className="menu__list" role="menu" aria-label={label} onKeyDown={move}>
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              tabIndex={-1}
              className={item.danger === true ? 'menu__item menu__item--danger' : 'menu__item'}
              onClick={() => {
                setOpen(false)
                triggerRef.current?.focus()
                item.onSelect()
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
