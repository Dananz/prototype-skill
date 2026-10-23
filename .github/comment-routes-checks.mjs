// A comment on something inside a menu keeps the way there: while the menu is closed its pin sits
// on the button that opens it, and a click on that pin, or on the comment in the list, opens the menu.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export async function commentRoutesChecks({ proto, app, openPage, fail }) {
  for (const [slug, css, nested, dual, learn] of [['routefx', false, false, false, false], ['routecss', true, false, false, false], ['routenested', true, true, false, false], ['routepress', true, false, true, false], ['routelearn', true, false, false, true]]) {
  proto(['add', slug, '--title', 'Menu route', '--variants', 'A:Menu'])
  writeFileSync(join(app, 'src', 'protos', slug, 'A.tsx'), `import { useState } from 'react'
export default function Menu() {
  const [open, setOpen] = useState(false)
  const [inner, setInner] = useState(false)
  return <main style={{ padding: 24 }}>
    <button data-shoot="opener" ${dual ? 'onPointerDown={() => setOpen(o => !o)}' : ''} onClick={() => { setOpen(o => !o); setInner(false) }} style={{ width: 120, height: 40 }}>Open</button>
    ${css ? '' : '{open && '}<div data-shoot="menu" data-opened-by="[data-shoot=opener]" style={{ ${css ? "display: open ? 'block' : 'none'," : ''} marginTop: 8, width: 220, padding: 8, background: '#eee' }}>
      ${nested ? `<button data-shoot="inner-opener" onClick={() => setInner(o => !o)}>Inner</button>
      <div data-opened-by="[data-shoot=inner-opener]" hidden={!inner}>` : ''}
      <button data-shoot="item" style={{ width: 180, height: 36 }}>Item</button>
      ${nested ? '</div>' : ''}
    </div>${css ? '' : '}'}
  </main>
}
`)
  const local = JSON.parse(readFileSync(join(app, 'session.json'), 'utf8')).localUrl
  const page = await openPage(`${local}${slug}/A?theme=light`)
  const helpers = `
    const until = async (f, ms = 5000) => { for (const end = Date.now() + ms; Date.now() < end; await new Promise(r => setTimeout(r, 50))) if (f()) return true; return false }
    const design = () => document.querySelector('[data-view] iframe')?.contentDocument ?? document
    const q = s => design().querySelector('[data-mount] ' + s)
    const visible = el => !!el && !!(el.getBoundingClientRect().width && el.getBoundingClientRect().height) && el.ownerDocument.defaultView.getComputedStyle(el).visibility !== 'hidden'
    const item = () => visible(q('[data-shoot=item]'))
    const menu = () => visible(q('[data-shoot=menu]'))
    const toggle = () => document.querySelector('[data-act="comment:toggle"]')
    // The bar is redrawn when its state changes, so the button is looked up each time.
    const mode = async on => { for (let i = 0; i < 4 && (toggle().getAttribute('aria-pressed') === 'true') !== on; i++) { toggle().click(); await until(() => (toggle().getAttribute('aria-pressed') === 'true') === on, 1500) } return (toggle().getAttribute('aria-pressed') === 'true') === on }
    const editor = () => document.querySelector('[data-composer] [role=textbox]')
    const pin = () => document.querySelector('button[aria-label="Comment 1"]')
    const via = () => document.querySelector('[data-shoot=comment-via]')
    const saved = () => JSON.parse(localStorage.getItem('proto-comments-smoke') || '{}').items?.find(i => i.proto === '${slug}')
  `
  try {
    // Open the menu (commenting off), then comment on the item in it.
    const at = await page.run(`(async () => {
      ${helpers}
      if (!await until(() => q('[data-shoot=opener]'))) return 'the design never showed'
      if (!await mode(false)) return 'comment mode did not turn off'
      q('[data-shoot=opener]').click()
      if (!await until(menu)) return 'the menu did not open'
      if (${nested}) q('[data-shoot=inner-opener]').click()
      if (!await until(item)) return 'the item did not show'
      if (${learn}) q('[data-shoot=menu]').removeAttribute('data-opened-by')
      if (!await mode(true)) return 'comment mode did not turn on'
      await new Promise(r => setTimeout(r, 200))
      const el = q('[data-shoot=item]'), r = el.getBoundingClientRect(), frame = el.ownerDocument.defaultView.frameElement
      const f = frame?.getBoundingClientRect(), scale = frame ? f.width / frame.offsetWidth : 1
      return [(f?.left ?? 0) + (r.left + r.width / 2) * scale, (f?.top ?? 0) + (r.top + r.height / 2) * scale]
    })()`)
    if (!Array.isArray(at)) fail(`menu route: ${at}`)
    await page.press(...at)
    const res = await page.run(`(async () => {
      ${helpers}
      if (!await until(editor)) return 'picking the item opened no composer'
      editor().textContent = 'Inside the menu'
      editor().dispatchEvent(new Event('input', { bubbles: true }))
      if (!await until(() => !document.querySelector('[data-composer] button[title^="Add,"]').disabled)) return 'Add never became ready'
      document.querySelector('[data-composer] button[title^="Add,"]').click()
      if (!await until(() => !editor() && pin())) return 'the comment has no pin on the item'
      // Drafts are written to storage a moment after a change.
      await until(() => saved()?.target)
      if (${learn}) {
        if (saved()?.target?.route?.length) return 'the unmarked menu should start with no saved opener route'
        q('[data-shoot=menu]').setAttribute('data-opened-by', '[data-shoot=opener]')
        if (!await until(() => saved()?.target?.route?.length)) return 'a route-less comment must learn its opener when the marker arrives later'
      }
      const route = saved()?.target?.route
      if (JSON.stringify(route) !== JSON.stringify(${JSON.stringify(nested ? ['[data-shoot=opener]', '[data-shoot=inner-opener]'] : ['[data-shoot=opener]'])})) return 'the comment should keep the way to the item, it kept ' + JSON.stringify(route) + ' | attr on page: ' + !!q('[data-opened-by]') + ' | target keys: ' + Object.keys(saved()?.target || {}).join(',')

      // Close the menu: the pin moves to the button that opens it.
      if (!await mode(false)) return 'comment mode did not turn off again'
      q('[data-shoot=opener]').click()
      if (!await until(() => !menu())) return 'the menu did not close'
      if (!await mode(true)) return 'comment mode did not turn back on'
      if (!await until(via)) return 'with the menu closed, the comment should have a pin on the button that opens it'
      const vb = via().getBoundingClientRect(), ob = q('[data-shoot=opener]').getBoundingClientRect()
      const frame = q('[data-shoot=opener]').ownerDocument.defaultView.frameElement, f = frame?.getBoundingClientRect(), k = frame ? f.width / frame.offsetWidth : 1
      const ox = (f?.left ?? 0) + ob.right * k, oy = (f?.top ?? 0) + ob.top * k
      if (Math.abs(vb.left + vb.width / 2 - ox) > 24 || Math.abs(vb.top + vb.height / 2 - oy) > 24) return 'the pin is not on the opener (' + Math.round(vb.left) + ',' + Math.round(vb.top) + ' vs ' + Math.round(ox) + ',' + Math.round(oy) + ')'

      // A click on that pin opens the menu, and the pin moves back onto the item.
      via().click()
      if (!await until(item)) return 'a click on the pin should open the menu'
      if (!await until(() => pin() && !via())) return 'with the menu open, the pin should be back on the item'

      // The same from the list: close it, then click the comment there.
      if (!await mode(false)) return 'comment mode did not turn off (list)'
      q('[data-shoot=opener]').click()
      if (!await until(() => !menu())) return 'the menu did not close (list)'
      const row = [...document.querySelectorAll('[data-shoot=comment-row]')].find(r => r.textContent.includes('Inside the menu'))
      if (!row) return 'the comment is not in the list'
      row.querySelector('button').click()
      if (!await until(item)) return 'a click on the comment in the list should open the menu'
      return 'ok'
    })()`)
    if (res !== 'ok') fail(`menu route: ${res}`)
  } finally { page.close() }
  proto(['archive', slug])
  }
  console.log('\nOK: a comment inside a menu has its pin on the opener while closed, and its pin or list row opens the menu')
}
