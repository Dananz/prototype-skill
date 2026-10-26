// Share links, part 1: a real share build of chosen variants from the smoke's own session, into
// one HTML file. What must be in it (the two variants, a helper they borrow, their images as
// WebP, a CSS background, the slot pick of the moment) and what must never be (the other
// variants, the borrowed prototype's own meta, the owner's asks, this machine's paths). The
// session's dev server and its own dist/ are left as they were, and two publishes at once take
// turns. sharp is installed into ~/.prototypes/share-tools here until `proto share` does it.
// Part 2 (viewerChecks, below) opens such a share in Chrome and checks the viewer it boots into.
// Part 3 (hostChecks, at the end) runs `proto share` itself against a local host under wrangler dev.
import { spawnSync } from 'node:child_process'
import { createServer, get } from 'node:http'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { crc32, deflateSync, gunzipSync } from 'node:zlib'
import { createRequire } from 'node:module'

const skill = dirname(dirname(fileURLToPath(import.meta.url)))
// PROTO_SHARE_TOOLS is how part 3 hands the same folder to commands it runs under another HOME.
const tools = process.env.PROTO_SHARE_TOOLS || join(homedir(), '.prototypes', 'share-tools')

// An RGB PNG of the given size, drawn by pixel(x, y) -> [r, g, b]. Node has zlib and crc32, which
// is all a PNG needs; a pattern rather than flat colour, so the file is as heavy as a screenshot.
function png(width, height, pixel) {
  const raw = Buffer.alloc((width * 3 + 1) * height)
  for (let y = 0, o = 0; y < height; y++) {
    raw[o++] = 0
    for (let x = 0; x < width; x++) { const [r, g, b] = pixel(x, y); raw[o++] = r; raw[o++] = g; raw[o++] = b }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body))
    return Buffer.concat([len, body, crc])
  }
  const head = Buffer.alloc(13)
  head.writeUInt32BE(width, 0); head.writeUInt32BE(height, 4); head[8] = 8; head[9] = 2
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', head), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

const metaFile = (app, slug) => join(app, 'src/protos', slug, 'meta.ts')
const readMeta = (app, slug) => JSON.parse(readFileSync(metaFile(app, slug), 'utf8').replace(/^[\s\S]*?export default\s*/, '').replace(/;?\s*$/, ''))
const writeMeta = (app, slug, meta) => writeFileSync(metaFile(app, slug), `export default ${JSON.stringify(meta, null, 2)}\n`)

