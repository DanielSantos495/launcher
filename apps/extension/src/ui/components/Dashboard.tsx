import type { Account, Op } from '@account-launcher/core'
import type { UiError } from '@account-launcher/protocol'
import { useCallback, useMemo, useRef, useState } from 'react'
import type { MessageKey } from '../../i18n/i18n'
import { useI18n } from '../i18n-context'
import { boardIndex, orderedIdentities, viewSections, warningsIndex } from '../lib/sections'
import type { Launcher } from '../state/useLauncher'
import type { AccountActions } from './AccountTile'
import { DashboardDialogs, type DialogState } from './DashboardDialogs'
import { EmptyState } from './EmptyState'
import { ErrorBanner } from './ErrorBanner'
import { Header } from './Header'
import { SectionList, type SectionActions } from './SectionList'
import { Toasts, type ToastItem } from './Toasts'

const NO_WARNINGS: ReadonlyMap<string, readonly Account[]> = new Map()

// Pantalla principal: cabecera, secciones por identidad o por grupo y los diálogos. Los hooks van antes de los retornos
// anticipados (carga y error) para respetar el orden de llamadas.
export function Dashboard({ launcher }: { readonly launcher: Launcher }) {
  const { t } = useI18n()
  const { state, mutate, send, reload } = launcher
  const { data, bindings, profiles } = state
  const [dialog, setDialog] = useState<DialogState | undefined>(undefined)
  // Error de la última acción (abrir, favorita, cambiar de vista); los de los formularios salen dentro del diálogo.
  const [notice, setNotice] = useState<UiError | undefined>(undefined)
  const [toasts, setToasts] = useState<readonly ToastItem[]>([])
  const toastCounter = useRef(0)

  const ownIdentityId = state.installation?.ownIdentityId
  const view = data?.settings.defaultView ?? 'identity'

  const sections = useMemo(
    () => (data === undefined ? [] : viewSections(data, view, ownIdentityId)),
    [data, view, ownIdentityId],
  )
  const index = useMemo(
    () => (data === undefined ? undefined : boardIndex(data, bindings, profiles)),
    [data, bindings, profiles],
  )
  const warnings = useMemo(() => (data === undefined ? NO_WARNINGS : warningsIndex(data, bindings)), [data, bindings])
  const identities = useMemo(
    () => (data === undefined ? [] : orderedIdentities(data, ownIdentityId)),
    [data, ownIdentityId],
  )

  const notify = useCallback(
    (key: MessageKey): void => {
      const id = toastCounter.current++
      setToasts((current) => [...current, { id, text: t(key) }])
    },
    [t],
  )
  const dismissToast = useCallback((id: number): void => {
    setToasts((current) => current.filter((toast) => toast.id !== id))
  }, [])
  const closeDialog = useCallback((): void => {
    setDialog(undefined)
  }, [])
  const done = useCallback(
    (toast: MessageKey): void => {
      setDialog(undefined)
      notify(toast)
    },
    [notify],
  )

  const openAccount = useCallback(
    async (account: Account, asIdentityId?: string): Promise<void> => {
      const response = await send({
        type: 'account.open',
        accountId: account.id,
        ...(asIdentityId === undefined ? {} : { asIdentityId }),
      })
      setNotice(response.ok ? undefined : response.error)
    },
    [send],
  )
  const mutateWithNotice = useCallback(
    async (ops: Op[]): Promise<void> => {
      const response = await mutate(ops)
      setNotice(response.ok ? undefined : response.error)
    },
    [mutate],
  )

  const tileActions = useMemo<AccountActions>(
    () => ({
      open: (account, asIdentityId) => {
        void openAccount(account, asIdentityId)
      },
      toggleFavorite: (account) => {
        void mutateWithNotice([
          {
            type: 'account.put',
            account: { ...account, favorite: !account.favorite, updatedAt: new Date().toISOString() },
          },
        ])
      },
      edit: (account) => {
        setDialog({ kind: 'account', account })
      },
      remove: (account) => {
        setDialog({ kind: 'deleteAccount', account })
      },
    }),
    [openAccount, mutateWithNotice],
  )
  const sectionActions = useMemo<SectionActions>(
    () => ({
      addAccount: (target) => {
        setDialog({ kind: 'account', ...target })
      },
      editIdentity: (identity) => {
        setDialog({ kind: 'identity', identity })
      },
      deleteIdentity: (identity) => {
        setDialog({ kind: 'deleteIdentity', identity })
      },
      editGroup: (group) => {
        setDialog({ kind: 'group', group })
      },
      deleteGroup: (group) => {
        setDialog({ kind: 'deleteGroup', group })
      },
    }),
    [],
  )

  if (state.status === 'error' && state.error !== undefined) {
    return (
      <main className="main">
        <ErrorBanner
          error={state.error}
          onRetry={() => {
            void reload()
          }}
        />
      </main>
    )
  }
  if (data === undefined || index === undefined) {
    return (
      <main className="main">
        <p className="loading" role="status">
          {t('app.loading')}
        </p>
      </main>
    )
  }

  const hasIdentities = identities.length > 0
  let body
  if (!hasIdentities) {
    body = (
      <EmptyState
        title={t('empty.identities.title')}
        body={t('empty.identities.body')}
        action={{
          label: t('empty.identities.action'),
          onClick: () => {
            setDialog({ kind: 'identity' })
          },
        }}
      />
    )
  } else if (sections.length === 0) {
    body = (
      <EmptyState
        title={t('empty.accounts.title')}
        body={t('empty.accounts.body')}
        action={{
          label: t('empty.accounts.action'),
          onClick: () => {
            setDialog({ kind: 'account' })
          },
        }}
      />
    )
  } else {
    body = (
      <SectionList
        sections={sections}
        view={view}
        showDestinations={data.settings.mode === 'multi'}
        index={index}
        identities={identities}
        warnings={warnings}
        tileActions={tileActions}
        sectionActions={sectionActions}
      />
    )
  }

  return (
    <>
      <Header
        view={view}
        onViewChange={(next) => {
          void mutateWithNotice([{ type: 'settings.set', settings: { defaultView: next } }])
        }}
        canAddAccount={hasIdentities}
        onAddAccount={() => {
          setDialog({ kind: 'account' })
        }}
      />
      <main className="main">
        {notice === undefined ? null : (
          <ErrorBanner
            error={notice}
            onDismiss={() => {
              setNotice(undefined)
            }}
          />
        )}
        {body}
        {hasIdentities ? (
          <div className="board-actions">
            <button
              type="button"
              className="button"
              onClick={() => {
                setDialog({ kind: 'identity' })
              }}
            >
              {t('section.newIdentity')}
            </button>
            <button
              type="button"
              className="button"
              onClick={() => {
                setDialog({ kind: 'group' })
              }}
            >
              {t('section.newGroup')}
            </button>
          </div>
        ) : null}
      </main>
      <DashboardDialogs
        dialog={dialog}
        data={data}
        bindings={bindings}
        ownIdentityId={ownIdentityId}
        mutate={mutate}
        send={send}
        onClose={closeDialog}
        onDone={done}
      />
      <Toasts toasts={toasts} onDismiss={dismissToast} />
    </>
  )
}
