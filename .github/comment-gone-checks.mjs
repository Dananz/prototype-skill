// A composer stays where it opened when what it is on goes from the page mid-comment (a row that
// re-renders, a menu that closes): it does not drop to the layer's corner. shots: a folder for
// the composer before and after its element goes.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export async function commentGoneChecks({ proto, app, openPage, fail, shots }) {
  proto(['add', 'gonefx', '--title', 'Gone target', '--variants', 'A:Rows'])
  writeFileSync(join(app, 'src/protos/gonefx/A.tsx'), `import { useEffect, useState } from 'react'
export default function Page() {
  const [gone, setGone] = useState(false)
  useEffect(() => { (window as any).__gone = () => setGone(true) }, [])
  return <main style={{ padding: 24, display: 'grid', gap: 8, justifyItems: 'center', paddingTop: 320 }}>
    {['Row one', 'Row two', 'Row three'].map((r, i) => (i === 1 && gone ? null :
      <button key={r} data-shoot={'row-' + i} style={{ width: 260, height: 40 }}>{r}</button>))}
  </main>
}
`)
  const local = JSON.parse(readFileSync(join(app, 'session.json'), 'utf8')).localUrl
  const page = await openPage(`${local}gonefx/A?theme=light`)
  const helpers = `
    const until = async f => { for (const end = Date.now() + 5000; Date.now() < end; await new Promise(r => setTimeout(r, 50))) if (f()) return true; return false }
    const frame = () => document.querySelector('[data-view] iframe')
    const doc = () => frame() ? frame().contentDocument : document
    const target = () => doc()?.querySelector('[data-mount] [data-shoot=row-1]')
    const composer = () => document.querySelector('[data-composer]')
  `
  try {
    const at = await page.run(`(async () => {
      ${helpers}
      if (!await until(target)) return null
      document.querySelector('[data-act="comment:toggle"]').click()
      await new Promise(r => setTimeout(r, 150))
      const r = target().getBoundingClientRect(), f = frame()?.getBoundingClientRect() ?? { left: 0, top: 0 }, s = frame() ? f.width / frame().offsetWidth : 1
      return [f.left + (r.left + r.width / 2) * s, f.top + (r.top + r.height / 2) * s]
    })()`)
    if (!at) fail('gone target: the design never mounted')
    await page.hover(...at)
    await page.press(...at)
    const opened = await page.run(`(async () => {
      ${helpers}
      if (!await until(composer)) return null
      await new Promise(r => setTimeout(r, 300))
      const c = composer().getBoundingClientRect()
      return { left: c.left, top: c.top }
    })()`)
    if (!opened) fail('gone target: picking the row opened no composer')
    if (shots) await page.screenshot(join(shots, 'composer-before-target-goes.png'))
    const after = await page.run(`(async () => {
      ${helpers}
      ;(frame() ? frame().contentWindow : window).__gone()
      if (!await until(() => !target())) return null
      await new Promise(r => setTimeout(r, 300))
      const c = composer()?.getBoundingClientRect()
      return c && { left: c.left, top: c.top }
    })()`)
    if (shots) await page.screenshot(join(shots, 'composer-after-target-goes.png'))
    if (!after) fail('gone target: the composer closed when its element went')
    if (Math.abs(after.left - opened.left) > 1 || Math.abs(after.top - opened.top) > 1)
      fail(`gone target: the composer moved from ${opened.left},${opened.top} to ${after.left},${after.top} when its element went`)
  } finally { page.close() }
  proto(['archive', 'gonefx'])
  console.log('\nOK: a composer stays where it opened when its element goes')
}
