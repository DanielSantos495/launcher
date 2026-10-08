// Límites del protocolo con el host (ADR-004).
export const PROTOCOL_VERSION = 1
// Lo que el host acepta leer. Chromium permite hasta 64 MiB hacia el host; 1 MiB basta para sync.put.
export const MAX_HOST_REQUEST_BYTES = 1024 * 1024
// Chromium no acepta mensajes de más de 1 MB del host al navegador [Doc]; margen redondo.
export const MAX_HOST_RESPONSE_BYTES = 1_000_000
// Datos compartidos serializados: deja espacio en sync.get para el sobre y los vínculos.
export const MAX_SHARED_DATA_BYTES = 512 * 1024
// Imágenes subidas: viajan aparte (icons.*), una por mensaje.
export const MAX_ICON_BYTES = 32 * 1024
export const PAIR_CODE_TTL_SECONDS = 120
export const PROOF_TTL_SECONDS = 60
export const DEFAULT_MAX_PAIRED_PROFILES = 2
export const MAX_CONTAINER_NAME = 64
