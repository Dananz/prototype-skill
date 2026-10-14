// The middle button (the wheel pressed) drags the device in the view from anywhere, as in FL Studio:
// over the design or beside it, at any zoom (Fit included), 1:1 with the mouse, under an open hand.
// The device stays where it is let go (nothing glides it back, after a drag or a zoom); some of it
// always stays in the area; Fit from the zoom control centres it again. The design never hears that
// button, and its own clicks still work after.
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

export async function middleDragChecks({ proto, app, local, openPage, fail }) {
  const assert = (ok, why) => { if (!ok) fail(`middle-button drag: ${why}`) }
  proto(['add', 'mdrag', '--title', 'Middle drag', '--variants', 'A:Board'])
  writeFileSync(join(app, 'src/protos/mdrag/A.tsx'), `import { useEffect, useState } from 'react'
export default function A() {
  const [n, setN] = useState(0)
  useEffect(() => {
    const w = window as unknown as { __heard: string[] }
    w.__heard = []
    const f = (e: MouseEvent) => { if (e.button === 1) w.__heard.push(e.type) }
    for (const t of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'auxclick', 'click']) document.addEventListener(t, f as EventListener)
    return () => { for (const t of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'auxclick', 'click']) document.removeEventListener(t, f as EventListener) }
  }, [])
  return <main className="grid h-full place-items-center bg-slate-100 p-8">
    <button data-shoot="mdrag-count" onClick={() => setN(n + 1)} className="h-24 w-64 rounded-xl bg-slate-800 text-white">Clicked {n}</button>
  </main>
}
`)
  proto(['done', 'mdrag'])
  const wait = ms => new Promise(r => setTimeout(r, ms))
  const page = await openPage(`${local}?theme=light#/mdrag/A`)
  const geo = `(() => {
    const a = document.querySelector('[data-view-area]')?.getBoundingClientRect(), f = document.querySelector('[data-view] iframe')?.getBoundingClientRect()
    return a && f ? { ax: a.left, ay: a.top, aw: a.width, ah: a.height, fx: f.left, fy: f.top, fw: f.width, fh: f.height } : null
  })()`
  const until = async (expr, why, ms = 15_000) => { for (const end = Date.now() + ms; Date.now() < end; await wait(100)) { const v = await page.run(expr); if (v) return v } fail(`middle-button drag: ${why}`) }
  const ready = `(() => { try { const d = document.querySelector('[data-view] iframe')?.contentDocument; return !!d?.querySelector('[data-shoot=mdrag-count]') } catch { return false } })()`
  const heard = () => page.run(`document.querySelector('[data-view] iframe').contentWindow.__heard.join(' ')`)
  const cursorIn = (x, y) => page.run(`(() => {
    const f = document.querySelector('[data-view] iframe'), r = f.getBoundingClientRect(), s = r.width / f.offsetWidth
    const inside = ${x} >= r.left && ${x} <= r.right && ${y} >= r.top && ${y} <= r.bottom
    const e = inside ? f.contentDocument.elementFromPoint((${x} - r.left) / s, (${y} - r.top) / s) : document.elementFromPoint(${x}, ${y})
    return e ? getComputedStyle(e).cursor : null
  })()`)
  const animating = () => page.run(`document.querySelector('[data-view-area]').getAnimations({ subtree: true }).length`)
  // A real middle-button drag, in steps; the cursor read halfway.
  const middle = async ([x0, y0], [x1, y1], steps = 10) => {
    await page.mouse('mouseMoved', x0, y0, { button: 'none' })
    await page.mouse('mousePressed', x0, y0, { button: 'middle', buttons: 4, clickCount: 1 })
    let mid = null
    for (let i = 1; i <= steps; i++) {
      const x = x0 + (x1 - x0) * i / steps, y = y0 + (y1 - y0) * i / steps
      await page.mouse('mouseMoved', x, y, { button: 'middle', buttons: 4 })
      if (i === steps >> 1) mid = await cursorIn(x, y)
    }
    await page.mouse('mouseReleased', x1, y1, { button: 'middle', buttons: 0, clickCount: 1 })
    return mid
  }
  const near = (a, b, d = 1.5) => Math.abs(a - b) <= d
  try {
    await until(ready, 'the design never showed in the view')
    await wait(400)

    // 1. The stage's own artboard at Fit: there is nothing to scroll, and the device still follows.
    let g0 = await page.run(geo)
    let from = [g0.fx + g0.fw / 2, g0.fy + g0.fh / 2]
    let hand = await middle(from, [from[0] + 120, from[1] + 60])
    let g1 = await page.run(geo)
    assert(near(g1.fx - g0.fx, 120) && near(g1.fy - g0.fy, 60), `over the design at Fit the device moved ${Math.round(g1.fx - g0.fx)}, ${Math.round(g1.fy - g0.fy)} for a 120, 60 drag`)
    assert(hand === 'grab', `the cursor while dragging is ${hand}, not an open hand`)
    assert(await heard() === '', `the design heard the middle button: ${await heard()}`)
    await wait(600)
    const g2 = await page.run(geo)
    assert(g2.fx === g1.fx && g2.fy === g1.fy && !await animating(), 'after letting go the device moved or animated: it should stay where it was left')
    const after = await cursorIn(from[0] + 120, from[1] + 60)
    assert(after !== 'grab', 'the open hand stayed after letting go')

    // 2. The design's own clicks still work (the left button is the design's).
    const btn = await page.run(`(() => { const f = document.querySelector('[data-view] iframe'), r = f.getBoundingClientRect(), s = r.width / f.offsetWidth, b = f.contentDocument.querySelector('[data-shoot=mdrag-count]').getBoundingClientRect(); return [r.left + (b.left + b.width / 2) * s, r.top + (b.top + b.height / 2) * s] })()`)
    await page.press(...btn)
    await until(`document.querySelector('[data-view] iframe').contentDocument.querySelector('[data-shoot=mdrag-count]').textContent === 'Clicked 1'`, 'a left click on the design after a drag did not reach it', 3000)

    // 3. Back the other way, past the area's edge: some of the device always stays in the area.
    g0 = await page.run(geo)
    from = [g0.fx + 40, g0.fy + 40]
    await middle(from, [from[0] - 6000, from[1] - 6000], 6)
    g1 = await page.run(geo)
    assert(g1.fx + g1.fw >= g1.ax + 47 && g1.fy + g1.fh >= g1.ay + 47, `dragged far away the device left the area: its end is at ${Math.round(g1.fx + g1.fw - g1.ax)}, ${Math.round(g1.fy + g1.fh - g1.ay)}`)

    // 4. Fit from the zoom control puts it back in the middle.
    await page.run(`document.querySelector('[data-act="open:scale"]')?.click()`)
    await until(`!!document.querySelector('[data-act="scale:0"]')`, 'the zoom control has no Fit', 3000)
    await page.run(`document.querySelector('[data-act="scale:0"]').click()`)
    await wait(300)
    g1 = await page.run(geo)
    assert(near(g1.fx + g1.fw / 2, g1.ax + g1.aw / 2, 2), `Fit from the zoom control left the device ${Math.round(g1.fx + g1.fw / 2 - g1.ax - g1.aw / 2)} px off the middle`)
    await page.key('Escape')

    // 5. A phone in the view: dragged from beside it, it follows too; a trackpad zoom in and back to
    //    Fit keeps it where it was; nothing glides.
    await page.run(`document.querySelector('[data-size-tabs] [data-act="size:phone"]').click()`)
    await until(`/^390 × 844/.test(document.querySelector('[data-view-line]')?.textContent ?? '')`, 'no phone in the view')
    await until(ready, 'the design never showed on the phone')
    await wait(400)
    g0 = await page.run(geo)
    from = [g0.fx + g0.fw + 60, g0.fy + 40]
    assert(from[0] < g0.ax + g0.aw - 5, 'no room beside the phone to press in')
    await middle(from, [from[0] - 80, from[1] + 40])
    g1 = await page.run(geo)
    assert(near(g1.fx - g0.fx, -80) && near(g1.fy - g0.fy, 40), `beside the phone the drag moved it ${Math.round(g1.fx - g0.fx)}, ${Math.round(g1.fy - g0.fy)} for -80, 40`)
    const c = [g1.fx + g1.fw / 2, g1.fy + g1.fh / 2]
    for (const dy of [-60, -60, 60, 60, 60, 60, 60]) await page.mouse('mouseWheel', c[0], c[1], { button: 'none', deltaX: 0, deltaY: dy, modifiers: 2 })
    await wait(900)
    const g3 = await page.run(geo), g4 = (await wait(400), await page.run(geo))
    assert(g3.fx === g4.fx && g3.fy === g4.fy && !await animating(), 'after a trackpad zoom the phone kept moving: it should stay where the zoom left it')
    assert(!near(g4.fx + g4.fw / 2, g4.ax + g4.aw / 2, 20), 'after a trackpad zoom the phone went back to the middle')
  } finally { page.close() }
}
