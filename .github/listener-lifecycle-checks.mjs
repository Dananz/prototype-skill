// No host scheduler or real session is used. Exercise the CLI and delivery pump against
// private temporary projects, including legacy registrations written by older releases.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:http'
import { commentListener, listenerStatus } from '../app/listener.mjs'

const cli = fileURLToPath(new URL('../scripts/proto.mjs', import.meta.url))
function fixture(t, { legacy = false } = {}) {
  const project = mkdtempSync(join(tmpdir(), 'proto-lifecycle-'))
  t.after(() => rmSync(project, { recursive: true, force: true }))
  const app = join(project, '.prototypes', '_project'), inbox = join(app, '.proto', 'inbox')
  const put = (path, data) => { mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, JSON.stringify(data)) }
  put(join(app, 'session.json'), { id: 'lifecycle', stack: 'react', createdAt: new Date().toISOString() })
  const meta = (slug, data = {}) => {
    const path = join(app, 'src', 'protos', slug, 'meta.ts')
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, `export default ${JSON.stringify({ variants: { A: { name: 'One' } }, ...data })}\n`)
  }
  meta('one')
  const config = join(project, 'private-config.json')
  put(config, { url: 'http://127.0.0.1:1/private-credential', id: 'owned-task', threadId: 'owning-thread' })
  const run = (args, ok = true) => {
    const r = spawnSync(process.execPath, [cli, ...args, '--project', project, '--session', 'lifecycle'], {
      encoding: 'utf8', timeout: 10_000, env: { ...process.env, HOME: project, USERPROFILE: project, PROTO_NO_GC: '1', PROTO_SHARE_POLL_MS: '0' },
    })
    assert.equal(r.status === 0, ok, r.stdout + r.stderr)
    assert.ok(!(r.stdout + r.stderr).includes('private-credential'), 'CLI must not reveal the webhook credential')
    return r.stdout + r.stderr
  }
  if (legacy) put(join(inbox, 'listener.json'), { ...JSON.parse(readFileSync(config)), session: 'lifecycle' })
  else run(['inbox', '--listen', config])
  const status = () => JSON.parse(run(['inbox', '--reconcile', '--json']))
  const batch = (sub, id, comments) => put(join(inbox, sub, id, 'batch.json'), { id, comments })
  // The conversation's listener (app/listener.mjs), or the single one of before until a command adopts it.
  const cfg = () => existsSync(join(inbox, 'listeners', 'lifecycle.json')) ? join(inbox, 'listeners', 'lifecycle.json') : join(inbox, 'listener.json')
  const receipts = join(inbox, 'listeners', 'lifecycle-notified.json')
  const age = () => {
    const old = new Date(Date.now() - 8 * 864e5)
    const path = cfg(), c = JSON.parse(readFileSync(path))
    c.lastActivityAt = old.toISOString(); put(path, c)
    put(join(app, 'session.json'), { id: 'lifecycle', stack: 'react', createdAt: old.toISOString() })
    for (const slug of ['one', 'two']) try { utimesSync(join(app, 'src', 'protos', slug, 'meta.ts'), old, old) } catch {}
    utimesSync(path, old, old)
  }
  return { project, app, inbox, put, meta, config, run, status, batch, age, cfg, receipts }
}

test('explicit session finish stops delivery and requests disabling only the owned task', t => {
  const f = fixture(t)
  f.run(['inbox', '--close', 'finished'])
  assert.equal(listenerStatus(f.app).listening, false)
  assert.deepEqual(f.status().hostAction, { action: 'disable', id: 'owned-task', threadId: 'owning-thread' })
  f.run(['inbox', '--host-disabled', 'wrong-task'], false)
  f.run(['inbox', '--host-disabled', 'owned-task'])
  assert.equal(f.status().hostAction, null)
  assert.equal(f.status().lifecycle, 'closed')
  if (process.platform !== 'win32') assert.equal(statSync(f.cfg()).mode & 0o777, 0o600)
})

test('ordinary replies and pump restarts keep a picked prototype connected', async t => {
  const f = fixture(t)
  f.meta('one', { picked: 'A' })
  f.batch('new', 'reply-batch', [{ n: 1, text: 'Review the winner', route: 'one/A' }])
  f.run(['inbox']); f.run(['reply', 'reply-batch', 'Reviewed', '--done'])
  let pump = commentListener(f.app, { intervalMs: 0 }); pump.close()
  pump = commentListener(f.app, { intervalMs: 0 }); await pump.flush(); pump.close()
  assert.equal(f.status().lifecycle, 'active')
  assert.equal(listenerStatus(f.app).listening, true)
  assert.equal(f.status().hostAction, null)
})

