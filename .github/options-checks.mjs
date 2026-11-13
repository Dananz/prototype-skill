// Options in place (app/shell/comments/options.tsx): dots on the elements a variant marks with
// data-tweak / data-copy, the panel of pictured tiles beside them, previewing, keeping, the panel
// staying put while an option resizes the element, tabs, Esc, hold to see the original, Send as one
// batch read back with proto inbox, the applied state after the agent's reply, a variant without
// options, the phone sheet, and no dots in a shot unless asked.
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

export async function optionsChecks({ proto, app, local, openPage, fail }) {
  proto(['add', 'options-check', '--title', 'Options checks', '--variants', 'A:Marked,B:Unmarked'])
  writeFileSync(join(app, 'src/protos/options-check', 'A.tsx'), `
import { useState } from 'react'
import { useTweaks } from '../../tweaks'
import { useCopy } from '../../copy'
const ICONS = { Drop: 'M12 3c4 5 6 8 6 11a6 6 0 0 1-12 0c0-3 2-6 6-11z', Square: 'M5 5h14v14H5z', Ring: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16z', Bolt: 'M13 2 4 14h7l-1 8 9-12h-7z', Plus: 'M12 5v14M5 12h14' }
const SIZES = { Medium: 24, Small: 18, Large: 40 }
export default function Variant() {
  const [icon, setIcon] = useState('Drop')
  const [size, setSize] = useState('Medium')
  const [tone, setTone] = useState('#8b5cf6')
  const [style, setStyle] = useState('Filled')
  const [loose, setLoose] = useState('One')
  const [line, setLine] = useState(true)
  useTweaks([
    { id: 'row-icon', kind: 'select', label: 'Row icon', value: icon, defaultValue: 'Drop', options: Object.keys(ICONS), set: setIcon },
    { id: 'heading-size', kind: 'select', label: 'Heading size', value: size, defaultValue: 'Medium', options: Object.keys(SIZES), set: setSize },
    { id: 'tone', kind: 'color', label: 'Status color', value: tone, defaultValue: '#8b5cf6', presets: [{ name: 'Violet', value: '#8b5cf6' }, { name: 'Green', value: '#22c55e' }, { name: 'Amber', value: '#f59e0b' }], set: setTone },
    { id: 'cta', kind: 'select', label: 'Start button style', value: style, defaultValue: 'Filled', options: ['Filled', 'Soft', 'Outline'], set: setStyle },
    { id: 'divider', kind: 'toggle', label: 'Row divider', value: line, defaultValue: true, set: setLine },
    { id: 'loose', kind: 'select', label: 'Not on the design', value: loose, defaultValue: 'One', options: ['One', 'Two'], set: setLoose },
  ])
  const copy = useCopy([{ id: 'heading', label: 'Heading', options: ['Three things waiting', 'You have three updates'] }])
  return <main className="p-10" data-round="off" data-opt-demo data-icon={icon} data-size={size} data-tone={tone} data-style={style}>
    <h1 data-copy="heading" data-tweak="heading-size" style={{ fontSize: SIZES[size], fontWeight: 700 }}>{copy.heading}</h1>
    <p className="mt-2">A line under the heading</p>
    <div className="mt-6 flex items-center gap-3">
      <span data-tweak="row-icon" className="inline-flex"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="url(#row-grad)" strokeWidth="2"><defs><linearGradient id="row-grad"><stop offset="0" stopColor="#7c3aed" /><stop offset="1" stopColor="#7c3aed" /></linearGradient></defs><path d={ICONS[icon]} /></svg></span>
      <span data-tweak="tone" style={{ color: tone }}>Changed</span>
    </div>
    {[1, 2].map(n => <div key={n} data-tweak="divider" className="my-3" style={{ height: 1, background: line ? '#d4d4d8' : 'transparent' }} />)}
    <button data-tweak="cta" className="mt-6 rounded-lg px-4 py-2" style={style === 'Filled' ? { background: '#7c3aed', color: 'white' } : style === 'Soft' ? { background: '#ede9fe', color: '#5b21b6' } : { border: '1px solid #7c3aed', color: '#5b21b6' }}>Start</button>
  </main>
}`)
  writeFileSync(join(app, 'src/protos/options-check', 'B.tsx'), `export default function Plain() { return <main className="p-10"><h1 data-tweak="row-icon">No options here</h1><p data-second className="mt-6">A second line</p></main> }`)
  const assert = (ok, why) => { if (!ok) fail(`options: ${why}`) }
  // The dev server picks a new prototype up from the disk a moment after it is written (its registry is
  // a glob, refreshed by the file watcher, slow on a busy machine): a page opened before then has no
  // such place. Opened once the registry served has it.
  const registered = async (route, ms = 30000) => {
    for (const end = Date.now() + ms; Date.now() < end; await wait(150)) {
      try { if ((await (await fetch(`${local}src/registry.ts`)).text()).includes(`/src/protos/${route}.tsx`)) return } catch { /* the server is busy */ }
    }
    fail(`options: the dev server never listed ${route}`)
  }
  const wait = ms => new Promise(r => setTimeout(r, ms))
  const until = async (page, expression, why, ms = 8000) => {
    for (const end = Date.now() + ms; Date.now() < end; await wait(60)) if (await page.run(expression)) return
    fail(`options: ${why}`)
  }
  const design = k => `window.__protoDesign()?.querySelector('[data-opt-demo]')?.getAttribute('data-${k}')`
  // A box in the page's px, of the shell (sel) or of the design, through a device view's frame.
  const box = (page, sel) => page.run(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 } })()`)
  const dbox = (page, sel) => page.run(`(() => { const el = window.__protoDesign()?.querySelector(${JSON.stringify(sel)}); if (!el) return null; const r = el.getBoundingClientRect(), f = el.ownerDocument.defaultView.frameElement; const o = f ? f.getBoundingClientRect() : { left: 0, top: 0 }, s = f ? o.width / (f.offsetWidth || 1) : 1; return { x: o.left + r.x * s, y: o.top + r.y * s, w: r.width * s, h: r.height * s } })()`)
  const dots = `[...document.querySelectorAll('[data-option-dot]')].map(d => d.dataset.optionDot).sort().join('|')`
  const click = async (page, sel) => { const b = await box(page, sel); assert(b, `nothing to click at ${sel}`); await page.hover(b.cx, b.cy); await page.press(b.cx, b.cy) }

  for (const v of ['A', 'B']) await registered(`options-check/${v}`)
  const page = await openPage(`${local}options-check/A`, { errors: true })
  try {
    // Dots on the marked elements only: the control with no element on the design has none.
    const want = ['copy:heading tweak:heading-size', 'tweak:cta', 'tweak:divider', 'tweak:row-icon', 'tweak:tone'].sort().join('|')
    for (const end = Date.now() + 12000; Date.now() < end && await page.run(dots) !== want;) await wait(80)
    const got = await page.run(dots)
    // What the page had, when not: its address, the design, what the options layer knows of it.
    const had = got === want ? '' : await page.run(`JSON.stringify((() => { const d = window.__protoDesign?.(), o = document.__prototypeComments?.options, st = o?.store.get(); return { at: location.pathname, design: d ? d.textContent.slice(0, 60) : null, marked: d?.querySelectorAll('[data-tweak], [data-copy]').length ?? 0, stage: st?.stage ? (st.stage === d ? 'design' : st.stage.isConnected ? 'other' : 'gone') : null, route: st?.route, spots: o?.spots().map(s => s.key), mode: document.__prototypeComments?.store.get().mode.kind, layer: !!document.querySelector('[data-options-layer]'), hosts: [...document.querySelectorAll('[data-layers] [data-route]')].map(h => h.dataset.route + ':' + (h.hasAttribute('data-building') ? 'building:' : '') + h.textContent.slice(0, 40)), tree: !!document.querySelector('[href="/options-check/A"], [data-act*="options-check"]'), reloaded: sessionStorage.getItem('proto-awaited-/options-check/A') } })())`)
    assert(got === want, `the dots are not exactly on the marked elements: ${got} (${had})`)

    // A click on a marked element that is no control of its own opens its panel (again: closes it); a
    // control (the button) keeps its own click and opens from its dot.
    const hd = await dbox(page, '[data-copy=heading]')
    await page.hover(hd.x + 20, hd.y + hd.h / 2); await page.press(hd.x + 20, hd.y + hd.h / 2)
    await until(page, `document.querySelectorAll('[data-options-pop] [data-option-tab]').length === 2`, 'a click on the heading did not open its panel')
    await page.press(hd.x + 20, hd.y + hd.h / 2)
    await until(page, `!document.querySelector('[data-options-pop]')`, 'a second click on the heading did not close its panel')
    // Selecting the heading's words ends with a click on it: no panel.
    await page.drag([hd.x + 2, hd.y + hd.h / 2], [hd.x + Math.min(hd.w, 160) - 2, hd.y + hd.h / 2])
    await wait(500)
    assert(await page.run(`!document.querySelector('[data-options-pop]') && !!window.__protoDesign()?.ownerDocument.getSelection()?.toString()`), 'selecting the heading\'s words opened its panel (or selected nothing)')
    await page.run(`(() => { window.__protoDesign()?.ownerDocument.getSelection()?.removeAllRanges(); getSelection()?.removeAllRanges() })()`)
    const bt = await dbox(page, '[data-tweak=cta]')
    await page.hover(bt.x + bt.w / 2, bt.y + bt.h / 2); await page.press(bt.x + bt.w / 2, bt.y + bt.h / 2)
    await wait(400)
    assert(await page.run(`!document.querySelector('[data-options-pop]')`), 'a click on a button with options opened its panel instead of being its own')
    await page.press(20, 880)

    // The panel opens beside the element, never over it, with a picture per option.
    await click(page, '[data-option-dot="tweak:row-icon"]')
    await until(page, `document.querySelectorAll('[data-options-pop] [data-option-tile]').length === 5`, 'the row icon panel did not open with its five tiles')
    const el = await dbox(page, '[data-tweak=row-icon]'), pop = await box(page, '[data-options-pop]')
    assert(pop.x >= el.x + el.w || pop.x + pop.w <= el.x || pop.y >= el.y + el.h || pop.y + pop.h <= el.y, `the panel covers its element: ${JSON.stringify({ el, pop })}`)
    await until(page, `document.querySelectorAll('[data-options-pop] [data-option-picture]').length === 5 && !document.querySelector('[data-option-cover]')`, 'the tiles have no pictures of the element')
    const pics = await page.run(`[...document.querySelectorAll('[data-options-pop] [data-option-picture]')].map(p => p.innerHTML)`)
    assert(pics.every(h => /<svg/.test(h) && /<path/.test(h)) && new Set(pics).size === 5, 'the pictures are not five different copies of the element')
    assert(await page.run(`${design('icon')} === 'Drop'`), 'drawing the pictures left another option on the design')
    // The copies are stills: inert, with no field names or ids of the design's, and an SVG's ids renamed
    // per copy with what points at them.
    const leaks = await page.run(`(() => {
      const pics = [...document.querySelectorAll('[data-options-pop] [data-option-picture] > span > span')]
      const roots = pics.map(p => p.firstElementChild)
      if (roots.length !== 5 || !roots.every(r => r?.hasAttribute('inert'))) return 'the copies are not inert'
      const ids = [...document.querySelectorAll('[data-options-pop] [data-option-picture] [id]')].map(e => e.id)
      if (ids.length !== 5 || new Set(ids).size !== 5 || ids.some(id => id === 'row-grad' || !id.endsWith('row-grad'))) return 'the SVG ids are not renamed per copy: ' + ids.join(',')
      const html = pics.map(p => p.innerHTML).join('')
      if (/#row-grad/.test(html)) return 'a copy still points at the gradient of the design'
      return 'ok'
    })()`)
    assert(leaks === 'ok', leaks)

    // Pointing at a tile shows it; leaving puts the choice back; a click keeps it, the panel open.
    const t1 = await box(page, '[data-options-pop] [data-option-tile="1"]')
    await page.hover(t1.cx - 2, t1.cy); await page.hover(t1.cx, t1.cy)
    await until(page, `${design('icon')} === 'Square'`, 'pointing at a tile did not show it on the design')
    await page.hover(20, 880)
    await until(page, `${design('icon')} === 'Drop'`, 'leaving the tiles did not put the design back')
    await click(page, '[data-options-pop] [data-option-tile="3"]')
    await until(page, `${design('icon')} === 'Bolt'`, 'a click on a tile did not keep it')
    assert(await page.run(`!!document.querySelector('[data-options-pop]')`), 'the panel closed on a click')
    await page.key('Escape')
    await until(page, `!document.querySelector('[data-options-pop]') && ${design('icon')} === 'Bolt'`, 'Esc did not close the panel, or lost the choice')

    // The keyboard: arrows move between tiles and show each (never the variants), Enter keeps.
    await click(page, '[data-option-dot="tweak:row-icon"]')
    await until(page, `document.querySelectorAll('[data-options-pop] [data-option-picture]').length === 5 && !document.querySelector('[data-option-cover]')`, 'the panel did not open again')
    const path = await page.run('location.pathname')
    await page.key('ArrowRight')
    await until(page, `${design('icon')} === 'Plus' && document.activeElement?.dataset.optionTile === '4'`, 'ArrowRight did not move to the next tile and show it')
    await page.key('ArrowLeft'); await page.key('ArrowLeft')
    await until(page, `${design('icon')} === 'Ring' && document.activeElement?.dataset.optionTile === '2'`, 'ArrowLeft did not move back')
    await page.enter()
    await until(page, `${design('icon')} === 'Ring' && document.querySelector('[data-options-pop] [data-option-tile="2"]')?.getAttribute('aria-pressed') === 'true'`, 'Enter did not keep the tile')
    await page.key('ArrowRight'); await page.enter()
    await until(page, `${design('icon')} === 'Bolt'`, 'Enter on the next tile did not keep it')
    assert(await page.run('location.pathname') === path, 'the arrows moved to another variant')
    await page.key('Escape')
    await until(page, `!document.querySelector('[data-options-pop]') && ${design('icon')} === 'Bolt'`, 'Esc after the keys lost the choice')

    // A toggle on a repeated hairline: Shown pictured, Hidden as an empty mark, both rows together.
    await click(page, '[data-option-dot="tweak:divider"]')
    await until(page, `document.querySelectorAll('[data-options-pop] [data-option-tile]').length === 2 && !document.querySelector('[data-option-cover]') && !!document.querySelector('[data-options-pop] [data-option-tile="0"] [data-option-picture]')`, 'the divider panel has no picture of the line')
    assert(await page.run(`/2/.test(document.querySelector('[data-options-pop]')?.textContent ?? '') && !document.querySelector('[data-options-pop] [data-option-tile="1"] [data-option-picture]')`), 'the divider panel does not say both rows change, or pictures Hidden')
    await page.key('Escape')
    await until(page, `!document.querySelector('[data-options-pop]')`, 'Esc did not close the divider panel')

    // Words: the heading's other tab.
    await click(page, '[data-option-dot="copy:heading tweak:heading-size"]')
    await until(page, `document.querySelectorAll('[data-options-pop] [data-option-tile]').length === 2`, 'the heading words are not listed')
    await click(page, '[data-options-pop] [data-option-tile="1"]')
    await until(page, `window.__protoDesign()?.querySelector('[data-copy=heading]')?.textContent === 'You have three updates'`, 'choosing words did not change the heading')
    await page.key('Escape')

    // Two facets are tabs; an option that resizes the element moves neither the panel nor its dot.
    await click(page, '[data-option-dot="copy:heading tweak:heading-size"]')
    await until(page, `document.querySelectorAll('[data-options-pop] [data-option-tab]').length === 2`, 'the heading has no tabs for its words and its size')
    await click(page, '[data-options-pop] [data-option-tab="1"]')
    await until(page, `document.querySelectorAll('[data-options-pop] [data-option-picture]').length === 3 && !document.querySelector('[data-option-cover]')`, 'the size tab has no pictures')
    await wait(200)
    const pop0 = await box(page, '[data-options-pop]'), dot0 = await box(page, '[data-option-dot="copy:heading tweak:heading-size"]'), h0 = await dbox(page, '[data-copy=heading]')
    const large = await box(page, '[data-options-pop] [data-option-tile="2"]')
    await page.hover(large.cx - 2, large.cy); await page.hover(large.cx, large.cy)
    await until(page, `${design('size')} === 'Large'`, 'pointing at Large did not show it')
    await wait(300)
    const pop1 = await box(page, '[data-options-pop]'), dot1 = await box(page, '[data-option-dot="copy:heading tweak:heading-size"]'), h1 = await dbox(page, '[data-copy=heading]')
    assert(h1.h > h0.h + 4, 'the bigger heading did not grow, so the check proves nothing')
    assert(Math.abs(pop0.x - pop1.x) < 1 && Math.abs(pop0.y - pop1.y) < 1 && Math.abs(dot0.x - dot1.x) < 1 && Math.abs(dot0.y - dot1.y) < 1, `the panel or its dot moved with the preview: ${JSON.stringify({ pop0, pop1, dot0, dot1 })}`)
    await page.key('Escape')
    await until(page, `!document.querySelector('[data-options-pop]') && ${design('size')} === 'Medium'`, 'Esc after a preview did not put the size back')

    // A choice that changes the element's own width (an outlined button is wider) keeps its pictures:
    // opening the panel again draws nothing.
    await click(page, '[data-option-dot="tweak:cta"]')
    await until(page, `document.querySelectorAll('[data-options-pop] [data-option-picture]').length === 3 && !document.querySelector('[data-option-cover]')`, 'the button style panel has no pictures')
    const w0 = (await dbox(page, '[data-tweak=cta]')).w
    await click(page, '[data-options-pop] [data-option-tile="2"]')
    await until(page, `${design('style')} === 'Outline'`, 'Outline was not kept')
    assert((await dbox(page, '[data-tweak=cta]')).w !== w0, 'the outlined button is as wide as the filled one, so the check proves nothing')
    await page.key('Escape')
    await until(page, `!document.querySelector('[data-options-pop]')`, 'Esc did not close the button style panel')
    await click(page, '[data-option-dot="tweak:cta"]')
    await until(page, `document.querySelectorAll('[data-options-pop] [data-option-tile]').length === 3`, 'the button style panel did not open again')
    for (let i = 0; i < 12; i++) { assert(await page.run(`!document.querySelector('[data-option-cover]')`), 'the pictures were drawn again after the element\'s own option changed its width'); await wait(60) }
    await click(page, '[data-options-pop] [data-option-tile="0"]')
    await until(page, `${design('style')} === 'Filled'`, 'Filled was not put back')
    await page.key('Escape')
    await until(page, `!document.querySelector('[data-options-pop]')`, 'Esc did not close the button style panel')

    // Shift-click on a dot steps to the next option without opening anything.
    const cd = await box(page, '[data-option-dot="tweak:cta"]')
    await page.mouse('mouseMoved', cd.cx, cd.cy, { button: 'none' })
    await page.mouse('mousePressed', cd.cx, cd.cy, { clickCount: 1, buttons: 1, modifiers: 8 })
    await page.mouse('mouseReleased', cd.cx, cd.cy, { clickCount: 1, modifiers: 8 })
    await until(page, `${design('style')} === 'Soft' && !document.querySelector('[data-options-pop]')`, 'Shift-click on the dot did not step to the next option')

    // The changes wait in the island; holding Original shows the design as it was.
    await until(page, `!!document.querySelector('[data-options-tray] [data-options-send]')`, 'the island has no changes to send')
    assert(await page.run(`document.querySelectorAll('[data-options-chip]').length === 3`), 'the island does not list the three changed elements')
    // The island grows to fit the tray (a 500 ms transition): pressed once it has.
    await wait(700)
    const orig = await box(page, '[data-options-tray] [data-option-original]')
    await page.mouse('mouseMoved', orig.cx, orig.cy, { button: 'none' })
    await page.mouse('mousePressed', orig.cx, orig.cy, { clickCount: 1, buttons: 1 })
    await until(page, `${design('style')} === 'Filled' && ${design('icon')} === 'Drop'`, 'holding Original did not show the original')
    await page.mouse('mouseReleased', orig.cx, orig.cy, { clickCount: 1 })
    await until(page, `${design('style')} === 'Soft' && ${design('icon')} === 'Bolt'`, 'letting go of Original did not bring the choices back')
    // \\ is read by the key's place: a keyboard in another language types another character there.
    const slash = type => `document.dispatchEvent(new KeyboardEvent('${type}', { key: '§', code: 'Backslash', bubbles: true, cancelable: true }))`
    await page.run(slash('keydown'))
    await until(page, `${design('style')} === 'Filled'`, 'holding the \\\\ key (another layout) did not show the original')
    await page.run(slash('keyup'))
    await until(page, `${design('style')} === 'Soft'`, 'letting go of the \\\\ key (another layout) did not bring the choices back')
    // Held in the panel while the panel closes: the original does not stick.
    await click(page, '[data-option-dot="tweak:row-icon"]')
    await until(page, `!!document.querySelector('[data-options-pop] [data-option-original]') && !document.querySelector('[data-option-cover]')`, 'the row icon panel did not open')
    const po = await box(page, '[data-options-pop] [data-option-original]')
    await page.mouse('mouseMoved', po.cx, po.cy, { button: 'none' })
    await page.mouse('mousePressed', po.cx, po.cy, { clickCount: 1, buttons: 1 })
    await until(page, `${design('icon')} === 'Drop'`, 'holding Original in the panel did not show the original')
    await page.key('Escape')
    await until(page, `!document.querySelector('[data-options-pop]')`, 'Esc did not close the panel while Original was held')
    await page.mouse('mouseReleased', 20, 880, { clickCount: 1 })
    await until(page, `${design('icon')} === 'Bolt' && ${design('style')} === 'Soft'`, 'the original stuck after its panel closed while it was held')

    // Send: one batch, one comment per changed value on its element, read back with proto inbox.
    await click(page, '[data-options-tray] [data-options-send]')
    await until(page, `!!document.querySelector('[data-options-sending]') && document.querySelectorAll('[data-option-waiting]').length === 3`, 'after Send the elements do not wait for the agent')
    let inbox = ''
    for (let i = 0; i < 40 && !/action: option/.test(inbox); i++) { inbox = proto(['inbox'], { stdout: true }); if (!/action: option/.test(inbox)) await wait(250) }
    assert(/Row icon \(useTweaks row-icon\): “Bolt”, option 4 of 5/.test(inbox), 'the inbox has no option comment for the row icon')
    assert(/Start button style \(useTweaks cta\): “Soft”, option 2 of 3/.test(inbox), 'the inbox has no option comment for the button style')
    assert((inbox.match(/action: option/g) || []).length === 2, 'the batch does not have exactly the two changed values')
    assert(/Heading \(heading\): “You have three updates”, option 2 of 2/.test(inbox) && /action: copy/.test(inbox), 'the batch has no copy comment for the heading words')
    const batch = inbox.match(/batch (\S+)/)?.[1]
    assert(batch, 'no batch id in the inbox')
    proto(['reply', batch, 'Set both as the defaults', '--done'])
    await until(page, `!!document.querySelector('[data-options-tray] [data-options-undo]')`, 'the agent\'s reply did not show as applied', 15000)

    // More options and To prototype: asked at once, waited for, and settled by the agent's reply.
    const seen = new Set([batch])
    const latest = () => { const id = [...proto(['inbox'], { stdout: true }).matchAll(/batch (\S+)/g)].map(m => m[1]).find(x => !seen.has(x)); if (id) seen.add(id); return id }
    await click(page, '[data-option-dot="tweak:cta"]')
    await until(page, `!!document.querySelector('[data-options-pop] [data-option-promote]')`, 'the button style panel did not open')
    await click(page, '[data-options-pop] [data-option-more]')
    await until(page, `!!document.querySelector('[data-options-pop] [data-option-asking="more"]')`, 'More options does not wait for the agent')
    let more
    for (let i = 0; i < 40 && !more; i++) { more = latest(); if (!more) await wait(250) }
    assert(more, 'More options sent nothing')
    proto(['reply', more, 'Added three', '--done'])
    await until(page, `!document.querySelector('[data-options-pop] [data-option-asking="more"]')`, 'the More options wait did not end with the reply', 15000)
    await click(page, '[data-options-pop] [data-option-promote]')
    let promote
    for (let i = 0; i < 40 && !promote; i++) { promote = latest(); if (!promote) await wait(250) }
    assert(promote, 'To prototype sent nothing')
    proto(['reply', promote, 'Built options-check-cta', '--done'])
    await until(page, `!!document.querySelector('[data-options-pop] [data-option-promoted]')`, 'To prototype did not say it is in the tree after the reply', 15000)
    await page.key('Escape')
    await until(page, `!!document.querySelector('[data-option-dot="tweak:cta"] [class*="proto-option-pulse"]') || !!document.querySelector('[data-option-dot="tweak:cta"] span[class*=pulse]')`, 'the dot whose options arrived does not pulse')

    // A sent choice waits however many batches come after it: the page lists it beyond the last 20
    // until the agent is done, so it never reads as applied before then.
    await click(page, '[data-option-dot="tweak:row-icon"]')
    await until(page, `document.querySelectorAll('[data-options-pop] [data-option-picture]').length === 5 && !document.querySelector('[data-option-cover]')`, 'the row icon panel did not open for a second send')
    await click(page, '[data-options-pop] [data-option-tile="2"]')
    await until(page, `${design('icon')} === 'Ring'`, 'Ring was not kept')
    await page.key('Escape')
    await until(page, `!!document.querySelector('[data-options-tray] [data-options-send]')`, 'the second change is not in the tray')
    await click(page, '[data-options-tray] [data-options-send]')
    await until(page, `!!document.querySelector('[data-options-sending]')`, 'the second send does not wait for the agent')
    let second
    for (let i = 0; i < 40 && !second; i++) { second = latest(); if (!second) await wait(250) }
    assert(second, 'the second send made no batch')
    for (let i = 0; i < 21; i++) {
      const r = await fetch(`${local}__proto/comments`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ theme: 'light', viewport: { w: 1440, h: 900 }, comments: [{ route: 'options-check/A', text: `filler ${i}` }] }) })
      assert(r.ok, `a filler batch was refused: ${r.status}`)
    }
    const listed = await (await fetch(`${local}__proto/status`)).json()
    assert(listed.inbox.batches.length > 20 && listed.inbox.batches.some(b => b.id === second), 'a choice still waiting is no longer listed once 20 batches came after it')
    await wait(800)
    assert(await page.run(`!!document.querySelector('[data-options-sending]') && !document.querySelector('[data-options-undo]')`), 'the waiting choice reads as applied once 20 batches came after it')
    // The fillers are answered, so no later check finds them waiting.
    for (const id of [...proto(['inbox'], { stdout: true }).matchAll(/batch (\S+)/g)].map(m => m[1])) { seen.add(id); if (id !== second) proto(['reply', id, 'Noted', '--done']) }
    // The page has heard it listed (so once done and past the last 20, it reads as applied).
    await until(page, `Object.keys(sessionStorage).filter(k => k.startsWith('proto-options-')).some(k => Object.values(JSON.parse(sessionStorage.getItem(k))).some(r => r?.sent?.batch === ${JSON.stringify(second)} && r.sent.listed))`, 'the page never heard the waiting choice listed', 15000)
    proto(['reply', second, 'Set', '--done'])
    // (Its tray still lists the first send's values, which the agent never wrote in here: no Undo row.)
    await until(page, `!document.querySelector('[data-options-sending]')`, 'the second send still waits after the reply', 15000)
  } finally { page.close() }

  // A variant whose elements carry data-tweak but declare no controls has no dots. Options asked for on
  // two of its elements both wait (one does not replace the other).
  const plain = await openPage(`${local}options-check/B`)
  try {
    await wait(1500)
    assert(await plain.run(`document.querySelectorAll('[data-option-dot]').length === 0`), 'a variant without options has dots')
    // Nothing to measure: the dots' measuring asks for no frames (counted by where each request comes from).
    const frames = await plain.run(`(async () => {
      const raf = window.requestAnimationFrame, from = []
      window.requestAnimationFrame = f => { from.push(new Error().stack ?? ''); return raf.call(window, f) }
      await new Promise(r => setTimeout(r, 1000))
      window.requestAnimationFrame = raf
      return from.filter(s => /comments[/]options[.]tsx/.test(s)).length
    })()`)
    assert(frames < 3, `the dots are measured every frame on a variant with none: ${frames} frames in a second`)
    for (const sel of ['h1', '[data-second]']) {
      const asked = await plain.run(`(async () => {
        const until = async f => { for (const end = Date.now() + 6000; Date.now() < end; await new Promise(r => setTimeout(r, 50))) if (f()) return true; return false }
        const el = window.__protoDesign()?.querySelector(${JSON.stringify(sel)})
        if (!el) return 'no element'
        const r = el.getBoundingClientRect()
        el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, composed: true, button: 2, clientX: r.left + 4, clientY: r.top + r.height / 2 }))
        if (!await until(() => [...document.querySelectorAll('[data-context-menu] [role=menuitem]')].some(x => /Options for this element/.test(x.textContent)))) return 'its menu has no Options for this element'
        ;[...document.querySelectorAll('[data-context-menu] [role=menuitem]')].find(x => /Options for this element/.test(x.textContent)).click()
        if (!await until(() => document.querySelector('[data-options-pop] [data-option-ask]'))) return 'the ask panel did not open'
        document.querySelector('[data-options-pop] [data-option-ask]').click()
        return await until(() => !document.querySelector('[data-options-pop]')) ? 'ok' : 'the ask panel stayed open'
      })()`)
      assert(asked === 'ok', `asking for options on ${sel}: ${asked}`)
    }
    await until(plain, `document.querySelectorAll('[data-option-asking="ask"]').length === 2`, 'asking on a second element dropped the first one\'s wait')
    for (const id of [...proto(['inbox'], { stdout: true }).matchAll(/batch (\S+)/g)].map(m => m[1])) proto(['reply', id, 'Added', '--done'])
  } finally { plain.close() }
  // ?options=0 has no dots, even on the design's own page.
  const off = await openPage(`${local}options-check/A?options=0`)
  try {
    await wait(1500)
    assert(await off.run(`document.querySelectorAll('[data-option-dot]').length === 0`), '?options=0 shows the dots')
  } finally { off.close() }
  // A shot with the dots is named apart from the plain one, so neither overwrites the other.
  const shotOut = proto(['shoot', 'options-check/A', '--options'], { stdout: true })
  assert(/options-check-A-desktop-options\.png/.test(shotOut), `proto shoot --options did not name its file apart: ${shotOut.slice(0, 400)}`)

  // A shot has no dots, unless it asks.
  const shot = await openPage(`${local}options-check/A?hints=0`)
  try {
    await wait(1500)
    assert(await shot.run(`document.querySelectorAll('[data-option-dot]').length === 0`), 'a shot (?hints=0) shows the dots')
  } finally { shot.close() }
  const asked = await openPage(`${local}options-check/A?hints=0&options=1`)
  try {
    await until(asked, `document.querySelectorAll('[data-option-dot]').length >= 4`, '?options=1 did not bring the dots into a shot')
  } finally { asked.close() }

  // A phone: a tap on a dot opens the sheet with the same tiles.
  const phone = await openPage(`${local}options-check/A`, { width: 390, height: 844, phone: true })
  try {
    await until(phone, `document.querySelectorAll('[data-option-dot]').length >= 4`, 'the phone has no dots')
    const d = await box(phone, '[data-option-dot="tweak:row-icon"]')
    await phone.touch('touchStart', [[d.cx, d.cy]]); await phone.touch('touchEnd', [])
    await until(phone, `document.querySelectorAll('[data-options-sheet] [data-option-tile]').length === 5`, 'the phone sheet did not open with the tiles')
    await until(phone, `document.querySelectorAll('[data-options-sheet] [data-option-picture]').length === 5`, 'the phone sheet tiles have no pictures')
    const t2 = await box(phone, '[data-options-sheet] [data-option-tile="2"]')
    await phone.touch('touchStart', [[t2.cx, t2.cy]]); await phone.touch('touchEnd', [])
    await until(phone, `${design('icon')} === 'Ring'`, 'a tap on a tile in the sheet did not keep it')
  } finally { phone.close() }
  console.log('OK: options in place')
}
