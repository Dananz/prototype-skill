// A session that took comments and ended (T3 Code restarted, the terminal closed) never answers
// them. The batch records who took it (CLAUDE_PID), so the page can say "not picked up" instead of
// "Claude is on it", and the next agent that takes the inbox is handed them again, once, in full.
// Needs no page: the batches are written into the inbox as the server writes them.
// Runs in the smoke suite, or on its own: node .github/listener-checks.mjs
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export async function listenerChecks({ proto, app, fail }) {
  const inbox = join(app, '.proto', 'inbox')
  const send = (id, texts) => {
    const folder = join(inbox, 'new', id)
    mkdirSync(folder, { recursive: true })
    writeFileSync(join(folder, 'batch.json'), JSON.stringify({ id, at: new Date().toISOString(), theme: 'dark', comments: texts.map((text, i) => ({ n: i + 1, route: 'listenfx/A', text })) }))
  }
  const file = id => join(inbox, 'taken', id, 'batch.json')
  const batch = id => JSON.parse(readFileSync(file(id), 'utf8'))
  // A process that has ended: its pid is what a dead agent leaves behind.
  const dead = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' }).stdout.trim()
  const as = (pid, fn) => {
    const before = process.env.CLAUDE_PID
    if (pid) process.env.CLAUDE_PID = String(pid); else delete process.env.CLAUDE_PID
    try { return fn() } finally { if (before === undefined) delete process.env.CLAUDE_PID; else process.env.CLAUDE_PID = before }
  }

  // Taking records who took it; an agent with no CLAUDE_PID leaves nothing to judge by.
  const bare = '20990102T000100-lst2'
  send(bare, ['Taken by an agent with no pid'])
  as(0, () => proto(['inbox']))
  if (batch(bare).takenBy) fail(`no CLAUDE_PID should record no taker: ${JSON.stringify(batch(bare).takenBy)}`)
  proto(['reply', bare, 'ok', '--done'])

  const id = '20990102T000000-lst1'
  send(id, ['First, never answered', 'Second, answered', 'Third, never answered'])
  as(dead, () => proto(['inbox']))
  if (String(batch(id).takenBy?.pid) !== dead) fail(`taking a batch should record the taker's pid (${dead}): ${JSON.stringify(batch(id).takenBy)}`)
  const mark = JSON.parse(readFileSync(join(inbox, 'agent.json'), 'utf8'))
  if (String(mark.pid) !== dead) fail(`a command run by an agent should record who it is in agent.json: ${JSON.stringify(mark)}`)

  // The second comment was answered before the session ended: only the other two come back.
  const b = batch(id)
  b.comments[1].reply = { text: 'Done it', at: new Date().toISOString(), by: 'claude' }
  writeFileSync(file(id), JSON.stringify(b))
  const heard = as(process.pid, () => proto(['inbox'], { stdout: true }))
  if (!heard.includes('taken earlier by a session that ended') || !heard.includes('First, never answered') || !heard.includes('Third, never answered') || heard.includes('Second, answered')) fail(`proto inbox should hand over the comments a dead session never answered, and only those: ${heard}`)
  if (batch(id).takenBy?.pid !== process.pid) fail(`the batch should now belong to the agent that was handed it: ${JSON.stringify(batch(id).takenBy)}`)
  const again = as(process.pid, () => proto(['inbox'], { stdout: true }))
  if (again.includes('taken earlier by a session that ended')) fail(`a handed-over batch should not be handed over twice: ${again}`)

  // --wait hands them over at once, as an arrival does, instead of listening past them.
  const b2 = batch(id)
  b2.takenBy = { pid: Number(dead), at: new Date().toISOString() }
  writeFileSync(file(id), JSON.stringify(b2))
  const waited = as(process.pid, () => proto(['inbox', '--wait', '--timeout', '1'], { stdout: true }))
  if (!waited.includes('First, never answered') || waited.includes('listening for comments')) fail(`proto inbox --wait should return the orphaned comments at once: ${waited}`)

  proto(['reply', id, '1', 'Fixed', '3', 'Fixed', '--done'])
  proto(['reply', `${id}/2`, '--done'])
  console.log('\nOK: comments a dead session took are handed to the next one, once')
}

