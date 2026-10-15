import type { UnavailableReason } from '@account-launcher/protocol'
import { useId, useState } from 'react'
import { EXTENSION_ID } from '../../extension-id'
import { useI18n } from '../i18n-context'

const RELEASES_URL = 'https://github.com/DanielSantos495/launcher/releases'
const INSTALL_COMMAND = `./launcher-host install --extension-id ${EXTENSION_ID}`

interface InstallGuideProps {
  // Por qué no hay programa: decide el texto de arriba. Sin motivo conocido se asume que falta.
  readonly reason?: UnavailableReason | undefined
  // Vuelve a pedir las capacidades al service worker.
  readonly onRecheck: () => Promise<void>
}

// Pasos para instalar el programa que necesita "Varios perfiles". Si el navegador no es compatible, los pasos no
// ayudan: solo se explica eso.
export function InstallGuide({ reason, onRecheck }: InstallGuideProps) {
  const { t } = useI18n()
  const [state, setState] = useState<'idle' | 'checking' | 'failed'>('idle')
  const titleId = useId()

  const recheck = async (): Promise<void> => {
    setState('checking')
    await onRecheck()
    // Si el programa ya responde, la guía desaparece y este aviso no llega a verse.
    setState('failed')
  }

  return (
    <section className="install" aria-labelledby={titleId}>
      <h3 id={titleId} className="install__title">
        {t('install.title')}
      </h3>
      {reason === 'unsupported_browser' ? (
        <p>{t('hint.unsupported_browser')}</p>
      ) : (
        <>
          {reason === 'host_outdated' ? <p>{t('install.outdated')}</p> : null}
          <ol className="install__steps">
            <li>
              <p>{t('install.step1')}</p>
              <a href={RELEASES_URL} target="_blank" rel="noreferrer noopener">
                {RELEASES_URL}
              </a>
            </li>
            <li>
              <p>{t('install.step2')}</p>
              <code className="install__command">{INSTALL_COMMAND}</code>
            </li>
            <li>
              <p>{t('install.step3')}</p>
            </li>
          </ol>
          <div className="install__actions">
            <button
              type="button"
              className="button"
              disabled={state === 'checking'}
              onClick={() => {
                void recheck()
              }}
            >
              {state === 'checking' ? t('install.checking') : t('install.recheck')}
            </button>
            {state === 'failed' ? (
              <p className="install__failed" role="status">
                {t('install.stillMissing')}
              </p>
            ) : null}
          </div>
        </>
      )}
    </section>
  )
}