test('delivery of one prototype preserves the others until all feedback is finished', t => {
  const f = fixture(t); f.meta('two', { picked: 'A' })
  f.run(['inbox', '--finish', 'one'])
  assert.equal(f.status().lifecycle, 'active')
  f.run(['inbox', '--finish', 'two'])
  assert.equal(f.status().reason, 'delivered')
  assert.equal(f.status().hostAction.action, 'disable')
})

test('editing a delivered prototype requires finishing its feedback again', t => {
  const f = fixture(t); f.meta('two')
  f.run(['inbox', '--finish', 'one'])
  f.meta('one', { picked: 'A', title: 'Revised after delivery' })
  f.run(['inbox', '--finish', 'two'])
  assert.equal(f.status().lifecycle, 'active')
  f.run(['inbox', '--finish', 'one'])
  assert.equal(f.status().lifecycle, 'closed')
})

test('GC retains listener identity and opt-out after host disable confirmation', t => {
  const f = fixture(t)
  f.run(['inbox', '--unlisten']); f.run(['inbox', '--host-disabled', 'owned-task'])
  f.age()
  const old = new Date(Date.now() - 30 * 864e5)
  f.put(join(f.app, 'session.json'), { id: 'lifecycle', createdAt: old.toISOString(), stack: 'react' })
  utimesSync(join(f.app, 'src', 'protos', 'one', 'meta.ts'), old, old)
  f.put(join(f.project, '.prototypes', 'sessions.json'), [f.app])
  // GC's tailnet discovery is isolated from installed user commands.
  const r = spawnSync(process.execPath, [cli, 'gc'], { encoding: 'utf8', timeout: 10_000, env: { ...process.env, HOME: f.project, USERPROFILE: f.project, PATH: '/usr/bin:/bin' } })
  assert.equal(r.status, 0, r.stderr)
  assert.equal(f.status().lifecycle, 'opted-out')
  assert.equal(f.status().id, 'owned-task')
})

test('new, taken, malformed inbox work and open intake prevent terminal and stale cleanup', t => {
  for (const kind of ['new', 'taken', 'malformed', 'intake', 'building']) {
    const f = fixture(t)
    if (kind === 'intake') f.put(join(f.app, '.proto', 'intake', 'current.json'), { status: 'open', questions: ['Which?'] })
    else if (kind === 'building') f.put(join(f.app, 'session.json'), { id: 'lifecycle', stack: 'react', building: { one: ['A'] } })
    else f.batch(kind === 'malformed' ? 'new' : kind, 'pending', kind === 'malformed' ? null : [{ n: 1, text: 'Still reviewing' }])
    const out = f.run(['inbox', '--close', 'finished'], false)
    assert.match(out, /pending/i)
    if (kind !== 'building') f.age()
    assert.equal(f.status().lifecycle, 'active', kind)
  }
})

test('seven idle days close only on reconciliation, preserving pending and recent work', t => {
  const f = fixture(t); f.age()
  assert.equal(listenerStatus(f.app).listening, true, 'no autonomous host expiry')
  assert.equal(f.status().reason, 'inactive')
  assert.equal(f.status().hostEnabled, true, 'local cleanup does not claim host disable')
  const recent = fixture(t); recent.age(); recent.meta('two')
  assert.equal(recent.status().lifecycle, 'active')
})

test('explicit reopen reuses the task and receipts, waits for host enable, refuses duplicates', t => {
  const f = fixture(t)
  f.put(f.receipts, { sent: 'owned-task' })
  f.run(['inbox', '--close', 'abandoned']); f.run(['inbox', '--host-disabled', 'owned-task'])
  f.run(['inbox', '--reopen'])
  assert.deepEqual(f.status().hostAction, { action: 'enable', id: 'owned-task', threadId: 'owning-thread' })
  assert.equal(listenerStatus(f.app).listening, false)
  f.run(['inbox', '--host-enabled', 'owned-task'])
  f.run(['inbox', '--reopen']); f.run(['inbox', '--listen', f.config])
  assert.equal(f.status().id, 'owned-task')
  assert.equal(f.status().hostAction, null)
  assert.deepEqual(JSON.parse(readFileSync(f.receipts)), { sent: 'owned-task' })
  f.put(f.config, { url: 'http://127.0.0.1:1/other', id: 'duplicate', threadId: 'other-thread' })
  f.run(['inbox', '--listen', f.config], false)
})

