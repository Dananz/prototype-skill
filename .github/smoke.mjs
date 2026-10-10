// End-to-end check of the skill on this machine: create a session app in a scratch project,
// add prototypes (one built from another, one from two at once, one from the picks), screenshot
// them (one by one and on a contact sheet) and snapshot them, open a state listed in meta.ts,
// print a variant's handoff checklist, send comments, decisions and copy choices from the page,
// then stop and delete the session. Run by
// .github/workflows/smoke.yml on Windows, Linux and macOS.
import { spawn, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { get, request } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startChrome, stopChrome } from '../scripts/chrome.mjs'

const skill = dirname(dirname(fileURLToPath(import.meta.url)))
const scratch = process.env.RUNNER_TEMP || tmpdir()
// The project is reached through a link, as /tmp is on macOS: the app must still serve its files.
const real = join(scratch, 'proto-smoke')
const project = join(scratch, 'proto-smoke-link')
const keepShots = join(scratch, 'proto-shots')
const app = join(project, '.prototypes', 'smoke')
rmSync(project, { recursive: true, force: true })
rmSync(real, { recursive: true, force: true })
mkdirSync(real, { recursive: true })
symlinkSync(real, project, 'junction')
writeFileSync(join(project, 'package.json'), JSON.stringify({ name: 'proto-smoke', private: true, dependencies: { react: '^19.2.0' } }))

