// <Go to> walks a design's screens in the page: a link lands on the screen's pick (or #1 standing in),
// a link to a screen not built or outside the design says so, and it works from a device frame too.
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

export async function goChecks({ proto, app, local, openPage, fail }) {
  const assert = (ok, why) => { if (!ok) fail(`go: ${why}`) }
  const wait = ms => new Promise(r => setTimeout(r, ms))
  const until = async (page, expression, why) => {
    for (const end = Date.now() + 6000; Date.now() < end; await wait(50)) if (await page.run(expression)) return
    fail(`go: ${why} (timed out: ${expression}; at ${await page.run('location.pathname')})`)
  }
  const variant = (slug, letter, body) => writeFileSync(join(app, 'src', 'protos', slug, `${letter}.tsx`), `import { Go } from '../../go'\nexport default function V() { return <main style={{ padding: 32 }}>${body}</main> }\n`)

  proto(['add', 'gohome', '--title', 'Go home', '--variants', 'A:One,B:Two,C:Three'])
  proto(['design', 'gohome/C', '--title', 'Go Acme', '--id', 'goacme'])
  proto(['add', 'goabout', '--title', 'Go about', '--design', 'goacme', '--variants', 'A:One,B:Two'])
  proto(['add', 'goelse', '--title', 'Elsewhere', '--variants', 'A:One'])
  proto(['design', 'goelse/A', '--title', 'Go other', '--id', 'goother'])
  variant('gohome', 'C', `<h1>Home</h1><Go to="goabout" data-shoot="to-about">About</Go> <Go to="nowhere" data-shoot="to-none">Nowhere</Go> <Go to="goelse" data-shoot="to-other">Else</Go>`)
  for (const l of ['A', 'B']) variant('goabout', l, `<h1>About ${l}</h1>`)
  variant('gohome', 'A', `<h1>Home A</h1><Go to="gopricing" data-shoot="to-pricing">Pricing</Go>`)
  variant('gohome', 'B', `<h1>Home B</h1>`)
  variant('goelse', 'A', '<h1>Else</h1>')
  for (const s of ['gohome', 'goabout', 'goelse']) proto(['done', s])
  // A second design from gohome/A pins it: its links are walked in that design, not the first.
  proto(['design', 'gohome/A', '--title', 'Go Beta', '--id', 'gobeta'])
  proto(['add', 'gopricing', '--title', 'Go pricing', '--design', 'gobeta', '--variants', 'A:One'])
  variant('gopricing', 'A', '<h1>Pricing</h1>')
  proto(['done', 'gopricing'])

  const page = await openPage(`${local}gohome/C`)
  const click = sel => page.run(`(() => { const doc = document.querySelector('[data-view]:not([hidden]) iframe')?.contentDocument ?? document; const el = doc.querySelector('${sel}'); el?.click(); return !!el })()`)
  try {
    await until(page, `!!document.querySelector('[data-shoot="to-about"]')`, 'the screen with links should draw')
    await click('[data-shoot="to-about"]')
    await until(page, `location.pathname === '/goabout/A'`, 'a link to a screen with no pick should land on #1')
    proto(['pick', 'goabout', 'B'])
    await page.run(`history.pushState(null, '', '/gohome/C'); dispatchEvent(new PopStateEvent('popstate'))`)
    await until(page, `!!document.querySelector('[data-shoot="to-about"]')`, 'back on the screen with links')
    await wait(500)
    await click('[data-shoot="to-about"]')
    await until(page, `location.pathname === '/goabout/B'`, 'a link should land on the screen\'s pick')

    await page.run(`history.pushState(null, '', '/gohome/C'); dispatchEvent(new PopStateEvent('popstate'))`)
    await until(page, `!!document.querySelector('[data-shoot="to-none"]')`, 'back again')
    await click('[data-shoot="to-none"]')
    await until(page, `/nowhere is not built yet/.test(document.querySelector('[data-go-note]')?.textContent ?? '') && !document.querySelector('[data-go-note]').hidden`, 'a link to a missing screen should say so')
    assert(await page.run(`location.pathname === '/gohome/C'`), 'a link to a missing screen should stay')
    await click('[data-shoot="to-other"]')
    await until(page, `/goelse is not a screen of this design/.test(document.querySelector('[data-go-note]')?.textContent ?? '')`, 'a link outside the design should say so')
    assert(await page.run(`location.pathname === '/gohome/C'`), 'a link outside the design should stay')

    // gohome/A is the pinned screen of the second design: its link walks that design.
    await page.run(`history.pushState(null, '', '/gohome/A'); dispatchEvent(new PopStateEvent('popstate'))`)
    await until(page, `!!document.querySelector('[data-shoot="to-pricing"]')`, 'the pinned screen should draw')
    await wait(400)
    await click('[data-shoot="to-pricing"]')
    await until(page, `location.pathname === '/gopricing/A'`, 'a link on a pinned screen should walk its own design')
    await page.run(`history.pushState(null, '', '/gohome/C'); dispatchEvent(new PopStateEvent('popstate'))`)
    await until(page, `!!document.querySelector('[data-shoot="to-about"]')`, 'back on gohome/C')
    await wait(400)

    // From the phone frame: the link inside the device view's iframe walks the top page.
    await page.run(`document.querySelector('[data-bar] [data-act="open:device"]')?.click()`)
    await until(page, `!!document.querySelector('[data-act="size:phone"]')`, 'the layout menu should offer the phone')
    await page.run(`document.querySelector('[data-act="size:phone"]').click()`)
    await until(page, `!!document.querySelector('[data-view]:not([hidden]) iframe')?.contentDocument?.querySelector('[data-shoot="to-about"]')`, 'the phone frame should draw the screen')
    await click('[data-shoot="to-about"]')
    await until(page, `location.pathname === '/goabout/B'`, 'a link inside the phone frame should walk the page')
  } finally { page.close() }
  for (const s of ['gohome', 'goabout', 'goelse', 'gopricing']) proto(['archive', s])
  console.log('OK: Go links walk a design: picks, stand-ins, missing and outside screens, inside a device frame')
}
