// Ejecutar: node --test spike/extension-tests/*.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hostNameFor } from '../extension/host-name.js'

const grease = { brand: 'Not)A;Brand', version: '8' }
const chromium = { brand: 'Chromium', version: '154' }

test('Brave', () => {
  assert.equal(hostNameFor([grease, chromium, { brand: 'Brave', version: '154' }]), 'com.curyapps.launcher.spike.brave')
})

test('Microsoft Edge', () => {
  assert.equal(hostNameFor([chromium, { brand: 'Microsoft Edge', version: '155' }, grease]), 'com.curyapps.launcher.spike.edge')
})

test('Google Chrome', () => {
  assert.equal(hostNameFor([{ brand: 'Google Chrome', version: '155' }, chromium, grease]), 'com.curyapps.launcher.spike.chrome')
})

test('sin marca conocida (solo Chromium u otro navegador): error, nunca adivina', () => {
  assert.throws(() => hostNameFor([chromium, grease]), /No se puede detectar el navegador/)
  assert.throws(() => hostNameFor([{ brand: 'Opera', version: '120' }, chromium]), /No se puede detectar el navegador/)
})

test('varias marcas conocidas a la vez: error por ambigüedad', () => {
  assert.throws(() => hostNameFor([{ brand: 'Brave', version: '1' }, { brand: 'Google Chrome', version: '1' }]), /No se puede detectar el navegador/)
})

test('las marcas se comparan exactas (sin mayúsculas distintas ni subcadenas)', () => {
  assert.throws(() => hostNameFor([{ brand: 'brave', version: '1' }]), /No se puede detectar el navegador/)
  assert.throws(() => hostNameFor([{ brand: 'Brave Beta', version: '1' }]), /No se puede detectar el navegador/)
})

test('userAgentData no disponible o con forma inesperada: error', () => {
  for (const brands of [undefined, null, 'Brave', [], [null], [{}]]) {
    assert.throws(() => hostNameFor(brands), /No se puede detectar el navegador/)
  }
})