// Two separate sends must wake the same subscription without rearming it. Failed delivery
// stays in new/ and retries; restarting the server neither loses nor repeats accepted wakes.
export async function continuousListenerChecks({ fail }) {
  const skill = dirname(dirname(fileURLToPath(import.meta.url)))
  const project = mkdtempSync(join(tmpdir(), 'proto-continuous-'))
  const app = join(project, '.prototypes', '_project')
  mkdirSync(join(app, 'src', 'protos'), { recursive: true })
  writeFileSync(join(app, 'session.json'), JSON.stringify({ stack: 'react' }))
  const proto = (args, { ok = true, stdout = false } = {}) => {
    const r = spawnSync(process.execPath, [join(skill, 'scripts/proto.mjs'), ...args, '--project', project, '--session', 'continuous'], { encoding: 'utf8' })
    if (ok ? r.status !== 0 : r.status === 0) throw new Error(`proto ${args[0]}: ${r.stderr || r.stdout}`)
    return stdout ? r.stdout : r.stdout + r.stderr
  }
  const inbox = join(app, '.proto', 'inbox'), config = join(project, 'wake-config.json')
  const send = id => {
    const folder = join(inbox, 'new', id)
    mkdirSync(folder, { recursive: true })
    writeFileSync(join(folder, 'batch.json'), JSON.stringify({ id, comments: [{ n: 1, route: 'listenfx/A', text: id }] }))
  }
  const requests = []; let reject = false
  const server = createServer((req, res) => {
    let body = ''; req.on('data', b => body += b)
    req.on('end', () => { try { if (body) requests.push(JSON.parse(body)) } catch { /* a probe with no body */ } res.writeHead(reject ? 503 : 200); res.end() })
  })
  await new Promise(ok => server.listen(0, '127.0.0.1', ok))
  const url = `http://127.0.0.1:${server.address().port}/wake`
  let listener
  try {
    writeFileSync(config, JSON.stringify({ url, id: 'one-subscription', threadId: 'original-thread' }))
    proto(['inbox', '--listen', config])
    const registration = join(inbox, 'listeners', 'continuous.json')
    if (!existsSync(registration)) return fail('continuous listening must persist one subscription instead of ending after a batch')
    if (process.platform !== 'win32' && (statSync(registration).mode & 0o777) !== 0o600) fail('listener credential must be private to its owner')
    const { commentListener } = await import('../app/listener.mjs')
    listener = commentListener(app, { retryMs: 20, intervalMs: 10 })
    const waitForCount = async count => {
      for (let i = 0; i < 100 && requests.length < count; i++) await new Promise(ok => setTimeout(ok, 10))
    }
    send('20990102T001000-cont1'); await waitForCount(1)
    send('20990102T001001-cont2'); await waitForCount(2)
    await listener.flush()
    listener.close(); listener = commentListener(app, { retryMs: 20, intervalMs: 0 })
    if (requests.length !== 2) fail(`both successive comments must wake the same listener: ${JSON.stringify(requests)}`)
    if (!existsSync(join(inbox, 'new', '20990102T001001-cont2'))) fail('notification must leave comments for the agent to claim')
    proto(['inbox', '--listen', config])
    const waited = proto(['inbox', '--wait', '--timeout', '.001'], { stdout: true })
    if (!waited.includes('persistent listener')) fail(`--wait must reuse the persistent listener: ${waited}`)
    await listener.flush()
    if (requests.length !== 2) fail('idempotent registration must not repeat delivered comments')
    listener.close(); listener = commentListener(app, { retryMs: 20, intervalMs: 0 })
    await listener.flush()
    if (requests.length !== 2) fail('server restart must preserve delivery receipts')
    reject = true; send('20990102T001002-cont3'); await listener.flush()
    if (listener.status().listening) fail('failed wake must not claim to be listening')
    reject = false; await new Promise(ok => setTimeout(ok, 25)); await listener.flush()
    if (!listener.status().listening || requests.length !== 4) fail('a failed notification must retry and recover')
    reject = true; send('20990102T001003-cont4'); await listener.flush()
    proto(['inbox']); reject = false
    await new Promise(ok => setTimeout(ok, 25)); await listener.flush()
    if (!listener.status().listening) fail('claiming the failed batch must clear its stale delivery error')
    const replacement = join(app, '.proto', 'another-wake.json')
    writeFileSync(replacement, JSON.stringify({ url, id: 'second-subscription', threadId: 'other-thread' }))
    proto(['inbox', '--listen', replacement], { ok: false })
    if (existsSync(join(app, '.proto', 'session.lock'))) fail('refusing a duplicate listener must release its lock')
    proto(['inbox', '--unlisten']); send('20990102T001004-cont5'); await listener.flush()
    if (requests.length !== 5 || listener.status().listening) fail('unlisten must stop future notifications')
    // Clear the test comments using the same once-only handoff as real wakeups.
    proto(['inbox'])
    for (let n = 1; n <= 5; n++) proto(['reply', `20990102T00100${n - 1}-cont${n}`, 'Checked', '--done'])
    console.log('OK: one persistent listener delivers successive comments, retries and survives restart')
  } finally { listener?.close(); server.closeAllConnections(); await new Promise(ok => server.close(ok)); rmSync(project, { recursive: true, force: true }) }
}