export async function shareLinkChecks({ proto, app, local, openPage, fail }) {
  const assert = (ok, why) => { if (!ok) fail(`share link: ${why}`) }
  if (!existsSync(join(tools, 'node_modules', 'sharp'))) {
    console.log(`\n$ npm i --prefix ${tools} sharp@0.35.5`)
    mkdirSync(tools, { recursive: true })
    const r = spawnSync('npm', ['i', '--prefix', tools, '--no-save', '--no-package-lock', 'sharp@0.35.5'], { stdio: 'inherit', timeout: 600_000 })
    assert(r.status === 0, `could not install sharp into ${tools}`)
  }

  const protos = join(app, 'src/protos')
  proto(['add', 'lineage-src', '--title', 'LINEAGE-TITLE-k3', '--variants', 'A:Only'])
  writeFileSync(join(protos, 'lineage-src/A.tsx'), `export default function A() { return <main>MARK-LINEAGE-A</main> }\n`)
  writeFileSync(join(protos, 'lineage-src/parts.tsx'), `import { image } from '../../images'
export function Badge() { return <em>MARK-HELPER<img src={image('lineage-pic')} alt="" /></em> }
`)
  // Two pictures in src/assets: one named by the helper B borrows (in the share), one named only by
  // the unshared D (not). WebP already, so Vite inlines their bytes as they are and the test can find them.
  const sharp = createRequire(join(tools, 'index.js'))('sharp')
  const picture = async color => sharp({ create: { width: 40, height: 40, channels: 3, background: color } }).webp({ quality: 90 }).toBuffer()
  mkdirSync(join(app, 'src/assets'), { recursive: true })
  const lineagePic = await picture('#16a34a'), dOnly = await picture('#db2777')
  writeFileSync(join(app, 'src/assets/lineage-pic.webp'), lineagePic)
  writeFileSync(join(app, 'src/assets/d-only.webp'), dOnly)

  proto(['add', 'share-link', '--title', 'Share link', '--ask', 'ASK-META-SECRET-p4', '--variants', 'A:One,B:Two,C:Current,D:Four,E:Five'])
  for (const id of ['A', 'D', 'E']) writeFileSync(join(protos, `share-link/${id}.tsx`), `import { image } from '../../images'
export default function ${id}() { return <main className="mt-[137px]">MARK-${id}<img src={image('d-only')} alt="" /></main> }
`)
  // A part of the owner's project, compiled in through @project: the review names it.
  const project = JSON.parse(readFileSync(join(app, 'session.json'), 'utf8')).project
  mkdirSync(join(project, 'kit'), { recursive: true })
  writeFileSync(join(project, 'kit', 'Badge2.tsx'), `export function Badge2() { return <strong>MARK-PROJECT</strong> }\n`)
  writeFileSync(join(protos, 'share-link/hero.png'), png(3000, 2000, (x, y) => [(x * 7 + y) & 255, (x ^ y) & 255, ((x * y) >> 6) & 255]))
  writeFileSync(join(protos, 'share-link/B.tsx'), `import hero from './hero.png'
import { Badge } from '../lineage-src/parts'
import { Badge2 } from '@project/kit/Badge2'
export default function B() { return <main><h1>MARK-B</h1><Badge /><Badge2 /><img src={hero} alt="" /></main> }
`)
  writeFileSync(join(protos, 'share-link/tile.png'), png(16, 16, (x, y) => ((x >> 2) + (y >> 2)) % 2 ? [20, 120, 220] : [240, 240, 240]))
  writeFileSync(join(protos, 'share-link/C.css'), `.share-link-tile { background: url(./tile.png); min-height: 64px }\n`)
  writeFileSync(join(protos, 'share-link/C.tsx'), `import './C.css'
import { Slot } from '../../slot'
export default function C() { return <main className="share-link-tile"><h1>MARK-C</h1><Slot proto="share-link" id="cta"><button>MARK-SLOT-ORIGINAL</button></Slot></main> }
`)
  // A slot in C with slot-src/B plugged in: the share bakes that pick in, and only that variant.
  proto(['add', 'slot-src', '--title', 'Slot source', '--variants', 'A:Current,B:Round,C:Square'])
  writeFileSync(join(protos, 'slot-src/A.tsx'), `export default function A() { return <button>MARK-SLOT-ORIGINAL</button> }\n`)
  writeFileSync(join(protos, 'slot-src/B.tsx'), `export default function B() { return <button>MARK-SLOT-B</button> }\n`)
  writeFileSync(join(protos, 'slot-src/C.tsx'), `export default function C() { return <button>MARK-SLOT-C</button> }\n`)
  writeMeta(app, 'share-link', { ...readMeta(app, 'share-link'), slots: { cta: { variant: 'C', use: 'slot-src/B' } } })
  writeMeta(app, 'slot-src', { ...readMeta(app, 'slot-src'), from: 'share-link/C', slot: 'cta' })

  // What the owner said to the agent lives in session.json; none of it may reach a share.
  const sessionFile = join(app, 'session.json')
  const session = JSON.parse(readFileSync(sessionFile, 'utf8'))
  writeFileSync(sessionFile, JSON.stringify({ ...session, asks: { ...session.asks, 'share-link/B': [{ at: new Date().toISOString(), text: 'ASK-SESSION-SECRET-r8' }] } }, null, 2) + '\n')
  // The session's own production build, which a share build must not touch.
  mkdirSync(join(app, 'dist'), { recursive: true })
  writeFileSync(join(app, 'dist', 'index.html'), 'DIST-BEFORE')
  const distBefore = { dir: statSync(join(app, 'dist')).mtimeMs, file: statSync(join(app, 'dist', 'index.html')).mtimeMs }
  const pid = JSON.parse(readFileSync(sessionFile, 'utf8')).pid

  const { buildShare } = await import(join(skill, 'app', 'share', 'build.mjs'))
  const scope = { protos: [{ id: 'share-link', variants: ['B', 'C'] }], start: 'share-link/B' }
  const info = { title: 'Smoke share', owner: 'Smoke', version: 1 }
  let one, two
  try {
    ;[one, two] = await Promise.all([buildShare({ sessionDir: app, scope, info }), buildShare({ sessionDir: app, scope, info })])
  } catch (e) { fail(`share link: buildShare threw: ${e?.stack || e}`) }
  const { html } = one
  console.log(`share link: ${one.rawBytes} bytes, ${one.gzBytes} gzipped; warnings ${JSON.stringify(one.warnings)}; review ${JSON.stringify(one.review)}`)

  const files = [...one.files].sort()
  assert(files.length === 3 && files.includes('index.html') && files.filter(f => f.endsWith('.js')).length === 1 && files.filter(f => f.endsWith('.css')).length === 1, `single file: the build left ${JSON.stringify(files)}`)
  assert(!/<script[^>]+src=|<link[^>]+rel="?stylesheet/.test(html), 'single file: the html still loads a script or stylesheet by URL')
  assert(html.includes('MARK-B') && html.includes('MARK-C'), 'only chosen variants: B or C is missing')
  for (const id of ['A', 'D', 'E']) assert(!html.includes(`MARK-${id}`), `only chosen variants: MARK-${id} is in the share`)
  assert(html.includes('MARK-HELPER'), 'lineage: the helper borrowed from lineage-src is missing')
  assert(!html.includes('LINEAGE-TITLE-k3') && !html.includes('MARK-LINEAGE-A'), 'lineage: lineage-src itself is in the share')
  assert(html.includes('data:image/webp;base64,'), 'webp: no WebP image in the share')
  const pngs = [...html.matchAll(/data:image\/png;base64,[A-Za-z0-9+/=]*/g)].map(m => m[0].length)
  assert(pngs.every(n => n <= 10 * 1024), `webp: a PNG of ${Math.max(...pngs)} characters is inlined as it is`)
  assert(/\.share-link-tile\{[^}]*url\(["']?data:/.test(html.replace(/\s+/g, '')), 'css url inlined: C\'s tile is not a data: URL')
  for (const [what, text] of [['the project path', project], ['the project\'s real path', realpathSync(project)], ['the session\'s real path', realpathSync(app)], ['the home folder', homedir()], ['the tailnet', 'ts.net'], ['the session asks', 'ASK-SESSION-SECRET-r8'], ['the prototype ask', 'ASK-META-SECRET-p4']]) assert(!html.includes(text), `no session secrets: the share contains ${what} (${text})`)
  assert(html.includes('MARK-SLOT-B') && !html.includes('MARK-SLOT-C') && html.includes('slot-src/B'), 'slot pick baked: the share does not carry the plugged-in variant alone')
  assert(html.includes('/src/protos/share-link/C.tsx') && !html.includes('/src/protos/share-link/A.tsx'), 'stamps: C\'s elements carry no source stamp')
  assert(one.review.warn.some(w => w.code === 'real-screens' && w.message.includes('share-link/C')), `review: the Current variant is not reported (${JSON.stringify(one.review)})`)
  assert(html.includes('MARK-PROJECT') && one.review.warn.some(w => w.code === 'project-code' && w.message.includes('Badge2.tsx')), `review: the @project file is not reported (${JSON.stringify(one.review.warn)})`)
  assert(!html.includes('137px'), 'tailwind: a class only unshared variants use is in the share\'s stylesheet')
  assert(html.includes(lineagePic.toString('base64')), 'images: the picture the lineage helper names is missing')
  assert(!html.includes(dOnly.toString('base64')), 'images: a picture only an unshared variant names is in the share')
  assert(!one.review.warn.some(w => w.code === 'outside-url'), `review: outside-url warnings on a share that loads nothing from outside: ${JSON.stringify(one.review.warn.filter(w => w.code === 'outside-url'))}`)
  assert(!one.review.block.length, `review: the smoke share is blocked: ${JSON.stringify(one.review.block)}`)

  assert(statSync(join(app, 'dist')).mtimeMs === distBefore.dir && statSync(join(app, 'dist', 'index.html')).mtimeMs === distBefore.file && readFileSync(join(app, 'dist', 'index.html'), 'utf8') === 'DIST-BEFORE', 'build leaves the session alone: dist/ changed')
  assert(JSON.parse(readFileSync(sessionFile, 'utf8')).pid === pid, 'build leaves the session alone: the dev server was restarted')
  const page = await fetch(`${local}share-link/B`).catch(() => null)
  assert(page?.status === 200, `build leaves the session alone: the dev server answers ${page?.status}`)
  assert(two.html.includes('MARK-B'), 'publishes are serialized: the second build failed')
  assert(one.ended <= two.started || two.ended <= one.started, `publishes are serialized: the builds overlapped (${one.started}-${one.ended} and ${two.started}-${two.ended})`)
  // The slot is held by C: a share of B alone has no slot, so nothing is plugged in.
  const onlyB = await buildShare({ sessionDir: app, scope: { protos: [{ id: 'share-link', variants: ['B'] }], start: 'share-link/B' }, info })
  assert(onlyB.html.includes('MARK-B') && !onlyB.html.includes('MARK-SLOT-B') && !onlyB.html.includes('slot-src/B'), 'slot holder: a share without the slot\'s variant carries its plugged-in variant')
  assert(!existsSync(join(app, '.proto', 'shares', '.lock')), 'publishes are serialized: the lock was left behind')
  assert(!readdirSync(join(app, '.proto', 'shares')).length, 'build leaves the session alone: something was left in .proto/shares')
  console.log('share link: one-file build checks passed')
  await viewerChecks({ proto, app, openPage, fail, buildShare })
  await hostChecks({ app, openPage, fail })
}

const sleep = ms => new Promise(r => setTimeout(r, ms))
async function until(get, ms = 10_000) {
  for (const end = Date.now() + ms; ; await sleep(100)) {
    const v = await get()
    if (v || Date.now() > end) return v
  }
}

/**
 * The share as a host serves it, on a throwaway server: the page at / and, as in path mode, at
 * /s/<id>/, its state at api/state, and the viewer's sign-in routes as the host answers them
 * (api/config, api/me, api/signout; a cookie `v=<login>` is a signed-in viewer). Every path asked
 * for is kept, so a check can tell that nothing reached for the session's server.
 */
async function host(html) {
  const state = { version: 1, paths: [], comments: true }
  const json = (res, body, headers = {}) => { res.writeHead(200, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify(body)) }
  const server = createServer((req, res) => {
    state.paths.push(`${req.method} ${req.url}`)
    const path = req.url.split('?')[0]
    const at = path.replace(/^\/s\/[a-z0-9]+(?=\/)/, '')
    const login = (req.headers.cookie || '').match(/(?:^|;\s*)v=([\w-]+)/)?.[1]
    if (at.startsWith('/api/') && req.headers['x-proto'] !== '1') { res.writeHead(400); return res.end() }
    if (at === '/api/state') return json(res, { version: state.version, updatedAt: Date.now() })
    if (at === '/api/config') return json(res, { comments: state.comments, owner: 'Smoke' })
    if (at === '/api/me') return json(res, login ? { login, name: 'Octo Smoke', avatar: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="#0ea5e9"/></svg>')}` } : null)
    if (at === '/api/signout' && req.method === 'POST') return json(res, { ok: true }, { 'set-cookie': `v=; Path=${path.replace(/api\/signout$/, '')}; Max-Age=0` })
    if (at === '/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(html) }
    res.writeHead(404); res.end()
  })
  await new Promise(ok => server.listen(0, '127.0.0.1', ok))
  return { url: `http://127.0.0.1:${server.address().port}/`, state, close: () => server.close() }
}

// Share links, part 2: the viewer a share boots into (decision 19). Not the owner's shell: the
// desk of the shared designs, the list of the share's prototypes, zoom, the mount policy, the
// phone's one design, the newer-version banner, Hebrew, and a page opened from disk.
async function viewerChecks({ proto, app, openPage, fail, buildShare }) {
  const assert = (ok, why) => { if (!ok) fail(`share viewer: ${why}`) }
  const protos = join(app, 'src/protos')
  const info = { title: 'Smoke share', owner: 'Smoke', version: 1 }
  const build = async scope => {
    try { return (await buildShare({ sessionDir: app, scope, info })).html } catch (e) { fail(`share viewer: buildShare threw: ${e?.stack || e}`) }
  }
  const pairScope = { protos: [{ id: 'share-link', variants: ['B', 'C'] }, { id: 'lineage-src', variants: ['A'] }], start: 'share-link/B' }
  // C gets a field, a plain line and a long body (3000 px): its preview must stay the size of
  // every other, and the field is used once C is open full size.
  writeFileSync(join(protos, 'share-link/C.tsx'), readFileSync(join(protos, 'share-link/C.tsx'), 'utf8')
    .replace('<h1>MARK-C</h1>', '<h1>MARK-C</h1><p data-plain style={{ fontSize: 64 }}>PLAIN-TEXT-LINE in the design</p><textarea data-field defaultValue="SELECT-ME some words to select here" style={{ width: 900, height: 160, fontSize: 48 }} /><div style={{ height: 3000 }} />'))
  const html = await build(pairScope)
  const site = await host(html)
  // Served as path mode serves a share (/s/<id>/), whose apex is the same origin.
  const shareUrl = `${site.url}s/smk123/`
  try {
    const page = await openPage(shareUrl)
    try {
      const boards = () => page.run(`[...document.querySelectorAll('[data-board]')].map(b => b.dataset.board).join(' ')`)
      const text = () => page.run('document.body.innerText')
      await until(async () => (await text())?.includes('MARK-C'))
      const seen = await text()
      assert(await boards() === 'share-link/B share-link/C', `desk lists only shared: the desk has ${JSON.stringify(await boards())}`)
      assert(seen.includes('MARK-B') && seen.includes('MARK-C'), 'desk lists only shared: #2 or #3 is not mounted')
      for (const id of ['A', 'D', 'E']) assert(!seen.includes(`MARK-${id}`), `desk lists only shared: MARK-${id} is on the desk`)
      assert(await page.run(`!document.querySelector('[data-act]')`), 'desk lists only shared: the owner\'s shell chrome ([data-act]) is on the page')
      assert(await page.run(`[...document.querySelectorAll('[data-board] [data-label]')].map(l => l.textContent).join(' ').includes('#2')`), 'desk lists only shared: the label #2 is missing')

      // The stamps: where each element is written survives into the share.
      assert(await page.run(`(() => { const el = document.querySelector('[data-board="share-link/C"] [data-proto-src^="share-link/"]'); return !!el && !!el.dataset.protoComponent })()`), 'stamps survive: no element in C carries data-proto-src and data-proto-component')

      // Zoom: + raises the readout, 0 is Fit again, 1 is 100 %. CSS zoom, never a transform.
      const readout = () => page.run(`document.querySelector('[data-zoom-readout]')?.textContent ?? ''`)
      const cssZoom = () => page.run(`document.querySelector('[data-board]')?.currentCSSZoom ?? 0`)
      await page.run(`document.querySelector('[data-viewer-desk]')?.focus()`)
      const z0 = await cssZoom(), r0 = await readout()
      await page.key('+')
      await sleep(700)
      const z1 = await cssZoom(), r1 = await readout()
      assert(parseInt(r1) > parseInt(r0), `zoom: + took the readout from ${JSON.stringify(r0)} to ${JSON.stringify(r1)}`)
      assert(z1 > z0, `zoom: an artboard's zoom went from ${z0} to ${z1}`)
      assert(await page.run(`[...document.querySelectorAll('[data-board], [data-world]')].every(el => getComputedStyle(el).transform === 'none')`), 'zoom: an artboard or the desk is scaled with a transform')
      await page.key('0')
      await sleep(700)
      assert(await page.run(`document.querySelector('[data-fit]')?.getAttribute('aria-pressed') === 'true'`) && await readout() === r0, `zoom: 0 did not return to Fit (${await readout()})`)
      await page.key('1')
      await sleep(700)
      assert(await readout() === '100%', `zoom: 1 reads ${JSON.stringify(await readout())}`)

      // The grid: every artboard is the same fixed frame (750 high at 100 %), the long C too, and
      // the frames of a row share their top.
      const rects = await page.run(`['share-link/B', 'share-link/C'].map(k => { const f = document.querySelector('[data-board="' + k + '"] [data-frame]'); const r = f.getBoundingClientRect(); return [r.top, r.height, f.currentCSSZoom] })`)
      assert(Math.abs(rects[0][0] - rects[1][0]) < 1 && Math.abs(rects[0][1] - rects[1][1]) < 1 && Math.abs(rects[1][1] - 750 * rects[1][2]) < 2, `grid: the frames of #2 and #3 are ${JSON.stringify(rects)} (top, height, zoom), not one 750-high row`)

      // Previews are inert: nothing in them takes a pointer or the focus.
      assert(await page.run(`(() => { const boxes = [...document.querySelectorAll('[data-board] [data-live]')]; return boxes.length > 0 && boxes.every(b => b.inert && getComputedStyle(b).pointerEvents === 'none') })()`), 'previews: a running design on the desk is not inert')
      const at = sel => page.run(`(() => { const r = document.querySelector(${JSON.stringify(sel)})?.getBoundingClientRect(); return r ? [r.left + r.width / 2, r.top + r.height / 2] : null })()`)
      const field = await at('[data-board="share-link/C"] [data-field]')
      assert(field && await page.run(`document.elementFromPoint(${field[0]}, ${field[1]})?.matches('[data-frame]')`), 'previews: the pointer reaches the field inside a preview')
      const scroll = () => page.run(`(() => { const d = document.querySelector('[data-viewer-desk]'); return d.scrollLeft + ',' + d.scrollTop })()`)
      const isOpen = () => page.run(`!!document.querySelector('[data-full]')`)
      assert(await page.run(`(() => { const d = document.querySelector('[data-viewer-desk]'); return d.scrollWidth > d.clientWidth })()`), 'previews: the desk has no room to move, so the checks below would prove nothing')

      // A drag on a preview moves the desk and opens nothing; a plain wheel over one moves the desk.
      let was = await scroll()
      const onB = await at('[data-board="share-link/B"] [data-frame]')
      await page.drag(onB, [onB[0] - 150, onB[1]], 10)
      await sleep(300)
      assert(await scroll() !== was && !await isOpen(), `previews: a drag on #2 did not move the desk, or opened it (${was} to ${await scroll()})`)
      was = await scroll()
      const onC = await at('[data-board="share-link/C"] [data-frame]')
      await page.mouse('mouseWheel', onC[0], onC[1], { button: 'none', deltaX: 200, deltaY: 0 })
      await sleep(400)
      assert(await scroll() !== was, 'previews: a wheel over #3 did not move the desk')

      // A click opens the design full size, live, in a frame of this same page at a device's size
      // (decision 21): its field selects, a wheel scrolls it and not the desk, and the desk's keys
      // stay off. Esc, pressed in the design, goes back to the desk where it was.
      const desk = await scroll(), zoomBefore = await readout()
      const inFrame = expr => page.run(`(() => { const d = document.querySelector('[data-full] iframe')?.contentDocument; return d && d.documentElement.dataset.ready === '1' ? (${expr}) : null })()`)
      const frameText = () => inFrame(`d.body.innerText`)
      await page.press(...await at('[data-board="share-link/C"] [data-frame]'))
      assert(await until(async () => (await frameText())?.includes('MARK-C') && await inFrame(`!!d.querySelector('[data-live]') && !d.querySelector('[data-live]').inert`), 5000), 'full view: a click on #3 did not open it live in a frame')
      await sleep(500)
      assert(await page.run(`!!document.querySelector('[data-viewer-bar] [data-back]') && !!document.querySelector('[data-viewer-bar] [data-device]')`), 'full view: the bar has no way back to the desk, or no device control')
      const full = await inFrame(`(() => { const f = document.querySelector('[data-full] iframe').getBoundingClientRect(), z = document.querySelector('[data-full] iframe').currentCSSZoom, r = d.querySelector('[data-field]').getBoundingClientRect(); return [f.left + r.left * z, f.top + r.top * z, r.width * z, r.height * z] })()`)
      await page.drag([full[0] + 12, full[1] + full[3] / 3], [full[0] + full[2] - 12, full[1] + full[3] / 3], 10)
      await sleep(300)
      assert(await inFrame(`(() => { const t = d.querySelector('[data-field]'); return t.selectionEnd - t.selectionStart })()`) > 0, 'full view: a drag in the design\'s textarea selected nothing')
      const inner = () => inFrame(`d.querySelector('[data-live]').scrollTop`)
      const card = await at('[data-full-card]')
      await page.mouse('mouseWheel', card[0], card[1] + 120, { button: 'none', deltaX: 0, deltaY: 600 })
      await sleep(500)
      assert(await inner() > 0 && await scroll() === desk, `full view: a wheel over the design scrolled it to ${await inner()} and the desk to ${await scroll()} (was ${desk})`)

      // The device sizes: Phone, Tablet (turned), Desktop, each the frame's own width (its
      // breakpoints see the device, not the window).
      const frameW = () => inFrame(`d.defaultView.innerWidth`)
      const pick = async size => {
        await page.press(...await at('[data-viewer-bar] [data-device]'))
        const row = await until(() => at(`[data-size="${size}"]`), 3000)
        assert(row, `devices: the menu has no ${size} row`)
        await page.press(...row)
        await sleep(400)
      }
      await pick('phone')
      assert(await until(async () => await frameW() === 390, 3000), `devices: Phone left the frame ${await frameW()} wide`)
      assert(await page.run(`!!document.querySelector('[data-full] [data-device-frame="phone"]')`), 'devices: Phone is not drawn as a phone')
      await pick('tablet')
      assert(await until(async () => await frameW() === 834, 3000), `devices: Tablet left the frame ${await frameW()} wide`)
      await page.press(...await at('[data-viewer-bar] [data-device]'))
      const turn = await until(() => at('[data-turn]'), 3000)
      assert(turn, 'devices: no Turn for the tablet')
      await page.press(...turn)
      assert(await until(async () => await frameW() === 1194, 3000), `devices: the turned tablet is ${await frameW()} wide`)
      // Esc closes the menu first, and the design stays open.
      await page.key('Escape')
      await sleep(400)
      assert(await isOpen() && !await page.run(`!!document.querySelector('[data-size="tablet"]')`), 'devices: Esc with the menu open did not close only the menu')

      // Zoom: the frame's own CSS zoom, never the page's. +, 0 Fit, 1 100 %, and Ctrl+wheel over the design.
      const fz = () => page.run(`document.querySelector('[data-full] iframe')?.currentCSSZoom ?? 0`)
      const pageZoom = () => page.run(`[visualViewport.scale, devicePixelRatio, document.documentElement.currentCSSZoom].join()`)
      await page.run(`document.activeElement?.blur(); document.body.focus()`)
      await page.key('0')
      await sleep(300)
      const fit = await fz()
      await page.key('1')
      await sleep(300)
      assert(Math.abs(await fz() - 1) < 0.01, `zoom: 1 left the frame at ${await fz()}`)
      await page.key('+')
      await sleep(300)
      assert(await fz() > 1.01, `zoom: + left the frame at ${await fz()}`)
      await page.key('0')
      await sleep(300)
      assert(Math.abs(await fz() - fit) < 0.01, `zoom: 0 did not fit the frame again (${await fz()}, Fit ${fit})`)
      const mid = await at('[data-full-card]')
      for (let i = 0; i < 6; i++) await page.mouse('mouseWheel', mid[0], mid[1], { button: 'none', deltaX: 0, deltaY: -40, modifiers: 2 })
      await sleep(400)
      assert(await fz() > fit + 0.01, `zoom: Ctrl+wheel over the design left the frame at ${await fz()} (Fit ${fit})`)
      assert(await pageZoom() === '1,1,1', `zoom: the page itself zoomed (scale, dpr, zoom: ${await pageZoom()})`)
      assert(await page.run(`getComputedStyle(document.querySelector('[data-full-card]')).transform === 'none'`), 'zoom: the device is scaled with a transform')
      const kept = await page.run(`localStorage.getItem('proto-viewer-device')`)
      assert(/"size":"tablet"/.test(kept || '') && /"land":true/.test(kept || ''), `devices: the choice is not kept in this browser (${kept})`)

      // Esc from inside the design (its field focused) goes back to the desk where it was.
      await inFrame(`d.querySelector('[data-field]').focus()`)
      await page.key('+')
      await page.key('Escape')
      assert(await until(async () => !await isOpen(), 3000), 'full view: Esc in the design did not go back to the desk')
      await sleep(300)
      assert(await scroll() === desk && await readout() === zoomBefore, `full view: back on the desk at ${await scroll()} ${await readout()}, not where it was (${desk} ${zoomBefore})`)
      // Its label opens it too, at the size chosen before, and All designs in the bar goes back.
      await page.run(`document.querySelector('[data-board="share-link/C"] [data-label] button').scrollIntoView({ block: 'center', inline: 'center' })`)
      await sleep(200)
      await page.press(...await at('[data-board="share-link/C"] [data-label] button'))
      assert(await until(isOpen, 3000), 'full view: the label of #3 did not open it')
      assert(await until(async () => await frameW() === 1194, 3000), `devices: reopened, the frame is ${await frameW()} wide, not the turned tablet`)
      await pick('desktop')
      assert(await until(async () => await frameW() === 1440, 3000), `devices: Desktop left the frame ${await frameW()} wide`)
      await page.press(...await at('[data-viewer-bar] [data-back]'))
      assert(await until(async () => !await isOpen(), 3000), 'full view: All designs did not go back to the desk')

      // Signed out, with comments on: Sign in with GitHub, to the apex with this share and the way back.
      const signin = await until(() => page.run(`document.querySelector('[data-viewer-header] [data-signin]')?.href ?? ''`), 3000)
      const apex = new URL(site.url).origin
      assert(signin === `${apex}/auth/github?share=smk123&back=${encodeURIComponent('/s/smk123/')}`, `sign in: the button goes to ${JSON.stringify(signin)}`)

      // The prototypes of the share, in the header's list.
      assert(await page.run(`!!document.querySelector('[data-proto-switch] [data-caret]')`), 'prototype list: the title has no caret')
      const sw = await at('[data-proto-switch]')
      assert(sw, 'prototype list: no title button')
      await page.press(...sw)
      const rows = await until(async () => (await page.run(`document.querySelectorAll('[data-proto-row]').length`)) || 0, 3000)
      assert(rows === 2, `prototype list: it lists ${rows} prototypes`)
      await page.press(...await at('[data-proto-row="lineage-src"]'))
      await until(async () => (await boards()) === 'lineage-src/A', 3000)
      assert(await boards() === 'lineage-src/A', `prototype list: choosing lineage-src left ${JSON.stringify(await boards())}`)
      assert(await until(async () => (await text())?.includes('MARK-LINEAGE-A'), 5000), 'prototype list: lineage-src/A is not mounted')

      await sleep(5000)
      const asked = [...site.state.paths.map(p => p.split(' ')[1]), ...await page.run(`performance.getEntriesByType('resource').map(e => new URL(e.name).pathname)`)]
      assert(!asked.some(p => p.startsWith('/__proto')), `no session calls: the page asked for ${asked.filter(p => p.startsWith('/__proto')).join(', ')}`)

      // A newer version on the host: the next look (focus) says so.
      site.state.version = 2
      await page.run(`window.dispatchEvent(new Event('focus'))`)
      const banner = await until(() => page.run(`document.querySelector('[data-newer]')?.textContent ?? ''`), 5000)
      assert(banner.includes('There is a newer version') && banner.includes('Reload'), `newer version banner: ${JSON.stringify(banner)}`)
      site.state.version = 1
    } finally { page.close() }

    // Signed in (the host's cookie): the viewer's face and login at the top right, a menu with their
    // name and Sign out, which clears the cookie and brings Sign in back.
    const signedIn = await openPage(shareUrl)
    try {
      await signedIn.run(`document.cookie = 'v=octo-smoke; path=/s/smk123/'; location.reload()`)
      await sleep(500)
      await until(() => signedIn.run(`document.documentElement.dataset.ready === '1'`), 10_000)
      const who = await until(() => signedIn.run(`document.querySelector('[data-viewer-header] [data-account]')?.textContent ?? ''`), 5000)
      assert(who?.includes('octo-smoke') && await signedIn.run(`(() => { const i = document.querySelector('[data-account] img'); return !!i && Math.round(i.getBoundingClientRect().width) === 28 })()`), `signed in: the header shows ${JSON.stringify(who)}`)
      const spot = sel => signedIn.run(`(() => { const r = document.querySelector(${JSON.stringify(sel)})?.getBoundingClientRect(); return r ? [r.left + r.width / 2, r.top + r.height / 2] : null })()`)
      await signedIn.press(...await spot('[data-account]'))
      const out = await until(() => spot('[data-signout]'), 3000)
      const menu = await signedIn.run(`document.querySelector('[data-account-menu]')?.textContent ?? ''`)
      assert(out && menu.includes('Octo Smoke') && menu.includes('Signed in with GitHub'), `signed in: the menu reads ${JSON.stringify(menu)}`)
      await signedIn.press(...out)
      assert(await until(() => signedIn.run(`!!document.querySelector('[data-viewer-header] [data-signin]') && !document.querySelector('[data-account]')`), 3000), 'signed in: Sign out did not bring back Sign in')
      assert(!await signedIn.run(`document.cookie.includes('v=octo')`) && site.state.paths.includes('POST /s/smk123/api/signout'), 'signed in: Sign out did not clear the cookie on the host')
    } finally { signedIn.close() }

    // A phone: one design, the switcher, and no sideways gesture changes it.
    const phone = await openPage(site.url, { width: 390, height: 844, phone: true })
    try {
      const live = () => phone.run(`document.querySelectorAll('[data-live]').length`)
      const text = () => phone.run('document.body.innerText')
      await until(async () => (await text())?.includes('MARK-B'))
      assert(await live() === 1, `phone: ${await live()} designs are mounted`)
      const label = () => phone.run(`document.querySelector('[data-switcher]')?.textContent ?? ''`)
      assert(/#2.*·\s*1\/2/.test(await label()), `phone: the switcher reads ${JSON.stringify(await label())}`)
      const next = await phone.run(`(() => { const r = document.querySelector('[data-next]')?.getBoundingClientRect(); return r ? [r.left + r.width / 2, r.top + r.height / 2] : null })()`)
      assert(next, 'phone: the switcher has no next button')
      await phone.press(...next)
      assert(await until(async () => (await text())?.includes('MARK-C'), 3000), 'phone: › did not show MARK-C')
      assert(await live() === 1 && !(await text()).includes('MARK-B'), `phone: after ›, ${await live()} designs are mounted`)
      const box = await phone.run(`(() => { const r = document.querySelector('[data-live]').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2] })()`)
      await phone.mouse('mouseWheel', box[0], box[1], { button: 'none', deltaX: 600, deltaY: 0 })
      await phone.drag([box[0] + 120, box[1]], [box[0] - 120, box[1]])
      await phone.touch('touchStart', [[box[0] + 120, box[1]]])
      for (let i = 1; i <= 8; i++) await phone.touch('touchMove', [[box[0] + 120 - i * 30, box[1]]])
      await phone.touch('touchEnd', [])
      await sleep(600)
      assert((await text()).includes('MARK-C') && /·\s*2\/2/.test(await label()), `phone: a sideways wheel, drag or swipe changed the design (${JSON.stringify(await label())})`)
    } finally { phone.close() }
    const asked = site.state.paths.map(p => p.split(' ')[1]).filter(p => p.startsWith('/__proto'))
    assert(!asked.length, `no session calls: the host was asked for ${asked.join(', ')}`)
  } finally { site.close() }

  // Opened from disk: no host, no state to ask for, no errors.
  const dir = mkdtempSync(join(tmpdir(), 'proto-share-file-'))
  writeFileSync(join(dir, 'share.html'), html)
  const file = await openPage(pathToFileURL(join(dir, 'share.html')).href, { errors: true })
  try {
    assert(await until(async () => (await file.run('document.body.innerText'))?.includes('MARK-B')), 'file open: MARK-B is not on the page')
    await sleep(500)
    const errors = file.errors()
    assert(!errors.length, `file open: the page reported ${JSON.stringify(errors)}`)
  } finally { file.close(); rmSync(dir, { recursive: true, force: true }) }

  // Twenty designs: at most 8 run at once, the nearest; panning to the end moves them there.
  const letters = Array.from({ length: 20 }, (_, i) => String.fromCharCode(65 + i))
  proto(['add', 'many', '--title', 'Many', '--variants', letters.map(l => `${l}:Design ${l}`).join(',')])
  for (const l of letters) writeFileSync(join(protos, `many/${l}.tsx`), `export default function ${l}() { return <main style={{ padding: 40 }}><h1>MARK-MANY-${l}</h1></main> }\n`)
  const manyHtml = await build({ protos: [{ id: 'many', variants: letters }], start: 'many/A' })
  const many = await host(manyHtml)
  try {
    const page = await openPage(many.url)
    try {
      const live = () => page.run(`[...document.querySelectorAll('[data-board]')].filter(b => b.querySelector('[data-live]')).map(b => b.dataset.board.split('/')[1])`)
      await until(async () => (await live())?.length > 0)
      await sleep(800)
      let most = 0
      const look = async () => { const l = await live(); most = Math.max(most, l.length); return l }
      const atFit = await look()
      assert(atFit.length > 0 && atFit.length <= 8, `mount policy: ${atFit.length} live at Fit (${atFit})`)
      await page.run(`document.querySelector('[data-viewer-desk]')?.focus()`)
      await page.key('1')
      await sleep(800)
      await look()
      for (let i = 1; i <= 10; i++) {
        await page.run(`(() => { const d = document.querySelector('[data-viewer-desk]'); d.scrollLeft = (d.scrollWidth - d.clientWidth) * ${i / 10}; d.scrollTop = (d.scrollHeight - d.clientHeight) * ${i / 10} })()`)
        await sleep(150)
        await look()
      }
      await sleep(800)
      const end = await look()
      assert(most <= 8, `mount policy: ${most} designs were live at once`)
      assert(end.includes('T') && !end.includes('A'), `mount policy: at the far end the live ones are ${end}`)
    } finally { page.close() }
  } finally { many.close() }

  // Hebrew: the chrome reads right to left, the desk keeps its order.
  const sessionFile = join(app, 'session.json')
  const before = readFileSync(sessionFile, 'utf8')
  writeFileSync(sessionFile, JSON.stringify({ ...JSON.parse(before), lang: 'he' }, null, 2) + '\n')
  let heHtml
  try { heHtml = await build({ protos: [{ id: 'share-link', variants: ['B', 'C'] }], start: 'share-link/B' }) } finally { writeFileSync(sessionFile, before) }
  const he = await host(heHtml)
  try {
    const page = await openPage(he.url)
    try {
      await until(async () => (await page.run('document.body.innerText'))?.includes('MARK-C'))
      const dirs = await page.run(`[document.querySelector('[data-viewer-header]')?.getAttribute('dir'), document.querySelector('[data-viewer-bar]')?.getAttribute('dir')].join(' ')`)
      assert(dirs === 'rtl rtl', `hebrew share is rtl: header and bar have dir ${JSON.stringify(dirs)}`)
      const order = await page.run(`[...document.querySelectorAll('[data-board]')].sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left).map(b => b.dataset.board).join(' ')`)
      assert(order === 'share-link/B share-link/C', `hebrew share is rtl: the artboards read ${JSON.stringify(order)} from the left`)
    } finally { page.close() }
  } finally { he.close() }
  console.log('share viewer: checks passed')
}

// Share links, part 3: `proto share` itself, publishing to a host on this Mac (wrangler dev). Every
// command runs with HOME in a folder of this run and the file token store, so the run never writes
// to the login Keychain, ~/.config/prototype or ~/.prototypes/host; the pinned tools come from the
// usual ~/.prototypes/share-tools through PROTO_SHARE_TOOLS rather than a second install.
async function hostChecks({ app, openPage, fail }) {
  const project = dirname(dirname(app))
  const home = mkdtempSync(join(tmpdir(), 'proto-share-home-'))
  const env = { ...process.env, HOME: home, PROTO_SHARE_TOKEN_STORE: 'file', PROTO_SHARE_TOOLS: tools }
  delete env.PROTO_SHARE_NO_START
  let dummy = null
  const share = (args, extra = {}) => {
    console.log(`\n$ proto share ${args.join(' ')}`)
    const r = spawnSync(process.execPath, [join(skill, 'scripts', 'proto.mjs'), 'share', ...args, '--project', project, '--session', 'smoke'], { env: { ...env, ...extra }, encoding: 'utf8', timeout: 600_000 })
    process.stdout.write(r.stdout || '')
    process.stderr.write(r.stderr || '')
    return { status: r.status, out: (r.stdout || '') + (r.stderr || '') }
  }
  // A failure stops the host and frees 8787 before the run gives up, so neither outlives it.
  const cleanup = () => {
    spawnSync(process.execPath, [join(skill, 'scripts', 'proto.mjs'), 'share', 'stop', '--project', project, '--session', 'smoke'], { env, stdio: 'ignore', timeout: 60_000 })
    dummy?.close()
    rmSync(home, { recursive: true, force: true })
  }
  // A throw the asserts don't see (a page that hangs) ends the run through the harness's own
  // fail(), which exits: the host and the dummy go with it.
  process.once('exit', cleanup)
  const assert = (ok, why) => { if (!ok) { cleanup(); fail(`share host: ${why}`) } }
  const keychain = () => process.platform === 'darwin' && spawnSync('security', ['find-generic-password', '-s', 'prototype-share-local'], { stdio: 'ignore' }).status === 0
  const realHosts = join(homedir(), '.config', 'prototype', 'hosts.json')
  const before = { keychain: keychain(), hosts: existsSync(realHosts) ? readFileSync(realHosts, 'utf8') : null, host: existsSync(join(homedir(), '.prototypes', 'host')) }
  const linkIn = out => (out.match(/^link (\S+)/m) || [])[1]
  const portOf = url => Number(new URL(url).port)
  const answer = async (url, init) => { try { const r = await fetch(url, { signal: AbortSignal.timeout(10_000), ...init }); return { status: r.status, text: await r.text() } } catch (e) { return { status: 0, text: String(e?.cause?.code || e) } } }
  // The bytes as they come off the wire, with no Accept-Encoding: the stored gzip, sent once.
  const raw = url => new Promise(ok => get(url, res => { const parts = []; res.on('data', d => parts.push(d)).on('end', () => ok({ headers: res.headers, body: Buffer.concat(parts) })) }).on('error', () => ok(null)))
  const sharesFile = join(app, '.proto', 'shares.json')
  const entries = () => existsSync(sharesFile) ? JSON.parse(readFileSync(sharesFile, 'utf8')) : []

  // A file before any host exists: no owner name, so the viewer says no "by" at all.
  const header = () => `[...document.querySelectorAll('[data-viewer-header] *')].map(e => e.textContent).join('|')`
  const bare = join(home, 'no-owner.html')
  const plain = share(['file', 'share-link/2', '--out', bare])
  assert(plain.status === 0 && existsSync(bare), `file without a host: exited ${plain.status}`)
  const noOwner = await openPage(pathToFileURL(bare).href)
  try {
    await until(async () => (await noOwner.run('document.body.innerText'))?.includes('MARK-B'))
    const text = await noOwner.run(header())
    assert(text.includes('Read-only') && !/\bby\b/.test(text), `file without a host: the header reads ${JSON.stringify(text.slice(0, 200))}`)
  } finally { noOwner.close() }
  assert(/<noscript>[^]*needs JavaScript[^]*<\/noscript>/.test(readFileSync(bare, 'utf8')), 'noscript: the share does not say it needs JavaScript')

  const setup = share(['setup', '--local', '--name', 'Smoke'])
  assert(setup.status === 0, `setup --local exited ${setup.status}`)
  const hosts = JSON.parse(readFileSync(join(home, '.config', 'prototype', 'hosts.json'), 'utf8'))
  assert(hosts.length === 1 && hosts[0].stage === 'local' && hosts[0].default === true, `setup: hosts.json is ${JSON.stringify(hosts)}`)
  const token = join(home, '.config', 'prototype', 'token-local')
  assert(existsSync(token) && (statSync(token).mode & 0o777) === 0o600, 'setup: no token file with mode 600 in the file store')

  const one = share(['share-link/2', 'share-link/3', '--yes'])
  const link = linkIn(one.out)
  assert(one.status === 0 && link, `publish: exited ${one.status} without a link`)
  const page = await answer(link)
  assert(page.status === 200 && page.text.includes('MARK-B') && page.text.includes('MARK-C'), `publish: ${link} answered ${page.status} without MARK-B and MARK-C`)
  const wire = await raw(link)
  assert(wire?.headers['content-encoding'] === 'gzip' && wire.body[0] === 0x1f && wire.body[1] === 0x8b && gunzipSync(wire.body).toString().includes('MARK-B'), 'publish: the page is not the stored gzip, sent once')
  const id = entries().at(-1)?.id
  assert(id && link.includes(id) && entries().at(-1).version === 1 && entries().at(-1).host === 'local', `publish: .proto/shares.json has ${JSON.stringify(entries())}`)
  assert(existsSync(join(app, '.proto', 'shares', id, 'v1', 'share-link', 'B.tsx')), 'publish: the snapshot of share-link is missing')
  const port = portOf(link)

  // The served link in Chrome: the viewer boots, nothing errs, and nothing reaches for a session server.
  const viewer = await openPage(link, { errors: true })
  try {
    assert(await until(async () => (await viewer.run('document.body.innerText'))?.includes('MARK-B')), `served link: MARK-B is not on ${link} in Chrome`)
    await sleep(1500)
    const asked = await viewer.run(`performance.getEntriesByType('resource').map(e => new URL(e.name).pathname)`)
    assert(!asked.some(p => p.startsWith('/__proto')), `served link: the page asked for ${asked.filter(p => p.startsWith('/__proto')).join(', ')}`)
    assert(!viewer.errors().length, `served link: the page reported ${JSON.stringify(viewer.errors())}`)
  } finally { viewer.close() }

  // A planted fake key blocks the publish: exit 1, the review says why, nothing uploaded or written.
  const bFile = join(app, 'src', 'protos', 'share-link', 'B.tsx'), bSource = readFileSync(bFile, 'utf8')
  const listed = () => share(['ls', '--all']).out.split('\n').filter(l => /^[0-9a-z]{10} /.test(l)).sort().join('\n')
  const hostBefore = listed(), entriesBefore = entries().length
  writeFileSync(bFile, bSource.replace('<h1>MARK-B</h1>', '<h1>MARK-B</h1><span hidden>AKIAABCDEFGHIJ234567</span>'))
  let blocked
  try { blocked = share(['share-link/2', '--yes']) } finally { writeFileSync(bFile, bSource) }
  assert(blocked.status === 1 && /looks like a secret/.test(blocked.out), `planted key: exited ${blocked.status} without the review's message`)
  assert(entries().length === entriesBefore && listed() === hostBefore, 'planted key: something was uploaded or written to .proto/shares.json')

  const ls = share(['ls'])
  assert(ls.status === 0 && ls.out.includes(id), `ls: ${id} is not listed`)
  // The apex /<id> is the page link previews read; it sends a browser on to the link.
  const apexAt = link.includes('/s/') ? `http://127.0.0.1:${port}/${id}` : `http://localhost:${port}/${id}`
  const apex = await answer(apexAt)
  assert(apex.status === 200 && apex.text.includes(`url=${link}`), `apex: ${apexAt} does not lead to ${link}`)

  const out = join(home, 'one-file.html')
  const file = share(['file', 'share-link/2', '--out', out])
  assert(file.status === 0 && existsSync(out), `file: exited ${file.status}, ${out} not written`)
  const opened = await openPage(pathToFileURL(out).href)
  try {
    assert(await until(async () => (await opened.run('document.body.innerText'))?.includes('MARK-B')), 'file: MARK-B is not on the page')
    assert((await opened.run(header())).includes('by Smoke'), 'file: the owner from the host is not in the header')
  } finally { opened.close() }

  // A lost token while the host runs: setup makes a new one rather than saying everything is fine.
  rmSync(join(home, '.config', 'prototype', 'token-local'))
  assert(share(['setup', '--local']).status === 0 && existsSync(join(home, '.config', 'prototype', 'token-local')), 'lost token: setup did not make a new one')
  assert(share(['ls']).status === 0, 'lost token: the new token does not open the host')

  const rm = share(['rm', id])
  assert(rm.status === 0, `rm exited ${rm.status}`)
  assert((await answer(link)).status === 410, 'rm: the link does not answer 410')
  assert(!entries().some(e => e.id === id) && existsSync(join(app, '.proto', 'shares', id, 'v1')), 'rm: the entry is still there, or the snapshot went with it')

  // The host down: the next share starts it again.
  assert(share(['stop']).status === 0 && (await answer(`http://127.0.0.1:${port}/_health`)).status === 0, 'host down: stop left the host answering')
  const again = share(['share-link/2', '--yes'])
  assert(again.status === 0 && (await answer(linkIn(again.out) || 'http://0/')).status === 200, `host down: the share after a stop exited ${again.status}`)

  // 8787 taken by something else: the host moves to the next free port, and the link with it. The
  // other server listens on :: (as many dev servers do), which a bind on 127.0.0.1 alone can't see.
  share(['stop'])
  dummy = createServer((req, res) => res.end('not the host'))
  const taken = await new Promise(ok => dummy.once('error', () => { dummy = null; ok(false) }).listen({ port: 8787, host: '::' }, () => ok(true)))
  if (!taken) console.log('share host: 8787 is already taken on this machine; the port check runs against that')
  const moved = share(['share-link/3', '--yes'])
  const movedLink = linkIn(moved.out)
  assert(moved.status === 0 && movedLink, `port taken: exited ${moved.status}`)
  const movedPort = portOf(movedLink)
  assert(movedPort >= 8788 && movedPort <= 8799 && (await answer(movedLink)).status === 200, `port taken: the link ${movedLink} is not on a port from 8788 to 8799 that answers`)
  dummy?.close()
  dummy = null

  // An upload that fails (host stopped, not allowed to start) leaves nothing behind.
  share(['stop'])
  const count = entries().length, folders = readdirSync(join(app, '.proto', 'shares')).length
  const failed = share(['share-link/2', '--yes'], { PROTO_SHARE_NO_START: '1' })
  assert(failed.status === 1 && /share host "local"/.test(failed.out), `failed upload: exited ${failed.status}, or the message does not name the host`)
  assert(entries().length === count && readdirSync(join(app, '.proto', 'shares')).length === folders, 'failed upload: something was written to .proto/shares')

  share(['stop'])
  process.removeListener('exit', cleanup)
  assert(keychain() === before.keychain, 'isolation: the login Keychain gained a prototype-share-local item')
  assert((existsSync(realHosts) ? readFileSync(realHosts, 'utf8') : null) === before.hosts && existsSync(join(homedir(), '.prototypes', 'host')) === before.host, 'isolation: the real ~/.config/prototype or ~/.prototypes/host changed')
  rmSync(home, { recursive: true, force: true })
  console.log('share host: checks passed')
}
