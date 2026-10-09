// Contratos del service worker. Todo efecto del navegador entra por SwDeps, así que las pruebas inyectan
// almacenamiento, reloj, ids y pestañas sin tocar la API real.
export interface KeyValueArea {
  get(key: string): Promise<unknown> // undefined si la clave no existe
  set(items: Readonly<Record<string, unknown>>): Promise<void> // varias claves en una sola llamada
  remove(keys: readonly string[]): Promise<void>
}

export interface SwDeps {
  readonly local: KeyValueArea // storage.local
  readonly session: KeyValueArea // storage.session
  readonly nativeSend: (hostName: string, message: object) => Promise<unknown>
  readonly hostName: string | undefined // hostNameFor(brands); undefined = navegador no reconocido
  readonly openTab: (url: string) => Promise<void>
  readonly now: () => Date
  readonly randomId: () => string // crypto.randomUUID()
  readonly sleep: (ms: number) => Promise<void>
  readonly extensionId: string
}

// Cola de escritura: el service worker es el único escritor y las escrituras no se solapan.
export interface Queue {
  run<T>(job: () => Promise<T>): Promise<T>
}

export interface SwEnv {
  readonly deps: SwDeps
  readonly queue: Queue
}
