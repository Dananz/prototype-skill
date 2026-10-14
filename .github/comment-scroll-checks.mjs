// Outlines and comment pins must survive scrolling past the mount's initial height.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export async function commentScrollChecks({ proto, app, openPage, fail }) {
  proto(['add', 'scrollfx', '--title', 'Scrolling comments', '--variants', 'A:Long'])
  writeFileSync(join(app, 'src/protos/scrollfx/A.tsx'), `export default function Page() {
    return <main style={{ padding: 24 }}>{Array.from({ length: 40 }, (_, i) =>
      <section key={i} style={{ height: 180, padding: 24 }}>
        <button data-shoot={'target-' + i} style={{ width: 140, height: 48 }}>Target {i}</button>
      </section>)}</main>
  }`)
  const local = JSON.parse(readFileSync(join(app, 'session.json'), 'utf8')).localUrl
  const page = await openPage(`${local}?theme=light#/scrollfx/A`)
  const helpers = `
    const until = async f => { for (const end = Date.now() + 5000; Date.now() < end; await new Promise(r => setTimeout(r, 50))) if (f()) return true; return false }
    const frame = () => document.querySelector('[data-view] iframe')
    const mount = () => frame()?.contentDocument.querySelector('[data-mount]')
    const ring = () => document.querySelector('[data-comments] > .border-2')
    const target = () => mount()?.querySelector('[data-shoot=target-12]')
  `
  try {
    const at = await page.run(`(async () => {
      ${helpers}
      if (!await until(target)) return null
      document.querySelector('[data-act="comment:toggle"]').click()
      mount().parentElement.scrollTop = 2100
      await new Promise(r => setTimeout(r, 150))
      const r = target().getBoundingClientRect(), f = frame().getBoundingClientRect(), s = f.width / frame().offsetWidth
      return [f.left + (r.left + r.width / 2) * s, f.top + (r.top + r.height / 2) * s]
    })()`)
    if (!at) fail('scroll comments: the long design never mounted in its artboard')
    await page.hover(...at)
    const outlined = await page.run(`(async () => { ${helpers}; return await until(() => ring()?.style.opacity === '1') })()`)
    if (!outlined) fail('scroll comments: a visible target several screens down has no hover outline')
    const followed = await page.run(`(async () => {
      ${helpers}
      mount().parentElement.scrollTop = 0
      if (!await until(() => ring()?.style.opacity === '0')) return 'the hover outline stayed on screen after its target scrolled away'
      mount().parentElement.scrollTop = 2100
      if (!await until(() => ring()?.style.opacity === '1')) return 'the hover outline did not recover when its target returned'
      return 'ok'
    })()`)
    if (followed !== 'ok') fail(`scroll comments: ${followed}`)
    await page.press(...at)
    const picked = await page.run(`(async () => {
      ${helpers}
      if (!await until(() => document.querySelector('[data-composer]') && document.querySelector('button[title="Comment on the element around it"]'))) return 'the picked target has no anchored composer or Parent button'
      const editor = document.querySelector('[data-composer] [role=textbox]')
      editor.textContent = 'Comment far down the page'
      editor.dispatchEvent(new Event('input', { bubbles: true }))
      if (!await until(() => !document.querySelector('[data-composer] button[title^="Add,"]').disabled)) return 'the comment text never became ready to add'
      document.querySelector('[data-composer] button[title^="Add,"]').click()
      if (!await until(() => document.querySelector('[data-comments] [data-comment]'))) return 'the saved comment has no pin'
      mount().parentElement.scrollTop = 0
      if (!await until(() => !document.querySelector('[data-comments] [data-comment]'))) return 'the offscreen comment still has a pin'
      mount().parentElement.scrollTop = 2100
      if (!await until(() => document.querySelector('[data-comments] [data-comment]'))) return 'scrolling back lost the saved pin'
      return 'ok'
    })()`)
    if (picked !== 'ok') fail(`scroll comments: ${picked}`)
  } finally { page.close() }
  proto(['archive', 'scrollfx'])
  console.log('\nOK: hover outlines, anchored composers and pins survive long-page scrolling')
}
