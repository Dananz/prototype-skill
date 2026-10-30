// The project tree's model (app/shell/tree/model.ts): designs › flows › screens, the explorations
// hanging under them, and each exploration's state.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { test } from 'node:test'

const load = name => stripTypeScriptTypes(readFileSync(new URL(`../app/shell/${name}`, import.meta.url), 'utf8'))
const url = code => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
const { stateOf, treeOf } = await import(url(load('tree/model.ts').replace(/from '\.\.\/variants'/, `from '${url(load('variants.ts'))}'`)))

const P = (id, more = {}) => ({ id, title: id[0].toUpperCase() + id.slice(1), archived: false, created: more.created ?? '2026-10-30T10:00:00Z', session: 'one', variants: ['A', 'B', 'C'].map(v => ({ id: v, name: `${id} ${v}` })), ...more })
const protos = [
  P('home', { picked: 'C' }),
  P('about'),
  P('signup', { picked: 'A', session: 'two' }),
  P('hero-cta', { from: { proto: 'home', variant: 'C' }, picked: 'A' }),
  P('cta-copy', { from: { proto: 'hero-cta', variant: 'B' }, session: 'two' }),
  P('logo', { picked: 'B', session: 'two', created: '2026-10-30T11:00:00Z' }),
  P('old', { archived: true }),
]
const designs = [{ id: 'acme', title: 'Acme', created: '', from: { proto: 'home', variant: 'C' }, flows: [{ name: 'Main', screens: ['home', 'about'] }, { name: 'Sign up', screens: ['signup'] }] }]
const byId = new Map(protos.map(p => [p.id, p]))
const none = new Set()
const find = (nodes, key) => { for (const n of nodes) { if (n.key === key) return n; const f = find(n.children, key); if (f) return f } return null }
const keys = nodes => nodes.flatMap(n => [n.key, ...keys(n.children)])

test('stateOf: done, open, stale, waits, building', () => {
  assert.equal(stateOf(byId.get('home'), byId, none), 'done')
  assert.equal(stateOf(byId.get('about'), byId, none), 'open')
  assert.equal(stateOf(byId.get('cta-copy'), byId, none), 'stale')
  const kid = P('kid', { from: { proto: 'about', variant: 'A' } })
  assert.equal(stateOf(kid, new Map([...byId, ['kid', kid]]), none), 'waits')
  assert.equal(stateOf(byId.get('about'), byId, new Set(['about/B'])), 'building')
})

test('all: design › flow › screen › options and the explorations built on them', () => {
  const { nodes } = treeOf(protos, designs, { filter: 'all', me: null, building: none })
  const acme = find(nodes, 'design:acme'), main = find(nodes, 'flow:acme:Main'), home = find(nodes, 'screen:home')
  assert.equal(acme.label, 'Acme'); assert.ok(acme.children.includes(main))
  assert.deepEqual(home.children.map(n => n.key), ['opt:home/A', 'opt:home/B', 'opt:home/C', 'exp:hero-cta'])
  assert.equal(home.route, 'home/C'); assert.equal(home.state, 'done')
  assert.equal(find(nodes, 'opt:home/C').picked, true)
  assert.equal(find(nodes, 'opt:home/C').became, 'Acme')
  const hero = find(nodes, 'exp:hero-cta')
  assert.equal(hero.on, 3); assert.equal(hero.route, 'hero-cta/A')
  const copy = find(hero.children, 'exp:cta-copy')
  assert.equal(copy.on, 2); assert.equal(copy.state, 'stale')
  const about = find(nodes, 'screen:about')
  assert.equal(about.standIn, true); assert.equal(about.route, 'about/A')
  assert.deepEqual(find(nodes, 'section:loose').children.map(n => n.key), ['exp:logo'])
  const archive = find(nodes, 'section:archive')
  assert.equal(archive.count, 1); assert.deepEqual(archive.children.map(n => n.key), ['exp:old'])
})

test('open: only what still waits on the user, with its count', () => {
  const { nodes, waiting } = treeOf(protos, designs, { filter: 'open', me: null, building: none })
  const ks = keys(nodes)
  assert.ok(ks.includes('screen:about'))
  assert.ok(ks.includes('exp:hero-cta') && ks.includes('exp:cta-copy'))
  assert.ok(!ks.includes('screen:signup') && !ks.includes('flow:acme:Sign up'))
  assert.ok(!ks.includes('exp:logo') && !ks.includes('section:archive'))
  assert.equal(waiting, 2)
})

test('mine: only what this conversation made, and the designs that hold it', () => {
  const ks = keys(treeOf(protos, designs, { filter: 'mine', me: 'one', building: none }).nodes)
  assert.ok(ks.includes('design:acme') && ks.includes('screen:home') && ks.includes('exp:hero-cta'))
  assert.ok(!ks.includes('exp:cta-copy') && !ks.includes('screen:signup') && !ks.includes('exp:logo'))
})

test('a flow naming a missing slug yields no node', () => {
  const d = [{ ...designs[0], flows: [{ name: 'Main', screens: ['home', 'ghost'] }] }]
  const { nodes } = treeOf(protos, d, { filter: 'all', me: null, building: none })
  assert.equal(find(nodes, 'screen:ghost'), null)
  assert.ok(find(nodes, 'screen:home'))
})

test('loops and missing parents make roots, and the model returns', () => {
  const list = [P('a', { from: { proto: 'b', variant: 'A' } }), P('b', { from: { proto: 'a', variant: 'A' } }), P('c', { from: { proto: 'missing', variant: 'A' } })]
  const loose = find(treeOf(list, [], { filter: 'all', me: null, building: none }).nodes, 'section:loose')
  assert.deepEqual(loose.children.map(n => n.key).sort(), ['exp:a', 'exp:b', 'exp:c'])
})
