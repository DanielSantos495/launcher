import { recentAccounts, type Account, type Identity, type Op } from '@account-launcher/core'
import type { UiError } from '@account-launcher/protocol'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MessageKey } from '../../i18n/i18n'
import { useClock } from '../clock-context'
import { useI18n } from '../i18n-context'
import { isStoreFull, loadProblem } from '../lib/data-problem'
import { accountBand, useReorder } from '../state/useReorder'
import { useNewProfiles } from '../state/useNewProfiles'
import { boardIndex, orderedIdentities, viewSections, warningsIndex } from '../lib/sections'
import type { Launcher } from '../state/useLauncher'
import { usePaletteShortcut } from '../state/usePaletteShortcut'
import type { AccountActions } from './AccountTile'
import { CommandPalette } from './CommandPalette'
import { DashboardDialogs, type DialogState } from './DashboardDialogs'
import { EmptyState } from './EmptyState'
import { ErrorBanner } from './ErrorBanner'
import { Header } from './Header'
import { RecentList } from './RecentList'
import { SectionList, type ReorderView, type SectionActions } from './SectionList'
import { DataProblemBanner } from './multi/DataProblemBanner'
import { NewProfileNotices } from './multi/NewProfileNotices'
import { SettingsView } from './SettingsView'
import { Toasts, type ToastItem } from './Toasts'

const NO_WARNINGS: ReadonlyMap<string, readonly Account[]> = new Map()
const NO_IDENTITIES: readonly Identity[] = []

interface DashboardProps {
  readonly launcher: Launcher
  // Guarda un texto como archivo (exportar copia); en producción es downloadText de platform.
  readonly download: (filename: string, text: string) => void
}

