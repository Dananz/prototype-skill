// The map (app/shell/map/): with the project tree on, the overview is a canvas of the designs'
// screens (live), their options and the explorations on no screen, with the <Go to> links as
// lines. A board double-clicked opens it; M goes back to the map; ?tree=0 keeps the old lobby.
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
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
  const inbox = join(app, '.proto', 'inbox', 'new')
  const batches = () => existsSync(inbox) ? readdirSync(inbox).filter(b => !b.startsWith('.')) : []
  // What the page sent last: the one batch that came after `had`.
  const sentAfter = async had => {
    for (const end = Date.now() + 8000; Date.now() < end; await wait(100)) {
      const b = batches().find(x => !had.has(x))
      if (b) { const c = JSON.parse(readFileSync(join(inbox, b, 'batch.json'), 'utf8')).comments[0]; rmSync(join(inbox, b), { recursive: true, force: true }); return c }
    }
    return null
  }
  const typeIn = (page, sel, text) => page.run(`(() => { const f = document.querySelector('${sel}'); const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; set.call(f, ${JSON.stringify(text)}); f.dispatchEvent(new Event('input', { bubbles: true })) })()`)
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
    // An edit to a screen's variant is a hot update, never a reload (the links are read by the server).
    await page.run(`window.__mapMark = 1`)
    variant('mhome', 'B', `<h1 data-shoot="mhome-live">Home again</h1><Go to="mabout">About</Go>`)
    await wait(2500)
    assert(await page.run(`window.__mapMark === 1`), 'editing a screen reloaded the page')
    // A design changed on disk is drawn on the map at once.
    proto(['design', 'macme', '--flow', 'Extra', '--screens', 'mabout'])
    await until(page, `!!document.querySelector('[data-map-label="flow:macme:Extra"]')`, 'a new flow should reach the map without a reload')
    assert(await page.run(`window.__mapMark === 1`), 'a design change reloaded the page')
    proto(['design', 'macme', '--flow', 'Main', '--screens', 'mabout'])
    await until(page, `!document.querySelector('[data-map-label="flow:macme:Extra"]')`, 'the screen moved back')

    // A note on a link line, and on a flow, reaches the agent.
    let had = new Set(batches())
    await page.run(`document.querySelector('[data-map-line-hit="mhome>mabout"]').dispatchEvent(new MouseEvent('click', { bubbles: true }))`)
    await until(page, `document.querySelector('[data-map-note]')?.dataset.mapNote === 'line'`, 'a click on a line should open a note on it')
    await typeIn(page, '[data-map-note-field]', 'This should go to pricing')
    await page.run(`document.querySelector('[data-map-note-send]').click()`)
    let c = await sentAfter(had)
    assert(c?.action === 'map-note' && c.route === 'mhome/B' && /mhome to mabout: This should go to pricing/.test(c.text), `a line note should be a map-note on mhome/B: ${JSON.stringify(c)?.slice(0, 200)}`)
    await until(page, `!document.querySelector('[data-map-note]')`, 'the note should close once sent')
    had = new Set(batches())
    await page.run(`document.querySelector('[data-map-flow="flow:macme:Main"]').click()`)
    await until(page, `document.querySelector('[data-map-note]')?.dataset.mapNote === 'flow'`, 'a click on a flow name should open a note on it')
    await typeIn(page, '[data-map-note-field]', 'Too long')
    await page.run(`document.querySelector('[data-map-note-send]').click()`)
    c = await sentAfter(had)
    assert(c?.action === 'map-note' && /flow Main of the design macme: Too long/.test(c.text), `a flow note should name the flow: ${JSON.stringify(c)?.slice(0, 200)}`)

    // In a crowded app (the full smoke), narrow the map to this design and fit it: the screens are
    // big enough to drop a link on, and Build it (one design) is offered.
    await page.run(`(() => { const s = document.querySelector('[data-map-design]'); if (s) { s.value = 'macme'; s.dispatchEvent(new Event('change', { bubbles: true })) } })()`)
    await wait(500)
    await page.run(`document.querySelector('[data-map-fit]').click()`)
    await wait(800)
    // A line dragged from home's handle to about asks for a link.
    await page.run(`document.querySelector('[data-map-board="screen:mhome"]').click()`)
    await until(page, `!!document.querySelector('[data-map-handle]')`, 'a selected screen should offer a link handle')
    had = new Set(batches())
    await page.run(`(() => {
      const h = document.querySelector('[data-map-handle]').getBoundingClientRect(), t = document.querySelector('[data-map-board="screen:mabout"]').getBoundingClientRect()
      const at = (r) => ({ clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true, pointerId: 1 })
      document.querySelector('[data-map-handle]').dispatchEvent(new PointerEvent('pointerdown', at(h)))
      dispatchEvent(new PointerEvent('pointermove', at(t)))
      dispatchEvent(new PointerEvent('pointerup', at(t)))
    })()`)
    const where = await page.run(`(() => { const h = document.querySelector('[data-map-handle]')?.getBoundingClientRect(), t = document.querySelector('[data-map-board="screen:mabout"]')?.getBoundingClientRect(); const hit = t && document.elementFromPoint(t.left + t.width / 2, t.top + t.height / 2); return JSON.stringify({ h: h && [h.left, h.top, h.width], t: t && [t.left, t.top, t.width, t.height], hit: hit?.outerHTML.slice(0, 120), vw: innerWidth, vh: innerHeight }) })()`)
    await until(page, `document.querySelector('[data-map-note]')?.dataset.mapNote === 'link'`, `letting go over another screen should offer the link (${where})`)
    await page.run(`document.querySelector('[data-map-note-send]').click()`)
    c = await sentAfter(had)
    assert(c?.action === 'add-link' && c.route === 'mhome/B' && c.text.includes('<Go to="mabout">'), `the link should be an add-link on mhome/B: ${JSON.stringify(c)?.slice(0, 200)}`)

    // Build it on the one design: the picked screens are ticked, the open one is not.
    await until(page, `!document.querySelector('[data-map-note]')`, 'the link box should close once sent')
    await page.run(`document.querySelector('[data-map-build]').click()`)
    await until(page, `!!document.querySelector('[data-map-build-box]')`, 'Build it should open its box')
    assert(await page.run(`document.querySelector('[data-map-build-screen="screen:mhome"]').checked && !document.querySelector('[data-map-build-screen="screen:mabout"]').checked`), 'the picked screen should be ticked, the open one not')
    await page.run(`document.querySelector('[data-map-build-screen="screen:mabout"]').click()`)
    had = new Set(batches())
    await page.run(`document.querySelector('[data-map-build-send]').click()`)
    c = await sentAfter(had)
    assert(c?.action === 'build-design' && /proto handoff --design macme --screens mhome,mabout/.test(c.text) && /Still open, #1 stands in: mabout/.test(c.text), `Build it should send the plan: ${JSON.stringify(c)?.slice(0, 300)}`)

    await page.run(`(() => { const s = document.querySelector('[data-map-design]'); if (s) { s.value = ''; s.dispatchEvent(new Event('change', { bubbles: true })) } })()`)
    // A second design brings the design filter.
    proto(['add', 'mother', '--title', 'Map other', '--variants', 'A:One'])
    proto(['design', 'mother/A', '--title', 'Map Other', '--id', 'mother-d'])
    await until(page, `!!document.querySelector('[data-map-design]')`, 'two designs should bring the design filter')
    await until(page, `!!document.querySelector('[data-map-board="screen:mother"] [data-map-building]')`, 'a screen the agent is still building should say so on its board')
    assert(await page.run(`!document.querySelector('[data-map-board="screen:mhome"] [data-map-building]')`), 'a finished screen should carry no building mark')
    await page.run(`(() => { const s = document.querySelector('[data-map-design]'); s.value = 'macme'; s.dispatchEvent(new Event('change', { bubbles: true })) })()`)
    await until(page, `!document.querySelector('[data-map-board="screen:mother"]') && !!document.querySelector('[data-map-board="screen:mhome"]')`, 'the filter should show one design')
    await page.run(`(() => { const s = document.querySelector('[data-map-design]'); s.value = ''; s.dispatchEvent(new Event('change', { bubbles: true })) })()`)

    // Zoomed into the home screen, its live preview draws.
    await page.run(`document.querySelector('[data-map-board="screen:mhome"]').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`)
    await until(page, `location.pathname === '/mhome/B'`, 'a double click should open the screen')
    assert(await page.run(`document.querySelector('[data-map-host]').hidden`), 'Focus should hide the map')
    await page.run(`document.body.focus(); dispatchEvent(new KeyboardEvent('keydown', { key: 'm', bubbles: true }))`)
    await until(page, `!document.querySelector('[data-map-host]').hidden`, 'M should go back to the map')
    await until(page, `!!document.querySelector('[data-map-board="screen:mhome"] [data-shoot="mhome-live"]')`, 'coming back the map flies out from the screen, which draws live')
    // Enter on a focused button is the button's, not the map's (a screen is selected on the way back).
    await page.run(`(() => { const b = document.querySelector('[data-map-fit]'); b.focus(); b.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })) })()`)
    await wait(800)
    assert(await page.run(`location.pathname === '/'`), `Enter on a button should not open the selected screen (at ${await page.run('location.pathname')})`)
    // A click on the board already selected opens it, as the double click does.
    await page.run(`document.querySelector('[data-map-board="screen:mabout"]').click()`)
    await wait(300)
    assert(await page.run(`location.pathname === '/'`), 'a first click should only select the board')
    await page.run(`document.querySelector('[data-map-board="screen:mabout"]').click()`)
    await until(page, `location.pathname === '/mabout/A'`, 'a click on the selected board should open it')
  } finally { page.close() }
  for (const s of ['mhome', 'mabout', 'mloose', 'mother']) proto(['archive', s])
  console.log('OK: the map: designs, screens live, options, loose explorations, link lines, notes on lines and flows, dragged links, Build it, the building mark, the design filter, open and back with M, a second click opens')
}
