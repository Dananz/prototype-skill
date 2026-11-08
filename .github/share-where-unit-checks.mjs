// Unit checks for proto share where: which project on this Mac made a link, the project app's copy
// before a legacy session folder's, and --bring for a link only a migrated legacy folder holds.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { whereShare } from '../scripts/share.mjs'

const PROTO = fileURLToPath(new URL('../scripts/proto.mjs', import.meta.url))
const ID = 'weh0pb5y5r'
const entry = (o = {}) => ({ id: ID, host: 'online', title: 'More tiles', scope: { protos: [{ id: 'tiles', variants: ['A', 'B'] }], start: 'tiles/A' }, version: 2, publishedAt: '2026-11-01T00:00:00.000Z', ...o })
const put = (f, v) => { mkdirSync(join(f, '..'), { recursive: true }); writeFileSync(f, JSON.stringify(v)) }

function mac() {
  const home = mkdtempSync(join(tmpdir(), 'where-'))
  const project = join(home, 'Code', 'shop'), root = join(project, '.prototypes')
  put(join(home, '.prototypes', 'sessions.json'), [join(root, 'old-session')])
  mkdirSync(join(root, '_project', 'src', 'protos', 'tiles'), { recursive: true })
  writeFileSync(join(root, '_project', 'src', 'protos', 'tiles', 'meta.ts'), 'export default {}\n')
  put(join(root, '_project', '.proto', 'shares.json'), [])
  return { home, project, root, index: join(home, '.prototypes', 'sessions.json') }
}
const run = (home, ...args) => spawnSync(process.execPath, [PROTO, 'share', 'where', ...args], { env: { ...process.env, HOME: home, XDG_CONFIG_HOME: join(home, '.config') }, encoding: 'utf8' })

test('a link in the project app is found there, before a legacy folder that holds it too', () => {
  const m = mac()
  put(join(m.root, 'old-session', '.proto', 'shares.json'), [entry({ publishedAt: '2026-12-01T00:00:00.000Z' })])
  put(join(m.root, '_project', '.proto', 'shares.json'), [entry()])
  const found = whereShare(ID, { index: m.index })
  assert.equal(found.project, m.project)
  assert.equal(found.dir, join(m.root, '_project'))
  assert.equal(found.app, true)
  assert.equal(whereShare('zzzzzzzzzz', { index: m.index }), null)
})

test('proto share where prints the project and the next step; a link this Mac never made exits 1', () => {
  const m = mac()
  put(join(m.root, '_project', '.proto', 'shares.json'), [entry()])
  const r = run(m.home, `https://prtype.dev/${ID}`)
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /"More tiles" v2, tiles\/A,B/)
  assert.match(r.stdout, new RegExp(`proto up --project ${m.project}, .* proto share update ${ID}`))
  const none = run(m.home, 'https://zzzzzzzzzz.prtype.dev/')
  assert.equal(none.status, 1)
  assert.match(none.stdout, /No session on this Mac made zzzzzzzzzz/)
  assert.notEqual(run(m.home, 'https://example.com/x').status, 0)
})

test('--bring moves a legacy folder\'s link into the project app, once, and refuses when its prototype is gone', () => {
  const m = mac()
  put(join(m.root, 'old-session', '.proto', 'shares.json'), [entry()])
  put(join(m.root, 'old-session', '.proto', 'shares', ID, 'v2', 'tiles', 'meta.ts'), 'x')
  assert.match(run(m.home, ID).stdout, /--bring lets proto share update reach it/)
  for (let i = 0; i < 2; i++) assert.equal(run(m.home, ID, '--bring').status, 0)
  const mine = JSON.parse(readFileSync(join(m.root, '_project', '.proto', 'shares.json'), 'utf8'))
  assert.deepEqual(mine.map(e => [e.id, e.session]), [[ID, 'old-session']])
  assert.ok(readFileSync(join(m.root, '_project', '.proto', 'shares', ID, 'v2', 'tiles', 'meta.ts'), 'utf8'))
  assert.match(run(m.home, ID).stdout, /proto share update/)
  const gone = mac()
  put(join(gone.root, 'old-session', '.proto', 'shares.json'), [entry({ scope: { protos: [{ id: 'missing', variants: ['A'] }] } })])
  const r = run(gone.home, ID, '--bring')
  assert.notEqual(r.status, 0)
  assert.match(r.stderr + r.stdout, /has no missing/)
})

test('a project born with the project app, whose index entry is its _project folder, is found too', () => {
  const m = mac()
  put(m.index, [join(m.root, '_project')])
  put(join(m.root, '_project', '.proto', 'shares.json'), [entry()])
  const found = whereShare(ID, { index: m.index })
  assert.equal(found?.project, m.project)
  assert.equal(found?.app, true)
})