test('explicit opt-out survives reconciliation and ordinary registration', t => {
  const f = fixture(t)
  f.run(['inbox', '--unlisten']); f.run(['inbox', '--host-disabled', 'owned-task'])
  f.run(['inbox', '--reopen'], false); f.run(['inbox', '--listen', f.config], false)
  assert.equal(f.status().lifecycle, 'opted-out')
  f.run(['inbox', '--reopen', '--again'])
  assert.equal(f.status().hostAction.action, 'enable')
})

test('legacy registrations migrate without duplicates, with idle cleanup and task identity retained', t => {
  const f = fixture(t, { legacy: true })
  assert.equal(f.status().lifecycle, 'active')
  f.age()
  assert.equal(f.status().hostAction.id, 'owned-task')
  f.run(['rm'], false)
  f.run(['inbox', '--host-disabled', 'owned-task'])
  f.run(['rm'])
})

test('recent legacy registration on an old app is activity, and status does not renew stale registrations', t => {
  const f = fixture(t, { legacy: true }), old = new Date(Date.now() - 30 * 864e5)
  f.put(join(f.app, 'session.json'), { id: 'lifecycle', stack: 'react', createdAt: old.toISOString() })
  utimesSync(join(f.app, 'src', 'protos', 'one', 'meta.ts'), old, old)
  assert.equal(f.status().lifecycle, 'active')
  f.age()
  assert.equal(f.status().lifecycle, 'closed')
  assert.equal(f.status().reason, 'inactive')
})

test('all archived prototypes close feedback, but one archived prototype preserves another review', t => {
  const f = fixture(t); f.meta('one', { archived: true }); f.meta('two')
  assert.equal(f.status().lifecycle, 'active')
  f.meta('two', { archived: true })
  assert.equal(f.status().hostAction.action, 'disable')
})

test('opt-out before registration cannot be silently replaced by setup', t => {
  const f = fixture(t)
  rmSync(f.cfg())
  f.run(['inbox', '--unlisten'])
  assert.equal(f.status().lifecycle, 'opted-out')
  f.run(['inbox', '--listen', f.config], false)
  f.run(['inbox', '--reopen', '--again']); f.run(['inbox', '--listen', f.config])
  assert.equal(f.status().lifecycle, 'active')
})

test('finishing a session preserves a prior explicit opt-out', t => {
  const f = fixture(t)
  f.run(['inbox', '--unlisten']); f.run(['inbox', '--close', 'finished'])
  assert.equal(f.status().lifecycle, 'opted-out')
  f.run(['inbox', '--reopen'], false)
})

test('completion before listener registration persists until explicit reopening', t => {
  const f = fixture(t)
  rmSync(f.cfg())
  f.run(['inbox', '--close', 'abandoned'])
  assert.equal(f.status().lifecycle, 'closed')
  f.run(['inbox', '--listen', f.config], false)
  f.run(['inbox', '--reopen']); f.run(['inbox', '--listen', f.config])
  assert.equal(f.status().id, 'owned-task')
})

test('closed delivery resumes only after host enable and preserves receipts across restart', async t => {
  const f = fixture(t)
  let requests = 0
  const server = createServer((req, res) => { requests++; req.resume(); res.end() })
  await new Promise(ok => server.listen(0, '127.0.0.1', ok))
  t.after(() => server.close())
  const path = f.cfg(), c = JSON.parse(readFileSync(path))
  f.put(path, { ...c, url: `http://127.0.0.1:${server.address().port}/private` })
  f.run(['inbox', '--close', 'finished'])
  f.batch('new', 'after-close', [{ n: 1, text: 'Saved for explicit reopening' }])
  const pump = commentListener(f.app, { intervalMs: 0 }); await pump.flush(); pump.close()
  assert.equal(requests, 0)
  assert.equal(f.status().lifecycle, 'closed')
  f.run(['inbox', '--host-disabled', 'owned-task']); f.run(['inbox', '--reopen'])
  const resumed = commentListener(f.app, { intervalMs: 0 })
  try {
    await resumed.flush()
    assert.equal(requests, 0, 'host enable must be confirmed first')
    f.run(['inbox', '--host-enabled', 'owned-task'])
    await resumed.flush()
    assert.equal(requests, 1)
  } finally { resumed.close() }
  const restarted = commentListener(f.app, { intervalMs: 0 })
  try { await restarted.flush(); assert.equal(requests, 1, 'same task must not repeat an accepted wake') }
  finally { restarted.close() }
})

