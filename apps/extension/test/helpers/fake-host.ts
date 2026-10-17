import type { ProfileInfo } from '@account-launcher/core'
import {
  DEFAULT_MAX_PAIRED_PROFILES,
  HostErrorResponseSchema,
  HostRequestSchema,
  MAX_HOST_REQUEST_BYTES,
  MAX_SHARED_BINDINGS_BYTES,
  MAX_SHARED_DATA_BYTES,
  PAIR_CODE_TTL_SECONDS,
  parseHostResponse,
  PROOF_TTL_SECONDS,
  type HostCommand,
  type HostErrorCode,
} from '@account-launcher/protocol'
import * as v from 'valibot'
import { HOST_PREFIX } from '../../src/platform/host-name'
import { jsonBytes } from '../../src/storage/usage'

export interface FakeHostOptions {
  readonly browser?: 'brave' | 'chrome' | 'edge' // por defecto 'brave'
  readonly temporaryContainer?: boolean // por defecto browser === 'brave'
  readonly profiles?: ProfileInfo[] // por defecto Default "Personal" (nombre elegido) y "Profile 1" "Persona 1" (por defecto)
  readonly persistentContainers?: Readonly<Record<string, readonly string[]>> // por carpeta de perfil
  readonly maxPairedProfiles?: number // por defecto 2
  readonly now?: () => Date
}

export interface FakeInstallation {
  installationId: string
  token: string
  identityId?: string
  profileDirectory?: string
  pairedAt: string
  verifiedAt?: string
}

export interface FakeHost {
  readonly send: (hostName: string, message: object) => Promise<unknown> // se usa como SwDeps.nativeSend
  readonly hostName: string // 'com.curyapps.launcher.' + browser
  mode: 'normal' | 'missing' | 'exit' | 'hang'
  override: ((request: { cmd: string; args: Record<string, unknown> }) => unknown) | undefined // respuesta cruda
  createProfileVisibleAfter: number // llamadas a listProfiles antes de que aparezca un perfil creado (por defecto 1)
  onVerify: ((nonce: string, profileDirectory: string) => void) | undefined
  readonly requests: { cmd: string; args: Record<string, unknown> }[]
  readonly invalidRequests: number // peticiones que no cumplían HostRequestSchema
  readonly state: {
    profiles: ProfileInfo[]
    launches: { cmd: 'open' | 'openTemporary'; profileDirectory: string; url: string; name?: string }[]
    store: { revision: number; data: unknown; bindings: Record<string, unknown> } | undefined
    installations: FakeInstallation[]
  }
}

const DEFAULT_NOW = '2026-10-08T12:00:00.000Z'
// Tras tantos pair.join fallidos el código vigente se anula (el host real no deja probar códigos sin fin).
const MAX_JOIN_FAILURES = 5
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

// Texto de base64url determinista: distinto para cada semilla.
function base64url(seed: number, length: number): string {
  return Array.from({ length }, (_, i) => ALPHABET.charAt((seed * 31 + i * 7 + seed * i) % 64)).join('')
}

interface CodeRecord {
  code: string
  expiresAt: number
  failures: number // intentos fallidos de pair.join contra este código
}
interface NonceRecord {
  nonce: string
  installationId: string
  expiresAt: number
  used: boolean
}

