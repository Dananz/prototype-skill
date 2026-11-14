// Several conversations share a project's app, with a tab each in one browser (up to ten): each tab stays on
// its own conversation's work and keeps its way back to it. Another conversation's new prototypes and
// variants don't move it, each conversation has its own working variant (the strip, W, Undo), the tree's
// scope is the tab's own, and Back and Forward go through its moves, in a device view too.
// Run with node .github/conversation-tabs-checks.mjs (a few minutes); SHOTS=<dir> keeps screenshots.
// It exits 1 when a check fails.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
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
const cleanupSids = [A, B, C]
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
  ws.onmessage = e => { const m = JSON.parse(e.data); const w = waiting.get(m.id); if(w) { clearTimeout(w.timer); m.error ? w.no(new Error(JSON.stringify(m.error))) : w.ok(m.result); waiting.delete(m.id) } }
  const send = (method, params, sessionId) => new Promise((ok, no) => { const id=++n; const timer=setTimeout(() => { waiting.delete(id); no(new Error('CDP timed out: '+method)) }, 30000); waiting.set(id, {ok,no,timer}); ws.send(JSON.stringify({ id, method, params, sessionId })) })
  const tab = async url => {
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId)
    await send('Page.enable', {}, sessionId)
    await send('Page.navigate', { url }, sessionId)
    const run = async expr => { for(let i=0;i<10;i++) { try { const r=await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, userGesture: true }, sessionId); if(r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result?.value } catch(e) { if(i<9 && /context|Cannot find|documentElement|document is not defined/.test(e.message)) { await sleep(100); continue } throw e } } }
    for (const end = Date.now() + 30000; Date.now() < end && !(await run('document.documentElement.dataset.ready === "1"').catch(() => false));) await sleep(150)
    const key = async k => { for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: k, code: `Key${k.toUpperCase()}`, windowsVirtualKeyCode: k.toUpperCase().charCodeAt(0), ...(type === 'keyDown' ? { text: k } : {}) }, sessionId) }
    const shot = async file => { const { data } = await send('Page.captureScreenshot', { format: 'png' }, sessionId); writeFileSync(file, Buffer.from(data, 'base64')) }
    return { run, key, shot, sessionId, path: () => run('location.pathname + location.hash') }
  }
  // Polls until test(value) holds, for 15 s at most; the last value either way.
  const until = async (get, test) => { let v; for (const end = Date.now() + 15000; Date.now() < end; await sleep(250)) if (test(v = await get())) return v; return v }
  const workIn = t => t.run(`[...document.querySelectorAll('aside')].map(e => e.innerText).join('\\n').match(/Working on[^\\n]*/)?.[0] || document.querySelector('[data-act="work:go"]')?.innerText || ''`)
  const ready = async t => until(() => t.run('document.documentElement?.dataset.ready'), x => x === '1')
  const nav = async (t, path) => { await t.run(`history.pushState(null, '', ${JSON.stringify(path)} + location.search); dispatchEvent(new PopStateEvent('popstate'))`); await sleep(350) }
  const click = async (t, selector) => t.run(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) throw new Error('missing ' + ${JSON.stringify(selector)}); e.click(); return true })()`)
  const aside = t => t.run(`[...document.querySelectorAll('aside')].map(e => e.innerText).join(String.fromCharCode(10))`)
  const scopeText = t => t.run(`document.querySelector('[data-tree-scope] [aria-checked="true"]')?.textContent`)
  const undoVisible = t => t.run(`[...document.querySelectorAll('[data-act="work:undo"]')].some(e => e.getBoundingClientRect().width > 0)`)

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
  await until(() => tB.run("document.querySelector('[data-tree-root]')?.innerText.includes('Three')"), Boolean)
  check('tab A stays on alpha after C builds and B grows', /alpha/.test(await tA.path()), await tA.path())
  check('tab B stays off gamma', !/gamma/.test(await tB.path()), await tB.path())

  // A session.json from before each conversation had its own (work only): A's stays A's when B sets one.
  const sessionJson = join(project, '.prototypes', '_project', 'session.json')
  const old = JSON.parse(readFileSync(sessionJson, 'utf8'))
  delete old.works
  writeFileSync(sessionJson, JSON.stringify({ ...old, work: { proto: 'alpha', variant: 'B', at: new Date().toISOString() } }, null, 2) + '\n')
  proto(B, ['work', 'beta/A'])
  check('an old session.json keeps A\'s working variant when B sets its own', /alpha\/(B|2)/.test(proto(A, ['work'])), proto(A, ['work']).trim())
  // Each conversation's working variant: A sets its own and its tab shows it.
  proto(A, ['work', 'alpha/A'])
  const wa = await until(() => workIn(tA), w => /Alpha/.test(w))
  check('tab A shows its own working variant', /Alpha/.test(wa), JSON.stringify(wa))
  // Then B sets its own on beta: B's tab and the bare tab (the one set last) show it, A's tab keeps A's.
  proto(B, ['work', 'beta/B'])
  const wb = await until(() => workIn(tB), w => /Beta/.test(w))
  check('tab B shows its own working variant', /Beta/.test(wb), JSON.stringify(wb))
  const wbare = await until(() => workIn(bare), w => /Beta/.test(w))
  check('the bare tab shows the working variant', /Beta/.test(wbare), JSON.stringify(wbare))
  await sleep(1000)
  const wa2 = await workIn(tA)
  check('tab A keeps its own working variant after B sets one', /Alpha 1/.test(wa2), JSON.stringify(wa2))
  await nav(tA, '/alpha')
  await tA.run('document.activeElement?.blur()')
  await tA.key('w')
  await sleep(1000)
  if (process.env.SHOTS) await tA.shot(join(process.env.SHOTS, 'tab-a-after-b-work.png'))
  check('w in tab A goes back to A\'s own alpha/A', /\/alpha\/A$/.test(await tA.path()), await tA.path())
  check('agent A\'s proto work prints its own', /alpha/.test(proto(A, ['work'])) && /beta/.test(proto(B, ['work'])))

  // B joins A's alpha and works on another variant of it: each tab keeps its own.
  proto(B, ['work', 'alpha/B'])
  await until(() => workIn(tB), w => /Alpha/.test(w))
  await sleep(1000)
  const wa3 = await workIn(tA)
  check('tab A keeps alpha/A while B works on alpha/B', /Alpha 1/.test(wa3), JSON.stringify(wa3))
  const undo = await tA.run(`[...document.querySelectorAll('button')].some(b => /^Undo$/.test(b.textContent.trim()))`)
  check('tab A offers no Undo for B\'s move', !undo)

  // A reload keeps the tab on A's conversation.
  await tA.run('location.reload()')
  await sleep(500)
  const tree = await until(() => tA.run(`[...document.querySelectorAll('aside')].map(e => e.innerText).join('\\n')`), t => /Alpha/.test(t))
  check('tab A after a reload lists Alpha, not Beta or Gamma', /Alpha/.test(tree) && !/Beta|Gamma/.test(tree), JSON.stringify(tree.slice(0, 200)))

  // A pick in A's tab, on a prototype A works on: A's working variant moves there, and B's tab stays put.
  proto(A, ['work', 'alpha/A'])
  await nav(tA, '/alpha/B')
  await click(tA, '[data-decide-btn]')
  await until(() => tA.run(`!!document.querySelector('[data-decide] [data-send]')`), Boolean)
  const pickUI = await tA.run(`(() => { const e = document.querySelector('[data-decide] [data-send]'); if (!e) return document.body.innerText.slice(-800); e.click(); return 'clicked' })()`)
  check('page pick was submitted through Decide UI', pickUI === 'clicked', pickUI)
  await until(() => workIn(tA), w => /Alpha 2/.test(w))
  check('A page pick keeps B on beta', /beta/.test(await tB.path()), await tB.path())
  await nav(tA, '/alpha/A')
  await tA.key('w'); await sleep(350)
  check('w returns A to its page pick', /alpha\/B/.test(await tA.path()), await tA.path())
  proto(B, ['work', 'beta/B'])
  await until(() => workIn(tB), w => /Beta/.test(w))
  await sleep(1000)
  await nav(tA, '/alpha/A')
  await tA.key('w'); await sleep(350)
  check('A retains a return to its own pick after B works', /alpha\/B/.test(await tA.path()), await tA.path())

  // Per-document history and query remain attached to A while B keeps building.
  await nav(tA, '/alpha/A'); await nav(tA, '/alpha/B')
  await tA.run('history.back()'); await until(tA.path, p => p === '/alpha/A')
  check('Back returns to A variant A', /alpha\/A/.test(await tA.path()), await tA.path())
  await tA.run('history.forward()'); await until(tA.path, p => p === '/alpha/B')
  check('Forward returns to A variant B', /alpha\/B/.test(await tA.path()), await tA.path())
  check('Back and Forward preserve A query', await tA.run('new URLSearchParams(location.search).get("c")') === '0000aaaa')

  // A B-owned prototype is still A-made: B adding to it should not hijack A's other work.
  proto(A, ['add', 'a-second', '--title', 'A second', '--variants', 'A:Other'])
  await until(tA.path, p => /a-second/.test(p))
  proto(B, ['work', 'alpha/B'])
  await until(() => workIn(tB), w => /Alpha/.test(w))
  await nav(tB, '/alpha/B')
  await click(tB, '[data-tree-filter="conv"]')
  const bJoinedTree = await aside(tB)
  check('B This conversation lists the prototype B works on', /Alpha/.test(bJoinedTree.replace(/Working on[^\n]*/, '')), JSON.stringify(bJoinedTree))
  proto(B, ['add', 'alpha', '--join', '--variants', 'C:Joined option'])
  await until(tB.path, p => /alpha\/C/.test(p))
  await sleep(1000)
  check('A stays on its second prototype when B grows joined alpha', /a-second/.test(await tA.path()), await tA.path())

  // The scope is the tab's own: another tab's choice doesn't reach it, also on a reload.
  await click(tB, '[data-tree-filter="all"]')
  await tA.run('location.reload()'); await sleep(500); await ready(tA)
  check('reloading A preserves its This conversation scope', await scopeText(tA) === 'This conversation', await scopeText(tA))
  await click(tA, '[data-tree-filter="conv"]')
  await click(tB, '[data-tree-filter="conv"]')
  await nav(tB, '/')
  const pastSelector = `[data-gallery-conv="${C}"]`
  await until(() => tB.run(`!!document.querySelector(${JSON.stringify(pastSelector)})`), Boolean)
  await click(tB, pastSelector)
  const pastName = await until(() => scopeText(tB), x => /Conv C/.test(x)); check('B can browse C as a past conversation', /Conv C/.test(pastName), pastName)
  await nav(tA, '/a-second/A')
  await tA.run('location.reload()'); await sleep(500); await ready(tA)
  check('reloading A does not inherit another tab past-conversation scope', await scopeText(tA) === 'This conversation', await scopeText(tA))

  // Classic sidebar actually renders the moved notice; the original tree-only assertion cannot.
  proto(B, ['work', 'beta/A'])
  const classic = await tab(base + 'alpha/A?c=0000aaaa&tree=0')
  proto(A, ['work', 'alpha/A'])
  await until(() => workIn(classic), w => /One/.test(w))
  await sleep(500)
  proto(A, ['work', 'alpha/B'])
  // The Undo of this move (the one before may still be showing its own).
  await until(() => workIn(classic), w => /Two/.test(w))
  const normalUndo = await until(() => undoVisible(classic), Boolean)
  check('classic sidebar: a move of its own conversation offers Undo (positive control)', normalUndo)
  await click(classic, '[data-act="work:undo"]')
  await until(() => workIn(classic), w => /One/.test(w))
  // Another conversation's moves offer no Undo here, and leave A's working variant where it is.
  await sleep(8500)
  proto(B, ['work', 'alpha/B'])
  await until(() => workIn(tB), w => /Alpha 2/.test(w))
  await sleep(1000)
  check('B\'s move offers no Undo in A\'s tab', !(await undoVisible(classic)))
  const wc = await workIn(classic)
  check('B\'s move leaves A\'s working variant on alpha/A', /One/.test(wc), JSON.stringify(wc))

  // Ten explicit conversation tabs in one browser.
  proto(A, ['add', 'a-second', '--variants', 'B:Second'])
  proto(C, ['add', 'gamma', '--variants', 'B:Second'])
  const many = [{ sid: A, slug: 'a-second', tab: tA }, { sid: B, slug: 'beta', tab: tB }]
  const cTab = await tab(base + '?c=0000cccc&tree=1')
  many.push({ sid: C, slug: 'gamma', tab: cTab })
  for (let i = 3; i < 10; i++) {
    const sid = `review-conversation-${i}`
    cleanupSids.push(sid)
    const out = proto(sid, ['up', '--name', `Conversation ${i}`])
    const slug = `conv-${i}`
    proto(sid, ['add', slug, '--title', `Conversation ${i}`, '--variants', 'A:First,B:Second'])
    const t = await tab(out.match(/^link (\S+)/m)[1] + '&tree=1')
    many.push({ sid, slug, tab: t })
  }
  for (const x of many) { await nav(x.tab, `/${x.slug}/B`); proto(x.sid, ['work', `${x.slug}/A`]) }
  await sleep(1000)
  const pathsBefore = await Promise.all(many.map(x => x.tab.path()))
  check('ten tabs remain on their own routes while other conversations work', pathsBefore.every((p, i) => p === `/${many[i].slug}/B`), JSON.stringify(pathsBefore))
  for (const x of many) { await x.tab.run('document.activeElement?.blur()'); await x.tab.key('w') }
  await sleep(500)
  const pathsAfter = await Promise.all(many.map(x => x.tab.path()))
  check('all ten tabs retain a working destination', pathsAfter.every((p, i) => p === `/${many[i].slug}/A`), JSON.stringify(pathsAfter))

  // A device view: Back and Forward go through the page's moves (the frame keeps no history of its own).
  const dv = await tab(base + 'alpha/A?c=0000aaaa')
  await click(dv, '[data-act="size:phone"]')
  await until(() => dv.run(`!!document.querySelector('iframe')?.contentDocument?.documentElement.dataset.ready`), Boolean)
  await nav(dv, '/alpha/B')
  await until(() => dv.run(`document.querySelector('iframe')?.contentWindow.location.pathname`), p => p === '/alpha/B')
  await dv.run('history.back()'); const back = await until(dv.path, p => p === '/alpha/A')
  check('device view: Back goes to the previous variant', back === '/alpha/A', back)
  await sleep(500)
  await dv.run('history.forward()'); const fwd = await until(dv.path, p => p === '/alpha/B')
  check('device view: Forward comes back', fwd === '/alpha/B', fwd)

} catch (e) { console.log('ERROR', e?.stack || e); results.push(['FAIL', 'ran to the end', String(e)]) } finally {
  ws?.close(); stopChrome(chrome)
  for (const s of cleanupSids) spawnSync(process.execPath, [join(skill, 'scripts', 'proto.mjs'), 'rm', '--all', '--project', project, '--session', s], { stdio: 'ignore', timeout: 60000 })
  try { rmSync(scratch, { recursive: true, force: true }) } catch {}
  console.log('\nSUMMARY'); for (const r of results) console.log(r.join(' '))
}
process.exit(results.length && results.every(r => r[0] === 'PASS') ? 0 : 1)
