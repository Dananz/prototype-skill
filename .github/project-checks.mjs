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
  // HOME too: the global index of apps (~/.prototypes) stays the temporary project's.
  const env = { ...process.env, PROTO_NO_UPDATE: '1', PROTO_NO_GC: '1', HOME: project, USERPROFILE: project }
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

test('up records the conversation that started the app', () => projectFixture(({ call, json }) => {
  ok(call(['up', '--session', 'one', '--no-serve']))
  assert.equal(json('session.json').conversation, 'one')
  ok(call(['up', '--session', 'two', '--no-serve']))
  assert.equal(json('session.json').conversation, 'two')
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

// ---------- the project world: gc, rm, ls, shares and kits ----------
import { utimesSync, writeFileSync, mkdirSync } from 'node:fs'
import { shareSession } from '../app/share/publish.mjs'

test('gc never deletes the project app', () => projectFixture(({ project, app, call }) => {
  ok(call(['up', '--session', 'one', '--no-serve']))
  const s = JSON.parse(readFileSync(join(app, 'session.json'), 'utf8')), old = new Date(Date.now() - 60 * 864e5)
  writeFileSync(join(app, 'session.json'), JSON.stringify({ ...s, createdAt: old.toISOString(), deleteDays: 1 }))
  for (const f of ['session.json', 'package.json']) utimesSync(join(app, f), old, old)
  // No tailscale on the PATH: gc's tailnet sweep must never see this Mac's real rules from a test.
  const r = call(['gc', '--session', 'one'], { PROTO_NO_GC: '', PATH: '/usr/bin:/bin' })
  ok(r)
  assert.ok(existsSync(join(app, 'session.json')))
}))

test("rm removes only this conversation's prototypes", () => twoSessions(({ app, call }) => {
  ok(call(['add', 'cart', '--variants', 'A:One', '--session', 'two']))
  mkdirSync(join(app, 'src', 'history', 'cart', 'A', '1'), { recursive: true })
  ok(call(['rm', '--session', 'two']))
  assert.ok(existsSync(join(app, 'src', 'protos', 'home', 'meta.ts')))
  assert.equal(existsSync(join(app, 'src', 'protos', 'cart')), false)
  assert.equal(existsSync(join(app, 'src', 'history', 'cart')), false)
  assert.equal('two' in JSON.parse(readFileSync(join(app, '.proto', 'sessions.json'), 'utf8')), false)
}))

test('ls shows the project, then each conversation', () => twoSessions(({ call }) => {
  const r = call(['ls', '--session', 'one'])
  ok(r)
  const lines = r.stdout.split('\n')
  assert.match(lines[0], /^project /)
  assert.equal(lines.filter(l => l.startsWith('  session ')).length, 2)
  assert.match(r.stdout, /session one .*1 prototype/)
}))

test('an update publishes under the session the share was made in', () => {
  assert.equal(shareSession({ session: 'two' }, { id: 'p-1234abcd' }, '/x/_project'), 'two')
  assert.equal(shareSession({}, { id: 'p-1234abcd' }, '/x/_project'), 'p-1234abcd')
  assert.equal(shareSession(null, {}, '/x/legacy'), 'legacy')
})

test('a kit whose look differs from the project gets its own scope', () => twoSessions(({ project, app, call }) => {
  writeFileSync(join(app, 'src', 'theme.css'), '@theme { --color-brand: #111; }\n')
  const kd = join(project, '.prototypes', '_kits', 'main')
  mkdirSync(join(kd, 'parts'), { recursive: true })
  writeFileSync(join(kd, 'kit.json'), JSON.stringify({ stack: 'react', parts: [], screens: {}, packages: {}, sources: [] }))
  writeFileSync(join(kd, 'theme.css'), '@theme { --color-brand: #222; }\n')
  ok(call(['add', 'pay', '--kit', '--variants', 'A:One', '--session', 'one']))
  const css = readFileSync(join(app, 'src', 'theme.css'), 'utf8')
  assert.match(css, /--color-brand: #111/)
  assert.match(css, /\[data-proto-theme="kit:main"\]/)
  assert.equal(metaOf(app, 'pay').theme, 'kit:main')
  ok(call(['add', 'pay2', '--kit', '--variants', 'A:One', '--session', 'one']))
  assert.equal(readFileSync(join(app, 'src', 'theme.css'), 'utf8').match(/data-proto-theme="kit:main"/g).length, 1)
}))
