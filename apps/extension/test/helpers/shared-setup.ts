import { createEmptyData, loadData, type Identity, type LauncherData } from '@account-launcher/core'
import type { FakeHost } from './fake-host'

export const AT = '2026-10-01T10:00:00.000Z'

export const TOKEN_A = 'A'.repeat(43)
export const TOKEN_B = 'B'.repeat(43)
export const TOKEN_C = 'C'.repeat(43)

export function identity(id: string): Identity {
  return { id, label: id, color: '#336699', order: 0, createdAt: AT, updatedAt: AT }
}

// Datos vacíos en "Varios perfiles" (o en el modo indicado) con las identidades dadas.
export function dataWith(mode: 'single' | 'multi', identityIds: readonly string[] = []): LauncherData {
  const empty = createEmptyData()
  return {
    ...empty,
    revision: identityIds.length,
    identities: identityIds.map(identity),
    settings: { ...empty.settings, mode },
  }
}

// Contenido inicial de storage.local de una instalación sin emparejar.
export function unpairedLocal(installationId: string, data: LauncherData): Record<string, unknown> {
  return { installation: { installationId, paired: false }, localData: data }
}

// Contenido inicial de storage.local de una instalación ya emparejada con ese token.
export function pairedLocal(installationId: string, token: string, data: LauncherData): Record<string, unknown> {
  return { installation: { installationId, paired: true }, pairing: { token }, localData: data }
}

// Registra en el host falso una instalación con su token (sin pasar por pair.start / pair.join).
export function registerInstallation(fake: FakeHost, installationId: string, token: string): void {
  fake.state.installations.push({ installationId, token, pairedAt: '2026-10-08T12:00:00.000Z' })
}

// Peticiones recibidas por el host falso con ese comando.
export function requestsOf(fake: FakeHost, cmd: string): number {
  return fake.requests.filter((request) => request.cmd === cmd).length
}

// Datos compartidos que guarda el host falso, ya validados.
export function hostData(fake: FakeHost): LauncherData {
  const loaded = loadData(fake.state.store?.data)
  if (!loaded.ok) throw new Error('el host falso no tiene datos válidos')
  return loaded.value
}
