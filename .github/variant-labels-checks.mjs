// Variants show as numbers (A is 1, AA 27), fixed by the letter, without changing the IDs used by links and actions.
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

export async function variantLabelsChecks({ proto, app, local, openPage, fail, keepShots = '', before = false }) {
  const assert = (ok, why) => { if (!ok) fail(`variant labels: ${why}`) }
  const wait = ms => new Promise(r => setTimeout(r, ms))
  const until = async (page, expression) => {
    for (const end = Date.now() + 5000; Date.now() < end; await wait(50)) if (await page.run(expression)) return
    fail(`variant labels: timed out: ${expression}`)
  }
  const ids = Array.from({ length: 30 }, (_, i) => i < 26 ? String.fromCharCode(65 + i) : `A${String.fromCharCode(65 + i - 26)}`)
  for (const [slug, list] of [['labels22', ids.slice(0, 22)], ['labels23', ids.slice(0, 23)], ['labels30', ids], ['labels-sparse', ['A', 'AA']]]) {
    proto(['add', slug, '--title', slug, '--variants', list.map((id, i) => `${id}:Option ${i + 1}`).join(',')])
    for (const id of list) writeFileSync(join(app, `src/protos/${slug}/${id}.tsx`), 'export default function Variant() { return <main className="p-8"><h1>Exercise library</h1><p>Compare exercise options.</p></main> }')
  }
  proto(['add', 'labels-child', '--title', 'Built from option 29', '--from', 'labels30/AC', '--variants', 'A:Child'])
  proto(['pick', 'labels30', 'AD'])
  proto(['done', 'labels22', 'labels23', 'labels30', 'labels-sparse', 'labels-child'])
  for (const phone of [false, true]) {
    const page = await openPage(`${local}?theme=dark#/labels30/AD`, phone ? { width: 393, height: 852, phone: true } : {})
    try {
      await until(page, `!!document.querySelector('[data-act="open:switch"], [data-pill-handle]')`)
      if (phone) {
        await page.run(`document.querySelector('[data-pill-handle]').focus()`)
        await page.key('Enter')
        await until(page, `!!document.querySelector('[role="dialog"]')`)
      } else {
        await page.run(`document.querySelector('[data-act="open:switch"]').click()`)
        await until(page, `!!document.querySelector('[data-pop] [data-mcols]')`)
        await page.run(`document.querySelector('[data-pop] [data-act="mv:labels30:AD"]').scrollIntoView({block:'nearest'})`)
      }
      await wait(500)
      if (keepShots) await page.screenshot(join(keepShots, `labels-${before ? 'before' : 'after'}-${phone ? 'phone' : 'desktop'}.png`))
      if (before) continue
      const labels = await page.run(phone
        ? `[...document.querySelectorAll('[role="dialog"] button[aria-current]')].slice(0,30).map(b => b.firstElementChild.textContent)`
        : `[...document.querySelectorAll('[data-pop] [data-k="v:labels30"] [data-act^="mv:"]')].map(b => b.firstElementChild.textContent)`)
      assert(JSON.stringify(labels) === JSON.stringify(ids.map((_, i) => String(i + 1))), `${phone ? 'phone' : 'desktop'} list did not show 1 through 30: ${labels}`)
      assert(await page.run(`document.title.startsWith('#30 ·')`), 'the page title kept the letter ID')
      if (!phone) assert(await page.run(`document.querySelector('[data-pop] [data-fitw] > div:last-child b')?.textContent === '#30'`), 'the switcher detail kept the letter ID')
      if (phone) {
        assert(await page.run(`document.querySelector('[data-pill-id]').textContent === '#30'`), 'the pill kept the letter ID')
        await page.run(`[...document.querySelectorAll('[role="dialog"] button[aria-current]')][26].click()`)
      } else {
        await page.run(`document.querySelector('[data-pop] [data-act="mv:labels30:AA"]').click()`)
      }
      await until(page, `location.hash === '#/labels30/AA'`)
      assert(await page.run(`document.title.startsWith('#27 ·')`), 'numeric selection did not open the original AA route')
    } finally { page.close() }
  }
  if (before) return
  // Short lists are numbered too, and a gap keeps the number the letter has (AA stays 27 with no B … Z).
  for (const [slug, last, expected] of [['labels22', 'V', '22'], ['labels23', 'W', '23'], ['labels-sparse', 'AA', '27'], ['labels-sparse', 'A', '1']]) {
    const page = await openPage(`${local}#/${slug}/${last}`)
    try {
      await until(page, `!!document.querySelector('[data-side] [data-act="mv:${slug}:${last}"]')`)
      assert(await page.run(`document.querySelector('[data-side] [data-act="mv:${slug}:${last}"]').firstElementChild.textContent`) === expected, `${slug} did not show ${expected}`)
    } finally { page.close() }
  }
  const child = await openPage(`${local}#/labels-child`)
  try {
    await until(child, `!!document.querySelector('[data-layers] [data-act="pv:labels30:AC"]')`)
    assert(await child.run(`document.querySelector('[data-layers] [data-act="pv:labels30:AC"]').textContent.includes('29')`), 'the source link kept its letter label')
    await child.run(`document.querySelector('[data-layers] [data-act="pv:labels30:AC"]').click()`)
    await until(child, `location.hash === '#/labels30/AC'`)
  } finally { child.close() }
  proto(['pick', 'labels30', 'AD', '--off'])
  // The CLI takes the number the page shows: labels30/29 is labels30/AC.
  const picked = proto(['pick', 'labels30', '29'])
  assert(/picked #29 \(AC\)/.test(picked), `proto pick labels30 29 should pick AC: ${picked}`)
  proto(['pick', 'labels30', '--off'])
  console.log('variant labels: numbers in short and long lists, past Z, stable over gaps, desktop/phone lists, original routes and numbers in the CLI passed')
}
