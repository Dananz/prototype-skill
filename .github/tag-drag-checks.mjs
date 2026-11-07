// Rows of the project tree dragged onto the comments island's box become tags there: an option its
// variant, a prototype's row the whole prototype, a row in the tree's selection everything chosen.
// The drag is the pointer's (tag-drag.ts): while it is held the row's copy follows it, the row
// leaves a dashed slot, the cursor carries a count and the box lights; Esc puts it all back. Sent, a
// whole prototype reaches the agent as one (`proto inbox`), not as an element.
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

export async function tagDragChecks({ proto, app, local, openPage, fail }) {
  const assert = (ok, why) => { if (!ok) fail(`tag drag: ${why}`) }
  const wait = ms => new Promise(r => setTimeout(r, ms))
  proto(['add', 'dragsrc', '--title', 'Drag source', '--variants', 'A:One,B:Two,C:Three'])
  proto(['add', 'dragtwo', '--title', 'Other screen', '--variants', 'A:Uno'])
  for (const [slug, v] of [['dragsrc', 'A'], ['dragsrc', 'B'], ['dragsrc', 'C'], ['dragtwo', 'A']]) writeFileSync(join(app, 'src', 'protos', slug, `${v}.tsx`), `export default function V() { return <main style={{ padding: 32 }}><h1>${slug} ${v}</h1></main> }\n`)
  proto(['done', 'dragsrc'])
  proto(['done', 'dragtwo'])
  const page = await openPage(`${local}dragsrc/A?tree=1&theme=light`, { errors: true })
  const js = expr => page.run(`(async () => { ${HELPERS}; ${expr} })()`)
  const HELPERS = `
    const until = async f => { for (const end = Date.now() + 8000; Date.now() < end; await new Promise(r => setTimeout(r, 50))) if (f()) return true; return false }
    const box = () => document.querySelector('[data-island] [data-shoot=whole-input]')
    const row = id => document.querySelector('[data-tree-row="' + id + '"]')
    const chips = () => [...box().querySelectorAll('[data-tag]')].map(c => c.textContent)
    const mid = el => { const r = el.getBoundingClientRect(); return [Math.round(r.left + r.width * 0.4), Math.round(r.top + r.height / 2)] }
  `
  // A real drag, held over the box for a look before it is let go (or Esc).
  const drag = async (rowId, { look, esc } = {}) => {
    const [[x0, y0], [x1, y1]] = JSON.parse(await js(`return JSON.stringify([mid(row('${rowId}').querySelector('[data-row-label]') ?? row('${rowId}')), mid(box())])`))
    await page.mouse('mouseMoved', x0, y0, { button: 'none' })
    await page.mouse('mousePressed', x0, y0, { clickCount: 1, buttons: 1 })
    for (let i = 1; i <= 14; i++) { await page.mouse('mouseMoved', x0 + (x1 - x0) * i / 14, y0 + (y1 - y0) * i / 14, { buttons: 1 }); await wait(16) }
    await wait(250)
    const seen = look ? JSON.parse(await js(`return JSON.stringify({
      ghosts: document.querySelectorAll('[data-tag-drag-layer] > div').length,
      badge: document.querySelector('[data-tag-drag-layer] > span')?.textContent ?? '',
      lit: box().hasAttribute('data-tag-drop'),
      slots: document.querySelectorAll('[data-tag-dragging]').length,
    })`)) : null
    if (esc) await page.key?.('Escape')
    await page.mouse('mouseReleased', x1, y1, { clickCount: 1 })
    await wait(400)
    return seen
  }
  try {
    const ready = await js(`
      if (!await until(() => box() && row('opt:dragsrc/B') && row('exp:dragtwo'))) return 'no island box, or the tree rows are missing: ' + [...document.querySelectorAll('[data-tree-row]')].map(r => r.dataset.treeRow).join(' ')
      box().focus(); document.execCommand('insertText', false, 'update these:'); box().blur()
      return ''`)
    assert(!ready, ready)

    const one = await drag('opt:dragsrc/B', { look: true })
    assert(one.ghosts === 1 && one.badge === '+1' && one.lit && one.slots === 1, `held over the box, one row should follow with +1, the box lit and a slot left: ${JSON.stringify(one)}`)
    const after = await js(`return JSON.stringify({ c: chips(), text: box().textContent, layer: !!document.querySelector('[data-tag-drag-layer]'), slots: document.querySelectorAll('[data-tag-dragging]').length, lit: box().hasAttribute('data-tag-drop') })`)
    const a = JSON.parse(after)
    assert(a.c.length === 1 && /#2/.test(a.c[0]), `the option should land as its variant chip: ${after}`)
    assert(!a.layer && !a.slots && !a.lit, `nothing of the drag should stay once it lands: ${after}`)
    assert(/^update these: @/.test(a.text), `the chip should follow the words, after a space: ${a.text}`)

    await drag('exp:dragtwo')
    await drag('opt:dragsrc/B')
    const two = JSON.parse(await js(`return JSON.stringify(chips())`))
    assert(two.length === 2 && two[1] === '@Other screen', `a prototype's row should land as the whole prototype, a second drag of the same row add nothing: ${JSON.stringify(two)}`)

    // Esc while held: nothing lands, and the row is back.
    await drag('opt:dragsrc/C', { esc: true })
    const kept = JSON.parse(await js(`return JSON.stringify({ c: chips().length, slots: document.querySelectorAll('[data-tag-dragging]').length })`))
    assert(kept.c === 2 && !kept.slots, `Esc should put the drag back: ${JSON.stringify(kept)}`)

    // Cmd-click two options, then drag one of them: both come, as a stack with a count.
    const chose = await js(`
      box().replaceChildren(); box().dispatchEvent(new Event('input', { bubbles: true }))
      const click = id => row(id).querySelector('button[aria-pressed]').dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true, ctrlKey: true }))
      click('opt:dragsrc/B'); click('opt:dragsrc/C')
      return await until(() => document.querySelectorAll('[data-tree-chosen="true"]').length >= 2) ? '' : 'Cmd-click chose no rows'`)
    assert(!chose, chose)
    const many = await drag('opt:dragsrc/C', { look: true })
    assert(many.ghosts >= 2 && /^\+[2-9]/.test(many.badge), `a chosen row should carry the selection: ${JSON.stringify(many)}`)
    const landed = JSON.parse(await js(`return JSON.stringify(chips())`))
    assert(!page.errors().length, `the page should throw nothing: ${page.errors().join(' | ')}`)
    assert(landed.length === many.ghosts && landed.some(c => /#2/.test(c)) && landed.some(c => /#3/.test(c)), `every chosen row should land as a chip: ${JSON.stringify(landed)}`)

    // A whole prototype goes to the agent as one.
    const sent = await js(`
      box().replaceChildren(); box().focus(); document.execCommand('insertText', false, 'see'); box().blur()
      document.querySelector('[data-tree-root]')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      return ''`)
    assert(!sent, sent)
    await drag('exp:dragtwo')
    const posted = await js(`
      const add = () => document.querySelector('[data-island] [data-shoot=whole-add]')
      if (!await until(() => add())) return 'no Add'
      add().click()
      const send = () => document.querySelector('[data-island] [data-shoot=send]')
      if (!await until(() => send())) return 'no Send'
      send().click()
      return ''`)
    assert(!posted, posted)
    let inbox = ''
    for (const end = Date.now() + 8000; Date.now() < end && !/whole prototype dragtwo/.test(inbox); await wait(300)) inbox = proto(['inbox'])
    assert(/with @Other screen: the whole prototype dragtwo \(all 1 of its variants\)/.test(inbox), `the inbox should name the whole prototype:\n${inbox}`)
  } finally { page.close() }
  proto(['archive', 'dragsrc'])
  proto(['archive', 'dragtwo'])
  console.log('OK: tree rows dragged onto the comment box become tags, one or a selection, Esc puts them back, and a whole prototype reaches the agent as one')
}
