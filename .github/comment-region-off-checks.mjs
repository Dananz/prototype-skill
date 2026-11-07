// A region can be dragged from off the design while commenting: from the space beside a phone,
// over part of it. The box is cut to what shows of the design and the comment is on that. A drag
// that covers none of the design does nothing at all, and moves nothing.
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

const OPEN_DEV = `document.querySelector('[data-bar] [data-act="open:device"][aria-expanded="false"]')?.click()`

export async function commentRegionOffChecks({ proto, app, local, openPage, fail, keepShots = '', before = false }) {
  const assert = (ok, why) => { if (!ok) fail(`off-design region: ${why}`) }
  proto(['add', 'roff', '--title', 'Region off', '--variants', 'A:Board'])
  writeFileSync(join(app, 'src/protos/roff/A.tsx'), `export default function A() {
  return <main className="grid h-full place-items-center bg-slate-100 p-8">
    <div data-shoot="roff-card" className="h-40 w-64 rounded-xl bg-slate-800 text-white">Card</div>
  </main>
}
`)
  proto(['done', 'roff'])
  const wait = ms => new Promise(r => setTimeout(r, ms))
  const page = await openPage(`${local}roff/A?theme=light`)
  const until = async (expr, why, ms = 15_000) => { for (const end = Date.now() + ms; Date.now() < end; await wait(100)) { const v = await page.run(expr); if (v) return v } fail(`off-design region: ${why}`) }
  const geo = `(() => {
    const a = document.querySelector('[data-view-area]')?.getBoundingClientRect(), f = document.querySelector('[data-view] iframe')?.getBoundingClientRect()
    return a && f ? { ax: a.left, ay: a.top, aw: a.width, ah: a.height, fx: f.left, fy: f.top, fw: f.width, fh: f.height } : null
  })()`
  const ready = `(() => { try { return !!document.querySelector('[data-view] iframe')?.contentDocument?.querySelector('[data-shoot=roff-card]') } catch { return false } })()`
  try {
    await until(ready, 'the design never showed in the view')
    await page.run(`${OPEN_DEV}; document.querySelector('[data-size-tabs] [data-act="size:phone"]').click()`)
    await until(`/402 × 874/.test(document.querySelector('[data-view-line]')?.textContent ?? '')`, 'no phone in the view')
    await until(ready, 'the design never showed on the phone')
    await wait(400)
    await page.run(`document.querySelector('[data-act="comment:toggle"]').click()`)
    await until(`!!document.querySelector('[data-picking]')`, 'comment mode never started')
    const g = await page.run(geo)
    assert(g.fx - g.ax > 120, 'no room beside the phone to start a drag')

    // 1. Wholly off the phone: nothing is picked, and the phone does not move.
    await page.drag([g.fx - 100, g.fy + 40], [g.fx - 20, g.fy + 160])
    await wait(300)
    if (keepShots) await page.screenshot(join(keepShots, `region-off-beside-${before ? 'before' : 'after'}.png`))
    const g1 = await page.run(geo)
    assert(!await page.run(`!!document.querySelector('[data-composer]')`), 'a drag beside the phone that covers none of it opened a comment')
    assert(g1.fx === g.fx && g1.fy === g.fy, 'a drag beside the phone in comment mode moved the phone')
    assert(await page.run(`!!document.querySelector('[data-picking]')`), 'a drag that covered nothing ended comment mode')

    // 2. From beside the phone over its top part: a comment on a region cut to the phone's edge.
    const x0 = g.fx - 60, y0 = g.fy + 30, x1 = g.fx + g.fw * 0.6, y1 = g.fy + 150
    await page.drag([x0, y0], [x1, y1])
    await until(`!!document.querySelector('[data-composer]')`, 'a drag from beside the phone over part of it opened no comment')
    if (keepShots) await page.screenshot(join(keepShots, 'region-off-after.png'))
    const edit = await page.run(`(() => { const r = document.querySelector('[data-region-edit]')?.getBoundingClientRect(); return r && { l: r.left, t: r.top, r: r.right, b: r.bottom } })()`)
    assert(!!edit, 'the new comment is not on a region')
    if (edit) {
      assert(Math.abs(edit.l - g.fx) < 6, `the region starts at ${Math.round(edit.l)}, not at the phone's edge ${Math.round(g.fx)}`)
      assert(Math.abs(edit.r - x1) < 6 && Math.abs(edit.b - y1) < 6, 'the region does not end where the drag did')
    }
    assert(g1.fx === (await page.run(geo)).fx, 'the drag moved the phone')
  } finally {
    await page.close()
  }
}
