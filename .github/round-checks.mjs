// A round of decisions (app/shell/comments/round.tsx) and the composer's choice of how to answer
// (comments/composer.tsx): the round offered on a variant with 3 or more elements with options (not on
// one with 2, forced by data-round on one with 1, never in a still), its steps (1 to 9 pick, Enter
// moves on, the arrows move and skip), Keep as is, Skip, the progress and its legend, leaving and
// coming back, putting it away and the tool strip's button, see all with its bar, dots and panel, a
// click on an element, the summary and its Send read back with proto inbox, a phone's round and its
// bottom bar button, and the composer's choice kept by the server and printed by proto inbox.
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

// Seven elements with options on a workout home: the heading's words and size, a hero color, a badge,
// six button styles, a row icon in every row, a status color, a toggled divider.
const DEMO = "import { useState } from 'react'\nimport { useTweaks } from '../../tweaks'\nimport { useCopy } from '../../copy'\nconst ICONS: Record<string, string> = { Drop: 'M12 3c4 5 6 8 6 11a6 6 0 0 1-12 0c0-3 2-6 6-11z', Dumbbell: 'M3 10v4M6 7v10M18 7v10M21 10v4M6 12h12', Shoe: 'M3 16h18v2H3zM4 16c0-4 2-9 6-9l2 4 6 2c2 1 3 2 3 3', Heart: 'M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10z', Bolt: 'M13 2 4 14h7l-1 8 9-12h-7z' }\nconst SIZES: Record<string, string> = { Medium: 'text-[26px]', Small: 'text-[21px]', Large: 'text-[32px]' }\nconst CTA: Record<string, string> = {\n  Filled: 'bg-violet-600 text-white', Soft: 'bg-violet-100 text-violet-800 dark:bg-violet-500/20 dark:text-violet-200', Outline: 'ring-1 ring-inset ring-violet-600 text-violet-700 dark:text-violet-300',\n  Ghost: 'text-violet-700 dark:text-violet-300', Square: 'bg-violet-600 text-white !rounded-md', Dark: 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900',\n}\nconst ROWS = [['Workout tracking on the sheet', 'Changed'], ['Rest timer between sets', 'New'], ['Weekly progress graph', 'Changed']]\nexport default function Variant() {\n  const [icon, setIcon] = useState('Drop')\n  const [size, setSize] = useState('Medium')\n  const [tone, setTone] = useState('#7c3aed')\n  const [hero, setHero] = useState('#8b5cf6')\n  const [cta, setCta] = useState('Filled')\n  const [badge, setBadge] = useState('Pill')\n  const [line, setLine] = useState(true)\n  useTweaks([\n    { id: 'heading-size', kind: 'select', label: 'Heading size', value: size, defaultValue: 'Medium', options: Object.keys(SIZES), set: setSize },\n    { id: 'hero-tone', kind: 'color', label: 'Hero color', value: hero, defaultValue: '#8b5cf6', presets: [{ name: 'Violet', value: '#8b5cf6' }, { name: 'Sky', value: '#0ea5e9' }, { name: 'Coral', value: '#f97316' }, { name: 'Moss', value: '#16a34a' }], set: setHero },\n    { id: 'new-badge', kind: 'select', label: 'New badge', value: badge, defaultValue: 'Pill', options: ['Pill', 'Dot', 'Tag'], set: setBadge },\n    { id: 'cta', kind: 'select', label: 'Start button style', value: cta, defaultValue: 'Filled', options: Object.keys(CTA), set: setCta },\n    { id: 'row-icon', kind: 'select', label: 'Row icon', value: icon, defaultValue: 'Drop', options: Object.keys(ICONS), set: setIcon },\n    { id: 'status', kind: 'color', label: 'Status color', value: tone, defaultValue: '#7c3aed', presets: [{ name: 'Violet', value: '#7c3aed' }, { name: 'Green', value: '#16a34a' }, { name: 'Amber', value: '#d97706' }], set: setTone },\n    { id: 'divider', kind: 'toggle', label: 'Row divider', value: line, defaultValue: true, set: setLine },\n  ])\n  const copy = useCopy([{ id: 'heading', label: 'Heading', options: ['3 waiting for you', 'Three updates since last time', 'Ready when you are'] }])\n  return (\n    <main data-round-demo data-icon={icon} data-size={size} data-cta={cta} className=\"min-h-full bg-zinc-50 px-5 py-8 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100\">\n      <div className=\"mx-auto max-w-[400px]\">\n        <p className=\"text-[13px] text-zinc-500\">Tuesday, November 12</p>\n        <h1 data-copy=\"heading\" data-tweak=\"heading-size\" className={`mt-3 font-bold tracking-tight ${SIZES[size]}`}>{copy.heading}</h1>\n        <p className=\"mt-1 text-[14px] text-zinc-500\">What changed since your last workout</p>\n        <section className=\"mt-5 overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-black/5 dark:bg-zinc-900 dark:ring-white/10\">\n          <div data-tweak=\"hero-tone\" className=\"relative h-36\" style={{ background: `linear-gradient(135deg, ${hero}, #4c1d95)` }}>\n            <span data-tweak=\"new-badge\" className={`absolute end-3 top-3 ${badge === 'Pill' ? 'rounded-full bg-white px-2.5 py-0.5 text-[12px] font-semibold text-violet-700' : badge === 'Dot' ? 'size-3 rounded-full bg-white' : 'rounded bg-amber-300 px-1.5 text-[11px] font-bold uppercase text-amber-950'}`}>{badge === 'Dot' ? '' : 'New'}</span>\n          </div>\n          <div className=\"flex items-center justify-between gap-3 p-4\">\n            <div><div className=\"text-[17px] font-semibold\">Today's workout \u00b7 Legs</div><div className=\"text-[13px] text-zinc-500\">45 min \u00b7 6 exercises</div></div>\n            <button data-tweak=\"cta\" className={`h-11 shrink-0 rounded-full px-5 text-[15px] font-semibold ${CTA[cta]}`}>Start</button>\n          </div>\n        </section>\n        <section className=\"mt-4 rounded-3xl bg-white px-4 shadow-sm ring-1 ring-black/5 dark:bg-zinc-900 dark:ring-white/10\">\n          {ROWS.map(([title, status], n) => (\n            <div key={title}>\n              {n > 0 && <div data-tweak=\"divider\" style={{ height: 1, background: line ? 'rgb(161 161 170 / .35)' : 'transparent' }} />}\n              <div className=\"flex items-center gap-3 py-3.5\">\n                <span data-tweak=\"row-icon\" className=\"grid size-11 place-items-center rounded-xl bg-violet-100 dark:bg-violet-500/20\"><svg width=\"22\" height=\"22\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"#7c3aed\" strokeWidth=\"1.8\" strokeLinecap=\"round\" strokeLinejoin=\"round\"><path d={ICONS[icon]} /></svg></span>\n                <div className=\"min-w-0 flex-1\"><div className=\"text-[15px] font-medium\">{title}</div><div data-tweak={status === 'Changed' ? 'status' : undefined} className=\"text-[13px]\" style={{ color: status === 'Changed' ? tone : undefined }}>{status}</div></div>\n              </div>\n            </div>\n          ))}\n        </section>\n      </div>\n    </main>\n  )\n}\n"

