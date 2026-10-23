// Parent/back belongs to a visible new comment, never a saved draft's invisible old outline.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export async function commentParentChecks({ proto, app, openPage, fail }) {
  proto(['add', 'parentfx', '--title', 'Comment parents', '--variants', 'A:Nested'])
  writeFileSync(join(app, 'src', 'protos', 'parentfx', 'A.tsx'), `export default function Nested() {
    return <main style={{ padding: 24 }}>
      <section data-shoot="outer" style={{ padding: 32, width: 520, height: 300 }}>
        <div data-shoot="middle" style={{ padding: 24, width: 360, height: 180 }}>
          <div style={{ display: 'inline-block' }}><div style={{ display: 'contents' }}>
            <button data-shoot="leaf" style={{ width: 140, height: 48 }}>Comment target</button>
          </div></div>
        </div>
      </section>
    </main>
  }
`)
  const local = JSON.parse(readFileSync(join(app, 'session.json'), 'utf8')).localUrl
  const page = await openPage(`${local}parentfx/A?theme=light`)
  const helpers = `
    const until = async f => { for (const end = Date.now() + 5000; Date.now() < end; await new Promise(r => setTimeout(r, 50))) if (f()) return true; return false }
    const parent = () => document.querySelector('button[title="Comment on the element around it"]')
    const back = () => document.querySelector('button[aria-label="Back to the element inside"]')
    const editor = () => document.querySelector('[data-composer] [role=textbox]')
    const design = () => document.querySelector('[data-view] iframe')?.contentDocument ?? document
    const leaf = () => design().querySelector('[data-mount] [data-shoot=leaf]')
  `
  const begin = async () => {
    const at = await page.run(`(async () => {
      ${helpers}
      document.querySelector('[data-act="comment:toggle"]').click()
      if (!await until(() => document.querySelector('[data-act="comment:toggle"]').getAttribute('aria-pressed') === 'true' && leaf())) return null
      await new Promise(r => setTimeout(r, 200))
      const r = leaf().getBoundingClientRect(), frame = leaf().ownerDocument.defaultView.frameElement
      const f = frame?.getBoundingClientRect(), scale = frame ? f.width / frame.offsetWidth : 1
      return [(f?.left ?? 0) + (r.left + r.width / 2) * scale, (f?.top ?? 0) + (r.top + r.height / 2) * scale]
    })()`)
    if (!at) fail('comment parents: comment mode or the target never became ready')
    await page.press(...at)
    if (!await page.run(`(async () => { ${helpers}; return await until(() => editor() && parent()) })()`)) fail('comment parents: picking a nested target opened no composer with Parent')
  }
  try {
    await begin()
    const saved = await page.run(`(async () => {
      ${helpers}
      editor().textContent = 'Keep this parent comment'
      editor().dispatchEvent(new Event('input', { bubbles: true }))
      if (!await until(() => !document.querySelector('[data-composer] button[title^="Add,"]').disabled)) return 'Add never became ready'
      parent().click()
      if (!await until(back)) return 'Parent offered no way back'
      back().click()
      if (!await until(() => !back())) return 'Back did not return to the original target'
      if (editor().textContent !== 'Keep this parent comment') return 'Parent/back lost the words'
      document.querySelector('[data-composer] button[title^="Add,"]').click()
      if (!await until(() => !editor() && document.querySelector('button[aria-label="Comment 1"]'))) return 'Add did not save the comment'
      const savedTarget = () => JSON.parse(localStorage.getItem('proto-comments-smoke') || '{}').items?.find(i => i.proto === 'parentfx')?.target
      if (!await until(() => savedTarget()?.shoot === 'leaf')) return 'Parent/back did not save the original target'
      document.querySelector('button[aria-label="Comment 1"]').click()
      if (!await until(editor)) return 'the saved draft did not reopen'
      if (editor().textContent !== 'Keep this parent comment') return 'reopening lost the words'
      if (parent() || back()) return 'reopening a saved draft left invisible Parent/back controls in the DOM'
      ;[...document.querySelectorAll('[data-composer] button')].find(b => b.textContent === 'Cancel').click()
      return 'ok'
    })()`)
    if (saved !== 'ok') fail(`comment parents: ${saved}`)
    await begin()
    const hidden = await page.run(`(async () => {
      ${helpers}
      leaf().style.transform = 'translateY(-2000px)'
      if (!await until(() => !parent() && !back())) return 'a target outside the mount left invisible Parent/back controls'
      leaf().style.transform = ''
      if (!await until(parent)) return 'Parent did not return when the target became visible'
      return 'ok'
    })()`)
    if (hidden !== 'ok') fail(`comment parents: ${hidden}`)
  } finally { page.close() }
  proto(['archive', 'parentfx'])
  console.log('\nOK: Parent/back keeps draft words and disappears for saved or invisible targets')
}
