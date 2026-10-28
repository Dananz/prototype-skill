// Unit checks for the share-link pieces that need no browser: scope parsing, trimming and the pre-publish review.
import './share-owner-checks.mjs'
import './share-online-unit-checks.mjs'
import './share-popover-unit-checks.mjs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ShareError, parseScope, trimMeta, trimSession } from '../app/share/scope.mjs'
import { review } from '../app/share/review.mjs'
import { stampSource, stampsPlugin } from '../app/share/stamps.mjs'
import { imagesPlugin } from '../app/share/images.mjs'
import { imageNames, loadSharp, shareTags } from '../app/share/plugin.mjs'
import { inlineHtml } from '../app/share/inline.mjs'
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

const pricing = { id: 'pricing', variants: ['A', 'B', 'C', 'D', 'E'], archived: false }
const old = { id: 'old', variants: ['A'], archived: true }
const protos = [pricing, old, { id: 'home', variants: ['A', 'B'], archived: false }]
const bad = (words, all, word) => assert.throws(() => parseScope(words, all, protos), e => e instanceof ShareError && e.message.includes(word))

test('parseScope numbers and letters', () => {
  assert.deepEqual(parseScope(['pricing/2', 'pricing/C'], false, protos), { protos: [{ id: 'pricing', variants: ['B', 'C'] }], start: 'pricing/B' })
})
test('parseScope whole prototype', () => {
  assert.deepEqual(parseScope(['pricing'], false, protos).protos, [{ id: 'pricing', variants: ['A', 'B', 'C', 'D', 'E'] }])
})
test('parseScope --all skips archived', () => {
  const s = parseScope([], true, protos)
  assert.deepEqual(s.protos.map(p => p.id), ['pricing', 'home'])
  assert.equal(s.start, 'pricing/A')
})
test('parseScope rejects', () => {
  bad(['nope'], false, 'nope')
  bad(['pricing/9'], false, 'pricing/9')
  bad([], false, 'prototype')
})
test('parseScope rejects prototypes without variants', () => {
  const empty = [{ id: 'x', variants: [], archived: false }]
  for (const [words, all] of [[['x'], false], [['x/A'], false], [[], true]]) {
    assert.throws(() => parseScope(words, all, empty), e => e instanceof ShareError && (all || e.message.includes('"x"')))
  }
})
test('trimMeta drops owner data', () => {
  const meta = { title: 'T', kind: 'web', screen: [1, 2], created: 'x', states: [], variants: { A: 'a', B: 'b' }, about: { A: 'x', B: 'y' }, ask: 'q', picked: 'A', favorites: ['A'], archived: true, count: 3, from: 'home/B', mystery: 1 }
  const out = trimMeta(meta, ['B'], new Set(['pricing']))
  assert.deepEqual(out, { title: 'T', kind: 'web', screen: [1, 2], created: 'x', states: [], variants: { B: 'b' }, about: { B: 'y' } })
})
test('trimMeta keeps lineage inside the share', () => {
  const out = trimMeta({ title: 'T', from: 'home/B', also: ['home/A', 'style/B'], slot: 's' }, [], new Set(['home']))
  assert.equal(out.from, 'home/B')
  assert.deepEqual(out.also, ['home/A'])
  assert.equal(out.slot, 's')
})
test('trimSession keeps lang', () => {
  assert.deepEqual(trimSession({ name: 'X', stack: 'react', lang: 'he', project: '/Users/x', url: 'https://m.ts.net', port: 5173, asks: [1] }), { name: 'X', stack: 'react', lang: 'he' })
  assert.equal(trimSession({ name: 'X', stack: 'react' }).lang, 'en')
})

const clean = { html: '<p>hello</p>', gzBytes: 1000, projectPath: '/Users/x/proj', home: '/Users/x', projectImports: [], currents: [] }
const run = over => review({ ...clean, ...over })
const codes = list => list.map(f => f.code)

test('review passes a clean share', () => {
  assert.deepEqual(run({}), { block: [], warn: [] })
})
test('secret blocks, one pattern each', () => {
  const fakes = {
    'private key': '-----BEGIN RSA PRIVATE KEY-----',
    'sk-': 'sk-' + 'a1B2'.repeat(6),
    'github': 'ghp_' + 'a1B2c3'.repeat(6),
    'aws': 'AKIA' + 'ABCD1234EFGH5678',
    'jwt': 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3.SflKxwRJSMeKKF2QT4fw',
    'bearer': 'Bearer abcdefghij0123456789.xyz',
    'doppler': 'dp.st.' + 'abcDEF1234'.repeat(2),
    'stripe live': 'sk_live_' + 'abcDEF1234'.repeat(2),
    'stripe restricted': 'rk_live_' + 'abcDEF1234'.repeat(2),
    'supabase': 'sb_secret_' + 'abcDEF_123-'.repeat(2),
  }
  for (const [name, value] of Object.entries(fakes)) {
    const r = run({ html: `<script>const k = "${value}"</script>` })
    assert.deepEqual(codes(r.block), ['secret'], name)
    assert.ok(!r.block[0].where.includes(value), `${name} is masked`)
    assert.ok(r.block[0].where.includes(value.slice(0, 4) + '…'), `${name} keeps its first four characters`)
  }
})
test('secret reports one finding per match', () => {
  const k = 'AKIA' + 'ABCD1234EFGH5678'
  assert.equal(run({ html: `${k} and ${k.replace('A', 'B')} and ${k}` }).block.length, 2)
})
test('a bearer jwt is one secret, not two', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3.SflKxwRJSMeKKF2QT4fw'
  assert.equal(run({ html: `Authorization: Bearer ${jwt}` }).block.length, 1)
})
test('a jwt after = is a secret', () => {
  assert.deepEqual(codes(run({ html: 'fetch("/api?apikey=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3.SflKxwRJSMeKKF2QT4fw")' }).block), ['secret'])
})
test('jwt in a data url is not a secret', () => {
  const body = 'AAAA/eyJhbGciOiJIUzI1NiJ9+eyJzdWIiOiIxMjM0NTY3-abcdefghijklmnop'
  assert.deepEqual(run({ html: `<img src="data:image/webp;base64,${body}">` }).block, [])
  assert.deepEqual(run({ html: 'x/eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3.SflKxwRJSMeKKF2QT4fw' }).block, [])
})
test('abs path blocks', () => {
  assert.deepEqual(codes(run({ html: 'at /Users/x/proj/src/a.tsx' }).block), ['abs-path'])
  assert.deepEqual(run({ html: 'at /Users/x/proj/src/a.tsx and /Users/x/other' }).block.map(f => f.where), ['/Users/x/proj', '/Users/x'])
  assert.deepEqual(codes(run({ html: 'at /Users/x/other' }).block), ['abs-path'])
  assert.deepEqual(codes(run({ html: 'C:\\Users\\x\\proj', projectPath: 'C:/Users/x/proj', home: '/nowhere' }).block), ['abs-path'])
  assert.deepEqual(run({ html: 'nothing here' }).block, [])
})
test('size thresholds', () => {
  const mib = 2 ** 20
  assert.deepEqual(run({ gzBytes: 5 * mib }), { block: [], warn: [] })
  assert.deepEqual(codes(run({ gzBytes: 5 * mib + 1 }).warn), ['heavy'])
  assert.deepEqual(codes(run({ gzBytes: 20 * mib }).block), [])
  const big = run({ gzBytes: 20 * mib + 1 })
  assert.deepEqual(codes(big.block), ['too-big'])
  assert.deepEqual(codes(big.warn), [])
})
test('project code and real screens warn', () => {
  const r = run({ projectImports: ['/p/src/Button.tsx', '/p/src/ui/Card.tsx'], currents: ['home/A'] })
  assert.deepEqual(codes(r.warn), ['project-code', 'real-screens'])
  assert.ok(r.warn[0].message.includes('Button.tsx') && r.warn[0].message.includes('Card.tsx'))
})
test('outside urls warn once per origin', () => {
  const r = run({ html: '<img src="https://cdn.example.com/a.png"><img src="https://cdn.example.com/b.png"><a href="http://other.io/x">' })
  assert.deepEqual(r.warn.map(f => f.where), ['https://cdn.example.com', 'http://other.io'])
})
test('google fonts are not outside', () => {
  const html = '<link href="https://fonts.googleapis.com/css2?family=Inter"><link href="https://fonts.gstatic.com/s/inter.woff2">'
  assert.deepEqual(run({ html }), { block: [], warn: [] })
})
test('private urls warn', () => {
  for (const url of ['http://localhost:5173/a', 'http://127.0.0.1:3000', 'https://mac.tail1234.ts.net/x', 'http://10.0.0.5/a', 'http://192.168.1.2/a', 'http://172.16.0.1/a', 'http://172.31.9.9/a']) {
    assert.ok(codes(run({ html: `<img src="${url}">` }).warn).includes('private-url'), url)
  }
  assert.ok(!codes(run({ html: '<img src="http://172.32.0.1/a">' }).warn).includes('private-url'))
})
test('a private origin is one private-url and never an outside-url', () => {
  const html = Array.from({ length: 30 }, (_, i) => `<img src="http://localhost:5173/p${i}.png">`).join('')
  const r = run({ html })
  assert.deepEqual(r.warn.map(f => [f.code, f.where]), [['private-url', 'http://localhost:5173']])
  assert.ok(r.warn[0].message.includes('30'))
})
test('a url that is only text does not warn', () => {
  const html = '<script>const e = "https://react.dev/errors/" + n; // see https://base-ui.com/x\nconst ns = "http://www.w3.org/2000/svg"</script><svg xmlns="http://www.w3.org/2000/svg"></svg>'
  assert.deepEqual(run({ html }).warn, [])
})
test('urls in loading positions warn', () => {
  const html = '<script>h("img",{src:"https://a.example/x.png"});fetch(`https://b.example/api`);import("https://c.example/m.js")</script><img srcset="https://d.example/1x.png 1x, https://e.example/2x.png 2x"><style>@import "https://f.example/s.css";.x{background:url(https://g.example/b.png)}</style><video poster=https://h.example/p.jpg>'
  assert.deepEqual(run({ html }).warn.map(f => f.where).sort(), ['https://a.example', 'https://b.example', 'https://c.example', 'https://d.example', 'https://e.example', 'https://f.example', 'https://g.example', 'https://h.example'])
})
test('absolute asset path is reported', () => {
  assert.deepEqual(run({ html: '<img src="/assets/a.png">' }).warn.map(f => [f.code, f.where]), [['private-url', '/assets/a.png']])
  assert.deepEqual(run({ html: '.a{background:url(/img/b.png)} .b{background:url("/img/c.png")}' }).warn.map(f => f.where), ['/img/b.png', '/img/c.png'])
  assert.deepEqual(run({ html: '<img src="//cdn.example.com/a.png"><img src="data:image/png;base64,AAAA"><img src="a.png">' }).warn, [])
})

// Node has no JS parser of its own. The stamps are written against Rolldown's (the one Vite hands a
// plugin as this.parse), so the checks borrow it from any session that has Vite installed.
function sessionParser() {
  const dir = join(homedir(), '.claude', 'skills', 'prototype', '.prototypes')
  const roots = existsSync(dir) ? readdirSync(dir).map(d => join(dir, d)) : []
  for (const root of [process.cwd(), ...roots]) {
    try {
      const vite = createRequire(join(root, 'package.json')).resolve('vite')
      const { parseSync } = createRequire(vite)('rolldown/utils')
      return code => parseSync('stamped.js', code).program
    } catch {}
  }
  return null
}
const parse = sessionParser()
const noParser = parse ? false : 'no session with vite installed, so no parser (Task 4 smoke covers this end to end)'

// What the dev JSX transform leaves behind (Vite 8, Oxc, development: true), with the owner's disk path in it.
const transformed = `var _jsxFileName = "/Users/me/s/src/protos/pricing/parts.tsx";
import { jsxDEV as _jsxDEV } from "react/jsx-dev-runtime";
export function PriceCard({ items }) {
\treturn /* @__PURE__ */ _jsxDEV("ul", { children: items.map((i) => /* @__PURE__ */ _jsxDEV("li", { children: i }, i, false, {
\t\tfileName: _jsxFileName,
\t\tlineNumber: 1,
\t\tcolumnNumber: 67
\t}, this)) }, void 0, false, {
\t\tfileName: _jsxFileName,
\t\tlineNumber: 1,
\t\tcolumnNumber: 47
\t}, this);
}
const Badge = memo(() => /* @__PURE__ */ _jsxDEV("b", { children: "x" }, void 0, false, { fileName: _jsxFileName, lineNumber: 2, columnNumber: 21 }, this));
const helper = () => /* @__PURE__ */ _jsxDEV("i", {}, void 0, false, { fileName: _jsxFileName, lineNumber: 3, columnNumber: 5 }, this);
export default function () {
\treturn /* @__PURE__ */ _jsxDEV(Badge, {}, void 0, false, { fileName: _jsxFileName, lineNumber: 4, columnNumber: 42 }, this);
}
`

