// End-to-end check of the skill on this machine: create a session app in a scratch project,
// add prototypes (one built from another, one from two at once, one from the picks), screenshot
// them (one by one and on a contact sheet) and snapshot them, open a state listed in meta.ts,
// print a variant's handoff checklist, send comments, decisions and copy choices from the page,
// record, scrub and comment on a variant's motion, view and comment on it at another size, then
// stop and delete the session. Run locally with node .github/smoke.mjs.
import { spawn, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { get, request } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startChrome, stopChrome } from '../scripts/chrome.mjs'
import { optionalExtras } from './optional-extras.mjs'
import { designKit } from './design-kit.mjs'
import { speedChecks } from './speed-checks.mjs'
import { commentParentChecks } from './comment-parent-checks.mjs'
import { commentPicturesChecks } from './comment-pictures-checks.mjs'
import { commentUsesChecks } from './comment-uses-checks.mjs'

const skill = dirname(dirname(fileURLToPath(import.meta.url)))
// Each run has a folder of its own (under RUNNER_TEMP when set), so two runs on one machine never
// remove each other's session; the shots for the CI artifact stay at <base>/proto-shots.
const base = process.env.RUNNER_TEMP || tmpdir()
const scratch = mkdtempSync(join(base, 'proto-smoke-run-'))
// The project is reached through a link, as /tmp is on macOS: the app must still serve its files.
const real = join(scratch, 'proto-smoke')
const project = join(scratch, 'proto-smoke-link')
const keepShots = join(base, 'proto-shots')
const app = join(project, '.prototypes', 'smoke')
mkdirSync(real, { recursive: true })
symlinkSync(real, project, 'junction')
writeFileSync(join(project, 'package.json'), JSON.stringify({ name: 'proto-smoke', private: true, dependencies: { react: '^19.2.0' } }))

// A failure says why, then closes the pages it opened and stops and removes its session (after
// dev.log, which is in it), so no Chrome, dev server or tailnet rule outlives the run. Straight
// through spawnSync: proto() fails by itself. So does anything thrown and not caught.
let failing = false
const pages = new Set()
const fail = msg => {
  console.error(`\nFAILED: ${msg}`)
  const log = join(app, '.proto', 'dev.log')
  if (existsSync(log)) console.error(`\n--- dev.log ---\n${readFileSync(log, 'utf8')}`)
  if (!failing) {
    failing = true
    for (const close of pages) try { close() } catch { /* already gone */ }
    if (existsSync(join(app, 'session.json'))) spawnSync(process.execPath, [join(skill, 'scripts', 'proto.mjs'), 'rm', '--project', project, '--session', 'smoke'], { stdio: 'ignore', timeout: 60_000 })
    try { rmSync(scratch, { recursive: true, force: true }) } catch { /* temp dir */ }
  }
  process.exit(1)
}
process.on('unhandledRejection', e => fail(`unhandled rejection: ${e?.stack || e}`))
process.on('uncaughtException', e => fail(`uncaught: ${e?.stack || e}`))
const proto = (args, { ok = true, stdout = false } = {}) => {
  console.log(`\n$ proto ${args.join(' ')}`)
  const r = spawnSync(process.execPath, [join(skill, 'scripts', 'proto.mjs'), ...args, '--project', project, '--session', 'smoke'], { encoding: 'utf8', timeout: 600_000 })
  process.stdout.write(r.stdout || '')
  process.stderr.write(r.stderr || '')
  if (ok && r.status !== 0) fail(`proto ${args[0]} exited ${r.status}`)
  if (!ok && r.status === 0) fail(`proto ${args.join(' ')} should have been refused`)
  return stdout ? r.stdout || '' : (r.stdout || '') + (r.stderr || '')
}
const answers = async url => { try { return (await fetch(url, { signal: AbortSignal.timeout(2000) })).ok } catch { return false } }
const pngs = dir => existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith('.png')) : []
// A page in headless Chrome (1440x900, or a phone's size), once it says it is ready, as shoot.mjs
// does: run evaluates an expression in it (awaiting a promise), as often as needed, and it stays
// open until closed, so the page can carry on while proto runs beside it.
async function openPage(url, { width = 1440, height = 900, phone = false } = {}) {
  const profile = mkdtempSync(join(tmpdir(), 'proto-smoke-'))
  const chrome = startChrome([`--user-data-dir=${profile}`, '--no-first-run'])
  let ws
  const close = () => {
    pages.delete(close)
    ws?.close()
    stopChrome(chrome)
    try { rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }) } catch { /* temp dir */ }
  }
  pages.add(close)
  try {
    ws = new WebSocket(await new Promise((ok, no) => {
      let b = ''
      chrome.stderr.on('data', d => { b += d; const m = b.match(/DevTools listening on (ws:\/\/\S+)/); if (m) ok(m[1]) })
      chrome.on('exit', () => no(new Error('Chrome exited')))
    }))
    await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = no })
    let n = 0
    const waiting = new Map()
    ws.onmessage = e => {
      const m = JSON.parse(e.data)
      // A page that crashes says so at once, instead of every check after it waiting out its time.
      if (m.method === 'Inspector.targetCrashed') fail(`Chrome's page crashed (Inspector.targetCrashed) at ${url}`)
      waiting.get(m.id)?.(m.result); waiting.delete(m.id)
    }
    const send = (method, params, sessionId) => new Promise(ok => { waiting.set(++n, ok); ws.send(JSON.stringify({ id: n, method, params, sessionId })) })
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
    await send('Inspector.enable', {}, sessionId)
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: phone ? 2 : 1, mobile: phone }, sessionId)
    if (phone) await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }, sessionId)
    await send('Page.navigate', { url }, sessionId)
    // A page that stops answering (a render loop) fails the check instead of hanging the run.
    const run = async (expr, ms = 30_000) => {
      let timer
      const r = await Promise.race([send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sessionId), new Promise(ok => { timer = setTimeout(() => ok('hung'), ms) })])
      clearTimeout(timer)
      if (r === 'hung') throw new Error(`the page did not answer in ${ms / 1000} s: it is stuck, as in a render loop`)
      return r?.result?.value
    }
    // A check sent while the first navigation is still going can land on a half-loaded document and
    // never be answered: each waits 2 s at most and is sent again, for 30 s in all.
    const ready = () => run('document.documentElement.dataset.ready === "1"', 2000).catch(() => false)
    for (const end = Date.now() + 30_000; Date.now() < end && !await ready();) await new Promise(r => setTimeout(r, 100))
    // A real press (Input.dispatchMouseEvent): trusted, as a person's.
    const press = async (x, y) => { for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 }, sessionId) }
    // A real Enter (Input.dispatchKeyEvent), as a person's: on a focused button it clicks it.
    const enter = async () => { for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, ...(type === 'keyDown' ? { text: '\r' } : {}) }, sessionId) }
    // Real fingers (Input.dispatchTouchEvent): touchStart, touchMove or touchEnd, with [x, y] per finger.
    const touch = (type, fingers) => send('Input.dispatchTouchEvent', { type, touchPoints: fingers.map(([x, y], id) => ({ x, y, id })) }, sessionId)
    const screenshot = async file => {
      const { data } = await send('Page.captureScreenshot', { format: 'png' }, sessionId)
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, Buffer.from(data, 'base64'))
    }
    return { run, close, press, enter, touch, screenshot }
  } catch (e) { close(); throw e }
}
async function inPage(url, expression) {
  const page = await openPage(url)
  try { return await page.run(expression) } finally { page.close() }
}

const out = proto(['up', '--name', 'Smoke'])
const local = (out.match(/^local (\S+)/m) || out.match(/^url (\S+)/m) || [])[1]
if (!local || !await answers(`${local}__proto/status`)) fail(`the server does not answer at ${local}`)
const { pid } = JSON.parse(readFileSync(join(app, 'session.json'), 'utf8'))

// The stylesheet as served, read once before any prototype folder exists. Each read opens
// its own connection: the spawnSync calls block this script for many seconds, long enough for
// the server to close an idle kept-alive socket without fetch noticing.
const css = () => new Promise(ok => get(`${local}shell/shell.css?direct`, { agent: false }, r => {
  let text = ''
  r.setEncoding('utf8').on('data', c => { text += c }).on('end', () => r.statusCode === 200 ? ok(text) : fail(`the stylesheet answered ${r.statusCode}: ${text.slice(0, 400)}`))
}).on('error', e => fail(`could not read the stylesheet: ${e.message}`)))
await css()

await commentParentChecks({ proto, app, openPage, fail })
await commentPicturesChecks({ proto, app, openPage, fail })
await commentUsesChecks({ proto, app, openPage, fail })

proto(['add', 'home', '--title', 'Home page', '--ask', 'Two takes on the home page', '--variants', 'A:Classic,B:Big price'])
proto(['add', 'hero', '--title', 'Hero section', '--ask', 'The hero from B, further', '--from', 'home/B', '--variants', 'A:Price only,B:Fuel tabs'])
proto(['add', 'home', '--from', 'hero/A'], { ok: false })
proto(['add', 'cta', '--from', 'home/Z', '--variants', 'A:x'], { ok: false })
const meta = readFileSync(join(app, 'src', 'protos', 'hero', 'meta.ts'), 'utf8')
if (!meta.includes('"from": "home/B"')) fail('hero/meta.ts has no "from": "home/B"')
if (meta.includes('"also"')) fail('hero/meta.ts has one parent, so it should have no "also"')
// Nothing is picked yet, so a design from the picks has nothing to start from.
if (!/nothing is picked/.test(proto(['add', 'final', '--from-picks', '--variants', 'A:x'], { ok: false }))) fail('--from-picks with no picks did not say so')

proto(['pick', 'home', 'B'])
proto(['pick', 'home', 'Z'], { ok: false })
if (!readFileSync(join(app, 'src', 'protos', 'home', 'meta.ts'), 'utf8').includes('"picked": "B"')) fail('home/meta.ts has no "picked": "B"')

// The working variant: a pick sets it, `proto work` moves it (the old one goes under before),
// and asks are kept per variant in session.json.
proto(['work', 'hero/A', '--ask', 'Bigger price'])
proto(['work', 'hero/Z'], { ok: false })
proto(['ask', 'And a shorter title'])
const sess = JSON.parse(readFileSync(join(app, 'session.json'), 'utf8'))
if (sess.work?.proto !== 'hero' || sess.work.variant !== 'A') fail(`work should be hero/A, is ${JSON.stringify(sess.work)}`)
if (!sess.before?.some(b => b.proto === 'home' && b.variant === 'B')) fail('home/B (the pick) should be under before')
if (sess.asks?.['hero/A']?.length !== 2 || sess.asks?.['home/B']?.[0]?.text !== 'Picked B') fail(`asks are wrong: ${JSON.stringify(sess.asks)}`)

// One design from two variants ("A's layout with hero B's style"): the first parent stays a plain
// "from", the other goes in "also". A loop is refused when it runs through the second parent
// given, and on through an "also" above it: combo is built from hero, so hero can't be from combo.
const metaOf = slug => readFileSync(join(app, 'src', 'protos', slug, 'meta.ts'), 'utf8')
proto(['add', 'combo', '--title', 'Combined', '--from', 'home/A,hero/B', '--variants', 'A:Both'])
if (!metaOf('combo').includes('"from": "home/A"') || !/"also": \[\s*"hero\/B"\s*\]/.test(metaOf('combo'))) fail('combo/meta.ts should have "from": "home/A" and "also": ["hero/B"]')
proto(['add', 'hero', '--from', 'home/A,combo/A'], { ok: false })
proto(['add', 'mix', '--from', 'home/A,hero/Z', '--variants', 'A:x'], { ok: false })
// Another prototype as a whole is kept without a letter (hero's overview lists it in its header).
proto(['add', 'whole', '--title', 'All of hero', '--from', 'home/A,hero', '--variants', 'A:x'])
if (!/"also": \[\s*"hero"\s*\]/.test(metaOf('whole'))) fail('whole/meta.ts should have "also": ["hero"]')
// From the picks: every picked variant, oldest prototype first; an archived one is left out.
proto(['add', 'old', '--title', 'Dropped', '--variants', 'A:x'])
proto(['pick', 'old', 'A'])
proto(['archive', 'old'])
proto(['pick', 'hero', 'A'])
const final = proto(['add', 'final', '--title', 'Final', '--from-picks', '--variants', 'A:All picks'])
if (!/from home\/B, hero\/A$/m.test(final) || !metaOf('final').includes('"from": "home/B"') || !/"also": \[\s*"hero\/A"\s*\]/.test(metaOf('final'))) fail('final should be built from home/B, then hero/A')

proto(['shoot', '', 'hero', 'hero/A', 'combo'])
const shots = join(app, '.proto', 'shots')
const made = pngs(shots)
for (const want of ['session-desktop.png', 'hero-mobile.png', 'hero-A-desktop.png', 'combo-desktop.png']) {
  if (!made.includes(want)) fail(`no ${want} (made: ${made.join(', ') || 'none'})`)
  if (statSync(join(shots, want)).size < 10_000) fail(`${want} looks empty`)
}
// A state listed in meta.ts opens by its clicks; one whose clicks match nothing says so.
const heroMeta = join(app, 'src', 'protos', 'hero', 'meta.ts')
const metaSrc = readFileSync(heroMeta, 'utf8')
const at = metaSrc.indexOf('export default') + 'export default'.length
writeFileSync(heroMeta, metaSrc.slice(0, at) + ' ' + JSON.stringify({
  ...JSON.parse(metaSrc.slice(at)),
  about: { A: 'Price only.' },
  states: [
    { id: 'open', name: 'Panel', click: ['[data-shoot=open]'], about: { A: 'The panel, open.' } },
    { id: 'gone', name: 'Missing', click: ['[data-shoot=missing]'] },
  ],
}, null, 2) + '\n')
// The variant also reports hints for the Try it panel, through the app's own src/hints.ts.
if (!existsSync(join(app, 'src', 'hints.ts'))) fail('the app has no src/hints.ts')
writeFileSync(join(app, 'src', 'protos', 'hero', 'A.tsx'), `import { useState } from 'react'
import { useHints } from '../../hints'
export default function A() {
  const [open, setOpen] = useState(false)
  useHints([{ kind: 'value', label: 'Code', value: 'SAVE20' }, { kind: 'try', text: 'Open the panel', done: open }])
  return <div className="h-full w-[4321px] p-8"><button data-shoot="open" onClick={() => setOpen(true)}>Open</button>{open && <p>Panel</p>}</div>
}
`)
// A class in a prototype folder made while the server runs reaches the stylesheet.
let styled = false
for (let i = 0; i < 40 && !(styled = (await css()).includes('4321px')); i++) await new Promise(r => setTimeout(r, 250))
if (!styled) fail('a class in a new prototype folder never reached the stylesheet')
const stateOut = proto(['shoot', 'hero/A/open', 'hero/A/gone'])
if (!pngs(shots).includes('hero-A-open-desktop.png')) fail('no hero-A-open-desktop.png')
if (/nothing matches \[data-shoot=open\]/.test(stateOut)) fail('the state hero/A/open did not open')
if (!/nothing matches \[data-shoot=missing\]/.test(stateOut)) fail('proto shoot did not report the state whose clicks match nothing')
// One contact sheet per prototype: every variant, desktop above phone, no more than 2000 px
// either way, printed alone, then one line for the singles. A third variant on home lets the
// sheet take the whole width (two are held to its height instead). --sheet goes last: before a
// slug it would take the slug as its value.
proto(['add', 'home', '--variants', 'C:Map first'])
// The one-line plans show on the placeholders they name, and only there.
mkdirSync(join(app, '.proto', 'briefs'), { recursive: true })
writeFileSync(join(app, '.proto', 'briefs', 'home.json'), JSON.stringify({ facts: 'Fuel prices', directions: { C: { name: 'Map first', concept: 'The map is the page', display: "font('Young Serif')", body: 'Inter:wght@400..700', surface: '#0b1d2a', ink: '#f2efe6', accent: '#ff6a3d', signature: 'Pins as prices' } } }))
if (!/plans shown: C/.test(proto(['plan', 'home']))) fail('proto plan home did not show C\'s plan')
const planned = readFileSync(join(app, 'src', 'protos', 'home', 'C.tsx'), 'utf8')
if (!planned.startsWith('// Placeholder while') || !planned.includes('"Map first"') || !planned.includes('#ff6a3d') || !planned.includes('"displayFamily":"Young Serif"') || !planned.includes('"display":"Young Serif"')) fail(`home/C.tsx is not its plan card: ${planned.slice(0, 300)}`)
if (readFileSync(join(app, 'src', 'protos', 'home', 'B.tsx'), 'utf8').includes('one-line plan')) fail('proto plan wrote over B, which had no plan')
// A title face on the never-for-titles list is refused.
writeFileSync(join(app, '.proto', 'briefs', 'home.json'), JSON.stringify({ directions: { B: { name: 'Thin', display: "font('Italiana')", body: 'Inter' } } }))
if (!/not a title face/.test(proto(['plan', 'home'], { ok: false }))) fail('proto plan took Italiana as a title face')
const sheetOut = proto(['shoot', 'home', '--sheet'])
const sheet = sheetOut.split(/\r?\n/)[0].trim()
if (!sheet.endsWith('home-sheet.png') || !existsSync(sheet)) fail(`proto shoot --sheet should print home-sheet.png first, printed: ${sheetOut}`)
const sheetHead = readFileSync(sheet)
const [sw, sh] = [sheetHead.readUInt32BE(16), sheetHead.readUInt32BE(20)]
if (sw < 1800 || sw > 2000 || sh > 2000) fail(`home-sheet.png is ${sw}x${sh}; it should be about 2000 wide and no taller`)
if (sheetOut.split(/\r?\n/).filter(l => /\.png$/.test(l.trim())).length !== 1 || !/^6 single shots in /m.test(sheetOut)) fail(`proto shoot --sheet should print the sheet, then one line for its 6 singles: ${sheetOut}`)
for (const want of ['home-A-desktop.png', 'home-C-mobile.png']) if (!pngs(shots).includes(want)) fail(`proto shoot --sheet wrote no ${want}`)
// The same state across the variants that have it.
proto(['shoot', 'hero', '--state', 'open', '--sheet'])
if (!pngs(shots).includes('hero-open-sheet.png')) fail('proto shoot hero --state open --sheet wrote no hero-open-sheet.png')
cpSync(shots, keepShots, { recursive: true })

