// The desktop header: one mark and no session popover, a device menu, a ⋯ menu, the comments
// island's textless Select button, the Decision card, and a side panel (Try it) that folds to an
// edge you can peek at.
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

export async function headerChecks({ proto, app, local, openPage, fail, keepShots = '', before = false }) {
  const assert = (ok, why) => { if (!ok) fail(`header: ${why}`) }
  const wait = ms => new Promise(r => setTimeout(r, ms))
  const until = async (page, expression, why) => {
    for (const end = Date.now() + 5000; Date.now() < end; await wait(50)) if (await page.run(expression)) return
    fail(`header: ${why ?? `timed out: ${expression}`}`)
  }
  proto(['add', 'headerfx', '--title', 'Header', '--variants', 'A:One,B:Two'])
  for (const id of ['A', 'B']) writeFileSync(join(app, `src/protos/headerfx/${id}.tsx`), `import { useHints } from '../../hints'
export default function V() { useHints([{ kind: 'try', text: 'Press Go' }]); return <main className="p-8"><h1>Header ${id}</h1><button>Go</button></main> }`)
  proto(['done', 'headerfx'])
  const page = await openPage(`${local}headerfx/A?theme=light`, { width: 1440, height: 900 })
  try {
    await until(page, `!!document.querySelector('[data-bar] [data-decide-btn]')`, 'the bar never drew')
    if (keepShots) await page.screenshot(join(keepShots, `header-${before ? 'before' : 'after'}-bar.png`))
    if (before) return

    // One mark, no session popover: the live dot rides on the sidebar's mark, its name opens Settings.
    assert(await page.run(`!document.querySelector('[data-act="open:session"]')`), 'the bar still has a session popover button')
    assert(await page.run(`!!document.querySelector('[data-act="settings:session"] .animate-ping, [data-act="settings:session"] .bg-emerald-500')`), 'the sidebar mark has no live dot')
    const buttons = await page.run(`[...document.querySelectorAll('[data-bar] button')].filter(b => b.getClientRects().length).length`)
    assert(buttons <= 9, `the bar has ${buttons} buttons on a plain prototype (9 at most)`)

    // The layouts and zoom share one menu.
    await page.run(`document.querySelector('[data-bar] [data-act="open:device"]').click()`)
    await until(page, `document.querySelectorAll('[data-size-tabs] [data-act^="size:"]').length === 3 && !!document.querySelector('[data-scale-range], [data-pop] [data-act^="scale:"], [data-pop] p')`, 'the device menu has no sizes and zoom')
    await page.run(`document.querySelector('[data-size-tabs] [data-act="size:phone"]').click()`)
    await until(page, `!document.querySelector('[data-size-tabs]') && !!document.querySelector('[data-view] iframe')`, 'choosing a layout did not close the menu and open the view')
    await page.key('Escape')
    await wait(200)

    // ⋯ holds Focus, Share, Shortcuts and Settings; Shortcuts opens Settings on its own category.
    await page.run(`document.querySelector('[data-bar] [data-act="open:more"]').click()`)
    await until(page, `['focus', 'share', 'settings:shortcuts', 'settings'].every(a => document.querySelector('[data-pop] [data-act="' + a + '"]'))`, 'the ⋯ menu is missing Focus, Share, Shortcuts or Settings')
    await page.run(`document.querySelector('[data-pop] [data-act="settings:shortcuts"]').click()`)
    await until(page, `document.querySelector('[data-settings-category=shortcuts]')?.getAttribute('aria-current') === 'page'`, 'Shortcuts did not open Settings on Shortcuts')
    await page.key('Escape')
    await until(page, `!document.querySelector('[data-settings-dialog]')`, 'Escape did not close Settings')
    assert(await page.run(`document.activeElement?.dataset.act === 'open:more'`), 'closing Settings did not return the focus to ⋯')

    // The sidebar's session name opens Settings on Session, which carries what the popover did.
    await page.run(`document.querySelector('[data-act="settings:session"]').click()`)
    await until(page, `!!document.querySelector('[data-setting-path]')`, 'Session settings has no folder and start time')
    const facts = await page.run(`({ path: document.querySelector('[data-setting-path]').textContent, keep: document.querySelector('[data-setting=keep]').textContent, server: document.querySelector('[data-setting-server-status]').textContent })`)
    assert(facts.path.includes('started'), `the folder line has no start time: ${facts.path}`)
    assert(/Stops after \d+h idle/.test(facts.keep), `Keep forever does not say when the session stops: ${facts.keep}`)
    assert(facts.server.startsWith('Live'), `the server row is not live: ${facts.server}`)
    await page.run(`document.querySelector('[data-settings-close]').click()`)
    await until(page, `!document.querySelector('[data-settings-dialog]')`)

    // Comment mode is the island's Select filled in, without words, and a frame round the design;
    // the bar has no Comment of its own.
    assert(await page.run(`!document.querySelector('[data-bar] [data-act="comment:toggle"]')`), 'the bar still has a Comment button')
    await page.run(`document.querySelector('[data-island] [data-act="comment:toggle"]').click()`)
    await until(page, `document.querySelector('[data-island] [data-act="comment:toggle"]')?.getAttribute('aria-pressed') === 'true' && document.querySelector('[data-zone]').hasAttribute('data-picking')`, 'commenting did not arm the button and the design')
    assert(await page.run(`document.querySelector('[data-island] [data-act="comment:toggle"]').textContent.trim() === ''`), 'the armed Comment button has words')
    await page.key('Escape')
    await until(page, `!document.querySelector('[data-zone]').hasAttribute('data-picking')`, 'Escape did not stop commenting')

    // The Decision card: a pick is chosen, its note is ready, and the other choices change the note.
    await page.run(`document.querySelector('[data-bar] [data-decide-btn]').click()`)
    await until(page, `document.querySelectorAll('[role=menuitemradio]').length === 3`, 'the card has no three choices')
    assert(await page.run(`document.querySelector('[contenteditable][aria-label^="Note for "]')?.getAttribute('aria-label') === 'Note for Pick #1'`), 'the card does not start on Pick')
    await page.run(`[...document.querySelectorAll('[role=menuitemradio]')].find(b => b.textContent === 'More like this').click()`)
    await until(page, `document.querySelector('[contenteditable][aria-label^="Note for "]')?.getAttribute('aria-label') === 'Note for More like #1'`, 'choosing More like this did not change the note')
    await page.key('Escape')

    // The panel folds to an edge; hovering it peeks the panel over the design without moving it; the pin docks it.
    await page.run(`document.querySelector('[data-hint="close"]')?.click()`)
    await until(page, `!!document.querySelector('[data-hint="peek"]') && getComputedStyle(document.querySelector('[data-zone]')).getPropertyValue('--hw').trim() === '12px'`, 'closing the panel left no edge')
    const w0 = await page.run(`document.querySelector('[data-layers]').getBoundingClientRect().width`)
    await page.run(`document.querySelector('[data-hint="peek"]').dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' }))`)
    await until(page, `!!document.querySelector('[data-hint="pin"]')`, 'hovering the edge did not peek the panel')
    assert(await page.run(`document.querySelector('[data-layers]').getBoundingClientRect().width`) === w0, 'peeking moved the design')
    await page.key('Escape')
    await until(page, `!document.querySelector('[data-hint="pin"]')?.getClientRects().length && !!document.querySelector('[data-hint="peek"]')?.getClientRects().length`, 'Escape did not put the peek away')
    await page.run(`document.querySelector('[data-hint="peek"]').click()`)
    await until(page, `!!document.querySelector('[data-hint="pin"]')?.getClientRects().length`, 'pressing the edge did not peek the panel')
    await page.run(`document.querySelector('[data-hint="pin"]').click()`)
    await until(page, `!!document.querySelector('[data-hint="close"]') && parseFloat(getComputedStyle(document.querySelector('[data-zone]')).getPropertyValue('--hw')) > 100`, 'the pin did not dock the panel')
    if (keepShots) await page.screenshot(join(keepShots, 'header-after-docked.png'))
  } finally { page.close() }
}
