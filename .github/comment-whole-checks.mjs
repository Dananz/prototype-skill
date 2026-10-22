// A comment on the variant as a whole: ⇧C puts the cursor in the Comments panel's box and outlines
// the variant, a typed line becomes a draft on the variant's root (not on an element), the sidebar
// row's menu comments on another variant, and the inbox says it is on the whole variant.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export async function commentWholeChecks({ proto, app, openPage, fail }) {
  proto(['add', 'wholefx', '--title', 'Whole variant', '--variants', 'A:Plain,B:Other'])
  for (const v of ['A', 'B']) writeFileSync(join(app, 'src', 'protos', 'wholefx', `${v}.tsx`), `export default function Page() {
    return <main style={{ padding: 24 }}><button data-shoot="only" style={{ width: 140, height: 48 }}>Variant ${v}</button></main>
  }
`)
  const local = JSON.parse(readFileSync(join(app, 'session.json'), 'utf8')).localUrl
  const page = await openPage(`${local}?theme=light#/wholefx/A`)
  const helpers = `
    const until = async f => { for (const end = Date.now() + 5000; Date.now() < end; await new Promise(r => setTimeout(r, 50))) if (f()) return true; return false }
    const box = () => document.querySelector('[data-shoot=whole-input]')
    const outline = () => document.querySelector('[data-whole-outline]')
    const saved = () => JSON.parse(localStorage.getItem('proto-comments-smoke') || '{}').items?.filter(i => i.proto === 'wholefx') ?? []
  `
  try {
    const typed = await page.run(`(async () => {
      ${helpers}
      // The outer mount exists before the device frame has loaded its design.
      if (!await until(() => {
        const frame = document.querySelector('[data-view] iframe')
        return (frame ? frame.contentDocument : document)?.querySelector('[data-mount] [data-shoot=only]')
      })) return 'the variant never mounted'
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'C', shiftKey: true, bubbles: true }))
      if (!await until(() => box() && document.activeElement === box())) return '⇧C did not put the cursor in the whole-variant box'
      if (!await until(outline)) return 'the box has the focus but the variant is not outlined'
      if (box().tagName !== 'TEXTAREA') return 'the whole-variant box does not support multiple lines'
      const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
      set.call(box(), 'Give the whole page more air')
      box().dispatchEvent(new Event('input', { bubbles: true }))
      if (!await until(() => document.querySelector('[data-shoot=whole-add]'))) return 'typing in the box offered no way to add it'
      document.querySelector('[data-shoot=whole-add]').click()
      if (!await until(() => saved().length === 1)) return 'adding saved no comment'
      const t = saved()[0].target
      if (t?.whole !== true) return 'the comment is not marked as on the whole variant'
      if (!/^:scope > /.test(t.selector)) return 'the whole-variant comment has no root selector: ' + t.selector
      if (box().value !== '') return 'the box kept its words after adding'
      if (!await until(() => document.querySelector('button[aria-label="Comment 1, on the whole variant"]'))) return 'the whole-variant pin is missing'
      if (!/Whole variant/.test(document.querySelector('[data-shoot=comment-row]')?.textContent ?? '')) return 'the list does not say Whole variant'
      return 'ok'
    })()`)
    if (typed !== 'ok') fail(`comment whole: ${typed}`)

    await page.run(`document.querySelector('[data-shoot=whole-input]').focus()`)
    await page.key('Enter')
    await page.key('Enter', ['Shift'])
    const lines = await page.run(`(async () => {
      ${helpers}
      if (box().value !== '\\n\\n' || saved().length !== 1) return 'Enter or Shift+Enter submitted instead of inserting a newline'
      const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
      set.call(box(), Array.from({ length: 12 }, (_, i) => 'Line ' + i).join('\\n'))
      box().dispatchEvent(new Event('input', { bubbles: true }))
      if (!await until(() => box().scrollHeight > box().clientHeight)) return 'a long comment does not scroll within its capped height'
      if (box().clientHeight > 140) return 'a long comment expanded past its height cap'
      return 'ok'
    })()`)
    if (lines !== 'ok') fail(`comment whole: ${lines}`)
    await page.key('Enter', ['Meta'])
    const added = await page.run(`(async () => { ${helpers}; return await until(() => saved().length === 2 && box().value === '' && saved()[1].body.join('').includes('Line 0\\nLine 1')) })()`)
    if (!added) fail('comment whole: Cmd+Enter did not add the multiline comment intact')

    const row = await page.run(`(async () => {
      ${helpers}
      const b = document.querySelector('[data-mv="wholefx:B"] [data-act="vm:wholefx:B"]')
      if (!b) return 'the sidebar row has no options button'
      b.click()
      const item = await until(() => document.querySelector('[data-shoot=vm-comment]'))
      if (!item) return 'the row menu has no Comment on this'
      const items = [...document.querySelectorAll('[role=menu] [role=menuitem], [role=menu] [role=menuitemradio], [role=menu] [data-send]')].map(i => i.textContent.trim())
      if (!items.some(t => t === 'Pick' || t.startsWith('Picked') || t.startsWith('Pick '))) return 'the row menu has no Pick for its own variant: ' + JSON.stringify(items)
      if (!document.querySelector('[role=menu] textarea[aria-label="Note for Pick 2"]')) return 'the row menu card does not take a pick for B'
      document.querySelector('[data-shoot=vm-comment]').click()
      if (!await until(() => location.hash === '#/wholefx/B')) return 'Comment on this did not go to the variant'
      if (!await until(() => box() && document.activeElement === box())) return 'Comment on this did not put the cursor in the box'
      return 'ok'
    })()`)
    if (row !== 'ok') fail(`comment whole: ${row}`)

    const sent = await page.run(`(async () => {
      ${helpers}
      document.querySelector('[data-shoot=send]').click()
      return await until(() => saved().every(i => i.sent)) ? 'ok' : 'the draft never went'
    })()`)
    if (sent !== 'ok') fail(`comment whole: ${sent}`)
    let heard = ''
    for (let i = 0; i < 40 && !/the whole variant/.test(heard); i++) { heard += proto(['inbox'], { stdout: true }); if (!/the whole variant/.test(heard)) await new Promise(r => setTimeout(r, 250)) }
    if (!/Give the whole page more air/.test(heard) || !/on: the whole variant \(its root </.test(heard)) fail(`comment whole: the inbox did not say it is on the whole variant:\n${heard}`)
  } finally { page.close() }
  proto(['archive', 'wholefx'])
  console.log('\nOK: a comment on the whole variant is saved on its root, listed, sent and read as such')
}
