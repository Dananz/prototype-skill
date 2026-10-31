// A share of a design's screens opens on the design's map (look and open only): the screens drawn
// at the option they show, their <Go to> links as lines (read at build time), a screen opened from
// the map, and the Map button back. The share is built for real and served with the host's CSP.
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { SHARE_CSP } from '../host/lib/pages.mjs'

const skill = dirname(dirname(fileURLToPath(import.meta.url)))

export async function shareMapChecks({ proto, app, openPage, fail }) {
  const assert = (ok, why) => { if (!ok) fail(`share map: ${why}`) }
  const wait = ms => new Promise(r => setTimeout(r, ms))
  const until = async (page, expression, why, ms = 15000) => {
    for (const end = Date.now() + ms; Date.now() < end; await wait(100)) if (await page.run(expression)) return
    fail(`share map: ${why} (timed out: ${expression}; ${await page.run(`JSON.stringify({ stills: [...document.querySelectorAll('[data-map-board]')].map(b => b.dataset.mapBoard + ':' + b.querySelectorAll('img[data-map-still]').length + ':' + Math.round(b.getBoundingClientRect().width)), capturing: document.querySelectorAll('[data-map-capture]').length })`)})`)
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
  try { html = (await buildShare({ sessionDir: app, scope: { protos: [{ id: 'smhome', variants: ['B'] }, { id: 'smabout', variants: ['A'] }], start: 'smhome/B' }, info: { title: 'Share map', owner: 'Smoke', version: 1 } })).html } catch (e) { fail(`share map: buildShare threw: ${e?.stack || e}`) }
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
    await until(page, `!!document.querySelector('[data-viewer-map] [data-map-board="screen:smhome/B"]')`, 'the share should open on the design\'s map')
    assert(await page.run(`!!document.querySelector('[data-map-board="screen:smabout/A"]') && !!document.querySelector('[data-map-label="design:smacme"]')`), 'the map should hold both screens and the design\'s name')
    assert(await page.run(`!document.querySelector('[data-map-build]')`), 'a viewer cannot Build it')
    await until(page, `!!document.querySelector('[data-map-board="screen:smabout/A"] img[data-map-still]') && !document.querySelector('[data-map-capture]')`, 'the other screen should get its still, and the one that never loads be given up, not taken for ever', 60000)
    await page.run(`document.querySelector('[data-map-board="screen:smhome/B"]').click()`)
    await until(page, `!!document.querySelector('[data-map-line="smhome>smabout"]')`, 'the link read at build time should be drawn')
    assert(await page.run(`!document.querySelector('[data-map-handle]')`), 'a viewer cannot drag a link')
    await page.run(`document.querySelector('[data-map-board="screen:smhome/B"]').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`)
    await until(page, `!document.querySelector('[data-viewer-map]') && document.body.innerText.includes('SM-HOME-B')`, 'a double click should open the screen')
    // A <Go to> link in the shared screen walks to the other screen.
    await page.run(`(() => { const doc = [...document.querySelectorAll('iframe')].map(f => f.contentDocument).find(d => d?.querySelector('a')) ?? document; const a = [...doc.querySelectorAll('a')].find(x => x.textContent === 'About'); a?.click(); return !!a })()`)
    await until(page, `document.body.innerText.includes('SM-ABOUT-A') || [...document.querySelectorAll('iframe')].some(f => f.contentDocument?.body?.innerText.includes('SM-ABOUT-A'))`, 'a link in a shared screen should walk to its target')
    await page.run(`document.querySelector('[data-viewer-map-btn]').click()`)
    await until(page, `!!document.querySelector('[data-viewer-map]')`, 'the Map button should go back to the map')
  } finally { page.close(); server.close() }
  for (const s of ['smhome', 'smabout']) proto(['archive', s])
  for (const id of ['smbroken', 'smbroken2']) rmSync(join(app, 'src', 'designs', id), { recursive: true, force: true })
  console.log('OK: a share of a design opens on its map, links drawn, look and open only, Map to go back')
}
