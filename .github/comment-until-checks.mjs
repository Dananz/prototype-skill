// A comment answered while its work is still building closes itself once that work is built:
// `proto reply … --until <slug>` waits on the prototype's Building marks and `proto done` closes it,
// on the one line it prints. A comment answered and never closed is listed when comments arrive.
// Needs no page: the batches are written into the inbox as the server writes them.
// Runs in the smoke suite, or on its own: node .github/comment-until-checks.mjs
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export async function commentUntilChecks({ proto, app, fail }) {
  const inbox = join(app, '.proto', 'inbox')
  const send = (id, texts) => {
    const folder = join(inbox, 'new', id)
    mkdirSync(folder, { recursive: true })
    writeFileSync(join(folder, 'batch.json'), JSON.stringify({ id, at: new Date().toISOString(), theme: 'dark', comments: texts.map((text, i) => ({ n: i + 1, route: 'untilfx/A', text })) }))
  }
  const batch = id => JSON.parse(readFileSync(join(inbox, 'taken', id, 'batch.json'), 'utf8'))
  const last = out => out.trim().split('\n').pop()

  const id = '20990101T000000-unt1'
  send(id, ['More variants for this case', 'Make it purple', 'One more way'])
  proto(['inbox'])
  proto(['add', 'untilfx', '--title', 'Until', '--variants', 'A:One,B:Two'])

  proto(['reply', id, '1', 'Building', '--until', 'nosuch'], { ok: false })
  proto(['reply', id, '1', 'Building', '--until', 'untilfx/Z'], { ok: false })
  const waiting = proto(['reply', id, '1', 'Building them in «Until»', '--until', 'untilfx'], { stdout: true })
  if (!/open until untilfx is built \(2 building\)/.test(last(waiting))) fail(`reply --until should say the comment stays open while 2 variants build: ${waiting}`)
  if (batch(id).comments[0].done || batch(id).comments[0].until?.join() !== 'untilfx') fail(`reply --until should keep the comment open and record what it waits on: ${JSON.stringify(batch(id).comments[0])}`)

  const open = proto(['reply', id, '2', 'Can\'t: there is no purple in the kit'], { stdout: true })
  if (!/still open/.test(last(open))) fail(`a reply with neither --done nor --until should say, on its line, that the comment stays open: ${open}`)

  const half = proto(['done', 'untilfx/A'], { stdout: true })
  if (/closed/.test(half) || batch(id).comments[0].done) fail(`one of two variants built should close nothing: ${half}`)
  const all = proto(['done', 'untilfx/B'], { stdout: true })
  if (!last(all).includes(`closed ${id}/1`)) fail(`proto done should close the waiting comment on its one line (agents read it through tail -1): ${all}`)
  const c1 = batch(id).comments[0]
  if (!c1.done || c1.reply?.text !== 'Building them in «Until»') fail(`the comment should be done with its reply kept: ${JSON.stringify(c1)}`)

  // Nothing of untilfx is building any more, so a reply waiting on it is done at once.
  const now = proto(['reply', id, '3', 'Added C', '--until', 'untilfx'], { stdout: true })
  if (!/done \(nothing in untilfx is building\)/.test(last(now)) || !batch(id).comments[2].done) fail(`reply --until on work already built should close the comment at once: ${now}`)

  // Comment 2 was answered and never closed: the next comments to arrive say so.
  send('20990101T000100-unt2', ['Another thing'])
  const heard = proto(['inbox'], { stdout: true })
  if (!heard.includes(`${id}/2 "Make it purple"`) || heard.includes(`${id}/1 `)) fail(`proto inbox should list the comment answered and never closed, and only it: ${heard}`)
  proto(['reply', '20990101T000100-unt2', 'ok', '--done'])
  proto(['reply', `${id}/2`, '--done'])
  console.log('\nOK: a comment answered with --until closes itself when its work is built')
}

// On its own: a session folder with no server, which is all reply, done and inbox need.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const skill = dirname(dirname(fileURLToPath(import.meta.url)))
  const project = mkdtempSync(join(tmpdir(), 'proto-until-'))
  const app = join(project, '.prototypes', 'untilchk')
  mkdirSync(join(app, 'src', 'protos'), { recursive: true })
  writeFileSync(join(app, 'session.json'), JSON.stringify({ stack: 'react' }))
  const fail = msg => { console.error(`\nFAILED: ${msg}`); rmSync(project, { recursive: true, force: true }); process.exit(1) }
  const proto = (args, { ok = true, stdout = false } = {}) => {
    console.log(`\n$ proto ${args.join(' ')}`)
    const r = spawnSync(process.execPath, [join(skill, 'scripts', 'proto.mjs'), ...args, '--project', project, '--session', 'untilchk'], { encoding: 'utf8' })
    process.stdout.write(r.stdout || '')
    process.stderr.write(r.stderr || '')
    if (ok && r.status !== 0) fail(`proto ${args[0]} exited ${r.status}`)
    if (!ok && r.status === 0) fail(`proto ${args.join(' ')} should have been refused`)
    return stdout ? r.stdout || '' : (r.stdout || '') + (r.stderr || '')
  }
  await commentUntilChecks({ proto, app, fail })
  rmSync(project, { recursive: true, force: true })
}