test('stamps rewrite', { skip: noParser }, () => {
  const out = stampSource(transformed, parse(transformed), 'pricing/parts.tsx')
  assert.ok(!out.includes('/Users/me'), 'the owner path is gone')
  assert.equal(out.match(/fileName: "\/src\/protos\/pricing\/parts\.tsx"/g).length, 5)
  assert.equal(out.split('componentName: "PriceCard"').length - 1, 2, 'the tag in the .map callback and the outer one are both PriceCard')
  assert.equal(out.split('componentName: "Badge"').length - 1, 1, 'a memo-wrapped arrow takes the name it is assigned to')
  assert.equal(out.split('componentName').length - 1, 3, 'a lowercase helper and an anonymous default export get none')
  assert.doesNotThrow(() => parse(out), 'the result still parses')
})
test('stampsPlugin only touches files under protosDir', { skip: noParser }, () => {
  const plugin = stampsPlugin({ protosDir: '/Users/me/s/src/protos' })
  assert.equal(plugin.enforce, 'post')
  const ctx = { parse: code => parse(code) }
  assert.equal(plugin.transform.call(ctx, transformed, '/Users/me/s/src/shell/x.tsx'), null)
  assert.equal(plugin.transform.call(ctx, transformed, '/Users/me/s/src/protos-other/x.tsx'), null)
  const out = plugin.transform.call(ctx, transformed, '/Users/me/s/src/protos/pricing/parts.tsx?v=2')
  assert.ok(out.code.includes('fileName: "/src/protos/pricing/parts.tsx"'))
})
test('imagesPlugin without sharp leaves the file and says so', async () => {
  const plugin = imagesPlugin({ sharp: null, root: '/s' })
  imagesPlugin.warnings.length = 0
  assert.equal(plugin.enforce, 'pre')
  assert.equal(await plugin.load('/s/src/protos/a/hero.png'), null)
  assert.equal(imagesPlugin.warnings.length, 1)
  assert.equal(await plugin.load('/s/src/protos/a/app.tsx'), null)
  assert.equal(imagesPlugin.warnings.length, 1)
})
test('imagesPlugin turns a picture into a capped WebP', async () => {
  const calls = []
  const fake = (meta = { width: 4000, height: 3000 }) => file => {
    const img = { rotate: () => (calls.push(['rotate']), img), metadata: async () => (calls.push(['metadata']), meta), resize: o => (calls.push(['resize', o.width]), img), webp: o => (calls.push(['webp', o.quality]), img), toBuffer: async () => Buffer.from('WEBP') }
    calls.push(['input', file])
    return img
  }
  const plugin = imagesPlugin({ sharp: fake(), root: '/s' })
  assert.equal(await plugin.load('/elsewhere/a.png'), null)
  assert.equal(await plugin.load('/s/a.png'), `export default "data:image/webp;base64,${Buffer.from('WEBP').toString('base64')}"`)
  assert.deepEqual(calls, [['input', '/s/a.png'], ['rotate'], ['metadata'], ['resize', 2560], ['webp', 82]])
  assert.ok((await plugin.load('/s/b.jpeg?url')).startsWith('export default "data:image/webp'))
})
test('imagesPlugin turns a photo upright before it measures it', async () => {
  const calls = []
  const sharp = () => {
    const img = { rotate: () => (calls.push('rotate'), img), metadata: async () => (calls.push('metadata'), { width: 3000, height: 1800, orientation: 6 }), resize: o => (calls.push(`resize ${o.width}`), img), webp: () => img, toBuffer: async () => Buffer.from('W') }
    return img
  }
  await imagesPlugin({ sharp, root: '/s' }).load('/s/phone.jpg')
  // Stored 3000 wide but shown 1800 wide (a quarter turn), so 1800 is the width and it is not enlarged.
  assert.deepEqual(calls, ['rotate', 'metadata', 'resize 1800'])
})
test('imageNames keeps literal names and notices worked-out ones', () => {
  const plain = imageNames([['a/A.tsx', `const x = image('hero'); const y = image("logo") ?? z; const t = image(\`tile\`); const bg = 'background-image(none)'`]])
  assert.deepEqual([...plain.names].sort(), ['hero', 'logo', 'tile'])
  assert.deepEqual(plain.dynamic, [])
  const worked = imageNames([['a/B.tsx', 'image(`kiosk-${id}`)'], ['a/C.tsx', 'image(name)'], ['a/D.tsx', "image('ok')"]])
  assert.deepEqual(worked.dynamic, ['a/B.tsx', 'a/C.tsx'])
})
test('inlineHtml puts the script and stylesheet in the page, and refuses any other file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'inline-check-'))
  try {
    mkdirSync(join(dir, 'assets'))
    writeFileSync(join(dir, 'index.html'), '<html><head><script type="module" crossorigin src="/assets/index-a1.js"></script><link rel="stylesheet" crossorigin href="/assets/index-b2.css"></head><body></body></html>')
    writeFileSync(join(dir, 'assets/index-a1.js'), 'const s = "</script>"; console.log("$&", s)')
    writeFileSync(join(dir, 'assets/index-b2.css'), 'body{color:red}')
    const html = inlineHtml(dir)
    assert.equal(html, '<html><head><script type="module">const s = "<\\/script>"; console.log("$&", s)</script><style>body{color:red}</style></head><body></body></html>')
    writeFileSync(join(dir, 'assets/logo.svg'), '<svg/>')
    assert.throws(() => inlineHtml(dir), e => e instanceof ShareError && e.message.includes('assets/logo.svg'))
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
const sharp = loadSharp()
test('imagesPlugin with the real sharp turns an orientation-6 photo upright', { skip: sharp ? false : 'sharp is not installed in ~/.prototypes/share-tools' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'images-check-'))
  try {
    const file = join(dir, 'phone.jpg')
    writeFileSync(file, await sharp({ create: { width: 30, height: 20, channels: 3, background: '#2563eb' } }).jpeg().withMetadata({ orientation: 6 }).toBuffer())
    const code = await imagesPlugin({ sharp, root: dir }).load(file)
    const webp = Buffer.from(code.match(/base64,([^"]+)/)[1], 'base64')
    const { width, height, format } = await sharp(webp).metadata()
    assert.deepEqual({ width, height, format }, { width: 20, height: 30, format: 'webp' })
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

// The host Worker, run against in-memory fakes: KV is a Map, D1 is node:sqlite with the real schema.
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import worker from '../host/worker.mjs'
import { newId, isId } from '../host/lib/ids.mjs'
import { route } from '../host/lib/routes.mjs'

const TOKEN = 'owner-token-for-tests'
const BASE = 'localhost:8787'
const hex = async s => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map(b => b.toString(16).padStart(2, '0')).join('')

async function makeEnv(extra = {}) {
  const sql = new DatabaseSync(':memory:')
  sql.exec(readFileSync(new URL('../host/schema.sql', import.meta.url), 'utf8'))
  // Signed in with GitHub already, as a new share needs once the host can run sign-in (the gate's own
  // test signs the owner out first).
  sql.prepare('INSERT INTO owners (id, name, created_at, gh_id, gh_login, gh_name, gh_avatar) VALUES (?, ?, ?, ?, ?, ?, ?)').run('o1', 'Dananz', 1, 1001, 'dananz', 'Tomer', 'https://avatars.githubusercontent.com/u/1001')
  sql.prepare('INSERT INTO owner_tokens (sha256, owner_id, device, created_at) VALUES (?, ?, ?, ?)').run(await hex(TOKEN), 'o1', 'test', 1)
  // Setup names the one owner who may upload; a host off this Mac takes uploads from no one else.
  sql.prepare("INSERT INTO meta (k, v) VALUES ('owner_id', 'o1')").run()
  const store = new Map()
  // Every D1 query and KV call is one of a Worker invocation's 50 subrequests on Free: `ops` counts them.
  const ops = { n: 0 }
  const KV = {
    store,
    async get(key, type) { ops.n++; const v = store.get(key); if (v === undefined) return null; return type === 'arrayBuffer' ? v.slice(0) : new TextDecoder().decode(v) },
    async put(key, value) { ops.n++; store.set(key, value instanceof ArrayBuffer ? value.slice(0) : new TextEncoder().encode(String(value)).buffer) },
    async delete(key) { ops.n++; store.delete(key) },
  }
  const stmt = (query, args = []) => ({
    bind: (...a) => stmt(query, a),
    first: async () => { ops.n++; return sql.prepare(query).get(...args) ?? null },
    all: async () => { ops.n++; return { results: sql.prepare(query).all(...args) } },
    run: async () => { ops.n++; const r = sql.prepare(query).run(...args); return { success: true, meta: { changes: Number(r.changes), rows_written: Number(r.changes) } } },
  })
  const DB = { sql, ops, prepare: q => stmt(q), async batch(list) { const out = []; for (const s of list) out.push(await s.run()); return out } }
  return { KV, DB, BASE, PATH_MODE: '0', ...extra }
}
const auth = { authorization: `Bearer ${TOKEN}` }
const meta = (o = {}) => Buffer.from(JSON.stringify({ title: 'Pricing', session: 's1', projectLabel: 'shop', scope: [{ proto: 'pricing', variants: ['A'] }], lang: 'en', ...o })).toString('base64url')
const call = (env, url, init) => worker.fetch(new Request(url, init), env)
const noCors = res => assert.deepEqual([...res.headers.keys()].filter(k => k.startsWith('access-control-')), [])
const bytesOf = async res => Buffer.from(await res.arrayBuffer())
// The share's KV keys, and the one its row names as live.
const htmlKeys = (env, id) => [...env.KV.store.keys()].filter(k => k.startsWith(`html:${id}:`))
const liveKey = (env, id) => env.DB.sql.prepare('SELECT html_key FROM shares WHERE id = ?').get(id).html_key
async function publish(env, html = '<!doctype html><p>hello', m = meta()) {
  const created = await call(env, `http://${env.BASE}/api/shares`, { method: 'POST', headers: auth })
  const { id } = await created.json()
  const body = gzipSync(html)
  const put = await call(env, `http://${env.BASE}/api/shares/${id}`, { method: 'PUT', headers: { ...auth, 'x-share-meta': m }, body })
  return { id, body, put }
}

test('ids shape', () => {
  const seen = new Set()
  for (let i = 0; i < 1000; i++) { const id = newId(); assert.ok(isId(id), id); seen.add(id) }
  assert.equal(seen.size, 1000)
  assert.ok(!isId('K3x9p2abcd') && !isId('k3x9p2abc') && !isId('k3x9p2abcde') && !isId('iiiiiiiiii'))
})
test('route reads the four origins', () => {
  const r = (u, b = BASE) => route(new URL(u), b)
  assert.deepEqual(r('http://k3x9p2abcd.localhost:8787/x'), { at: 'share', shareId: 'k3x9p2abcd', path: '/x' })
  assert.deepEqual(r('http://localhost:8787/s/k3x9p2abcd/api/state'), { at: 'share', shareId: 'k3x9p2abcd', path: '/api/state' })
  assert.deepEqual(r('http://localhost:8787/s/k3x9p2abcd'), { at: 'share', shareId: 'k3x9p2abcd', path: '' })
  assert.deepEqual(r('https://prtype.dev/k3x9p2abcd', 'prtype.dev'), { at: 'apex', shareId: 'k3x9p2abcd', path: '/k3x9p2abcd' })
  assert.equal(r('http://localhost:8787/api/shares').at, 'api')
  assert.equal(r('http://k3x9p2abcd.localhost:8787/_health').at, 'health')
  assert.equal(r('http://localhost:8787/nope').at, 'none')
  assert.equal(r('http://evil.example/').at, 'none')
})
test('owner api needs a token', async () => {
  const env = await makeEnv()
  for (const headers of [{}, { authorization: 'Bearer wrong' }, { authorization: TOKEN }]) {
    const res = await call(env, `http://${BASE}/api/shares`, { headers })
    assert.equal(res.status, 401)
    assert.ok((await res.json()).error)
    noCors(res)
  }
  assert.equal((await call(env, `http://${BASE}/api/shares`, { method: 'POST' })).status, 401)
  env.DB.sql.prepare('UPDATE owner_tokens SET revoked_at = 5').run()
  assert.equal((await call(env, `http://${BASE}/api/shares`, { headers: auth })).status, 401)
})
test('publish and serve', async () => {
  const env = await makeEnv()
  const { id, body, put } = await publish(env)
  assert.equal(put.status, 200)
  noCors(put)
  const res = await call(env, `http://${id}.${BASE}/`)
  assert.equal(res.status, 200)
  assert.deepEqual(await bytesOf(res), body)
  assert.equal(res.headers.get('content-encoding'), 'gzip')
  assert.equal(res.headers.get('content-type'), 'text/html; charset=utf-8')
  assert.equal(res.headers.get('x-robots-tag'), 'noindex')
  assert.equal(res.headers.get('content-security-policy'), "frame-ancestors 'self'")
  assert.equal(res.headers.get('x-frame-options'), 'SAMEORIGIN')
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff')
  assert.equal(res.headers.get('cache-control'), 'private, no-cache')
  noCors(res)
  assert.equal((await call(env, `http://${id}.${BASE}/?v=1`)).headers.get('cache-control'), 'private, no-cache')
  assert.equal((await call(env, `http://${id}.${BASE}/?v=2`)).headers.get('cache-control'), 'private, no-cache')
  const list = await (await call(env, `http://${BASE}/api/shares`, { headers: auth })).json()
  assert.equal(list.length, 1)
  assert.deepEqual({ id: list[0].id, title: list[0].title, version: list[0].version, bytes: list[0].bytes }, { id, title: 'Pricing', version: 1, bytes: body.length })
  assert.equal(typeof list[0].updatedAt, 'number')
})
test('put refuses what is not a share', async () => {
  const env = await makeEnv()
  const url = id => `http://${BASE}/api/shares/${id}`
  assert.equal((await call(env, url('k3x9p2abcd'), { method: 'PUT', headers: { ...auth, 'x-share-meta': meta() }, body: gzipSync('x') })).status, 404)
  const { id } = await (await call(env, `http://${BASE}/api/shares`, { method: 'POST', headers: auth })).json()
  assert.equal((await call(env, url(id), { method: 'PUT', headers: auth, body: gzipSync('x') })).status, 400)
  assert.equal((await call(env, url(id), { method: 'PUT', headers: { ...auth, 'x-share-meta': meta() }, body: Buffer.from('plain') })).status, 400)
})
test('links expire 30 days after publication or update, including pinned pages and viewer APIs', async t => {
  let now = Date.now()
  t.mock.method(Date, 'now', () => now)
  const env = await makeEnv({ PATH_MODE: '1' })
  const { id } = await publish(env)
  const expiry = () => env.DB.sql.prepare('SELECT expires_at FROM shares WHERE id = ?').get(id).expires_at
  const lifetime = 30 * 86_400_000
  assert.equal(expiry(), now + lifetime)
  assert.equal((await (await call(env, `http://${BASE}/api/shares`, { headers: auth })).json())[0].expiresAt, expiry())
  const urls = [`http://${BASE}/${id}`, `http://${BASE}/s/${id}/`, `http://${BASE}/s/${id}/?v=1`, `http://${id}.${BASE}/`, `http://${BASE}/s/${id}/_in/start`]
  now += lifetime - 1
  assert.equal((await call(env, urls[1])).status, 200)
  assert.equal((await call(env, urls[2])).headers.get('cache-control'), 'private, no-cache')
  now++
  for (const url of urls) {
    const res = await call(env, url)
    assert.equal(res.status, 410, url)
    assert.match(await res.text(), /This link has expired/)
  }
  for (const route of ['state', 'comments', 'config', 'me', 'here']) {
    const res = await call(env, `http://${BASE}/s/${id}/api/${route}`, { headers: { 'x-proto': '1' } })
    assert.equal(res.status, 410, route)
    assert.equal((await res.json()).code, 'expired')
  }
  const update = await call(env, `http://${BASE}/api/shares/${id}`, { method: 'PUT', headers: { ...auth, 'x-share-meta': meta() }, body: gzipSync('updated') })
  assert.equal(update.status, 200)
  assert.equal(expiry(), now + lifetime)
  assert.equal((await call(env, urls[1])).status, 200)
  now += 86_400_000
  await call(env, `http://${BASE}/api/shares/${id}`, { method: 'PUT', headers: { ...auth, 'x-share-meta': meta() }, body: gzipSync('updated again') })
  assert.equal(expiry(), now + lifetime, 'updating a live link also renews it')
})
test('existing links without expiry stay available until updated', async () => {
  const env = await makeEnv()
  const { id } = await publish(env)
  env.DB.sql.prepare('UPDATE shares SET expires_at = NULL WHERE id = ?').run(id)
  assert.equal((await call(env, `http://${id}.${BASE}/?v=1`)).headers.get('cache-control'), 'private, max-age=31536000, immutable')
  await call(env, `http://${BASE}/api/shares/${id}`, { method: 'PUT', headers: { ...auth, 'x-share-meta': meta() }, body: gzipSync('updated') })
  assert.ok(env.DB.sql.prepare('SELECT expires_at FROM shares WHERE id = ?').get(id).expires_at > Date.now())
})
test('path mode', async () => {
  const env = await makeEnv({ PATH_MODE: '1' })
  const { id, body } = await publish(env)
  const bare = await call(env, `http://${BASE}/s/${id}`, { redirect: 'manual' })
  assert.equal(bare.status, 301)
  assert.equal(bare.headers.get('location'), `http://${BASE}/s/${id}/`)
  noCors(bare)
  const res = await call(env, `http://${BASE}/s/${id}/`)
  assert.deepEqual(await bytesOf(res), body)
  assert.equal(res.headers.get('content-encoding'), 'gzip')
  noCors(res)
  const state = await call(env, `http://${BASE}/s/${id}/api/state`, { headers: { 'x-proto': '1' } })
  assert.equal((await state.json()).version, 1)
  // One origin per share in production refuses the path form there.
  const off = await makeEnv({ PATH_MODE: '0', BASE: 'prtype.dev' })
  const prod = await publish(off)
  assert.equal((await call(off, `https://prtype.dev/s/${prod.id}/`)).status, 404)
  assert.equal((await call(off, `https://${prod.id}.prtype.dev/`)).status, 200)
  // And a public host in path mode serves the path form only.
  const on = await makeEnv({ PATH_MODE: '1', BASE: 'prtype.dev' })
  const pub = await publish(on)
  assert.equal((await call(on, `https://prtype.dev/s/${pub.id}/`)).status, 200)
  assert.equal((await call(on, `https://${pub.id}.prtype.dev/`)).status, 404)
})
test('update bumps version and drops the old key', async () => {
  const env = await makeEnv()
  const { id } = await publish(env, 'one')
  const one = liveKey(env, id)
  assert.match(one, new RegExp(`^html:${id}:1:[0-9a-z]{10}$`))
  assert.deepEqual(htmlKeys(env, id), [one])
  const two = gzipSync('two')
  const put = await call(env, `http://${BASE}/api/shares/${id}`, { method: 'PUT', headers: { ...auth, 'x-share-meta': meta({ title: 'Pricing 2' }) }, body: two })
  assert.equal((await put.json()).version, 2)
  assert.match(liveKey(env, id), new RegExp(`^html:${id}:2:`))
  assert.deepEqual(htmlKeys(env, id), [liveKey(env, id)])
  assert.deepEqual(await bytesOf(await call(env, `http://${id}.${BASE}/`)), two)
  const state = await (await call(env, `http://${id}.${BASE}/api/state`, { headers: { 'X-Proto': '1' } })).json()
  assert.equal(state.version, 2)
  assert.equal(state.title, 'Pricing 2')
  assert.equal(typeof state.updatedAt, 'number')
})
test('state needs X-Proto', async () => {
  const env = await makeEnv()
  const { id } = await publish(env)
  const bare = await call(env, `http://${id}.${BASE}/api/state`)
  assert.equal(bare.status, 400)
  noCors(bare)
  const ok = await call(env, `http://${id}.${BASE}/api/state`, { headers: { 'X-Proto': '1' } })
  assert.equal(ok.status, 200)
  assert.match(ok.headers.get('content-type'), /application\/json/)
  noCors(ok)
})
test('apex og page keeps the hash', async () => {
  const env = await makeEnv()
  const { id } = await publish(env)
  const res = await call(env, `http://${BASE}/${id}`, { redirect: 'manual' })
  assert.equal(res.status, 200)
  const html = await res.text()
  assert.match(html, /location\.hash/)
  assert.match(html, /og:title" content="Pricing"/)
  assert.match(html, /A prototype shared by Dananz/)
  assert.match(html, /http-equiv="refresh" content="0;url=/)
  assert.ok(html.includes(`http://${id}.${BASE}/`))
  assert.ok(!res.headers.has('location'))
  noCors(res)
})
test('apex og page escapes the title', async () => {
  const env = await makeEnv()
  const { id } = await publish(env, 'x', meta({ title: '"><script>alert(1)</script>' }))
  const html = await (await call(env, `http://${BASE}/${id}`)).text()
  assert.ok(!html.includes('<script>alert(1)'))
})
test('apex og page: description, link, and the card only where the site has one', async () => {
  const env = await makeEnv()
  const { id } = await publish(env, 'x', meta({ message: 'Pick one <3' }))
  const html = await (await call(env, `http://${BASE}/${id}`)).text()
  assert.match(html, /<meta name="description" content="Pick one &lt;3">/)
  assert.match(html, /og:description" content="Pick one &lt;3"/)
  assert.ok(html.includes(`og:url" content="http://${BASE}/${id}"`))
  assert.match(html, /og:site_name" content="Prototype"/)
  assert.match(html, /<meta name="robots" content="noindex">/)
  assert.doesNotMatch(html, /og:image/)
  assert.match(html, /twitter:card" content="summary"/)
  const online = await makeEnv({ BASE: 'prtype.dev', PATH_MODE: '1', CARD: '/og-share.jpg' })
  const { id: two } = await publish(online, 'x', meta({ lang: 'he' }))
  const he = await (await call(online, `https://prtype.dev/${two}`)).text()
  assert.match(he, /og:image" content="https:\/\/prtype\.dev\/og-share\.jpg"/)
  assert.match(he, /twitter:card" content="summary_large_image"/)
  assert.match(he, /<html lang="he" dir="rtl">/)
  assert.match(he, /og:description" content="אב טיפוס מאת Dananz"/)
})
test('the built page carries its own title, preview tags and noindex', () => {
  const page = '<head>\n    <title>Prototype</title>\n  </head>'
  const en = shareTags(page, { title: 'Pricing "v2"', owner: 'Dananz', card: 'https://prtype.dev/og-share.jpg' }, 'en')
  assert.match(en, /<title>Pricing &quot;v2&quot;<\/title>/)
  assert.match(en, /<meta name="robots" content="noindex" \/>/)
  assert.match(en, /og:title" content="Pricing &quot;v2&quot;"/)
  assert.match(en, /<meta name="description" content="A prototype shared by Dananz" \/>/)
  assert.match(en, /og:image" content="https:\/\/prtype\.dev\/og-share\.jpg"/)
  const bare = shareTags(page, { title: 'Pricing', owner: '' }, 'he')
  assert.doesNotMatch(bare, /og:image|description/)
  assert.match(shareTags(page, { title: 'Pricing', owner: 'Dananz' }, 'he'), /content="אב טיפוס מאת Dananz"/)
})
const JPEG = (n = 64) => { const b = new Uint8Array(n); b.set([0xff, 0xd8, 0xff, 0xe0]); return b }
const putCard = (env, id, body, headers = auth) => call(env, `http://${env.BASE}/api/shares/${id}/card`, { method: 'PUT', headers: { ...headers, 'content-type': 'image/jpeg' }, body })
test("a share's own card: uploaded once by its owner, served as a file, named by the short link", async () => {
  const env = await makeEnv({ BASE: 'prtype.dev', PATH_MODE: '1', CARD: '/og-share.jpg' })
  const { id } = await publish(env)
  const first = await putCard(env, id, JPEG())
  assert.equal(first.status, 200)
  const { card } = await first.json()
  assert.match(card, /^card\.jpg\?v=[0-9a-z]+$/)
  const html = await (await call(env, `https://prtype.dev/${id}`)).text()
  assert.ok(html.includes(`og:image" content="https://prtype.dev/s/${id}/${card}"`), html)
  const served = await call(env, `https://prtype.dev/s/${id}/${card}`)
  assert.equal(served.status, 200)
  assert.equal(served.headers.get('content-type'), 'image/jpeg')
  assert.match(served.headers.get('x-robots-tag'), /noindex/)
  assert.deepEqual(new Uint8Array(await served.arrayBuffer()), JPEG())
  // A new card is a new key and a new address; the old key goes.
  const second = await (await putCard(env, id, JPEG(80))).json()
  assert.notEqual(second.card, card)
  assert.equal([...env.KV.store.keys()].filter(k => k.startsWith(`card:${id}:`)).length, 1)
  // Only a JPEG, only so big, only the owner's.
  assert.equal((await putCard(env, id, new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).status, 400)
  assert.equal((await putCard(env, id, JPEG(301 * 1024))).status, 413)
  env.DB.sql.prepare('INSERT INTO owners (id, name, created_at) VALUES (?, ?, ?)').run('o2', 'Other', 1)
  env.DB.sql.prepare('INSERT INTO owner_tokens (sha256, owner_id, device, created_at) VALUES (?, ?, ?, ?)').run(await hex('other'), 'o2', 'x', 1)
  assert.equal((await putCard(env, id, JPEG(), { authorization: 'Bearer other' })).status, 403)
  // Removing the share removes its card.
  assert.equal((await call(env, `https://prtype.dev/api/shares/${id}`, { method: 'DELETE', headers: auth })).status, 200)
  assert.ok(![...env.KV.store.keys()].some(k => k.startsWith(`card:${id}:`)))
  assert.equal((await call(env, `https://prtype.dev/s/${id}/${second.card}`)).status, 410)
})
test("without a card of its own, a share has no card.jpg and the short link falls back to the site's", async () => {
  const env = await makeEnv({ BASE: 'prtype.dev', PATH_MODE: '1', CARD: '/og-share.jpg' })
  const { id } = await publish(env)
  assert.equal((await call(env, `https://prtype.dev/s/${id}/card.jpg`)).status, 404)
  assert.match(await (await call(env, `https://prtype.dev/${id}`)).text(), /og:image" content="https:\/\/prtype\.dev\/og-share\.jpg"/)
})
test('the card is drawn as a 1200×630 JPEG, in English and Hebrew, with or without a picture', { skip: !loadSharp() && 'no sharp in the share tools' }, async () => {
  const { cardImage } = await import('../app/share/card/card.mjs')
  const sharp = loadSharp()
  const noFetch = async () => { throw new Error('offline') }
  for (const [title, owner, lang] of [['Pricing', { login: 'Dananz', name: 'Tomer Danan', avatar: 'https://avatars.githubusercontent.com/u/1' }, 'en'], ['מסך התשלום, שלוש גרסאות', { login: 'Dananz' }, 'he'], ['word '.repeat(60), {}, 'en']]) {
    const jpeg = await cardImage({ title, owner, lang, sharp, fetch: noFetch })
    const m = await sharp(jpeg).metadata()
    assert.deepEqual([m.format, m.width, m.height], ['jpeg', 1200, 630])
    assert.ok(jpeg.length < 300 * 1024)
  }
})
test('robots.txt keeps crawlers off every page, and lets link previewers in', async () => {
  for (const [env, url] of [[await makeEnv(), `http://${BASE}/robots.txt`], [await makeEnv({ BASE: 'prtype.dev', PATH_MODE: '1' }), 'https://prtype.dev/robots.txt'], [await makeEnv(), `http://k3x9p2abcd.${BASE}/robots.txt`]]) {
    const res = await call(env, url)
    assert.equal(res.status, 200, url)
    assert.match(res.headers.get('content-type'), /text\/plain/)
    const text = await res.text()
    assert.match(text, /User-agent: \*\nDisallow: \/\n/)
    assert.match(text, /User-agent: Twitterbot[^]*User-agent: WhatsApp\nDisallow: \/api\nDisallow: \/auth\//)
  }
})
test('removed is 410', async () => {
  const env = await makeEnv()
  const { id } = await publish(env)
  const del = await call(env, `http://${BASE}/api/shares/${id}`, { method: 'DELETE', headers: auth })
  assert.equal(del.status, 200)
  noCors(del)
  assert.ok(![...env.KV.store.keys()].some(k => k.includes(id)))
  for (const url of [`http://${id}.${BASE}/`, `http://${BASE}/${id}`]) {
    const res = await call(env, url)
    assert.equal(res.status, 410)
    assert.match(res.headers.get('x-robots-tag'), /noindex/)
    noCors(res)
  }
  assert.equal((await call(env, `http://${id}.${BASE}/api/state`, { headers: { 'x-proto': '1' } })).status, 410)
  assert.deepEqual(await (await call(env, `http://${BASE}/api/shares`, { headers: auth })).json(), [])
})
test('unknown is 404', async () => {
  const env = await makeEnv()
  for (const url of [`http://k3x9p2abcd.${BASE}/`, `http://${BASE}/k3x9p2abcd`, `http://${BASE}/nothing`]) {
    const res = await call(env, url)
    assert.equal(res.status, 404, url)
    assert.match(res.headers.get('content-type'), /text\/html/)
    noCors(res)
  }
})
test('error pages come in he', async () => {
  const env = await makeEnv()
  const { id } = await publish(env, 'x', meta({ lang: 'he' }))
  await call(env, `http://${BASE}/api/shares/${id}`, { method: 'DELETE', headers: auth })
  const html = await (await call(env, `http://${id}.${BASE}/`)).text()
  assert.match(html, /dir="rtl"/)
  assert.match(html, /lang="he"/)
})
test('too big is 413', async () => {
  const env = await makeEnv()
  const { id } = await (await call(env, `http://${BASE}/api/shares`, { method: 'POST', headers: auth })).json()
  const res = await call(env, `http://${BASE}/api/shares/${id}`, { method: 'PUT', headers: { ...auth, 'x-share-meta': meta() }, body: new Uint8Array(20 * 1024 * 1024 + 1) })
  assert.equal(res.status, 413)
  noCors(res)
  assert.equal(env.KV.store.size, 0)
})
test('health answers anywhere and another owner cannot touch a share', async () => {
  const env = await makeEnv()
  assert.equal((await call(env, `http://abc.${BASE}/_health`)).status, 200)
  const { id } = await publish(env)
  env.DB.sql.prepare('INSERT INTO owners (id, name, created_at) VALUES (?, ?, ?)').run('o2', 'Other', 1)
  env.DB.sql.prepare('INSERT INTO owner_tokens (sha256, owner_id, device, created_at) VALUES (?, ?, ?, ?)').run(await hex('other'), 'o2', 'x', 1)
  const res = await call(env, `http://${BASE}/api/shares/${id}`, { method: 'DELETE', headers: { authorization: 'Bearer other' } })
  assert.equal(res.status, 404)
})
test('subdomain mode serves a path that starts with /s/ as an ordinary path', async () => {
  const env = await makeEnv()
  const { id } = await publish(env)
  assert.equal((await call(env, `http://${id}.${BASE}/s/${id}`)).status, 404)
})

// The host on this Mac answers on both loopback names, localhost:<port> and 127.0.0.1:<port>, and
// serves the path form (/s/<id>/) on either whatever PATH_MODE says: *.localhost may not resolve
// in every browser, and 127.0.0.1 has no subdomains. Production keeps its one name.
test('route takes several names for the host', () => {
  const names = ['localhost:8787', '127.0.0.1:8787']
  assert.equal(route(new URL('http://127.0.0.1:8787/api/shares'), names).at, 'api')
  assert.deepEqual(route(new URL('http://127.0.0.1:8787/s/k3x9p2abcd/'), names), { at: 'share', shareId: 'k3x9p2abcd', path: '/' })
  assert.deepEqual(route(new URL('http://k3x9p2abcd.localhost:8787/'), names), { at: 'share', shareId: 'k3x9p2abcd', path: '/' })
  assert.equal(route(new URL('http://127.0.0.1:8788/api/shares'), names).at, 'none')
})
test('the local host answers on 127.0.0.1 too', async () => {
  const env = await makeEnv()
  const { id, body } = await publish(env)
  const list = await call(env, 'http://127.0.0.1:8787/api/shares', { headers: auth })
  assert.equal(list.status, 200)
  assert.equal((await list.json())[0].id, id)
  for (const url of [`http://127.0.0.1:8787/s/${id}/`, `http://localhost:8787/s/${id}/`, `http://${id}.localhost:8787/`]) {
    const res = await call(env, url)
    assert.equal(res.status, 200, url)
    assert.deepEqual(await bytesOf(res), body, url)
  }
  const bare = await call(env, `http://127.0.0.1:8787/s/${id}`, { redirect: 'manual' })
  assert.equal(bare.headers.get('location'), `http://127.0.0.1:8787/s/${id}/`)
  assert.equal((await (await call(env, `http://127.0.0.1:8787/s/${id}/api/state`, { headers: { 'x-proto': '1' } })).json()).version, 1)
  assert.equal((await call(env, `http://127.0.0.1:8788/s/${id}/`)).status, 404)
})
test('the apex page sends a local visitor to the form their host can open', async () => {
  const env = await makeEnv()
  const { id } = await publish(env)
  const target = async (url, e = env) => /http-equiv="refresh" content="0;url=([^"]+)"/.exec(await (await call(e, url)).text())[1]
  assert.equal(await target(`http://127.0.0.1:8787/${id}`), `http://127.0.0.1:8787/s/${id}/`)
  assert.equal(await target(`http://localhost:8787/${id}`), `http://${id}.localhost:8787/`)
  const paths = await makeEnv({ PATH_MODE: '1' })
  const p = await publish(paths)
  assert.equal(await target(`http://localhost:8787/${p.id}`, paths), `http://localhost:8787/s/${p.id}/`)
  assert.equal(await target(`http://127.0.0.1:8787/${p.id}`, paths), `http://127.0.0.1:8787/s/${p.id}/`)
})
test('production keeps one name', async () => {
  const env = await makeEnv({ BASE: 'prtype.dev' })
  const { id } = await publish(env)
  const target = async (url, e = env) => /http-equiv="refresh" content="0;url=([^"]+)"/.exec(await (await call(e, url)).text())[1]
  assert.equal(await target(`https://prtype.dev/${id}`), `https://${id}.prtype.dev/`)
  for (const url of [`https://prtype.dev/s/${id}/`, `http://127.0.0.1:8787/s/${id}/`, `http://localhost:8787/api/shares`]) assert.equal((await call(env, url, { headers: auth })).status, 404, url)
  const paths = await makeEnv({ BASE: 'prtype.dev', PATH_MODE: '1' })
  const p = await publish(paths)
  assert.equal(await target(`https://prtype.dev/${p.id}`, paths), `https://prtype.dev/s/${p.id}/`)
})

// The local host's own checks, none of which touch the Keychain or start a host.
import { createServer as tcpServer } from 'node:net'
import { keychainAdd, portFree, runsConfig } from '../scripts/share-host.mjs'

test('the owner token reaches the Keychain on stdin, never on the command line', () => {
  const token = 'Ab9_-' + 'x'.repeat(38)
  const { args, input } = keychainAdd('local', token)
  assert.deepEqual(args, ['-i'])
  assert.ok(!args.join(' ').includes(token))
  assert.equal(input, `add-generic-password -U -a prototype -s prototype-share-local -w ${token}\n`)
  assert.throws(() => keychainAdd('local', 'two words'), /token/)
  assert.throws(() => keychainAdd('local', 'a"b'), /token/)
})
test('a port is free only when nothing listens on it by any loopback name', async () => {
  const listen = host => new Promise((ok, no) => { const s = tcpServer().once('error', no).listen(0, host, () => ok(s)) })
  for (const host of ['127.0.0.1', '::1', '::', '0.0.0.0']) {
    let s
    try { s = await listen(host) } catch { continue } // no IPv6 on this machine
    const port = s.address().port
    assert.equal(await portFree(port), false, `a listener on ${host} went unseen`)
    await new Promise(ok => s.close(ok))
    assert.equal(await portFree(port), true, `${port} is still taken after ${host} closed`)
  }
})
test('the host stops only its own wrangler', () => {
  const config = '/Users/x/.prototypes/host/wrangler.jsonc'
  assert.ok(runsConfig(`/opt/node /tools/wrangler.js dev -c ${config} --ip 127.0.0.1 --port 8787`, config))
  assert.ok(!runsConfig('/opt/node /tools/wrangler.js dev -c /Users/x/app/wrangler.jsonc --port 8787', config))
  assert.ok(!runsConfig('node wrangler dev', config))
  assert.ok(!runsConfig(`/opt/node /tools/wrangler.js dev -c ${config}.bak`, config))
})

// Phase 1: GitHub sign-in on the share origin, viewer comments, and the owner's comments API. GitHub
// is the fake in fake-github.mjs; cookies and tickets the flow can't make (expired, tampered) are
// minted with the host's own signer.
import { before, after } from 'node:test'
import { startFakeGitHub } from './fake-github.mjs'
import { sign } from '../host/lib/cookies.mjs'
import { upgrade } from '../host/lib/upgrade.mjs'
import { viewerFrom } from '../host/lib/github.mjs'
import { pruneCaps } from '../host/lib/comments.mjs'

const KEY = 'viewer-key-for-tests'
let gh
before(async () => { gh = await startFakeGitHub() })
after(async () => { await gh.close() })
const ghEnv = (extra = {}) => makeEnv({ GITHUB_CLIENT_ID: gh.clientId, GITHUB_CLIENT_SECRET: gh.clientSecret, VIEWER_KEY: KEY, GITHUB_OAUTH: gh.url, GITHUB_API: gh.url, SIGNIN: '1', ...extra })
const XP = { 'x-proto': '1' }
const setCookies = res => res.headers.getSetCookie()
const pair = c => c.split(';')[0]
const attrs = c => c.split(';').slice(1).map(s => s.trim().toLowerCase())
// The full flow, as a browser would walk it: share origin's /_in/start (the nonce cookie) → apex →
// GitHub → callback → the share origin's /_in/auth, which needs that nonce cookie.
const NONCE = 'AAAAAAAAAAAAAAAAAAAAAA'
async function signIn(env, id, { start = `http://${id}.${BASE}/_in/start`, back = '/' } = {}) {
  const begin = await call(env, `${start}?back=${encodeURIComponent(back)}`, { redirect: 'manual' })
  assert.equal(begin.status, 302)
  const nonceCookie = setCookies(begin).find(c => /^(__Host-)?vn=/.test(c))
  let res = await call(env, begin.headers.get('location'), { redirect: 'manual' })
  assert.equal(res.status, 302)
  const state = setCookies(res)[0]
  const authorize = res.headers.get('location')
  const fromGh = await fetch(authorize, { redirect: 'manual' })
  const callback = fromGh.headers.get('location')
  const cb = await call(env, callback, { redirect: 'manual', headers: { cookie: pair(state) } })
  const ticketUrl = cb.headers.get('location')
  const landed = await call(env, ticketUrl, { redirect: 'manual', headers: { cookie: pair(nonceCookie) } })
  const cookie = setCookies(landed).find(c => /^(__Host-)?v=/.test(c))
  return { begin, nonceCookie, apex: begin.headers.get('location'), state, authorize, callback, cb, ticketUrl, landed, cookie, jar: cookie && pair(cookie) }
}
const mint = async (id, gh_id = 4242, o = {}) => `v=${await sign(KEY, 'v', { gh: gh_id, share: id, exp: Date.now() + 60_000, ...o })}`
const addViewer = (env, gh_id, login) => env.DB.sql.prepare('INSERT OR REPLACE INTO viewers (gh_id, login, name, avatar, seen_at) VALUES (?, ?, ?, ?, ?)').run(gh_id, login, login.toUpperCase(), `https://avatars.example/${gh_id}`, 1)
const uuid = () => crypto.randomUUID()
const shareApi = (id, p) => `http://${id}.${BASE}/api/${p}`
const post = (env, id, jar, body) => call(env, shareApi(id, 'comments'), { method: 'POST', headers: { ...XP, cookie: jar, 'content-type': 'application/json' }, body: JSON.stringify(body) })
const list = async (env, id, jar, since) => (await call(env, shareApi(id, `comments${since === undefined ? '' : `?since=${since}`}`), { headers: { ...XP, ...(jar ? { cookie: jar } : {}) } })).json()
const owner = (env, path, init = {}) => call(env, `http://${BASE}/api/owner/${path}`, { ...init, headers: { ...auth, ...(init.body ? { 'content-type': 'application/json' } : {}), ...init.headers } })
const patch = (env, cid, body) => owner(env, `comments/${cid}`, { method: 'PATCH', body: JSON.stringify(body) })
// The share's scope as `proto share` sends it (parseScope's shape).
const realMeta = () => meta({ scope: { protos: [{ id: 'pricing', variants: ['A', 'C'] }, { id: 'home', variants: ['B'] }], start: 'pricing/A' } })

test('a phase-0 database takes the phase-1 schema, and schema.sql runs on it again', async () => {
  const fresh = await makeEnv()
  const env = await makeEnv()
  // Rebuild comments as phase 0 made it, then run schema.sql over it as startLocal does.
  env.DB.sql.exec(`DROP TABLE comments; DROP TABLE viewers; DROP TABLE caps; DROP TABLE tickets;
    CREATE TABLE comments (id TEXT NOT NULL, share_id TEXT NOT NULL REFERENCES shares(id) ON DELETE CASCADE,
      link_id TEXT NOT NULL, viewer TEXT NOT NULL, verified INTEGER NOT NULL, version INTEGER NOT NULL, route TEXT NOT NULL,
      body TEXT NOT NULL, re TEXT, status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','sent','working','done','dismissed')),
      taken_by TEXT, owner_reply TEXT, hidden INTEGER NOT NULL DEFAULT 0, done_in INTEGER,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (share_id, id));`)
  env.DB.sql.exec(readFileSync(new URL('../host/schema.sql', import.meta.url), 'utf8'))
  const cols = (e, t) => e.DB.sql.prepare(`PRAGMA table_info(${t})`).all().map(c => c.name).sort()
  assert.notDeepEqual(cols(env, 'comments'), cols(fresh, 'comments'))
  await upgrade(env.DB)
  await upgrade(env.DB)
  for (const t of ['comments', 'viewers', 'caps', 'tickets']) assert.deepEqual(cols(env, t), cols(fresh, t), t)
  const { id } = await publish(env)
  assert.equal((await call(env, shareApi(id, 'config'), { headers: XP })).status, 200)
  // A database missing the new tables entirely (the running host before its next start) gets them too.
  const bare = await makeEnv()
  bare.DB.sql.exec('DROP TABLE viewers; DROP TABLE caps; DROP TABLE tickets;')
  await upgrade(bare.DB)
  for (const t of ['viewers', 'caps', 'tickets']) assert.deepEqual(cols(bare, t), cols(fresh, t), t)
})

test('config and me without GitHub set up: comments off, nobody signed in, never a 500', async () => {
  const env = await makeEnv()
  const { id } = await publish(env)
  const config = await call(env, shareApi(id, 'config'), { headers: XP })
  assert.deepEqual(await config.json(), { comments: false, owner: 'Dananz' })
  noCors(config)
  assert.equal(await (await call(env, shareApi(id, 'me'), { headers: { ...XP, cookie: await mint(id) } })).json(), null)
  const start = await call(env, `http://${BASE}/auth/github?share=${id}&back=/&nonce=${NONCE}`, { redirect: 'manual' })
  assert.equal(start.status, 400)
  assert.match(start.headers.get('content-type'), /text\/html/)
  assert.equal((await call(env, `http://${id}.${BASE}/_in/start?back=/`, { redirect: 'manual' })).status, 400)
  const signedOut = await post(env, id, await mint(id), { id: uuid(), variant: 'pricing/A', body: 'hi', target: null })
  assert.equal(signedOut.status, 401)
})

test('config says comments are on with GitHub set up, and off when the share turns them off', async () => {
  const env = await ghEnv()
  const { id } = await publish(env)
  assert.deepEqual(await (await call(env, shareApi(id, 'config'), { headers: XP })).json(), { comments: true, owner: 'Dananz' })
  env.DB.sql.prepare('UPDATE shares SET comments = 0').run()
  assert.deepEqual(await (await call(env, shareApi(id, 'config'), { headers: XP })).json(), { comments: false, owner: 'Dananz' })
})

test('every viewer api route needs X-Proto, answers JSON, and sends no CORS headers', async () => {
  const env = await ghEnv()
  const { id } = await publish(env)
  const jar = await mint(id)
  addViewer(env, 4242, 'dana-test')
  for (const [method, p] of [['GET', 'config'], ['GET', 'me'], ['POST', 'signout'], ['GET', 'comments'], ['POST', 'comments'], ['DELETE', `comments/${uuid()}`], ['GET', 'state']]) {
    const res = await call(env, shareApi(id, p), { method, headers: { cookie: jar, 'content-type': 'application/json' }, body: method === 'POST' ? '{}' : undefined })
    assert.equal(res.status, 400, `${method} ${p}`)
    assert.match(res.headers.get('content-type'), /application\/json/)
    assert.ok((await res.json()).error)
    noCors(res)
  }
  const pre = await call(env, shareApi(id, 'comments'), { method: 'OPTIONS', headers: { origin: 'http://evil.localhost:8787', 'access-control-request-method': 'POST', 'access-control-request-headers': 'x-proto' } })
  assert.ok(pre.status >= 400)
  noCors(pre)
  const form = await call(env, shareApi(id, 'comments'), { method: 'POST', headers: { ...XP, cookie: jar, 'content-type': 'text/plain' }, body: '{}' })
  assert.equal(form.status, 415)
  assert.equal((await call(env, shareApi(id, 'nothing'), { headers: XP })).status, 404)
})

test('sign in with GitHub: apex state, PKCE, the 60 s ticket, then the viewer cookie', async () => {
  const env = await ghEnv()
  const { id } = await publish(env)
  const s = await signIn(env, id, { back: '/#/pricing/C' })
  // The share origin's start sets the nonce cookie and sends the browser to the apex with it.
  const nonce = new URL(s.apex).searchParams.get('nonce')
  assert.match(nonce, /^[\w-]{22}$/)
  assert.equal(pair(s.nonceCookie), `vn=${nonce}`)
  assert.ok(attrs(s.nonceCookie).includes('httponly') && attrs(s.nonceCookie).includes('samesite=lax') && attrs(s.nonceCookie).includes('path=/') && attrs(s.nonceCookie).includes('max-age=600'))
  assert.ok(s.apex.startsWith(`http://${BASE}/auth/github?`), s.apex)
  assert.equal(new URL(s.apex).searchParams.get('share'), id)
  assert.ok(setCookies(s.landed).some(c => /^vn=;/.test(c) && /max-age=0/i.test(c)), 'the landing clears the nonce cookie')
  const authorize = new URL(s.authorize)
  assert.equal(authorize.origin + authorize.pathname, `${gh.url}/login/oauth/authorize`)
  assert.equal(authorize.searchParams.get('client_id'), gh.clientId)
  assert.equal(authorize.searchParams.get('redirect_uri'), `http://${BASE}/auth/github/callback`)
  assert.equal(authorize.searchParams.get('scope'), '')
  assert.equal(authorize.searchParams.get('allow_signup'), 'true')
  assert.equal(authorize.searchParams.get('code_challenge_method'), 'S256')
  assert.match(authorize.searchParams.get('state'), /^[\w-]{22}$/)
  assert.match(s.state, /^gh=/)
  assert.ok(attrs(s.state).includes('httponly') && attrs(s.state).includes('samesite=lax') && attrs(s.state).includes('max-age=600'))
  assert.ok(!attrs(s.state).includes('secure'))
  assert.equal(s.cb.status, 302)
  assert.ok(setCookies(s.cb).some(c => /^gh=;/.test(c) && /max-age=0/i.test(c)), 'the callback clears the state cookie')
  assert.ok(s.ticketUrl.startsWith(`http://${id}.${BASE}/_in/auth?t=`), s.ticketUrl)
  // The exchange sent the verifier and the /user call a User-Agent; the token was not kept.
  const exchange = gh.calls.findLast(c => c.path === '/login/oauth/access_token')
  assert.ok(new URLSearchParams(exchange.body).get('code_verifier'))
  assert.ok(gh.calls.findLast(c => c.path === '/user').headers['user-agent'])
  assert.deepEqual(env.DB.sql.prepare('SELECT gh_id, login, name, avatar FROM viewers').all().map(r => ({ ...r })), [{ gh_id: 4242, login: 'dana-test', name: 'Dana', avatar: 'https://avatars.githubusercontent.com/u/4242' }])
  assert.ok(!JSON.stringify(env.DB.sql.prepare('SELECT * FROM viewers').all()).includes('gho_'))
  assert.equal(s.landed.status, 302)
  assert.equal(s.landed.headers.get('location'), `http://${id}.${BASE}/#/pricing/C`)
  assert.match(s.cookie, /^v=/)
  const a = attrs(s.cookie)
  assert.ok(a.includes('httponly') && a.includes('samesite=lax') && a.includes('path=/') && a.includes('max-age=2592000') && !a.includes('secure'), s.cookie)
  const me = await call(env, shareApi(id, 'me'), { headers: { ...XP, cookie: s.jar } })
  assert.deepEqual(await me.json(), { login: 'dana-test', name: 'Dana', avatar: 'https://avatars.githubusercontent.com/u/4242' })
  noCors(me)
  // Sign out clears the cookie.
  const out = await call(env, shareApi(id, 'signout'), { method: 'POST', headers: { ...XP, cookie: s.jar } })
  assert.equal(out.status, 200)
  assert.ok(setCookies(out).some(c => /^v=;/.test(c) && /max-age=0/i.test(c)))
})

test('sign in from the path form on 127.0.0.1 goes through the canonical apex and comes back to the path form', async () => {
  const env = await ghEnv()
  const { id } = await publish(env)
  const first = await call(env, `http://127.0.0.1:8787/auth/github?share=${id}&back=${encodeURIComponent(`/s/${id}/#/home/B`)}&nonce=${NONCE}`, { redirect: 'manual' })
  assert.equal(first.status, 302)
  assert.match(first.headers.get('location'), new RegExp(`^http://${BASE}/auth/github\\?`))
  const s = await signIn(env, id, { start: `http://127.0.0.1:8787/s/${id}/_in/start`, back: `/s/${id}/#/home/B` })
  assert.ok(attrs(s.nonceCookie).includes(`path=/s/${id}/`), s.nonceCookie)
  assert.equal(new URL(s.apex).searchParams.get('via'), '127.0.0.1:8787')
  assert.ok(s.ticketUrl.startsWith(`http://127.0.0.1:8787/s/${id}/_in/auth?t=`), s.ticketUrl)
  assert.equal(s.landed.headers.get('location'), `http://127.0.0.1:8787/s/${id}/#/home/B`)
  assert.ok(attrs(s.cookie).includes(`path=/s/${id}/`), s.cookie)
  const me = await call(env, `http://127.0.0.1:8787/s/${id}/api/me`, { headers: { ...XP, cookie: s.jar } })
  assert.equal((await me.json()).login, 'dana-test')
  // A via that isn't one of the host's names is ignored; a back that leaves the share falls back to its start.
  const evil = await signIn(env, id, { back: '//evil.example/x' })
  assert.equal(evil.landed.headers.get('location'), `http://${id}.${BASE}/`)
  const via = await call(env, `http://${BASE}/auth/github?share=${id}&back=/&via=evil.example&nonce=${NONCE}`, { redirect: 'manual' })
  const st = await fetch(via.headers.get('location'), { redirect: 'manual' })
  const cb = await call(env, st.headers.get('location'), { redirect: 'manual', headers: { cookie: pair(setCookies(via)[0]) } })
  assert.ok(cb.headers.get('location').startsWith(`http://${id}.${BASE}/_in/auth?t=`))
})

test('over https the cookies are __Host- and Secure; path mode keeps v with the share path', async () => {
  const env = await ghEnv({ BASE: 'prtype.dev' })
  const { id } = await publish(env)
  const s = await signIn(env, id, { start: `https://${id}.prtype.dev/_in/start`, back: '/' })
  assert.match(s.nonceCookie, /^__Host-vn=/)
  assert.ok(attrs(s.nonceCookie).includes('secure'))
  assert.match(s.state, /^__Host-gh=/)
  assert.ok(attrs(s.state).includes('secure') && attrs(s.state).includes('path=/'))
  assert.ok(s.ticketUrl.startsWith(`https://${id}.prtype.dev/_in/auth?t=`))
  assert.match(s.cookie, /^__Host-v=/)
  const a = attrs(s.cookie)
  assert.ok(a.includes('secure') && a.includes('path=/') && a.includes('httponly') && a.includes('samesite=lax'))
  assert.ok(!a.some(x => x.startsWith('domain=')))
  assert.equal((await (await call(env, `https://${id}.prtype.dev/api/me`, { headers: { ...XP, cookie: s.jar } })).json()).login, 'dana-test')
  const paths = await ghEnv({ BASE: 'prtype.dev', PATH_MODE: '1' })
  const p = await publish(paths)
  const ps = await signIn(paths, p.id, { start: `https://prtype.dev/s/${p.id}/_in/start`, back: `/s/${p.id}/` })
  assert.match(ps.nonceCookie, /^vn=/)
  assert.ok(attrs(ps.nonceCookie).includes('secure') && attrs(ps.nonceCookie).includes(`path=/s/${p.id}/`))
  assert.match(ps.cookie, /^v=/)
  assert.ok(attrs(ps.cookie).includes('secure') && attrs(ps.cookie).includes(`path=/s/${p.id}/`))
})

test('the callback refuses a missing or wrong state, and a GitHub refusal goes back unsigned', async () => {
  const env = await ghEnv()
  const { id } = await publish(env)
  assert.equal((await call(env, `http://${BASE}/auth/github?share=${id}&back=/x`, { redirect: 'manual' })).status, 400, 'no nonce')
  const start = await call(env, `http://${BASE}/auth/github?share=${id}&back=/x&nonce=${NONCE}`, { redirect: 'manual' })
  const jar = pair(setCookies(start)[0])
  const state = new URL(start.headers.get('location')).searchParams.get('state')
  const cb = q => call(env, `http://${BASE}/auth/github/callback?${q}`, { redirect: 'manual', headers: { cookie: jar } })
  assert.equal((await call(env, `http://${BASE}/auth/github/callback?code=x&state=${state}`, { redirect: 'manual' })).status, 400)
  assert.equal((await cb(`code=x&state=wrong`)).status, 400)
  const denied = await cb(`error=access_denied&state=${state}`)
  assert.equal(denied.status, 302)
  assert.equal(denied.headers.get('location'), `http://${id}.${BASE}/x`)
  assert.equal((await cb(`code=not-a-code&state=${state}`)).status, 400, 'a code GitHub refuses')
  const expired = `gh=${await sign(KEY, 'state', { n: state, share: id, exp: Date.now() - 1 })}`
  assert.equal((await call(env, `http://${BASE}/auth/github/callback?code=x&state=${state}`, { redirect: 'manual', headers: { cookie: expired } })).status, 400)
  for (const q of [`share=nope&back=/&nonce=${NONCE}`, `share=k3x9p2abcd&back=/&nonce=${NONCE}`]) assert.equal((await call(env, `http://${BASE}/auth/github?${q}`, { redirect: 'manual' })).status, 404, q)
})

test('tickets: 60 s, signed, for one share, only as tickets, bound to the browser by its nonce, used once', async () => {
  const env = await ghEnv()
  const { id } = await publish(env)
  const other = (await publish(env)).id
  addViewer(env, 4242, 'dana-test')
  let k = 0
  const fresh = () => `nonce-${String(++k).padStart(16, '0')}`
  const tk = (nn, o = {}, key = KEY, purpose = 'ticket') => sign(key, purpose, { gh: 4242, share: id, to: '/', nn, exp: Date.now() + 60_000, ...o })
  const land = (t, nn) => call(env, `http://${id}.${BASE}/_in/auth?t=${encodeURIComponent(t)}`, { redirect: 'manual', headers: nn ? { cookie: `vn=${nn}` } : {} })
  let n = fresh()
  const good = await tk(n)
  const ok = await land(good, n)
  assert.equal(ok.status, 302)
  assert.equal(ok.headers.get('location'), `http://${id}.${BASE}/`)
  assert.equal((await land(good, n)).status, 400, 'used once')
  n = fresh()
  const replay = await tk(n)
  assert.equal((await land(replay)).status, 400, 'replayed in a browser without the nonce cookie')
  assert.equal((await land(replay, fresh())).status, 400, 'another browser\'s nonce (login CSRF)')
  assert.equal((await land(replay, n)).status, 302, 'the refusals did not use it up')
  n = fresh()
  assert.equal((await land(await tk(n, { exp: Date.now() - 1 }), n)).status, 400, 'expired')
  const t2 = await tk(n)
  assert.equal((await land(t2.slice(0, -2) + (t2.endsWith('AA') ? 'BB' : 'AA'), n)).status, 400, 'tampered')
  assert.equal((await land(await tk(n, { share: other }), n)).status, 400, 'another share')
  assert.equal((await land(await tk(n, {}, KEY, 'v'), n)).status, 400, 'a cookie is not a ticket')
  assert.equal((await land(await tk(n, {}, 'another key'), n)).status, 400, 'another key')
  assert.equal((await land(await tk(n, { nn: undefined }), n)).status, 400, 'a ticket without a nonce')
  assert.equal((await land(await tk(n, { to: '//evil.example/' }), n)).headers.get('location'), `http://${id}.${BASE}/`)
})

test('viewer cookies: tampered, expired, another share, another purpose, an unknown viewer are all nobody', async () => {
  const env = await ghEnv()
  const { id } = await publish(env)
  const other = (await publish(env)).id
  addViewer(env, 4242, 'dana-test')
  const me = async cookie => (await call(env, shareApi(id, 'me'), { headers: { ...XP, cookie } })).json()
  const good = await mint(id)
  assert.equal((await me(good)).login, 'dana-test')
  assert.equal(await me(good.slice(0, -2) + (good.endsWith('AA') ? 'BB' : 'AA')), null)
  assert.equal(await me(await mint(id, 4242, { exp: Date.now() - 1 })), null)
  assert.equal(await me(await mint(other)), null)
  assert.equal(await me(`v=${await sign(KEY, 'ticket', { gh: 4242, share: id, exp: Date.now() + 60_000 })}`), null)
  assert.equal(await me(await mint(id, 99)), null)
  assert.equal(await me('v=garbage'), null)
  // Several v cookies (path mode keeps one per share path): the one for this share wins.
  assert.equal((await me(`${await mint(other)}; ${good}`)).login, 'dana-test')
})

test('viewer comments: post, list, idempotent retry, validation', async () => {
  const env = await ghEnv()
  const { id } = await publish(env, 'x', realMeta())
  addViewer(env, 4242, 'dana-test')
  addViewer(env, 7, 'noa')
  const dana = await mint(id), noa = await mint(id, 7)
  const one = uuid(), two = uuid()
  const target = { src: 'pricing/C.tsx:41', component: 'Toggle', path: 'main > div:nth-child(2) > button', x: 40.5, y: 50, view: { size: 'phone', w: 390, h: 844 } }
  const r1 = await post(env, id, dana, { id: one, variant: 'pricing/C', body: 'The toggle is easy to miss.', target })
  assert.equal(r1.status, 201)
  noCors(r1)
  const c1 = await r1.json()
  assert.deepEqual(Object.keys(c1).sort(), ['author', 'body', 'created_at', 'done_in', 'id', 'mine', 'owner_reply', 'owner_reply_at', 're', 'status', 'target', 'updated_at', 'variant', 'version'])
  assert.deepEqual({ ...c1, created_at: 0, updated_at: 0 }, { id: one, variant: 'pricing/C', body: 'The toggle is easy to miss.', target, status: 'new', owner_reply: null, owner_reply_at: null, re: null, author: { login: 'dana-test', name: 'DANA-TEST', avatar: 'https://avatars.example/4242' }, mine: true, created_at: 0, updated_at: 0, version: 1, done_in: null })
  const again = await post(env, id, dana, { id: one, variant: 'pricing/C', body: 'The toggle is easy to miss.', target })
  assert.equal(again.status, 200)
  assert.equal((await again.json()).id, one)
  assert.equal((await post(env, id, noa, { id: one, variant: 'pricing/A', body: 'mine now', target: null })).status, 409)
  assert.equal((await post(env, id, noa, { id: two, variant: 'home/B', body: 'Whole design', target: null })).status, 201)
  const all = await list(env, id, dana)
  assert.equal(typeof all.now, 'number')
  assert.deepEqual(all.removed, [])
  assert.deepEqual(all.comments.map(c => [c.id, c.mine, c.author.login]), [[one, true, 'dana-test'], [two, false, 'noa']])
  assert.equal(env.DB.sql.prepare('SELECT COUNT(*) AS n FROM comments').get().n, 2)
  // A signed-out viewer still reads them.
  assert.deepEqual((await list(env, id)).comments.map(c => c.mine), [false, false])
  const bad = async (body, why) => assert.equal((await post(env, id, dana, body)).status, 400, why)
  await bad({ id: 'not-a-uuid', variant: 'pricing/A', body: 'x', target: null }, 'id')
  await bad({ id: uuid(), variant: 'pricing/B', body: 'x', target: null }, 'variant not shared')
  await bad({ id: uuid(), variant: '../x', body: 'x', target: null }, 'variant shape')
  await bad({ id: uuid(), variant: 'pricing/A', body: '   ', target: null }, 'empty body')
  await bad({ id: uuid(), variant: 'pricing/A', body: 42, target: null }, 'body type')
  await bad({ id: uuid(), variant: 'pricing/A', body: 'x', target: { x: 'a', y: 1, view: { size: 'phone', w: 1, h: 1 } } }, 'target x')
  await bad({ id: uuid(), variant: 'pricing/A', body: 'x', target: { x: 1, y: 1 } }, 'target view')
  const bodyText = await call(env, shareApi(id, 'comments'), { method: 'POST', headers: { ...XP, cookie: dana, 'content-type': 'application/json' }, body: '{nope' })
  assert.equal(bodyText.status, 400)
  // Unknown target keys are dropped, not stored.
  const extra = await (await post(env, id, dana, { id: uuid(), variant: 'pricing/A', body: 'x', target: { x: 1, y: 2, view: { size: 'desktop', w: 1280, h: 800 }, html: '<b>' } })).json()
  assert.deepEqual(extra.target, { x: 1, y: 2, view: { size: 'desktop', w: 1280, h: 800 } })
  env.DB.sql.prepare('UPDATE shares SET comments = 0').run()
  const off = await post(env, id, dana, { id: uuid(), variant: 'pricing/A', body: 'x', target: null })
  assert.equal(off.status, 403)
  assert.equal((await off.json()).code, 'comments_off')
  const out = await post(env, id, 'v=nobody', { id: uuid(), variant: 'pricing/A', body: 'x', target: null })
  assert.deepEqual([out.status, (await out.json()).code], [401, 'signin'])
})

test('since returns changes by update time, removed ids, and private comments when the share says so', async () => {
  const env = await ghEnv()
  const { id } = await publish(env, 'x', realMeta())
  addViewer(env, 4242, 'dana-test')
  addViewer(env, 7, 'noa')
  const dana = await mint(id), noa = await mint(id, 7)
  const a = uuid(), b = uuid()
  await post(env, id, dana, { id: a, variant: 'pricing/A', body: 'one', target: null })
  await post(env, id, noa, { id: b, variant: 'pricing/A', body: 'two', target: null })
  const first = await list(env, id, dana)
  await new Promise(r => setTimeout(r, 5))
  assert.deepEqual((await list(env, id, dana, first.now + 1)).comments, [])
  await patch(env, a, { reply: 'Thanks, Dana' })
  await patch(env, b, { hidden: true })
  const later = await list(env, id, dana, first.now + 1)
  assert.deepEqual(later.comments.map(c => [c.id, c.owner_reply]), [[a, 'Thanks, Dana']])
  assert.equal(typeof later.comments[0].owner_reply_at, 'number')
  assert.deepEqual(later.removed, [b])
  assert.deepEqual((await list(env, id, noa)).comments.map(c => c.id), [a])
  env.DB.sql.prepare('UPDATE shares SET others_visible = 0').run()
  await patch(env, b, { hidden: false })
  assert.deepEqual((await list(env, id, noa)).comments.map(c => c.id), [b])
  assert.deepEqual((await list(env, id)).comments, [])
})

test('a viewer deletes their own comment while it is new; after that it only hides', async () => {
  const env = await ghEnv()
  const { id } = await publish(env, 'x', realMeta())
  addViewer(env, 4242, 'dana-test')
  addViewer(env, 7, 'noa')
  const dana = await mint(id), noa = await mint(id, 7)
  const a = uuid(), b = uuid()
  await post(env, id, dana, { id: a, variant: 'pricing/A', body: 'secret thought', target: { x: 1, y: 1, view: { size: 'phone', w: 390, h: 844 } } })
  await post(env, id, dana, { id: b, variant: 'pricing/A', body: 'two', target: null })
  const del = (cid, jar) => call(env, shareApi(id, `comments/${cid}`), { method: 'DELETE', headers: { ...XP, cookie: jar } })
  assert.equal((await del(a, noa)).status, 403)
  assert.equal((await del(a, 'v=x')).status, 401)
  assert.equal((await del(uuid(), dana)).status, 404)
  const r = await del(a, dana)
  assert.equal(r.status, 200)
  assert.deepEqual(await r.json(), { id: a, deleted: true })
  const row = env.DB.sql.prepare('SELECT body, target, deleted FROM comments WHERE id = ?').get(a)
  assert.deepEqual({ ...row }, { body: '', target: null, deleted: 1 })
  assert.equal((await patch(env, b, { status: 'sent' })).status, 200)
  assert.deepEqual(await (await del(b, dana)).json(), { id: b, withdrawn: true })
  assert.deepEqual((await list(env, id, dana)).comments, [])
  assert.equal((await del(a, dana)).status, 404)
  // Withdrawn is the viewer's own flag: the owner's unhide doesn't put it back on the link.
  const unhid = await (await patch(env, b, { hidden: false })).json()
  assert.deepEqual([unhid.hidden, unhid.withdrawn], [false, true])
  assert.deepEqual((await list(env, id, dana)).comments, [])
  // A deleted comment can't be sent, or moved on at all.
  const sent = await patch(env, a, { status: 'sent' })
  assert.equal(sent.status, 410)
  assert.equal((await sent.json()).code, 'deleted')
})

test('caps: 4000 characters, 30 an hour per viewer, 300 a day per share, each a 429 with words', async () => {
  const env = await ghEnv()
  const { id } = await publish(env, 'x', realMeta())
  addViewer(env, 4242, 'dana-test')
  const dana = await mint(id)
  const long = await post(env, id, dana, { id: uuid(), variant: 'pricing/A', body: 'x'.repeat(4001), target: null })
  assert.equal(long.status, 429)
  const tooLong = await long.json()
  assert.ok(tooLong.error)
  assert.equal(tooLong.code, 'too_long')
  assert.equal((await post(env, id, dana, { id: uuid(), variant: 'pricing/A', body: 'x'.repeat(4000), target: null })).status, 201)
  for (let i = 1; i < 30; i++) assert.equal((await post(env, id, dana, { id: uuid(), variant: 'pricing/A', body: `n${i}`, target: null })).status, 201, `comment ${i}`)
  const hour = await post(env, id, dana, { id: uuid(), variant: 'pricing/A', body: 'one too many', target: null })
  assert.equal(hour.status, 429)
  const perHour = await hour.json()
  assert.match(perHour.error, /hour/)
  assert.equal(perHour.code, 'hour')
  noCors(hour)
  // A viewer at the cap is turned away before anything is written.
  let writes = 0
  const prepare = env.DB.prepare
  env.DB.prepare = q => { const st = prepare(q); const bind = st.bind; return { ...st, run: () => { writes++; return st.run() }, bind: (...a) => { const b = bind(...a); return { ...b, run: () => { writes++; return b.run() } } } } }
  assert.equal((await post(env, id, dana, { id: uuid(), variant: 'pricing/A', body: 'again', target: null })).status, 429)
  env.DB.prepare = prepare
  assert.equal(writes, 0)
  // The share's day: a fresh viewer, the share already at 300.
  addViewer(env, 7, 'noa')
  const day = Math.floor(Date.now() / 86_400_000)
  env.DB.sql.prepare('UPDATE caps SET n = 300 WHERE what = ? AND slot = ?').run(`share:${id}`, day)
  const full = await post(env, id, await mint(id, 7), { id: uuid(), variant: 'pricing/A', body: 'late', target: null })
  assert.equal(full.status, 429)
  const perDay = await full.json()
  assert.match(perDay.error, /today/)
  assert.equal(perDay.code, 'day')
  assert.equal(env.DB.sql.prepare("SELECT COUNT(*) AS n FROM caps WHERE what = 'gh:7'").get().n, 0, 'a refused comment costs the viewer nothing')
  // An idempotent retry of a stored comment is not counted again.
  const kept = env.DB.sql.prepare('SELECT id FROM comments LIMIT 1').get().id
  assert.equal((await post(env, id, dana, { id: kept, variant: 'pricing/A', body: 'x', target: null })).status, 200)
})

test('owner comments: across the owner\'s shares, since, token required', async () => {
  const env = await ghEnv()
  const s1 = await publish(env, 'x', realMeta())
  const s2 = await publish(env, 'y', meta({ title: 'Home', scope: { protos: [{ id: 'home', variants: ['A'] }], start: 'home/A' } }))
  addViewer(env, 4242, 'dana-test')
  const a = uuid(), b = uuid()
  await post(env, s1.id, await mint(s1.id), { id: a, variant: 'pricing/A', body: 'one', target: null })
  await post(env, s2.id, await mint(s2.id), { id: b, variant: 'home/A', body: 'two', target: { x: 5, y: 6, view: { size: 'tablet', w: 820, h: 1180 } } })
  assert.equal((await call(env, `http://${BASE}/api/owner/comments`)).status, 401)
  const res = await owner(env, 'comments')
  assert.equal(res.status, 200)
  noCors(res)
  const got = await res.json()
  assert.equal(typeof got.now, 'number')
  assert.deepEqual(got.comments.map(c => [c.id, c.share.id, c.share.title]), [[a, s1.id, 'Pricing'], [b, s2.id, 'Home']])
  assert.deepEqual(Object.keys(got.comments[1]).sort(), ['author', 'body', 'created_at', 'deleted', 'done_in', 'hidden', 'id', 'owner_reply', 'owner_reply_at', 're', 'share', 'status', 'target', 'updated_at', 'variant', 'version', 'withdrawn'])
  assert.deepEqual(got.comments[1].author, { gh_id: 4242, login: 'dana-test', name: 'DANA-TEST', avatar: 'https://avatars.example/4242' })
  assert.deepEqual(got.comments[1].share, { id: s2.id, title: 'Home', version: 1 })
  assert.deepEqual(got.comments[1].target, { x: 5, y: 6, view: { size: 'tablet', w: 820, h: 1180 } })
  await new Promise(r => setTimeout(r, 5))
  assert.deepEqual((await (await owner(env, `comments?since=${got.now + 1}`)).json()).comments, [])
  // Another owner sees none of them and can't touch them.
  env.DB.sql.prepare('INSERT INTO owners (id, name, created_at) VALUES (?, ?, ?)').run('o2', 'Other', 1)
  env.DB.sql.prepare('INSERT INTO owner_tokens (sha256, owner_id, device, created_at) VALUES (?, ?, ?, ?)').run(await hex('other'), 'o2', 'x', 1)
  assert.deepEqual((await (await call(env, `http://${BASE}/api/owner/comments`, { headers: { authorization: 'Bearer other' } })).json()).comments, [])
  assert.equal((await call(env, `http://${BASE}/api/owner/comments/${a}`, { method: 'PATCH', headers: { authorization: 'Bearer other', 'content-type': 'application/json' }, body: '{"hidden":true}' })).status, 404)
})

test('owner PATCH: sent only from new (a lost race is 409), statuses only forward, reply and hide', async () => {
  const env = await ghEnv()
  const { id } = await publish(env, 'x', realMeta())
  addViewer(env, 4242, 'dana-test')
  const a = uuid()
  await post(env, id, await mint(id), { id: a, variant: 'pricing/A', body: 'one', target: null })
  const [x, y] = await Promise.all([patch(env, a, { status: 'sent' }), patch(env, a, { status: 'sent' })])
  assert.deepEqual([x.status, y.status].sort(), [200, 409])
  const lost = [x, y].find(r => r.status === 409)
  noCors(lost)
  const why = await lost.json()
  assert.ok(why.error)
  assert.equal(why.code, 'already_sent')
  assert.equal((await patch(env, a, { status: 'working' })).status, 200)
  assert.equal((await patch(env, a, { status: 'working' })).status, 200, 'the same status again is harmless')
  assert.equal((await patch(env, a, { status: 'sent' })).status, 409, 'backwards')
  assert.equal((await patch(env, a, { status: 'new' })).status, 409, 'backwards')
  const done = await (await patch(env, a, { status: 'done', reply: 'Fixed in the next version', hidden: false })).json()
  assert.equal(done.status, 'done')
  assert.equal(done.owner_reply, 'Fixed in the next version')
  assert.equal(typeof done.owner_reply_at, 'number')
  for (const body of [{}, { status: 'dismissed' }, { status: 'bogus' }, { reply: 5 }, { reply: 'x'.repeat(4001) }, { hidden: 'yes' }]) assert.equal((await patch(env, a, body)).status, 400, JSON.stringify(body))
  assert.equal((await patch(env, uuid(), { hidden: true })).status, 404)
  assert.equal((await owner(env, `comments/${a}`, { method: 'PATCH', headers: { 'content-type': 'text/plain' }, body: '{}' })).status, 415)
  const viewer = (await list(env, id)).comments[0]
  assert.deepEqual([viewer.status, viewer.owner_reply], ['done', 'Fixed in the next version'])
  const cleared = await (await patch(env, a, { reply: null })).json()
  assert.deepEqual([cleared.owner_reply, cleared.owner_reply_at], [null, null])
})

test('an update marks done comments done_in the new version; removing a share deletes its comments', async () => {
  const env = await ghEnv()
  const { id } = await publish(env, 'x', realMeta())
  addViewer(env, 4242, 'dana-test')
  const a = uuid(), b = uuid()
  await post(env, id, await mint(id), { id: a, variant: 'pricing/A', body: 'one', target: null })
  await post(env, id, await mint(id), { id: b, variant: 'pricing/A', body: 'two', target: null })
  await patch(env, a, { status: 'done' })
  await call(env, `http://${BASE}/api/shares/${id}`, { method: 'PUT', headers: { ...auth, 'x-share-meta': realMeta() }, body: gzipSync('v2') })
  const byId = Object.fromEntries((await list(env, id)).comments.map(c => [c.id, c]))
  assert.equal(byId[a].done_in, 2)
  assert.equal(byId[b].done_in, null)
  await call(env, `http://${BASE}/api/shares/${id}`, { method: 'PUT', headers: { ...auth, 'x-share-meta': realMeta() }, body: gzipSync('v3') })
  assert.equal(Object.fromEntries((await list(env, id)).comments.map(c => [c.id, c]))[a].done_in, 2, 'kept from the first version it was in')
  await call(env, `http://${BASE}/api/shares/${id}`, { method: 'DELETE', headers: auth })
  assert.equal(env.DB.sql.prepare('SELECT COUNT(*) AS n FROM comments').get().n, 0)
})

test('pruning the caps keeps only the current hour and day', async () => {
  const env = await makeEnv()
  const now = Date.now(), hour = Math.floor(now / 3_600_000), day = Math.floor(now / 86_400_000)
  const put = env.DB.sql.prepare('INSERT INTO caps (what, slot, n) VALUES (?, ?, ?)')
  for (const [what, slot] of [['gh:1', hour], ['gh:1', hour - 1], ['gh:1', hour - 30], ['share:a', day], ['share:a', day - 1], ['share:a', day - 9]]) put.run(what, slot, 3)
  await pruneCaps(env, now)
  assert.deepEqual(env.DB.sql.prepare('SELECT what, slot FROM caps ORDER BY what, slot').all().map(r => `${r.what}@${r.slot}`), [`gh:1@${hour}`, `share:a@${day}`])
})

test('what the host keeps of a GitHub user: login checked, name capped, avatar only from GitHub', () => {
  const real = {}
  const u = o => ({ id: 1, login: 'dana', name: 'Dana', avatar_url: 'https://avatars.githubusercontent.com/u/1?v=4', ...o })
  assert.deepEqual(viewerFrom(u(), real), { gh_id: 1, login: 'dana', name: 'Dana', avatar: 'https://avatars.githubusercontent.com/u/1?v=4' })
  assert.equal(viewerFrom(u({ avatar_url: 'https://evil.example/a.png' }), real).avatar, null)
  assert.equal(viewerFrom(u({ avatar_url: 'https://avatars.githubusercontent.com.evil.example/a.png' }), real).avatar, null)
  assert.equal(viewerFrom(u({ avatar_url: 'http://avatars.githubusercontent.com/u/1' }), real).avatar, null)
  // A test GitHub (GITHUB_API overridden) may serve avatars from anywhere over https.
  assert.equal(viewerFrom(u({ avatar_url: 'https://avatars.example/1' }), { GITHUB_API: 'http://127.0.0.1:9' }).avatar, 'https://avatars.example/1')
  assert.equal(viewerFrom(u({ name: 'x'.repeat(200) }), real).name.length, 80)
  assert.equal(viewerFrom(u({ login: 'bad login' }), real), null)
  assert.equal(viewerFrom(u({ id: -1 }), real), null)
})

// Online: a deployed database is made by host/migrations, in order; the local host by schema.sql and
// upgrade(). All three must end in the same tables, columns and indexes.
import { readdirSync as listDir } from 'node:fs'

const MIGRATIONS = new URL('../host/migrations/', import.meta.url)
const migrations = () => listDir(MIGRATIONS).filter(f => /^\d{4}_[a-z0-9_]+\.sql$/.test(f)).sort().map(f => [f, readFileSync(new URL(f, MIGRATIONS), 'utf8')])
const d1Of = sql => {
  const stmt = (query, args = []) => ({
    bind: (...a) => stmt(query, a),
    first: async () => sql.prepare(query).get(...args) ?? null,
    all: async () => ({ results: sql.prepare(query).all(...args) }),
    run: async () => { const r = sql.prepare(query).run(...args); return { success: true, meta: { changes: Number(r.changes) } } },
  })
  return { sql, prepare: q => stmt(q) }
}
// What a schema is, without the CREATE text (an ALTER-added column reads differently from one made in
// its CREATE TABLE): each table's columns by name, and each index's table, columns and uniqueness.
function shapeOf(sql) {
  const out = {}
  for (const { name, type } of sql.prepare("SELECT name, type FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name != 'd1_migrations' ORDER BY name").all()) {
    if (type === 'table') {
      const cols = sql.prepare(`PRAGMA table_info(${name})`).all().map(c => [c.name, c.type, c.notnull, c.dflt_value, c.pk].join(' ')).sort()
      const idx = sql.prepare(`PRAGMA index_list(${name})`).all().filter(i => i.origin === 'c').map(i => `${i.name} ${i.unique} ${sql.prepare(`PRAGMA index_info(${i.name})`).all().map(c => c.name).join(',')}`).sort()
      out[name] = { cols, idx }
    }
  }
  return out
}
const fromSchema = () => { const sql = new DatabaseSync(':memory:'); sql.exec(readFileSync(new URL('../host/schema.sql', import.meta.url), 'utf8')); return sql }
const fromMigrations = () => { const sql = new DatabaseSync(':memory:'); for (const [, text] of migrations()) sql.exec(text); return sql }

test('migrations: numbered from 0001, and 0001 is the phase 0 and 1 schema', () => {
  const list = migrations()
  assert.ok(list.length >= 2, 'at least 0001 and 0002')
  list.forEach(([f], i) => assert.ok(f.startsWith(String(i + 1).padStart(4, '0') + '_'), `${f} is number ${i + 1}`))
  assert.match(list[0][0], /^0001_initial\.sql$/)
  assert.match(list[1][0], /^0002_online\.sql$/)
  assert.match(list[2][0], /^0003_html_key\.sql$/)
  assert.match(list[3][0], /^0004_owner_presence\.sql$/)
})
test('migrations applied in order make what schema.sql makes', () => {
  const shape = shapeOf(fromMigrations())
  assert.deepEqual(shape, shapeOf(fromSchema()))
  assert.ok(shape.kv_trash && shape.meta, 'the online tables are there')
  assert.deepEqual(shape.kv_trash.cols, ['at INTEGER 1  0', 'key TEXT 0  1'])
  assert.deepEqual(shape.meta.cols, ['k TEXT 0  1', 'v TEXT 1  0'])
})
test('a phase 0 database plus upgrade() makes what schema.sql makes', async () => {
  const sql = fromSchema()
  // Phase 0's tables, as the first local hosts made them: comments without the phase 1 columns, and
  // none of the tables added since.
  sql.exec(`DROP TABLE comments; DROP TABLE viewers; DROP TABLE caps; DROP TABLE tickets; DROP TABLE kv_trash; DROP TABLE meta;
    ALTER TABLE shares DROP COLUMN html_key;
    CREATE TABLE comments (id TEXT NOT NULL, share_id TEXT NOT NULL REFERENCES shares(id) ON DELETE CASCADE,
      link_id TEXT NOT NULL, viewer TEXT NOT NULL, verified INTEGER NOT NULL, version INTEGER NOT NULL, route TEXT NOT NULL,
      body TEXT NOT NULL, re TEXT, status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','sent','working','done','dismissed')),
      taken_by TEXT, owner_reply TEXT, hidden INTEGER NOT NULL DEFAULT 0, done_in INTEGER,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (share_id, id));
    CREATE INDEX comments_owner_poll ON comments (share_id, updated_at);`)
  await upgrade(d1Of(sql))
  assert.deepEqual(shapeOf(sql), shapeOf(fromSchema()))
})
test('every migration runs twice, and none drops anything', () => {
  const sql = new DatabaseSync(':memory:')
  for (const [f, text] of migrations()) {
    sql.exec(text)
    const code = text.replace(/--.*$/gm, '')
    // SQLite has no ADD COLUMN IF NOT EXISTS: a migration that adds columns may only fail again with
    // "duplicate column", having changed nothing.
    if (/\bADD\s+COLUMN\b/i.test(code)) {
      const before = JSON.stringify(shapeOf(sql))
      assert.throws(() => sql.exec(text), /duplicate column/i, `${f} fails only on the column it added`)
      assert.equal(JSON.stringify(shapeOf(sql)), before)
    } else assert.doesNotThrow(() => sql.exec(text), `${f} runs again`)
    assert.ok(!/\bDROP\b/i.test(code), `${f} drops nothing`)
  }
})

// Online: the host on a public origin (prtype.dev in path mode, its old workers.dev name, the daily
// budget, the cron and the hardening a public host needs).
import { today, CAPS } from '../host/lib/budget.mjs'
import { CRON } from '../host/lib/cron.mjs'

const ONLINE = { BASE: 'prtype.dev', PATH_MODE: '1' }
const pubEnv = (extra = {}) => makeEnv({ ...ONLINE, ...extra })
const pubCall = (env, path, init) => call(env, `https://prtype.dev${path}`, init)
const pubPut = (env, id, html, m = meta()) => pubCall(env, `/api/shares/${id}`, { method: 'PUT', headers: { ...auth, 'x-share-meta': m }, body: gzipSync(html) })
const used = (env, what) => env.DB.sql.prepare('SELECT n FROM budget WHERE day = ? AND what = ?').get(today(), what)?.n ?? 0
const setUsed = (env, what, n) => env.DB.sql.prepare('INSERT INTO budget (day, what, n) VALUES (?, ?, ?) ON CONFLICT(day, what) DO UPDATE SET n = excluded.n').run(today(), what, n)
const hardened = res => {
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff', `${res.status} has nosniff`)
  assert.equal(res.headers.get('x-robots-tag'), 'noindex', `${res.status} has noindex`)
  noCors(res)
}

test('public path mode: the short link, the share under /s/<id>/, no subdomains, a Secure cookie per path', async () => {
  const env = await ghEnv(ONLINE)
  const { id, body } = await publish(env)
  const short = await pubCall(env, `/${id}`)
  assert.equal(short.status, 200)
  const html = await short.text()
  assert.ok(html.includes(`location.replace("https://prtype.dev/s/${id}/" + location.hash)`), 'the short link goes to the path form and keeps the hash')
  hardened(short)
  assert.deepEqual(await bytesOf(await pubCall(env, `/s/${id}/`)), body)
  assert.equal((await call(env, `https://${id}.prtype.dev/`)).status, 404)
  const s = await signIn(env, id, { start: `https://prtype.dev/s/${id}/_in/start`, back: `/s/${id}/` })
  assert.match(s.cookie, /^v=/)
  const a = attrs(s.cookie)
  assert.ok(a.includes(`path=/s/${id}/`) && a.includes('secure') && a.includes('httponly') && a.includes('samesite=lax'))
  assert.equal((await (await pubCall(env, `/s/${id}/api/me`, { headers: { ...XP, cookie: s.jar } })).json()).login, 'dana-test')
})

test('uploads: only the owner setup named; none at all before setup names one, off this Mac', async () => {
  const env = await pubEnv()
  const other = 'second-owner-token'
  env.DB.sql.prepare('INSERT INTO owners (id, name, created_at) VALUES (?, ?, ?)').run('o2', 'Mallory', 1)
  env.DB.sql.prepare('INSERT INTO owner_tokens (sha256, owner_id, device, created_at) VALUES (?, ?, ?, ?)').run(await hex(other), 'o2', 'x', 1)
  const { id } = await publish(env)
  const notOwner = async res => { assert.equal(res.status, 403); const b = await res.json(); assert.equal(b.code, 'not_owner'); assert.equal(b.error, 'This host takes uploads from its owner only.'); noCors(res) }
  const theirs = { authorization: `Bearer ${other}` }
  await notOwner(await pubCall(env, '/api/shares', { method: 'POST', headers: theirs }))
  await notOwner(await pubCall(env, `/api/shares/${id}`, { method: 'PUT', headers: { ...theirs, 'x-share-meta': meta() }, body: gzipSync('x') }))
  env.DB.sql.prepare("DELETE FROM meta WHERE k = 'owner_id'").run()
  await notOwner(await pubCall(env, '/api/shares', { method: 'POST', headers: auth }))
  await notOwner(await pubPut(env, id, 'again'))
  // The host on this Mac keeps phase 0's rule: its one owner, with or without the setting.
  const local = await makeEnv()
  local.DB.sql.prepare("DELETE FROM meta WHERE k = 'owner_id'").run()
  assert.equal((await publish(local)).put.status, 200)
})

test('sign-in only where the OAuth App lives: SIGNIN=0 reads comments and shows the signin page', async () => {
  const env = await ghEnv({ ...ONLINE, SIGNIN: '0' })
  const { id } = await publish(env)
  assert.equal((await (await pubCall(env, `/s/${id}/api/config`, { headers: XP })).json()).comments, false)
  const start = await pubCall(env, `/s/${id}/_in/start`, { redirect: 'manual' })
  assert.equal(start.status, 400)
  assert.ok((await start.text()).includes('Sign-in didn&#39;t finish'))
  assert.equal((await pubCall(env, `/auth/github?share=${id}&nonce=${NONCE}`, { redirect: 'manual' })).status, 400)
  const on = await ghEnv(ONLINE)
  const p = await publish(on)
  assert.equal((await (await pubCall(on, `/s/${p.id}/api/config`, { headers: XP })).json()).comments, true)
})

test('the old workers.dev name: 308 to the same path on prtype.dev, 410 for the api, health still 200', async () => {
  const LEGACY = 'proto-share.dananz.workers.dev'
  const env = await pubEnv({ LEGACY: `${LEGACY}, other.example` })
  const { id } = await publish(env)
  for (const path of [`/s/${id}/`, `/s/${id}/?v=1`, `/${id}`]) {
    const res = await call(env, `https://${LEGACY}${path}`, { redirect: 'manual' })
    assert.equal(res.status, 308, path)
    assert.equal(res.headers.get('location'), `https://prtype.dev${path}`)
    hardened(res)
  }
  for (const path of ['/api/shares', '/auth/github']) {
    const res = await call(env, `https://${LEGACY}${path}`, { headers: auth })
    assert.equal(res.status, 410, path)
    assert.equal((await res.json()).code, 'moved')
    hardened(res)
  }
  assert.equal((await call(env, `https://${LEGACY}/_health`)).status, 200)
  assert.equal((await call(env, `https://other.example/s/${id}/`, { redirect: 'manual' })).status, 308)
  // 308 keeps the method: a viewer's POST is re-sent to the same path there.
  assert.equal((await call(env, `https://${LEGACY}/s/${id}/api/comments`, { method: 'POST', redirect: 'manual' })).status, 308)
  assert.equal((await call(env, `https://${LEGACY}/nope`)).status, 404)
})

test('budget: uploads stop at 90% of the KV writes, with nothing written', async () => {
  const env = await pubEnv()
  const { id } = await publish(env)
  assert.equal(used(env, 'kv_write'), 1)
  setUsed(env, 'kv_write', CAPS.kv_write)
  const keys = [...env.KV.store.keys()]
  const row = () => env.DB.sql.prepare('SELECT version, title FROM shares WHERE id = ?').get(id)
  const before = row()
  const res = await pubPut(env, id, 'two', meta({ title: 'New' }))
  assert.equal(res.status, 507)
  const b = await res.json()
  assert.equal(b.code, 'budget')
  assert.match(b.error, /^The host's daily upload budget is used up\. It resets at 00:00 UTC \(\d\d:\d\d in Israel\)\.$/)
  assert.deepEqual([...env.KV.store.keys()], keys)
  assert.deepEqual(row(), before)
  setUsed(env, 'kv_write', 3)
  assert.equal((await pubPut(env, id, 'two')).status, 200)
})

test('budget: stored bytes stop at 900 MB, naming the biggest shares', async () => {
  const env = await pubEnv()
  const { id } = await publish(env)
  const big = (sid, title, bytes) => {
    env.DB.sql.prepare("INSERT INTO ids (id, kind) VALUES (?, 'share')").run(sid)
    env.DB.sql.prepare("INSERT INTO shares (id, owner_id, session, project_label, title, scope, version, bytes, lang, created_at, updated_at) VALUES (?, 'o1', 's', 'p', ?, '[]', 1, ?, 'en', 1, 1)").run(sid, title, bytes)
  }
  big('aaaaaaaaaa', 'Huge', 500_000_000)
  big('bbbbbbbbbb', 'Large', 300_000_000)
  big('cccccccccc', 'Medium', 100_000_000)
  big('dddddddddd', 'Small', 10)
  const res = await pubPut(env, id, 'x'.repeat(2000))
  assert.equal(res.status, 507)
  const b = await res.json()
  assert.equal(b.code, 'budget')
  assert.ok(b.error.includes('900 MB'), b.error)
  assert.ok(b.error.indexOf('Huge') < b.error.indexOf('Large') && b.error.indexOf('Large') < b.error.indexOf('Medium') && !b.error.includes('Small'), b.error)
  // A removed share's bytes are gone from KV, so they don't count.
  env.DB.sql.prepare("UPDATE shares SET deleted_at = 1 WHERE id = 'aaaaaaaaaa'").run()
  assert.equal((await pubPut(env, id, 'x'.repeat(2000))).status, 200)
})

test('budget: past 90% of the KV deletes an old version waits in kv_trash; the cron drains it', async () => {
  const env = await pubEnv()
  const { id } = await publish(env, 'one')
  const one = liveKey(env, id)
  setUsed(env, 'kv_delete', CAPS.kv_delete)
  assert.equal((await pubPut(env, id, 'two')).status, 200)
  assert.ok(env.KV.store.has(one), 'the old key stays for now')
  assert.deepEqual(env.DB.sql.prepare('SELECT key FROM kv_trash').all().map(r => r.key), [one])
  // The next day.
  env.DB.sql.prepare('DELETE FROM budget').run()
  await worker.scheduled({ cron: CRON, scheduledTime: Date.now() }, env)
  assert.deepEqual(htmlKeys(env, id), [liveKey(env, id)])
  assert.equal(env.DB.sql.prepare('SELECT COUNT(*) AS n FROM kv_trash').get().n, 0)
  assert.equal(used(env, 'kv_delete'), 1)
})

test('budget: a comment past 90% of the D1 writes is a 429 with code budget', async () => {
  const env = await ghEnv(ONLINE)
  const { id } = await publish(env, '<p>x', realMeta())
  addViewer(env, 4242, 'dana')
  const jar = await mint(id)
  const send = () => call(env, `https://prtype.dev/s/${id}/api/comments`, { method: 'POST', headers: { ...XP, cookie: jar, 'content-type': 'application/json' }, body: JSON.stringify({ id: uuid(), body: 'hi', variant: 'pricing/A', target: null }) })
  assert.equal((await send()).status, 201)
  assert.ok(used(env, 'd1_write') > 0, 'the comment counted its writes')
  setUsed(env, 'd1_write', CAPS.d1_write)
  const res = await send()
  assert.equal(res.status, 429)
  assert.equal((await res.json()).code, 'budget')
})

test('the owner reads today\'s usage', async () => {
  const env = await pubEnv()
  const { body } = await publish(env)
  assert.equal((await pubCall(env, '/api/owner/usage')).status, 401)
  const u = await (await pubCall(env, '/api/owner/usage', { headers: auth })).json()
  assert.equal(u.day, today())
  assert.equal(u.kv_write, 1)
  assert.equal(u.kv_delete, 0)
  assert.ok(u.d1_write > 0)
  assert.equal(u.kv_bytes, body.length)
  assert.deepEqual(u.caps, CAPS)
  assert.equal(u.resetsAt, Date.parse(`${today()}T00:00:00Z`) + 86_400_000)
})

test('the cron prunes old counters, spent tickets and old budget days', async () => {
  const env = await pubEnv()
  const now = Date.now(), hour = Math.floor(now / 3_600_000)
  env.DB.sql.prepare('INSERT INTO caps (what, slot, n) VALUES (?, ?, 1), (?, ?, 1)').run('gh:1', hour, 'gh:1', hour - 5)
  env.DB.sql.prepare('INSERT INTO tickets (nonce, exp) VALUES (?, ?), (?, ?)').run('old', now - 1, 'new', now + 60_000)
  const day = n => new Date(now - n * 86_400_000).toISOString().slice(0, 10)
  for (const d of [0, 6, 8, 30]) env.DB.sql.prepare("INSERT INTO budget (day, what, n) VALUES (?, 'kv_write', 1)").run(day(d))
  await worker.scheduled({ cron: CRON, scheduledTime: now }, env)
  assert.deepEqual(env.DB.sql.prepare('SELECT what, slot FROM caps ORDER BY what').all().map(r => `${r.what}@${r.slot}`), [`gh:1@${hour}`])
  assert.deepEqual(env.DB.sql.prepare('SELECT nonce FROM tickets').all().map(r => r.nonce), ['new'])
  assert.deepEqual(env.DB.sql.prepare("SELECT day FROM budget WHERE what = 'kv_write' ORDER BY day DESC").all().map(r => r.day), [day(0), day(6)])
})

test('two updates at once: one wins, the other is a 409 race, and only the winner\'s bytes are in KV', async () => {
  const env = await pubEnv()
  const { id } = await publish(env, 'one')
  // Both have read the share (version 1) and both write version 2: each KV write waits for the other's.
  let waiting = []
  const put = env.KV.put
  env.KV.put = async (key, value) => {
    await put(key, value)
    if (waiting) await new Promise(go => { waiting.push(go); if (waiting.length === 2) { waiting.forEach(f => f()); waiting = null } })
  }
  const [a, b] = await Promise.all([pubPut(env, id, 'from a'), pubPut(env, id, 'from b')])
  env.KV.put = put
  const statuses = [a.status, b.status].sort()
  assert.deepEqual(statuses, [200, 409])
  const lost = a.status === 409 ? a : b
  assert.equal((await lost.json()).code, 'race')
  assert.match(liveKey(env, id), new RegExp(`^html:${id}:2:`))
  assert.deepEqual(htmlKeys(env, id), [liveKey(env, id)], 'the loser dropped its own key, never the live one')
  const won = a.status === 200 ? 'from a' : 'from b'
  assert.deepEqual(await bytesOf(await pubCall(env, `/s/${id}/`)), gzipSync(won))
  // The loser's retry lands as the next version.
  assert.equal((await (await pubPut(env, id, 'again')).json()).version, 3)
})

test('delete writes the tombstone before it drops the KV key', async () => {
  const env = await pubEnv()
  const { id } = await publish(env)
  const key = liveKey(env, id)
  const seen = []
  const del = env.KV.delete
  env.KV.delete = async key => { seen.push([key, env.DB.sql.prepare('SELECT deleted_at FROM shares WHERE id = ?').get(id).deleted_at]); return del(key) }
  assert.equal((await pubCall(env, `/api/shares/${id}`, { method: 'DELETE', headers: auth })).status, 200)
  assert.equal(seen.length, 1, 'one key: the html (no preview image is written yet)')
  assert.equal(seen[0][0], key)
  assert.ok(seen[0][1] > 0, 'the tombstone was already there')
  assert.equal((await pubCall(env, `/s/${id}/`)).status, 410)
  assert.equal(env.DB.sql.prepare('SELECT COUNT(*) AS n FROM kv_trash').get().n, 0, 'a delete that worked leaves nothing queued')
})

test('a KV delete that fails is finished by the cron, for a removed share and an update alike', async () => {
  const env = await pubEnv()
  const a = await publish(env, 'a')
  const b = await publish(env, 'b')
  const aKey = liveKey(env, a.id), bOld = liveKey(env, b.id)
  const del = env.KV.delete
  env.KV.delete = async () => { throw new Error('KV is down') }
  const quiet = console.error
  console.error = () => {}
  try {
    const gone = await pubCall(env, `/api/shares/${a.id}`, { method: 'DELETE', headers: auth })
    assert.equal(gone.status, 200)
    assert.equal((await pubCall(env, `/s/${a.id}/`)).status, 410)
    // The update has landed even though its old key could not be deleted.
    const up = await pubPut(env, b.id, 'b two')
    assert.equal(up.status, 200)
    assert.equal((await up.json()).version, 2)
  } finally { console.error = quiet }
  assert.deepEqual(env.DB.sql.prepare('SELECT key FROM kv_trash ORDER BY key').all().map(r => r.key), [aKey, bOld].sort())
  env.KV.delete = del
  // Removing it again is harmless.
  assert.equal((await pubCall(env, `/api/shares/${a.id}`, { method: 'DELETE', headers: auth })).status, 200)
  await worker.scheduled({ cron: CRON, scheduledTime: Date.now() }, env)
  assert.ok(!env.KV.store.has(aKey) && !env.KV.store.has(bOld))
  assert.equal(env.DB.sql.prepare('SELECT COUNT(*) AS n FROM kv_trash').get().n, 0)
})

test('an upload whose body is slow reads the share after it, and lands as the next version', async () => {
  const env = await pubEnv()
  const { id } = await publish(env, 'one')
  let send
  const arrived = new Promise(go => { send = go })
  const slow = new ReadableStream({ async pull(c) { await arrived; c.enqueue(new Uint8Array(gzipSync('slow'))); c.close() } })
  const a = pubCall(env, `/api/shares/${id}`, { method: 'PUT', headers: { ...auth, 'x-share-meta': meta() }, body: slow, duplex: 'half' })
  // Meanwhile another upload lands version 2.
  assert.equal((await (await pubPut(env, id, 'quick')).json()).version, 2)
  send()
  const res = await a
  assert.equal(res.status, 200)
  assert.equal((await res.json()).version, 3)
  assert.deepEqual(htmlKeys(env, id), [liveKey(env, id)])
  assert.deepEqual(await bytesOf(await pubCall(env, `/s/${id}/`)), gzipSync('slow'))
})

test('the hourly cron stays under 50 subrequests with a 1,000-key backlog, a batch at a time', async () => {
  assert.equal(CRON, '17 * * * *')
  const env = await pubEnv()
  const insert = env.DB.sql.prepare('INSERT INTO kv_trash (key, at) VALUES (?, ?)')
  for (let i = 0; i < 1000; i++) { const k = `html:trash${String(i).padStart(5, '0')}:1`; env.KV.store.set(k, new ArrayBuffer(1)); insert.run(k, i) }
  env.DB.ops.n = 0
  await worker.scheduled({ cron: CRON, scheduledTime: Date.now() }, env)
  const first = env.DB.ops.n
  assert.ok(first < 50, `one run made ${first} D1 queries and KV calls`)
  const left = env.DB.sql.prepare('SELECT COUNT(*) AS n FROM kv_trash').get().n
  assert.ok(left < 1000 && left >= 950, `${1000 - left} keys in one run`)
  assert.equal(env.KV.store.size, left, 'the deleted keys are the dequeued ones')
  // It stops short of the day's delete budget, leaving room for the day's own updates.
  setUsed(env, 'kv_delete', 800)
  await worker.scheduled({ cron: CRON, scheduledTime: Date.now() }, env)
  assert.equal(env.DB.sql.prepare('SELECT COUNT(*) AS n FROM kv_trash').get().n, left)
})

test('the cron flushes its counters even when it fails', async () => {
  const env = await pubEnv()
  env.DB.sql.prepare('INSERT INTO kv_trash (key, at) VALUES (?, 1)').run('html:x:1')
  const all = env.DB.prepare
  // The DELETE ... IN after the KV delete fails; the KV delete already counted nothing, but the
  // prunes' writes still reach today's d1_write.
  env.DB.prepare = q => q.startsWith('DELETE FROM kv_trash WHERE key IN') ? { bind: () => ({ run: async () => { throw new Error('D1 is down') } }) } : all(q)
  const quiet = console.error
  console.error = () => {}
  env.DB.sql.prepare("INSERT INTO tickets (nonce, exp) VALUES ('old', 1)").run()
  try {
    await assert.rejects(worker.scheduled({ cron: CRON, scheduledTime: Date.now() }, env), /D1 is down/)
  } finally { console.error = quiet; env.DB.prepare = all }
  assert.ok(used(env, 'd1_write') > 0)
})

test('a version just published but not yet readable in KV is read again, not a 500', async () => {
  const env = await pubEnv()
  const { id, body } = await publish(env)
  const get = env.KV.get
  let misses = 1
  env.KV.get = async (...a) => misses-- > 0 ? null : get(...a)
  const res = await pubCall(env, `/s/${id}/`)
  assert.equal(res.status, 200)
  assert.deepEqual(await bytesOf(res), body)
})

test('the owner token writes last_used_at at most once an hour', async () => {
  const env = await pubEnv()
  const last = () => env.DB.sql.prepare('SELECT last_used_at FROM owner_tokens').get().last_used_at
  await pubCall(env, '/api/shares', { headers: auth })
  const first = last()
  assert.ok(first > 0)
  const writes = used(env, 'd1_write')
  await pubCall(env, '/api/shares', { headers: auth })
  assert.equal(last(), first)
  assert.equal(used(env, 'd1_write'), writes, 'a poll writes nothing')
  env.DB.sql.prepare('UPDATE owner_tokens SET last_used_at = ?').run(Date.now() - 3_700_000)
  await pubCall(env, '/api/shares', { headers: auth })
  assert.ok(last() > Date.now() - 60_000)
})

test('a crash answers JSON on the apis and HTML elsewhere', async () => {
  const env = await pubEnv()
  const { id } = await publish(env)
  const broken = { ...env, DB: { prepare() { throw new Error('boom') } } }
  const quiet = console.error
  console.error = () => {}
  try {
    for (const path of ['/api/shares', `/s/${id}/api/state`]) {
      const res = await pubCall(broken, path, { headers: { ...auth, ...XP } })
      assert.equal(res.status, 500, path)
      assert.match(res.headers.get('content-type'), /^application\/json/)
      assert.equal((await res.json()).code, 'error')
      hardened(res)
    }
    const page = await pubCall(broken, `/s/${id}/`)
    assert.equal(page.status, 500)
    assert.match(page.headers.get('content-type'), /^text\/html/)
  } finally { console.error = quiet }
})

test('health names the host version; every answer is nosniff and noindex, none has CORS', async () => {
  const env = await pubEnv({ HOST_VERSION: 'abc123' })
  const { id } = await publish(env)
  const health = await pubCall(env, '/_health')
  assert.equal(health.status, 200)
  assert.equal(health.headers.get('x-proto-host'), 'abc123')
  hardened(health)
  hardened(await pubCall(env, `/s/${id}`, { redirect: 'manual' }))
  hardened(await pubCall(env, `/s/${id}/`, { method: 'POST' }))
  hardened(await pubCall(env, '/auth/github', { method: 'POST' }))
  hardened(await pubCall(env, `/s/${id}/api/state`, { headers: XP }))
  hardened(await pubCall(env, '/nope'))
})