// ---------- one app, several conversations: comments wake the one working on the prototype ----------
import { batchOwner } from '../app/listener.mjs'

function hooks(t) {
  const hits = { one: 0, two: 0 }
  const servers = Object.keys(hits).map(sid => createServer((req, res) => { hits[sid]++; req.resume(); res.end('ok') }))
  t.after(() => servers.forEach(s => s.close()))
  return { hits, ready: Promise.all(servers.map(s => new Promise(ok => s.listen(0, '127.0.0.1', ok)))).then(() => servers.map(s => `http://127.0.0.1:${s.address().port}/hook`)) }
}
async function twoListeners(t) {
  const f = fixture(t, { legacy: true })
  f.meta('home', { session: 'one', owner: 'one' })
  f.meta('cart', { session: 'two', owner: 'two' })
  const h = hooks(t), [u1, u2] = await h.ready
  const run = (sid, args, ok = true) => {
    const r = spawnSync(process.execPath, [cli, ...args, '--project', f.project, '--session', sid], { encoding: 'utf8', timeout: 10_000, env: { ...process.env, HOME: f.project, PROTO_NO_GC: '1', PROTO_SHARE_POLL_MS: '0' } })
    assert.equal(r.status === 0, ok, r.stdout + r.stderr)
    return r.stdout + r.stderr
  }
  for (const [sid, url] of [['one', u1], ['two', u2]]) {
    f.put(join(f.project, `${sid}.json`), { url, id: `task-${sid}`, threadId: `thread-${sid}` })
    run(sid, ['inbox', '--listen', join(f.project, `${sid}.json`)])
  }
  return { ...f, hits: h.hits, run }
}

test('a batch is owned by the owner of its first comment\'s prototype', async t => {
  const f = await twoListeners(t)
  assert.equal(batchOwner(f.app, { comments: [{ route: 'cart/A' }, { route: 'home/A' }] }), 'two')
  assert.equal(batchOwner(f.app, { comments: [{ action: 'intake' }] }), null)
})

test('two listeners coexist, each listening', async t => {
  const f = await twoListeners(t)
  assert.ok(existsSync(join(f.inbox, 'listeners', 'one.json')))
  assert.ok(existsSync(join(f.inbox, 'listeners', 'two.json')))
  assert.match(f.run('one', ['inbox', '--status']), /listening/)
  assert.match(f.run('two', ['inbox', '--status']), /listening/)
})

test('a batch wakes only its owner', async t => {
  const f = await twoListeners(t)
  f.put(join(f.inbox, 'new', 'b1', 'batch.json'), { id: 'b1', owner: 'one', comments: [{ n: 1, route: 'home/A', text: 'Hi' }] })
  const pump = commentListener(f.app, { intervalMs: 0 }); await pump.flush(); await pump.flush(); pump.close()
  assert.deepEqual(f.hits, { one: 1, two: 0 })
})

test('an owner without a listener falls through to one that listens', async t => {
  const f = await twoListeners(t)
  f.run('one', ['inbox', '--unlisten'])
  f.put(join(f.inbox, 'new', 'b2', 'batch.json'), { id: 'b2', owner: 'one', comments: [{ n: 1, route: 'home/A', text: 'Hi' }] })
  const pump = commentListener(f.app, { intervalMs: 0 }); await pump.flush(); await pump.flush(); pump.close()
  assert.deepEqual(f.hits, { one: 0, two: 1 })
})

test('inbox takes its own batches and orphans, not another listening owner\'s', async t => {
  const f = await twoListeners(t)
  f.put(join(f.inbox, 'new', 'mine', 'batch.json'), { id: 'mine', owner: 'two', comments: [{ n: 1, route: 'cart/A', text: 'Cart note' }] })
  f.put(join(f.inbox, 'new', 'theirs', 'batch.json'), { id: 'theirs', owner: 'one', comments: [{ n: 1, route: 'home/A', text: 'Home note' }] })
  const out = f.run('two', ['inbox'])
  assert.match(out, /Cart note/)
  assert.doesNotMatch(out, /Home note/)
  assert.ok(existsSync(join(f.inbox, 'new', 'theirs')))
})
