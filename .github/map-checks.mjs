// The map (app/shell/map/): with the project tree on, the overview is a canvas of the designs'
// screens (live), their options and the explorations on no screen, with the <Go to> links as
// lines. A board double-clicked opens it; M goes back to the map; ?tree=0 keeps the old lobby.
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

export async function mapChecks({ proto, app, local, openPage, fail }) {
  const assert = (ok, why) => { if (!ok) fail(`map: ${why}`) }
  const wait = ms => new Promise(r => setTimeout(r, ms))
  const until = async (page, expression, why) => {
    for (const end = Date.now() + 8000; Date.now() < end; await wait(50)) if (await page.run(expression)) return
    fail(`map: ${why} (timed out: ${expression}; at ${await page.run('location.pathname')})`)
  }
  const variant = (slug, letter, body) => writeFileSync(join(app, 'src', 'protos', slug, `${letter}.tsx`), `import { Go } from '../../go'\nexport default function V() { return <main style={{ padding: 32 }}>${body}</main> }\n`)

  proto(['add', 'mhome', '--title', 'Map home', '--variants', 'A:One,B:Two'])
  proto(['design', 'mhome/B', '--title', 'Map Acme', '--id', 'macme'])
  proto(['add', 'mabout', '--title', 'Map about', '--design', 'macme', '--variants', 'A:One'])
  proto(['add', 'mloose', '--title', 'Map loose', '--variants', 'A:One,B:Two'])
  variant('mhome', 'B', `<h1 data-shoot="mhome-live">Home</h1><Go to="mabout">About</Go>`)
  variant('mhome', 'A', '<h1>Home A</h1>')
  variant('mabout', 'A', '<h1>About</h1>')
  for (const l of ['A', 'B']) variant('mloose', l, `<h1>Loose ${l}</h1>`)
  for (const s of ['mhome', 'mabout', 'mloose']) proto(['done', s])

  let page = await openPage(`${local}?tree=0`)
  try {
    await wait(800)
    assert(await page.run(`document.querySelector('[data-map-host]').hidden`), 'with ?tree=0 the map should stay hidden')
  } finally { page.close() }

  page = await openPage(`${local}?tree=1`)
  try {
    await until(page, `!!document.querySelector('[data-map-board="screen:mhome"]')`, 'the map should draw the design\'s screens')
    assert(await page.run(`!document.querySelector('[data-map-host]').hidden`), 'the map should show at the overview')
    assert(await page.run(`!!document.querySelector('[data-map-label="design:macme"]') && !!document.querySelector('[data-map-label="flow:macme:Main"]')`), 'the design and its flow should be named')
    assert(await page.run(`!!document.querySelector('[data-map-board="opt:mloose/A"]') && !!document.querySelector('[data-map-board="opt:mloose/B"]')`), 'an exploration on no screen should be spread as its options')
    assert(await page.run(`!!document.querySelector('[data-map-board="opt:mhome/B"]')`), 'a screen\'s options should be on the map under it')
    // Selected only by default: no line until a board is selected.
    assert(await page.run(`!document.querySelector('[data-map-line]')`), 'no link line should show before a selection')
    await page.run(`document.querySelector('[data-map-board="screen:mhome"]').click()`)
    await until(page, `!!document.querySelector('[data-map-line="mhome>mabout"]')`, 'selecting home should draw its link to about')
    await page.run(`document.querySelector('[data-map-lines]').click()`)
    await until(page, `document.querySelector('[data-map-lines]').getAttribute('aria-pressed') === 'false'`, 'the lines switch should turn to all')
    await until(page, `localStorage.getItem('proto-map-lines') === 'all'`, 'the lines mode should be kept')
    // Zoomed into the home screen, its live preview draws.
    await page.run(`document.querySelector('[data-map-board="screen:mhome"]').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`)
    await until(page, `location.pathname === '/mhome/B'`, 'a double click should open the screen')
    assert(await page.run(`document.querySelector('[data-map-host]').hidden`), 'Focus should hide the map')
    await page.run(`document.body.focus(); dispatchEvent(new KeyboardEvent('keydown', { key: 'm', bubbles: true }))`)
    await until(page, `!document.querySelector('[data-map-host]').hidden`, 'M should go back to the map')
    await until(page, `!!document.querySelector('[data-map-board="screen:mhome"] [data-shoot="mhome-live"]')`, 'coming back the map flies out from the screen, which draws live')
  } finally { page.close() }
  for (const s of ['mhome', 'mabout', 'mloose']) proto(['archive', s])
  console.log('OK: the map: designs, screens live, options, loose explorations, link lines, open and back with M')
}
