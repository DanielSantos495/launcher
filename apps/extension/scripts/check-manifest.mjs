// Comprueba el manifest compilado: solo los permisos storage y nativeMessaging (§7.3), sin superficie extra.
// Node puro. Uso: node scripts/check-manifest.mjs [ruta/al/manifest.json]
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const manifestPath =
  process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '.output', 'chrome-mv3', 'manifest.json')
const ALLOWED_PERMISSIONS = ['nativeMessaging', 'storage']
const FORBIDDEN_FIELDS = [
  'host_permissions',
  'optional_permissions',
  'optional_host_permissions',
  'content_scripts',
  'externally_connectable',
  'web_accessible_resources',
]

const problems = []
let manifest
try {
  manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
} catch {
  console.error(`check-manifest: no se pudo leer ${manifestPath}`)
  process.exit(1)
}

const permissions = Array.isArray(manifest.permissions) ? [...manifest.permissions].sort() : undefined
if (permissions === undefined || JSON.stringify(permissions) !== JSON.stringify(ALLOWED_PERMISSIONS)) {
  problems.push(`permissions debe ser exactamente {${ALLOWED_PERMISSIONS.join(', ')}}`)
}
for (const field of FORBIDDEN_FIELDS) {
  if (Object.hasOwn(manifest, field)) problems.push(`no debe existir ${field}`)
}
if (typeof manifest.key !== 'string' || manifest.key === '') problems.push('falta key')
if (manifest.default_locale !== 'es') problems.push('default_locale debe ser "es"')

if (problems.length > 0) {
  for (const problem of problems) console.error(`check-manifest: ${problem}`)
  process.exit(1)
}
console.log('check-manifest: ok')
