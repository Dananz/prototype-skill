// The sidebar's two columns: the separator between them is dragged, double-clicked and moved with
// the arrow keys, keeps its place across a reload, and never takes a column under 6rem.
// With before = true only the shots are taken, so the same drag can be shown on a build without it.
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

export async function splitChecks({ proto, app, local, openPage, fail, keepShots = '', before = false }) {
  const assert = (ok, why) => { if (!ok) fail(`column separator: ${why}`) }
  proto(['add', 'split', '--title', 'FINQKEEPER logo', '--variants', 'A:Stacked lenses,B:Isometric platters,C:Growth tails,D:Tilted coins'])
  for (const v of ['A', 'B', 'C', 'D']) writeFileSync(join(app, `src/protos/split/${v}.tsx`), `export default function ${v}() { return <main className="p-8"><h1>${v}</h1></main> }`)
  const wait = ms => new Promise(r => setTimeout(r, ms))
  const until = async (f, why) => { for (const end = Date.now() + 5000; Date.now() < end; await wait(50)) { const v = await f(); if (v) return v } fail(`column separator: ${typeof why === 'function' ? await why() : why}`) }
  // Open the page with the sidebar's two columns showing, in the sidebar or (host = drawer) the tablet's drawer.
  const open = async (theme, host = 'side', size = {}) => {
    const page = await openPage(`${local}?theme=${theme}#/split/B`, size)
    const lists = `document.querySelectorAll('[data-${host}] [data-vlist]')`
    const widths = async () => JSON.parse(await page.run(`JSON.stringify([...${lists}].map(e => Math.round(e.getBoundingClientRect().width)))`))
    if (host === 'drawer') await page.run(`document.querySelector('[data-act="side:1"]').click()`)
    // What the page showed instead, so a failure says why.
    const showed = async () => `the ${host === 'side' ? 'sidebar' : host} did not show two columns (${JSON.stringify(await page.run(`(() => ({ hash: location.hash, ready: document.documentElement?.dataset.ready, host: !!document.querySelector('[data-${host}]'), lists: [...${lists}].map(e => e.dataset.k), size: [innerWidth, innerHeight] }))()`).catch(e => String(e)))})`
    await until(async () => (await widths()).length === 2, showed)
    // Where the columns meet: the first column's right edge, a little down the list.
    const seam = async () => JSON.parse(await page.run(`(() => { const r = ${lists}[0].getBoundingClientRect(); return JSON.stringify([r.right, r.top + 120]) })()`))
    return { page, widths, seam }
  }
  // The same drag on any build: the pointer settles away so the highlight has faded when the shot is taken.
  const shoot = async ({ page, seam }, name, clip) => {
    await page.hover(700, 800)
    await wait(400)
    await page.screenshot(join(keepShots, `split-${before ? 'before' : 'after'}-${name}.png`), clip)
  }
  const dragLeft = async ({ page, seam }) => { const [x, y] = await seam(); await page.drag([x, y], [x - 40, y]) }

  if (keepShots) {
    for (const theme of ['light', 'dark']) {
      const v = await open(theme)
      try { await dragLeft(v); await shoot(v, `${theme}`, { width: 420, height: 400 }) } finally { v.page.close() }
    }
    const d = await open('light', 'drawer', { width: 820, height: 900 })
    try { await dragLeft(d); await shoot(d, 'drawer', { width: 340, height: 400 }) } finally { d.page.close() }
  }
  if (before) return

  const v = await open('light')
  const { page, widths, seam } = v
  const handle = async () => JSON.parse(await page.run(`(() => { const r = document.querySelector('[data-side] [data-split]')?.getBoundingClientRect(); return JSON.stringify(r ? [r.x + r.width / 2, r.y + r.height / 2] : null) })()`))
  try {
    const rest = await widths()
    const at = await handle()
    assert(at && await page.run(`document.querySelector('[data-side] [data-split]').getAttribute('role') === 'separator'`), 'there is no separator between the columns')
    assert(Math.abs(rest[0] - rest[1]) <= 4, `the columns start unequal: ${rest}`)
    assert(Math.abs(at[0] - (await seam())[0]) <= 3, 'the separator is not where the columns meet')
    if (keepShots) {
      await page.hover(...at)
      await wait(400)
      await page.screenshot(join(keepShots, 'split-after-hover.png'), { width: 420, height: 400 })
    }

    // Dragged left by 40px: the second column takes it from the first, the box stays as wide.
    await page.drag(at, [at[0] - 40, at[1]])
    const wide = await widths()
    assert(Math.abs(rest[0] - wide[0] - 40) <= 3 && Math.abs(rest[0] + rest[1] - wide[0] - wide[1]) <= 2, `a drag of 40px moved the columns from ${rest} to ${wide}`)
    assert(await page.run(`document.documentElement.style.cursor === '' && !document.querySelector('[data-side]').hasAttribute('data-splitting')`), 'the drag left its cursor or mark behind')
    assert(Number(await page.run(`localStorage.getItem('proto-split')`)) < 0.5, 'the split was not remembered')

    // It survives the chrome redrawing (another variant opening) and a reload.
    await page.run(`document.querySelector('[data-side] [data-act="mv:split:C"]').click()`)
    await until(async () => await page.run(`location.hash.endsWith('/C')`), 'another variant did not open')
    assert(Math.abs((await widths())[0] - wide[0]) <= 2, 'a redraw of the sidebar reset the split')
    await page.run(`location.reload()`)
    await until(async () => (await widths()).length === 2 && Math.abs((await widths())[0] - wide[0]) <= 2, 'a reload did not keep the split')

    // Neither column goes under 6rem, however far it is dragged.
    const far = await handle()
    await page.drag(far, [far[0] - 400, far[1]])
    const narrow = await widths()
    assert(narrow[0] >= 95 && narrow[1] >= 95, `a column was dragged under 6rem: ${narrow}`)
    await page.drag(await handle(), [far[0] + 400, far[1]])
    const most = await widths()
    assert(most[0] >= 95 && most[1] >= 95, `a column was dragged under 6rem: ${most}`)

    // Double-click resets it; the arrow keys move it by 4% of the box.
    await page.run(`document.querySelector('[data-side] [data-split]').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`)
    const reset = await widths()
    assert(Math.abs(reset[0] - reset[1]) <= 4, `double-click did not reset the split: ${reset}`)
    const key = k => page.run(`(() => { const h = document.querySelector('[data-side] [data-split]'); h.focus(); h.dispatchEvent(new KeyboardEvent('keydown', { key: '${k}', bubbles: true, cancelable: true })); return h.getAttribute('aria-valuenow') })()`)
    assert(await key('ArrowRight') === '54' && await key('ArrowLeft') === '50', 'the arrow keys did not move the separator by 4%')
  } finally { page.close() }
}