// Host nativo falso que cumple el contrato (packages/protocol/fixtures) y nada más: valida cada petición con
// HostRequestSchema y cada respuesta que construye con parseHostResponse; si se sale del contrato, lanza.
export function createFakeHost(options: FakeHostOptions = {}): FakeHost {
  const browser = options.browser ?? 'brave'
  const temporaryContainer = options.temporaryContainer ?? browser === 'brave'
  const maxPairedProfiles = options.maxPairedProfiles ?? DEFAULT_MAX_PAIRED_PROFILES
  const now = options.now ?? (() => new Date(DEFAULT_NOW))
  const persistentContainers = options.persistentContainers ?? {}
  const hostName = `${HOST_PREFIX}.${browser}`

  let invalid = 0
  let secrets = 0
  let created = 0
  const pending: { profile: ProfileInfo; seen: number }[] = []
  // Solo hay un código vigente: uno nuevo sustituye al anterior.
  let activeCode: CodeRecord | undefined
  let issuedCodes = 0
  const nonces: NonceRecord[] = []

  const iso = (offsetSeconds = 0): string => new Date(now().getTime() + offsetSeconds * 1000).toISOString()
  const nextSecret = (length: number): string => base64url(++secrets, length)

  function failure(code: HostErrorCode, revision?: number): unknown {
    const response = { ok: false, error: revision === undefined ? { code } : { code, revision } }
    if (!v.safeParse(HostErrorResponseSchema, response).success) throw new Error('error fuera del contrato')
    return response
  }

  function success(cmd: HostCommand, result: unknown): unknown {
    const response = { ok: true, result }
    const parsed = parseHostResponse(cmd, response)
    if (!parsed.ok) throw new Error(`el host falso construyó una respuesta fuera del contrato (${cmd})`)
    return response
  }

  function authed(token: string, run: (installation: FakeInstallation) => unknown): unknown {
    const installation = host.state.installations.find((candidate) => candidate.token === token)
    return installation === undefined ? failure('not_paired') : run(installation)
  }

  function store(): NonNullable<FakeHost['state']['store']> {
    if (host.state.store === undefined) throw new Error('el host falso no tiene almacén')
    return host.state.store
  }

  function issueCode(): { code: string; expiresAt: string } {
    const code = String((issuedCodes++ * 104_729 + 42_913) % 1_000_000).padStart(6, '0')
    activeCode = { code, expiresAt: now().getTime() + PAIR_CODE_TTL_SECONDS * 1000, failures: 0 }
    return { code, expiresAt: iso(PAIR_CODE_TTL_SECONDS) }
  }

  function hasProfile(directory: string): boolean {
    return host.state.profiles.some((profile) => profile.directory === directory)
  }

  function dispatch(request: v.InferOutput<typeof HostRequestSchema>): unknown {
    switch (request.cmd) {
      case 'ping':
        return success('ping', { hostVersion: '0.1.0', protocol: 1, browser, features: { temporaryContainer } })
      case 'listProfiles': {
        for (const entry of pending) entry.seen++
        for (const entry of pending.filter((candidate) => candidate.seen >= host.createProfileVisibleAfter)) {
          host.state.profiles.push(entry.profile)
          pending.splice(pending.indexOf(entry), 1)
        }
        return success('listProfiles', { profiles: structuredClone(host.state.profiles) })
      }
      case 'open': {
        const { profileDirectory, url } = request.args
        if (!hasProfile(profileDirectory)) return failure('unknown_profile')
        host.state.launches.push({ cmd: 'open', profileDirectory, url })
        return success('open', {})
      }
      case 'openTemporary': {
        const { profileDirectory, url, name } = request.args
        if (browser !== 'brave') return failure('unsupported_browser')
        if (!hasProfile(profileDirectory)) return failure('unknown_profile')
        const taken = Object.hasOwn(persistentContainers, profileDirectory)
          ? persistentContainers[profileDirectory]
          : []
        if (name !== undefined && taken?.some((other) => other.toLowerCase() === name.toLowerCase()) === true) {
          return failure('name_in_use')
        }
        host.state.launches.push({
          cmd: 'openTemporary',
          profileDirectory,
          url,
          ...(name === undefined ? {} : { name }),
        })
        return success('openTemporary', {})
      }
      case 'createProfile': {
        const directory = `Launcher-${(0x1a2b3c4d + created++).toString(16)}`
        const name = `Persona ${String(host.state.profiles.length + pending.length)}`
        pending.push({ profile: { directory, name, isUsingDefaultName: true }, seen: 0 })
        return success('createProfile', { directory })
      }
      case 'pair.start': {
        const { installationId, token } = request.args
        // Con token y el máximo de perfiles ya emparejado, no se emite ningún código.
        if (token !== undefined) {
          return authed(token, () =>
            host.state.installations.length >= maxPairedProfiles
              ? failure('limit_reached')
              : success('pair.start', issueCode()),
          )
        }
        // Sin token solo se puede empezar si no queda ninguna instalación emparejada (DC13): con alguna, hay que
        // unirse con un código. Un almacén que ya existe sin instalaciones conserva sus datos.
        if (host.state.installations.length > 0) return failure('not_paired')
        host.state.store ??= { revision: 0, data: null, bindings: {} }
        const first = nextSecret(43)
        host.state.installations.push({ installationId, token: first, pairedAt: iso() })
        return success('pair.start', { ...issueCode(), token: first })
      }
      case 'pair.join': {
        const { installationId, code } = request.args
        const entry = activeCode
        if (entry === undefined || entry.code !== code || entry.expiresAt <= now().getTime()) {
          if (entry !== undefined && ++entry.failures >= MAX_JOIN_FAILURES) activeCode = undefined
          return failure('bad_code')
        }
        // El código es de un solo uso: se consume aunque no quepa otro perfil.
        activeCode = undefined
        if (host.state.installations.length >= maxPairedProfiles) return failure('limit_reached')
        const token = nextSecret(43)
        host.state.installations.push({ installationId, token, pairedAt: iso() })
        return success('pair.join', { token })
      }
      case 'pair.declare':
        return authed(request.args.token, (installation) => {
          // Otra carpeta invalida la verificación anterior; la misma la conserva.
          if (installation.profileDirectory !== request.args.profileDirectory) delete installation.verifiedAt
          installation.profileDirectory = request.args.profileDirectory
          if (request.args.identityId === undefined) delete installation.identityId
          else installation.identityId = request.args.identityId
          return success('pair.declare', {})
        })
      case 'pair.list':
        return authed(request.args.token, () =>
          success('pair.list', {
            maxPairedProfiles,
            installations: host.state.installations.map(({ token, ...entry }) => ({
              ...entry,
              self: token === request.args.token,
            })),
          }),
        )
      case 'pair.remove':
        return authed(request.args.token, () => {
          const index = host.state.installations.findIndex((i) => i.installationId === request.args.installationId)
          if (index === -1) return failure('not_found')
          host.state.installations.splice(index, 1)
          return success('pair.remove', {})
        })
      case 'pair.verify':
        return authed(request.args.token, (installation) => {
          if (installation.profileDirectory === undefined) return failure('not_found')
          if (!hasProfile(installation.profileDirectory)) return failure('unknown_profile')
          const nonce = nextSecret(43)
          nonces.push({
            nonce,
            installationId: installation.installationId,
            expiresAt: now().getTime() + PROOF_TTL_SECONDS * 1000,
            used: false,
          })
          host.onVerify?.(nonce, installation.profileDirectory)
          return success('pair.verify', { expiresAt: iso(PROOF_TTL_SECONDS) })
        })
      case 'pair.prove':
        return authed(request.args.token, (installation) => {
          const entry = nonces.find((candidate) => candidate.nonce === request.args.nonce)
          const valid =
            entry !== undefined &&
            entry.installationId === installation.installationId &&
            !entry.used &&
            entry.expiresAt > now().getTime()
          if (!valid) return failure('bad_nonce')
          entry.used = true
          installation.verifiedAt = iso()
          return success('pair.prove', { verifiedAt: installation.verifiedAt })
        })
      case 'sync.get':
        return authed(request.args.token, () => {
          const { revision, data, bindings } = store()
          return success('sync.get', { revision, data: structuredClone(data), bindings: structuredClone(bindings) })
        })
      case 'sync.put': {
        // Como el host real: el tamaño se mide antes que el token y la revisión.
        const { baseRevision, data, bindings } = request.args
        if (jsonBytes(data) > MAX_SHARED_DATA_BYTES || jsonBytes(bindings) > MAX_SHARED_BINDINGS_BYTES) {
          return failure('too_large')
        }
        return authed(request.args.token, () => {
          const current = store()
          if (baseRevision !== current.revision) return failure('conflict', current.revision)
          current.revision++
          current.data = structuredClone(data)
          current.bindings = structuredClone(bindings)
          return success('sync.put', { revision: current.revision })
        })
      }
      case 'icons.get':
      case 'icons.put':
      case 'icons.delete':
        // Los iconos subidos se implementan en F2: en F1 la extensión no envía estos comandos.
        return authed(request.args.token, () => failure('internal'))
    }
  }

  function handle(message: object): unknown {
    if (jsonBytes(message) > MAX_HOST_REQUEST_BYTES) return failure('too_large')
    const parsed = v.safeParse(HostRequestSchema, message)
    if (!parsed.success) {
      invalid++
      return failure('bad_request')
    }
    const request = parsed.output
    const recorded = structuredClone({ cmd: request.cmd, args: request.args })
    host.requests.push(recorded)
    const raw = host.override?.(structuredClone(recorded))
    return raw === undefined ? dispatch(request) : raw
  }

  const host: FakeHost = {
    send(name, message) {
      if (host.mode === 'hang') return new Promise(() => undefined)
      if (host.mode === 'missing' || name !== hostName) {
        return Promise.reject(new Error('Specified native messaging host not found.'))
      }
      if (host.mode === 'exit') return Promise.reject(new Error('Native host has exited.'))
      // Una excepción del falso (respuesta fuera del contrato) se convierte en un rechazo: la prueba falla.
      return new Promise((resolve) => {
        resolve(handle(message))
      })
    },
    hostName,
    mode: 'normal',
    override: undefined,
    createProfileVisibleAfter: 1,
    onVerify: undefined,
    requests: [],
    get invalidRequests() {
      return invalid
    },
    state: {
      profiles: structuredClone(
        options.profiles ?? [
          { directory: 'Default', name: 'Personal', isUsingDefaultName: false },
          { directory: 'Profile 1', name: 'Persona 1', isUsingDefaultName: true },
        ],
      ),
      launches: [],
      store: undefined,
      installations: [],
    },
  }
  return host
}
