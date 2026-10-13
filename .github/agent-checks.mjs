// Fast CLI checks, with no package install, browser, server or real session mutations.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const skill = dirname(dirname(fileURLToPath(import.meta.url)))
const identityVars = ['PROTO_SESSION_ID', 'CODEX_THREAD_ID', 'CLAUDE_CODE_SESSION_ID', 'CLAUDE_SESSION_ID', 'PROTO_AGENT', 'PROTO_AGENT_PID', 'CLAUDE_PID']
function fixture(fn) {
  const project = mkdtempSync(join(tmpdir(), 'proto agent checks '))
  const env = { ...process.env }
  identityVars.forEach(k => delete env[k])
  const call = (args, extra = {}, cli = join(skill, 'scripts/proto.mjs')) => spawnSync(process.execPath, [cli, ...args, '--project', project], { env: { ...env, ...extra }, encoding: 'utf8', timeout: 10_000 })
  const session = id => {
    const dir = join(project, '.prototypes', id)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'session.json'), JSON.stringify({ id, localUrl: `http://example.test/${id}` }))
    return dir
  }
  try { fn({ project, call, session }) } finally { rmSync(project, { recursive: true, force: true }) }
}

for (const variable of identityVars.slice(0, 4)) test(`session from ${variable}`, () => fixture(({ call, session }) => {
  session('thread-one')
  const r = call(['url'], { [variable]: 'thread-one' })
  assert.equal(r.status, 0, r.stderr)
  assert.equal(r.stdout.trim(), 'http://example.test/thread-one')
}))

test('explicit session wins over inherited identities, generic then Codex then Claude', () => fixture(({ call, session }) => {
  for (const id of ['explicit', 'generic', 'codex', 'claude']) session(id)
  const env = { PROTO_SESSION_ID: 'generic', CODEX_THREAD_ID: 'codex', CLAUDE_CODE_SESSION_ID: 'claude' }
  for (const [args, extra, id] of [
    [['url', '--session', 'explicit'], env, 'explicit'],
    [['url'], env, 'generic'],
    [['url'], { ...env, PROTO_SESSION_ID: '' }, 'codex'],
    [['url'], { CLAUDE_CODE_SESSION_ID: 'claude' }, 'claude'],
  ]) assert.equal(call(args, extra).stdout.trim(), `http://example.test/${id}`)
}))

test('missing identity fails with portable recovery, no shared default', () => fixture(({ call }) => {
  const r = call(['url'])
  assert.equal(r.status, 1)
  assert.match(r.stderr, /--session/)
  assert.match(r.stderr, /PROTO_SESSION_ID/)
}))

test('UUIDv7 threads sharing a timestamp prefix stay separate, existing sessions resume', () => fixture(({ call, session }) => {
  const first = '0199a7c3-1b2e-7000-8000-000000000001'
  const second = '0199a7c3-4f90-7000-8000-000000000002'
  const legacy = session('0199a7c3')
  writeFileSync(join(legacy, 'session.json'), JSON.stringify({ id: first, localUrl: 'http://example.test/legacy' }))
  session(second)
  assert.equal(call(['url'], { CODEX_THREAD_ID: first }).stdout.trim(), 'http://example.test/legacy')
  assert.equal(call(['url'], { CODEX_THREAD_ID: second }).stdout.trim(), `http://example.test/${second}`)
}))

test('Claude UUIDv4 sessions keep their existing folder', () => fixture(({ call, session }) => {
  const id = 'deadbeef-1234-4000-8000-000000000001'
  const dir = session('deadbeef')
  writeFileSync(join(dir, 'session.json'), JSON.stringify({ id, localUrl: 'http://example.test/claude-legacy' }))
  assert.equal(call(['url'], { CLAUDE_CODE_SESSION_ID: id }).stdout.trim(), 'http://example.test/claude-legacy')
}))

