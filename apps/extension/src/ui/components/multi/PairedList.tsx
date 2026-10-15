import type { Identity, ProfileInfo } from '@account-launcher/core'
import type { UiError } from '@account-launcher/protocol'
import { useState } from 'react'
import { useI18n } from '../../i18n-context'
import { formatDateTime } from '../../lib/format'
import type { PairList } from '../../state/usePairList'
import { ConfirmDialog } from '../ConfirmDialog'

type Installation = PairList['installations'][number]

interface PairedListProps {
  readonly installations: PairList['installations']
  readonly profiles: readonly ProfileInfo[]
  readonly identities: readonly Identity[]
  // Quita una instalación; devuelve el error si falla.
  readonly onRemove: (installation: Installation) => Promise<UiError | undefined>
}

// Instalaciones emparejadas: perfil, identidad, si está verificada y "Quitar" (con confirmación).
export function PairedList({ installations, profiles, identities, onRemove }: PairedListProps) {
  const { t, language } = useI18n()
  const [removing, setRemoving] = useState<{ readonly installation: Installation; readonly name: string } | undefined>()

  // Nombre que se muestra: el del perfil declarado o, si no declaró ninguno, un número por orden de emparejamiento.
  const nameOf = (installation: Installation, position: number): string => {
    const directory = installation.profileDirectory
    if (directory === undefined) return t('pairing.unnamed', { number: position + 1 })
    return profiles.find((profile) => profile.directory === directory)?.name ?? directory
  }

  return (
    <>
      <ul className="rows">
        {installations.map((installation, position) => {
          const name = nameOf(installation, position)
          const identity = identities.find((candidate) => candidate.id === installation.identityId)
          return (
            <li key={installation.installationId} className="rows__item">
              <div className="rows__text">
                <span className="rows__title">
                  {name}
                  {installation.self ? <span className="badge">{t('pairing.self')}</span> : null}
                </span>
                <span className="rows__detail">{identity?.label ?? t('pairing.noIdentity')}</span>
                <span className="rows__detail">
                  {installation.verifiedAt === undefined
                    ? t('pairing.unverified')
                    : t('pairing.verifiedAt', { date: formatDateTime(language, installation.verifiedAt) })}
                </span>
              </div>
              <div className="rows__actions">
                <button
                  type="button"
                  className="button"
                  aria-label={t('pairing.removeNamed', { name })}
                  onClick={() => {
                    setRemoving({ installation, name })
                  }}
                >
                  {t('pairing.remove')}
                </button>
              </div>
            </li>
          )
        })}
      </ul>
      {removing === undefined ? null : (
        <ConfirmDialog
          title={t('pairing.remove.title', { name: removing.name })}
          message={t(removing.installation.self ? 'pairing.remove.self' : 'pairing.remove.body')}
          confirmLabel={t('pairing.remove.action')}
          onConfirm={async () => {
            const error = await onRemove(removing.installation)
            if (error === undefined) setRemoving(undefined)
            return error
          }}
          onCancel={() => {
            setRemoving(undefined)
          }}
        />
      )}
    </>
  )
}
