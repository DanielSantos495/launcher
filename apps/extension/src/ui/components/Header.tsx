import { useI18n } from '../i18n-context'

interface HeaderProps {
  readonly view: 'identity' | 'group'
  readonly onViewChange: (view: 'identity' | 'group') => void
  readonly onAddAccount: () => void
  // Añadir cuentas necesita al menos una identidad.
  readonly canAddAccount: boolean
  // Sin manejador el botón queda deshabilitado (la paleta y la configuración llegan en la Tarea 8).
  readonly onSearch?: () => void
  readonly onSettings?: () => void
}

const VIEWS = ['identity', 'group'] as const

export function Header({ view, onViewChange, onAddAccount, canAddAccount, onSearch, onSettings }: HeaderProps) {
  const { t } = useI18n()
  return (
    <header className="app-header">
      <div className="app-header__inner">
        <h1 className="app-header__title">{t('app.title')}</h1>
        <button
          type="button"
          className="button search-button"
          aria-keyshortcuts="Control+K Meta+K"
          disabled={onSearch === undefined}
          onClick={onSearch}
        >
          {t('header.search')}
          <kbd aria-hidden="true">{t('header.searchHint')}</kbd>
        </button>
        <div className="segmented" role="group" aria-label={t('header.view')}>
          {VIEWS.map((option) => (
            <button
              key={option}
              type="button"
              className="segmented__option"
              aria-pressed={view === option}
              onClick={() => {
                if (view !== option) onViewChange(option)
              }}
            >
              {t(option === 'identity' ? 'view.identity' : 'view.group')}
            </button>
          ))}
        </div>
        <div className="app-header__end">
          <button type="button" className="button button--primary" disabled={!canAddAccount} onClick={onAddAccount}>
            {t('header.addAccount')}
          </button>
          <button type="button" className="button" disabled={onSettings === undefined} onClick={onSettings}>
            {t('header.settings')}
          </button>
        </div>
      </div>
    </header>
  )
}
