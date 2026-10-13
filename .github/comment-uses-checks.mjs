// A comment on one use of a shared component says which use: the page saves the chain of places
// the components around the element are used, and `proto inbox` marks the one the comment is on.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export async function commentUsesChecks({ proto, app, openPage, fail }) {
  const local = JSON.parse(readFileSync(join(app, 'session.json'), 'utf8')).localUrl
  for (const nested of [false, true]) {
  const slug = nested ? 'nestedusesfx' : 'usesfx'
  proto(['add', slug, '--title', 'Shared component', '--variants', 'A:Two menus'])
  // Line 6 uses Menu for Phase, line 7 for Size: the comment goes on Size.
  writeFileSync(join(app, 'src', 'protos', slug, 'A.tsx'), `function Menu({ label, shoot }: { label: string; shoot: string }) {
  return <div style={{ padding: 8 }}>${nested ? '<Leaf label={label} shoot={shoot} />' : '<button data-shoot={shoot} style={{ width: 140, height: 40 }}>{label}</button>'}</div>
}
export default function Two() {
  return <main style={{ padding: 24, display: 'flex', gap: 24 }}>
    <Menu label="Phase" shoot="first" />
    <Menu label="Size" shoot="second" />
  </main>
}
${nested ? `function Leaf({ label, shoot }: { label: string; shoot: string }) {
  return <button data-shoot={shoot} style={{ width: 140, height: 40 }}>{label}</button>
}` : ''}
`)
  const page = await openPage(`${local}?theme=light#/${slug}/A`)
  const helpers = `
    const until = async f => { for (const end = Date.now() + 5000; Date.now() < end; await new Promise(r => setTimeout(r, 50))) if (f()) return true; return false }
    const editor = () => document.querySelector('[data-composer] [role=textbox]')
    const design = () => document.querySelector('[data-view] iframe')?.contentDocument ?? document
    const second = () => design().querySelector('[data-mount] [data-shoot=second]')
    const saved = () => JSON.parse(localStorage.getItem('proto-comments-smoke') || '{}').items?.find(i => i.proto === '${slug}')?.target
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
  const use = target.uses?.find(u => u.component === 'Menu')
  if (nested && target.uses?.[0]?.component !== 'Leaf') fail('nested shared component: expected Leaf before Menu in the use chain')
  if (use?.component !== 'Menu' || use?.at !== `${slug}/A.tsx:7`) fail(`shared component: the comment should name the use it is on (Menu at usesfx/A.tsx:7), not ${JSON.stringify(target.uses)}`)

  // The same target through the server and the inbox: the use is kept and marked.
  const r = await fetch(`${local}__proto/comments`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ theme: 'light', viewport: { w: 1440, h: 900, phone: false }, comments: [{ route: `${slug}/A`, text: 'Make only this one wider', target }] }) })
  if (!r.ok) fail(`shared component: the comment was refused: ${r.status}`)
  const heard = proto(['inbox'], { stdout: true })
  if (!heard.includes(`Menu at ${slug}/A.tsx:7`)) fail(`shared component: proto inbox should print where this Menu is used: ${heard}`)
  if (!heard.includes(`shared: Menu is used in 2 places; this comment is on the one at ${slug}/A.tsx:7`)) fail(`shared component: proto inbox should say the comment is on one of two uses: ${heard}`)
  if (nested && !heard.includes(`through: pass this use's variation through Leaf at ${slug}/A.tsx:2`)) fail('nested shared component: inbox should explain how to pass the variation through Leaf')
  if (!/passed label="Size" shoot="second"/.test(heard)) fail(`shared component: proto inbox should name the use by what it passes: ${heard}`)
  if (!/^ {3}> +7\| +<Menu label="Size"/m.test(heard) || /^ {3}> +6\|/m.test(heard)) fail(`shared component: the use's line (7), not the other use's (6), should be marked: ${heard}`)
  proto(['archive', slug])
  }

  // Two menus open at the same place, one at a time: a comment on a word in the first stays there,
  // never on the second (its place is the same; the data-shoot around it is not).
  proto(['add', 'swapfx', '--title', 'Menus in one place', '--variants', 'A:Swap'])
  // The test swaps them with a 'swapfx' event on the design's window: no click, so comment mode stays on.
  writeFileSync(join(app, 'src', 'protos', 'swapfx', 'A.tsx'), `import { useEffect, useState } from 'react'
export default function Swap() {
  const [open, setOpen] = useState('a')
  useEffect(() => { const f = () => setOpen(o => (o === 'a' ? 'b' : 'a')); addEventListener('swapfx', f); return () => removeEventListener('swapfx', f) }, [])
  return <main style={{ padding: 24 }}>
    <div>{open === 'a'
      ? <div data-shoot="menu-a" style={{ width: 220, height: 120, background: '#ddd' }}><span style={{ fontSize: 24 }}>Phase</span></div>
      : <div data-shoot="menu-b" style={{ width: 220, height: 120, background: '#ccc' }}><span style={{ fontSize: 24 }}>Size</span></div>}</div>
  </main>
}
`)
  const swap = await openPage(`${local}?theme=light#/swapfx/A`)
  const h2 = `
    const until = async (f, ms = 5000) => { for (const end = Date.now() + ms; Date.now() < end; await new Promise(r => setTimeout(r, 50))) if (f()) return true; return false }
    const editor = () => document.querySelector('[data-composer] [role=textbox]')
    const design = () => document.querySelector('[data-view] iframe')?.contentDocument ?? document
    const q = s => design().querySelector('[data-mount] ' + s)
    const toggle = () => document.querySelector('[data-act="comment:toggle"]')
    const pin = () => document.querySelector('button[aria-label="Comment 1"]')
  `
  try {
    const at = await swap.run(`(async () => {
      ${h2}
      toggle().click()
      if (!await until(() => toggle().getAttribute('aria-pressed') === 'true' && q('[data-shoot=menu-a] span'))) return null
      await new Promise(r => setTimeout(r, 200))
      const el = q('[data-shoot=menu-a] span'), r = el.getBoundingClientRect(), frame = el.ownerDocument.defaultView.frameElement
      const f = frame?.getBoundingClientRect(), scale = frame ? f.width / frame.offsetWidth : 1
      return [(f?.left ?? 0) + (r.left + r.width / 2) * scale, (f?.top ?? 0) + (r.top + r.height / 2) * scale]
    })()`)
    if (!at) fail('menus in one place: comment mode or the menu never became ready')
    await swap.press(...at)
    const res = await swap.run(`(async () => {
      ${h2}
      if (!await until(editor)) return 'picking the word opened no composer'
      editor().textContent = 'Only this menu'
      editor().dispatchEvent(new Event('input', { bubbles: true }))
      if (!await until(() => !document.querySelector('[data-composer] button[title^="Add,"]').disabled)) return 'Add never became ready'
      document.querySelector('[data-composer] button[title^="Add,"]').click()
      if (!await until(() => !editor() && pin())) return 'the comment has no pin on its menu'
      const flip = () => design().defaultView.dispatchEvent(new Event('swapfx'))
      flip()
      if (!await until(() => q('[data-shoot=menu-b]'))) return 'the second menu never opened'
      await new Promise(r => setTimeout(r, 600))
      if (pin()) return 'the comment on the first menu showed on the second menu, which stands at the same place'
      flip()
      if (!await until(() => q('[data-shoot=menu-a]'))) return 'the first menu never came back'
      if (!await until(pin)) return 'the comment did not come back with its own menu'
      return 'ok'
    })()`)
    if (res !== 'ok') fail(`menus in one place: ${res}`)
  } finally { swap.close() }
  proto(['archive', 'swapfx'])
  console.log('\nOK: a comment on one use of a shared component names that use, and stays on its own element')
}