test('normalized session name collision cannot read or alter another conversation', () => fixture(({ call, session }) => {
  const dir = session('reviewone')
  const before = readFileSync(join(dir, 'session.json'), 'utf8')
  const r = call(['keep', '--session', 'review one'])
  assert.equal(r.status, 1)
  assert.match(r.stderr, /different session/)
  assert.equal(readFileSync(join(dir, 'session.json'), 'utf8'), before)
}))

test('generic heartbeat records the selected parent session', () => fixture(({ call, session }) => {
  const dir = session('parent')
  const r = call(['url', '--session', 'parent'], { PROTO_AGENT_PID: String(process.pid), CODEX_THREAD_ID: 'child' })
  assert.equal(r.status, 0, r.stderr)
  const heartbeat = JSON.parse(readFileSync(join(dir, '.proto/inbox/agent.json'), 'utf8'))
  assert.equal(heartbeat.pid, process.pid)
  assert.equal(heartbeat.session, 'parent')
}))

test('comments taken by a dead generic agent are recovered once', () => fixture(({ call, session }) => {
  const dir = session('thread')
  const incoming = join(dir, '.proto/inbox/new/dead-agent/batch.json')
  mkdirSync(dirname(incoming), { recursive: true })
  writeFileSync(incoming, JSON.stringify({ id: 'dead-agent', comments: [{ n: 1, route: 'demo/A', text: 'Still pending' }] }))
  const dead = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' }).stdout.trim()
  const taken = call(['inbox', '--session', 'thread'], { PROTO_AGENT_PID: dead })
  assert.equal(taken.status, 0, taken.stderr)
  const file = join(dir, '.proto/inbox/taken/dead-agent/batch.json')
  assert.equal(String(JSON.parse(readFileSync(file, 'utf8')).takenBy.pid), dead)
  const env = { PROTO_AGENT_PID: String(process.pid) }
  const recovered = call(['inbox', '--session', 'thread'], env)
  assert.equal(recovered.status, 0, recovered.stderr)
  assert.match(recovered.stdout, /taken earlier by a session that ended/)
  assert.match(recovered.stdout, /Still pending/)
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).takenBy.pid, process.pid)
  assert.doesNotMatch(call(['inbox', '--session', 'thread'], env).stdout, /taken earlier by a session that ended/)
}))

test('reply attribution follows the active agent and explicit overrides', () => fixture(({ call, session }) => {
  const dir = session('thread')
  const batch = join(dir, '.proto/inbox/taken/test-batch/batch.json')
  mkdirSync(dirname(batch), { recursive: true })
  const cases = [
    [{ CODEX_THREAD_ID: 'thread' }, [], 'codex'],
    [{ CLAUDE_CODE_SESSION_ID: 'thread' }, [], 'claude'],
    [{ PROTO_SESSION_ID: 'thread' }, [], 'agent'],
    [{ PROTO_SESSION_ID: 'thread', PROTO_AGENT: 'codex' }, [], 'codex'],
    [{ CODEX_THREAD_ID: 'thread' }, ['--as', 'agent'], 'agent'],
    [{ CODEX_THREAD_ID: 'thread' }, ['--as', 'claude'], 'claude'],
  ]
  for (const [env, args, by] of cases) {
    writeFileSync(batch, JSON.stringify({ id: 'test-batch', comments: [{ n: 1 }] }))
    const r = call(['reply', 'test-batch/1', 'Fixed', '--done', ...args], env)
    assert.equal(r.status, 0, r.stderr)
    const saved = JSON.parse(readFileSync(batch, 'utf8'))
    assert.equal(saved.comments[0].reply.by, by)
    assert.equal(saved.comments[0].done, true)
  }
}))

test('skill installed through a symlink in a path with spaces can locate its resources', () => fixture(({ project, call }) => {
  const installed = join(project, 'installed skills', 'prototype')
  mkdirSync(dirname(installed), { recursive: true })
  symlinkSync(skill, installed, 'junction')
  const r = call(['fonts'], {}, join(installed, 'scripts/proto.mjs'))
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /Never for a title:/)
}))
