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
  return <main className="p-10" data-opt-demo data-icon={icon} data-size={size} data-tone={tone} data-style={style}>
    <h1 data-copy="heading" data-tweak="heading-size" style={{ fontSize: SIZES[size], fontWeight: 700 }}>{copy.heading}</h1>
    <p className="mt-2">A line under the heading</p>
    <div className="mt-6 flex items-center gap-3">
      <span data-tweak="row-icon" className="inline-flex"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" strokeWidth="2"><path d={ICONS[icon]} /></svg></span>
      <span data-tweak="tone" style={{ color: tone }}>Changed</span>
    </div>
    {[1, 2].map(n => <div key={n} data-tweak="divider" className="my-3" style={{ height: 1, background: line ? '#d4d4d8' : 'transparent' }} />)}
    <button data-tweak="cta" className="mt-6 rounded-lg px-4 py-2" style={style === 'Filled' ? { background: '#7c3aed', color: 'white' } : style === 'Soft' ? { background: '#ede9fe', color: '#5b21b6' } : { border: '1px solid #7c3aed', color: '#5b21b6' }}>Start</button>
  </main>
}`)
  writeFileSync(join(app, 'src/protos/options-check', 'B.tsx'), `export default function Plain() { return <main className="p-10"><h1 data-tweak="row-icon">No options here</h1></main> }`)
  const assert = (ok, why) => { if (!ok) fail(`options: ${why}`) }
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

  const page = await openPage(`${local}options-check/A`, { errors: true })
  try {
    // Dots on the marked elements only: the control with no element on the design has none.
    await until(page, `${dots} === ${JSON.stringify(['copy:heading tweak:heading-size', 'tweak:cta', 'tweak:divider', 'tweak:row-icon', 'tweak:tone'].sort().join('|'))}`, 'the dots are not exactly on the marked elements')

    // The panel opens beside the element, never over it, with a picture per option.
    await click(page, '[data-option-dot="tweak:row-icon"]')
    await until(page, `document.querySelectorAll('[data-options-pop] [data-option-tile]').length === 5`, 'the row icon panel did not open with its five tiles')
    const el = await dbox(page, '[data-tweak=row-icon]'), pop = await box(page, '[data-options-pop]')
    assert(pop.x >= el.x + el.w || pop.x + pop.w <= el.x || pop.y >= el.y + el.h || pop.y + pop.h <= el.y, `the panel covers its element: ${JSON.stringify({ el, pop })}`)
    await until(page, `document.querySelectorAll('[data-options-pop] [data-option-picture]').length === 5 && !document.querySelector('[data-option-cover]')`, 'the tiles have no pictures of the element')
    const pics = await page.run(`[...document.querySelectorAll('[data-options-pop] [data-option-picture]')].map(p => p.innerHTML)`)
    assert(pics.every(h => /<svg/.test(h) && /<path/.test(h)) && new Set(pics).size === 5, 'the pictures are not five different copies of the element')
    assert(await page.run(`${design('icon')} === 'Drop'`), 'drawing the pictures left another option on the design')

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
  } finally { page.close() }

  // A variant whose elements carry data-tweak but declare no controls has no dots.
  const plain = await openPage(`${local}options-check/B`)
  try {
    await wait(1500)
    assert(await plain.run(`document.querySelectorAll('[data-option-dot]').length === 0`), 'a variant without options has dots')
  } finally { plain.close() }

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