// The checklist for building hero/A into the codebase, read from its files: its states, its
// click with the line it is on, and where its Try it list is.
const handoff = proto(['handoff', 'hero/A'])
if (!/^- \[ \] Panel \(`hero\/A\/open`\): The panel, open\./m.test(handoff)) fail('proto handoff did not list the state Panel')
if (!/^- \[ \] `onClick=\{\(\) => setOpen\(true\)\}` · A\.tsx:6\b/m.test(handoff)) fail('proto handoff did not list the click on A.tsx:6')
if (!/useHints.* · A\.tsx:5\b/.test(handoff)) fail('proto handoff did not point at the Try it list on A.tsx:5')
if (!/proto shoot hero\/A --ref \S+ --as built/.test(handoff)) fail('proto handoff did not end with the shoot that checks the build')
proto(['handoff', 'hero/Z'], { ok: false })
// A `/*` or `//` inside a string (a glob, a URL) is not a comment: the lines after it still count.
writeFileSync(join(app, 'src', 'protos', 'home', 'A.tsx'), [
  'const icons = import.meta.glob(\'./icons/*.svg\', { eager: true })',
  'const docs = \'https://example.com/guide // not a comment\'',
  'export default function A() {',
  '  return <a href={docs} data-shoot="go" onClick={() => console.log(icons)} className="transition-colors">Go</a>',
  '}',
  // A comment opened at a line's very end, with a blank line in it, runs to its `*/`.
  'const old = <div>{/*',
  '',
  '  <p className="animate-spin">gone</p>',
  '*/}</div>',
].join('\n'))
const globbed = proto(['handoff', 'home/A'])
if (!/`onClick=\{\(\) => console\.log\(icons\)\}` · A\.tsx:4\b/.test(globbed)) fail('a glob string (./icons/*.svg) hid the click after it from proto handoff')
if (!/`transition-colors` · A\.tsx:4\b/.test(globbed)) fail('a glob string (./icons/*.svg) hid the motion after it from proto handoff')
if (/animate-spin/.test(globbed)) fail('proto handoff listed a class from inside a comment that opened at a line\'s end')

// Where each part of a design is written: the variant's DOM elements carry their file and line
// under src/protos and the component they are in, and the shell's own elements carry neither.
const stamped = await inPage(`${local}?theme=light#/hero/A`, `(() => {
  const b = document.querySelector('[data-mount] [data-shoot=open]')
  return [b?.dataset.protoSrc, b?.dataset.protoComponent, document.querySelectorAll('[data-bar] [data-proto-src], [data-side] [data-proto-src]').length].join(' ')
})()`)
if (stamped !== 'hero/A.tsx:6 A 0') fail(`the variant's button should say hero/A.tsx:6 A (and the shell nothing), says: ${stamped}`)

proto(['snap', 'hero/A'])
if (!existsSync(join(app, '.proto', 'snaps', 'hero-A.jsx'))) fail('proto snap wrote no hero-A.jsx')
if (readFileSync(join(app, '.proto', 'snaps', 'hero-A.jsx'), 'utf8').includes('data-proto-')) fail('the snapshot kept the data-proto-src attributes')

// A phone prototype at a device's size, compared with a reference screenshot. The path is
// relative to the app, not to where proto runs.
proto(['add', 'phone', '--title', 'Phone', '--variants', 'A:Current', '--kind', 'phone', '--screen', '402x874'])
proto(['add', 'phone', '--screen', 'big'], { ok: false })
if (!readFileSync(join(app, 'src', 'protos', 'phone', 'meta.ts'), 'utf8').includes('"screen": [\n    402,\n    874\n  ]')) fail('phone/meta.ts has no screen [402, 874]')
proto(['shoot', 'phone/A', '--ref', '.proto/shots/hero-A-desktop.png'])
const screen = join(shots, 'phone-A-screen.png')
if (!existsSync(screen)) fail('proto shoot --ref wrote no phone-A-screen.png')
const head = readFileSync(screen)
const size = `${head.readUInt32BE(16)}x${head.readUInt32BE(20)}`
if (size !== '1206x2622') fail(`phone-A-screen.png is ${size}, not the 402x874 screen at 3x (1206x2622)`)
if (!existsSync(join(shots, 'phone-A-vs-ref.png'))) fail('proto shoot --ref wrote no phone-A-vs-ref.png')
if (pngs(shots).some(f => /^phone-A-(desktop|mobile)\.png$/.test(f))) fail('proto shoot --ref should write only the screen and the sheet')
// The same sheet against the variant as built: written beside the reference's, which stays.
proto(['shoot', 'phone/A', '--as', 'built'], { ok: false })
proto(['shoot', 'phone/A', '--ref', '.proto/shots/hero-A-desktop.png', '--as', 'built'])
if (!existsSync(join(shots, 'phone-A-vs-built.png'))) fail('proto shoot --as built wrote no phone-A-vs-built.png')
if (!existsSync(join(shots, 'phone-A-vs-ref.png'))) fail('proto shoot --as built removed phone-A-vs-ref.png')

