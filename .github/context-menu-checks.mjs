// Right-click menus: a prototype's row (Open, N more variants, Copy link) and More variants itself
// (a count from the prototype's own, a note, one batch for Claude), a comment's row (delete takes it
// back), the artboard's frame (Comment on this element, on the parent), and what must stay the
// browser's: Shift + right-click, a field, selected text.
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

export async function contextMenuChecks({ proto, app, local, openPage, fail }) {
  // Four directions at the start: the menu asks for four more.
  proto(['add', 'ctxfx', '--title', 'Context menus', '--variants', 'A:Plain,B:Other,C:Third,D:Fourth'])
  for (const v of ['A', 'B', 'C', 'D']) writeFileSync(join(app, 'src', 'protos', 'ctxfx', `${v}.tsx`), `export default function Page() {
    return <main style={{ padding: 24 }}><section data-shoot="card"><h1 data-shoot="title">Variant ${v}</h1><input data-shoot="field" defaultValue="typed" /></section></main>
  }
`)
  const page = await openPage(`${local}?theme=light#/ctxfx/A`)
  const helpers = `
    const until = async f => { for (const end = Date.now() + 6000; Date.now() < end; await new Promise(r => setTimeout(r, 50))) if (f()) return true; return false }
    // A right-click as the page hears it; false when something took it (preventDefault).
    const rc = (el, opts = {}) => { const r = el.getBoundingClientRect(); return el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, composed: true, button: 2, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, ...opts })) }
    const menu = () => document.querySelector('[data-context-menu]')
    const labels = () => [...(menu()?.querySelectorAll('[role=menuitem]') ?? [])].map(x => x.textContent.trim())
    const frame = () => document.querySelector('[data-view] iframe')?.contentDocument
    const saved = () => JSON.parse(localStorage.getItem('proto-comments-smoke') || '{}').items ?? []
    const esc = () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  `
  try {
    const row = await page.run(`(async () => {
      ${helpers}
      if (!await until(() => document.querySelector('[data-act="mp:ctxfx"]'))) return 'the prototype row never drew'
      const row = document.querySelector('[data-act="mp:ctxfx"]')
      if (!rc(row, { shiftKey: true })) return 'Shift + right-click on a prototype row was taken'
      if (menu()) return 'Shift + right-click opened our menu'
      if (rc(row)) return 'right-click on a prototype row was left to the browser'
      if (!await until(menu)) return 'right-click on a prototype row opened no menu'
      const got = labels()
      if (!got.includes('Open') || !got.includes('Copy link')) return 'the prototype menu has ' + got.join(', ')
      if (!got.some(l => /^4 more variants/.test(l))) return 'More variants does not offer the 4 it was made with: ' + got.join(', ')
      if (!/Shift \\+ right-click/.test(menu().textContent)) return 'the menu does not say how to reach the browser menu'
      esc()
      if (!await until(() => !menu())) return 'Esc did not close the menu'
      return 'ok'
    })()`)
    if (row !== 'ok') fail(`context menu: ${row}`)

    const more = await page.run(`(async () => {
      ${helpers}
      rc(document.querySelector('[data-act="mp:ctxfx"]'))
      if (!await until(menu)) return 'no menu'
      menu().querySelector('[data-shoot="ctx-more-variants"]').click()
      if (!await until(() => menu()?.querySelector('textarea'))) return 'More variants opened no note'
      const out = () => menu().querySelector('[data-shoot="ctx-count"] output')?.textContent
      if (out() !== '4') return 'the count starts at ' + out() + ', not the prototype\\'s 4'
      menu().querySelector('[aria-label="One more"]').click()
      if (!await until(() => out() === '5')) return 'one more did not make it 5'
      const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
      set.call(menu().querySelector('textarea'), 'Calmer, with more air')
      menu().querySelector('textarea').dispatchEvent(new Event('input', { bubbles: true }))
      menu().querySelector('[data-shoot="ctx-send"]').click()
      if (!await until(() => /5 more variants/.test(menu()?.textContent ?? ''))) return 'sending said nothing: ' + (menu()?.textContent ?? 'menu gone')
      if (!await until(() => saved().some(i => i.action === 'more-variants' && i.count === 5 && i.variant === ''))) return 'no more-variants item was kept'
      return 'ok'
    })()`)
    if (more !== 'ok') fail(`context menu: ${more}`)
    let heard = ''
    for (let i = 0; i < 40 && !/more-variants/.test(heard); i++) { heard += proto(['inbox'], { stdout: true }); if (!/more-variants/.test(heard)) await new Promise(r => setTimeout(r, 250)) }
    if (!/\n\d+\. ctxfx\n/.test(heard) || !/count: 5 new variants/.test(heard) || !/Calmer, with more air/.test(heard)) fail(`context menu: the inbox did not read the request as 5 more variants of ctxfx:\n${heard}`)

    const art = await page.run(`(async () => {
      ${helpers}
      esc()
      if (!await until(() => !menu())) return 'the menu stayed after Esc'
      if (!await until(() => frame()?.querySelector('[data-shoot=title]'))) return 'the design never reached the frame'
      const d = frame()
      const h = d.querySelector('[data-shoot=title]'), f = d.querySelector('[data-shoot=field]')
      // The frame is scaled, so the point is the element's, in the frame's own px.
      const at = el => { const r = el.getBoundingClientRect(); return { clientX: r.left + 4, clientY: r.top + 4 } }
      if (!h.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, shiftKey: true, ...at(h) }))) return 'Shift + right-click in the frame was taken'
      if (menu()) return 'Shift + right-click in the frame opened a menu'
      if (!f.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, ...at(f) }))) return 'right-click in a field was taken'
      if (h.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, ...at(h) }))) return 'right-click on the design was left to the browser'
      if (!await until(menu)) return 'right-click on the design opened no menu'
      const got = labels()
      for (const want of ['Comment on this element', 'Comment on the whole variant']) if (!got.some(l => l.startsWith(want))) return 'the artboard menu has no ' + want + ': ' + got.join(', ')
      if (!got.some(l => /^Pick A/.test(l))) return 'the artboard menu has no Pick for the variant: ' + got.join(', ')
      menu().querySelector('[data-shoot="ctx-comment-el"]').click()
      if (!await until(() => document.querySelector('[data-composer]'))) return 'Comment on this element opened no composer'
      return 'ok'
    })()`)
    if (art !== 'ok') fail(`context menu: ${art}`)

    const note = await page.run(`(async () => {
      ${helpers}
      esc()
      const row = await (async () => { for (const end = Date.now() + 6000; Date.now() < end; await new Promise(r => setTimeout(r, 50))) { const r = [...document.querySelectorAll('[data-comment]')].find(x => /more variants/.test(x.textContent)); if (r) return r } return null })()
      if (!row) return 'the request is not in the list'
      if (rc(row)) return 'right-click on a comment was left to the browser'
      if (!await until(menu)) return 'a comment has no menu'
      const got = labels()
      if (!got.includes('Delete')) return 'the comment menu has ' + got.join(', ')
      menu().querySelector('[data-shoot="ctx-delete"]').click()
      if (!await until(() => !saved().some(i => i.action === 'more-variants'))) return 'Delete did not remove the request'
      return 'ok'
    })()`)
    if (note !== 'ok') fail(`context menu: ${note}`)
  } finally { page.close() }
  proto(['archive', 'ctxfx'])
  console.log('\nOK: right-click menus open on rows, comments and the artboard, More variants sends its count and note, and the browser keeps Shift, fields and selections')
}
