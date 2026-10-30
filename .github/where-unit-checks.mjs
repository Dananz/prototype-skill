// Where the place on screen sits in the designs (app/shell/where.ts), for the bar's crumb and the
// flow's arrows, and what Jump (⌘K) searches: designs, flows, screens, explorations and options.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { test } from 'node:test'

const code = stripTypeScriptTypes(readFileSync(new URL('../app/shell/where.ts', import.meta.url), 'utf8'))
const { whereOf, jumpItems, jumpMatch, linkState } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
const P = (id, more = {}) => ({ id, title: more.title ?? id, kind: 'web', screen: [393, 852], archived: false, created: '2026-10-30T10:00:00Z', variants: ['A', 'B'].map(v => ({ id: v, name: `${id} ${v}` })), ...more })
const protos = [P('home', { title: 'Home', picked: 'B' }), P('about', { title: 'About' }), P('pricing', { title: 'Pricing' }), P('hero', { title: 'Hero CTA', from: { proto: 'home', variant: 'B' } }), P('cta', { title: 'CTA copy', from: { proto: 'hero', variant: 'A' } }), P('logo', { title: 'Logo' }), P('old', { archived: true })]
const designs = [{ id: 'acme', title: 'Acme', created: '', flows: [{ name: 'Main', screens: ['home', 'about'] }, { name: 'Buy', screens: ['pricing', 'home/A'] }] }]

test('a screen: its design, flow, place in the flow and its neighbours as routes', () => {
  const w = whereOf(protos, designs, { proto: 'about', variant: 'A' })
  assert.equal(w.design.title, 'Acme'); assert.equal(w.flow.name, 'Main'); assert.equal(w.at, 1)
  assert.deepEqual(w.flow.routes, ['home/B', 'about/A'])
  assert.equal(w.screen.id, 'about'); assert.equal(w.exploration, undefined)
})

test('a pinned screen is found by its letter, the unpinned one by its slug', () => {
  assert.equal(whereOf(protos, designs, { proto: 'home', variant: 'A' }).flow.name, 'Buy')
  assert.equal(whereOf(protos, designs, { proto: 'home', variant: 'B' }).flow.name, 'Main')
})

test('an exploration built on a screen, at any depth, sits under that screen', () => {
  const w = whereOf(protos, designs, { proto: 'cta', variant: 'B' })
  assert.equal(w.screen.id, 'home'); assert.equal(w.exploration.id, 'cta'); assert.equal(w.flow.name, 'Main')
})

test('an exploration on no screen is loose', () => {
  const w = whereOf(protos, designs, { proto: 'logo', variant: 'A' })
  assert.equal(w.design, undefined); assert.equal(w.loose, true); assert.equal(w.exploration.id, 'logo')
})

test('Jump lists designs, flows, screens, explorations and options, not the archive', () => {
  const items = jumpItems(protos, designs)
  const kinds = new Set(items.map(i => i.kind))
  for (const k of ['design', 'flow', 'screen', 'exploration', 'option']) assert.ok(kinds.has(k), k)
  assert.equal(items.find(i => i.key === 'design:acme').route, 'home/B')
  assert.equal(items.find(i => i.key === 'flow:acme:Buy').route, 'pricing/A')
  assert.ok(!items.some(i => i.route?.startsWith('old/')))
})

test('Jump matches words in any case, names that start with the query first', () => {
  const items = jumpItems(protos, designs)
  const r = jumpMatch(items, 'cta')
  assert.equal(r[0].label, 'CTA copy')
  assert.ok(r.some(i => i.label === 'Hero CTA'))
  assert.deepEqual(jumpMatch(items, 'zzz'), [])
  assert.ok(jumpMatch(items, '').length > 0, 'an empty query lists the screens first')
  assert.equal(jumpMatch(items, '')[0].kind, 'design')
})

test('a flow lists each screen once and leaves out a gone one; the arrows walk what is left', () => {
  const ps = [...protos, P('old', { archived: true })]
  const ds = [{ id: 'acme', title: 'Acme', created: '', flows: [{ name: 'Main', screens: ['home', 'old', 'about', 'home', 'pricing'] }] }]
  const w = whereOf(ps, ds, { proto: 'pricing', variant: 'A' })
  assert.deepEqual(w.flow.routes, ['home/B', 'about/A', 'pricing/A'])
  assert.equal(w.at, 2)
})

test('a from loop between two prototypes leaves each its own root', () => {
  const ps = [P('x', { from: { proto: 'y', variant: 'A' } }), P('y', { from: { proto: 'x', variant: 'A' } })]
  assert.equal(whereOf(ps, [], { proto: 'x', variant: 'A' }).loose, true)
})

test('what a link chip says about the screen it goes to', () => {
  assert.equal(linkState(P('a', { picked: 'B' }), 'B').kind, 'picked')
  assert.equal(linkState(P('a'), 'A').kind, 'stand-in')
  assert.equal(linkState(P('a'), 'B').kind, 'pinned')
  assert.equal(linkState(P('a', { picked: 'A' }), 'B').kind, 'pinned')
})