const fail = msg => {
  console.error(`\nFAILED: ${msg}`)
  const log = join(app, '.proto', 'dev.log')
  if (existsSync(log)) console.error(`\n--- dev.log ---\n${readFileSync(log, 'utf8')}`)
  process.exit(1)
}
const proto = (args, { ok = true } = {}) => {
  console.log(`\n$ proto ${args.join(' ')}`)
  const r = spawnSync(process.execPath, [join(skill, 'scripts', 'proto.mjs'), ...args, '--project', project, '--session', 'smoke'], { encoding: 'utf8', timeout: 600_000 })
  process.stdout.write(r.stdout || '')
  process.stderr.write(r.stderr || '')
  if (ok && r.status !== 0) fail(`proto ${args[0]} exited ${r.status}`)
  if (!ok && r.status === 0) fail(`proto ${args.join(' ')} should have been refused`)
  return (r.stdout || '') + (r.stderr || '')
}
const answers = async url => { try { return (await fetch(url, { signal: AbortSignal.timeout(2000) })).ok } catch { return false } }
const pngs = dir => existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith('.png')) : []
// Opens the page in headless Chrome and waits until it says it is ready, as shoot.mjs does. run()
// evaluates an expression there (a promise is awaited), as often as needed; close() ends it all.
async function openPage(url) {
  const profile = mkdtempSync(join(tmpdir(), 'proto-smoke-'))
  const chrome = startChrome([`--user-data-dir=${profile}`, '--no-first-run'])
  let ws
  const close = () => {
    ws?.close()
    stopChrome(chrome)
    try { rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }) } catch { /* temp dir */ }
  }
  try {
    ws = new WebSocket(await new Promise((ok, no) => {
      let b = ''
      chrome.stderr.on('data', d => { b += d; const m = b.match(/DevTools listening on (ws:\/\/\S+)/); if (m) ok(m[1]) })
      chrome.on('exit', () => no(new Error('Chrome exited')))
    }))
    await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = no })
    let n = 0
    const waiting = new Map()
    ws.onmessage = e => { const m = JSON.parse(e.data); waiting.get(m.id)?.(m.result); waiting.delete(m.id) }
    const send = (method, params, sessionId) => new Promise(ok => { waiting.set(++n, ok); ws.send(JSON.stringify({ id: n, method, params, sessionId })) })
    const { targetId } = await send('Target.createTarget', { url })
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
    // A page that stops answering (a render loop) fails the check instead of hanging the run.
    const run = async (expr, ms = 30_000) => {
      let timer
      const r = await Promise.race([send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sessionId), new Promise(ok => { timer = setTimeout(() => ok('hung'), ms) })])
      clearTimeout(timer)
      if (r === 'hung') throw new Error(`the page did not answer in ${ms / 1000} s: it is stuck, as in a render loop`)
      return r?.result?.value
    }
    for (let i = 0; i < 150 && !await run('document.documentElement.dataset.ready === "1"'); i++) await new Promise(r => setTimeout(r, 100))
    return { run, close }
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
// prints the action.
const pickSent = await send([{ route: 'hero/B', text: 'Picked B', action: 'pick' }])
if (!readFileSync(heroMeta, 'utf8').includes('"picked": "B"')) fail('a pick from the page did not mark hero/meta.ts')
if (pickSent.moved !== true) fail(`the pick moved the working variant but the answer says moved: ${pickSent.moved}`)
if (pickSent.inbox.batches.find(b => b.id === pickSent.sent)?.state !== 'done') fail('a pick from the page did not arrive done')
const picked = JSON.parse(readFileSync(join(app, 'session.json'), 'utf8'))
if (picked.work?.proto !== 'hero' || picked.work.variant !== 'B' || picked.asks?.['hero/B']?.at(-1)?.text !== 'Picked B') fail(`a pick from the page should make hero/B the working variant with "Picked B": ${JSON.stringify(picked.work)} ${JSON.stringify(picked.asks?.['hero/B'])}`)
if (!/^ {3}action: pick \(done/m.test(proto(['inbox']))) fail('proto inbox did not print the pick as done (action: pick (done …))')
// The answer says how each decision went, and where the working variant is now.
if (JSON.stringify(pickSent.results) !== '[{"n":1,"action":"pick","done":true}]' || pickSent.work?.variant !== 'B') fail(`the answer to a pick should say it was done and work is hero/B: ${JSON.stringify(pickSent.results)} ${JSON.stringify(pickSent.work)}`)
const unpickSent = await send([{ route: 'hero/B', text: 'Unpicked B', action: 'unpick' }, { route: 'hero/B', text: 'More like B: warmer', action: 'more' }])
if (readFileSync(heroMeta, 'utf8').includes('"picked"')) fail('taking the pick back in the page left it in hero/meta.ts')
if (JSON.stringify(unpickSent.results) !== '[{"n":1,"action":"unpick","done":true},{"n":2,"action":"more","done":false}]') fail(`the answer should say the unpick was done and More waits: ${JSON.stringify(unpickSent.results)}`)
if (!/action: more/.test(proto(['inbox']))) fail('proto inbox did not print action: more')
// Taking back a pick that isn't there changes nothing, so it isn't done: it arrives saying so.
const noop = await send([{ route: 'hero/A', text: 'Unpicked A', action: 'unpick' }])
if (noop.results?.[0]?.done !== false || !noop.results[0].nothing || noop.inbox.batches.find(b => b.id === noop.sent)?.state === 'done') fail(`an unpick of a variant that wasn't picked arrived done: ${JSON.stringify(noop.results)}`)
if (!/^ {3}action: unpick \(nothing changed/m.test(proto(['inbox']))) fail('proto inbox did not say an unpick changed nothing')
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
const until = `const until = async (f, ms = 4000) => { for (const end = Date.now() + ms; Date.now() < end; await new Promise(r => setTimeout(r, 50))) { const v = f(); if (v) return v } return null }`
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
    const line = () => document.querySelector('[data-mount] [data-copy=${id}]')?.textContent
    if (!await until(() => line() === '${words}')) return 'the ${id} line should read ${words}, reads ' + line()`
const sendOne = `
    const send = await until(() => document.querySelector('[data-shoot=send-copy]:not([disabled])'))
    if (!send || !/Send 1 choice/.test(send.textContent)) return 'no Send 1 choice: ' + send?.textContent
    send.click()
    if (!await until(() => /Sent/.test(document.querySelector('[data-shoot=send-copy]')?.textContent ?? ''))) return 'the bar never said Sent'`
const reload = async () => {
  await words.run('setTimeout(() => location.reload(), 0), 1')
  await new Promise(r => setTimeout(r, 500))
  for (let i = 0; i < 100 && !await words.run('document.documentElement.dataset.ready === "1"').catch(() => false); i++) await new Promise(r => setTimeout(r, 100))
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
  await reload()
  const backSent = await words.run(`(async () => {
    ${until}
    ${copyOn}
    ${sendOne}
    return 'ok'
  })()`)
  if (backSent !== 'ok') fail(`the way back to today's words, after a reload: ${backSent}`)
  const toldBack = proto(['inbox'])
  if (!/“Save more”, back to today's words \(option 1 of 3\)/.test(toldBack)) fail(`proto inbox should print the way back to today's words: ${toldBack}`)
  // A component that declared lines unmounts while copy mode is on: its lines go, the rest stay
  // marked (also after closing and opening copy mode again), and ⌥-click still opens a comment.
  const gone = await words.run(`(async () => {
    ${until}
    document.querySelector('[data-mount] [data-hide-go]').click()
    if (!await until(() => !document.querySelector('[data-copy-mark=go], [data-copy-mark=note]'))) return 'the hidden lines are still marked'
    const t = () => document.querySelector('[data-bar] [data-act=copymode]')
    t().click()
    if (!await until(() => t().title === 'Copy options for 1 line')) return 'the T button should say 1 line: ' + t().title
    t().click()
    if (!await until(() => document.querySelector('[data-copy-mark=title]'))) return 'copy mode marks nothing after it opens again'
    document.querySelector('[data-mount] [data-hide-go]').dispatchEvent(new MouseEvent('click', { altKey: true, bubbles: true, cancelable: true }))
    if (!await until(() => document.querySelector('[data-composer]'))) return 'an option-click opened no comment'
    return 'ok'
  })()`)
  if (gone !== 'ok') fail(`a component with lines unmounting in copy mode: ${gone}`)
} finally { words.close() }
// The checklist names each line, whichever component declares it, whatever brackets, comments,
// escaped quotes or JSX words with a /* are around its words, and what the build ships; a shot in
// copy mode is the stage's own size.
const handed = proto(['handoff', 'words/A'])
if (!/^- \[ \] Title \(`title`\) ships "Save more", not its 2 other options · A\.tsx:7$/m.test(handed)) fail('proto handoff did not list the Title line and what ships')
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

proto(['stop'])
for (let i = 0; i < 40 && await answers(`${local}__proto/status`); i++) await new Promise(r => setTimeout(r, 250))
if (await answers(`${local}__proto/status`)) fail('the server still answers after proto stop')
let gone = false
try { process.kill(pid, 0) } catch { gone = true }
if (!gone) fail(`the dev server (pid ${pid}) is still running after proto stop`)

proto(['rm'])
if (existsSync(app)) fail('proto rm left the session folder')
console.log(`\nOK: ${made.length} screenshots in ${keepShots}`)
