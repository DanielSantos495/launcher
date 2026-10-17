import type { ProfileInfo } from '@account-launcher/core'
import { useI18n } from '../../i18n-context'

interface NewProfileNoticesProps {
  readonly profiles: readonly ProfileInfo[]
  // Lleva a la sección Vínculos de Configuración.
  readonly onLink: () => void
  readonly onDismiss: (directory: string) => void
}

// Un aviso por perfil nuevo del navegador. El nombre lo pone el usuario en el navegador: se pinta siempre como texto.
export function NewProfileNotices({ profiles, onLink, onDismiss }: NewProfileNoticesProps) {
  const { t } = useI18n()
  return (
    <>
      {profiles.map((profile) => (
        <div key={profile.directory} className="banner banner--info" role="status">
          <div className="banner__text">
            <p className="banner__title">{t('newProfile.notice', { name: profile.name })}</p>
          </div>
          <div className="banner__actions">
            <button
              type="button"
              className="button"
              aria-label={t('newProfile.linkLabel', { name: profile.name })}
              onClick={onLink}
            >
              {t('newProfile.link')}
            </button>
            <button
              type="button"
              className="button button--quiet"
              aria-label={t('newProfile.dismissLabel', { name: profile.name })}
              onClick={() => {
                onDismiss(profile.directory)
              }}
            >
              {t('common.dismiss')}
            </button>
          </div>
        </div>
      ))}
    </>
  )
}