// Pantalla principal: cabecera, secciones por identidad o por grupo (o Configuración), la paleta y los diálogos. Los
// hooks van antes de los retornos anticipados (carga y error) para respetar el orden de llamadas.
export function Dashboard({ launcher, download }: DashboardProps) {
  const { t } = useI18n()
  const now = useClock()
  const { state, mutate, send, reload, client } = launcher
  const { data, bindings, profiles } = state
  const [dialog, setDialog] = useState<DialogState | undefined>(undefined)
  // Error de la última acción (abrir, favorita, cambiar de vista); los de los formularios salen dentro del diálogo.
  const [notice, setNotice] = useState<UiError | undefined>(undefined)
  const [toasts, setToasts] = useState<readonly ToastItem[]>([])
  const toastCounter = useRef(0)
  const [screen, setScreen] = useState<'board' | 'recent' | 'settings'>('board')
  // Configuración abierta desde el aviso de un perfil nuevo: empieza en Vínculos.
  const [settingsAt, setSettingsAt] = useState<'top' | 'bindings'>('top')
  const [paletteOpen, setPaletteOpen] = useState(false)
  const mainRef = useRef<HTMLElement>(null)
  const previousScreen = useRef(screen)

  const ownIdentityId = state.installation?.ownIdentityId
  const ownProfileDirectory = state.installation?.ownProfileDirectory
  // El contenedor temporal solo se ofrece cuando el proveedor está disponible (Brave con el programa instalado).
  const temporaryAvailable =
    state.capabilities?.providers.some(
      (provider) => provider.id === 'brave-temporary-container' && provider.available,
    ) === true
  const view = data?.settings.defaultView ?? 'identity'
  // Los perfiles nuevos solo importan en Varios perfiles con el programa disponible.
  const multiWithHost = data?.settings.mode === 'multi' && state.capabilities?.host.available === true
  const newProfiles = useNewProfiles(client, multiWithHost, profiles, bindings)

  const sections = useMemo(
    () => (data === undefined ? [] : viewSections(data, view, ownIdentityId)),
    [data, view, ownIdentityId],
  )
  const recent = useMemo(() => (data === undefined ? [] : recentAccounts(data)), [data])
  const index = useMemo(
    () => (data === undefined ? undefined : boardIndex(data, bindings, profiles)),
    [data, bindings, profiles],
  )
  const warnings = useMemo(() => (data === undefined ? NO_WARNINGS : warningsIndex(data, bindings)), [data, bindings])
  const identities = useMemo(
    () => (data === undefined ? [] : orderedIdentities(data, ownIdentityId)),
    [data, ownIdentityId],
  )

  const reorder = useReorder({
    sections,
    view,
    identities,
    ownIdentityId,
    mutate,
    onError: setNotice,
    t,
  })
  const reorderView = useMemo<ReorderView>(
    () => ({
      actions: reorder.actions,
      drag: reorder.drag,
      bandOf: (account) => accountBand(account, view, ownIdentityId),
      ownIdentityId,
    }),
    [reorder.actions, reorder.drag, view, ownIdentityId],
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

  // Al volver de Configuración, el foco pasa al contenido (el botón que lo abría ya no está en pantalla).
  useEffect(() => {
    if (previousScreen.current === 'settings' && screen === 'board') mainRef.current?.focus()
    previousScreen.current = screen
  }, [screen])

  const openPalette = useCallback((): void => {
    setPaletteOpen(true)
  }, [])
  usePaletteShortcut(data !== undefined, openPalette)

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

  // Vuelve a leer la lista compartida del programa y recarga la pantalla.
  const retryShared = useCallback(async (): Promise<void> => {
    await send({ type: 'sync.refresh' })
    await reload()
  }, [send, reload])
  // Salida de un problema con la lista compartida: pasar a Perfil único (con la copia local, DC2).
  const switchToSingle = useCallback(async (): Promise<UiError | undefined> => {
    const response = await mutate([{ type: 'settings.set', settings: { mode: 'single' } }])
    return response.ok ? undefined : response.error
  }, [mutate])

  const tileActions = useMemo<AccountActions>(
    () => ({
      open: (account, asIdentityId) => {
        void openAccount(account, asIdentityId)
      },
      toggleFavorite: (account) => {
        void mutateWithNotice([
          {
            type: 'account.put',
            account: { ...account, favorite: !account.favorite, updatedAt: now().toISOString() },
          },
        ])
      },
      edit: (account) => {
        setDialog({ kind: 'account', account })
      },
      remove: (account) => {
        setDialog({ kind: 'deleteAccount', account })
      },
      ...(temporaryAvailable
        ? {
            openTemporary: (account: Account) => {
              setDialog({ kind: 'temporary', target: { kind: 'account', account } })
            },
          }
        : {}),
    }),
    [openAccount, mutateWithNotice, temporaryAvailable, now],
  )
  // Las tarjetas de Recientes no se reordenan: mismas acciones, sin las de mover.
  const tileActionsWithReorder = useMemo<AccountActions>(
    () => ({ ...tileActions, reorder: reorder.actions }),
    [tileActions, reorder.actions],
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
    const problem = loadProblem(state.error, state.installation)
    return (
      <main className="main">
        {problem === undefined ? (
          <ErrorBanner
            error={state.error}
            onRetry={() => {
              void reload()
            }}
          />
        ) : (
          <DataProblemBanner kind={problem} onRetry={retryShared} onUseSingle={switchToSingle} />
        )}
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
        // "Abrir como…" solo tiene sentido en Varios perfiles; en Perfil único equivaldría a un clic normal.
        identities={data.settings.mode === 'multi' ? identities : NO_IDENTITIES}
        warnings={warnings}
        tileActions={tileActionsWithReorder}
        sectionActions={sectionActions}
        reorder={reorderView}
      />
    )
  }

  return (
    <>
      <Header
        view={view}
        onViewChange={(next) => {
          setScreen('board')
          void mutateWithNotice([{ type: 'settings.set', settings: { defaultView: next } }])
        }}
        canAddAccount={hasIdentities}
        onAddAccount={() => {
          setScreen('board')
          setDialog({ kind: 'account' })
        }}
        settingsOpen={screen === 'settings'}
        {...(temporaryAvailable
          ? {
              onOpenIsolatedUrl: () => {
                setDialog({ kind: 'temporary', target: { kind: 'url' } })
              },
            }
          : {})}
        recentOpen={screen === 'recent'}
        onRecent={() => {
          setScreen((current) => (current === 'recent' ? 'board' : 'recent'))
        }}
        onSearch={openPalette}
        onSettings={() => {
          setSettingsAt('top')
          setScreen((current) => (current === 'settings' ? 'board' : 'settings'))
        }}
      />
      <main ref={mainRef} className="main" tabIndex={-1}>
        {notice === undefined ? null : isStoreFull(notice) ? (
          <DataProblemBanner
            kind="too_large"
            data={data}
            source={state.source}
            onRetry={retryShared}
            onUseSingle={switchToSingle}
            onDismiss={() => {
              setNotice(undefined)
            }}
          />
        ) : (
          <ErrorBanner
            error={notice}
            onDismiss={() => {
              setNotice(undefined)
            }}
          />
        )}
        {screen === 'settings' ? (
          <SettingsView
            launcher={launcher}
            data={data}
            download={download}
            notify={notify}
            focusBindings={settingsAt === 'bindings'}
            onBack={() => {
              setScreen('board')
            }}
          />
        ) : (
          <>
            {multiWithHost ? (
              <NewProfileNotices
                profiles={newProfiles.fresh}
                onDismiss={newProfiles.dismiss}
                onLink={() => {
                  setSettingsAt('bindings')
                  setScreen('settings')
                }}
              />
            ) : null}
            {screen === 'recent' ? (
              <RecentList
                accounts={recent}
                index={index}
                identities={data.settings.mode === 'multi' ? identities : NO_IDENTITIES}
                tileActions={tileActions}
              />
            ) : (
              body
            )}
            {hasIdentities && screen === 'board' ? (
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
          </>
        )}
      </main>
      <DashboardDialogs
        dialog={dialog}
        data={data}
        bindings={bindings}
        ownIdentityId={ownIdentityId}
        ownProfileDirectory={ownProfileDirectory}
        mutate={mutate}
        send={send}
        onClose={closeDialog}
        onDone={done}
      />
      {paletteOpen ? (
        <CommandPalette
          data={data}
          index={index}
          showDestinations={data.settings.mode === 'multi'}
          onOpen={(account) => {
            setPaletteOpen(false)
            void openAccount(account)
          }}
          onClose={() => {
            setPaletteOpen(false)
          }}
        />
      ) : null}
      <Toasts toasts={toasts} onDismiss={dismissToast} />
      <div className="visually-hidden" role="status" aria-live="polite">
        {reorder.announcement}
      </div>
    </>
  )
}
