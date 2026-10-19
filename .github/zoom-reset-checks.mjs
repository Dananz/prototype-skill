import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

export async function zoomResetChecks({ proto, app, local, openPage, fail, keepShots }) {
  const assert = (ok, why) => { if (!ok) fail(`zoom reset: ${why}`) }
  const wait = ms => new Promise(r => setTimeout(r, ms))
  proto(['add', 'zoom-reset', '--variants', 'A:Board'])
  writeFileSync(join(app, 'src/protos/zoom-reset/A.tsx'), `import { useState } from 'react'
export default function A() {
  const [n, setN] = useState(0)
  return <main className="grid h-full place-content-center gap-4 bg-slate-100 p-8">
    <button data-reset-count onClick={() => setN(n + 1)}>Clicked {n}</button>
    <input data-reset-input placeholder="Keep this draft" />
  </main>
}
`)
  proto(['done', 'zoom-reset'])
  const page = await openPage(`${local}?theme=light#/zoom-reset/A`)
  const doc = `document.querySelector('[data-view] iframe').contentDocument`
  const geo = `(() => {
    const a = document.querySelector('[data-view-area]')?.getBoundingClientRect(), f = document.querySelector('[data-view] iframe')?.getBoundingClientRect()
    return a && f ? [f.left, f.top, f.width, f.height, a.left, a.top, a.width, a.height] : null
  })()`
  const until = async (expr, why) => {
    for (const end = Date.now() + 15000; Date.now() < end; await wait(100)) if (await page.run(expr)) return
    fail(`zoom reset: ${why}`)
  }
  const same = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 2)
  const drag = async () => {
    const [x, y, w, h] = await page.run(geo)
    await page.mouse('mousePressed', x + w / 2, y + h / 2, { button: 'middle', buttons: 4, clickCount: 1 })
    await page.mouse('mouseMoved', x + w / 2 + 70, y + h / 2 + 35, { button: 'middle', buttons: 4 })
    await page.mouse('mouseReleased', x + w / 2 + 70, y + h / 2 + 35, { button: 'middle', buttons: 0, clickCount: 1 })
  }
  const focus = surface => page.run(surface === 'frame' ? `${doc}.querySelector('[data-reset-count]').focus()` : `document.querySelector('[data-act="open:device"]').focus()`)
  const zoom = async () => {
    await page.run(`document.querySelector('[data-act="open:device"][aria-expanded="false"]')?.click(); const r = document.querySelector('[data-scale-range]'); r.value = '200'; r.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('[data-act="open:device"][aria-expanded="true"]')?.click()`)
    await wait(150)
  }
  try {
    await until(`!!document.querySelector('[data-view] iframe')?.contentDocument?.querySelector('[data-reset-input]')`, 'the live design never mounted')
    await wait(300)
    await page.run(`${doc}.querySelector('[data-reset-input]').value = 'Draft survives'; ${doc}.querySelector('[data-reset-count]').click()`)
    const home = await page.run(geo)
    for (const surface of ['shell', 'frame']) {
      for (const mod of ['Meta', 'Control']) {
        for (const zoomed of [false, true]) {
          if (zoomed) await zoom()
          await drag()
          const moved = await page.run(geo)
          assert(!same(home, moved), 'the test did not move the canvas')
          await focus(surface)
          if (keepShots) await page.screenshot(join(keepShots, `zoom-reset-${surface}-${mod}-${zoomed}-before.png`))
          await page.key('0', [mod])
          await wait(200)
          const reset = await page.run(geo)
          if (keepShots) await page.screenshot(join(keepShots, `zoom-reset-${surface}-${mod}-${zoomed}-after.png`))
          assert(same(home, reset), `${mod}+0 in ${surface} at ${zoomed ? '200%' : 'Fit'} did not restore the fitted, centered canvas: ${JSON.stringify({ home, reset })}`)
          assert(await page.run(`${doc}.querySelector('[data-reset-input]').value === 'Draft survives' && ${doc}.querySelector('[data-reset-count]').textContent === 'Clicked 1'`), 'reset remounted the design or lost its state')
        }
      }
    }
    // Modified keys and typing must not unexpectedly move the canvas.
    await zoom()
    await drag()
    const moved = await page.run(geo)
    for (const surface of ['shell', 'frame']) {
      await focus(surface)
      for (const mods of [[], ['Alt'], ['Meta', 'Shift'], ['Control', 'Alt']]) {
        await page.key('0', mods)
        assert(same(moved, await page.run(geo)), `0 with ${mods} reset the canvas in ${surface}`)
      }
    }
    await page.run(`${doc}.querySelector('[data-reset-input]').focus()`)
    for (const mod of ['Meta', 'Control']) {
      await page.key('0', [mod])
      assert(same(moved, await page.run(geo)), `${mod}+0 inside a text field reset the canvas`)
    }
    await focus('frame')
    await page.run(`${doc}.querySelector('[data-reset-count]').addEventListener('keydown', e => e.preventDefault(), { once: true })`)
    await page.key('0', ['Meta'])
    assert(same(moved, await page.run(geo)), 'reset ignored a shortcut already handled by the design')

    // A selected device layout stays selected while its view returns to Fit.
    await page.run(`document.querySelector('[data-act="open:device"]').click(); document.querySelector('[data-size-tabs] [data-act="size:phone"]').click()`)
    await until(`/^390 × 844/.test(document.querySelector('[data-view-line]')?.textContent ?? '')`, 'phone layout did not appear')
    await until(`!!document.querySelector('[data-view] iframe')?.contentDocument?.querySelector('[data-reset-input]')`, 'the design never mounted in the phone layout')
    await wait(300)
    const phoneHome = await page.run(geo)
    for (const surface of ['shell', 'frame']) {
      await zoom()
      await drag()
      await focus(surface)
      await page.key('0', ['Control'])
      await wait(200)
      assert(same(phoneHome, await page.run(geo)), `reset did not fit and center the selected phone layout from ${surface}`)
      assert(await page.run(`/^390 × 844/.test(document.querySelector('[data-view-line]')?.textContent ?? '')`), 'reset changed the selected layout')
    }
    await page.run(`document.querySelector('[data-bar] [data-act="open:more"]').click(); document.querySelector('[data-pop] [data-act=settings]').click()`)
    await until(`!!document.querySelector('[data-settings-dialog]')`, 'Settings did not open')
    await page.run(`document.querySelector('[data-settings-category=shortcuts]').click()`)
    await until(`document.querySelector('[data-settings-dialog]')?.textContent.includes('Fit and center canvas')`, 'shortcut is missing from Settings')
    if (keepShots) await page.screenshot(join(keepShots, 'zoom-reset-shortcuts-desktop.png'))
    console.log('OK: Mod+0 resets zoom and position from shell and design frame, preserves state, and respects typing and modifiers')
  } finally { page.close() }
}
