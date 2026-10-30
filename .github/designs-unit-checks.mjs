// Designs (src/designs/<id>/design.ts) and the conversation fields of a prototype, as the page reads them.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { test } from 'node:test'

const code = stripTypeScriptTypes(readFileSync(new URL('../app/src/registry-core.ts', import.meta.url), 'utf8'))
const { designsOf, protosOf } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)

test('a design: its id from the folder, from as a route, flows of slugs only', () => {
  assert.deepEqual(designsOf({ './designs/acme/design.ts': { title: 'Acme', created: '2026-10-30T10:00:00Z', from: 'home/C', flows: [{ name: 'Main', screens: ['home', 'about', 7] }] } }),
    [{ id: 'acme', title: 'Acme', created: '2026-10-30T10:00:00Z', from: { proto: 'home', variant: 'C' }, flows: [{ name: 'Main', screens: ['home', 'about'] }] }])
})

test('no flows is an empty list, and designs come oldest first', () => {
  const list = designsOf({
    './designs/b/design.ts': { title: 'B', created: '2026-10-30T12:00:00Z' },
    './designs/a/design.ts': { title: 'A', created: '2026-10-30T11:00:00Z', flows: [{ name: 'Main' }, 'x'] },
  })
  assert.deepEqual(list.map(d => d.id), ['a', 'b'])
  assert.deepEqual(list[0].flows, [{ name: 'Main', screens: [] }])
  assert.deepEqual(list[1].flows, [])
})

test('a prototype keeps the conversation that made it, the one on it now, and next', () => {
  const [p] = protosOf({ './protos/home/meta.ts': { title: 'Home', session: 'one', owner: 'two', next: true, variants: { A: 'One' } } }, { './protos/home/A.tsx': () => Promise.resolve() })
  assert.equal(p.session, 'one'); assert.equal(p.owner, 'two'); assert.equal(p.next, true)
})