// Comments from the page: a batch with a screenshot goes in through the server, is taken by
// `proto inbox` (a directory rename, which Windows can refuse), shown with its image on disk,
// answered with `proto reply`, and the page's status then says what became of it. A listener
// started first wakes up by itself when the next batch arrives.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const send = async comments => {
  const res = await fetch(`${local}__proto/comments`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ comments, viewport: { w: 390, h: 844, phone: true }, theme: 'dark' }) })
  const body = await res.json()
  if (!res.ok) fail(`posting comments answered ${res.status}: ${JSON.stringify(body)}`)
  return body
}
const sent = await send([
  { route: 'hero/A', text: 'Make the price bigger', target: { selector: ':scope > div:nth-child(1)', shoot: 'open', src: 'hero/A.tsx:6', component: 'A', tag: 'button', text: 'Open', rect: { x: 4, y: 8, w: 120, h: 40 } }, tags: [{ selector: ':scope > p', tag: 'p', text: 'Panel' }], images: [{ dataUrl: PNG, name: 'marked up' }] },
  { route: 'home/B', text: 'Second one', point: { x: 10, y: 20 } },
])
if (!sent.sent || sent.inbox?.new !== 1) fail(`the batch was not queued: ${JSON.stringify(sent)}`)
const got = proto(['inbox'])
if (!/Make the price bigger/.test(got) || !/data-shoot=open/.test(got) || !/at 4,8 120x40/.test(got)) fail('proto inbox did not print the comment with its element and place')
if (!got.includes('src/protos/hero/A.tsx:6 (A)')) fail('proto inbox did not print where the element is written')
const image = (got.match(/image: (.+?)(?:  \(|$)/m) || [])[1]?.trim()
if (!image || !existsSync(image)) fail(`the screenshot is not on disk at ${image}`)
if (!/no new comments/.test(proto(['inbox']))) fail('a batch was handed out twice')
const batch = (got.match(/^batch (\S+)/m) || [])[1]
proto(['reply', `${batch}/1`, 'Price is now 48px', '--done', '--as', 'codex'])
let state = await (await fetch(`${local}__proto/status`)).json()
const c1 = state.inbox.batches.find(b => b.id === batch)?.comments.find(c => c.n === 1)
if (!c1?.done || c1.reply?.text !== 'Price is now 48px' || c1.reply.by !== 'codex') fail(`the reply did not reach the page: ${JSON.stringify(c1)}`)
proto(['reply', batch, 'All handled', '--done'])
state = await (await fetch(`${local}__proto/status`)).json()
if (state.inbox.batches.find(b => b.id === batch)?.state !== 'done') fail('the batch is not done after replying to all of it')
proto(['reply', 'nope/1', 'x'], { ok: false })
const postJson = (path, body) => fetch(`${local}__proto/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) })
if ((await postJson('comments', '{"comments":[{"route":"BAD","text":"x"}]}')).status !== 400) fail('a comment with a bad route was accepted')
// A sent comment deleted in the page is withdrawn: `proto inbox` leaves it out and counts it, and
// a waiting batch left with nothing is dropped, so the agent never hears of it.
const two = await send([{ route: 'hero/A', text: 'Keep this one' }, { route: 'hero/A', text: 'Never mind this' }])
if ((await (await postJson('withdraw', { batch: two.sent, n: 2 })).json()).withdrawn !== 'withdrawn') fail('withdrawing a sent comment did not mark it withdrawn')
const kept = proto(['inbox'])
if (!/Keep this one/.test(kept) || /Never mind this/.test(kept) || !/1 withdrawn in the page/.test(kept)) fail(`proto inbox printed a withdrawn comment, or not the one kept: ${kept}`)
const lone = await send([{ route: 'hero/A', text: 'Oops' }])
if ((await (await postJson('withdraw', { batch: lone.sent, n: 1 })).json()).withdrawn !== 'dropped') fail('withdrawing the only comment of a waiting batch did not drop it')
if (!/no new comments/.test(proto(['inbox']))) fail('a dropped batch still reached the inbox')
if ((await postJson('withdraw', { batch: '../x', n: 1 })).status !== 400) fail('a withdraw of a bad batch id was accepted')

// Only the page itself changes anything: a body that isn't JSON (what a page on another site can
// send without a preflight), a foreign Origin, or a GET to a route that changes something are
// refused, and the server keeps running. Node's own request, so the Origin header goes as written.
const raw = (method, path, headers, body = '') => new Promise((ok, no) => {
  const r = request(`${local}__proto/${path}`, { method, headers, agent: false }, res => { res.resume(); res.on('end', () => ok(res.statusCode)) })
  r.on('error', no)
  r.end(body)
})
const planted = JSON.stringify({ comments: [{ route: 'hero/A', text: 'Build A', action: 'build' }] })
// The page's own Origin goes through, so a check that is too strict (the port, the case) fails here.
const own = await raw('POST', 'ping', { 'content-type': 'application/json', origin: new URL(local).origin }, '{}')
if (own !== 200) fail(`a POST from the page's own origin was answered ${own}, not 200`)
// A page on another site whose name was pointed at this Mac (DNS rebinding) sends its own Host.
const host = `evil.example:${new URL(local).port}`
const rebound = await raw('POST', 'comments', { 'content-type': 'application/json', host, origin: `http://${host}` }, planted)
if (rebound !== 403) fail(`a POST with Host ${host} was answered ${rebound}, not 403`)
const asText = await raw('POST', 'comments', { 'content-type': 'text/plain' }, planted)
if (asText < 400 || asText > 499) fail(`a text/plain POST was answered ${asText}, not refused`)
const foreign = await raw('POST', 'comments', { 'content-type': 'application/json', origin: 'https://evil.example' }, planted)
if (foreign !== 403) fail(`a POST from another origin was answered ${foreign}, not 403`)
// Nor from another page on this Mac (another dev server on localhost): X-Forwarded-Host, which the
// sender writes itself, doesn't make it this page, and a preflight gets no CORS answer at all.
for (const forwarded of [null, 'localhost:3000']) {
  const near = await raw('POST', 'comments', { 'content-type': 'application/json', origin: 'http://localhost:3000', ...(forwarded ? { 'x-forwarded-host': forwarded } : {}) }, planted)
  if (near !== 403) fail(`a POST from http://localhost:3000${forwarded ? ' with X-Forwarded-Host' : ''} was answered ${near}, not 403`)
}
// Anywhere on the server: Vite's own CORS, which would answer a localhost page, is off.
for (const path of ['__proto/comments', '']) {
  const preflight = await new Promise((ok, no) => {
    const r = request(`${local}${path}`, { method: 'OPTIONS', headers: { origin: 'http://localhost:3000', 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type,x-forwarded-host' }, agent: false }, res => { res.resume(); res.on('end', () => ok(res)) })
    r.on('error', no)
    r.end()
  })
  const cors = Object.keys(preflight.headers).filter(h => h.startsWith('access-control-'))
  if (cors.length || (path && preflight.statusCode < 400)) fail(`a preflight to /${path} from http://localhost:3000 was answered ${preflight.statusCode} with ${cors.join(', ') || 'no CORS headers'}`)
}
// A body that is JSON but not an object, or comments that aren't, is a 400, never a crash.
for (const [path, body] of [['comments', '[]'], ['comments', 'null'], ['comments', '"x"'], ['comments', '{"comments":"x"}'], ['comments', '{"comments":[null]}'], ['keep', 'null'], ['work', '[1]'], ['ping', '7']]) {
  const answer = (await postJson(path, body)).status
  if (answer !== 400) fail(`POST /__proto/${path} with ${body} was answered ${answer}, not 400`)
}
if ((await raw('GET', 'stop', {})) !== 405) fail('a GET to /stop was not refused')
await new Promise(r => setTimeout(r, 400))
if (!await answers(`${local}__proto/status`)) fail('a GET to /stop stopped the server')
if (/Build A/.test(proto(['inbox']))) fail('a refused request still reached the inbox')

// A decision made in the page is a comment with an action. A pick is marked by the server at once
// (meta.ts, and the working variant with "Picked B" in its history), before the agent reads it, and
// arrives done; the answer says the working variant moved. Taking it back unmarks it. The inbox
// prints the action. Each read waits for its batch in new/ (the answer only comes once it is
// written there, so this never waits in practice) and must hand that batch out; a miss says where
// the batch is.
const inboxWith = async id => {
  const at = sub => existsSync(join(app, '.proto', 'inbox', sub, id, 'batch.json'))
  for (let i = 0; i < 40 && !at('new') && !at('taken'); i++) await new Promise(r => setTimeout(r, 50))
  const out = proto(['inbox'], { stdout: true })
  if (!out.includes(`batch ${id} ·`)) fail(`proto inbox did not hand out batch ${id} (in new/: ${at('new')}, in taken/: ${at('taken')}):\n${out}`)
  return out
}
const pickSent = await send([{ route: 'hero/B', text: 'Picked B', action: 'pick' }])
if (!readFileSync(heroMeta, 'utf8').includes('"picked": "B"')) fail('a pick from the page did not mark hero/meta.ts')
if (pickSent.moved !== true) fail(`the pick moved the working variant but the answer says moved: ${pickSent.moved}`)
if (pickSent.inbox.batches.find(b => b.id === pickSent.sent)?.state !== 'done') fail('a pick from the page did not arrive done')
const picked = JSON.parse(readFileSync(join(app, 'session.json'), 'utf8'))
if (picked.work?.proto !== 'hero' || picked.work.variant !== 'B' || picked.asks?.['hero/B']?.at(-1)?.text !== 'Picked B') fail(`a pick from the page should make hero/B the working variant with "Picked B": ${JSON.stringify(picked.work)} ${JSON.stringify(picked.asks?.['hero/B'])}`)
if (!/^ {3}action: pick \(done/m.test(await inboxWith(pickSent.sent))) fail('proto inbox did not print the pick as done (action: pick (done …))')
// The answer says how each decision went, and where the working variant is now.
if (JSON.stringify(pickSent.results) !== '[{"n":1,"action":"pick","done":true}]' || pickSent.work?.variant !== 'B') fail(`the answer to a pick should say it was done and work is hero/B: ${JSON.stringify(pickSent.results)} ${JSON.stringify(pickSent.work)}`)
const unpickSent = await send([{ route: 'hero/B', text: 'Unpicked B', action: 'unpick' }, { route: 'hero/B', text: 'More like B: warmer', action: 'more' }])
if (readFileSync(heroMeta, 'utf8').includes('"picked"')) fail('taking the pick back in the page left it in hero/meta.ts')
if (JSON.stringify(unpickSent.results) !== '[{"n":1,"action":"unpick","done":true},{"n":2,"action":"more","done":false}]') fail(`the answer should say the unpick was done and More waits: ${JSON.stringify(unpickSent.results)}`)
if (!/action: more/.test(await inboxWith(unpickSent.sent))) fail('proto inbox did not print action: more')
// Taking back a pick that isn't there changes nothing, so it isn't done: it arrives saying so.
const noop = await send([{ route: 'hero/A', text: 'Unpicked A', action: 'unpick' }])
if (noop.results?.[0]?.done !== false || !noop.results[0].nothing || noop.inbox.batches.find(b => b.id === noop.sent)?.state === 'done') fail(`an unpick of a variant that wasn't picked arrived done: ${JSON.stringify(noop.results)}`)
if (!/^ {3}action: unpick \(nothing changed/m.test(await inboxWith(noop.sent))) fail('proto inbox did not say an unpick changed nothing')
// A pick that is marked but can't move the working variant (session.json unreadable for a moment)
// says so, apart from one that wasn't marked at all.
const sessionText = readFileSync(join(app, 'session.json'), 'utf8')
writeFileSync(join(app, 'session.json'), '{ "half')
const half = await send([{ route: 'hero/A', text: 'Picked A', action: 'pick' }])
writeFileSync(join(app, 'session.json'), sessionText)
if (half.results?.[0]?.done !== false || !half.results[0].marked || !readFileSync(heroMeta, 'utf8').includes('"picked": "A"')) fail(`a pick marked in meta.ts whose move failed should answer marked, not done: ${JSON.stringify(half.results)}`)
if (!/^ {3}action: pick \(marked in the page, but the working variant didn't move/m.test(proto(['inbox']))) fail('proto inbox did not say the pick was marked and only the move failed')
proto(['pick', 'hero', '--off'])
for (const bad of [{ route: 'hero/Z', text: 'x', action: 'pick' }, { route: 'hero/B', text: 'x', action: 'dance' }, { route: 'hero', text: 'x', action: 'build' }]) {
  if ((await postJson('comments', { comments: [bad] })).status !== 400) fail(`an action that can't be done was accepted: ${JSON.stringify(bad)}`)
}
// A meta.ts that no longer reads as JSON refuses the pick before anything is written: nothing is
// left half-made in .incoming, and the next send still arrives.
const heroText = readFileSync(heroMeta, 'utf8')
writeFileSync(heroMeta, heroText.replace('export default {', 'export default { oops'))
if ((await postJson('comments', { comments: [{ route: 'hero/B', text: 'Picked B', action: 'pick' }] })).status !== 400) fail('a pick on a meta.ts that does not read was accepted')
// More and Build write nothing there, so they only need the variant's file.
if ((await postJson('comments', { comments: [{ route: 'hero/B', text: 'Build B', action: 'build' }] })).status !== 200) fail('Build on a variant whose meta.ts does not read was refused')
writeFileSync(heroMeta, heroText)
const incoming = join(app, '.proto', 'inbox', '.incoming')
if (existsSync(incoming) && readdirSync(incoming).length) fail(`a refused send left ${readdirSync(incoming).join(', ')} in .incoming`)
// A variant's name is written back as it is, `$` patterns and all, by a pick from the page, by
// `proto pick` and by `proto archive`.
proto(['add', 'tiers', '--title', 'Tiers', '--variants', 'A:$$ tier $&,B:Plain'])
const tiersMeta = join(app, 'src', 'protos', 'tiers', 'meta.ts')
const tiers = () => JSON.parse(readFileSync(tiersMeta, 'utf8').replace(/^[\s\S]*?export default\s*/, ''))
await send([{ route: 'tiers/A', text: 'Picked A', action: 'pick' }])
if (tiers().variants.A !== '$$ tier $&' || tiers().picked !== 'A') fail(`a pick from the page rewrote a $ name: ${JSON.stringify(tiers())}`)
proto(['pick', 'tiers', 'B'])
proto(['archive', 'tiers'])
if (tiers().variants.A !== '$$ tier $&' || tiers().picked !== 'B' || !tiers().archived) fail(`proto pick or archive rewrote a $ name: ${JSON.stringify(tiers())}`)
if (!readFileSync(join(app, 'src', 'protos', 'tiers', 'A.tsx'), 'utf8').includes('$$ tier $&')) fail('the placeholder for a $ name was written wrong')
proto(['archive', 'tiers', '--off'])
proto(['inbox'])
// Every write went through a scratch file renamed into place, and none is left behind.
const leftover = join(app, '.proto', 'tmp')
if (existsSync(leftover) && readdirSync(leftover).length) fail(`scratch files were left in .proto/tmp: ${readdirSync(leftover).join(', ')}`)
// Listening: --wait exits, printing the batch, once another one lands.
const waiter = spawn(process.execPath, [join(skill, 'scripts', 'proto.mjs'), 'inbox', '--wait', '--project', project, '--session', 'smoke'], { stdio: ['ignore', 'pipe', 'pipe'] })
let heard = ''
waiter.stdout.on('data', d => { heard += d })
const exited = new Promise(ok => waiter.on('exit', ok))
for (let i = 0; i < 40 && !/listening for comments/.test(heard); i++) await new Promise(r => setTimeout(r, 250))
if (!/listening for comments/.test(heard)) { waiter.kill(); fail('proto inbox --wait never said it was listening') }
await send([{ route: 'hero/A', text: 'Woke you up', point: { x: 1, y: 1 } }])
const code = await Promise.race([exited, new Promise(r => setTimeout(() => r('timeout'), 20_000))])
if (code === 'timeout') { waiter.kill(); fail('proto inbox --wait did not wake for a new batch') }
if (!/Woke you up/.test(heard)) fail(`the listener exited without the batch: ${heard}`)

// The motion dock: a variant that declares its motion (useMotion) gets the dock under it, and the
// take records its CSS transitions with when each starts (one staggered), holds them, and sets the
// design to any moment. A comment on a range of it goes out through the page's own composer, the
// inbox prints its times, and a reply reaches its point. A variant without useMotion has no dock.
if (!existsSync(join(app, 'src', 'motion.ts'))) fail('the app has no src/motion.ts')
proto(['add', 'move', '--title', 'Motion', '--variants', 'A:Panel,B:Still,C:Twice,D:Chained,E:Broken,F:Late,G:Again,H:Then keyframes,I:Then animate,J:Swap,K:Nudge,L:Cancelled,M:Shake,N:Reversed,P:Dropped,Q:Portal'])
writeFileSync(join(app, 'src', 'protos', 'move', 'A.tsx'), `import { useState } from 'react'
import { useMotion } from '../../motion'
export default function A() {
  const [open, setOpen] = useState(false)
  useMotion({ start: () => setOpen(true), reset: () => setOpen(false), moments: [{ label: 'Rows', at: 100 }] })
  return <div className="h-full p-8">
    <div data-shoot="panel" style={{ height: 240, background: '#4f46e5', transform: open ? 'translateY(0px)' : 'translateY(100px)', transition: 'transform 400ms linear' }}>
      {['One', 'Two', 'Three'].map((n, i) => <p key={n} data-shoot="row" style={{ opacity: open ? 1 : 0, transition: \`opacity 200ms linear \${open ? 100 + i * 100 : 0}ms\` }}>{n}</p>)}
    </div>
  </div>
}
`)
writeFileSync(join(app, 'src', 'protos', 'move', 'B.tsx'), 'export default function B() { return <div className="h-full p-8">Still</div> }\n')
// One property moved twice: a toast in (CSS transition), then out once a timer runs; and a box moved
// by two element.animate() calls filling forwards, the second after the first (the browser drops
// the first once the second covers it). Then a start() that throws, and a step a timer starts after
// the take has ended (only a color: a Save turning green).
writeFileSync(join(app, 'src', 'protos', 'move', 'C.tsx'), `import { useState } from 'react'
import { useMotion } from '../../motion'
export default function C() {
  const [step, setStep] = useState(0)
  // Out at 0.7 s: on a slow runner the fade in starts late, and a timer firing during it would turn it around.
  useMotion({ start: () => { setStep(1); setTimeout(() => setStep(2), 700) }, reset: () => setStep(0) })
  return <div className="h-full p-8"><p data-shoot="toast" style={{ width: 160, height: 60, background: '#4f46e5', opacity: step === 1 ? 1 : 0, transition: 'opacity 300ms linear' }} /></div>
}
`)
writeFileSync(join(app, 'src', 'protos', 'move', 'D.tsx'), `import { useRef } from 'react'
import { useMotion } from '../../motion'
export default function D() {
  const box = useRef<HTMLDivElement>(null)
  useMotion({
    start: () => {
      box.current!.animate([{ transform: 'translateX(0px)' }, { transform: 'translateX(100px)' }], { duration: 300, fill: 'forwards' })
      box.current!.animate([{ transform: 'translateX(100px)' }, { transform: 'translateX(200px)' }], { duration: 300, delay: 300, fill: 'forwards' })
    },
    reset: () => box.current!.getAnimations().forEach(a => a.cancel()),
  })
  return <div className="h-full p-8"><div ref={box} data-shoot="box" style={{ width: 80, height: 80, background: '#4f46e5' }} /></div>
}
`)
writeFileSync(join(app, 'src', 'protos', 'move', 'E.tsx'), `import { useMotion } from '../../motion'
export default function E() {
  useMotion({ start: () => { throw new Error('boom') } })
  return <div className="h-full p-8">Broken</div>
}
`)
writeFileSync(join(app, 'src', 'protos', 'move', 'F.tsx'), `import { useState } from 'react'
import { useMotion } from '../../motion'
export default function F() {
  const [step, setStep] = useState(0)
  useMotion({ start: () => { setStep(1); setTimeout(() => setStep(2), 1200) }, reset: () => setStep(0) })
  return <div className="h-full p-8">
    <p data-shoot="one" style={{ opacity: step >= 1 ? 1 : 0, transition: 'opacity 200ms linear' }}>One</p>
    <button data-shoot="save" style={{ background: step >= 2 ? '#10b981' : '#e4e4e7', transition: 'background-color 200ms linear' }}>Save</button>
  </div>
}
`)
// Taken again and again: element.animate() filling forwards, with a reset that doesn't cancel it.
// Then a transition followed by a CSS animation, and by element.animate(), on the same property;
// and a keyframe animation that a class swap replaces (an enter, then an exit).
writeFileSync(join(app, 'src', 'protos', 'move', 'G.tsx'), `import { useRef, useState } from 'react'
import { useMotion } from '../../motion'
export default function G() {
  const box = useRef<HTMLDivElement>(null)
  const [, setOpen] = useState(false)
  useMotion({ start: () => { setOpen(true); box.current!.animate([{ transform: 'translateX(0px)' }, { transform: 'translateX(100px)' }], { duration: 300, fill: 'forwards' }) }, reset: () => setOpen(false) })
  return <div className="h-full p-8"><div ref={box} data-shoot="slide" style={{ width: 80, height: 80, background: '#4f46e5' }} /></div>
}
`)
writeFileSync(join(app, 'src', 'protos', 'move', 'H.tsx'), `import { useState } from 'react'
import { useMotion } from '../../motion'
export default function H() {
  const [step, setStep] = useState(0)
  useMotion({ start: () => { setStep(1); setTimeout(() => setStep(2), 500) }, reset: () => setStep(0) })
  return <div className="h-full p-8">
    <style>{'@keyframes h-out { from { opacity: 1 } to { opacity: .2 } }'}</style>
    <div data-shoot="fade" style={{ width: 160, height: 60, background: '#4f46e5', opacity: step >= 1 ? 1 : 0, transition: 'opacity 300ms linear', animation: step === 2 ? 'h-out 500ms linear forwards' : 'none' }} />
  </div>
}
`)
writeFileSync(join(app, 'src', 'protos', 'move', 'I.tsx'), `import { useRef, useState } from 'react'
import { useMotion } from '../../motion'
export default function I() {
  const box = useRef<HTMLDivElement>(null)
  const [step, setStep] = useState(0)
  useMotion({
    start: () => { setStep(1); setTimeout(() => box.current?.animate([{ transform: 'translateX(100px)' }, { transform: 'translateX(200px)' }], { duration: 500, fill: 'forwards' }), 500) },
    reset: () => { box.current!.getAnimations().forEach(a => a.cancel()); setStep(0) },
  })
  return <div className="h-full p-8"><div ref={box} data-shoot="slide" style={{ width: 80, height: 80, background: '#4f46e5', transform: step ? 'translateX(100px)' : 'translateX(0px)', transition: 'transform 300ms linear' }} /></div>
}
`)
writeFileSync(join(app, 'src', 'protos', 'move', 'J.tsx'), `import { useState } from 'react'
import { useMotion } from '../../motion'
export default function J() {
  const [state, setState] = useState('idle')
  useMotion({ start: () => { setState('in'); setTimeout(() => setState('out'), 500) }, reset: () => setState('idle') })
  return <div className="h-full p-8">
    <style>{'@keyframes j-in { from { opacity: 0 } to { opacity: 1 } } @keyframes j-out { from { opacity: 1 } to { opacity: 0 } } .j-in { animation: j-in 300ms linear both } .j-out { animation: j-out 300ms linear both }'}</style>
    <div data-shoot="note" className={state === 'in' ? 'j-in' : state === 'out' ? 'j-out' : ''} style={{ width: 160, height: 60, background: '#4f46e5', opacity: state === 'idle' ? 0 : undefined }} />
  </div>
}
`)
// A sheet that enters (transform and opacity), then a class swap that nudges it (transform only):
// the browser cancels the enter. A slide cancelled at 0.4 s, nothing taking its place, beside a bar
// that runs on. And a shake added (composite add) to a slide that fills forwards.
writeFileSync(join(app, 'src', 'protos', 'move', 'K.tsx'), `import { useState } from 'react'
import { useMotion } from '../../motion'
export default function K() {
  const [state, setState] = useState('idle')
  useMotion({ start: () => { setState('in'); setTimeout(() => setState('nudge'), 400) }, reset: () => setState('idle') })
  return <div className="h-full p-8">
    <style>{'@keyframes k-in { from { transform: translateY(100px); opacity: 0 } to { transform: translateY(0px); opacity: 1 } } @keyframes k-nudge { from { transform: translateY(0px) } to { transform: translateY(-40px) } } .k-in { animation: k-in 300ms linear both } .k-nudge { animation: k-nudge 200ms linear forwards }'}</style>
    <div data-shoot="sheet" className={state === 'in' ? 'k-in' : state === 'nudge' ? 'k-nudge' : ''} style={{ width: 160, height: 60, marginTop: 60, background: '#4f46e5', opacity: state === 'idle' ? 0 : undefined }} />
  </div>
}
`)
writeFileSync(join(app, 'src', 'protos', 'move', 'L.tsx'), `import { useRef } from 'react'
import { useMotion } from '../../motion'
export default function L() {
  const slide = useRef<HTMLDivElement>(null), bar = useRef<HTMLDivElement>(null)
  useMotion({
    start: () => {
      const a = slide.current!.animate([{ transform: 'translateX(0px)' }, { transform: 'translateX(200px)' }], { duration: 1000, fill: 'forwards' })
      bar.current!.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 1000, fill: 'forwards' })
      setTimeout(() => a.cancel(), 400)
    },
    reset: () => [slide, bar].forEach(r => r.current!.getAnimations().forEach(a => a.cancel())),
  })
  return <div className="h-full p-8">
    <div ref={slide} data-shoot="slide" style={{ width: 80, height: 80, background: '#4f46e5' }} />
    <div ref={bar} data-shoot="bar" style={{ width: 160, height: 20, marginTop: 8, background: '#0ea5e9' }} />
  </div>
}
`)
writeFileSync(join(app, 'src', 'protos', 'move', 'M.tsx'), `import { useRef } from 'react'
import { useMotion } from '../../motion'
export default function M() {
  const box = useRef<HTMLDivElement>(null)
  useMotion({
    start: () => {
      box.current!.animate([{ transform: 'translateX(0px)' }, { transform: 'translateX(100px)' }], { duration: 300, fill: 'forwards' })
      box.current!.animate([{ transform: 'translateX(0px)' }, { transform: 'translateX(40px)' }, { transform: 'translateX(0px)' }], { duration: 300, delay: 300, composite: 'add' })
    },
    reset: () => box.current!.getAnimations().forEach(a => a.cancel()),
  })
  return <div className="h-full p-8"><div ref={box} data-shoot="box" style={{ width: 80, height: 80, background: '#4f46e5' }} /></div>
}
`)
// Played backwards (reverse()), beside one with a negative delay (it starts partway through). And
// two element.animate() calls chained, filling forwards, with a reset that cancels neither: the
// browser drops the first once the second covers it.
writeFileSync(join(app, 'src', 'protos', 'move', 'N.tsx'), `import { useRef } from 'react'
import { useMotion } from '../../motion'
export default function N() {
  const back = useRef<HTMLDivElement>(null), early = useRef<HTMLDivElement>(null)
  useMotion({
    start: () => {
      back.current!.animate([{ transform: 'translateX(0px)' }, { transform: 'translateX(100px)' }], { duration: 400, fill: 'forwards' }).reverse()
      early.current!.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 600, delay: -300, fill: 'forwards' })
    },
    reset: () => [back, early].forEach(r => r.current!.getAnimations().forEach(a => a.cancel())),
  })
  return <div className="h-full p-8">
    <div ref={back} data-shoot="back" style={{ width: 80, height: 80, background: '#4f46e5' }} />
    <div ref={early} data-shoot="early" style={{ width: 80, height: 20, marginTop: 8, background: '#0ea5e9' }} />
  </div>
}
`)
writeFileSync(join(app, 'src', 'protos', 'move', 'P.tsx'), `import { useRef, useState } from 'react'
import { useMotion } from '../../motion'
export default function P() {
  const box = useRef<HTMLDivElement>(null)
  const [, setOpen] = useState(false)
  useMotion({
    start: () => {
      setOpen(true)
      box.current!.animate([{ transform: 'translateX(0px)' }, { transform: 'translateX(100px)' }], { duration: 200, fill: 'forwards' })
      box.current!.animate([{ transform: 'translateX(100px)' }, { transform: 'translateX(200px)' }], { duration: 200, delay: 200, fill: 'forwards' })
    },
    reset: () => setOpen(false),
  })
  return <div className="h-full p-8"><div ref={box} data-shoot="box" style={{ width: 80, height: 80, background: '#4f46e5' }} /></div>
}
`)
// A sheet the design renders on <body> through a portal (as Base UI's Drawer does), sliding up,
// with steps and a Close in it. It counts its starts.
writeFileSync(join(app, 'src', 'protos', 'move', 'Q.tsx'), `import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useMotion } from '../../motion'
export default function Q() {
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState(1)
  useMotion({ start: () => { (window as any).__starts = ((window as any).__starts ?? 0) + 1; setOpen(true) }, reset: () => setOpen(false) })
  return <div className="h-full p-8">
    <p data-shoot="label">Sheet</p>
    {createPortal(<div data-shoot="sheet" style={{ position: 'fixed', left: 480, width: 400, top: 120, height: 200, background: '#4f46e5', transform: open ? 'translateY(0px)' : 'translateY(300px)', transition: 'transform 400ms linear' }}>
      <p data-shoot="step">Step {step}</p>
      <button data-shoot="next" onClick={() => setStep(step + 1)}>Next</button>
      <button data-shoot="close" onClick={() => setOpen(false)}>Close</button>
    </div>, document.body)}
  </div>
}
`)
const near = (a, b, by) => typeof a === 'number' && Math.abs(a - b) <= by
// The design's own document (in the view's frame on a wide page, else the page) and a box of an
// element of it in the page's px, for checks that read or press the design itself.
const HELPERS = `window.__D = () => window.__protoDesign?.()?.ownerDocument ?? document; window.__R = el => { const r = el.getBoundingClientRect(), f = el.ownerDocument === document ? null : el.ownerDocument.defaultView.frameElement; if (!f) return r; const o = f.getBoundingClientRect(), s = o.width / (f.offsetWidth || 1); return { x: o.left + r.x * s, y: o.top + r.y * s, width: r.width * s, height: r.height * s } }`
const motionPage = await openPage(`${local}?theme=light#/move/A`)
try {
  // The design is in the stage's own artboard, a frame of the page: __D is its document (portals
  // included) and __R a box of it where the page draws it, for a real press.
  const run = expr => motionPage.run(`${HELPERS};${expr}`)
  const until = async (expr, what, ms = 15_000) => {
    for (const end = Date.now() + ms; Date.now() < end; await new Promise(r => setTimeout(r, 100))) if (await run(expr)) return
    fail(`${what} (waited ${ms / 1000} s)`)
  }
  // The dock waits to be asked for: until then the design runs live, nothing is recorded and nothing
  // sits under it; the bar offers it. Asked for, it shows under the design and records a take.
  // (The bar offers it as soon as the page has the design; the take waits for the artboard's frame.)
  await until(`!!document.querySelector('[data-bar] [data-act=motion]') && !!window.__protoMotion?.state()`, 'the bar offers no Motion for a design with motion')
  const rest = await run(`[document.querySelector('[data-motion-dock]').hidden, window.__protoMotion?.state()?.status, getComputedStyle(document.querySelector('[data-zone]')).getPropertyValue('--dock-h').trim()]`)
  if (!rest[0] || rest[1] !== 'off' || rest[2] !== '0px') fail(`before it's asked for, the motion dock should be hidden, with no take and no room: ${JSON.stringify(rest)}`)
  await run(`document.querySelector('[data-bar] [data-act=motion]').click()`)
  await until(`window.__protoMotion?.state()?.status === 'ready'`, 'the motion dock never recorded a take of move/A')
  const dock = await run(`[!!document.querySelector('[data-motion-bar]'), parseFloat(getComputedStyle(document.querySelector('[data-zone]')).getPropertyValue('--dock-h'))]`)
  if (!dock[0] || !(dock[1] > 40)) fail(`move/A should have the motion dock under it, with the stage giving up its height: ${JSON.stringify(dock)}`)
  // A take from rest: the panel from 0 to 400 ms, the rows 100, 200 and 300 ms in, as one stagger.
  const take = await run('window.__protoMotion.take()')
  const panel = take.parts?.find(p => p.shoot === 'panel'), rows = (take.parts || []).filter(p => p.shoot === 'row').map(p => p.start)
  if (!near(panel?.start, 0, 50) || !near(panel?.end, 400, 50) || rows.length !== 3 || !rows.every((t, i) => near(t, 100 + 100 * i, 50)) || !near(take.duration, 500, 50)) fail(`the take's parts are off: ${JSON.stringify(take)}`)
  if (!take.tracks?.some(t => t.name === 'Row ×3')) fail(`the three rows should be one staggered group in the curves: ${JSON.stringify(take.tracks)}`)
  // Scrubbing sets the design to that moment: the panel halfway at 200 ms, the second row a quarter in at 250.
  const at = t => run(`window.__protoMotion.seek(${t}).then(() => [new DOMMatrix(getComputedStyle(__D().querySelector('[data-shoot=panel]')).transform).m42, +getComputedStyle(__D().querySelectorAll('[data-shoot=row]')[1]).opacity])`)
  const [y200] = await at(200), [, o250] = await at(250), [y0, o0] = await at(0)
  if (!near(y200, 50, 2) || !near(o250, 0.25, 0.05) || !near(y0, 100, 2) || !near(o0, 0, 0.01)) fail(`scrubbing didn't set the design: at 200 ms the panel is ${y200}px down (50), at 250 the row's opacity ${o250} (0.25), at 0 ${y0}px and ${o0}`)
  // A comment on the range 0.10–0.30 s, drawn on the track and written in the page's own composer.
  const D = (await run('window.__protoMotion.state()')).duration
  await run(`document.querySelector('[data-motion=mode-range]').click()`)
  await run(`(async () => {
    const track = document.querySelector('[data-motion=track]'), r = track.getBoundingClientRect(), y = r.top + r.height / 2
    const x = t => r.left + 12 + (t / ${D}) * (r.width - 24)
    const fire = (type, t) => track.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x(t), clientY: y, button: 0, pointerId: 1, pointerType: 'mouse', isPrimary: true }))
    fire('pointerdown', 100); fire('pointermove', 200); fire('pointermove', 300); fire('pointerup', 300)
    await new Promise(r => setTimeout(r, 100))
    document.querySelector('[data-motion=compose]').click()
    await new Promise(r => setTimeout(r, 300))
    const ed = document.querySelector('[data-composer] [role=textbox]')
    ed.textContent = 'The rows come in too late'
    ed.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 100))
    ;[...document.querySelectorAll('[data-composer] button')].find(b => /Add/.test(b.textContent)).click()
    await new Promise(r => setTimeout(r, 200))
    document.querySelector('[data-shoot=send]').click()
  })()`)
  await until(`document.querySelector('[data-motion-bar] [data-point]')?.dataset.state === 'sent'`, 'the comment on the range never showed as sent on the track')
  const heard = proto(['inbox'])
  if (!/The rows come in too late\n {3}at: 0\.10–0\.30 s of the motion \(its take is 0\.50 s\): see it with proto shoot move\/A --frames 8 --at 100-300/.test(heard)) fail(`proto inbox should print the range as at: 0.10–0.30 s, with the shoot that shows it: ${heard}`)
  proto(['reply', `${heard.match(/^batch (\S+)/m)[1]}/1`, 'Rows start at 40 ms apart now', '--done'])
  await until(`document.querySelector('[data-motion-bar] [data-point]')?.dataset.state === 'done'`, 'the reply never reached the comment\'s point on the track')
  // Tapping the point loops its range and shows the comment with the reply.
  await run(`document.querySelector('[data-motion-bar] [data-point]').click()`)
  const shown = `(() => { const t = document.querySelector('[data-motion-bar] [data-thread]'); return !!t && !t.closest('[inert]') && /Rows start at 40 ms apart now/.test(t.textContent) })()`
  await until(`window.__protoMotion.state().playing && window.__protoMotion.state().span?.join() === '100,300' && ${shown}`, 'tapping the point should loop 0.10–0.30 s and show the reply', 5000)
  // Pausing it is a press in the dock, which keeps the comment open.
  await run(`(() => { const b = document.querySelector('[data-motion=play]'); b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 1, pointerType: 'mouse', isPrimary: true })); b.click() })()`)
  await until(`!window.__protoMotion.state().playing && ${shown}`, 'pausing the loop put the comment on the motion away', 3000)
  // A moment, posted as the page does; one outside the take, or a range that ends before it starts, is refused.
  // A time also needs a variant, and goes with no action and no point.
  for (const bad of [{ at: 600, take: 500 }, { at: 300, to: 100, take: 500 }, { at: 'x', take: 500 }, { at: 100 }, { route: 'move', at: 100, take: 500 }, { action: 'more', at: 100, take: 500 }, { point: { x: 1, y: 1 }, at: 100, take: 500 }]) {
    if ((await postJson('comments', { comments: [{ route: 'move/A', text: 'x', ...bad }] })).status !== 400) fail(`a comment with ${JSON.stringify(bad)} was accepted`)
  }
  await send([{ route: 'move/A', text: 'Hold the panel longer', at: 350, take: 500 }])
  if (!/^ {3}at: 0\.35 s of the motion \(its take is 0\.50 s\): see it with proto shoot move\/A --at 350$/m.test(proto(['inbox']))) fail('proto inbox should print a moment as at: 0.35 s')
  // The composer's @ menu, in the dock, opens over the page, whole: the dock doesn't cut it off.
  const tagMenu = await run(`(async () => {
    document.querySelector('[data-motion=compose]').click()
    await new Promise(r => setTimeout(r, 500))
    const ed = document.querySelector('[data-motion-bar] [data-composer] [role=textbox]')
    if (!ed) return 'the dock opened no composer'
    ed.focus()
    document.execCommand('insertText', false, '@')
    await new Promise(r => setTimeout(r, 300))
    const composer = document.querySelector('[data-motion-bar] [data-composer]')
    const said = !document.querySelector('[data-tag-menu]') && composer?.classList.contains('opacity-60') ? 'ok' : '@ should start visual tagging without a named-element menu'
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    ed.textContent = ''
    ed.dispatchEvent(new Event('input', { bubbles: true }))
    document.querySelector('[data-motion=compose]').click()
    return said
  })()`)
  if (tagMenu !== 'ok') fail(`the @ menu in the dock's composer: ${tagMenu}`)
  // Focus mode: the dock hides and lets the design go (it plays live); it comes back as it was.
  await run(`document.querySelector('[data-motion=curves]').click()`)
  await run(`document.querySelector('[data-act=focus]').click()`)
  await until(`window.__protoMotion.state().live && getComputedStyle(document.querySelector('[data-zone]')).getPropertyValue('--dock-h').trim() === '0px' && document.querySelector('[data-motion-dock]').hidden`, 'focus mode should hide the dock and let the design go', 5000)
  await run(`document.querySelector('[data-act=unfocus]').click()`)
  await until(`parseFloat(getComputedStyle(document.querySelector('[data-zone]')).getPropertyValue('--dock-h')) > 40 && document.querySelector('[data-motion=curves]')?.getAttribute('aria-pressed') === 'true'`, 'after focus mode the dock should come back as it was (curves on)', 5000)
  // One property moved twice: the toast fades in over 0-300 ms (and out from about 700), and at
  // each moment it shows that moment, not the later fade's first frame.
  const design = (route, sel) => run(`(async () => {
    location.hash = '#/${route}'
    for (let i = 0; i < 100 && !__D().querySelector('[data-layers] ${sel}'); i++) await new Promise(r => setTimeout(r, 100))
    // It declares its motion (useMotion, in an effect) a moment after it renders, on a slow runner later.
    for (let i = 0; i < 100 && !window.__protoMotion.state(); i++) await new Promise(r => setTimeout(r, 100))
    for (let i = 0; i < 100 && window.__protoMotion.state()?.status === 'taking'; i++) await new Promise(r => setTimeout(r, 100))
    return window.__protoMotion.take()
  })()`)
  const value = (sel, read, t) => run(`window.__protoMotion.seek(${t}).then(() => { const cs = getComputedStyle(__D().querySelector('[data-layers] ${sel}')); return ${read} })`)
  const twice = await design('move/C', '[data-shoot=toast]')
  if (twice.parts?.filter(p => p.shoot === 'toast').length !== 2) fail(`move/C's take should have the toast's two fades: ${JSON.stringify(twice)}`)
  const fades = [await value('[data-shoot=toast]', '+cs.opacity', 0), await value('[data-shoot=toast]', '+cs.opacity', 150), await value('[data-shoot=toast]', '+cs.opacity', 300)]
  if (!near(fades[0], 0, 0.05) || !near(fades[1], 0.5, 0.1) || !near(fades[2], 1, 0.05)) fail(`the toast fading in, then out, should read 0, 0.5 and 1 at 0, 150 and 300 ms: ${fades}`)
  const chained = await design('move/D', '[data-shoot=box]')
  if (chained.parts?.length !== 2) fail(`move/D's take should have both of the box's moves: ${JSON.stringify(chained)}`)
  const moves = [await value('[data-shoot=box]', 'new DOMMatrix(cs.transform).m41', 0), await value('[data-shoot=box]', 'new DOMMatrix(cs.transform).m41', 150), await value('[data-shoot=box]', 'new DOMMatrix(cs.transform).m41', 450)]
  if (!near(moves[0], 0, 3) || !near(moves[1], 50, 5) || !near(moves[2], 150, 5)) fail(`the box moved twice by element.animate should be at 0, 50 and 150 px at 0, 150 and 450 ms: ${moves}`)
  // Taken again and again, a take is still the one move: the last takes' animations, filling
  // forwards, aren't part of it, and they don't pile up on the element.
  await design('move/G', '[data-shoot=slide]')
  await run('window.__protoMotion.take()')
  await run('window.__protoMotion.take()')
  const again = await run('window.__protoMotion.take()')
  if (again.parts?.length !== 1 || !near(again.duration, 300, 40)) fail(`a fourth take should be the one move, 0.30 s: ${JSON.stringify(again)}`)
  const piled = await run(`__D().querySelector('[data-layers] [data-shoot=slide]').getAnimations().length`)
  if (piled > 2) fail(`four takes left ${piled} animations on the element`)
  // A transition, then a CSS animation (H) or element.animate() (I) on the same property: at each
  // moment the part moving then shows, whichever the browser draws on top.
  for (const [v, sel, read, want, by] of [['H', '[data-shoot=fade]', '+cs.opacity', [0.5, 0.6, 0.2], 0.06], ['I', '[data-shoot=slide]', 'new DOMMatrix(cs.transform).m41', [50, 150, 200], 6]]) {
    const tk = await design(`move/${v}`, sel)
    const second = tk.parts?.[1]?.start
    if (tk.parts?.length !== 2 || !(second > 300)) fail(`move/${v}'s take should have the transition, then the second move: ${JSON.stringify(tk)}`)
    const got = [await value(sel, read, 150), await value(sel, read, second + 250), await value(sel, read, tk.duration)]
    if (!got.every((g, i) => near(g, want[i], by))) fail(`move/${v} should read ${want} at 150 ms, halfway through its second move and at the end: ${got}`)
  }
  // A keyframe animation a class swap replaces: both are in the take, and its 0 is the start.
  const swap = await design('move/J', '[data-shoot=note]')
  const notes = (swap.parts || []).filter(p => p.shoot === 'note')
  if (notes.length !== 2) fail(`move/J's take should have the enter and the exit that replaced it: ${JSON.stringify(swap)}`)
  const ops = [await value('[data-shoot=note]', '+cs.opacity', 0), await value('[data-shoot=note]', '+cs.opacity', 150), await value('[data-shoot=note]', '+cs.opacity', notes[1].start + 150), await value('[data-shoot=note]', '+cs.opacity', swap.duration)]
  if (!ops.every((o, i) => near(o, [0, 0.5, 0.5, 0][i], 0.06))) fail(`the note entering, then leaving by a class swap, should read 0, 0.5, 0.5 and 0: ${ops}`)
  // A part the browser cancelled shows nothing from then on: the enter that the nudge's class swap
  // cancelled doesn't cover the nudge (it set opacity too), and the slide cancelled with nothing in
  // its place is back at 0, also where the take ends (where the dock rests and --at shoots).
  const nudged = await design('move/K', '[data-shoot=sheet]')
  const nudge = nudged.parts?.find(p => p.prop === 'k-nudge')
  if (nudged.parts?.length !== 2 || !nudge) fail(`move/K's take should have the enter and the nudge: ${JSON.stringify(nudged)}`)
  const ys = [await value('[data-shoot=sheet]', 'new DOMMatrix(cs.transform).m42', 150), await value('[data-shoot=sheet]', 'new DOMMatrix(cs.transform).m42', nudge.start + 100), await value('[data-shoot=sheet]', 'new DOMMatrix(cs.transform).m42', nudge.start + 200), await value('[data-shoot=sheet]', '+cs.opacity', nudge.start + 100)]
  if (!ys.every((y, i) => near(y, [50, -20, -40, 1][i], i === 3 ? 0.05 : 4))) fail(`the sheet entering, then nudged, should be at 50, -20 and -40 px (opacity 1 while nudged): ${ys}`)
  const cancelled = await design('move/L', '[data-shoot=slide]')
  const slid = cancelled.parts?.find(p => p.shoot === 'slide')
  if (!slid || !near(slid.end, 400, 120) || !(cancelled.duration > 800)) fail(`move/L's slide should end where it was cancelled, 0.4 s into a 1 s take: ${JSON.stringify(cancelled)}`)
  const xs = [await value('[data-shoot=slide]', 'new DOMMatrix(cs.transform).m41', 200), await value('[data-shoot=slide]', 'new DOMMatrix(cs.transform).m41', 800), await value('[data-shoot=slide]', 'new DOMMatrix(cs.transform).m41', cancelled.duration)]
  if (!near(xs[0], 40, 6) || !near(xs[1], 0, 1) || !near(xs[2], 0, 1)) fail(`the slide cancelled at 0.4 s should be at 40 px at 0.2 s, then back at 0 (0.8 s and the end): ${xs}`)
  // A shake added to a slide: each moment shows both.
  const shaken = await design('move/M', '[data-shoot=box]')
  if (shaken.parts?.length !== 2) fail(`move/M's take should have the slide and the shake: ${JSON.stringify(shaken)}`)
  const sx = [await value('[data-shoot=box]', 'new DOMMatrix(cs.transform).m41', 150), await value('[data-shoot=box]', 'new DOMMatrix(cs.transform).m41', 375), await value('[data-shoot=box]', 'new DOMMatrix(cs.transform).m41', 450), await value('[data-shoot=box]', 'new DOMMatrix(cs.transform).m41', shaken.duration)]
  if (!sx.every((x, i) => near(x, [50, 120, 140, 100][i], 5))) fail(`the slide with a shake added should be at 50, 120, 140 and 100 px at 150, 375, 450 ms and the end: ${sx}`)
  // Played backwards: 0.4 s, from 100 px back to 0. A negative delay starts at the take's 0, as its
  // curve does (so Go to lists no time before 0).
  const reversed = await design('move/N', '[data-shoot=back]')
  if (!near(reversed.duration, 400, 40) || !reversed.parts?.every(p => p.start >= 0) || !reversed.tracks?.every(t => t.start >= 0)) fail(`move/N's take should be 0.40 s, nothing in it before 0: ${JSON.stringify(reversed)}`)
  const bx = [await value('[data-shoot=back]', 'new DOMMatrix(cs.transform).m41', 0), await value('[data-shoot=back]', 'new DOMMatrix(cs.transform).m41', 200), await value('[data-shoot=back]', 'new DOMMatrix(cs.transform).m41', 400)]
  if (!bx.every((x, i) => near(x, [100, 50, 0][i], 6))) fail(`the box played backwards should be at 100, 50 and 0 px at 0, 200 and 400 ms: ${bx}`)
  const firsts = await run(`window.__protoMotion.curves().tracks.flatMap(t => t.lines.map(l => l[0][0]))`)
  if (!firsts.length || !firsts.every(t => t >= 0)) fail(`no curve should start before 0: ${firsts}`)
  // Held again after it ran live (focus mode lets it go), a take's dropped animation is still
  // cancelled when it is let go: takes don't pile animations up on the element.
  await design('move/P', '[data-shoot=box]')
  for (let i = 0; i < 4; i++) {
    await run('window.__protoMotion.take()')
    await run(`document.querySelector('[data-act=focus]').click()`)
    await until(`window.__protoMotion.state().live`, 'focus mode should let move/P go', 5000)
    await run(`document.querySelector('[data-act=unfocus]').click()`)
    await until(`!document.querySelector('[data-act=unfocus]') && !document.querySelector('[data-motion-dock]').hidden`, 'the dock should come back after focus mode', 5000)
    await run('window.__protoMotion.seek(100)')
  }
  await run('window.__protoMotion.take()')
  const left = await run(`__D().querySelector('[data-layers] [data-shoot=box]').getAnimations().length`)
  if (left > 2) fail(`five takes of move/P, let go and held again between them, left ${left} animations on the element`)
  // A sheet rendered on <body> through a portal: the take has it, it scrubs, and a press on it lets
  // the design go (as one inside the stage does).
  const portaled = await design('move/Q', '[data-shoot=label]')
  if (portaled.parts?.length !== 1 || portaled.parts[0].shoot !== 'sheet' || !near(portaled.duration, 400, 40)) fail(`move/Q's take should have the sheet it renders on <body>, 0.40 s: ${JSON.stringify(portaled)}`)
  const onBody = t => run(`window.__protoMotion.seek(${t}).then(() => new DOMMatrix(getComputedStyle(__D().querySelector('body > [data-shoot=sheet]')).transform).m42)`)
  const qy = [await onBody(0), await onBody(200), await onBody(400)]
  if (!qy.every((y, i) => near(y, [300, 150, 0][i], 6))) fail(`the sheet on <body> should be at 300, 150 and 0 px at 0, 200 and 400 ms: ${qy}`)
  const [px, py] = await run(`(() => { const r = __R(__D().querySelector('body > [data-shoot=sheet]')); return [r.x + r.width / 2, r.y + r.height / 2] })()`)
  await motionPage.press(px, py)
  await until(`window.__protoMotion.state().live`, 'a press on the sheet the design renders on <body> should let it go', 3000)
  // Held again, the sheet closed from the keyboard (Enter on its Close) lets it go and runs its exit.
  await run('window.__protoMotion.seek(100)')
  await run(`__D().querySelector('body > [data-shoot=sheet] [data-shoot=close]').focus()`)
  await motionPage.enter()
  const exit = await run(`__D().querySelector('body > [data-shoot=sheet]').getAnimations().filter(a => a.playState === 'running').map(a => a.transitionProperty).join()`)
  if (exit !== 'transform' || !await run('window.__protoMotion.state().live')) fail(`the held sheet closed by Enter on its Close should let the design go and run its exit transition: ${exit || 'none'}`)
  // A change inside the sheet while the design runs live (Next, to its second step) makes the
  // dock's next move take it again, as a change in the stage does.
  await run('window.__protoMotion.seek(400)')
  const starts = await run('__D().defaultView.__starts')
  const [nx, ny] = await run(`(() => { const r = __R(__D().querySelector('body > [data-shoot=sheet] [data-shoot=next]')); return [r.x + r.width / 2, r.y + r.height / 2] })()`)
  await motionPage.press(nx, ny)
  await until(`window.__protoMotion.state().live && __D().querySelector('[data-shoot=step]')?.textContent === 'Step 2'`, 'Next in the sheet on <body> should let the design go to its second step', 3000)
  await run('window.__protoMotion.seek(100)')
  if (!(await run('__D().defaultView.__starts') > starts)) fail(`after the sheet on <body> went to its second step, the dock's next move should take the design again (it held the old take)`)
  // A start() that throws: the take is empty and says why, and the dock isn't left recording.
  await run(`location.hash = '#/move/E'`)
  await until(`window.__protoMotion.state()?.status === 'empty' && /boom/.test(window.__protoMotion.state().error) && /start\\(\\) threw Error: boom/.test(document.querySelector('[data-motion=error]')?.textContent)`, 'a start() that throws should end the take with its error in the dock')
  // A step a timer starts 1.2 s in, after the take has ended: the dock says it was missed, though
  // it only turns a button green (a color is only taken for hover or focus right after a move).
  await run(`location.hash = '#/move/F'`)
  await until(`(() => { const s = window.__protoMotion.state(); return s?.status === 'ready' && s.late > 800 && s.late < 1600 && !!document.querySelector('[data-motion=late]') })()`, 'a step started after the take ended should be named in the dock')
  await run(`document.querySelector('[data-motion=late-close]').click()`)
  await until(`window.__protoMotion.state().late === null && !document.querySelector('[data-motion=late]')`, 'the note about a missed step should go when dismissed', 3000)
  // No useMotion, no dock, and the stage has its full height back.
  await run(`location.hash = '#/move/B'`)
  await until(`!document.querySelector('[data-motion-bar]') && getComputedStyle(document.querySelector('[data-zone]')).getPropertyValue('--dock-h').trim() === '0px'`, 'move/B declares no motion but has a dock', 5000)
} finally { motionPage.close() }
// The same take headlessly: one moment of it, and frames of it on one sheet, each frame its own.
proto(['shoot', 'move/A', '--at', '200'])
for (const want of ['move-A-desktop-at-200.png', 'move-A-mobile-at-200.png']) if (!pngs(shots).includes(want)) fail(`proto shoot --at 200 wrote no ${want}`)
const strip = proto(['shoot', 'move/A', '--frames', '4'])
if (!pngs(shots).includes('move-A-frames.png') || !/^4 frames in /m.test(strip)) fail(`proto shoot --frames 4 wrote no move-A-frames.png: ${strip}`)
const frame = t => readFileSync(join(shots, `move-A-desktop-at-${t}.png`))
if (frame(0).equals(frame(500)) || frame(167).equals(frame(333))) fail('the frames of the take are the same picture')
if (!/no motion|declares no motion/.test(proto(['shoot', 'move/B', '--at', '100'], { ok: false }))) fail('proto shoot --at on a design without useMotion should say it has no motion')
if (!/start\(\) threw Error: boom/.test(proto(['shoot', 'move/E', '--at', '100'], { ok: false }))) fail('proto shoot --at should print the error a start() threw')
// Frames across a property moved twice differ, frame to frame: also the nudge after a cancelled
// enter, a shake added to a slide, and a sheet on <body>.
for (const [v, a, b] of [['C', 0, 300], ['D', 0, 300], ['H', 0, 300], ['I', 0, 300], ['J', 0, 300], ['K', 400, 600], ['M', 300, 450], ['Q', 0, 400]]) {
  const out = proto(['shoot', `move/${v}`, '--frames', '3', '--at', `${a}-${b}`])
  // A take is timed from its first part, and a slow first frame on a slow runner (macOS CI) starts
  // that late while start()'s own timers don't: K's nudge, 400 ms after start(), lands sooner and its
  // take comes out 500 or 550 ms, not 600. proto shoot then holds the range at the take's end and
  // names the frames by it, so they are read where it put them.
  const end = Math.min(b, Number(out.match(/its take is (\d+) ms/)?.[1] ?? b)), mid = Math.round((a + end) / 2)
  const f = t => readFileSync(join(shots, `move-${v}-desktop-at-${t}.png`))
  if (f(a).equals(f(mid)) || f(mid).equals(f(end))) fail(`the frames of move/${v} from ${a} to ${end} ms are the same picture`)
}
proto(['shoot', 'move', '--frames', '4'], { ok: false })
// The build drops the dock: the handoff lists useMotion as the page's own.
if (!/## Motion review\n- \[ \] Its motion dock \(`useMotion`\) · A\.tsx:5\b/.test(proto(['handoff', 'move/A']))) fail('proto handoff should list useMotion under Motion review')

// A right-to-left variant: physical sides are listed, while sides chosen per direction,
// centring and logical sides are not.
writeFileSync(join(app, 'src', 'protos', 'phone', 'A.tsx'), [
  'export default function A() {',
  '  return <div dir="rtl" className="h-full ps-4">',
  '    <p className="ml-3 text-start">שלום</p>',
  '    <span className="absolute left-1/2 -translate-x-1/2 rtl:-scale-x-100 ltr:bg-linear-to-r rtl:bg-linear-to-l">‹</span>',
  '    <span style={{ paddingRight: 8 }}>0/10</span>',
  '    <div dir="ltr" className="relative">',
  '      <span className="absolute left-2">11:35</span>',
  '    </div>',
  '  </div>',
  '}',
].join('\n'))
const rtl = proto(['shoot', 'phone/A'])
if (!/A\.tsx:3 +ml-3/.test(rtl)) fail('the rtl check did not list ml-3')
if (!/A\.tsx:5 +paddingRight:/.test(rtl)) fail('the rtl check did not list paddingRight')
if (/A\.tsx:[2467] /.test(rtl)) fail('the rtl check listed a logical side, centring, a per-direction class or an LTR island')
// A phone prototype's variant is shot at phone size only.
if (!pngs(shots).includes('phone-A-mobile.png') || pngs(shots).includes('phone-A-desktop.png')) fail('a phone variant should be shot at phone size only')

// Copy options: a variant that declares them (useCopy, from the app's own src/copy.ts) gets a T
// button with its count, here from two components that each declare lines; copy mode marks its
// lines, a pick puts the words in place, and Send posts one comment per changed line with action
// copy, on the line's element and where it is written. Claude's reply reaches the bar. What was
// sent survives a reload (nothing goes twice), and so does a way back to today's words, which can
// be sent too. A component that unmounts while copy mode is on takes its lines with it, and
// commenting still works. A variant that declares none has no T button.
if (!existsSync(join(app, 'src', 'copy.ts'))) fail('the app has no src/copy.ts')
proto(['add', 'words', '--title', 'Words', '--variants', 'A:Options,B:Plain'])
writeFileSync(join(app, 'src', 'protos', 'words', 'parts.tsx'), [
  'import { useCopy } from \'../../copy\'',
  'export const Path = () => <code>src/*.ts</code>',
  'export function Go() {',
  '  const copy = useCopy([',
  '    // the user\'s button',
  '    { id: \'go\', label: \'Button\', options: [\'Let\\\'s go\', \'Hi {name}, go [now]\'] }, // isn\'t it',
  '    { id: \'note\', label: \'Note\', options: [\'Free\', \'No fee\'] },',
  '  ])',
  '  return <div>',
  '    <button data-copy="go" className="mt-4 rounded-lg bg-zinc-900 px-4 py-2 text-white">{copy.go}</button>',
  '    <p data-copy="note">{copy.note}</p>',
  '  </div>',
  '}',
].join('\n'))
writeFileSync(join(app, 'src', 'protos', 'words', 'A.tsx'), [
  'import { useState } from \'react\'',
  'import { useCopy } from \'../../copy\'',
  'import { Go } from \'./parts\'',
  'export default function A() {',
  '  const [go, setGo] = useState(true)',
  '  const copy = useCopy([',
  '    { id: \'title\', label: \'Title\', options: [\'Save more\', \'Pay less\', \'Keep more\'] },',
  '  ])',
  '  return <div className="h-full p-8">',
  '    <h1 data-copy="title" className="text-2xl">{copy.title}</h1>',
  '    <button data-hide-go onClick={() => setGo(false)}>Hide the button</button>',
  '    {go && <Go />}',
  '  </div>',
  '}',
].join('\n'))
writeFileSync(join(app, 'src', 'protos', 'words', 'B.tsx'), 'export default function B() {\n  return <h1 className="p-8 text-2xl">Save more</h1>\n}\n')
const plain = await inPage(`${local}?theme=light#/words/B`, 'new Promise(r => setTimeout(r, 800)).then(() => document.querySelectorAll("[data-act=copymode]").length)')
if (plain !== 0) fail(`a variant without copy options shows ${plain} T buttons`)
const words = await openPage(`${local}?theme=light#/words/A`).catch(e => fail(`copy options in the page: ${e.message}`))
// With HELPERS: __D, the design's document (the artboard's frame on a wide page).
const until = `${HELPERS}; const until = async (f, ms = 4000) => { for (const end = Date.now() + ms; Date.now() < end; await new Promise(r => setTimeout(r, 50))) { const v = f(); if (v) return v } return null }`
// Chooses a row of the pill's menu on a phone (copy options, Try it, Motion, a size).
// The menu lists what the design has declared when it opens; one opened before the design declared
// it is closed and opened again.
const viaMenu = act => `{
    let row = null
    for (let i = 0; i < 6 && !row; i++) {
      const m = await until(() => document.querySelector('[data-pill] [data-pill-menu=""]'))
      if (!m) return 'the pill has no menu'
      m.click()
      row = await until(() => document.querySelector('[data-menu-card] [data-act="${act}"]'), 1500)
      if (!row) { document.querySelector('[data-scale-backdrop]')?.click(); await until(() => !document.querySelector('[data-menu-card]'), 2000) }
    }
    if (!row) return 'the menu has no ${act}: ' + [...document.querySelectorAll('[data-menu-card] [data-act]')].map(b => b.dataset.act).join(' ')
    row.click()
    if (!await until(() => !document.querySelector('[data-menu-card]'), 3000)) return 'choosing ${act} should fold the menu back'
  }`
// Turns copy mode on (after a reload it starts off).
const copyOn = `{
    const t = await until(() => document.querySelector('[data-bar] [data-act=copymode]'))
    if (!t) return 'no T button'
    if (t.getAttribute('aria-pressed') !== 'true') t.click()
  }`
// Clicks a line's mark, then its option i (0 is today's words); the line should then read words.
const pick = (id, i, words) => `
    const mark = await until(() => document.querySelector('[data-copy-mark=${id}]'))
    if (!mark) return 'copy mode marked no ${id} line'
    mark.click()
    const option = await until(() => document.querySelector('[data-copy-list] [data-copy-option="${i}"]'))
    if (!option) return 'clicking the ${id} line listed no options'
    option.click()
    const line = () => __D().querySelector('[data-mount] [data-copy=${id}]')?.textContent
    if (!await until(() => line() === '${words}')) return 'the ${id} line should read ${words}, reads ' + line()`
const sendOne = `
    const send = await until(() => document.querySelector('[data-shoot=send-copy]:not([disabled])'))
    if (!send || !/Send 1 choice/.test(send.textContent)) return 'no Send 1 choice: ' + send?.textContent
    send.click()
    if (!await until(() => /Sent/.test(document.querySelector('[data-shoot=send-copy]')?.textContent ?? ''))) return 'the bar never said Sent'`
const reload = async () => {
  await words.run('setTimeout(() => location.reload(), 0), 1')
  await new Promise(r => setTimeout(r, 500))
  for (let i = 0; i < 100 && !await words.run('document.documentElement.dataset.ready === "1"', 2000).catch(() => false); i++) await new Promise(r => setTimeout(r, 100))
}
try {
  const step = await words.run(`(async () => {
    ${until}
    const t = await until(() => document.querySelector('[data-bar] [data-act=copymode]'))
    if (!t || t.title !== 'Copy options for 3 lines' || t.textContent.trim() !== '3') return 'the T button should say 3 lines, from both components: ' + (t ? t.title + ' / ' + t.textContent : 'none')
    ${copyOn}
    ${pick('title', 1, 'Pay less')}
    ${sendOne}
    return 'ok'
  })()`)
  if (step !== 'ok') fail(`copy options in the page: ${step}`)
  const told = proto(['inbox'])
  if (!/^ {3}action: copy \(make this the line's text/m.test(told) || !/“Pay less”, option 2 of 3/.test(told)) fail(`proto inbox should print the copy choice with action: copy: ${told}`)
  if (!told.includes('src/protos/words/A.tsx:10 (A)')) fail(`the copy choice should be on the line's element, words/A.tsx:10: ${told}`)
  proto(['reply', told.match(/^batch (\S+)/m)[1], 'Title is now Pay less', '--done'])
  const replied = await words.run(`(async () => {
    for (const end = Date.now() + 5000; Date.now() < end; await new Promise(r => setTimeout(r, 100))) if (document.querySelector('[data-copy-bar]').innerText.includes('Title is now Pay less')) return true
    return document.querySelector('[data-copy-bar]').innerText
  })()`)
  if (replied !== true) fail(`Claude's reply never reached the copy bar: ${replied}`)
  // After a reload, what was sent is still sent: nothing to send again, and the reply is there.
  await reload()
  const kept = await words.run(`(async () => {
    ${until}
    ${copyOn}
    if (!await until(() => document.querySelector('[data-copy-bar]').innerText.includes('Title is now Pay less'))) return 'the reply is gone: ' + document.querySelector('[data-copy-bar]').innerText
    if (document.querySelector('[data-shoot=send-copy]:not([disabled])')) return 'after a reload the sent line is offered again'
    return 'ok'
  })()`)
  if (kept !== 'ok') fail(`what was sent, after a reload: ${kept}`)
  // Back to today's words after the send is a change to send as well, and a reload keeps it.
  const back = await words.run(`(async () => {
    ${until}
    ${pick('title', 0, 'Save more')}
    return 'ok'
  })()`)
  if (back !== 'ok') fail(`going back to today's words after a send: ${back}`)
  // Claude's edit for the first send lands before the way back is sent: Pay less comes first, and
  // the line still reads Save more, there to send.
  const aFile = join(app, 'src', 'protos', 'words', 'A.tsx')
  writeFileSync(aFile, readFileSync(aFile, 'utf8').replace("['Save more', 'Pay less', 'Keep more']", "['Pay less', 'Save more', 'Keep more']"))
  const reordered = await words.run(`(async () => {
    ${until}
    document.querySelector('[data-copy-mark=title]').click()
    if (!await until(() => document.querySelector('[data-copy-list] [data-copy-option="0"]')?.textContent.includes('Pay less'), 8000)) return 'the edit never reached the page'
    document.querySelector('[data-copy-mark=title]').click()
    const line = () => __D().querySelector('[data-mount] [data-copy=title]')?.textContent
    if (!await until(() => line() === 'Save more')) return 'the line should still read Save more, reads ' + line()
    if (!await until(() => document.querySelector('[data-shoot=send-copy]:not([disabled])'))) return 'the way back is not there to send'
    return 'ok'
  })()`)
  if (reordered !== 'ok') fail(`the way back to today's words, once Claude's edit for the earlier words lands: ${reordered}`)
  await reload()
  const backSent = await words.run(`(async () => {
    ${until}
    ${copyOn}
    ${sendOne}
    return 'ok'
  })()`)
  if (backSent !== 'ok') fail(`the way back to today's words, after a reload: ${backSent}`)
  const toldBack = proto(['inbox'])
  if (!/“Save more”, back to the words it had \(option 2 of 3\)/.test(toldBack)) fail(`proto inbox should print the way back to today's words: ${toldBack}`)
  // A way back that never went: Keep more is sent and Claude is done with it without an edit, the
  // user goes back to today's words, and copy mode closes. Nothing was sent to go back from, so when
  // Claude later puts Keep more first, the line reads it, unchanged, with nothing to send.
  const keepSent = await words.run(`(async () => {
    ${until}
    ${pick('title', 2, 'Keep more')}
    ${sendOne}
    return 'ok'
  })()`)
  if (keepSent !== 'ok') fail(`sending Keep more: ${keepSent}`)
  proto(['reply', proto(['inbox']).match(/^batch (\S+)/m)[1], 'Title is now Keep more', '--done'])
  const closed = await words.run(`(async () => {
    ${until}
    if (!await until(() => document.querySelector('[data-copy-bar]').innerText.includes('Title is now Keep more'), 5000)) return 'the reply never reached the bar'
    ${pick('title', 0, 'Pay less')}
    document.querySelector('[data-bar] [data-act=copymode]').click()
    return 'ok'
  })()`)
  if (closed !== 'ok') fail(`a way back that never went: ${closed}`)
  writeFileSync(aFile, readFileSync(aFile, 'utf8').replace("['Pay less', 'Save more', 'Keep more']", "['Keep more', 'Pay less', 'Save more']"))
  const unsent = await words.run(`(async () => {
    ${until}
    const line = () => __D().querySelector('[data-mount] [data-copy=title]')?.textContent
    const t = () => document.querySelector('[data-bar] [data-act=copymode]')
    if (!await until(() => line() === 'Keep more', 8000)) return 'the line should read Keep more once it is first, reads ' + line() + ' (' + t()?.title + ')'
    if (t().title !== 'Copy options for 3 lines') return 'nothing should be changed: ' + t().title
    t().click()
    if (!await until(() => /Click a marked line/.test(document.querySelector('[data-copy-bar]').innerText))) return 'the bar should have nothing to send: ' + document.querySelector('[data-copy-bar]').innerText
    return 'ok'
  })()`)
  if (unsent !== 'ok') fail(`a way back that never went, once Claude reorders the line: ${unsent}`)
  // A component that declared lines unmounts while copy mode is on: its lines go, the rest stay
  // marked (also after closing and opening copy mode again), and ⌥-click still opens a comment.
  const gone = await words.run(`(async () => {
    ${until}
    __D().querySelector('[data-mount] [data-hide-go]').click()
    if (!await until(() => !document.querySelector('[data-copy-mark=go], [data-copy-mark=note]'))) return 'the hidden lines are still marked'
    const t = () => document.querySelector('[data-bar] [data-act=copymode]')
    t().click()
    if (!await until(() => /^Copy options for 1 line(,|$)/.test(t().title))) return 'the T button should say 1 line: ' + t().title
    t().click()
    if (!await until(() => document.querySelector('[data-copy-mark=title]'))) return 'copy mode marks nothing after it opens again'
    __D().querySelector('[data-mount] [data-hide-go]').dispatchEvent(new MouseEvent('click', { altKey: true, bubbles: true, cancelable: true }))
    if (!await until(() => document.querySelector('[data-composer]'))) return 'an option-click opened no comment'
    return 'ok'
  })()`)
  if (gone !== 'ok') fail(`a component with lines unmounting in copy mode: ${gone}`)
} finally { words.close() }
// The checklist names each line, whichever component declares it, whatever brackets, comments,
// escaped quotes or JSX words with a /* are around its words, and what the build ships; a shot in
// copy mode is the stage's own size.
const handed = proto(['handoff', 'words/A'])
if (!/^- \[ \] Title \(`title`\) ships "Keep more", not its 2 other options · A\.tsx:7$/m.test(handed)) fail('proto handoff did not list the Title line and what ships')
if (!/^- \[ \] Button \(`go`\) ships "Let's go", not its 1 other option · parts\.tsx:6$/m.test(handed)) fail('proto handoff did not list the Button line, after JSX words with src/*.ts, with a comment above it and brackets and an escaped quote in its words')
if (!/^- \[ \] Note \(`note`\) ships "Free", not its 1 other option · parts\.tsx:7$/m.test(handed)) fail('proto handoff did not list the Note line, after a comment with a quote')
proto(['shoot', 'words/A'])
proto(['shoot', 'words/A', '--copy'])
const sizeOf = f => { const h = readFileSync(join(shots, f)); return `${h.readUInt32BE(16)}x${h.readUInt32BE(20)}` }
if (!pngs(shots).includes('words-A-desktop-copy.png') || sizeOf('words-A-desktop-copy.png') !== sizeOf('words-A-desktop.png')) fail('proto shoot --copy should write words-A-desktop-copy.png at the size of words-A-desktop.png')
// A variant without copy options is shot as it is, named so, and says why.
const noCopy = proto(['shoot', 'words/B', '--copy'])
if (!/words\/B has no copy options/.test(noCopy) || pngs(shots).includes('words-B-desktop-copy.png') || !noCopy.includes('words-B-desktop.png')) fail(`proto shoot --copy on a variant without copy options should say so and name the shot words-B-desktop.png: ${noCopy}`)
if ((await postJson('comments', { comments: [{ route: 'words', text: 'x', action: 'copy' }] })).status !== 400) fail('a copy choice on no variant was accepted')

// Both bars at once: a variant with copy options and motion. With copy mode on, the copy bar sits
// over the motion dock, which keeps its place above the pill; the stage clears both, and neither
// covers the other. The dock shows once asked for (the bar's Motion, the menu's on a phone). On a
// 360 px phone the pill holds the menu, the variants and Comment, and the dock's buttons keep their
// size. There the menu's button is copy mode's way out while it's on, and Hide motion puts the dock
// away and lets the design go.
proto(['add', 'both', '--title', 'Both', '--variants', 'A:Words and motion'])
writeFileSync(join(app, 'src', 'protos', 'both', 'A.tsx'), `import { useState } from 'react'
import { useCopy } from '../../copy'
import { useMotion } from '../../motion'
export default function A() {
  const [open, setOpen] = useState(false)
  const copy = useCopy([{ id: 'title', label: 'Title', options: ['Your order', 'Ready to pay'] }])
  useMotion({ start: () => setOpen(true), reset: () => setOpen(false) })
  return <div className="h-full p-8">
    <h1 data-copy="title" className="text-2xl">{copy.title}</h1>
    <div data-shoot="sheet" style={{ height: 160, background: '#4f46e5', transform: open ? 'translateY(0px)' : 'translateY(80px)', opacity: open ? 1 : 0, transition: 'transform 400ms ease-out, opacity 300ms linear' }} />
  </div>
}
`)
const stacked = (motionOn, copyOn) => `(async () => {
    ${until}
    ${motionOn}
    if (!await until(() => window.__protoMotion?.state()?.status === 'ready', 15000)) return 'the motion dock recorded no take'
    ${copyOn}
    if (!await until(() => document.querySelector('[data-copy-bar]').offsetHeight > 0 && document.querySelector('[data-copy-mark=title]'))) return 'copy mode showed no bar'
    await new Promise(r => setTimeout(r, 300))
    const box = s => document.querySelector(s).getBoundingClientRect()
    const zone = box('[data-zone]'), layers = box('[data-layers]'), copyBar = box('[data-copy-bar]'), dock = box('[data-motion-dock]')
    const pill = document.querySelector('[data-pill] > div')?.getBoundingClientRect().height || 0
    const near = (a, b) => Math.abs(a - b) <= 1
    if (!(copyBar.height > 20 && dock.height > 40)) return 'both bars should show: copy bar ' + copyBar.height + ', dock ' + dock.height
    if (!near(dock.bottom, zone.bottom - pill)) return 'the dock should sit just above the pill: ' + dock.bottom + ' vs ' + (zone.bottom - pill)
    if (!near(copyBar.bottom, dock.top)) return 'the copy bar should sit on the dock: ' + copyBar.bottom + ' vs ' + dock.top
    if (!near(layers.bottom, copyBar.top)) return 'the stage should end at the copy bar: ' + layers.bottom + ' vs ' + copyBar.top
    if (layers.height < 200) return 'the stage kept ' + layers.height + ' px'
    // Copy mode marking its lines (an underline's transition) is no step the take missed.
    if (window.__protoMotion.state().late !== null) return 'turning copy mode on was taken for a missed step at ' + window.__protoMotion.state().late + ' ms'
    return 'ok'
  })()`
const deskBoth = await openPage(`${local}?theme=light#/both/A`)
try {
  const r = await deskBoth.run(stacked(`(await until(() => document.querySelector('[data-bar] [data-act=motion]')))?.click()`, copyOn))
  if (r !== 'ok') fail(`copy mode on a design with motion, desktop: ${r}`)
  // In copy mode a real press on a line opens its options over the moment held: the take isn't let go.
  await deskBoth.run('window.__protoMotion.seek(150)')
  const [lx, ly] = await deskBoth.run(`(() => { const r = document.querySelector('[data-layers] [data-copy=title]').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2] })()`)
  await deskBoth.press(lx, ly)
  const picked = await deskBoth.run(`(async () => {
    ${until}
    if (!await until(() => document.querySelector('[data-copy-list]'))) return 'the press opened no options list'
    const s = window.__protoMotion.state()
    document.body.click()
    return s.live || s.t !== 150 ? 'the press let the take go (live ' + s.live + ', at ' + s.t + ' ms)' : 'ok'
  })()`)
  if (picked !== 'ok') fail(`a press on a line in copy mode: ${picked}`)
  // Focus mode keeps the copy bar (copy mode was turned on) and hides the dock, letting the design go.
  const focused = await deskBoth.run(`(async () => {
    ${until}
    document.querySelector('[data-act=focus]').click()
    if (!await until(() => document.querySelector('[data-motion-dock]').hidden && window.__protoMotion.state().live)) return 'the dock should hide and let the design go'
    const bar = document.querySelector('[data-copy-bar]').getBoundingClientRect()
    if (!(bar.height > 20) || Math.abs(bar.bottom - innerHeight) > 1) return 'the copy bar should stay, at the bottom: ' + bar.height + ' px, bottom ' + bar.bottom
    document.querySelector('[data-act=unfocus]').click()
    if (!await until(() => !document.querySelector('[data-motion-dock]').hidden && document.querySelector('[data-copy-bar]').getBoundingClientRect().bottom <= document.querySelector('[data-motion-dock]').getBoundingClientRect().top + 1)) return 'after focus mode both bars should be back, stacked'
    return 'ok'
  })()`)
  if (focused !== 'ok') fail(`focus mode with copy mode on and motion: ${focused}`)
} finally { deskBoth.close() }
const phoneBoth = await openPage(`${local}?theme=light#/both/A`, { width: 360, height: 740, phone: true })
try {
  const r = await phoneBoth.run(stacked(viaMenu('motion'), viaMenu('copymode')))
  if (r !== 'ok') fail(`copy mode on a design with motion, 360 px phone: ${r}`)
  const fits = await phoneBoth.run(`(() => {
    const bar = document.querySelector('[data-pill-bar]'), r = bar.getBoundingClientRect()
    if (!bar.querySelector('[data-act="comment:tap"]') || !bar.querySelector('[data-pill-menu]')) return 'the pill should hold the menu and Comment'
    if (bar.querySelectorAll(':scope > button').length !== 4) return 'the pill should hold four buttons (the menu, the arrows, Comment), not ' + bar.querySelectorAll(':scope > button').length
    if (r.left < 0 || r.right > innerWidth || bar.scrollWidth > bar.clientWidth + 1) return 'the pill overflows 360 px: ' + r.left + '-' + r.right + ', ' + bar.scrollWidth + '/' + bar.clientWidth
    if (document.querySelector('[data-pill-handle]').offsetWidth < 100) return 'the pill handle was squeezed to ' + document.querySelector('[data-pill-handle]').offsetWidth + ' px'
    const tight = [...document.querySelectorAll('[data-motion-bar] button')].filter(b => b.offsetParent && b.offsetWidth < 32).map(b => (b.dataset.motion || b.getAttribute('aria-label')) + ' ' + b.offsetWidth)
    if (tight.length) return 'dock buttons squeezed: ' + tight.join(', ')
    const row = document.querySelector('[data-motion-bar] > div')
    if (row.scrollWidth > row.clientWidth + 1) return 'the dock overflows: ' + row.scrollWidth + '/' + row.clientWidth
    return 'ok'
  })()`)
  if (fits !== 'ok') fail(`the phone at 360 px with both bars: ${fits}`)
  const modes = await phoneBoth.run(`(async () => {
    ${until}
    const m = () => document.querySelector('[data-pill] [data-pill-menu]')
    if (m().dataset.pillMenu !== 'mode' || m().dataset.act !== 'copymode' || m().getAttribute('aria-label') !== 'Close copy options') return 'in copy mode the menu button should be its way out: ' + m().outerHTML.slice(0, 160)
    m().click()
    if (!await until(() => m().dataset.pillMenu === '' && !document.querySelector('[data-copy-mark]'))) return 'the X should close copy mode and give the menu back'
    ${viaMenu('motion')}
    if (!await until(() => document.querySelector('[data-motion-dock]').hidden && window.__protoMotion.state().live)) return 'Hide motion should put the dock away and let the design go'
    if (getComputedStyle(document.querySelector('[data-zone]')).getPropertyValue('--dock-h').trim() !== '0px') return 'the stage should get the dock\\'s room back'
    return 'ok'
  })()`)
  if (modes !== 'ok') fail(`the pill's menu on a phone: ${modes}`)
} finally { phoneBoth.close() }
// A moment of the motion in copy mode is shot as copy mode is: once its bar is in, with the bar,
// at the stage's own size; a variant without copy options is shot without and says so.
proto(['shoot', 'both/A', '--at', '200'])
proto(['shoot', 'both/A', '--at', '200', '--copy'])
if (!pngs(shots).includes('both-A-desktop-at-200-copy.png') || sizeOf('both-A-desktop-at-200-copy.png') !== sizeOf('both-A-desktop-at-200.png')) fail('proto shoot --at 200 --copy should write both-A-desktop-at-200-copy.png at the size of both-A-desktop-at-200.png')
const motionNoCopy = proto(['shoot', 'move/A', '--at', '200', '--copy'])
if (!/move\/A has no copy options/.test(motionNoCopy) || pngs(shots).includes('move-A-desktop-at-200-copy.png')) fail(`proto shoot --at --copy on a variant without copy options should say so and drop -copy from the name: ${motionNoCopy}`)

// Try it on a phone: a row of the pill's menu (no handle over the design) with its count, opening a
// sheet with the panel's list, the pill raised over its backdrop, the menu's button its X. A thing to
// try puts the sheet away while its spot is lit (the button the key that brings it back) and brings
// it back once the spot goes out; a press on the design meanwhile leaves it down. Esc puts it away
// and stays on the variant. On a desktop the panel's tabs and Fill in stay on one line each.
proto(['add', 'tryit', '--title', 'Try it', '--variants', 'A:Checkout'])
writeFileSync(join(app, 'src', 'protos', 'tryit', 'A.tsx'), `import { useState } from 'react'
import { useHints } from '../../hints'
import { useCopy } from '../../copy'
export default function A() {
  const [code, setCode] = useState('')
  const copy = useCopy([{ id: 'title', label: 'Title', options: ['Your order', 'Almost yours'] }])
  useHints([
    { kind: 'value', label: 'Promo code', value: 'BEAN10', fill: 'input[name=promo]' },
    { kind: 'try', text: 'Pay for the order', at: '[data-shoot=pay]' },
    { kind: 'switch', label: 'Scenario', options: ['Order', 'Empty'], value: 'Order', set: () => {} },
    { kind: 'caveat', text: 'No payment is made.' },
  ])
  return <div className="h-full p-8">
    <h1 data-copy="title" className="text-2xl">{copy.title}</h1>
    <input name="promo" value={code} onChange={e => setCode(e.target.value)} placeholder="Promo code" />
    <div style={{ height: 120 }} />
    <button data-shoot="pay" className="rounded-full bg-zinc-900 px-6 py-3 text-white">Pay</button>
  </div>
}
`)
const tryPhone = await openPage(`${local}?theme=light#/tryit/A`, { width: 360, height: 740, phone: true })
try {
  const r = await tryPhone.run(`(async () => {
    ${until}
    if (document.querySelector('[data-handles] [data-hint="open:try"]')) return 'the Try it handle still floats over the design'
    const bar = document.querySelector('[data-pill-bar]'), b = bar.getBoundingClientRect(), name = document.querySelector('[data-pill-name]')
    if (b.left < 0 || b.right > innerWidth || bar.scrollWidth > bar.clientWidth + 1) return 'the pill overflows 360 px: ' + b.left + '-' + b.right
    if (name.scrollWidth > name.clientWidth + 1) return 'the variant name is cut: ' + name.scrollWidth + '/' + name.clientWidth
    const m = () => document.querySelector('[data-pill] [data-pill-menu]')
    if (!await until(m, 8000)) return 'the pill has no menu'
    m().click()
    const row = await until(() => document.querySelector('[data-menu-card] [data-act=try]'))
    if (!row) return 'the menu has no Try it'
    if (!/3 to try/.test(row.textContent)) return 'Try it should count 3 things, says ' + row.textContent.trim()
    const sheet = () => document.querySelector('[data-try-sheet] [data-try-list]')
    row.click()
    if (!await until(() => sheet()?.querySelector('[data-try-row]'))) return 'Try it opened no sheet with the things to try'
    if (document.querySelector('[data-pill] > div').style.zIndex !== '210') return 'the pill should ride over the sheet'
    if (m().dataset.act !== 'try' || m().getAttribute('aria-label') !== 'Close Try it') return 'the menu button should be the sheet\\'s X while it is up'
    if (!document.querySelector('[data-try-sheet] [data-hint=fill]')) return 'the sheet has no Fill in'
    sheet().querySelector('[data-try-row]').click()
    if (!await until(() => !sheet())) return 'a thing to try should put the sheet away'
    if (m().getAttribute('aria-label') !== 'Bring Try it back') return 'while the sheet is away the menu button should bring it back, says ' + m().getAttribute('aria-label')
    if (!await until(() => sheet(), 7000)) return 'the sheet should come back once the spot goes out'
    sheet().querySelector('[data-try-row]').click()
    if (!await until(() => !sheet())) return 'the sheet should go away again'
    return 'ok'
  })()`, 30_000)
  if (r !== 'ok') fail(`Try it on a phone: ${r}`)
  // A real press on the design while the spot is lit: the sheet stays down, and the menu is back.
  await tryPhone.press(180, 200)
  const down = await tryPhone.run(`(async () => {
    ${until}
    await new Promise(r => setTimeout(r, 900))
    if (document.querySelector('[data-try-sheet] [data-try-list]')) return 'a press on the design should leave the sheet down'
    if (document.querySelector('[data-pill] [data-pill-menu]').getAttribute('aria-label') !== 'Menu') return 'the menu button should be the menu again'
    ${viaMenu('try')}
    if (!await until(() => document.querySelector('[data-try-sheet] [data-try-list]'))) return 'Try it in the menu should bring the sheet back'
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    if (!await until(() => !document.querySelector('[data-try-sheet] [data-try-list]'))) return 'Esc should put the sheet away'
    await new Promise(r => setTimeout(r, 300))
    return location.hash === '#/tryit/A' ? 'ok' : 'Esc left the variant for ' + location.hash
  })()`, 20_000)
  if (down !== 'ok') fail(`Try it on a phone: ${down}`)
} finally { tryPhone.close() }
const tryDesk = await openPage(`${local}?theme=light#/tryit/A`)
try {
  const r = await tryDesk.run(`(async () => {
    ${until}
    const tab = await until(() => document.querySelector('[data-hint="tab:try"]'), 8000)
    if (!tab) return 'the desktop panel has no Try it tab'
    tab.click()
    if (!await until(() => document.querySelector('[data-hints] [data-hint=fill]'))) return 'no Fill in'
    const strip = document.querySelector('[data-tabs]')
    if (strip.scrollWidth > strip.clientWidth + 1) return 'the tabs overflow the panel: ' + strip.scrollWidth + '/' + strip.clientWidth
    // A label on two lines is a text node drawn as two boxes.
    const lines = n => { const r = document.createRange(); r.selectNodeContents(n); return r.getClientRects().length }
    const two = [...strip.querySelectorAll('button'), document.querySelector('[data-hints] [data-hint=fill]')].flatMap(b => [...b.childNodes].filter(n => n.nodeType === 3 && n.textContent.trim() && lines(n) > 1).map(n => n.textContent.trim()))
    if (two.length) return 'on two lines: ' + two.join(', ')
    if (document.querySelector('[data-pill] [data-pill-menu]')?.offsetParent) return 'a desktop should have no pill'
    return 'ok'
  })()`)
  if (r !== 'ok') fail(`Try it on a desktop: ${r}`)
} finally { tryDesk.close() }

// The device view: this page at a phone's, a tablet's or a desktop's size, in the stage. A desktop
// has the three sizes in the bar before Comment, its own selected; a phone has them as a Layout row
// in the pill's menu, which folds back once a size is chosen. The view is
// the page in a frame (?dv), on the same place: the page in it pings nothing and writes nothing, and
// where either goes the other follows. A comment written in it is about that layout, and says so in
// the inbox. Two fingers on the device zoom it around the point between them, and switching sizes
// and variants fast never freezes the page.
const frameOf = `const frame = () => document.querySelector('[data-view] iframe')
    const inFrame = () => { try { const d = frame()?.contentDocument; return d && d.URL !== 'about:blank' && d.documentElement.dataset.ready === '1' && d.querySelector('[data-layers] [data-mount] > *') ? d : null } catch { return null } }`
const viewDesk = await openPage(`${local}?theme=light#/tryit/A`)
try {
  const r = await viewDesk.run(`(async () => {
    ${until}
    ${frameOf}
    const tabs = await until(() => document.querySelector('[data-bar] [data-size-tabs]'), 8000)
    if (!tabs) return 'the bar has no sizes'
    // At rest the design is on the stage's own artboard, laid out for the stage's width: that layout is selected.
    const own = (w => w < 640 ? 'phone' : w < 1024 ? 'tablet' : 'desktop')(document.querySelector('[data-layers]').clientWidth)
    const sizes = [...tabs.querySelectorAll('[role=radio]')].map(b => b.dataset.act + '=' + b.getAttribute('aria-checked'))
    if (sizes.join() !== ['phone', 'tablet', 'desktop'].map(x => 'size:' + x + '=' + (x === own)).join()) return 'the bar should have phone, tablet and desktop, ' + own + ' (the stage\\'s) selected: ' + sizes.join()
    if (tabs.querySelector('[data-act="size:desktop"]').title !== 'Desktop · 1440 × 900') return 'the desktop size says ' + tabs.querySelector('[data-act="size:desktop"]').title
    if (tabs.nextElementSibling?.dataset.act !== 'comment:toggle') return 'the sizes should come just before Comment'
    tabs.querySelector('[data-act="size:phone"]').click()
    if (!await until(() => inFrame(), 15000)) return 'no page in a view'
    const url = new URL(frame().src)
    if (!url.searchParams.has('dv') || url.hash !== '#/tryit/A') return 'the view should show this place, framed: ' + frame().src
    if (!/^390 × 844 · 100%/.test(document.querySelector('[data-view-line]').textContent)) return 'the view line says ' + document.querySelector('[data-view-line]').textContent
    const d = inFrame(), w = d.defaultView
    if (d.querySelector('[data-size-tabs], [data-act="comment:toggle"], [data-act="comment:tap"]')) return 'the page in the view has sizes or a Comment of its own'
    // What the page in the view writes and posts from here on.
    w.__writes = []; w.__posts = []
    const set = w.Storage.prototype.setItem, f = w.fetch
    w.Storage.prototype.setItem = function (k, v) { w.__writes.push(k); return set.call(this, k, v) }
    w.fetch = (u, o) => { if ((o?.method || 'GET') !== 'GET') w.__posts.push(String(u)); return f.call(w, u, o) }
    d.dispatchEvent(new w.Event('visibilitychange'))
    w.location.hash = '#/tryit'
    if (!await until(() => location.hash === '#/tryit', 5000)) return 'the page should follow the view to #/tryit, is on ' + location.hash
    location.hash = '#/tryit/A'
    if (!await until(() => w.location.hash === '#/tryit/A' && inFrame(), 8000)) return 'the view should follow the page back to #/tryit/A, is on ' + w.location.hash
    await new Promise(r => setTimeout(r, 300))
    if (w.__posts.length) return 'the page in the view posted ' + w.__posts.join(', ')
    if (w.__writes.length) return 'the page in the view wrote ' + w.__writes.join(', ')
    document.querySelector('[data-act="comment:toggle"]').click()
    if (!await until(() => document.querySelector('[data-view-banner]') && document.querySelector('[data-view-pick]'))) return 'Comment should turn the view line into its commenting line, over the frame'
    if (!/what to change on phone/.test(document.querySelector('[data-view-banner]').textContent)) return 'the commenting line says ' + document.querySelector('[data-view-banner]').textContent
    return 'ok'
  })()`, 60_000)
  if (r !== 'ok') fail(`a device view on a desktop: ${r}`)
  // A real press on the heading in the frame, mapped out to this page.
  const at = await viewDesk.run(`(() => {
    const f = document.querySelector('[data-view] iframe'), h = f.contentDocument.querySelector('[data-layers] [data-mount] h1')
    const r = h.getBoundingClientRect(), fr = f.getBoundingClientRect(), s = fr.width / f.offsetWidth
    return [fr.left + (r.left + 10) * s, fr.top + (r.top + r.height / 2) * s]
  })()`)
  await viewDesk.press(...at)
  const wrote = await viewDesk.run(`(async () => {
    ${until}
    const chip = await until(() => document.querySelector('[data-composer] [data-view-chip]'))
    if (!chip) return 'a press on the design in the view opened no composer with its size'
    if (chip.textContent !== 'Phone · 390 × 844') return 'the composer\\'s chip says ' + chip.textContent
    const ed = document.querySelector('[data-composer] [role=textbox]')
    ed.textContent = 'Smaller heading on a phone'
    ed.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 100))
    ;[...document.querySelectorAll('[data-composer] button')].find(b => /Add/.test(b.textContent)).click()
    if (!await until(() => document.querySelector('[data-hints] [data-view-chip]'))) return 'the comments list should show the size on the comment'
    document.querySelector('[data-shoot=send]').click()
    return 'ok'
  })()`)
  if (wrote !== 'ok') fail(`a comment in a device view: ${wrote}`)
  let heard = ''
  for (let i = 0; i < 40 && !/Smaller heading on a phone/.test(heard); i++) { await new Promise(r => setTimeout(r, 250)); heard = proto(['inbox'], { stdout: true }) }
  if (!/Smaller heading on a phone\n(?: {3}.*\n)* {3}view: phone 390x844 \(shoot it: proto shoot tryit\/A --size 390x844\)$/m.test(heard)) fail(`proto inbox should print the comment's layout as view: phone 390x844: ${heard}`)
  // Its pin is on the phone only: the tablet has a chip that goes back to it, and Esc leaves the view.
  const pins = await viewDesk.run(`(async () => {
    ${until}
    const pins = () => [...document.querySelectorAll('[data-comments] button')].filter(b => /^\\d+$/.test(b.textContent.trim())).length
    if (!await until(() => pins() === 1)) return 'the comment should have its pin over the phone, has ' + pins()
    // Another size than the phone and the stage's own (which is the artboard, with no line for a chip).
    const own = (w => w < 640 ? 'phone' : w < 1024 ? 'tablet' : 'desktop')(document.querySelector('[data-layers]').clientWidth)
    document.querySelector('[data-size-tabs] [data-act="size:' + (own === 'tablet' ? 'desktop' : 'tablet') + '"]').click()
    const chip = await until(() => document.querySelector('[data-view-other=phone]'))
    if (!chip || pins()) return 'on another size the pin should go and a chip lead back to the phone (' + pins() + ' pins)'
    chip.click()
    if (!await until(() => /^390 × 844/.test(document.querySelector('[data-view-line]')?.textContent) && pins() === 1)) return 'the chip should go back to the phone, with its pin'
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    if (!await until(() => !document.querySelector('[data-view-line], [data-view-banner]'))) return 'Esc should leave the phone for the stage\\'s own artboard'
    return pins() ? 'out of the view the pin should go' : 'ok'
  })()`)
  if (pins !== 'ok') fail(`a comment's layout: ${pins}`)
} finally { viewDesk.close() }
for (const view of [{ size: 'watch', w: 390, h: 844 }, { size: 'phone', w: 390.5, h: 844 }, { size: 'phone', w: 390 }, { size: 'desktop', w: 99999, h: 900 }, 'phone']) {
  const res = await postJson('comments', { comments: [{ route: 'tryit/A', text: 'x', view }] })
  if (res.status !== 400 || !/view/.test(await res.text())) fail(`a comment with view ${JSON.stringify(view)} was answered ${res.status}, not refused`)
}
if ((await postJson('comments', { comments: [{ route: 'tryit/A', text: 'x', action: 'more', view: { size: 'phone', w: 390, h: 844 } }] })).status !== 400) fail('a decision with a view was accepted')
const viewPhone = await openPage(`${local}?theme=dark#/tryit/A`, { width: 390, height: 844, phone: true })
try {
  const r = await viewPhone.run(`(async () => {
    ${until}
    ${frameOf}
    const m = () => document.querySelector('[data-pill] [data-pill-menu]')
    if (!await until(m, 8000)) return 'the pill has no menu'
    m().click()
    const card = await until(() => document.querySelector('[data-menu-card]'))
    if (!card || m().getAttribute('aria-expanded') !== 'true' || !m().classList.contains('!bg-white')) return 'the menu button should open its card and turn white'
    const sizes = [...card.querySelectorAll('[data-act^="size:"]')]
    if (sizes.length !== 3 || card.querySelector('[data-act=turn]')) return 'with no view on, the Layout row has the three sizes only'
    if (sizes[0].getAttribute('aria-pressed') !== 'true') return 'the phone, this window\\'s own size, should be the one chosen'
    card.querySelector('[data-act="size:desktop:card"]').click()
    if (!await until(() => !document.querySelector('[data-menu-card]'), 3000)) return 'choosing a size should fold the menu back'
    if (!await until(() => inFrame(), 15000)) return 'no desktop in a view'
    if (!/^1440 × 900 · \\d+%/.test(document.querySelector('[data-view-line]').textContent)) return 'the view line says ' + document.querySelector('[data-view-line]').textContent
    ${viaMenu('size:tablet:card')}
    if (!await until(() => /^834 × 1194/.test(document.querySelector('[data-view-line]')?.textContent ?? ''), 8000)) return 'no tablet in a view'
    m().click()
    if (!await until(() => document.querySelector('[data-menu-card] [data-act=turn]'))) return 'with a tablet on, the Layout row should turn it'
    document.querySelector('[data-scale-backdrop]').click()
    if (!await until(() => !document.querySelector('[data-menu-card]'), 3000)) return 'the backdrop should fold the menu back'
    ${viaMenu('size:desktop:card')}
    if (!await until(() => /^1440 × 900/.test(document.querySelector('[data-view-line]')?.textContent ?? '') && inFrame(), 15000)) return 'no desktop in a view again'
    return 'ok'
  })()`, 60_000)
  if (r !== 'ok') fail(`a device view on a phone: ${r}`)
  // Two fingers on the device, spreading 3x: the zoom only grows, about 3x, around the point between them.
  const where = `(() => {
    const a = document.querySelector('[data-view-area]').getBoundingClientRect(), f = document.querySelector('[data-view] iframe').getBoundingClientRect()
    return { x: (Math.max(a.left, f.left) + Math.min(a.right, f.right)) / 2 - 30, y: (Math.max(a.top, f.top) + Math.min(a.bottom, f.bottom)) / 2 + 20 }
  })()`
  const mid = await viewPhone.run(where)
  const under = `(() => { const f = document.querySelector('[data-view] iframe'), r = f.getBoundingClientRect(), s = r.width / f.offsetWidth; return { x: (${mid.x} - r.left) / s, y: (${mid.y} - r.top) / s, pct: s * 100 } })()`
  const before = await viewPhone.run(under)
  const path = []
  await viewPhone.touch('touchStart', [[mid.x - 30, mid.y], [mid.x + 30, mid.y]])
  for (let i = 1; i <= 20; i++) {
    const g = 30 + 60 * i / 20
    await viewPhone.touch('touchMove', [[mid.x - g, mid.y], [mid.x + g, mid.y]])
    await new Promise(r => setTimeout(r, 20))
    path.push(await viewPhone.run(under, 5000))
  }
  await viewPhone.touch('touchEnd', [])
  const pcts = path.map(p => p.pct), back = pcts.findIndex((p, i) => i && p < pcts[i - 1] - 0.3), drift = Math.max(...path.map(p => Math.hypot(p.x - before.x, p.y - before.y)))
  if (back > 0) fail(`a pinch on the device went back at step ${back}: ${pcts.map(Math.round).join(' ')}`)
  if (Math.abs(pcts.at(-1) / before.pct - 3) > 0.3) fail(`spreading two fingers 3x should zoom about 3x: ${Math.round(before.pct)}% to ${Math.round(pcts.at(-1))}%`)
  if (drift > 6) fail(`the point between the fingers moved ${Math.round(drift)} page px`)
} finally { viewPhone.close() }
// Sizes and variants switched fast with a view open: the page answers every step and ends in step.
const viewFast = await openPage(`${local}?theme=dark#/home/A`)
try {
  // It ends on the phone, which a desktop's stage never is (the tablet can be its own artboard).
  for (const step of ['size:phone', 'v:B', 'size:tablet', 'v:C', 'size:desktop', 'size:phone', 'v:A', 'size:tablet', 'v:B', 'size:phone', 'v:A', 'size:tablet', 'size:phone']) {
    const [k, a] = step.split(':')
    const r = await viewFast.run(k === 'v' ? `(location.hash = '#/home/${a}', 'ok')` : `(() => { const b = document.querySelector('[data-size-tabs] [data-act="size:${a}"]'); if (!b) return 'no ${a} in the bar'; b.click(); return 'ok' })()`, 8000)
    if (r !== 'ok') fail(`switching fast with a view open, ${step}: ${r}`)
    await new Promise(r => setTimeout(r, 120))
  }
  const end = await viewFast.run(`(async () => {
    ${until}
    ${frameOf}
    if (!await until(() => inFrame()?.defaultView.location.hash === location.hash, 15000)) return 'the view never caught up: ' + location.hash + ' in the page, ' + frame()?.contentWindow.location.hash + ' in the view'
    return /^390 × 844/.test(document.querySelector('[data-view-line]')?.textContent ?? '') && document.querySelectorAll('[data-view] iframe').length === 1 ? 'ok' : 'the view should be one phone: ' + document.querySelector('[data-view-line]')?.textContent
  })()`, 20_000)
  if (end !== 'ok') fail(`switching fast with a view open: ${end}`)
} finally { viewFast.close() }
proto(['shoot', 'tryit/A', '--size', '834x1194'])
if (!pngs(shots).includes('tryit-A-834x1194.png')) fail('proto shoot --size 834x1194 should write tryit-A-834x1194.png')
proto(['shoot', 'tryit/A', '--size', '834'], { ok: false })
proto(['shoot', 'tryit', '--sheet', '--size', '834x1194'], { ok: false })

await optionalExtras({ proto, app, local, openPage, postJson, fail, keepShots })
await designKit({ proto, app, project, local, fail })
await speedChecks({ proto, app, openPage, fail })

proto(['stop'])
for (let i = 0; i < 40 && await answers(`${local}__proto/status`); i++) await new Promise(r => setTimeout(r, 250))
if (await answers(`${local}__proto/status`)) fail('the server still answers after proto stop')
let gone = false
try { process.kill(pid, 0) } catch { gone = true }
if (!gone) fail(`the dev server (pid ${pid}) is still running after proto stop`)

proto(['rm'])
if (existsSync(app)) fail('proto rm left the session folder')
if (!existsSync(join(project, '.prototypes', '_kits', 'main', 'kit.json'))) fail('proto rm took the project\'s design kit with it')
try { rmSync(scratch, { recursive: true, force: true }) } catch { /* temp dir */ }
console.log(`\nOK: ${made.length} screenshots in ${keepShots}`)
