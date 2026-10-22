// Favorites: a variant starred from its menu, with S, or with `proto fav` is kept in meta.ts, wears a
// star in the sidebar, the overview and the phone's sheet, and Favorites only lists just those (and
// is remembered). A link to a variant it hides still opens it. Only the page itself can star.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export async function favoritesChecks({ proto, app, local, openPage, fail }) {
  const assert = (ok, why) => { if (!ok) fail(`favorites: ${why}`) }
  const wait = ms => new Promise(r => setTimeout(r, ms))
  const favs = () => { try { return JSON.parse(readFileSync(join(app, 'src/protos/favfx/meta.ts'), 'utf8').replace(/^[\s\S]*?export default\s*/, '').replace(/;?\s*$/, '')).favorites ?? [] } catch { return null } }
  const settle = async (want, why) => {
    for (const end = Date.now() + 5000; Date.now() < end; await wait(50)) if (JSON.stringify(favs()) === JSON.stringify(want)) return
    fail(`favorites: ${why}: meta.ts has ${JSON.stringify(favs())}, wanted ${JSON.stringify(want)}`)
  }
  const until = async (page, expression, why) => {
    for (const end = Date.now() + 6000; Date.now() < end; await wait(50)) if (await page.run(expression)) return
    fail(`favorites: ${why} (timed out: ${expression})`)
  }
  const ids = ['A', 'B', 'C', 'D', 'E']
  proto(['add', 'favfx', '--title', 'Favorites', '--variants', ids.map((id, i) => `${id}:Option ${i + 1}`).join(',')])
  for (const id of ids) writeFileSync(join(app, `src/protos/favfx/${id}.tsx`), `export default function Variant() { return <main className="p-8"><h1>Option ${id}</h1></main> }`)
  proto(['done', 'favfx'])

  // The CLI stars by the number the page shows, and lists by number.
  const starred = proto(['fav', 'favfx/2', 'favfx/E'], { stdout: true })
  await settle(['B', 'E'], 'proto fav favfx/2 favfx/E')
  assert(/2 · Option 2, 5 · Option 5/.test(starred), `proto fav should list by number: ${starred}`)

  const page = await openPage(`${local}?theme=dark#/favfx`)
  try {
    await until(page, `document.querySelectorAll('[data-layers] [data-fav-mark]').length === 2`, 'the overview should star 2 and 5')
    assert(await page.run(`document.querySelectorAll('[data-side] [data-fav-mark]').length === 2`), 'the sidebar should star 2 and 5')
    // A star from the CLI reaches the open page (meta.ts through registry.ts), overview included, without a reload.
    await page.run(`window.__samePage = true`)
    proto(['fav', 'favfx/4'])
    await until(page, `document.querySelectorAll('[data-layers] [data-fav-mark]').length === 3 && document.querySelectorAll('[data-side] [data-fav-mark]').length === 3`, 'proto fav should star 4 in the open page')
    proto(['fav', 'favfx/4', '--off'])
    await until(page, `document.querySelectorAll('[data-layers] [data-fav-mark]').length === 2`, 'proto fav --off should unstar 4 in the open page')
    assert(await page.run(`window.__samePage === true`), 'a star from the CLI reloaded the page')
    // Favorite from a variant's ⋯ menu.
    await page.run(`document.querySelector('[data-side] [data-act="vm:favfx:C"]').click()`)
    await until(page, `[...document.querySelectorAll('[role=menuitem]')].some(b => b.textContent.trim().startsWith('Favorite'))`, 'the variant menu should offer Favorite')
    await page.run(`[...document.querySelectorAll('[role=menuitem]')].find(b => b.textContent.trim().startsWith('Favorite')).click()`)
    await settle(['B', 'C', 'E'], 'Favorite in the menu')
    await until(page, `document.querySelectorAll('[data-layers] [data-fav-mark]').length === 3`, 'the overview should star 3 at once')
    // Favorites only: the overview and the sidebar list just those, and it is remembered.
    await page.run(`document.querySelector('[data-layers] [data-fav-toggle]').click()`)
    await until(page, `document.querySelectorAll('[data-layers] [data-act^="pv:favfx:"]').length === 3`, 'Favorites only should show 3 cards')
    assert(await page.run(`[...document.querySelectorAll('[data-side] [data-act^="mv:favfx:"]')].map(b => b.dataset.act.split(':')[2]).join() === 'B,C,E'`), 'Favorites only should list B, C and E in the sidebar')
    assert(await page.run(`document.querySelector('[data-layers] [data-fav-toggle]').getAttribute('aria-pressed') === 'true'`), 'the toggle should read as on')
    await page.run(`location.reload()`)
    await wait(500)
    await until(page, `document.documentElement.dataset.ready === '1' && document.querySelectorAll('[data-layers] [data-act^="pv:favfx:"]').length === 3`, 'Favorites only should be remembered over a reload')
    // The arrows step through the favorites only: 2 → 3.
    await page.run(`location.hash = '#/favfx/B'`)
    await until(page, `document.title.startsWith('2 ·')`, 'variant 2 should open')
    await page.run(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))`)
    await until(page, `location.hash === '#/favfx/C'`, 'the next arrow should go to the next favorite')
    // S unstars the variant shown; with Favorites only on, it leaves for the overview.
    await page.run(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', bubbles: true }))`)
    await settle(['B', 'E'], 'S on a favorite')
    await until(page, `location.hash === '#/favfx'`, 'unstarring the variant shown should go to the overview')
    // A link to a variant Favorites only hides still opens it (and shows everything again).
    await page.run(`location.hash = '#/favfx/A'`)
    await until(page, `document.title.startsWith('1 ·')`, 'a link to a hidden variant should open it')
    assert(await page.run(`document.querySelectorAll('[data-side] [data-act^="mv:favfx:"]').length === 5`), 'opening a hidden variant should show every variant again')
    await page.run(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', bubbles: true }))`)
    await settle(['A', 'B', 'E'], 'S on a variant')
    // Another site can't star: the server answers only the page's own origin.
    const res = await fetch(`${local}__proto/fav`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://example.com' }, body: JSON.stringify({ proto: 'favfx', variant: 'D', on: true }) })
    assert(res.status === 403, `a star from another origin should be refused, got ${res.status}`)
    const bad = await page.run(`fetch('/__proto/fav', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ proto: 'favfx', variant: 'Q', on: true }) }).then(r => r.status)`)
    assert(bad === 404, `a star on a variant that isn't there should be refused, got ${bad}`)
  } finally { page.close() }

  // The phone's sheet stars them and offers Favorites only.
  const phone = await openPage(`${local}?theme=dark#/favfx/B`, { width: 393, height: 852, phone: true })
  try {
    await until(phone, `!!document.querySelector('[data-pill-handle]')`, 'the phone pill should draw')
    await phone.run(`document.querySelector('[data-pill-handle]').focus()`)
    await phone.key('Enter')
    await until(phone, `!!document.querySelector('[role="dialog"] [data-fav-toggle]')`, 'the phone sheet should offer Favorites only')
    assert(await phone.run(`[...document.querySelectorAll('[role="dialog"] button[aria-current]')].filter(b => b.querySelector('svg.text-amber-500')).length === 3`), 'the phone sheet should star 1, 2 and 5')
  } finally { phone.close() }

  proto(['fav', 'favfx/1', 'favfx/2', 'favfx/5', '--off'])
  await settle([], 'proto fav --off')
  assert(!readFileSync(join(app, 'src/protos/favfx/meta.ts'), 'utf8').includes('"favorites"'), 'no favorites left should leave no favorites key')
  console.log('favorites: menu, S, proto fav (live in an open page), stars, Favorites only (remembered, arrows, links to hidden variants), phone sheet and origin check passed')
}
