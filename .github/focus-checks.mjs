// A screen in tree mode (Focus): the bar is the crumb (design › flow › ‹ screen n/N ›) with Jump and
// ⋯; the design's tools sit in the strip down the stage's side; ⌘K jumps anywhere; a <Go to> link
// asks first with a chip, and one to a screen not built yet asks the agent to build it.
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export async function focusChecks({ proto, app, local, openPage, fail }) {
  const assert = (ok, why) => { if (!ok) fail(`focus: ${why}`) }
  const wait = ms => new Promise(r => setTimeout(r, ms))
  const until = async (page, expression, why) => {
    for (const end = Date.now() + 8000; Date.now() < end; await wait(50)) if (await page.run(expression)) return
    fail(`focus: ${why} (timed out: ${expression}; at ${await page.run('location.pathname')})`)
  }
  const variant = (slug, letter, body) => writeFileSync(join(app, 'src', 'protos', slug, `${letter}.tsx`), `import { Go } from '../../go'\nexport default function V() { return <main style={{ padding: 32 }}>${body}</main> }\n`)
  const inbox = join(app, '.proto', 'inbox', 'new')
  const batches = () => existsSync(inbox) ? readdirSync(inbox).filter(b => !b.startsWith('.')) : []

  proto(['add', 'fhome', '--title', 'Focus home', '--variants', 'A:One,B:Two'])
  proto(['design', 'fhome/B', '--title', 'Focus Acme', '--id', 'facme'])
  proto(['add', 'fabout', '--title', 'Focus about', '--design', 'facme', '--variants', 'A:One'])
  variant('fhome', 'B', `<h1>Home</h1><Go to="fabout" data-shoot="f-to-about">About</Go> <Go to="fnone" data-shoot="f-to-none">Nowhere</Go>`)
  variant('fhome', 'A', '<h1>Home A</h1><input data-shoot="f-field" />')
  variant('fabout', 'A', '<h1 data-shoot="f-about">About</h1>')
  for (const s of ['fhome', 'fabout']) proto(['done', s])

  const page = await openPage(`${local}fhome/B?tree=1`)
  const click = sel => page.run(`(() => { const doc = document.querySelector('[data-view]:not([hidden]) iframe')?.contentDocument ?? document; const el = doc.querySelector('${sel}'); el?.click(); return !!el })()`)
  const back = async () => { await page.run(`history.pushState(null, '', '/fhome/B'); dispatchEvent(new PopStateEvent('popstate'))`); await until(page, `!!document.querySelector('[data-shoot="f-to-about"]')`, 'back on home') }
  try {
    await until(page, `!!document.querySelector('[data-crumb]')`, 'tree mode should draw the crumb')
    const crumb = await page.run(`document.querySelector('[data-crumb]').textContent.replace(/\\s+/g, ' ')`)
    assert(/Focus Acme/.test(crumb) && /Main/.test(crumb) && /Focus home/.test(crumb) && /1\/2/.test(crumb), `the crumb should say design, flow, screen and 1/2: ${crumb}`)
    assert(await page.run(`!document.querySelector('[data-bar] [data-shoot="switcher"]:not(.hidden)')?.offsetParent`), 'the switcher should give way to the crumb')
    assert(await page.run(`!document.querySelector('[data-strip]').hidden && !!document.querySelector('[data-strip] [data-shoot="strip-comment"]') && !!document.querySelector('[data-strip] [data-shoot="strip-decide"]')`), 'the strip should hold Comment and Decide')
    assert(await page.run(`!!document.querySelector('[data-strip] [data-shoot="strip-tour"]')`), 'a flow of two screens can be walked from the strip')
    await page.run(`document.querySelector('[data-strip] [data-shoot="strip-decide"]').click()`)
    await until(page, `!!document.querySelector('[data-pop][class*="fixed"]')`, 'Decide from the strip should open its menu')
    const beside = await page.run(`(() => { const m = document.querySelector('[data-pop][class*="fixed"]').getBoundingClientRect(), b = document.querySelector('[data-strip]').getBoundingClientRect(); return m.left >= b.right - 1 || m.right <= b.left + 1 })()`)
    assert(beside, 'the menu should open beside the strip, not over it')
    await page.run(`dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)

    // Tour walks the flow: from its first screen, a bar with where you are, next with → (or its button), End.
    await page.run(`history.pushState(null, '', '/fabout/A'); dispatchEvent(new PopStateEvent('popstate'))`)
    await until(page, `!!document.querySelector('[data-strip] [data-shoot="strip-tour"]')`, 'about should have Tour')
    await page.run(`document.querySelector('[data-strip] [data-shoot="strip-tour"]').click()`)
    await until(page, `location.pathname === '/fhome/B' && !document.querySelector('[data-tour]').hidden && document.querySelector('[data-tour]').textContent.includes('1/2')`, 'Tour should start at the flow\'s first screen with its bar')
    await page.run(`document.body.focus(); dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }))`)
    await until(page, `location.pathname === '/fabout/A' && document.querySelector('[data-tour]').textContent.includes('2/2')`, '→ should go to the next screen of the flow, not the next option')
    await page.run(`document.querySelector('[data-tour] [data-act="tour:prev"]').click()`)
    await until(page, `location.pathname === '/fhome/B'`, 'the bar\'s previous should go back a screen')
    await page.run(`document.querySelector('[data-tour] [data-act="tour:end"]').click()`)
    await until(page, `document.querySelector('[data-tour]').hidden`, 'End should close the tour')

    // The crumb's next arrow walks the flow.
    await page.run(`document.querySelector('[data-crumb-step="1"]').click()`)
    await until(page, `location.pathname === '/fabout/A'`, "the crumb's next should open the next screen")
    await page.run(`document.querySelector('[data-crumb-step="-1"]').click()`)
    await until(page, `location.pathname === '/fhome/B'`, "the crumb's previous should go back")

    // ⌘K in a design's own field, which the design takes, is the design's.
    await page.run(`history.pushState(null, '', '/fhome/A'); dispatchEvent(new PopStateEvent('popstate'))`)
    await until(page, `!!document.querySelector('[data-shoot="f-field"]')`, 'home A should draw its field')
    await page.run(`(() => { const f = document.querySelector('[data-shoot="f-field"]'); f.addEventListener('keydown', e => e.preventDefault()); f.focus(); f.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true, cancelable: true })) })()`)
    await wait(400)
    assert(await page.run(`!document.querySelector('[data-jump]')`), '⌘K taken by the design should not open Jump')
    await page.run(`history.pushState(null, '', '/fhome/B'); dispatchEvent(new PopStateEvent('popstate'))`)
    await until(page, `!!document.querySelector('[data-shoot="f-to-about"]')`, 'back on home B')

    // Zooming out of a screen (⌘/Ctrl + wheel, a pinch) goes on out to the map, which flies out from it.
    await page.run(`(() => { const l = document.querySelector('[data-layers]'); for (let i = 0; i < 4; i++) l.dispatchEvent(new WheelEvent('wheel', { deltaY: 120, ctrlKey: true, bubbles: true, cancelable: true, clientX: 600, clientY: 400 })) })()`)
    await until(page, `!document.querySelector('[data-map-host]').hidden && location.pathname !== '/fhome/B'`, 'zooming out of a screen should land on the map')
    await page.run(`history.pushState(null, '', '/fhome/B'); dispatchEvent(new PopStateEvent('popstate'))`)
    await until(page, `!!document.querySelector('[data-shoot="f-to-about"]')`, 'back on home B after the zoom out')

    // ⌘K: Jump.
    await page.run(`document.body.focus(); dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }))`)
    await until(page, `!!document.querySelector('[data-jump-field]')`, '⌘K should open Jump')
    await page.run(`(() => { const f = document.querySelector('[data-jump-field]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(f, 'focus about'); f.dispatchEvent(new Event('input', { bubbles: true })) })()`)
    await until(page, `document.querySelector('[data-jump-at="0"]')?.dataset.jumpItem === 'screen:fabout'`, 'Jump should find the about screen first')
    await page.run(`document.querySelector('[data-jump-field]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`)
    await until(page, `location.pathname === '/fabout/A' && !document.querySelector('[data-jump]')`, 'Enter in Jump should open it and close Jump')

    // A link asks first.
    await back()
    await wait(400)
    await click('[data-shoot="f-to-about"]')
    await until(page, `!!document.querySelector('[data-go-chip] [data-shoot="go-chip-go"]')`, 'a link should ask first with a chip')
    assert(await page.run(`location.pathname === '/fhome/B'`), 'the chip should not move yet')
    assert(await page.run(`/Focus about/.test(document.querySelector('[data-go-chip]').textContent)`), 'the chip should name the screen')
    await page.run(`document.querySelector('[data-shoot="go-chip-go"]').click()`)
    await until(page, `location.pathname === '/fabout/A' && document.querySelector('[data-go-chip]').hidden`, 'Go to should walk the link')

    // A link to a screen not built yet asks the agent.
    await back()
    await wait(400)
    const had = new Set(batches())
    await click('[data-shoot="f-to-none"]')
    await until(page, `!!document.querySelector('[data-go-chip] [data-shoot="go-chip-build"]')`, 'a link to a missing screen should offer to ask for it')
    await page.run(`document.querySelector('[data-shoot="go-chip-build"]').click()`)
    let sent = ''
    for (const end = Date.now() + 8000; !sent && Date.now() < end; await wait(100)) sent = batches().find(b => !had.has(b)) ?? ''
    assert(sent, 'Ask to build it should reach the inbox')
    if (sent) {
      const c = JSON.parse(readFileSync(join(inbox, sent, 'batch.json'), 'utf8')).comments[0]
      assert(c.action === 'build-screen' && c.route === 'fhome/B' && c.text.includes('fnone'), `the request should be a build-screen on fhome/B naming fnone: ${JSON.stringify(c).slice(0, 200)}`)
      rmSync(join(inbox, sent), { recursive: true, force: true })
    }
  } finally { page.close() }
  for (const s of ['fhome', 'fabout']) proto(['archive', s])
  console.log('OK: Focus in tree mode: the crumb walks the flow, the tool strip, ⌘K Jump, link chips and asking for a missing screen')
}
