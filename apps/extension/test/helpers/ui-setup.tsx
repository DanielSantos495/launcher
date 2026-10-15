import {
  createEmptyData,
  type Account,
  type Bindings,
  type CustomService,
  type Group,
  type Identity,
  type LauncherData,
} from '@account-launcher/core'
import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App } from '../../src/ui/App'
import type { UiRequest } from '@account-launcher/protocol'
import { toUiResponse, type LauncherClient } from '../../src/ui/client'
import type { TestEnv } from './env'
import { createRouterClient } from './router-client'

export const AT = '2026-10-01T10:00:00.000Z'

export function makeIdentity(id: string, label: string, extra: Partial<Identity> = {}): Identity {
  return { id, label, color: '#336699', order: 0, createdAt: AT, updatedAt: AT, ...extra }
}

export function makeGroup(id: string, name: string, order = 0): Group {
  return { id, name, color: '#aa5500', order, createdAt: AT, updatedAt: AT }
}

export function makeAccount(id: string, identityId: string, label: string, extra: Partial<Account> = {}): Account {
  return {
    id,
    identityId,
    groupId: null,
    serviceId: 'github',
    label,
    icon: { type: 'auto' },
    favorite: false,
    order: 0,
    createdAt: AT,
    updatedAt: AT,
    ...extra,
  }
}

export function makeService(id: string, name: string, urlTemplate: string): CustomService {
  return { id, name, urlTemplate, multiAccount: 'none', createdAt: AT, updatedAt: AT }
}

export interface DataSeed {
  readonly identities?: Identity[]
  readonly groups?: Group[]
  readonly accounts?: Account[]
  readonly customServices?: CustomService[]
  readonly mode?: 'single' | 'multi'
  readonly allowHttp?: boolean
}

// Datos válidos (revisión 1) con lo indicado; el modo por defecto es "Perfil único".
export function dataOf(seed: DataSeed = {}): LauncherData {
  const empty = createEmptyData()
  return {
    ...empty,
    revision: 1,
    identities: seed.identities ?? [],
    groups: seed.groups ?? [],
    accounts: seed.accounts ?? [],
    customServices: seed.customServices ?? [],
    settings: { ...empty.settings, mode: seed.mode ?? 'single', allowHttp: seed.allowHttp ?? false },
  }
}

export interface LocalSeed extends DataSeed {
  readonly bindings?: Bindings
  readonly installationId?: string
  readonly ownProfileDirectory?: string
  readonly ownIdentityId?: string
}

// Contenido inicial de storage.local de una instalación sin emparejar.
export function localOf(seed: LocalSeed = {}): Record<string, unknown> {
  return {
    installation: {
      installationId: seed.installationId ?? 'inst-1',
      paired: false,
      ...(seed.ownProfileDirectory === undefined ? {} : { ownProfileDirectory: seed.ownProfileDirectory }),
      ...(seed.ownIdentityId === undefined ? {} : { ownIdentityId: seed.ownIdentityId }),
    },
    localData: dataOf(seed),
    localBindings: seed.bindings ?? {},
  }
}

export interface MountOptions {
  readonly download?: (filename: string, text: string) => void
  // Envuelve el cliente del router (por ejemplo, para hacer fallar una petición concreta).
  readonly wrap?: (client: LauncherClient) => LauncherClient
  readonly user?: ReturnType<typeof userEvent.setup>
}

export interface Mounted {
  readonly client: LauncherClient
  readonly user: ReturnType<typeof userEvent.setup>
  readonly container: HTMLElement
  readonly unmount: () => void
}

// Monta el dashboard sobre el router real del service worker de un entorno de prueba.
export function mount(t: TestEnv, options: MountOptions = {}): Mounted {
  const client = createRouterClient(t)
  const shown = options.wrap === undefined ? client : options.wrap(client)
  const rendered = render(
    options.download === undefined ? <App client={shown} /> : <App client={shown} download={options.download} />,
  )
  return {
    client,
    user: options.user ?? userEvent.setup(),
    container: rendered.container,
    unmount: rendered.unmount,
  }
}

export async function storedData(client: LauncherClient): Promise<LauncherData> {
  const response = await client.send({ type: 'data.get' })
  if (!response.ok) throw new Error('data.get falló')
  return response.result.data
}

// Cliente que responde con un error a las peticiones que cumplan `fails` y deja pasar el resto.
export function failing(client: LauncherClient, fails: (request: UiRequest) => boolean): LauncherClient {
  return {
    ...client,
    send(request) {
      const message: UiRequest = request
      if (!fails(message)) return client.send(request)
      return Promise.resolve(
        toUiResponse<typeof request>({ ok: false, error: { code: 'internal', hint: 'storage_write' } }),
      )
    },
  }
}
