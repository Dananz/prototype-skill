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
  const design = screens => { mkdirSync(join(app, 'src', 'designs', 'acme'), { recursive: true }); writeFileSync(join(app, 'src', 'designs', 'acme', 'design.ts'), `export default ${JSON.stringify({ title: 'Acme', created: '2026-10-30T10:00:00Z', from: 'home/C', flows: [{ name: 'Main', screens }] })}\n`) }

  proto(['add', 'home', '--title', 'Home', '--variants', 'A:One,B:Two,C:Three'])
  proto(['add', 'about', '--title', 'About', '--variants', 'A:One,B:Two'])
  proto(['add', 'hero-cta', '--title', 'Hero CTA', '--from', 'home/C', '--variants', 'A:One,B:Two'])
  proto(['add', 'cta-copy', '--title', 'CTA copy', '--from', 'hero-cta/B', '--variants', 'A:One,B:Two'])
  proto(['add', 'logo', '--title', 'Logo', '--variants', 'A:One,B:Two'])
  proto(['add', 'pricing', '--title', 'Pricing', '--variants', 'A:One'])
  proto(['done', 'home']); proto(['done', 'about']); proto(['done', 'hero-cta']); proto(['done', 'cta-copy']); proto(['done', 'logo']); proto(['done', 'pricing'])
  proto(['pick', 'home', 'C']); proto(['pick', 'hero-cta', 'A']); proto(['pick', 'logo', 'B']); proto(['pick', 'pricing', 'A'])
  // Made in another conversation: This conversation leaves it out.
  editMeta('logo', m => ({ ...m, session: 'other', owner: 'other' }))
  design(['home', 'about'])

  let page = await openPage(`${local}home/C?tree=0`)
  try {
    await until(page, `!!document.querySelector('[data-side] *')`, 'with ?tree=0 the old sidebar should be drawn')
    assert(await page.run(`document.querySelector('[data-tree-side]').hidden`), 'with ?tree=0 the tree should be hidden')
  } finally { page.close() }

  page = await openPage(`${local}cta-copy/A?tree=1`)
  try {
    await until(page, `!!document.querySelector('[data-tree-row="design:acme"]')`, 'the tree should draw the design')
    assert(await page.run(`!document.querySelector('[data-tree-side]').hidden && !document.querySelector('[data-side] *')`), 'with ?tree=1 the tree replaces the old sidebar')
    assert(await page.run(`localStorage.getItem('proto-tree') === '1'`), '?tree=1 should be kept in this browser')
    assert(await page.run(`!!document.querySelector('[data-tree-row="screen:home"]')`), 'home should be a screen row')
    assert(await page.run(`/not picked/.test(document.querySelector('[data-tree-row="screen:about"]')?.textContent ?? '')`), 'about should say it is not picked')
    await until(page, `!!document.querySelector('[data-tree-row="exp:cta-copy"] [data-mark="stale"]')`, 'the place on screen opens its ancestors, and cta-copy is stale')
    assert(await page.run(`/became Acme/.test(document.querySelector('[data-tree-row="opt:home/C"]')?.textContent ?? '')`), 'home #3 should say it became Acme')
    assert(await page.run(`document.querySelector('[data-tree-filter="open"]').textContent.trim() === 'Open · 2'`), `the Open filter should count 2: ${await page.run(`document.querySelector('[data-tree-filter="open"]').textContent`)}`)

    await page.run(`document.querySelector('[data-tree-row="screen:about"] button:not([aria-expanded])').click()`)
    await until(page, `location.pathname === '/about/A'`, 'a screen row should open its shown variant')
    await page.run(`history.pushState(null, '', '/hero-cta/B'); dispatchEvent(new PopStateEvent('popstate'))`)
    await until(page, `document.querySelector('[data-tree-row="opt:hero-cta/B"]')?.dataset.on === 'true'`, 'arriving at hero-cta/B should light its row')

    await page.run(`document.querySelector('[data-tree-filter="mine"]').click()`)
    await until(page, `!document.querySelector('[data-tree-row="exp:logo"]') && !!document.querySelector('[data-tree-row="screen:home"]')`, 'This conversation should leave out logo')
    await page.run(`document.querySelector('[data-tree-filter="all"]').click()`)

    // A design changed on disk (another conversation's screen) is drawn without a reload.
    await page.run(`window.__treeMark = 1`)
    design(['home', 'about', 'pricing'])
    await until(page, `!!document.querySelector('[data-tree-row="screen:pricing"]')`, 'a screen added to design.ts should appear')
    assert(await page.run(`window.__treeMark === 1`), 'the page reloaded instead of taking the new design')

    // Kept across a load without the parameter, and Settings turns it off.
    await page.run(`location.assign('/home/C')`)
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
  for (const slug of ['home', 'about', 'hero-cta', 'cta-copy', 'logo', 'pricing']) proto(['archive', slug])
  rmSync(join(app, 'src', 'designs'), { recursive: true, force: true })
  console.log('OK: the project tree sidebar: switch, designs, screens, explorations, filters, place and live designs')
}
