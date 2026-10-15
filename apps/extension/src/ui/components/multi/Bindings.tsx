import type { Bindings as BindingsMap, Identity, ProfileInfo } from '@account-launcher/core'
import { useState } from 'react'
import { useI18n } from '../../i18n-context'
import type { Launcher } from '../../state/useLauncher'
import { BindingRow } from './BindingRow'

interface BindingsProps {
  readonly identities: readonly Identity[]
  readonly bindings: BindingsMap
  readonly profiles: readonly ProfileInfo[]
  readonly browser: string
  readonly send: Launcher['send']
  readonly mutate: Launcher['mutate']
  readonly reload: () => Promise<void>
}

// Vínculos: a qué perfil del navegador abre cada identidad. "Comprobar" vuelve a leer los perfiles (también se hace al
// volver a la ventana) para saber si el nombre pedido a un perfil nuevo ya está puesto.
export function Bindings({ identities, bindings, profiles, browser, send, mutate, reload }: BindingsProps) {
  const { t } = useI18n()
  const [checking, setChecking] = useState(false)

  const check = async (): Promise<void> => {
    setChecking(true)
    await reload()
    setChecking(false)
  }

  return (
    <div className="bindings">
      <p className="settings__note">{t('bindings.intro')}</p>
      <ul className="rows">
        {identities.map((identity) => (
          <BindingRow
            key={identity.id}
            identity={identity}
            binding={Object.hasOwn(bindings, identity.id) ? bindings[identity.id] : undefined}
            profiles={profiles}
            browser={browser}
            send={send}
            mutate={mutate}
            reload={reload}
          />
        ))}
      </ul>
      <button
        type="button"
        className="button"
        disabled={checking}
        onClick={() => {
          void check()
        }}
      >
        {t('bindings.check')}
      </button>
    </div>
  )
}
