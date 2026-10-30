// The comments island keeps its drag with the project tree on: dragged by its edge to the stage's
// end it docks upright there, as with the tree off, and it never sits under the tool strip.
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

export async function islandTreeChecks({ proto, app, local, openPage, fail }) {
  const assert = (ok, why) => { if (!ok) fail(`island (tree): ${why}`) }
  const wait = ms => new Promise(r => setTimeout(r, ms))
  const until = async (page, expression, why) => {
    for (const end = Date.now() + 8000; Date.now() < end; await wait(50)) if (await page.run(expression)) return true
    fail(`island (tree): ${why} (timed out: ${expression})`)
  }
  proto(['add', 'isle', '--title', 'Isle', '--variants', 'A:One'])
  writeFileSync(join(app, 'src', 'protos', 'isle', 'A.tsx'), 'export default function V() { return <main style={{ padding: 32 }}><h1>Isle</h1></main> }\n')
  proto(['done', 'isle'])
  for (const tree of ['0', '1']) {
    const page = await openPage(`${local}isle/A?tree=${tree}`)
    try {
      await until(page, `!!document.querySelector('[data-island]')`, `the island should draw (tree=${tree})`)
      await wait(600)
      const r = JSON.parse(await page.run(`JSON.stringify(document.querySelector('[data-island]').getBoundingClientRect())`))
      const z = JSON.parse(await page.run(`JSON.stringify(document.querySelector('[data-island-host]').getBoundingClientRect())`))
      if (tree === '1') assert(await page.run(`(() => { const s = document.querySelector('[data-strip]').getBoundingClientRect(), i = document.querySelector('[data-island]').getBoundingClientRect(); return s.right <= i.left || s.left >= i.right || s.bottom <= i.top })()`), 'the island should not sit under the strip')
      // Grabbed by its rim (not a button or the field), thrown to the stage's end side.
      await page.drag([r.left + 4, r.top + r.height / 2], [z.right - 6, z.top + z.height / 2], 16)
      await until(page, `document.querySelector('[data-island]').dataset.edgeSide !== 'flat'`, `dragged to the side it should dock upright (tree=${tree})`)
    } finally { page.close() }
  }
  proto(['archive', 'isle'])
  console.log('OK: the comments island drags to the side with the project tree on, as with it off')
}
