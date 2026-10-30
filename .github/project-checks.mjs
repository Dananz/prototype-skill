// One app per project: every conversation (session) works in .prototypes/_project, owns the
// prototypes it makes, and is listed in its registry. CLI only, no install, browser or server.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const skill = dirname(dirname(fileURLToPath(import.meta.url)))
const identityVars = ['PROTO_SESSION_ID', 'CODEX_THREAD_ID', 'CLAUDE_CODE_SESSION_ID', 'CLAUDE_SESSION_ID', 'PROTO_AGENT', 'PROTO_AGENT_PID', 'CLAUDE_PID']
/** Where the project's one app lives; the browser and smoke checks read it through this too. */
export const appOf = project => join(project, '.prototypes', '_project')

export function projectFixture(fn) {
  const project = mkdtempSync(join(tmpdir(), 'proto project checks '))
  const env = { ...process.env, PROTO_NO_UPDATE: '1', PROTO_NO_GC: '1' }
  identityVars.forEach(k => delete env[k])
  const call = (args, extra = {}) => spawnSync(process.execPath, [join(skill, 'scripts/proto.mjs'), ...args, '--project', project], { env: { ...env, ...extra }, encoding: 'utf8', timeout: 20_000 })
  const app = appOf(project)
  const json = f => JSON.parse(readFileSync(join(app, f), 'utf8'))
  try { return fn({ project, app, call, json }) } finally { rmSync(project, { recursive: true, force: true }) }
}
const ok = r => assert.equal(r.status, 0, r.stderr + r.stdout)

test('up creates one project app and registers the session', () => projectFixture(({ project, app, call, json }) => {
  ok(call(['up', '--session', 'one', '--no-serve']))
  assert.ok(existsSync(join(app, 'session.json')))
  assert.match(json('session.json').id, /^p-[0-9a-f]{8}$/)
  assert.ok(json('.proto/sessions.json').one.createdAt)
  assert.equal(existsSync(join(project, '.prototypes', 'one')), false)
}))

test('a second session joins the same app', () => projectFixture(({ call, json }) => {
  ok(call(['up', '--session', 'one', '--no-serve']))
  const id = json('session.json').id
  ok(call(['up', '--session', 'two', '--no-serve', '--name', 'Second']))
  assert.deepEqual(Object.keys(json('.proto/sessions.json')).sort(), ['one', 'two'])
  assert.equal(json('.proto/sessions.json').two.name, 'Second')
  assert.equal(json('session.json').id, id)
}))

test('url prints the project app url for any session', () => projectFixture(({ call }) => {
  ok(call(['up', '--session', 'one', '--no-serve']))
  ok(call(['up', '--session', 'two', '--no-serve']))
  const a = call(['url', '--session', 'one']), b = call(['url', '--session', 'two'])
  ok(a); ok(b)
  assert.equal(a.stdout, b.stdout)
}))

// Who made a prototype (session) and who works on it now (owner), and taken names.
const metaOf = (app, slug) => JSON.parse(readFileSync(join(app, 'src', 'protos', slug, 'meta.ts'), 'utf8').replace(/^[\s\S]*?export default\s*/, '').replace(/;?\s*$/, ''))
function twoSessions(fn) {
  return projectFixture(f => {
    ok(f.call(['up', '--session', 'one', '--no-serve']))
    ok(f.call(['up', '--session', 'two', '--no-serve']))
    ok(f.call(['add', 'home', '--title', 'Home page', '--variants', 'A:Current,B:Calm', '--session', 'one']))
    return fn(f)
  })
}

test('add stamps session and owner', () => twoSessions(({ app }) => {
  const m = metaOf(app, 'home')
  assert.equal(m.session, 'one')
  assert.equal(m.owner, 'one')
}))

test("another session's slug gets a new one", () => twoSessions(({ app, call }) => {
  const r = call(['add', 'home', '--title', 'Other home', '--variants', 'A:One', '--session', 'two'])
  ok(r)
  assert.match(r.stdout, /home-2/)
  assert.equal(metaOf(app, 'home-2').session, 'two')
  assert.equal(metaOf(app, 'home').title, 'Home page')
  assert.deepEqual(Object.keys(metaOf(app, 'home').variants), ['A', 'B'])
}))

test('--join adds variants and takes ownership', () => twoSessions(({ app, call }) => {
  ok(call(['add', 'home', '--join', '--variants', 'D:Extra', '--session', 'two']))
  const m = metaOf(app, 'home')
  assert.equal(m.owner, 'two')
  assert.equal(m.session, 'one')
  assert.ok(existsSync(join(app, 'src', 'protos', 'home', 'D.tsx')))
}))

test('work moves ownership', () => twoSessions(({ app, call }) => {
  ok(call(['add', 'home', '--join', '--variants', 'D:Extra', '--session', 'two']))
  ok(call(['work', 'home/A', '--session', 'one']))
  assert.equal(metaOf(app, 'home').owner, 'one')
}))

test('same session adds as today', () => twoSessions(({ app, call }) => {
  ok(call(['add', 'home', '--variants', 'E:More', '--session', 'one']))
  assert.ok(metaOf(app, 'home').variants.E)
  assert.equal(existsSync(join(app, 'src', 'protos', 'home-2')), false)
}))
