import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

export async function phoneFrameChecks({ proto, app, local, openPage, fail }) {
  proto(['add', 'phoneframe', '--title', 'Phone frame', '--kind', 'phone', '--screen', '402x874', '--variants', 'A:Scrollable'])
  writeFileSync(join(app, 'src/protos/phoneframe/A.tsx'), `import { useState } from 'react'
export default function A() {
  const [n, setN] = useState(0)
  return <main className="h-[1800px] bg-slate-100">
    <button data-shoot="phone-fixed" onClick={() => setN(n + 1)} className="fixed bottom-6 left-6 h-10 w-32 bg-slate-900 text-white">Clicked {n}</button>
  </main>
}`)
  proto(['done', 'phoneframe'])
  const page = await openPage(`${local}?theme=light#/phoneframe/A`, { width: 1440, height: 1100 })
  const mount = '[data-layers] > :not([inert]) [data-phone] [data-mount]'
  const wait = ms => new Promise(r => setTimeout(r, ms))
  const until = async expression => {
    for (const end = Date.now() + 5000; Date.now() < end; await wait(50)) if (await page.run(expression)) return
    fail(`phone frame: timed out waiting for ${expression}`)
  }
  try {
    for (const stack of [false, true]) {
      if (stack) {
        await page.run(`location.hash = '#/phoneframe'`)
        await until(`!!document.querySelector('[data-act="stack:1"]')`)
        await page.run(`document.querySelector('[data-act="stack:1"]').click()`)
      }
      await until(`!!document.querySelector('${mount} [data-shoot="phone-fixed"]')`)
      if (stack) await until(`!!document.querySelector('${mount}')?.closest('[data-stack-item]')`)
      const result = await page.run(`(() => {
        const m = document.querySelector('${mount}'), b = m.querySelector('[data-shoot="phone-fixed"]')
        m.scrollTop = 0
        const before = b.getBoundingClientRect().top, style = getComputedStyle(m)
        m.scrollTop = 100
        const r = b.getBoundingClientRect()
        return { delta: r.top - before, scroll: m.scrollTop, width: style.width, height: style.height, point: [r.left + r.width / 2, r.top + r.height / 2] }
      })()`)
      if (result.scroll !== 100 || Math.abs(result.delta) > 1) fail(`phone frame: fixed control moved ${result.delta}px after scrolling ${result.scroll}px (${stack ? 'stack' : 'variant'})`)
      if (result.width !== '402px' || result.height !== '874px') fail(`phone frame: screen dimensions changed to ${result.width} × ${result.height}`)
      await page.press(...result.point)
      await until(`document.querySelector('${mount} [data-shoot="phone-fixed"]').textContent === 'Clicked 1'`)
    }
  } finally { page.close() }
  proto(['archive', 'phoneframe'])
  console.log('OK: phone fixed controls remain pinned and clickable while variant and stacked screens scroll')
}
