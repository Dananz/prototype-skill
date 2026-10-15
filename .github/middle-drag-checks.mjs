// The middle button (the wheel pressed) drags the device in the view from anywhere, as in FL Studio:
// over the design or beside it, at any zoom (Fit included), 1:1 with the mouse, under an open hand.
// The device stays where it is let go (nothing glides it back, after a drag or a zoom); some of it
// always stays in the area; Fit from the zoom control centres it again. The design never hears that
// button, and its own clicks still work after.
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

// The layouts live in the bar's device menu: open it, then choose.
const OPEN_DEV = `document.querySelector('[data-bar] [data-act="open:device"][aria-expanded="false"]')?.click()`

export async function middleDragChecks({ proto, app, local, openPage, fail, keepShots = '', before = false }) {
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
  const ready = `(() => { try { const d = document.querySelector('[data-view] iframe')?.contentDocument; const b = d?.querySelector('[data-shoot=mdrag-count]'); return !!b && !b.closest('[inert]') } catch { return false } })()`
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
    if (keepShots) await page.screenshot(join(keepShots, `desktop-${before ? 'before' : 'after'}-drag.png`))
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
    await page.run(`document.querySelector('[data-act="open:device"]')?.click()`)
    await until(`!!document.querySelector('[data-act="scale:0"]')`, 'the zoom control has no Fit', 3000)
    await page.run(`document.querySelector('[data-act="scale:0"]').click()`)
    await wait(300)
    g1 = await page.run(geo)
    assert(near(g1.fx + g1.fw / 2, g1.ax + g1.aw / 2, 2), `Fit from the zoom control left the device ${Math.round(g1.fx + g1.fw / 2 - g1.ax - g1.aw / 2)} px off the middle`)
    await page.run(`document.querySelector('[data-act="open:device"][aria-expanded="true"]')?.click()`)

    // 5. A phone in the view: dragged from beside it, it follows too; a trackpad zoom in and back to
    //    Fit keeps it where it was; nothing glides.
    await page.run(`${OPEN_DEV}; document.querySelector('[data-size-tabs] [data-act="size:phone"]').click()`)
    await until(`/^390 × 844/.test(document.querySelector('[data-view-line]')?.textContent ?? '')`, 'no phone in the view')
    await until(ready, 'the design never showed on the phone')
    await wait(400)
    g0 = await page.run(geo)
    from = [g0.fx + g0.fw + 60, g0.fy + 40]
    assert(from[0] < g0.ax + g0.aw - 5, 'no room beside the phone to press in')
    await middle(from, [from[0] - 80, from[1] + 40])
    g1 = await page.run(geo)
    assert(near(g1.fx - g0.fx, -80) && near(g1.fy - g0.fy, 40), `beside the phone the drag moved it ${Math.round(g1.fx - g0.fx)}, ${Math.round(g1.fy - g0.fy)} for -80, 40`)
    // A chord emits pointermove when middle is released, then pointerup for left, not middle.
    // Exercise both documents through CDP, including movement while only left remains down.
    const chordFailures = []
    for (const surface of ['iframe', 'stage']) {
      await page.run(`document.querySelector('[data-act="open:device"]').click()`)
      await until(`!!document.querySelector('[data-act="scale:0"]')`, 'no Fit before the chord', 3000)
      await page.run(`document.querySelector('[data-act="scale:0"]').click(); document.querySelector('[data-act="open:device"][aria-expanded="true"]')?.click()`)
      await wait(300)
      const start = await page.run(geo)
      const x = surface === 'iframe' ? start.fx + start.fw / 2 : start.fx + start.fw + 60
      const y = start.fy + 80
      await page.run(`(() => {
        const w = ${surface === 'iframe' ? "document.querySelector('[data-view] iframe').contentWindow" : 'window'}
        w.__chord = []
        const f = e => w.__chord.push([e.type, e.button, e.buttons])
        w.__chordStop = () => { for (const t of ['pointermove', 'pointerup']) w.removeEventListener(t, f, true) }
        for (const t of ['pointermove', 'pointerup']) w.addEventListener(t, f, true)
      })()`)
      await page.mouse('mouseMoved', x, y, { button: 'none', buttons: 0 })
      await page.mouse('mousePressed', x, y, { button: 'middle', buttons: 4, clickCount: 1 })
      await page.mouse('mouseMoved', x + 20, y + 10, { button: 'middle', buttons: 4 })
      await page.mouse('mousePressed', x + 20, y + 10, { button: 'left', buttons: 5, clickCount: 1 })
      await page.mouse('mouseMoved', x + 30, y + 15, { button: 'none', buttons: 5 })
      await page.mouse('mouseReleased', x + 30, y + 15, { button: 'middle', buttons: 1, clickCount: 1 })
      const released = await page.run(geo)
      await page.mouse('mouseMoved', x + 60, y + 30, { button: 'left', buttons: 1 })
      const leftOnly = await page.run(geo)
      await page.mouse('mouseReleased', x + 60, y + 30, { button: 'left', buttons: 0, clickCount: 1 })
      await page.mouse('mouseMoved', x + 100, y + 50, { button: 'none', buttons: 0 })
      const hovered = await page.run(geo)
      const events = await page.run(`(() => { const w = ${surface === 'iframe' ? "document.querySelector('[data-view] iframe').contentWindow" : 'window'}; w.__chordStop(); return w.__chord })()`)
      assert(events.some(([t, b, bs]) => t === 'pointermove' && b === 1 && bs === 1) && events.some(([t, b, bs]) => t === 'pointerup' && b === 0 && bs === 0), `${surface} did not receive the real chord release sequence: ${JSON.stringify(events)}`)
      assert(near(released.fx - start.fx, 30) && near(released.fy - start.fy, 15), `${surface} chord did not drag while middle was held`)
      if (keepShots) await page.screenshot(join(keepShots, `phone-${surface}-${before ? 'before' : 'after'}-chord.png`))
      if (!near(leftOnly.fx, released.fx) || !near(leftOnly.fy, released.fy) || !near(hovered.fx, released.fx) || !near(hovered.fy, released.fy)) chordFailures.push(`${surface} moved after middle release: left-only ${Math.round(leftOnly.fx - released.fx)}, ${Math.round(leftOnly.fy - released.fy)}; hover ${Math.round(hovered.fx - leftOnly.fx)}, ${Math.round(hovered.fy - leftOnly.fy)}`)
      if (await page.run(`!!document.querySelector('style[data-view-hand]') || !!document.querySelector('[data-view] iframe').contentDocument.querySelector('style[data-view-hand]')`)) chordFailures.push(`${surface} kept the grab cursor after chord release`)
      assert(await heard() === '', `the design heard the middle button during the ${surface} chord: ${await heard()}`)
      const target = await page.run(`(() => { const f = document.querySelector('[data-view] iframe'), r = f.getBoundingClientRect(), s = r.width / f.offsetWidth, b = f.contentDocument.querySelector('[data-shoot=mdrag-count]').getBoundingClientRect(); return [r.left + (b.left + b.width / 2) * s, r.top + (b.top + b.height / 2) * s] })()`)
      const count = await page.run(`document.querySelector('[data-view] iframe').contentDocument.querySelector('[data-shoot=mdrag-count]').textContent`)
      await page.hover(...target)
      await wait(100)
      await page.press(...target)
      await wait(100)
      if (await page.run(`document.querySelector('[data-view] iframe').contentDocument.querySelector('[data-shoot=mdrag-count]').textContent`) === count) chordFailures.push(`${surface} suppressed a normal click after the chord`)
      // Clear a broken drag so the other entry point is independently exercised.
      await page.run(`window.dispatchEvent(new Event('blur'))`)
    }
    assert(!chordFailures.length, chordFailures.join('; '))
    g1 = await page.run(geo)
    const c = [g1.fx + g1.fw / 2, g1.fy + 120]
    await page.mouse('mouseWheel', c[0], c[1], { button: 'none', deltaX: 0, deltaY: -60, modifiers: 2 })
    await until(`document.querySelector('[data-view] iframe').getBoundingClientRect().width > ${g1.fw + 20}`, 'the trackpad zoom did not enlarge the phone', 3000)
    await page.mouse('mouseWheel', c[0], c[1], { button: 'none', deltaX: 0, deltaY: 60, modifiers: 2 })
    await until(`Math.abs(document.querySelector('[data-view] iframe').getBoundingClientRect().width - ${g1.fw}) < 1.5 && document.querySelector('[data-act="open:device"]')?.textContent.includes('Fit')`, 'the trackpad zoom did not return to Fit', 3000)
    await wait(900)
    const g3 = await page.run(geo), g4 = (await wait(400), await page.run(geo))
    assert(g3.fx === g4.fx && g3.fy === g4.fy && !await animating(), 'after a trackpad zoom the phone kept moving: it should stay where the zoom left it')
    assert(!near(g4.fx + g4.fw / 2, g4.ax + g4.aw / 2, 20), 'after a trackpad zoom the phone went back to the middle')
  } finally { page.close() }
}
