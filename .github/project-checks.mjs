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
