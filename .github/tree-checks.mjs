// The project tree sidebar (app/shell/tree/): behind its switch (?tree=1, Settings), designs ›
// flows › screens with their options and the explorations built on them, the filters, the place on
// screen lit, and a design changed on disk drawn without a reload.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export async function treeChecks({ proto, app, local, openPage, fail }) {
  const assert = (ok, why) => { if (!ok) fail(`tree: ${why}`) }
  const wait = ms => new Promise(r => setTimeout(r, ms))
  const until = async (page, expression, why) => {
    for (const end = Date.now() + 6000; Date.now() < end; await wait(50)) if (await page.run(expression)) return
    fail(`tree: ${why} (timed out: ${expression})`)
  }
  const metaFile = slug => join(app, 'src', 'protos', slug, 'meta.ts')
  const editMeta = (slug, fn) => { const text = readFileSync(metaFile(slug), 'utf8'), m = JSON.parse(text.replace(/^[\s\S]*?export default\s*/, '').replace(/;?\s*$/, '')); writeFileSync(metaFile(slug), `export default ${JSON.stringify(fn(m), null, 2)}\n`) }
  const design = screens => { mkdirSync(join(app, 'src', 'designs', 'acme'), { recursive: true }); writeFileSync(join(app, 'src', 'designs', 'acme', 'design.ts'), `export default ${JSON.stringify({ title: 'Acme', created: '2026-10-30T10:00:00Z', from: 'thome/C', flows: [{ name: 'Main', screens }] })}\n`) }

  proto(['add', 'thome', '--title', 'Home', '--variants', 'A:One,B:Two,C:Three'])
  proto(['add', 'tabout', '--title', 'About', '--variants', 'A:One,B:Two'])
  proto(['add', 'thero-cta', '--title', 'Hero CTA', '--from', 'thome/C', '--variants', 'A:One,B:Two'])
  proto(['add', 'tcta-copy', '--title', 'CTA copy', '--from', 'thero-cta/B', '--variants', 'A:One,B:Two'])
  proto(['add', 'tlogo', '--title', 'Logo', '--variants', 'A:One,B:Two'])
  proto(['add', 'tpricing', '--title', 'Pricing', '--variants', 'A:One'])
  proto(['done', 'thome']); proto(['done', 'tabout']); proto(['done', 'thero-cta']); proto(['done', 'tcta-copy']); proto(['done', 'tlogo']); proto(['done', 'tpricing'])
  proto(['pick', 'thome', 'C']); proto(['pick', 'thero-cta', 'A']); proto(['pick', 'tlogo', 'B']); proto(['pick', 'tpricing', 'A'])
  // Made in another conversation: This conversation leaves it out.
  editMeta('tlogo', m => ({ ...m, session: 'other', owner: 'other' }))
  design(['thome', 'tabout'])

  let page = await openPage(`${local}thome/C?tree=0`)
  try {
    await until(page, `!!document.querySelector('[data-side] *')`, 'with ?tree=0 the old sidebar should be drawn')
    assert(await page.run(`document.querySelector('[data-tree-side]').hidden`), 'with ?tree=0 the tree should be hidden')
  } finally { page.close() }

  page = await openPage(`${local}tcta-copy/A?tree=1`)
  try {
    await until(page, `!!document.querySelector('[data-tree-row="design:acme"]')`, 'the tree should draw the design')
    assert(await page.run(`!document.querySelector('[data-tree-side]').hidden && !document.querySelector('[data-side] *')`), 'with ?tree=1 the tree replaces the old sidebar')
    // On the desk it is a card like the old sidebar, not the dotted desk showing through.
    assert(await page.run(`(() => { const s = getComputedStyle(document.querySelector('[data-tree-side]')); return s.backgroundColor !== 'rgba(0, 0, 0, 0)' && s.backgroundImage === 'none' && parseFloat(s.borderTopLeftRadius) > 0 })()`), 'the tree should sit on the desk as a card')
    assert(await page.run(`localStorage.getItem('proto-tree') === '1'`), '?tree=1 should be kept in this browser')
    assert(await page.run(`!!document.querySelector('[data-tree-row="screen:thome"]')`), 'thome should be a screen row')
    assert(await page.run(`/not picked/.test(document.querySelector('[data-tree-row="screen:tabout"]')?.textContent ?? '')`), 'tabout should say it is not picked')
    await until(page, `!!document.querySelector('[data-tree-row="exp:tcta-copy"] [data-mark="stale"]')`, 'the place on screen opens its ancestors, and tcta-copy is stale')
    assert(await page.run(`/became Acme/.test(document.querySelector('[data-tree-row="opt:thome/C"]')?.textContent ?? '')`), 'thome #3 should say it became Acme')
    // The full smoke shares the app with other checks' prototypes, so the count is checked by what Open keeps.
    assert(await page.run(`/^Open · \\d+$/.test(document.querySelector('[data-tree-filter="open"]').textContent.trim())`), 'the Open filter should carry a count')
    await page.run(`document.querySelector('[data-tree-filter="open"]').click()`)
    await until(page, `!!document.querySelector('[data-tree-row="screen:tabout"]') && !!document.querySelector('[data-tree-row="exp:tcta-copy"]') && !document.querySelector('[data-tree-row="exp:tlogo"]')`, 'Open should keep tabout and tcta-copy and leave out the picked tlogo')
    await page.run(`document.querySelector('[data-tree-filter="all"]').click()`)

    await page.run(`document.querySelector('[data-tree-row="screen:tabout"] button:not([aria-expanded])').click()`)
    await until(page, `location.pathname === '/tabout/A'`, 'a screen row should open its shown variant')
    await page.run(`history.pushState(null, '', '/thero-cta/B'); dispatchEvent(new PopStateEvent('popstate'))`)
    await until(page, `document.querySelector('[data-tree-row="opt:thero-cta/B"]')?.dataset.on === 'true'`, 'arriving at thero-cta/B should light its row')

    await page.run(`document.querySelector('[data-tree-filter="mine"]').click()`)
    await until(page, `!document.querySelector('[data-tree-row="exp:tlogo"]') && !!document.querySelector('[data-tree-row="screen:thome"]')`, 'This conversation should leave out tlogo')
    await page.run(`document.querySelector('[data-tree-filter="all"]').click()`)
    // Favorites: the star filter keeps what has a starred option; a star given now redraws the tree.
    await page.run(`document.querySelector('[data-tree-filter="favs"]').click()`)
    await until(page, `!document.querySelector('[data-tree-row="screen:thome"]')`, 'Favorites with no star should leave thome out')
    proto(['fav', 'tlogo/2'])
    await until(page, `!!document.querySelector('[data-tree-row="opt:tlogo/B"]') && !document.querySelector('[data-tree-row="opt:tlogo/A"]')`, 'a star given on disk should bring its option into Favorites, alone')
    await page.run(`document.querySelector('[data-tree-filter="all"]').click()`)
    proto(['fav', 'tlogo/2', '--off'])
    // The project's name opens Settings on Session, its mark carries the live dot.
    assert(await page.run(`document.querySelector('[data-tree-live]')?.dataset.treeLive === 'on'`), 'the mark should carry a live dot')
    await page.run(`document.querySelector('[data-tree-session]').click()`)
    await until(page, `document.querySelector('[data-settings-category=session]')?.getAttribute('aria-current') === 'page'`, 'the project name should open Settings on Session')
    await page.run(`document.querySelector('[data-settings-category=shortcuts]').click()`)
    await until(page, `/Map\\s*M/.test(document.querySelector('[data-settings-dialog]')?.textContent ?? '') && /Jump to a screen/.test(document.querySelector('[data-settings-dialog]').textContent)`, 'Shortcuts should list M and Jump with the tree on')
    await page.run(`document.querySelector('[data-settings-close]').click()`)
    await until(page, `!document.querySelector('[data-settings-dialog]')`, 'Settings should close')

    // A design changed on disk (another conversation's screen) is drawn without a reload.
    await page.run(`window.__treeMark = 1`)
    design(['thome', 'tabout', 'tpricing'])
    await until(page, `!!document.querySelector('[data-tree-row="screen:tpricing"]')`, 'a screen added to design.ts should appear')
    assert(await page.run(`window.__treeMark === 1`), 'the page reloaded instead of taking the new design')

    // Kept across a load without the parameter, and Settings turns it off.
    await page.run(`location.assign('/thome/C')`)
    await wait(500)
    await until(page, `!window.__treeMark && !!document.querySelector('[data-tree-row="design:acme"]')`, 'the switch should survive a load without ?tree')
    await page.run(`document.querySelector('[data-bar] [data-act="open:more"]')?.click()`)
    await until(page, `!!document.querySelector('[data-pop] [data-act=settings]')`, 'the bar menu should offer Settings')
    await page.run(`document.querySelector('[data-pop] [data-act=settings]').click()`)
    await until(page, `!!document.querySelector('[data-settings-category=browsing]')`, 'Settings should open')
    await page.run(`document.querySelector('[data-settings-category=browsing]').click()`)
    await until(page, `!!document.querySelector('[data-setting=tree] input')`, 'Browsing should have the Project tree switch')
    await page.run(`document.querySelector('[data-setting=tree] input').click()`)
    await until(page, `document.querySelector('[data-tree-side]').hidden && localStorage.getItem('proto-tree') === '0'`, 'the Settings switch should turn the tree off')
  } finally { page.close() }
  for (const slug of ['thome', 'tabout', 'thero-cta', 'tcta-copy', 'tlogo', 'tpricing']) proto(['archive', slug])
  rmSync(join(app, 'src', 'designs'), { recursive: true, force: true })
  console.log('OK: the project tree sidebar: switch, designs, screens, explorations, filters, place and live designs')
}
