// Several conversations share a project's app, with a tab each in one browser: each tab stays on its own
// conversation's work. New prototypes and variants from another conversation don't move it, and the working
// variant (one per project) shows, and `w` goes to it, only in the tab of the conversation that set it.
// Run with node .github/conversation-tabs-checks.mjs; it exits 1 when a check fails.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startChrome, stopChrome } from '../scripts/chrome.mjs'

const skill = join(dirname(fileURLToPath(import.meta.url)), '..')
const scratch = mkdtempSync(join(tmpdir(), 'proto-multi-'))
const project = join(scratch, 'proj')
mkdirSync(project)
spawnSync('git', ['init', '-q'], { cwd: project })
writeFileSync(join(project, 'package.json'), '{"name":"multi"}')
// The app stays on 127.0.0.1: a tailscale that fails keeps proto up off the tailnet (and this machine's serve rules).
const shim = join(scratch, 'bin')
mkdirSync(shim)
writeFileSync(join(shim, 'tailscale'), '#!/bin/sh\nexit 1\n', { mode: 0o755 })
process.env.PATH = `${shim}:${process.env.PATH}`
process.env.PROTO_NO_GC = '1'; process.env.PROTO_NO_UPDATE = '1'; process.env.PROTO_SHARE_POLL_MS = '0'
const A = 'aaaaaaaa-1111-4111-8111-00000000aaaa', B = 'bbbbbbbb-2222-4222-8222-00000000bbbb', C = 'cccccccc-3333-4333-8333-00000000cccc'
const proto = (sid, args) => {
  const r = spawnSync(process.execPath, [join(skill, 'scripts', 'proto.mjs'), ...args, '--project', project, '--session', sid], { encoding: 'utf8', timeout: 600_000 })
  if (r.status !== 0) { console.log(r.stdout, r.stderr); throw new Error(`proto ${args.join(' ')} failed`) }
  return r.stdout
}
const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
const check = (name, ok, extra = '') => { results.push([ok ? 'PASS' : 'FAIL', name, extra]); console.log(ok ? 'PASS' : 'FAIL', name, extra) }

