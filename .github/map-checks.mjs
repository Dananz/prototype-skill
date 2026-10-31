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
  // Stills are taken one board at a time, each after its entrance settles: give them longer.
  const slow = async (page, expression, why) => {
    for (const end = Date.now() + 90000; Date.now() < end; await wait(200)) if (await page.run(expression)) return
    fail(`map: ${why} (timed out: ${expression})`)
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
    // Boards are stills of their page once it settled, not live pages: the dev server takes them in
    // headless Chrome (app/stills.mjs) and the page only shows the images.
    await slow(page, `!!document.querySelector('[data-map-board="screen:mhome"] img[data-map-still][src^="/__proto/stills/"]')`, 'a screen should show the server\'s still of itself')
    assert(await page.run(`!document.querySelector('[data-map-board] [data-mount]:not([data-map-live]) > *')`), 'no board but the one being read should keep its page mounted')
    // A still is the screen at its own size and 2x; the board shows the small one until it's big on screen.
    const sizes = await page.run(`(async () => { const i = document.querySelector('[data-map-board="screen:mhome"] img[data-map-still]'); const f = new Image(); f.src = i.getAttribute('src').replace('-s.webp', '.webp'); await f.decode(); return { small: i.naturalWidth, full: f.naturalWidth, frame: parseFloat(i.parentElement.style.width) } })()`)
    assert(sizes.full === sizes.frame * 2 && sizes.small === sizes.frame / 2, `the still should be the frame at 2x, and the small one at half: ${JSON.stringify(sizes)}`)
    // Selected only by default: no line until a board is selected.
    assert(await page.run(`!document.querySelector('[data-map-line]')`), 'no link line should show before a selection')
    await page.run(`document.querySelector('[data-map-board="screen:mhome"]').click()`)
    await until(page, `!!document.querySelector('[data-map-line="mhome>mabout"]')`, 'selecting home should draw its link to about')
    await page.run(`document.querySelector('[data-map-lines]').click()`)
    await until(page, `document.querySelector('[data-map-lines]').getAttribute('aria-pressed') === 'true'`, 'the strip\'s links toggle should show every link')
    await until(page, `localStorage.getItem('proto-map-lines') === 'all'`, 'the lines mode should be kept')
    // An edit to a screen's variant is a hot update, never a reload (the links are read by the server),
    // and its still is taken again.
    await page.run(`window.__mapMark = 1; window.__stillWas = document.querySelector('[data-map-board="screen:mhome"] img[data-map-still]').src`)
    variant('mhome', 'B', `<h1 data-shoot="mhome-live">Home again</h1><Go to="mabout">About</Go>`)
    await slow(page, `document.querySelector('[data-map-board="screen:mhome"] img[data-map-still]')?.src !== window.__stillWas`, 'an edited screen should get a new still')
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
    // A line dragged from home's handle to about asks for a link. (A click on the empty map first lets
    // go of home, selected above, so this click selects it rather than opening it.)
    await page.run(`document.querySelector('[data-map]').click()`)
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
    assert(await page.run(`document.querySelector('[data-island-host]').hasAttribute('data-away')`), 'the island should step aside for Build it (the box grows out of it)')
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

    // The zoom reads as the design's own size and goes past 200%, to 500%.
    for (let i = 0; i < 40; i++) await page.run(`document.querySelector('[data-map-zoom="in"]').click()`)
    await until(page, `Number(document.querySelector('[data-zoom-pct]').textContent.replace('%', '')) === 500`, 'zooming in should go up to 500% of the design')
    await page.run(`document.querySelector('[data-map-fit]').click()`)
    await wait(600)
    // Zoomed in over a screen until it fills the stage, it's the live page (sharp at any zoom), over its
    // full-size still; zoomed out again, it's a still again.
    await page.run(`(() => { const b = document.querySelector('[data-map-board="screen:mhome"]'); for (let i = 0; i < 30; i++) { const r = b.getBoundingClientRect(); b.dispatchEvent(new WheelEvent('wheel', { ctrlKey: true, deltaY: -30, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2, bubbles: true, cancelable: true })) } })()`)
    await until(page, `getComputedStyle(document.querySelector('[data-map-board="screen:mhome"] [data-map-live]') ?? document.createElement('i')).opacity === '1'`, 'the screen filling the stage should go live')
    assert(await page.run(`document.querySelectorAll('[data-map-live]').length === 1 && !!document.querySelector('[data-map-board="screen:mhome"] [data-map-live] > *')`), 'one board, and only one, should be live')
    await until(page, `!!document.querySelector('[data-map-board="screen:mhome"] img[data-map-still="full"]')`, 'a board big on screen should load its full-size still')
    await page.run(`document.querySelector('[data-map-fit]').click()`)
    await until(page, `!document.querySelector('[data-map-live]')`, 'zoomed out, the board should be a still again')
    await wait(600)
    // Focus stays on the map: the screen opens in place on its board (the page's view of it in the
    // board's slot), the overview that was under the map goes at once, and one design mounts.
    await page.run(`document.querySelector('[data-map-board="screen:mhome"]').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`)
    await until(page, `location.pathname === '/mhome/B'`, 'a double click should open the screen')
    await until(page, `!!document.querySelector('[data-map-slot="mhome/B"] [data-shoot="mhome-live"]')`, 'Focus should draw the screen in place on the map')
    assert(await page.run(`!document.querySelector('[data-map-host]').hidden && document.querySelector('[data-layers]').children.length === 0`), 'Focus should keep the map, with the view in the board, not on a stage of its own')
    assert(await page.run(`!document.querySelector('[data-map-board="screen:mhome"] [data-shoot="mhome-live"]')`), 'the board under Focus should not mount the screen a second time')
    // No frame on the screen in Focus: the rest of the map steps back instead.
    await until(page, `getComputedStyle(document.querySelector('[data-map-board="screen:mabout"]')).opacity < 0.5`, 'the rest of the map should step back while a screen is in Focus')
    assert(await page.run(`getComputedStyle(document.querySelector('[data-map-board="screen:mhome"]')).outlineStyle === 'none' && getComputedStyle(document.querySelector('[data-map-board="screen:mhome"]')).opacity === '1'`), 'the screen in Focus should have no outline and stay at full strength')
    // Zoomed out well past it (⌘/Ctrl + wheel over the map), Focus ends where the camera is.
    await page.run(`(() => { const m = document.querySelector('[data-map]'); for (let i = 0; i < 12; i++) m.dispatchEvent(new WheelEvent('wheel', { deltaY: 60, ctrlKey: true, clientX: 300, clientY: 300, bubbles: true, cancelable: true })) })()`)
    await until(page, `location.pathname === '/' && !document.querySelector('[data-map-slot]')`, 'zooming out past the screen should leave Focus for the map')
    // M opens the screen last in Focus, and M again leaves it.
    await page.run(`document.body.focus(); dispatchEvent(new KeyboardEvent('keydown', { key: 'm', bubbles: true }))`)
    await until(page, `location.pathname === '/mhome/B' && !!document.querySelector('[data-map-slot="mhome/B"]')`, 'M should open the screen last in Focus')
    await page.run(`document.body.focus(); dispatchEvent(new KeyboardEvent('keydown', { key: 'm', bubbles: true }))`)
    await until(page, `location.pathname === '/' && !document.querySelector('[data-map-slot]')`, 'M should leave Focus for the map')
    await slow(page, `!!document.querySelector('[data-map-board="screen:mhome"] img[data-map-still]')`, 'back on the map the screen shows its still')
    // Enter on a focused button is the button's, not the map's (a screen is selected on the way back).
    await page.run(`(() => { const b = document.querySelector('[data-map-fit]'); b.focus(); b.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })) })()`)
    await wait(800)
    assert(await page.run(`location.pathname === '/'`), `Enter on a button should not open the selected screen (at ${await page.run('location.pathname')})`)
    // A click on the board already selected opens it, as the double click does.
    await page.run(`document.querySelector('[data-map-board="screen:mabout"]').click()`)
    await wait(300)
    assert(await page.run(`location.pathname === '/'`), 'a first click should only select the board')
    // Its chip (name and Open) sits on the board's top corner, not at the foot of the stage under the comments island.
    assert(await page.run(`(() => { const c = document.querySelector('[data-map-chip]')?.getBoundingClientRect(), b = document.querySelector('[data-map-board="screen:mabout"]').getBoundingClientRect(); return !!c && c.bottom <= b.top + 1 && c.bottom >= b.top - 40 && c.right <= b.right + 1 })()`), 'the selected board\'s chip should sit on its top corner')
    await page.run(`document.querySelector('[data-map-board="screen:mabout"]').click()`)
    await until(page, `location.pathname === '/mabout/A'`, 'a click on the selected board should open it')
    // A picked exploration folds into a stack, one target: a click anywhere on it spreads it out, opening nothing.
    proto(['pick', 'mloose', 'B'])
    await page.run(`document.body.focus(); dispatchEvent(new KeyboardEvent('keydown', { key: 'm', bubbles: true }))`)
    await until(page, `!!document.querySelector('[data-map-board="opt:mloose/A"][data-map-pile]')`, 'a picked exploration should fold into a stack')
    // (Fit: M came back to where the zoom-out that left Focus above went, as far out as the map goes, its labels too small to show.)
    await until(page, `location.pathname === '/'`, 'M should be back on the map')
    await page.run(`document.querySelector('[data-map-fit]').click()`)
    await wait(800)
    await page.run(`document.querySelector('[data-map-board="opt:mloose/A"]').click()`)
    await until(page, `!document.querySelector('[data-map-board^="opt:mloose/"][data-map-pile]')`, 'a click on the stack should spread it')
    await wait(400)
    // (The screen M came back from stays selected; no card of the stack is, which would show its #n in the pill.)
    assert(await page.run(`location.pathname === '/' && !/#\\d/.test(document.querySelector('[data-map-open]')?.parentElement.textContent ?? '')`), 'spreading a stack should neither open nor select a card')
    // Its label says it folds back (an icon that comes in on hover), and folding animates what is in view only.
    assert(await page.run(`document.querySelector('[data-map-round="mloose"] [data-map-round-icon]')?.dataset.mapRoundIcon === 'fold'`), `a spread round with a pick should offer to fold (${await page.run(`JSON.stringify({ label: !!document.querySelector('[data-map-round="mloose"]'), icon: document.querySelector('[data-map-round="mloose"] [data-map-round-icon]')?.dataset.mapRoundIcon ?? null, cards: [...document.querySelectorAll('[data-map-board^="opt:mloose/"]')].map(b => Math.round(b.getBoundingClientRect().width)), path: location.pathname })`)})`)
    await page.run(`document.querySelector('[data-map-round="mloose"]').click()`)
    await until(page, `!!document.querySelector('[data-map-board="opt:mloose/A"][data-map-pile]')`, 'the label should fold the round back into a stack')
    assert(await page.run(`document.querySelector('[data-map-round="mloose"] [data-map-round-icon]')?.dataset.mapRoundIcon === 'spread'`), 'a stack\'s label should offer to spread it')
    await wait(900)
    assert(await page.run(`!document.querySelector('[data-map-ghost]') && !document.getAnimations().some(a => a.effect?.target?.closest?.('[data-map]') && a.effect.getTiming().iterations !== Infinity)`), 'the fold animation should finish and leave nothing behind')
    // An option of a folded stack opened (from the tree): the stack spreads and it opens on its own card.
    const back = await page.run('location.pathname + location.search')
    await page.run(`history.pushState(null, '', '/mloose/B' + location.search); dispatchEvent(new PopStateEvent('popstate'))`)
    await until(page, `!document.querySelector('[data-map-board^="opt:mloose/"][data-map-pile]') && document.querySelector('[data-map-slot]')?.dataset.mapSlot === 'mloose/B'`, 'opening an option of a folded stack should spread it and open on that option\'s card')
    await page.run(`history.pushState(null, '', ${JSON.stringify(back)}); dispatchEvent(new PopStateEvent('popstate'))`)
    await until(page, `!document.querySelector('[data-map-slot]')`, 'back on the map, nothing should be open in place')
    // A round of 26 options: spreading it animates at most the 24 the cap allows, never all of them.
    proto(['add', 'mwide', '--title', 'Map wide', '--variants', Array.from({ length: 26 }, (_, i) => `${String.fromCharCode(65 + i)}:W${i}`).join(',')])
    proto(['done', 'mwide']); proto(['pick', 'mwide', 'A'])
    await until(page, `!!document.querySelector('[data-map-board="opt:mwide/A"][data-map-pile]')`, 'a picked wide round should be a stack')
    await page.run(`(() => { const m = document.querySelector('[data-map]'); for (let i = 0; i < 30; i++) m.dispatchEvent(new WheelEvent('wheel', { deltaY: 60, ctrlKey: true, clientX: 400, clientY: 300, bubbles: true, cancelable: true })) })()`)
    await page.run(`document.querySelector('[data-map-board="opt:mwide/A"]').click()`)
    await until(page, `!!document.querySelector('[data-map-board="opt:mwide/Z"]')`, 'the wide round should spread')
    const moving = await page.run(`document.getAnimations().filter(a => a.effect?.target?.closest?.('[data-map]') && a.effect.getTiming().iterations !== Infinity).length`)
    assert(moving > 0 && moving <= 24, `spreading 26 options should animate some and at most 24 (${moving})`)
    proto(['archive', 'mwide'])
  } finally { page.close() }
  for (const s of ['mhome', 'mabout', 'mloose', 'mother']) proto(['archive', s])
  console.log('OK: the map: designs, screens live, options, loose explorations, link lines, notes on lines and flows, dragged links, Build it, the building mark, the design filter, open and back with M, a second click opens, a stack spreads in one click')
}
