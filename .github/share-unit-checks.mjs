// Unit checks for the share-link pieces that need no browser: scope parsing, trimming and the pre-publish review.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ShareError, parseScope, trimMeta, trimSession } from '../app/share/scope.mjs'
import { review } from '../app/share/review.mjs'
import { stampSource, stampsPlugin } from '../app/share/stamps.mjs'
import { imagesPlugin } from '../app/share/images.mjs'
import { imageNames, loadSharp } from '../app/share/plugin.mjs'
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
  sql.prepare('INSERT INTO owners (id, name, created_at) VALUES (?, ?, ?)').run('o1', 'Dananz', 1)
  sql.prepare('INSERT INTO owner_tokens (sha256, owner_id, device, created_at) VALUES (?, ?, ?, ?)').run(await hex(TOKEN), 'o1', 'test', 1)
  const store = new Map()
  const KV = {
    store,
    async get(key, type) { const v = store.get(key); if (v === undefined) return null; return type === 'arrayBuffer' ? v.slice(0) : new TextDecoder().decode(v) },
    async put(key, value) { store.set(key, value instanceof ArrayBuffer ? value.slice(0) : new TextEncoder().encode(String(value)).buffer) },
    async delete(key) { store.delete(key) },
  }
  const stmt = (query, args = []) => ({
    bind: (...a) => stmt(query, a),
    first: async () => sql.prepare(query).get(...args) ?? null,
    all: async () => ({ results: sql.prepare(query).all(...args) }),
    run: async () => { const r = sql.prepare(query).run(...args); return { success: true, meta: { changes: Number(r.changes) } } },
  })
  const DB = { sql, prepare: q => stmt(q), async batch(list) { const out = []; for (const s of list) out.push(await s.run()); return out } }
  return { KV, DB, BASE, PATH_MODE: '0', ...extra }
}
const auth = { authorization: `Bearer ${TOKEN}` }
const meta = (o = {}) => Buffer.from(JSON.stringify({ title: 'Pricing', session: 's1', projectLabel: 'shop', scope: [{ proto: 'pricing', variants: ['A'] }], lang: 'en', ...o })).toString('base64url')
const call = (env, url, init) => worker.fetch(new Request(url, init), env)
const noCors = res => assert.deepEqual([...res.headers.keys()].filter(k => k.startsWith('access-control-')), [])
const bytesOf = async res => Buffer.from(await res.arrayBuffer())
async function publish(env, html = '<!doctype html><p>hello', m = meta()) {
  const created = await call(env, `http://${BASE}/api/shares`, { method: 'POST', headers: auth })
  const { id } = await created.json()
  const body = gzipSync(html)
  const put = await call(env, `http://${BASE}/api/shares/${id}`, { method: 'PUT', headers: { ...auth, 'x-share-meta': m }, body })
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
  assert.equal((await call(env, `http://${id}.${BASE}/?v=1`)).headers.get('cache-control'), 'private, max-age=31536000, immutable')
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
  const off = await makeEnv({ PATH_MODE: '0' })
  assert.equal((await call(off, `http://${BASE}/s/${id}/`)).status, 404)
})
test('update bumps version and drops the old key', async () => {
  const env = await makeEnv()
  const { id } = await publish(env, 'one')
  assert.ok(env.KV.store.has(`html:${id}:1`))
  const two = gzipSync('two')
  const put = await call(env, `http://${BASE}/api/shares/${id}`, { method: 'PUT', headers: { ...auth, 'x-share-meta': meta({ title: 'Pricing 2' }) }, body: two })
  assert.equal((await put.json()).version, 2)
  assert.ok(!env.KV.store.has(`html:${id}:1`) && env.KV.store.has(`html:${id}:2`))
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
