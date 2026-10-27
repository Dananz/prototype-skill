// buildShare(): a share of some of a session's variants, as the gzipped page that gets published.
// Vite runs in a child process (`vite build --mode share` with the session's own Vite, so the
// session's dev server, if it runs, is left alone) into a fresh temporary folder, never the
// session's dist/. One share of a session is built at a time: they share the session's files and
// the machine's memory, so a second one waits for the first.
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { isCurrent } from '../assignment.mjs'
import { metaOf } from '../server.mjs'
import { review } from './review.mjs'
import { ShareError } from './scope.mjs'
import { filesOf, inlineHtml } from './inline.mjs'

const LOCK_WAIT = 5 * 60e3
const sleep = ms => new Promise(r => setTimeout(r, ms))
const alive = pid => { try { process.kill(pid, 0); return true } catch (e) { return e.code === 'EPERM' } }

/**
 * Takes the lock folder (mkdir is atomic) with this process's pid in it, and gives back its
 * release. A holder that died (a build killed halfway) is taken over at once rather than waited
 * out; a live one is waited for, up to five minutes.
 */
async function lock(path) {
  mkdirSync(dirname(path), { recursive: true })
  const pidFile = join(path, 'pid')
  for (const end = Date.now() + LOCK_WAIT; ; await sleep(200)) {
    try {
      mkdirSync(path)
      writeFileSync(pidFile, String(process.pid))
      return () => rmSync(path, { recursive: true, force: true })
    } catch (e) { if (e.code !== 'EEXIST') throw e }
    let pid = 0, age = 0
    try { pid = Number(readFileSync(pidFile, 'utf8')) } catch { /* not written yet, or just released */ }
    try { age = Date.now() - statSync(path).mtimeMs } catch { continue }
    // No pid after 10 s means its maker died between the mkdir and the write.
    if (pid ? !alive(pid) : age > 10e3) { rmSync(path, { recursive: true, force: true }); continue }
    if (Date.now() > end) throw new ShareError(`Another share of this session has been building for over 5 minutes (process ${pid}). Try again when it is done.`)
  }
}

/** Runs a command and resolves with its exit code and the last of what it printed. */
function run(cmd, args, options) {
  return new Promise((ok, no) => {
    const child = spawn(cmd, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    const keep = d => { out = (out + d).slice(-8000) }
    child.stdout.on('data', keep)
    child.stderr.on('data', keep)
    child.on('error', no)
    child.on('close', code => ok({ code, out }))
  })
}

/**
 * sessionDir: the session app. scope: parseScope's { protos, start }. info: { title, owner,
 * version } for the viewer. Resolves with the gzipped page and what the owner sees before it is
 * published; started and ended are when this build held the session's share lock.
 */
export async function buildShare({ sessionDir, scope, info }) {
  const session = JSON.parse(readFileSync(join(sessionDir, 'session.json'), 'utf8'))
  const release = await lock(join(sessionDir, '.proto', 'shares', '.lock'))
  const started = Date.now()
  let tmp
  try {
    tmp = mkdtempSync(join(tmpdir(), 'proto-share-'))
    const scopeFile = join(tmp, 'scope.json'), out = join(tmp, 'out')
    writeFileSync(scopeFile, JSON.stringify({ scope, info: { ...info, updatedAt: new Date().toISOString() } }))
    const vite = join(sessionDir, 'node_modules', 'vite', 'bin', 'vite.js')
    const { code, out: log } = await run(process.execPath, [vite, 'build', '--mode', 'share', '--logLevel', 'warn'], {
      cwd: sessionDir,
      env: { ...process.env, NODE_ENV: 'production', PROTO_SHARE_SCOPE: scopeFile, PROTO_SHARE_OUT: out },
    })
    if (code !== 0) throw new ShareError(`The share build failed:\n${log.trim()}`)
    const files = filesOf(out)
    const html = inlineHtml(out)
    const gz = gzipSync(html, { level: 9 })
    const { projectImports, warnings } = JSON.parse(readFileSync(join(tmp, 'report.json'), 'utf8'))
    const currents = scope.protos.flatMap(p => {
      const names = metaOf(readFileSync(join(sessionDir, 'src', 'protos', p.id, 'meta.ts'), 'utf8')).variants ?? {}
      return p.variants.filter(v => isCurrent(names[v])).map(v => `${p.id}/${v}`)
    })
    // Vite works with real paths, so a project reached through a link leaks in that form; the
    // review is given whichever form the page holds.
    const either = path => { let real = path; try { real = realpathSync(path) } catch { /* gone */ } return html.includes(path) || !html.includes(real) ? path : real }
    const checked = review({ html, gzBytes: gz.length, projectPath: either(session.project), home: either(homedir()), projectImports, currents })
    return { gz, html, rawBytes: Buffer.byteLength(html), gzBytes: gz.length, review: checked, warnings, files, started, ended: Date.now() }
  } finally {
    if (tmp) rmSync(tmp, { recursive: true, force: true })
    release()
  }
}
