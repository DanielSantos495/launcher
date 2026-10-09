// Genera los iconos de la extensión (public/icon/16.png, 32, 48 y 128). Node puro, sin dependencias.
// Se ejecuta una vez y los PNG se versionan: node scripts/make-icons.mjs
// Diseño: cuadrado redondeado en tinta con tres cintas horizontales de colores que evocan identidades.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'

const SIZES = [16, 32, 48, 128]
const INK = [0x1b, 0x23, 0x33]
// Cada cinta: color y posición vertical del centro (fracción del lado).
const RIBBONS = [
  { color: [0x3b, 0x82, 0xc4], y: 0.28 },
  { color: [0x2e, 0x9e, 0x6a], y: 0.5 },
  { color: [0xd0, 0x8a, 0x2b], y: 0.72 },
]
const RIBBON_HALF_HEIGHT = 0.07
const RIBBON_LEFT = 0.2
const RIBBON_RIGHT = 0.8
const CORNER_RADIUS = 0.22
const SUPERSAMPLING = 4

// Distancia con signo a un rectángulo redondeado (negativa dentro). Coordenadas en fracción del lado.
function roundedBoxDistance(px, py, cx, cy, halfW, halfH, radius) {
  const dx = Math.abs(px - cx) - (halfW - radius)
  const dy = Math.abs(py - cy) - (halfH - radius)
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - radius
}

// Color del punto (fracciones del lado) o undefined si queda fuera del icono.
function sample(px, py) {
  if (roundedBoxDistance(px, py, 0.5, 0.5, 0.5, 0.5, CORNER_RADIUS) > 0) return undefined
  for (const ribbon of RIBBONS) {
    const halfW = (RIBBON_RIGHT - RIBBON_LEFT) / 2
    const cx = (RIBBON_LEFT + RIBBON_RIGHT) / 2
    if (roundedBoxDistance(px, py, cx, ribbon.y, halfW, RIBBON_HALF_HEIGHT, RIBBON_HALF_HEIGHT) <= 0)
      return ribbon.color
  }
  return INK
}

function renderRgba(size) {
  const out = Buffer.alloc(size * size * 4)
  const total = SUPERSAMPLING * SUPERSAMPLING
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0
      let g = 0
      let b = 0
      let covered = 0
      for (let sy = 0; sy < SUPERSAMPLING; sy++) {
        for (let sx = 0; sx < SUPERSAMPLING; sx++) {
          const color = sample((x + (sx + 0.5) / SUPERSAMPLING) / size, (y + (sy + 0.5) / SUPERSAMPLING) / size)
          if (color === undefined) continue
          r += color[0]
          g += color[1]
          b += color[2]
          covered++
        }
      }
      const offset = (y * size + x) * 4
      if (covered > 0) {
        out[offset] = Math.round(r / covered)
        out[offset + 1] = Math.round(g / covered)
        out[offset + 2] = Math.round(b / covered)
      }
      out[offset + 3] = Math.round((covered / total) * 255)
    }
  }
  return out
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(buffer) {
  let c = 0xffffffff
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length, 0)
  head.write(type, 4, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0)
  return Buffer.concat([head, data, crc])
}

function encodePng(size, rgba) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8 // bits por canal
  header[9] = 6 // RGBA
  // Cada fila lleva delante el byte de filtro 0 (sin filtro).
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) {
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icon')
mkdirSync(outDir, { recursive: true })
for (const size of SIZES) {
  writeFileSync(join(outDir, `${size}.png`), encodePng(size, renderRgba(size)))
  console.log(`public/icon/${size}.png`)
}
