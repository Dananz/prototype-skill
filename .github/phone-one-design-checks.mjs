import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

// Moving to another variant on a phone never holds two designs at once: Safari on a phone kills a
// page with two heavy designs mounted (3D, big photos) and reloads it. On a wide screen the old
// design still fades out over the new one.
export async function phoneOneDesignChecks({ proto, app, local, openPage, fail }) {
  proto(['add', 'onedesign', '--title', 'One design', '--variants', 'A:First,B:Second'])
  for (const v of ['A', 'B']) writeFileSync(join(app, `src/protos/onedesign/${v}.tsx`), `export default function ${v}() {
  return <main data-shoot="one-${v}" className="h-full bg-slate-100 p-6">Variant ${v}</main>
}`)
  proto(['done', 'onedesign'])
  const wait = ms => new Promise(r => setTimeout(r, ms))
  for (const { phone, most } of [{ phone: true, most: 1 }, { phone: false, most: 2 }]) {
    const page = await openPage(`${local}onedesign/A?theme=light`, phone ? { width: 390, height: 844, phone: true } : {})
    const until = async expression => {
      for (const end = Date.now() + 5000; Date.now() < end; await wait(50)) if (await page.run(expression)) return
      fail(`one design (${phone ? 'phone' : 'desktop'}): timed out waiting for ${expression}`)
    }
    try {
      await until(`!!document.querySelector('[data-layers] [data-shoot="one-A"]')`)
      // The most designs the page held at once, counted on every change to the stage's layers.
      await page.run(`(() => {
        const box = document.querySelector('[data-layers]'), count = () => box.querySelectorAll(':scope > * [data-mount]').length
        window.__mostDesigns = count()
        new MutationObserver(() => { window.__mostDesigns = Math.max(window.__mostDesigns, count()) }).observe(box, { childList: true, subtree: true })
      })()`)
      await page.key('ArrowRight')
      await until(`location.pathname.endsWith('/onedesign/B') && !!document.querySelector('[data-layers] [data-shoot="one-B"]')`)
      await wait(600)
      const seen = await page.run('window.__mostDesigns')
      if (phone ? seen !== most : seen < most) fail(`one design: a ${phone ? 'phone' : 'wide screen'} held ${seen} designs at once moving A to B, expected ${phone ? 'exactly 1' : 'the crossfade (2)'}`)
      if (!await page.run(`!document.querySelector('[data-layers] [data-shoot="one-A"]')`)) fail(`one design (${phone ? 'phone' : 'desktop'}): A is still on the page after moving to B`)
    } finally { page.close() }
  }
  proto(['archive', 'onedesign'])
  console.log('OK: a phone holds one design at a time when moving between variants; a wide screen still crossfades')
}