const profile = mkdtempSync(join(tmpdir(), 'proto-multi-chrome-'))
const chrome = startChrome([`--user-data-dir=${profile}`, '--no-first-run'])
let ws
try {
  const outA = proto(A, ['up', '--name', 'Conv A'])
  const linkA = outA.match(/^link (\S+)/m)[1]
  const base = outA.match(/^local (\S+)/m)?.[1] || outA.match(/^url (\S+)/m)[1]
  console.log('A link', linkA, 'base', base)
  proto(A, ['add', 'alpha', '--title', 'Alpha', '--variants', 'A:One,B:Two'])

  ws = new WebSocket(await new Promise((ok, no) => { let b = ''; chrome.stderr.on('data', d => { b += d; const m = b.match(/DevTools listening on (ws:\/\/\S+)/); if (m) ok(m[1]) }); chrome.on('exit', () => no(new Error('chrome exited'))) }))
  await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = no })
  let n = 0; const waiting = new Map()
  ws.onmessage = e => { const m = JSON.parse(e.data); waiting.get(m.id)?.(m.result); waiting.delete(m.id) }
  const send = (method, params, sessionId) => new Promise(ok => { waiting.set(++n, ok); ws.send(JSON.stringify({ id: n, method, params, sessionId })) })
  const tab = async url => {
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId)
    await send('Page.enable', {}, sessionId)
    await send('Page.navigate', { url }, sessionId)
    const run = async expr => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sessionId))?.result?.value
    for (const end = Date.now() + 30000; Date.now() < end && !(await run('document.documentElement.dataset.ready === "1"').catch(() => false));) await sleep(150)
    const key = async k => { for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: k, code: `Key${k.toUpperCase()}`, windowsVirtualKeyCode: k.toUpperCase().charCodeAt(0), ...(type === 'keyDown' ? { text: k } : {}) }, sessionId) }
    const shot = async file => { const { data } = await send('Page.captureScreenshot', { format: 'png' }, sessionId); writeFileSync(file, Buffer.from(data, 'base64')) }
    return { run, key, shot, path: () => run('location.pathname + location.hash') }
  }
  // Polls until test(value) holds, for 15 s at most; the last value either way.
  const until = async (get, test) => { let v; for (const end = Date.now() + 15000; Date.now() < end; await sleep(250)) if (test(v = await get())) return v; return v }
  const workIn = t => t.run(`[...document.querySelectorAll('aside')].map(e => e.innerText).join('\\n').match(/Working on[^\\n]*/)?.[0] || ''`)
  const tA = await tab(linkA)
  await until(tA.path, p => /alpha/.test(p))

  const outB = proto(B, ['up', '--name', 'Conv B'])
  const linkB = outB.match(/^link (\S+)/m)[1]
  proto(B, ['add', 'beta', '--title', 'Beta', '--variants', 'A:One,B:Two'])
  const tB = await tab(linkB)
  const bare = await tab(base)
  const pb = await until(tB.path, p => /beta/.test(p))
  check('tab B lands on beta', /beta/.test(pb), pb)
  check('tab A stays on alpha after B builds', /alpha/.test(await tA.path()), await tA.path())

  proto(C, ['up', '--name', 'Conv C'])
  proto(C, ['add', 'gamma', '--title', 'Gamma', '--variants', 'A:One'])
  proto(B, ['add', 'beta', '--variants', 'C:Three'])
  // The bare tab follows C, the last to start the app: once it is on gamma, every tab has heard of it.
  await until(bare.path, p => /gamma/.test(p))
  await until(tB.path, p => /beta\/C/.test(p))
  check('tab A stays on alpha after C builds and B grows', /alpha/.test(await tA.path()), await tA.path())
  check('tab B stays off gamma', !/gamma/.test(await tB.path()), await tB.path())

  // The working variant, one per project: A sets it and its tab shows it.
  proto(A, ['work', 'alpha/A'])
  const wa = await until(() => workIn(tA), w => /Alpha/.test(w))
  check('tab A shows its own working variant', /Alpha/.test(wa), JSON.stringify(wa))
  // Then B moves it to beta: B's tab and the bare tab show it, A's tab stops showing any.
  proto(B, ['work', 'beta/B'])
  const wb = await until(() => workIn(tB), w => /Beta/.test(w))
  check('tab B shows its own working variant', /Beta/.test(wb), JSON.stringify(wb))
  const wbare = await until(() => workIn(bare), w => /Beta/.test(w))
  check('the bare tab shows the working variant', /Beta/.test(wbare), JSON.stringify(wbare))
  const wa2 = await until(() => workIn(tA), w => !w)
  check('tab A no longer shows a working variant (B\'s is not its own)', !wa2, JSON.stringify(wa2))
  await tA.run('document.activeElement?.blur()')
  await tA.key('w')
  await sleep(1000)
  if (process.env.SHOTS) await tA.shot(join(process.env.SHOTS, 'tab-a-after-b-work.png'))
  check('w in tab A does not take it to B\'s beta', !/beta/.test(await tA.path()), await tA.path())

  // B joins A's alpha and works on it: alpha is B's now, so A's tab still shows nothing.
  proto(B, ['work', 'alpha/B'])
  await until(() => workIn(tB), w => /Alpha/.test(w))
  const wa3 = await workIn(tA)
  check('tab A shows no working variant on alpha once B works on it', !wa3, JSON.stringify(wa3))
  // A takes it back: A's tab shows it again, with no "moved from" B's beta to undo.
  proto(A, ['work', 'alpha/A'])
  const wa4 = await until(() => workIn(tA), w => /Alpha/.test(w))
  check('tab A shows alpha again once A works on it', /Alpha/.test(wa4), JSON.stringify(wa4))
  const undo = await tA.run(`[...document.querySelectorAll('button')].some(b => /^Undo$/.test(b.textContent.trim()))`)
  check('tab A offers no Undo back to another conversation\'s variant', !undo)

  // A reload keeps the tab on A's conversation.
  await tA.run('location.reload()')
  await sleep(500)
  const tree = await until(() => tA.run(`[...document.querySelectorAll('aside')].map(e => e.innerText).join('\\n')`), t => /Alpha/.test(t))
  check('tab A after a reload lists Alpha, not Beta or Gamma', /Alpha/.test(tree) && !/Beta|Gamma/.test(tree), JSON.stringify(tree.slice(0, 200)))
} catch (e) { console.log('ERROR', e?.stack || e); results.push(['FAIL', 'ran to the end', String(e)]) } finally {
  ws?.close(); stopChrome(chrome)
  for (const s of [A, B, C]) spawnSync(process.execPath, [join(skill, 'scripts', 'proto.mjs'), 'rm', '--all', '--project', project, '--session', s], { stdio: 'ignore', timeout: 60000 })
  try { rmSync(scratch, { recursive: true, force: true }) } catch {}
  console.log('\nSUMMARY'); for (const r of results) console.log(r.join(' '))
}
process.exit(results.length && results.every(r => r[0] === 'PASS') ? 0 : 1)
