// Unit checks for the share-link pieces that need no browser: scope parsing and trimming.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ShareError, parseScope, trimMeta, trimSession } from '../app/share/scope.mjs'

const pricing = { id: 'pricing', variants: ['A', 'B', 'C', 'D', 'E'], archived: false }
const old = { id: 'old', variants: ['A'], archived: true }
const protos = [pricing, old, { id: 'home', variants: ['A', 'B'], archived: false }]
const bad = (words, all, word) => assert.throws(() => parseScope(words, all, protos), e => e instanceof ShareError && e.message.includes(word))

test('parseScope numbers and letters', () => {
  assert.deepEqual(parseScope(['pricing/2', 'pricing/C'], false, protos), { protos: [{ id: 'pricing', variants: ['B', 'C'] }], start: 'pricing/B' })
})
test('parseScope whole prototype', () => {
  assert.deepEqual(parseScope(['pricing'], false, protos).protos, [{ id: 'pricing', variants: ['A', 'B', 'C', 'D', 'E'] }])
})
test('parseScope --all skips archived', () => {
  const s = parseScope([], true, protos)
  assert.deepEqual(s.protos.map(p => p.id), ['pricing', 'home'])
  assert.equal(s.start, 'pricing/A')
})
test('parseScope rejects', () => {
  bad(['nope'], false, 'nope')
  bad(['pricing/9'], false, 'pricing/9')
  bad([], false, 'prototype')
})
test('parseScope rejects prototypes without variants', () => {
  const empty = [{ id: 'x', variants: [], archived: false }]
  for (const [words, all] of [[['x'], false], [['x/A'], false], [[], true]]) {
    assert.throws(() => parseScope(words, all, empty), e => e instanceof ShareError && (all || e.message.includes('"x"')))
  }
})
test('trimMeta drops owner data', () => {
  const meta = { title: 'T', kind: 'web', screen: [1, 2], created: 'x', states: [], variants: { A: 'a', B: 'b' }, about: { A: 'x', B: 'y' }, ask: 'q', picked: 'A', favorites: ['A'], archived: true, count: 3, from: 'home/B', mystery: 1 }
  const out = trimMeta(meta, ['B'], new Set(['pricing']))
  assert.deepEqual(out, { title: 'T', kind: 'web', screen: [1, 2], created: 'x', states: [], variants: { B: 'b' }, about: { B: 'y' } })
})
test('trimMeta keeps lineage inside the share', () => {
  const out = trimMeta({ title: 'T', from: 'home/B', also: ['home/A', 'style/B'], slot: 's' }, [], new Set(['home']))
  assert.equal(out.from, 'home/B')
  assert.deepEqual(out.also, ['home/A'])
  assert.equal(out.slot, 's')
})
test('trimSession keeps lang', () => {
  assert.deepEqual(trimSession({ name: 'X', stack: 'react', lang: 'he', project: '/Users/x', url: 'https://m.ts.net', port: 5173, asks: [1] }), { name: 'X', stack: 'react', lang: 'he' })
  assert.equal(trimSession({ name: 'X', stack: 'react' }).lang, 'en')
})
