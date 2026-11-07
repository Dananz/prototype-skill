// The agent's recommendation: `proto recommend` keeps it in meta.ts, the tree marks it with a sparkle,
// the open card in the gallery puts it first with its reason, every variant's take and a Pick button,
// and that button picks it as Decide does. A pick of another variant leaves a faint mark of it.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export async function recommendChecks({ proto, app, local, openPage, fail }) {
  const assert = (ok, why) => { if (!ok) fail(`recommend: ${why}`) }
  const wait = ms => new Promise(r => setTimeout(r, ms))
  const meta = () => { try { return JSON.parse(readFileSync(join(app, 'src/protos/recfx/meta.ts'), 'utf8').replace(/^[\s\S]*?export default\s*/, '').replace(/;?\s*$/, '')) } catch { return null } }
  const until = async (page, expression, why) => {
    for (const end = Date.now() + 6000; Date.now() < end; await wait(50)) if (await page.run(expression)) return
    fail(`recommend: ${why} (timed out: ${expression})`)
  }
  const ids = ['A', 'B', 'C', 'D']
  proto(['add', 'recfx', '--title', 'Recommended', '--variants', ids.map((id, i) => `${id}:Option ${i + 1}`).join(',')])
  for (const id of ids) writeFileSync(join(app, `src/protos/recfx/${id}.tsx`), `export default function Variant() { return <main className="p-8"><h1>Option ${id}</h1></main> }`)
  proto(['done', 'recfx'])

  // By the number the page shows, with a take per variant; a number that isn't one stops.
  proto(['recommend', 'recfx', '9', '--why', 'x'], { ok: false })
  proto(['recommend', 'recfx', '3', '--why'], { ok: false })
  const said = proto(['recommend', 'recfx', '3', '--why', 'It answers the question first.', '--borrow', 'Take the photo from #2.', '1', 'The baseline.', '3', 'Clearest.'], { stdout: true })
  const r = meta()?.recommend
  assert(r?.pick === 'C' && r.why === 'It answers the question first.' && r.borrow === 'Take the photo from #2.' && r.takes?.A === 'The baseline.' && r.takes?.C === 'Clearest.', `meta.ts recommend: ${JSON.stringify(r)}`)
  assert(/recommends #3 \(C\)/.test(said), `proto recommend should say #3: ${said}`)
  assert(!meta()?.picked, 'a recommendation must not pick')

  // The classic overview (the project tree off): the card first, in its panel, with the reason and the takes.
  const classic = await openPage(`${local}recfx?theme=dark`)
  try {
    await until(classic, `!!document.querySelector('[data-layers] [data-rec-card] [data-act="pv:recfx:C"]')`, 'the classic overview should hold #3 as the recommended card')
    assert(await classic.run(`document.querySelector('[data-layers] [data-act^="pv:recfx:"]').dataset.act === 'pv:recfx:C'`), 'the recommended card should come first in the classic overview')
    assert(await classic.run(`document.querySelectorAll('[data-layers] [data-rec-take]').length === 2 && !!document.querySelector('[data-layers] [data-rec-why]') && !!document.querySelector('[data-layers] [data-rec-pill]') && !!document.querySelector('[data-layers] [data-rec-pick]')`), 'the classic overview should have the takes, the reason, the pill and Pick')
  } finally { classic.close() }

  const page = await openPage(`${local}recfx?tree=1&conv=0&theme=dark`, { classic: false })
  try {
    await until(page, `!!document.querySelector('[data-rec-card] [data-gallery-option="recfx/C"]')`, 'the open card should hold #3 as the recommended option')
    assert(await page.run(`document.querySelector('[data-gallery-options="recfx"] [data-gallery-option]').dataset.galleryOption === 'recfx/C'`), 'the recommended option should come first')
    assert(await page.run(`document.querySelectorAll('[data-gallery-options="recfx"] [data-rec-take]').length === 2`), 'the two takes should show under their options')
    assert(await page.run(`/It answers the question first\\./.test(document.querySelector('[data-rec-why]')?.textContent ?? '')`), 'the reason should show above the options')
    assert(await page.run(`!!document.querySelector('[data-gallery-options="recfx"] [data-rec-pill]')`), 'the card should say who suggests what')
    await until(page, `document.querySelectorAll('[data-tree-root] [data-tree-rec]').length === 1`, 'the tree should mark the recommended option once')
    // Pick on it picks, as Decide does; the recommendation stays in meta.ts and stops standing out.
    await page.run(`document.querySelector('[data-rec-pick]').click()`)
    for (const end = Date.now() + 6000; Date.now() < end && meta()?.picked !== 'C'; await wait(50));
    assert(meta()?.picked === 'C', `Pick on the recommended option should pick C: ${meta()?.picked}`)
    assert(meta()?.recommend?.pick === 'C', 'a pick keeps the recommendation')
    await until(page, `!document.querySelector('[data-rec-pick]') && !document.querySelector('[data-rec-card]')`, 'once picked, the option should stop standing out')
    assert(await page.run(`document.querySelectorAll('[data-tree-root] [data-tree-rec]').length === 0`), 'the pick agrees: the tree should have no sparkle left')
    // A pick against it: the decided row keeps a faint mark of the suggestion.
    proto(['pick', 'recfx', '2'])
    await until(page, `[...document.querySelectorAll('[data-tree-root] [data-tree-rec]')].some(e => e.textContent.trim() === '3')`, 'a pick of #2 should leave a faint ✦3 on the decided row')
    proto(['recommend', 'recfx', '--off'])
    await until(page, `document.querySelectorAll('[data-tree-root] [data-tree-rec]').length === 0`, 'proto recommend --off should take the mark away')
    assert(!meta()?.recommend, 'proto recommend --off should take it out of meta.ts')
  } finally { page.close() }
  proto(['archive', 'recfx'])
}
