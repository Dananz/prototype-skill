// The map's server stills (app/stills.mjs): what a still's name depends on, and what a request may ask.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { stillKey, stillServer } from '../app/stills.mjs'

const app = () => {
  const root = mkdtempSync(join(tmpdir(), 'stills-'))
  for (const slug of ['home', 'about', 'hang', 'stall']) {
    mkdirSync(join(root, 'src', 'protos', slug), { recursive: true })
    writeFileSync(join(root, 'src', 'protos', slug, 'A.tsx'), 'export default () => null')
  }
  writeFileSync(join(root, 'src', 'theme.css'), '')
  return root
}
const touch = (path, s) => utimesSync(path, s, s)
const later = () => new Promise(r => setTimeout(r, 1100)) // the folders are walked once a second at most

test('a still is named by its route, size, theme and its prototype\'s files', async () => {
  const root = app()
  try {
    const at = { route: 'home/A', w: 1200, h: 750, theme: 'light' }
    const k = stillKey(root, at)
    assert.equal(stillKey(root, at), k)
    assert.notEqual(stillKey(root, { ...at, w: 390 }), k)
    assert.notEqual(stillKey(root, { ...at, theme: 'dark' }), k)
    // Another prototype's change leaves it alone; its own file, or the shared theme, makes a new one.
    touch(join(root, 'src', 'protos', 'about', 'A.tsx'), Date.now() / 1000 + 50)
    await later()
    assert.equal(stillKey(root, at), k)
    touch(join(root, 'src', 'protos', 'home', 'A.tsx'), Date.now() / 1000 + 100)
    await later()
    const k2 = stillKey(root, at)
    assert.notEqual(k2, k)
    touch(join(root, 'src', 'theme.css'), Date.now() / 1000 + 200)
    await later()
    assert.notEqual(stillKey(root, at), k2)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('a request names a variant, a sane size and a theme; without the skill nothing is taken', () => {
  const root = app()
  const s = stillServer({ root, origin: () => 'http://127.0.0.1:1', skill: '', emit: () => {} })
  try {
    assert.throws(() => s.ask({ route: '../x', w: 1200, h: 750 }), /route/)
    assert.throws(() => s.ask({ route: 'home/A', w: 20, h: 750 }), /w and h/)
    assert.throws(() => s.ask({ route: 'home/A', w: 1200, h: 750, theme: 'blue' }), /theme/)
    assert.deepEqual(s.ask({ route: 'home/A', w: 1200, h: 750 }), { unavailable: true })
    assert.equal(s.file('../../session.json'), null)
    assert.equal(s.file('0123456789abcdef0123.webp'), null)
  } finally { s.close(); rmSync(root, { recursive: true, force: true }) }
})

// Chrome as scripts/chrome.mjs finds it (it exits the process when there is none, so look first).
const skill = join(dirname(fileURLToPath(import.meta.url)), '..')
const chrome = process.env.CHROME || (process.platform === 'darwin'
  ? ['Google Chrome', 'Chromium', 'Microsoft Edge'].map(a => `/Applications/${a}.app/Contents/MacOS/${a}`).find(p => existsSync(p))
  : ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'].find(b => spawnSync('which', [b]).status === 0))

test('a design whose page never settles is taken as it is, and the stills after it still come', { skip: !chrome && 'no Chrome', timeout: 90_000 }, async () => {
  const root = app()
  // A page that says it's ready; hang/ keeps an image decoding for ever when it's shot (like a design
  // waiting on something that never comes).
  const site = createServer((req, res) => {
    if (req.url.startsWith('/stall/')) return // never answers
    const hang = req.url.startsWith('/hang/')
    res.setHeader('content-type', 'text/html')
    res.end(`<!doctype html><body style="margin:0;background:#2563eb"><main>${hang ? 'Waiting' : 'Ready'}</main>${hang ? `<img alt="" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E"><script>HTMLImageElement.prototype.decode = () => new Promise(() => {})</script>` : ''}<script>document.documentElement.dataset.ready = '1'</script></body>`)
  })
  await new Promise(r => site.listen(0, '127.0.0.1', r))
  const heard = new Map()
  const s = stillServer({ root, origin: () => `http://127.0.0.1:${site.address().port}`, skill, emit: d => heard.set(d.hash, d) })
  const done = async (hash, ms) => { for (const end = Date.now() + ms; Date.now() < end && !heard.has(hash); await new Promise(r => setTimeout(r, 100))) {} return heard.get(hash) }
  try {
    // One for each of the three tabs, then one that must not wait for ever behind them.
    const hung = [400, 500, 600].map(w => s.ask({ route: 'hang/A', w, h: 400 }).hash)
    const ok = s.ask({ route: 'home/A', w: 400, h: 400 }).hash
    const got = await done(ok, 45_000)
    assert.ok(got?.url, `the still after three that never settle should come (${JSON.stringify(got)})`)
    for (const h of hung) assert.ok((await done(h, 5_000))?.url, 'a page that never settles is taken as it is')
    // A page that never even loads is given up, and its tab with it: the next still is taken all the same.
    const stall = s.ask({ route: 'stall/A', w: 400, h: 400 }).hash
    assert.match((await done(stall, 30_000))?.error ?? '', /too long/, 'a page that never loads should be given up')
    const after = [700, 800, 900].map(w => s.ask({ route: 'home/A', w, h: 400 }).hash)
    for (const h of after) assert.ok((await done(h, 20_000))?.url, 'the stills after a given-up page should come')
  } finally { s.close(); site.close(); rmSync(root, { recursive: true, force: true }) }
})
