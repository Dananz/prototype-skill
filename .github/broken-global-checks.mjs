import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

// A design that breaks a window global the shell reads (it overrode innerWidth to size a library to
// its card, then deleted it, which removes it for good) doesn't stop the page: moving on still takes
// the old design off the stage, instead of leaving it stuck behind the next one.
export async function brokenGlobalChecks({ proto, app, local, openPage, fail }) {
  proto(['add', 'brokenglobal', '--title', 'Broken global', '--variants', 'A:Deletes innerWidth,B:Plain'])
  writeFileSync(join(app, 'src/protos/brokenglobal/A.tsx'), `import { useEffect } from 'react'
export default function A() {
  useEffect(() => {
    for (const k of ['innerWidth', 'innerHeight']) Object.defineProperty(window, k, { value: 300, configurable: true })
    delete (window as any).innerWidth; delete (window as any).innerHeight
  }, [])
  return <main data-shoot="global-A" className="h-full bg-slate-100 p-6">Variant A</main>
}`)
  writeFileSync(join(app, 'src/protos/brokenglobal/B.tsx'), `export default function B() {
  return <main data-shoot="global-B" className="h-full bg-slate-100 p-6">Variant B</main>
}`)
  proto(['done', 'brokenglobal'])
  const wait = ms => new Promise(r => setTimeout(r, ms))
  const page = await openPage(`${local}brokenglobal/A?theme=light`)
  const until = async (expression, what) => {
    for (const end = Date.now() + 5000; Date.now() < end; await wait(50)) if (await page.run(expression)) return true
    fail(`broken global: timed out waiting for ${what}`)
  }
  try {
    await until(`!!document.querySelector('[data-layers] [data-shoot="global-A"]')`, 'A to mount')
    await wait(300)
    await page.key('ArrowRight')
    await until(`location.pathname.endsWith('/brokenglobal/B') && !!document.querySelector('[data-layers] [data-shoot="global-B"]')`, 'B to mount')
    await wait(2200)
    if (!await page.run(`!document.querySelector('[data-layers] [data-shoot="global-A"]')`)) fail('broken global: A is still on the stage behind B after its design deleted window.innerWidth')
    if (await page.run(`typeof window.innerWidth`) !== 'number') fail('broken global: window.innerWidth is still missing after moving on')
  } finally { page.close() }
  proto(['archive', 'brokenglobal'])
  console.log('OK: a design that deletes window.innerWidth no longer leaves itself stuck on the stage')
}
