// Unit checks for the share-link pieces that need no browser: scope parsing, trimming and the pre-publish review.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ShareError, parseScope, trimMeta, trimSession } from '../app/share/scope.mjs'
import { review } from '../app/share/review.mjs'

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

const clean = { html: '<p>hello</p>', gzBytes: 1000, projectPath: '/Users/x/proj', home: '/Users/x', projectImports: [], currents: [] }
const run = over => review({ ...clean, ...over })
const codes = list => list.map(f => f.code)

test('review passes a clean share', () => {
  assert.deepEqual(run({}), { block: [], warn: [] })
})
test('secret blocks, one pattern each', () => {
  const fakes = {
    'private key': '-----BEGIN RSA PRIVATE KEY-----',
    'sk-': 'sk-' + 'a1B2'.repeat(6),
    'github': 'ghp_' + 'a1B2c3'.repeat(6),
    'aws': 'AKIA' + 'ABCD1234EFGH5678',
    'jwt': 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3.SflKxwRJSMeKKF2QT4fw',
    'bearer': 'Bearer abcdefghij0123456789.xyz',
    'doppler': 'dp.st.' + 'abcDEF1234'.repeat(2),
    'stripe live': 'sk_live_' + 'abcDEF1234'.repeat(2),
    'stripe restricted': 'rk_live_' + 'abcDEF1234'.repeat(2),
    'supabase': 'sb_secret_' + 'abcDEF_123-'.repeat(2),
  }
  for (const [name, value] of Object.entries(fakes)) {
    const r = run({ html: `<script>const k = "${value}"</script>` })
    assert.deepEqual(codes(r.block), ['secret'], name)
    assert.ok(!r.block[0].where.includes(value), `${name} is masked`)
    assert.ok(r.block[0].where.includes(value.slice(0, 4) + '…'), `${name} keeps its first four characters`)
  }
})
test('secret reports one finding per match', () => {
  const k = 'AKIA' + 'ABCD1234EFGH5678'
  assert.equal(run({ html: `${k} and ${k.replace('A', 'B')} and ${k}` }).block.length, 2)
})
test('jwt in a data url is not a secret', () => {
  const body = 'AAAA/eyJhbGciOiJIUzI1NiJ9+eyJzdWIiOiIxMjM0NTY3-abcdefghijklmnop'
  assert.deepEqual(run({ html: `<img src="data:image/webp;base64,${body}">` }).block, [])
  assert.deepEqual(run({ html: 'x/eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3.SflKxwRJSMeKKF2QT4fw' }).block, [])
})
test('abs path blocks', () => {
  assert.deepEqual(codes(run({ html: 'at /Users/x/proj/src/a.tsx' }).block), ['abs-path', 'abs-path'])
  assert.deepEqual(codes(run({ html: 'at /Users/x/other' }).block), ['abs-path'])
  assert.deepEqual(codes(run({ html: 'C:\\Users\\x\\proj', projectPath: 'C:/Users/x/proj', home: '/nowhere' }).block), ['abs-path'])
  assert.deepEqual(run({ html: 'nothing here' }).block, [])
})
test('size thresholds', () => {
  const mib = 2 ** 20
  assert.deepEqual(run({ gzBytes: 5 * mib }), { block: [], warn: [] })
  assert.deepEqual(codes(run({ gzBytes: 5 * mib + 1 }).warn), ['heavy'])
  assert.deepEqual(codes(run({ gzBytes: 20 * mib }).block), [])
  const big = run({ gzBytes: 20 * mib + 1 })
  assert.deepEqual(codes(big.block), ['too-big'])
  assert.deepEqual(codes(big.warn), [])
})
test('project code and real screens warn', () => {
  const r = run({ projectImports: ['/p/src/Button.tsx', '/p/src/ui/Card.tsx'], currents: ['home/A'] })
  assert.deepEqual(codes(r.warn), ['project-code', 'real-screens'])
  assert.ok(r.warn[0].message.includes('Button.tsx') && r.warn[0].message.includes('Card.tsx'))
})
test('outside urls warn once per origin', () => {
  const r = run({ html: '<img src="https://cdn.example.com/a.png"><img src="https://cdn.example.com/b.png"><a href="http://other.io/x">' })
  assert.deepEqual(r.warn.map(f => f.where), ['https://cdn.example.com', 'http://other.io'])
})
test('google fonts are not outside', () => {
  const html = '<link href="https://fonts.googleapis.com/css2?family=Inter"><link href="https://fonts.gstatic.com/s/inter.woff2">'
  assert.deepEqual(run({ html }), { block: [], warn: [] })
})
test('private urls warn', () => {
  for (const url of ['http://localhost:5173/a', 'http://127.0.0.1:3000', 'https://mac.tail1234.ts.net/x', 'http://10.0.0.5/a', 'http://192.168.1.2/a', 'http://172.16.0.1/a', 'http://172.31.9.9/a']) {
    assert.ok(codes(run({ html: `<img src="${url}">` }).warn).includes('private-url'), url)
  }
  assert.ok(!codes(run({ html: '<img src="http://172.32.0.1/a">' }).warn).includes('private-url'))
})
test('absolute asset path is reported', () => {
  assert.deepEqual(run({ html: '<img src="/assets/a.png">' }).warn.map(f => [f.code, f.where]), [['private-url', '/assets/a.png']])
  assert.deepEqual(run({ html: '.a{background:url(/img/b.png)} .b{background:url("/img/c.png")}' }).warn.map(f => f.where), ['/img/b.png', '/img/c.png'])
  assert.deepEqual(run({ html: '<img src="//cdn.example.com/a.png"><img src="data:image/png;base64,AAAA"><img src="a.png">' }).warn, [])
})
