// Share links, part 1: a real share build of chosen variants from the smoke's own session, into
// one HTML file. What must be in it (the two variants, a helper they borrow, their images as
// WebP, a CSS background, the slot pick of the moment) and what must never be (the other
// variants, the borrowed prototype's own meta, the owner's asks, this machine's paths). The
// session's dev server and its own dist/ are left as they were, and two publishes at once take
// turns. sharp is installed into ~/.prototypes/share-tools here until `proto share` does it.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { crc32, deflateSync } from 'node:zlib'
import { createRequire } from 'node:module'

const skill = dirname(dirname(fileURLToPath(import.meta.url)))
const tools = join(homedir(), '.prototypes', 'share-tools')

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

export async function shareLinkChecks({ proto, app, local, fail }) {
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
}
