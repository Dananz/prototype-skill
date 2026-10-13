// A comment on one use of a shared component says which use: the page saves the chain of places
// the components around the element are used, and `proto inbox` marks the one the comment is on.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export async function commentUsesChecks({ proto, app, openPage, fail }) {
  proto(['add', 'usesfx', '--title', 'Shared component', '--variants', 'A:Two menus'])
  // Line 6 uses Menu for Phase, line 7 for Size: the comment goes on Size.
  writeFileSync(join(app, 'src', 'protos', 'usesfx', 'A.tsx'), `function Menu({ label, shoot }: { label: string; shoot: string }) {
  return <div style={{ padding: 8 }}><button data-shoot={shoot} style={{ width: 140, height: 40 }}>{label}</button></div>
}
export default function Two() {
  return <main style={{ padding: 24, display: 'flex', gap: 24 }}>
    <Menu label="Phase" shoot="first" />
    <Menu label="Size" shoot="second" />
  </main>
}
`)
  const local = JSON.parse(readFileSync(join(app, 'session.json'), 'utf8')).localUrl
  const page = await openPage(`${local}?theme=light#/usesfx/A`)
  const helpers = `
    const until = async f => { for (const end = Date.now() + 5000; Date.now() < end; await new Promise(r => setTimeout(r, 50))) if (f()) return true; return false }
    const editor = () => document.querySelector('[data-composer] [role=textbox]')
    const design = () => document.querySelector('[data-view] iframe')?.contentDocument ?? document
    const second = () => design().querySelector('[data-mount] [data-shoot=second]')
    const saved = () => JSON.parse(localStorage.getItem('proto-comments-smoke') || '{}').items?.find(i => i.proto === 'usesfx')?.target
  `
  let target
  try {
    const at = await page.run(`(async () => {
      ${helpers}
      document.querySelector('[data-act="comment:toggle"]').click()
      if (!await until(() => document.querySelector('[data-act="comment:toggle"]').getAttribute('aria-pressed') === 'true' && second())) return null
      await new Promise(r => setTimeout(r, 200))
      const r = second().getBoundingClientRect(), frame = second().ownerDocument.defaultView.frameElement
      const f = frame?.getBoundingClientRect(), scale = frame ? f.width / frame.offsetWidth : 1
      return [(f?.left ?? 0) + (r.left + r.width / 2) * scale, (f?.top ?? 0) + (r.top + r.height / 2) * scale]
    })()`)
    if (!at) fail('shared component: comment mode or the target never became ready')
    await page.press(...at)
    const got = await page.run(`(async () => {
      ${helpers}
      if (!await until(editor)) return 'picking the second menu opened no composer'
      editor().textContent = 'Make only this one wider'
      editor().dispatchEvent(new Event('input', { bubbles: true }))
      if (!await until(() => !document.querySelector('[data-composer] button[title^="Add,"]').disabled)) return 'Add never became ready'
      document.querySelector('[data-composer] button[title^="Add,"]').click()
      if (!await until(() => saved())) return 'Add did not save the comment'
      return JSON.stringify(saved())
    })()`)
    if (!got.startsWith('{')) fail(`shared component: ${got}`)
    target = JSON.parse(got)
  } finally { page.close() }
  const use = target.uses?.[0]
  if (use?.component !== 'Menu' || use?.at !== 'usesfx/A.tsx:7') fail(`shared component: the comment should name the use it is on (Menu at usesfx/A.tsx:7), not ${JSON.stringify(target.uses)}`)

  // The same target through the server and the inbox: the use is kept and marked.
  const r = await fetch(`${local}__proto/comments`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ theme: 'light', viewport: { w: 1440, h: 900, phone: false }, comments: [{ route: 'usesfx/A', text: 'Make only this one wider', target }] }) })
  if (!r.ok) fail(`shared component: the comment was refused: ${r.status}`)
  const heard = proto(['inbox'], { stdout: true })
  if (!/used: Menu at usesfx\/A\.tsx:7/.test(heard)) fail(`shared component: proto inbox should print where this Menu is used: ${heard}`)
  if (!/shared: Menu is used in 2 places; this comment is on the one at usesfx\/A\.tsx:7/.test(heard)) fail(`shared component: proto inbox should say the comment is on one of two uses: ${heard}`)
  if (!/passed label="Size" shoot="second"/.test(heard)) fail(`shared component: proto inbox should name the use by what it passes: ${heard}`)
  if (!/^ {3}> +7\| +<Menu label="Size"/m.test(heard) || /^ {3}> +6\|/m.test(heard)) fail(`shared component: the use's line (7), not the other use's (6), should be marked: ${heard}`)
  proto(['archive', 'usesfx'])
  console.log('\nOK: a comment on one use of a shared component names that use')
}
