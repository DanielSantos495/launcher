// Ejecutar: node --test spike/extension-tests/whoami-lib.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseNonce, newMarker } from '../extension/whoami-lib.js'

test('nonce válido', () => {
  assert.equal(parseNonce('#step0-nonce-0001'), 'step0-nonce-0001')
  assert.equal(parseNonce('#' + 'a'.repeat(64)), 'a'.repeat(64))
})

test('sin fragmento o sin almohadilla', () => {
  assert.equal(parseNonce(''), null)
  assert.equal(parseNonce('#'), null)
  assert.equal(parseNonce('step0-nonce-0001'), null)
  assert.equal(parseNonce(undefined), null)
})

test('longitud fuera de rango', () => {
  assert.equal(parseNonce('#' + 'a'.repeat(15)), null)
  assert.equal(parseNonce('#' + 'a'.repeat(65)), null)
})

test('caracteres no permitidos', () => {
  assert.equal(parseNonce('#step0-nonce-0001<script>'), null)
  assert.equal(parseNonce('#step0 nonce 0001'), null)
  assert.equal(parseNonce('#step0%2Fnonce-0001'), null)
  assert.equal(parseNonce('#step0-nonce-0001#otro'), null)
})

test('marcador con aleatoriedad inyectada', () => {
  const fill = (a) => { a.forEach((_, i) => { a[i] = i }); return a }
  assert.equal(newMarker(fill), '000102030405060708090a0b0c0d0e0f')
})

test('marcador real', () => {
  const a = newMarker()
  assert.match(a, /^[0-9a-f]{32}$/)
  assert.notEqual(a, newMarker())
})