// Exercise the real server pump too, so forgetting configureServer wiring fails the suite.
export async function continuousRuntimeChecks({ proto, app, local, fail }) {
  const temp = mkdtempSync(join(tmpdir(), 'proto-wake-runtime-'))
  const config = join(temp, 'config.json'), registration = join(app, '.proto', 'inbox', 'listeners', 'smoke.json')
  const received = []
  const receiver = createServer((req, res) => {
    let body = ''; req.on('data', b => body += b)
    // A send cut off by a server stop arrives empty; the listener sends it again.
    req.on('end', () => { try { received.push(JSON.parse(body)) } catch { /* cut off */ } res.end('accepted') })
  })
  await new Promise(ok => receiver.listen(0, '127.0.0.1', ok))
  const send = async text => {
    const response = await fetch(`${local}__proto/comments`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ comments: [{ route: 'listenfx/A', text }] }) })
    const batch = await response.json()
    if (!response.ok) fail(`runtime comment refused: ${JSON.stringify(batch)}`)
    for (let i = 0; i < 100 && !received.some(r => r.batchIds.includes(batch.sent)); i++) await new Promise(ok => setTimeout(ok, 100))
    if (!received.some(r => r.batchIds.includes(batch.sent))) fail(`real server never woke the listener for ${text}`)
    return batch.sent
  }
  const ids = []
  try {
    const disconnected = proto(['up'], { stdout: true })
    if (!disconnected.includes('not listening') || !disconnected.includes('schedule_task')) fail('startup must tell Codex to connect the host wakeup before ending the turn')
    writeFileSync(config, JSON.stringify({ url: `http://127.0.0.1:${receiver.address().port}/wake-private-token`, id: 'runtime-subscription', threadId: 'runtime-thread' }))
    // A live legacy waiter prevents a second listener from being registered.
    const waiter = join(app, '.proto', 'inbox', 'waiters', 'smoke.json')
    mkdirSync(dirname(waiter), { recursive: true })
    writeFileSync(waiter, JSON.stringify({ pid: process.pid }))
    proto(['inbox', '--listen', config], { ok: false }); rmSync(waiter)
    if (existsSync(join(app, '.proto', 'session.lock'))) fail('refusing a live waiter must release its lock')
    proto(['inbox', '--listen', config])
    const connected = proto(['up'], { stdout: true })
    if (!connected.includes('persistent listener (runtime-subscription); listening') || connected.includes('schedule_task')) fail('startup must reuse the connected listener instead of proposing another subscription')
    for (const path of ['.proto/inbox/listeners/smoke.json', '.proto/inbox/listeners/smoke.json?raw', `@fs${registration.replaceAll('\\', '/')}`]) {
      const response = await fetch(local + path), text = await response.text()
      if (response.status !== 403 || text.includes('wake-private-token')) fail(`private callback is readable at ${path}`)
    }
    ids.push(await send('First runtime send'))
    ids.push(await send('Second runtime send'))
    proto(['stop']); proto(['up'])
    ids.push(await send('Runtime send after server restart'))
    const repeats = received.flatMap(r => r.batchIds).filter(id => ids.includes(id))
    if (repeats.length !== 3) fail(`server restart repeated accepted wakeups: ${JSON.stringify(repeats)}`)
    if (!(await (await fetch(`${local}__proto/status`)).json()).inbox.listening) fail('page status lost the persistent listener')
    proto(['inbox'])
    for (const id of ids) proto(['reply', id, 'Checked', '--done'])
    console.log('OK: real server delivers successive sends, protects credentials and restores its single subscription after restart')
  } finally {
    proto(['inbox', '--unlisten'])
    proto(['inbox', '--host-disabled', 'runtime-subscription']) // only the test receiver, no real host task
    const optedOut = proto(['up'], { stdout: true })
    if (!optedOut.includes('explicit user opt-out') || optedOut.includes('schedule_task')) fail('startup must preserve explicit opt-out instead of requesting a new task')
    // The run's later checks start their own waiter for this conversation, which an opt-out refuses.
    rmSync(join(app, '.proto', 'inbox', 'listeners'), { recursive: true, force: true })
    receiver.closeAllConnections(); await new Promise(ok => receiver.close(ok))
    rmSync(temp, { recursive: true, force: true })
  }
}

// On its own: a session folder with no server, which is all inbox and reply need.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const skill = dirname(dirname(fileURLToPath(import.meta.url)))
  const project = mkdtempSync(join(tmpdir(), 'proto-listener-'))
  const app = join(project, '.prototypes', '_project')
  mkdirSync(join(app, 'src', 'protos'), { recursive: true })
  writeFileSync(join(app, 'session.json'), JSON.stringify({ stack: 'react' }))
  const fail = msg => { console.error(`\nFAILED: ${msg}`); rmSync(project, { recursive: true, force: true }); process.exit(1) }
  const proto = (args, { ok = true, stdout = false } = {}) => {
    console.log(`\n$ proto ${args.join(' ')}`)
    const r = spawnSync(process.execPath, [join(skill, 'scripts', 'proto.mjs'), ...args, '--project', project, '--session', 'listenchk'], { encoding: 'utf8' })
    process.stdout.write(r.stdout || '')
    process.stderr.write(r.stderr || '')
    if (ok && r.status !== 0) fail(`proto ${args[0]} exited ${r.status}`)
    if (!ok && r.status === 0) fail(`proto ${args.join(' ')} should have been refused`)
    return stdout ? r.stdout || '' : (r.stdout || '') + (r.stderr || '')
  }
  await listenerChecks({ proto, app, fail })
  await continuousListenerChecks({ proto, app, fail })
  rmSync(project, { recursive: true, force: true })
}
