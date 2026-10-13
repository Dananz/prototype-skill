// A session that took comments and ended (T3 Code restarted, the terminal closed) never answers
// them. The batch records who took it (CLAUDE_PID), so the page can say "not picked up" instead of
// "Claude is on it", and the next agent that takes the inbox is handed them again, once, in full.
// Needs no page: the batches are written into the inbox as the server writes them.
// Runs in the smoke suite, or on its own: node .github/listener-checks.mjs
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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

// On its own: a session folder with no server, which is all inbox and reply need.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const skill = dirname(dirname(fileURLToPath(import.meta.url)))
  const project = mkdtempSync(join(tmpdir(), 'proto-listener-'))
  const app = join(project, '.prototypes', 'listenchk')
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
  rmSync(project, { recursive: true, force: true })
}
