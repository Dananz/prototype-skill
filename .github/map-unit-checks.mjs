// The map's layout (app/shell/map/world.ts): designs in flows of screens, rounds under them, stacks
// that fold a pick, spreads for open explorations, loose explorations on top.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { test } from 'node:test'

const code = stripTypeScriptTypes(readFileSync(new URL('../app/shell/map/world.ts', import.meta.url), 'utf8'))
const { worldOf, linePath } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
const P = (id, more = {}) => ({ id, title: id, kind: 'web', screen: [393, 852], archived: false, created: more.created ?? '2026-10-30T10:00:00Z', variants: ['A', 'B', 'C'].map(v => ({ id: v, name: `${id} ${v}` })), ...more })
const protos = [P('home', { picked: 'C' }), P('about'), P('hero', { from: { proto: 'home', variant: 'C' }, picked: 'A' }), P('logo')]
const designs = [{ id: 'acme', title: 'Acme', created: '', flows: [{ name: 'Main', screens: ['home', 'about'] }] }]
const board = (w, key) => w.boards.find(b => b.key === key)

test('screens sit in a row, at their frame size, showing their pick or #1', () => {
  const w = worldOf(protos, designs)
  const home = board(w, 'screen:home'), about = board(w, 'screen:about')
  assert.equal(home.route, 'home/C'); assert.equal(about.route, 'about/A'); assert.equal(about.standIn, true)
  assert.equal(home.w, 1200); assert.equal(home.y, about.y); assert.ok(about.x > home.x + home.w)
})

test('a picked exploration is a stack of 3 with its pick on top; an open one is spread', () => {
  const w = worldOf(protos, designs)
  const stack = w.boards.filter(b => b.slug === 'hero')
  assert.equal(stack.length, 3); assert.equal(stack.find(b => b.pile === 0).letter, 'A')
  const spread = w.boards.filter(b => b.slug === 'about' && b.kind === 'option')
  assert.equal(spread.length, 3); assert.ok(spread.every(b => b.pile === undefined))
  assert.equal(worldOf(protos, designs, new Set(['hero'])).boards.filter(b => b.slug === 'hero').length, 3)
  assert.ok(worldOf(protos, designs, new Set(['hero'])).boards.filter(b => b.slug === 'hero').every(b => b.pile === undefined), 'an opened stack spreads')
})

test('rounds hang under their screen; loose explorations lead the map', () => {
  const w = worldOf(protos, designs)
  assert.ok(board(w, 'opt:hero/A').y > board(w, 'screen:home').y)
  assert.ok(board(w, 'opt:logo/A').y < board(w, 'screen:home').y)
  assert.ok(w.labels.some(l => l.key === 'flow:acme:Main') && w.labels.some(l => l.key === 'section:loose'))
})

test('a pinned screen shows its letter, and no options under it', () => {
  const two = [...designs, { id: 'b', title: 'B', created: '', flows: [{ name: 'Main', screens: ['home/B'] }] }]
  const w = worldOf(protos, two)
  assert.equal(board(w, 'screen:home/B').route, 'home/B')
})

test('lines between boards leave from an edge', () => {
  assert.match(linePath({ x: 0, y: 0, w: 100, h: 50 }, { x: 300, y: 0, w: 100, h: 50 }), /^M100,25 C/)
  assert.match(linePath({ x: 0, y: 0, w: 100, h: 50 }, { x: 0, y: 400, w: 100, h: 50 }), /^M75,50 C/)
})

test('a pinned screen with no unpinned entry still shows what is built on it (a share)', () => {
  const pinned = [{ id: 'acme', title: 'Acme', created: '', flows: [{ name: 'Main', screens: ['home/C', 'about/A'] }] }]
  const w = worldOf(protos, pinned)
  assert.ok(w.boards.some(b => b.slug === 'hero'), 'hero, built on home, is drawn under the pinned home')
})
