import { useI18n } from '../i18n-context'

interface HeaderProps {
  readonly view: 'identity' | 'group'
  readonly onViewChange: (view: 'identity' | 'group') => void
  readonly onAddAccount: () => void
  // Añadir cuentas necesita al menos una identidad.
  readonly canAddAccount: boolean
  // Sin manejador el botón queda deshabilitado (y sin atajo anunciado).
  readonly onSearch?: () => void
  readonly onSettings?: () => void
  // Vista "Recientes": se anuncia como pulsada mientras está abierta.
  readonly onRecent?: () => void
  readonly recentOpen?: boolean
  // Configuración abierta: el botón se anuncia como pulsado.
  readonly settingsOpen?: boolean
  // Solo con el contenedor temporal disponible: abre el diálogo de "URL aislada".
  readonly onOpenIsolatedUrl?: () => void
}

const VIEWS = ['identity', 'group'] as const

export function Header({
  view,
  onViewChange,
  onAddAccount,
  canAddAccount,
  onSearch,
  onSettings,
  onRecent,
  recentOpen,
  settingsOpen,
  onOpenIsolatedUrl,
}: HeaderProps) {
  const { t } = useI18n()
  return (
    <header className="app-header">
      <div className="app-header__inner">
        <h1 className="app-header__title">{t('app.title')}</h1>
        <button
          type="button"
          className="button search-button"
          aria-keyshortcuts={onSearch === undefined ? undefined : 'Control+K Meta+K'}
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
              aria-pressed={view === option && recentOpen !== true}
              onClick={() => {
                if (view !== option) onViewChange(option)
              }}
            >
              {t(option === 'identity' ? 'view.identity' : 'view.group')}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="button"
          aria-pressed={recentOpen}
          disabled={onRecent === undefined}
          onClick={onRecent}
        >
          {t('header.recent')}
        </button>
        <div className="app-header__end">
          <button type="button" className="button button--primary" disabled={!canAddAccount} onClick={onAddAccount}>
            {t('header.addAccount')}
          </button>
          {onOpenIsolatedUrl === undefined ? null : (
            <button type="button" className="button" onClick={onOpenIsolatedUrl}>
              {t('header.isolatedUrl')}
            </button>
          )}
          <button
            type="button"
            className="button"
            aria-pressed={settingsOpen}
            disabled={onSettings === undefined}
            onClick={onSettings}
          >
            {t('header.settings')}
          </button>
        </div>
      </div>
    </header>
  )
}
