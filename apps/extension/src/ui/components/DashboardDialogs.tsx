import type { Account, Bindings, Group, Identity, LauncherData, Op } from '@account-launcher/core'
import type { UiError } from '@account-launcher/protocol'
import type { MessageKey } from '../../i18n/i18n'
import { useI18n } from '../i18n-context'
import type { Launcher } from '../state/useLauncher'
import { AccountForm } from './AccountForm'
import { ConfirmDialog } from './ConfirmDialog'
import { GroupForm } from './GroupForm'
import { IdentityForm } from './IdentityForm'
import { TemporaryContainerDialog, type TemporaryTarget } from './multi/TemporaryContainerDialog'

// Qué diálogo está abierto. `identity`, `group` y `account` sin valor crean una entidad nueva.
export type DialogState =
  | { readonly kind: 'identity'; readonly identity?: Identity }
  | { readonly kind: 'group'; readonly group?: Group }
  | { readonly kind: 'account'; readonly account?: Account; readonly identityId?: string; readonly groupId?: string }
  | { readonly kind: 'deleteAccount'; readonly account: Account }
  | { readonly kind: 'deleteIdentity'; readonly identity: Identity }
  | { readonly kind: 'deleteGroup'; readonly group: Group }
  | { readonly kind: 'temporary'; readonly target: TemporaryTarget }

// data.mutate admite 100 operaciones: borrar una identidad con sus cuentas necesita una por cuenta y una más.
const MAX_ACCOUNTS_WITH_IDENTITY = 99

interface DashboardDialogsProps {
  readonly dialog: DialogState | undefined
  readonly data: LauncherData
  readonly bindings: Bindings
  readonly ownIdentityId: string | undefined
  readonly ownProfileDirectory: string | undefined
  readonly mutate: Launcher['mutate']
  readonly send: Launcher['send']
  readonly onClose: () => void
  // Una operación terminó bien: el padre cierra el diálogo y avisa con el texto indicado.
  readonly onDone: (toast: MessageKey) => void
}

export function DashboardDialogs({
  dialog,
  data,
  bindings,
  ownIdentityId,
  ownProfileDirectory,
  mutate,
  send,
  onClose,
  onDone,
}: DashboardDialogsProps) {
  const { t, tp } = useI18n()
  if (dialog === undefined) return null

  // Aplica las operaciones; devuelve el error si falla (el diálogo sigue abierto y lo muestra).
  const apply = async (ops: Op[], toast: MessageKey): Promise<UiError | undefined> => {
    const response = await mutate(ops)
    if (!response.ok) return response.error
    onDone(toast)
    return undefined
  }

  // Borra la identidad con todas sus cuentas en un solo data.mutate. Primero quita su vínculo: bindings.set exige que la
  // identidad exista, y no puede quedar un vínculo suelto. Si el borrado falla, restaura el vínculo.
  const removeIdentity = async (identity: Identity, owned: readonly Account[]): Promise<UiError | undefined> => {
    const binding = Object.hasOwn(bindings, identity.id) ? bindings[identity.id] : undefined
    if (binding !== undefined) {
      const cleared = await send({ type: 'bindings.set', identityId: identity.id, binding: null })
      if (!cleared.ok) return cleared.error
    }
    const ops: Op[] = [
      ...owned.map((account): Op => ({ type: 'account.delete', id: account.id })),
      { type: 'identity.delete', id: identity.id },
    ]
    const error = await apply(ops, 'toast.identity.deleted')
    if (error !== undefined && binding !== undefined) {
      await send({ type: 'bindings.set', identityId: identity.id, binding })
    }
    return error
  }

  switch (dialog.kind) {
    case 'identity':
      return (
        <IdentityForm
          {...(dialog.identity === undefined ? {} : { identity: dialog.identity })}
          data={data}
          onSave={(identity) => apply([{ type: 'identity.put', identity }], 'toast.identity.saved')}
          onCancel={onClose}
        />
      )
    case 'group':
      return (
        <GroupForm
          {...(dialog.group === undefined ? {} : { group: dialog.group })}
          data={data}
          onSave={(group) => apply([{ type: 'group.put', group }], 'toast.group.saved')}
          onCancel={onClose}
        />
      )
    case 'account':
      return (
        <AccountForm
          {...(dialog.account === undefined ? {} : { account: dialog.account })}
          {...(dialog.identityId === undefined ? {} : { identityId: dialog.identityId })}
          {...(dialog.groupId === undefined ? {} : { groupId: dialog.groupId })}
          {...(ownIdentityId === undefined ? {} : { ownIdentityId })}
          data={data}
          onSave={(account) => apply([{ type: 'account.put', account }], 'toast.account.saved')}
          onCancel={onClose}
        />
      )
    case 'temporary':
      return (
        <TemporaryContainerDialog
          target={dialog.target}
          ownProfileDirectory={ownProfileDirectory}
          send={send}
          onClose={onClose}
          onDone={() => {
            onDone('toast.temporary.opened')
          }}
        />
      )
    case 'deleteAccount': {
      const { account } = dialog
      return (
        <ConfirmDialog
          title={t('confirm.account.title', { label: account.label })}
          message={t('confirm.account.body')}
          confirmLabel={t('confirm.account.action')}
          onConfirm={() => apply([{ type: 'account.delete', id: account.id }], 'toast.account.deleted')}
          onCancel={onClose}
        />
      )
    }
    case 'deleteGroup': {
      const { group } = dialog
      return (
        <ConfirmDialog
          title={t('confirm.group.title', { name: group.name })}
          message={t('confirm.group.body')}
          confirmLabel={t('confirm.group.action')}
          onConfirm={() => apply([{ type: 'group.delete', id: group.id }], 'toast.group.deleted')}
          onCancel={onClose}
        />
      )
    }
    case 'deleteIdentity': {
      const { identity } = dialog
      const owned = data.accounts.filter((account) => account.identityId === identity.id)
      const count = owned.length
      const title = t('confirm.identity.title', { name: identity.label })
      // Con demasiadas cuentas no cabe en un solo data.mutate: solo se explica qué hacer.
      if (count > MAX_ACCOUNTS_WITH_IDENTITY) {
        return <ConfirmDialog title={title} message={t('confirm.identity.tooMany', { count })} onCancel={onClose} />
      }
      return (
        <ConfirmDialog
          title={title}
          message={count === 0 ? t('confirm.identity.empty') : tp('confirm.identity.withAccounts', count, { count })}
          confirmLabel={count === 0 ? t('confirm.identity.action') : tp('confirm.identity.deleteAll', count, { count })}
          onConfirm={() => removeIdentity(identity, owned)}
          onCancel={onClose}
        />
      )
    }
  }
}
