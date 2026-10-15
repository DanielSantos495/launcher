import type { UiError } from '@account-launcher/protocol'
import { useEffect, useState } from 'react'
import { useI18n } from '../../i18n-context'
import type { Launcher } from '../../state/useLauncher'
import { ErrorBanner } from '../ErrorBanner'

// Cada cuánto se consulta pair.list mientras se espera la prueba del otro perfil.
export const VERIFY_POLL_MS = 2000

type VerifyState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'starting' }
  | { readonly kind: 'verifying'; readonly startedAt: number; readonly expiresAt: number }
  | { readonly kind: 'verified' }
  | { readonly kind: 'unverified' }
  | { readonly kind: 'failed'; readonly error: UiError }

interface VerifyProfileProps {
  // Sin carpeta declarada no hay nada que verificar.
  readonly declared: boolean
  readonly send: Launcher['send']
  // Tras una verificación correcta: vuelve a leer la lista de instalaciones. Debe ser estable entre renders: si
  // cambiara en cada uno, la consulta periódica se reiniciaría y nunca llegaría a ejecutarse.
  readonly onVerified: () => Promise<void>
}

// "Verificar este perfil": pide al host un nonce, que abre la página de verificación en el perfil declarado; si esa
// página prueba el nonce, el host marca la instalación como verificada. Se consulta pair.list cada 2 s hasta ver una
// verificación posterior al inicio o hasta que el nonce caduque.
export function VerifyProfile({ declared, send, onVerified }: VerifyProfileProps) {
  const { t } = useI18n()
  const [state, setState] = useState<VerifyState>({ kind: 'idle' })

  useEffect(() => {
    if (state.kind !== 'verifying') return
    const { startedAt, expiresAt } = state
    let cancelled = false
    const poll = async (): Promise<void> => {
      const listed = await send({ type: 'pair.list' })
      if (cancelled) return
      const self = listed.ok ? listed.result.installations.find((installation) => installation.self) : undefined
      if (self?.verifiedAt !== undefined && Date.parse(self.verifiedAt) >= startedAt) {
        setState({ kind: 'verified' })
        void onVerified()
      } else if (Date.now() >= expiresAt) {
        setState({ kind: 'unverified' })
      }
    }
    const timer = setInterval(() => {
      void poll()
    }, VERIFY_POLL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [state, send, onVerified])

  const start = async (): Promise<void> => {
    const startedAt = Date.now()
    setState({ kind: 'starting' })
    const response = await send({ type: 'pair.verify' })
    if (!response.ok) {
      setState({ kind: 'failed', error: response.error })
      return
    }
    setState({ kind: 'verifying', startedAt, expiresAt: Date.parse(response.result.expiresAt) })
  }

  const busy = state.kind === 'starting' || state.kind === 'verifying'
  return (
    <div className="verify">
      <button
        type="button"
        className="button"
        disabled={!declared || busy}
        onClick={() => {
          void start()
        }}
      >
        {t('pairing.verify')}
      </button>
      {declared ? null : <p className="settings__note">{t('hint.declare_profile')}</p>}
      <p className="verify__status" role="status">
        {busy ? t('pairing.verifying') : null}
        {state.kind === 'verified' ? t('pairing.verified') : null}
        {state.kind === 'unverified' ? t('pairing.notVerified') : null}
      </p>
      {state.kind === 'failed' ? <ErrorBanner error={state.error} /> : null}
    </div>
  )
}