export async function roundChecks({ proto, app, local, openPage, fail }) {
  proto(['add', 'round-check', '--title', 'Round checks', '--variants', 'A:Seven decisions,B:Two decisions,C:One asked'])
  const dir = join(app, 'src/protos/round-check')
  writeFileSync(join(dir, 'A.tsx'), DEMO)
  // Two elements with options: the dots are enough, no round.
  writeFileSync(join(dir, 'B.tsx'), `import { useState } from 'react'
import { useTweaks } from '../../tweaks'
export default function Two() {
  const [a, setA] = useState('One'); const [b, setB] = useState('One')
  useTweaks([{ id: 'a', kind: 'select', label: 'First', value: a, defaultValue: 'One', options: ['One', 'Two'], set: setA }, { id: 'b', kind: 'select', label: 'Second', value: b, defaultValue: 'One', options: ['One', 'Two'], set: setB }])
  return <main className="p-10"><h1 data-tweak="a">{a}</h1><p data-tweak="b">{b}</p></main>
}`)
  // One element, and the agent asks for a round anyway (data-round).
  writeFileSync(join(dir, 'C.tsx'), `import { useState } from 'react'
import { useTweaks } from '../../tweaks'
export default function One() {
  const [a, setA] = useState('One')
  useTweaks([{ id: 'a', kind: 'select', label: 'Only one', value: a, defaultValue: 'One', options: ['One', 'Two', 'Three'], set: setA }])
  return <main className="p-10" data-round><h1 data-tweak="a">{a}</h1></main>
}`)
  const assert = (ok, why) => { if (!ok) fail(`round: ${why}`) }
  // The dev server picks a new prototype up from the disk a moment after it is written (its registry is
  // a glob, refreshed by the file watcher, slow on a busy machine): a page opened before then has no
  // such place. Opened once the registry served has it.
  const registered = async (route, ms = 30000) => {
    let last = ''
    for (const end = Date.now() + ms; Date.now() < end; await wait(150)) {
      try { last = await (await fetch(`${local}src/registry.ts`)).text(); if (last.includes(`/src/protos/${route}.tsx`)) return } catch (e) { last = String(e) }
    }
    const edits = await fetch(`${local}__proto/status`).then(r => r.json()).then(j => JSON.stringify(j.edits)).catch(e => String(e))
    fail(`round: the dev server never listed ${route}: ${[...last.matchAll(/protos\/[^"]+\.tsx/g)].map(m => m[0]).join(', ') || last.slice(0, 120)} (edits it saw: ${edits})`)
  }
  const wait = ms => new Promise(r => setTimeout(r, ms))
  const until = async (page, expression, why, ms = 8000) => {
    for (const end = Date.now() + ms; Date.now() < end; await wait(60)) if (await page.run(expression)) return
    fail(`round: ${why}`)
  }
  const box = (page, sel) => page.run(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 } })()`)
  const dbox = (page, sel) => page.run(`(() => { const el = window.__protoDesign()?.querySelector(${JSON.stringify(sel)}); if (!el) return null; const r = el.getBoundingClientRect(), f = el.ownerDocument.defaultView.frameElement; const o = f ? f.getBoundingClientRect() : { left: 0, top: 0 }, s = f ? o.width / (f.offsetWidth || 1) : 1; return { x: o.left + r.x * s, y: o.top + r.y * s, w: r.width * s, h: r.height * s, cx: o.left + (r.x + r.width / 2) * s, cy: o.top + (r.y + r.height / 2) * s } })()`)
  // Until an element stops moving (a card sliding into place).
  const steady = async (page, sel) => {
    let was = ''
    for (const end = Date.now() + 4000; Date.now() < end; await wait(120)) { const now = JSON.stringify(await box(page, sel)); if (now === was) return; was = now }
  }
  const click = async (page, sel) => { const b = await box(page, sel); assert(b, `nothing to click at ${sel}`); await page.hover(b.cx, b.cy); await page.press(b.cx, b.cy) }
  const tap = async (page, sel) => { const b = await box(page, sel); assert(b, `nothing to tap at ${sel}`); await page.touch('touchStart', [[b.cx, b.cy]]); await page.touch('touchEnd', []) }
  const design = k => `window.__protoDesign()?.querySelector('[data-round-demo]')?.getAttribute('data-${k}')`
  const q = `document.querySelector('[data-round-question]')?.textContent`
  const segs = `[...document.querySelectorAll('[data-round-segment]')].map(s => s.dataset.roundSegment).join(',')`
  const dots = `document.querySelectorAll('[data-option-dot]').length`
  const seen = new Set()
  const batches = () => [...proto(['inbox'], { stdout: true }).matchAll(/batch (\S+)/g)].map(m => m[1])

  for (const v of ['A', 'B', 'C']) await registered(`round-check/${v}`)
  // The tree's tool strip (the project tree on, as the page opens by default).
  const page = await openPage(`${local}round-check/A`, { errors: true, classic: false })
  try {
    await until(page, `!!document.querySelector('[data-round-rest]')`, 'a variant with seven elements with options offers no round')
    assert(await page.run(`/left 7 small decisions/.test(document.querySelector('[data-round-title]')?.textContent ?? '')`), 'the round does not say how many decisions were left')
    assert(await page.run(`${dots} === 0`), 'the dots show beside the round at rest')
    await until(page, `document.querySelector('[data-strip] [data-round-btn] [data-round-count]')?.textContent === '8'`, 'the tool strip has no round button with the 8 open decisions')
    // The stage's Building chip (the variant was just written) starts after the tool strip, never under it.
    const overlap = (a, b) => !!a && !!b && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
    const chip = await box(page, '[data-building-chip]'), strip = await box(page, '[data-strip] [data-strip-tools]')
    assert(chip && strip && !overlap(chip, strip), `the Building chip (or the strip missing) is under the tool strip: ${JSON.stringify({ chip, strip })}`)

    // A step: the question, the spotlight, the tiles; 2 picks the second words and moves on.
    await click(page, '[data-round-rest] [data-round-start]')
    await until(page, `${q} === 'Which words?' && /Step 1 of 7/.test(document.querySelector('[data-round-count]')?.textContent) && !!document.querySelector('[data-round-spotlight]') && document.querySelectorAll('[data-round-card] [data-option-tile]').length === 3`, 'the first step did not open on the heading words with its spotlight and tiles')
    await page.key('2')
    await until(page, `${q} === 'Which heading size?' && ${segs} === 'picked,now,pending,pending,pending,pending,pending,pending'`, 'the 2 key did not pick and move on')
    assert(await page.run(`window.__protoDesign()?.querySelector('[data-copy=heading]')?.textContent === 'Three updates since last time'`), 'the 2 key did not choose the second words')
    // Forward skips, back returns; Enter on a skipped step decides it as it is.
    await page.key('ArrowRight')
    await until(page, `${q} === 'Which hero color?' && ${segs}.startsWith('picked,skipped,now')`, 'the forward arrow did not skip the step')
    assert(await page.run(`[...document.querySelectorAll('[data-round-legend-item]')].map(x => x.dataset.roundLegendItem).join() === 'picked,skipped'`), 'the legend does not name exactly the colors on the bar')
    assert(await page.run(`document.querySelector('[data-round-segment="skipped"]')?.title === 'Heading · Heading size: Skipped'`), 'a segment does not say what it is on hover')
    await page.key('ArrowLeft')
    await until(page, `${q} === 'Which heading size?'`, 'the back arrow did not go to the step before')
    await page.enter()
    await until(page, `${q} === 'Which hero color?' && ${segs}.startsWith('picked,kept,now')`, 'Enter did not decide the step as it is and move on')
    await click(page, '[data-round-card] [data-round-keep]')
    await until(page, `${q} === 'Which new badge?'`, 'Keep as is did not move on')
    await until(page, `document.querySelectorAll('[data-round-card] [data-option-picture]').length >= 2`, 'the badge step has no pictures')
    await click(page, '[data-round-card] [data-option-tile="2"]')
    await until(page, `${q} === 'Which start button style?' && ${segs}.startsWith('picked,kept,kept,picked,now')`, 'a click on a tile did not keep it and move on')
    assert(await page.run(`window.__protoDesign()?.querySelector('[data-tweak=new-badge]')?.textContent === 'New' && /amber/.test(window.__protoDesign()?.querySelector('[data-tweak=new-badge]')?.className)`), 'the clicked badge is not on the design')
    assert(await page.run(`!!document.querySelector('[data-round-card] [data-option-tile] .absolute') && document.querySelector('[data-round-card] [data-option-tile="0"]')?.textContent.includes('1')`), 'the tiles carry no numbers for the keys')
    // Six button styles: one row that scrolls, with its arrow.
    assert(await page.run(`!!document.querySelector('[data-round-card] [data-option-strip]') && !!document.querySelector('[data-round-card] [data-option-next]')`), 'six options are not one row that scrolls with its arrow')
    await click(page, '[data-round-card] [data-round-skip]')
    await until(page, `${q} === 'Which row icon?'`, 'Skip did not move on')

    // Leaving keeps the progress; the strip's button counts what is open.
    await page.key('Escape')
    await until(page, `/Stopped at step 5 of 7/.test(document.querySelector('[data-round-title]')?.textContent ?? '')`, 'Esc did not leave the step for the row at rest, or the row does not say where it stopped')
    await until(page, `document.querySelector('[data-strip] [data-round-btn] [data-round-count]')?.textContent === '3'`, 'the strip button does not count the 3 decisions still open')
    // Put away: the dots come back, the strip's button pulses and brings it back. (The island grows to
    // hold the row, a 500 ms transition: pressed once it has.)
    await wait(700)
    await click(page, '[data-round-rest] [data-round-hide]')
    await until(page, `!document.querySelector('[data-round-rest]') && ${dots} === 7`, 'putting the round away did not bring the dots back')
    assert(await page.run(`/pulse/.test(document.querySelector('[data-strip] [data-round-btn] [data-round-count]')?.className ?? '') && /Bring back the round/.test(document.querySelector('[data-strip] [data-round-btn]')?.getAttribute('aria-label') ?? '')`), 'the strip button does not pulse and offer the round back while it is away')
    await click(page, '[data-strip] [data-round-btn]')
    await until(page, `!!document.querySelector('[data-round-rest]') && ${dots} === 0`, 'the strip button did not bring the round back')

    // A click on an element at rest: see all, with the dots, its panel open, the bar at the top.
    const hero = await dbox(page, '[data-tweak="hero-tone"]')
    await page.hover(hero.x + 30, hero.y + 30); await page.press(hero.x + 30, hero.y + 30)
    await until(page, `!!document.querySelector('[data-round-browse]') && ${dots} === 7 && !!document.querySelector('[data-options-pop]')`, 'a click on an element at rest did not open see all with its panel')
    // The hero's dot and its badge's (just inside the hero's corner) sit apart, each with its own hit area.
    const heroDot = await box(page, '[data-option-dot="tweak:hero-tone"]'), badgeDot = await box(page, '[data-option-dot="tweak:new-badge"]')
    assert(heroDot && badgeDot && (Math.abs(heroDot.cx - badgeDot.cx) >= 21.5 || Math.abs(heroDot.cy - badgeDot.cy) >= 21.5), `the hero's and the badge's dots are on one another: ${JSON.stringify({ heroDot, badgeDot })}`)
    const bar = await box(page, '[data-round-browse]'), stage = await dbox(page, '[data-round-demo]')
    assert(bar.y < stage.y && bar.y + bar.h <= stage.y + 2, `see all's bar covers the design: ${JSON.stringify({ bar, stage })}`)
    await page.key('Escape')
    await until(page, `!document.querySelector('[data-options-pop]') && !!document.querySelector('[data-round-browse]')`, 'Esc did not close the panel first')
    await page.key('Escape')
    await until(page, `!!document.querySelector('[data-round-rest]') && !document.querySelector('[data-round-browse]')`, 'Esc did not leave see all for the row at rest')
    assert(await page.run(`!window.__protoDesign()?.closest('[data-layers] > *')?.style.translate`), 'the design stayed moved after see all')

    // The summary: every decision, numbered when changed; Send posts them, read back with proto inbox.
    await wait(700)
    await click(page, '[data-round-rest] [data-round-to-summary]')
    await until(page, `document.querySelectorAll('[data-round-summary] [data-round-tile]').length === 8`, 'the summary does not list the 8 decisions')
    assert(await page.run(`[...document.querySelectorAll('[data-round-tile]')].map(x => x.dataset.verdict).join() === 'picked,kept,kept,picked,skipped,pending,pending,pending'`), 'the summary tiles do not say what each step came to')
    // Each tile shows its element as it is now, as big as it reads (the heading size and the start
    // button skipped before their pictures were drawn too), and its whole name.
    const pics = await page.run(`['tweak:heading-size', 'tweak:new-badge', 'tweak:cta', 'tweak:row-icon', 'tweak:divider'].map(k => { const p = document.querySelector('[data-round-tile="' + k + '"] [data-round-tile-picture] > span[aria-hidden]'); const r = p?.getBoundingClientRect(); return r && p.innerHTML.length > 20 && (r.width >= 24 || r.height >= 24) ? '' : k }).filter(Boolean).join()`)
    assert(pics === '', `summary tiles without a picture that reads: ${pics}`)
    assert(await page.run(`[...document.querySelectorAll('[data-round-tile] [data-round-tile-picture] + span')].every(l => l.scrollHeight <= l.clientHeight + 1 && l.scrollWidth <= l.clientWidth + 1)`), 'a summary tile cuts its name short')
    // (Pressed once the card has settled: it slides down while the island lets go of the row.)
    await steady(page, '[data-round-tile="tweak:row-icon"]')
    await click(page, '[data-round-tile="tweak:row-icon"]')
    for (const end = Date.now() + 8000; Date.now() < end && await page.run(`${q} !== 'Which row icon?'`);) await wait(60)
    if (await page.run(`${q} !== 'Which row icon?'`)) fail(`round: a summary tile did not open its step (${await page.run(`JSON.stringify({ card: document.querySelector('[data-round-card]')?.dataset.roundCard, q: ${q}, tiles: document.querySelectorAll('[data-round-tile]').length })`)})`)
    await page.key('5')
    await until(page, `!!document.querySelector('[data-round-summary]')`, 'a step opened from the summary did not return to it')
    await until(page, `${design('icon')} === 'Bolt'`, 'the 5 key did not pick the fifth icon')
    for (const id of batches()) seen.add(id)
    await click(page, '[data-round-summary] [data-options-send]')
    await until(page, `!document.querySelector('[data-round-summary]') && !!document.querySelector('[data-options-sending]')`, 'Send in the summary did not send and close it')
    let inbox = ''
    for (let i = 0; i < 40 && !/new-badge/.test(inbox); i++) { inbox = proto(['inbox'], { stdout: true }); if (!/new-badge/.test(inbox)) await wait(250) }
    assert(/New badge \(useTweaks new-badge\): “Tag”/.test(inbox) && /Row icon \(useTweaks row-icon\): “Bolt”/.test(inbox), 'the summary sent no option comments for the badge and the row icon')
    assert(/Heading \(heading\): “Three updates since last time”/.test(inbox) && (inbox.match(/action: option/g) || []).length === 2, 'the summary did not send exactly the changed values')
    // Sent and not yet done: a step's digit keys and Keep as is change nothing.
    const cta0 = await page.run(design('cta'))
    await page.run(`document.__prototypeComments.options.round.go('tweak:cta')`)
    await until(page, `${q} === 'Which start button style?'`, 'the step did not open while sent')
    // (Its pictures drawn first: drawing shows each option on the element for a moment.)
    const drawn = `document.querySelectorAll('[data-round-card] [data-option-picture]').length >= 6 && !document.querySelector('[data-option-cover]')`
    await until(page, drawn, 'the start button step did not draw its pictures while sent')
    await page.key('2'); await wait(700)
    await until(page, drawn, 'the start button step is still drawing')
    assert(await page.run(`${design('cta')} === ${JSON.stringify(cta0)}`), 'a digit key changed a value after Send')
    await page.key('Escape')
    await until(page, `!document.querySelector('[data-round-card]')`, 'Esc did not leave the step while sent')
    for (const id of [...inbox.matchAll(/batch (\S+)/g)].map(m => m[1])) proto(['reply', id, 'Set', '--done'])
    assert(page.errors().length === 0, `the page reported errors: ${page.errors().join(' | ')}`)
  } finally { page.close() }

  // A step's keys yield to a focused control, Esc to what is over the round, and the round's row to
  // focus mode; a hot reload mid-step keeps the spotlight on the element.
  const keys = await openPage(`${local}round-check/A`, { classic: false })
  try {
    await until(keys, `!!document.querySelector('[data-round-rest] [data-round-start]')`, 'the second page has no round')
    await click(keys, '[data-round-rest] [data-round-start]')
    await until(keys, `${q} === 'Which words?' && document.querySelectorAll('[data-round-card] [data-option-tile]').length === 3`, 'the round did not start on the second page')
    const words0 = await keys.run(`window.__protoDesign()?.querySelector('[data-copy=heading]')?.textContent`)
    // A shell control with the focus keeps the digits.
    await keys.run(`document.querySelector('[data-strip] [data-round-btn]').focus()`)
    await keys.key('3'); await wait(500)
    assert(await keys.run(`${q} === 'Which words?' && window.__protoDesign()?.querySelector('[data-copy=heading]')?.textContent === ${JSON.stringify(words0)}`), 'a digit picked an option while a shell control had the focus')
    // Enter on the card's own Skip skips; on a tile, picks it.
    await keys.run(`document.querySelector('[data-round-card] [data-round-skip]').focus()`)
    await keys.enter()
    await until(keys, `${q} === 'Which heading size?' && ${segs}.startsWith('skipped,now')`, 'Enter on a focused Skip did not skip')
    await until(keys, `document.querySelectorAll('[data-round-card] [data-option-tile]').length === 3`, 'the heading size step has no tiles')
    await keys.run(`document.querySelector('[data-round-card] [data-option-tile="2"]').focus()`)
    await keys.enter()
    await until(keys, `${design('size')} === 'Large' && ${q} === 'Which hero color?'`, 'Enter on a focused tile did not pick it and move on')
    await keys.run(`document.activeElement?.blur()`)
    // Esc with the shell's settings open closes them; the step stays.
    await click(keys, '[data-bar] [data-act="open:more"]')
    await until(keys, `!!document.querySelector('[data-pop] [data-act="settings"]')`, 'the More menu did not open')
    await click(keys, '[data-pop] [data-act="settings"]')
    await until(keys, `!!document.querySelector('[data-settings-dialog]')`, 'the settings did not open')
    await keys.key('Escape')
    await until(keys, `!document.querySelector('[data-settings-dialog]')`, 'Esc did not close the settings over the round')
    assert(await keys.run(`document.querySelector('[data-round-card]')?.dataset.roundCard === 'step'`), 'Esc left the round step instead of closing the settings over it')
    // In comment mode the round hides; Esc ends commenting, and the step comes back as it was.
    await click(keys, '[data-island] [data-shoot="comment"]')
    await until(keys, `!document.querySelector('[data-round-card]')`, 'the step did not hide in comment mode')
    await keys.key('Escape')
    await until(keys, `document.querySelector('[data-island] [data-shoot="comment"]')?.getAttribute('aria-pressed') !== 'true' && document.querySelector('[data-round-card]')?.dataset.roundCard === 'step'`, 'Esc in comment mode went to the hidden round, or the step did not come back')
    // A hot reload that draws the design anew: the spotlight finds the element again.
    writeFileSync(join(dir, 'A.tsx'), DEMO.replace('<main data-round-demo', '<main key="again" data-round-demo'))
    await wait(2500)
    await until(keys, `(() => { const sp = document.querySelector('[data-round-spotlight]')?.getBoundingClientRect(), el = window.__protoDesign()?.querySelector('[data-tweak="hero-tone"]'); if (!sp || !el?.isConnected) return false; const f = el.ownerDocument.defaultView.frameElement, o = f ? f.getBoundingClientRect() : { left: 0, top: 0 }, s = f ? o.width / (f.offsetWidth || 1) : 1, r = el.getBoundingClientRect(); return Math.abs(sp.left + 6 - (o.left + r.left * s)) < 3 && Math.abs(sp.top + 6 - (o.top + r.top * s)) < 3 })()`, 'the spotlight lost the element after a hot reload')
    // Focus mode hides the island: with the round at rest, the dots come back; out of it, they wait again.
    await keys.key('Escape')
    await until(keys, `!!document.querySelector('[data-round-rest]') && ${dots} === 0`, 'Esc did not leave the step for the row')
    await keys.key('f')
    await until(keys, `${dots} === 7`, 'focus mode with the round at rest left no dots')
    await keys.key('f')
    await until(keys, `!!document.querySelector('[data-round-rest]') && ${dots} === 0`, 'out of focus mode the round did not come back')
    // With the row at rest (the dots waiting), the right-click menu still opens an element's panel beside it.
    const menu = await keys.run(`(async () => {
      const until = async f => { for (const end = Date.now() + 6000; Date.now() < end; await new Promise(r => setTimeout(r, 50))) if (f()) return true; return false }
      const el = window.__protoDesign()?.querySelector('[data-tweak="cta"]'), r = el.getBoundingClientRect()
      el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, composed: true, button: 2, clientX: r.left + 4, clientY: r.top + r.height / 2 }))
      if (!await until(() => [...document.querySelectorAll('[data-context-menu] [role=menuitem]')].some(x => /Options for this element/.test(x.textContent)))) return 'its menu has no Options for this element'
      ;[...document.querySelectorAll('[data-context-menu] [role=menuitem]')].find(x => /Options for this element/.test(x.textContent)).click()
      return await until(() => { const p = document.querySelector('[data-options-pop]'); return p && getComputedStyle(p).opacity !== '0' && p.getBoundingClientRect().width > 100 }) ? 'ok' : 'no panel showed'
    })()`)
    assert(menu === 'ok', `the right-click menu with the round at rest: ${menu}`)
    assert(keys.errors().length === 0, `the page reported errors: ${keys.errors().join(' | ')}`)
  } finally { keys.close() }

  // Two elements: dots, no round. One with data-round: a round.
  const two = await openPage(`${local}round-check/B`, { classic: false })
  try {
    await until(two, `${dots} === 2`, 'the two elements have no dots')
    await wait(800)
    assert(await two.run(`!document.querySelector('[data-round-rest]') && !document.querySelector('[data-round-btn]')`), 'two elements with options offer a round')
  } finally { two.close() }
  const one = await openPage(`${local}round-check/C`, { classic: false })
  try {
    await until(one, `/left 1 small decision$/.test(document.querySelector('[data-round-title]')?.textContent ?? '')`, 'data-round did not offer a round on one element, or "1 decisions"')
  } finally { one.close() }
  // A still never has a round, even with the dots.
  const still = await openPage(`${local}round-check/A?hints=0&options=1`)
  try {
    await until(still, `${dots} >= 7`, 'the still has no dots with ?options=1')
    assert(await still.run(`!document.querySelector('[data-round-rest], [data-round-card], [data-round-btn]')`), 'a still shows the round')
  } finally { still.close() }

  // A phone: the round's row on the island, a tap tries an option and Next moves on; put away, its
  // button waits in the bottom bar.
  const phone = await openPage(`${local}round-check/A`, { width: 390, height: 844, phone: true, classic: false })
  try {
    await phone.run(`sessionStorage.clear()`)
    await until(phone, `!!document.querySelector('[data-round-rest] [data-round-start]')`, 'the phone has no round row')
    await tap(phone, '[data-round-rest] [data-round-start]')
    await until(phone, `!!document.querySelector('[data-round-card] [data-option-tile]')`, 'the phone round did not start')
    await tap(phone, '[data-round-card] [data-option-tile="2"]')
    await until(phone, `!!document.querySelector('[data-round-card] [data-round-next]')`, 'a tap on a phone tile did not offer Next')
    const q0 = await phone.run(q)
    await tap(phone, '[data-round-card] [data-round-next]')
    await until(phone, `${q} !== ${JSON.stringify(q0)}`, 'Next did not move on')
    await tap(phone, '[data-round-card] [data-round-close]')
    await until(phone, `!!document.querySelector('[data-round-rest] [data-round-hide]')`, 'closing the step did not return to the row')
    await tap(phone, '[data-round-rest] [data-round-hide]')
    await until(phone, `!!document.querySelector('[data-pill] [data-round-btn]')`, 'the phone bottom bar has no button for the round put away')
    await tap(phone, '[data-pill] [data-round-btn]')
    await until(phone, `!!document.querySelector('[data-round-rest]')`, 'the bottom bar button did not bring the round back')
  } finally { phone.close() }

  // The composer's choice: kept with the comment, printed by proto inbox; refused on an action.
  const com = await openPage(`${local}round-check/B`)
  try {
    await until(com, `${dots} === 2`, 'the composer page did not draw')
    // The island's select tool, then the element.
    await click(com, '[data-island] [data-shoot="comment"]')
    await until(com, `document.querySelector('[data-island] [data-shoot="comment"]')?.getAttribute('aria-pressed') === 'true'`, 'the island select tool did not turn on')
    const h = await dbox(com, 'h1')
    await com.hover(h.x + 10, h.cy); await com.press(h.x + 10, h.cy)
    await until(com, `!!document.querySelector('[data-composer] [data-composer-ask]')`, 'the composer on an element has no choice of how to answer')
    assert(await com.run(`document.querySelector('[data-composer-ask] [aria-checked=true]')?.dataset.ask === 'agent' && /decides from your words/.test(document.querySelector('[data-composer-ask-line]')?.textContent ?? '')`), 'the composer does not default to the agent deciding, saying how')
    // Left to the agent (the default): plain feedback goes with no choice, and proto inbox prints none.
    await com.run(`(() => { const e = document.querySelector('[data-composer] [contenteditable]'); e.focus(); document.execCommand('insertText', false, 'typo here'); })()`)
    await com.key('Enter', ['Meta'])
    let plain = ''
    for (let i = 0; i < 40 && !/typo here/.test(plain); i++) { plain = proto(['inbox'], { stdout: true }); if (!/typo here/.test(plain)) await wait(250) }
    assert(/typo here/.test(plain) && !/answer as:/.test(plain), `proto inbox prints a way to answer on a comment left to the agent: ${plain.slice(0, 600)}`)
    for (const id of [...plain.matchAll(/batch (\S+)/g)].map(m => m[1])) proto(['reply', id, 'Fixed', '--done'])
    await until(com, `document.querySelector('[data-island] [data-shoot="comment"]')?.getAttribute('aria-pressed') !== 'true' || !document.querySelector('[data-composer]')`, 'the composer did not close after sending')
    if (await com.run(`document.querySelector('[data-island] [data-shoot="comment"]')?.getAttribute('aria-pressed') !== 'true'`)) await click(com, '[data-island] [data-shoot="comment"]')
    await until(com, `document.querySelector('[data-island] [data-shoot="comment"]')?.getAttribute('aria-pressed') === 'true'`, 'the island select tool did not turn on again')
    await com.hover(h.x + 10, h.cy); await com.press(h.x + 10, h.cy)
    await until(com, `!!document.querySelector('[data-composer] [data-composer-ask]')`, 'the second composer on the element has no choice of how to answer')
    await click(com, '[data-composer-ask] [data-ask="variants"]')
    await com.run(`(() => { const e = document.querySelector('[data-composer] [contenteditable]'); e.focus(); document.execCommand('insertText', false, 'A few directions for this'); })()`)
    await com.key('Enter', ['Meta'])
    let inbox = ''
    for (let i = 0; i < 40 && !/answer as:/.test(inbox); i++) { inbox = proto(['inbox'], { stdout: true }); if (!/answer as:/.test(inbox)) await wait(250) }
    assert(/A few directions for this[\s\S]*answer as: variants, as the user chose/.test(inbox), `proto inbox does not print the composer's choice: ${inbox.slice(0, 600)}`)
    for (const id of [...inbox.matchAll(/batch (\S+)/g)].map(m => m[1])) proto(['reply', id, 'Noted', '--done'])
  } finally { com.close() }
  const refused = await fetch(`${local}__proto/comments`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ comments: [{ route: 'round-check/A', text: 'x', action: 'more', ask: 'options' }] }) })
  assert(refused.status >= 400, 'the server kept a choice of how to answer on an action')
  const bad = await fetch(`${local}__proto/comments`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ comments: [{ route: 'round-check/A', text: 'x', target: { selector: 'h1', tag: 'h1', text: '', rect: { x: 0, y: 0, w: 1, h: 1 } }, ask: 'maybe' }] }) })
  assert(bad.status >= 400, 'the server kept an unknown choice of how to answer')
  console.log('OK: round of decisions')
}
