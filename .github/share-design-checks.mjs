// A share of a design's screens opens on its first screen, at the option it shows, and a <Go to> link
// walks to the next. The share is built for real and served with the host's CSP.
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { SHARE_CSP } from '../host/lib/pages.mjs'

const skill = dirname(dirname(fileURLToPath(import.meta.url)))

export async function shareDesignChecks({ proto, app, openPage, fail }) {
  const assert = (ok, why) => { if (!ok) fail(`share design: ${why}`) }
  const wait = ms => new Promise(r => setTimeout(r, ms))
  const until = async (page, expression, why, ms = 15000) => {
    for (const end = Date.now() + ms; Date.now() < end; await wait(100)) if (await page.run(expression)) return
    fail(`share design: ${why} (timed out: ${expression})`)
  }
  const variant = (slug, letter, body) => writeFileSync(join(app, 'src', 'protos', slug, `${letter}.tsx`), `import { Go } from '../../go'\nexport default function V() { return <main style={{ padding: 32 }}>${body}</main> }\n`)
  proto(['add', 'smhome', '--title', 'Share home', '--variants', 'A:One,B:Two'])
  proto(['design', 'smhome/B', '--title', 'Share Acme', '--id', 'smacme'])
  proto(['add', 'smabout', '--title', 'Share about', '--design', 'smacme', '--variants', 'A:One'])
  variant('smhome', 'A', '<h1>SM-HOME-A</h1>')
  variant('smhome', 'B', '<h1>SM-HOME-B</h1><Go to="smabout">About</Go><img alt="never" src="data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27/%3E" />')
  // An image that never decodes (a design waiting on something that never comes): the page takes the
  // share's stills itself, and this one must not hold up the others (it keeps its name card).
  writeFileSync(join(app, 'src', 'protos', 'smhome', 'B.tsx'), `const decode = HTMLImageElement.prototype.decode\nHTMLImageElement.prototype.decode = function () { return this.alt === 'never' ? new Promise(() => {}) : decode.call(this) }\n` + readFileSync(join(app, 'src', 'protos', 'smhome', 'B.tsx'), 'utf8'))
  variant('smabout', 'A', '<h1>SM-ABOUT-A</h1>')
  for (const s of ['smhome', 'smabout']) proto(['done', s])

  // A design.ts that is not a design (written by hand, half saved) is skipped, never the build's end.
  for (const [id, text] of [['smbroken', 'export default null\n'], ['smbroken2', 'export default {"title":"B","flows":[null,{"name":"M","screens":[null,"smhome"]}]}\n']]) {
    mkdirSync(join(app, 'src', 'designs', id), { recursive: true }); writeFileSync(join(app, 'src', 'designs', id, 'design.ts'), text)
  }
  const { buildShare } = await import(join(skill, 'app', 'share', 'build.mjs'))
  let html = ''
  try { html = (await buildShare({ sessionDir: app, scope: { protos: [{ id: 'smhome', variants: ['B'] }, { id: 'smabout', variants: ['A'] }], start: 'smhome/B' }, info: { title: 'Share design', owner: 'Smoke', version: 1 } })).html } catch (e) { fail(`share design: buildShare threw: ${e?.stack || e}`) }
  assert(!html.includes('SM-HOME-A'), 'only the shared option of home is in the share')
  const json = (res, body) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)) }
  const server = createServer((req, res) => {
    const at = req.url.split('?')[0].replace(/^\/s\/[a-z0-9]+(?=\/)/, '')
    if (at === '/api/state') return json(res, { version: 1, updatedAt: Date.now() })
    if (at === '/api/config') return json(res, { comments: false, owner: 'Smoke' })
    if (at === '/api/me') return json(res, null)
    if (at === '/api/comments') return json(res, { comments: [], removed: [], now: Date.now() })
    if (at === '/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': SHARE_CSP }); return res.end(html) }
    res.writeHead(404); res.end()
  })
  await new Promise(ok => server.listen(0, '127.0.0.1', ok))
  const page = await openPage(`http://127.0.0.1:${server.address().port}/s/smap1/`)
  try {
    await until(page, `document.body.innerText.includes('SM-HOME-B') || [...document.querySelectorAll('iframe')].some(f => f.contentDocument?.body?.innerText.includes('SM-HOME-B'))`, 'the share should open on the first screen')
    assert(await page.run(`!document.querySelector('[data-viewer-map], [data-viewer-map-btn], [data-map-board]')`), 'a share should have no map')
    // A <Go to> link in the shared screen walks to the other screen.
    await page.run(`(() => { const doc = [...document.querySelectorAll('iframe')].map(f => f.contentDocument).find(d => d?.querySelector('a')) ?? document; const a = [...doc.querySelectorAll('a')].find(x => x.textContent === 'About'); a?.click(); return !!a })()`)
    await until(page, `document.body.innerText.includes('SM-ABOUT-A') || [...document.querySelectorAll('iframe')].some(f => f.contentDocument?.body?.innerText.includes('SM-ABOUT-A'))`, 'a link in a shared screen should walk to its target')
  } finally { page.close(); server.close() }
  for (const s of ['smhome', 'smabout']) proto(['archive', s])
  for (const id of ['smbroken', 'smbroken2']) rmSync(join(app, 'src', 'designs', id), { recursive: true, force: true })
  console.log('OK: a share of a design opens on its first screen, and a link walks to the next')
}
