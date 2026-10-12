#!/usr/bin/env node
// Screenshot places in a prototype session at desktop and phone size: the stage only (the
// design, or a lobby's grid), without the page's sidebar, bars and floating controls.
// Usage: shoot.mjs <app-url> <out-dir> <route...> [--theme=dark] [--focus=1] [--copy=1] [--click=<css>]... [--ref=<png> [--as=built]] [--phone=<slug,…>] [--sheet=<json>] [--size=<w>x<h>]
// Routes are the page's hash routes: "/" (session lobby), "hero" (a prototype's lobby),
// "hero/A" (one variant), "hero/A/open" (a state from its meta). Files are named
// hero-A-desktop.png, hero-A-mobile-dark.png …
// Normally run through `proto shoot`, which fills in the URL and folder.
//
// --ref=<png> (a screenshot of the real screen) shoots, per route, only the variant's screen alone
// (hero-A-screen.png: a phone at 3x without its bezel, a web stage at 2x) and a contact sheet
// (hero-A-vs-ref.png): the variant, the reference, and the two laid over each other.
// With --as=built the png is the feature as built in the codebase: the sheet labels it Built and
// is written as hero-A-vs-built.png, so Current's -vs-ref.png is still there to compare.
//
// --sheet=<json> (written by `proto shoot --sheet`) lists prototypes, each with its variants'
// routes. After the single shots, each prototype gets one contact sheet (hero-sheet.png): a
// labelled column per variant, desktop above phone. It prints the sheets and one line about the
// singles instead of every file, so a round is one image to read, not two per variant.
//
// --copy=1 opens copy mode on a design that declares copy options (useCopy): its lines' marks, and
// the bar under the stage, which the shot takes in. A --click on a line ([data-copy=headline]) lists
// its options, and a --click on one of them ([data-copy-option="1"]) puts it in place.
//
// --at=<ms> (a variant that declares its motion with useMotion) records its take from rest, the way
// the page's motion dock does, and shoots that moment of it (hero-A-desktop-at-350.png). --frames=<n>
// shoots n moments evenly over the take (or over --at=<a>-<b>), cut to where the motion happens, and
// lays them out on one sheet with their times and the take's curves under them (hero-A-frames.png).
//
// --phone lists the phone prototypes: their variants are shot at phone size only, where the phone
// shows larger than in the desktop shell. Their lobbies still get both.
//
// --size=<w>x<h> shoots at that one viewport instead (hero-A-834x1194.png), the way the page's
// device view shows a tablet or a desktop: a web prototype's stage at that width, no phone frame.
//
// Drives Chrome over the DevTools protocol so the phone shot is a real 390px mobile
// viewport, and waits for the page to say it is ready instead of sleeping.
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { startChrome, stopChrome } from './chrome.mjs'

const args = process.argv.slice(2)
const flags = Object.fromEntries(args.filter(a => a.startsWith('--') && !a.startsWith('--click=')).map(a => a.slice(2).split('=')))
const clicks = args.filter(a => a.startsWith('--click=')).map(a => a.slice(8))
const [rawUrl, outDir, ...routes] = args.filter(a => !a.startsWith('--'))
if (!rawUrl || !outDir || routes.length === 0) {
  console.error('usage: shoot.mjs <app-url> <out-dir> <route...> [--theme=dark] [--focus=1]')
  process.exit(1)
}

// At the scale Claude Code shows them: it shrinks an image to 2000 px on its long side, which
// for the whole window was 2000 / 1440 desktop and 2000 / 844 phone. Cropped to the stage at the
// same scale, a design keeps the detail it had and the shell's pixels are no longer paid for.
// With --size, that viewport alone, for every route (a phone prototype's variants too), a phone's
// below 640 px wide.
const sized = String(flags.size ?? '').match(/^(\d+)x(\d+)$/)
const SIZES = sized
  ? [{ name: `${sized[1]}x${sized[2]}`, width: +sized[1], height: +sized[2], deviceScaleFactor: 2000 / Math.max(+sized[1], +sized[2]), mobile: +sized[1] < 640, every: true }]
  : [
      { name: 'desktop', width: 1440, height: 900, deviceScaleFactor: 2000 / 1440, mobile: false },
      { name: 'mobile', width: 390, height: 844, deviceScaleFactor: 2000 / 844, mobile: true },
    ]
const base = new URL(rawUrl)
base.hash = ''
base.searchParams.set('theme', flags.theme === 'dark' ? 'dark' : 'light') // headless Chrome may report a dark system theme
base.searchParams.set('hints', '0') // the Try it panel would narrow the design
if (flags.focus) base.searchParams.set('focus', '1')
if (flags.copy) base.searchParams.set('copy', '1')
const suffix = [flags.focus && 'focus', flags.copy && 'copy', flags.theme === 'dark' && 'dark', clicks.length && 'clicked'].filter(Boolean).map(s => `-${s}`).join('')
const fileOf = route => route.replace(/^\/+|\/+$/g, '').replace(/\//g, '-') || 'session'
const phones = new Set(String(flags.phone || '').split(',').filter(Boolean))
const phoneOnly = route => { const [slug, variant] = route.replace(/^\/+/, '').split('/'); return !!variant && phones.has(slug) }
// What the --ref png is: a screenshot of the real screen, or of the variant once it is built.
const vs = flags.as === 'built' ? { label: 'Built', name: 'vs-built' } : { label: 'Reference', name: 'vs-ref' }

// Contact sheets are held to the same 2000 px, on both sides: Claude Code would shrink a bigger
// one, throwing away the detail it exists for. A column narrower than MIN_COL shows too little
// (a phone shot at about 0.7x, a desktop one at a quarter), so past that the variants go on to
// a second sheet instead.
const SHEET = 2000, PAD = 24, GAP = 20, HEAD = 48, LABEL = 36, INNER = 8, MIN_COL = 280
const sheets = flags.sheet ? JSON.parse(readFileSync(flags.sheet, 'utf8')) : null
const taken = new Map() // route → its single shots, desktop first, for the sheets
const esc = s => String(s).replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`)
// The widest column n variants can have: every row count is tried, and each is held to what the
// sheet's width and its height allow. ratio is a column's image height per px of its width,
// fixed its label and gaps, most the narrowest shot's own width (never scaled up).
const fit = (n, ratio, fixed, most, high = SHEET) => {
  let best = { w: 0, cols: 1 }
  for (let rows = 1; rows <= n; rows++) {
    const cols = Math.ceil(n / rows)
    const w = Math.floor(Math.min(most, (SHEET - 2 * PAD - (cols - 1) * GAP) / cols, (high - 2 * PAD - HEAD - rows * fixed - (rows - 1) * GAP) / rows / ratio))
    if (w > best.w) best = { w, cols }
  }
  return best
}

mkdirSync(outDir, { recursive: true })
// Tabs shooting at once. Measured on a 7-variant sheet (14 shots): 8.8 s one after the other, 4.7-4.9 s four at a time.
const TABS = 4
const profile = mkdtempSync(join(tmpdir(), 'proto-shoot-'))
const chrome = startChrome([`--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--hide-scrollbars'])
const cleanup = () => {
  stopChrome(chrome)
  // Chrome can still be writing its profile for a moment after the kill.
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }) } catch { /* temp dir, the OS clears it */ }
}
// A long sheet run (every prototype in a session) gets more time; the usual calls keep 3 minutes.
const timer = setTimeout(() => { console.error('shoot: timed out'); cleanup(); process.exit(1) }, Math.max(180_000, routes.length * 6_000))
// Chrome has a process group of its own, so a stop that reaches only this script must take it along.
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { cleanup(); process.exit(1) })

try {
  const wsUrl = await new Promise((ok, fail) => {
    let buf = ''
    chrome.stderr.on('data', d => { buf += d; const m = buf.match(/DevTools listening on (ws:\/\/\S+)/); if (m) ok(m[1]) })
    chrome.on('exit', () => fail(new Error('Chrome exited before DevTools was ready')))
  })
  const ws = new WebSocket(wsUrl)
  await new Promise((ok, fail) => { ws.onopen = ok; ws.onerror = fail })
  let nextId = 0
  const pending = new Map()
  ws.onmessage = e => {
    const msg = JSON.parse(e.data)
    if (msg.id && pending.has(msg.id)) {
      const { ok, fail } = pending.get(msg.id)
      pending.delete(msg.id)
      msg.error ? fail(new Error(msg.error.message)) : ok(msg.result)
    }
  }
  const send = (method, params = {}, sessionId) => new Promise((ok, fail) => {
    const id = ++nextId
    pending.set(id, { ok, fail })
    ws.send(JSON.stringify({ id, method, params, sessionId }))
  })
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  // A --click reaches inside the stage, and the copy picker's list of a line's options.
  const clickIn = sel => `(() => { const el = document.querySelector('[data-layers]').querySelector(${JSON.stringify(sel)}) ?? document.querySelector('[data-copy-list]')?.querySelector(${JSON.stringify(sel)}); el?.click(); return !!el })()`
  // With --copy, waits until the bar under the stage has slid in and stopped growing (at most 2 s),
  // and says whether copy mode is on. A design with no copy options (no [data-copy]) has no copy
  // mode: no wait, and its shot is named as one at rest, with one line saying so.
  const plain = new Set()
  const copied = async (sessionId, route) => {
    if (!flags.copy) return false
    const { result } = await send('Runtime.evaluate', { awaitPromise: true, returnByValue: true, expression: `(async () => {
      if (!document.querySelector('[data-layers] [data-copy]')) return false
      const frame = () => new Promise(r => requestAnimationFrame(r)), end = performance.now() + 2000
      let h = -1, still = 0
      while (performance.now() < end && still < 6) {
        const b = document.querySelector('[data-copy-bar]')?.getBoundingClientRect().height ?? 0
        still = b > 0 && b === h ? still + 1 : 0
        h = b
        await frame()
      }
      return true
    })()` }, sessionId)
    if (!result.value && !plain.has(route)) { plain.add(route); console.error(`shoot: ${route} has no copy options (no [data-copy]), so it is shot without --copy`) }
    return result.value
  }
  // Waits, at most 400 ms, until the page's images are in and nothing is still moving (the
  // first crossfade, a design's entrance), then two frames. The first 200 ms always pass, so a
  // reveal a design starts from a timer has begun by the time it is looked for. Looping
  // animations (a spinner, a pulsing placeholder) never finish, so they don't count.
  const settle = sessionId => send('Runtime.evaluate', { awaitPromise: true, expression: `(async () => {
    const frame = () => new Promise(r => requestAnimationFrame(r)), end = performance.now() + 400
    await new Promise(r => setTimeout(r, 200))
    while (performance.now() < end) {
      const moving = document.getAnimations().some(a => a.playState === 'running' && a.effect?.getComputedTiming().iterations !== Infinity)
      if (!moving && [...document.images].every(i => i.complete)) break
      await frame()
    }
    await frame(); await frame()
  })()` }, sessionId)
  // Renders a page of local images to one PNG: a tab of its own, every image decoded first, the
  // whole page captured however tall it is. Every path in the page goes through pathToFileURL.
  const compose = async (html, file, width, height) => {
    const page = join(dirname(file), `.${basename(file, '.png')}.html`)
    writeFileSync(page, html)
    const t = await send('Target.createTarget', { url: 'about:blank' })
    const { sessionId: sid } = await send('Target.attachToTarget', { targetId: t.targetId, flatten: true })
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }, sid)
    await send('Page.navigate', { url: pathToFileURL(page).href }, sid)
    const { result: size } = await send('Runtime.evaluate', { awaitPromise: true, returnByValue: true, expression: `(async () => {
      while (document.readyState !== 'complete') await new Promise(r => setTimeout(r, 50))
      await Promise.all([...document.images].map(i => i.decode()))
      return [document.body.scrollWidth, document.body.scrollHeight]
    })()` }, sid)
    const [w, h] = size.value
    const sheet = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: w, height: h, scale: 1 }, captureBeyondViewport: true }, sid)
    writeFileSync(file, Buffer.from(sheet.data, 'base64'))
    rmSync(page)
    await send('Target.closeTarget', { targetId: t.targetId })
  }

  // The motion: a take recorded in the page, then set to each moment and shot.
  const motion = flags.at !== undefined || flags.frames !== undefined
  for (const route of motion ? routes : []) {
    const many = Number(flags.frames || 0)
    const [from, to] = flags.at === undefined ? [] : String(flags.at).split('-').map(Number)
    // One moment is shot as any shot is; frames at one size (a phone prototype's phone, else desktop).
    for (const size of many ? [phoneOnly(route) ? SIZES[1] : SIZES[0]] : SIZES.filter(z => z.mobile || !phoneOnly(route))) {
      const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
      const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
      await send('Emulation.setDeviceMetricsOverride', { width: size.width, height: size.height, deviceScaleFactor: size.deviceScaleFactor, mobile: size.mobile }, sessionId)
      if (size.mobile) await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }, sessionId)
      const url = new URL(base)
      url.hash = '/' + route.replace(/^\/+/, '')
      await send('Page.navigate', { url: url.href }, sessionId)
      for (let i = 0; i < 100; i++) {
        const { result } = await send('Runtime.evaluate', { expression: 'document.documentElement?.dataset.ready === "1"', returnByValue: true }, sessionId)
        if (result.value) break
        await sleep(100)
      }
      // With --copy, as any shot: copy mode on once its bar is in, or named as one at rest, saying so.
      const copyOn = await copied(sessionId, route), sfx = flags.copy && !copyOn ? suffix.replace('-copy', '') : suffix
      await settle(sessionId)
      const page = async expression => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId)).result?.value
      for (const sel of clicks) {
        if (!await page(clickIn(sel))) console.error(`shoot: nothing matches ${sel} on ${route}`)
        await sleep(400)
      }
      // The design declares its motion once it is mounted: wait for that, a few seconds at most (a slow
      // machine takes a while).
      for (let i = 0; i < 50 && !await page('!!window.__protoMotion?.state()'); i++) await sleep(100)
      const take = await page('window.__protoMotion ? window.__protoMotion.take() : { error: "this page has no motion dock (a session app made before it?)" }')
      if (take?.error || take?.status !== 'ready') {
        console.error(`shoot: ${route}: ${take?.error || 'the take caught no motion. Only CSS transitions, CSS animations and element.animate() can be recorded, not motion run from script (requestAnimationFrame, react-spring, GSAP)'}`)
        process.exitCode = 1
        await send('Target.closeTarget', { targetId })
        break
      }
      const D = take.duration
      const a = Math.min(from ?? 0, D), b = Math.min(to ?? D, D)
      if ((from ?? 0) > D || (to ?? 0) > D) console.error(`shoot: ${route}: its take is ${D} ms, so ${flags.at} is held at its end`)
      const times = many ? Array.from({ length: many }, (_, i) => Math.round(a + (i * (b - a)) / (many - 1))) : [a]
      // What is shot: the stage, with the copy picker's bar under it in copy mode (as any shot), or
      // for frames where the motion happens in it: a phone prototype's phone, else every moving
      // part's box at its start, middle and end, with a margin.
      const stage = await page(`(() => { document.querySelector('[data-overlay]')?.style.setProperty('display', 'none'); const r = document.querySelector('[data-layers]').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height } })()`)
      const bar = copyOn ? await page(`document.querySelector('[data-copy-bar]')?.getBoundingClientRect().height ?? 0`) : 0
      let cut = { ...stage, h: stage.h + bar }
      if (many) {
        const box = phoneOnly(route) ? await page(`(() => { const r = document.querySelector('[data-layers] [data-phone]')?.getBoundingClientRect(); return r && { x: r.x, y: r.y, w: r.width, h: r.height } })()`) : await page('window.__protoMotion.box()')
        if (box) {
          const m = 24, x0 = Math.max(stage.x, box.x - m), y0 = Math.max(stage.y, box.y - m)
          cut = { x: x0, y: y0, w: Math.min(stage.x + stage.w, box.x + box.w + m) - x0, h: Math.min(stage.y + stage.h, box.y + box.h + m) - y0 }
        }
      }
      const shots = []
      for (const t of times) {
        await page(`window.__protoMotion.seek(${t})`)
        const { data } = await send('Page.captureScreenshot', { format: 'png', clip: { x: cut.x, y: cut.y, width: cut.w, height: cut.h, scale: 1 } }, sessionId)
        const file = resolve(outDir, `${fileOf(route)}-${size.name}-at-${t}${sfx}.png`)
        writeFileSync(file, Buffer.from(data, 'base64'))
        shots.push({ t, file })
        if (!many) console.log(file)
      }
      const curves = many && await page('window.__protoMotion.curves(120)')
      const late = await page('window.__protoMotion.state()?.late ?? null')
      if (late !== null) console.error(`shoot: ${route}: something started ${late} ms in, after the take had ended (it ends after 0.5 s with nothing moving), so these shots miss it: put the wait before it in a delay (transition-delay, animation-delay or element.animate's delay)`)
      await send('Target.closeTarget', { targetId })
      if (!many) continue
      // The sheet: the frames in order with their times, then the take's curves on the same clock,
      // the frames' moments marked on it, and the range they cover shaded when it is one.
      const CURVES = 330, { w, cols } = fit(shots.length, cut.h / cut.w, LABEL + INNER, cut.w * size.deviceScaleFactor, SHEET - CURVES - GAP)
      const width = cols * w + (cols - 1) * GAP, plotW = width - 260, top = 22, floor = CURVES - 30
      const ymax = Math.max(1.15, ...curves.tracks.flatMap(tr => tr.lines.flatMap(l => l.map(([, v]) => v + 0.05))))
      const X = t => 8 + (t / D) * (plotW - 16), Y = v => floor - (v / ymax) * (floor - top)
      const path = pts => `M${pts.map(([t, v]) => `${X(t).toFixed(1)},${Y(v).toFixed(1)}`).join('L')}`
      const svg = `<svg width="${plotW}" height="${CURVES}" style="flex:none;display:block;overflow:visible">
        ${flags.at === undefined ? '' : `<rect x="${X(a)}" y="${top - 10}" width="${Math.max(2, X(b) - X(a))}" height="${floor - top + 10}" fill="#6366f1" fill-opacity=".14"/>`}
        <line x1="${X(0)}" x2="${X(D)}" y1="${Y(1)}" y2="${Y(1)}" stroke="#52525b" stroke-dasharray="4 4"/>
        <line x1="${X(0)}" x2="${X(D)}" y1="${Y(0)}" y2="${Y(0)}" stroke="#3f3f46"/>
        ${shots.map(({ t }, i) => `<line x1="${X(t)}" x2="${X(t)}" y1="${top - 10}" y2="${floor}" stroke="#a1a1aa" stroke-opacity=".45"/><text x="${X(t)}" y="${floor + 22}" fill="#a1a1aa" font-size="15" text-anchor="middle">${i + 1}</text>`).join('')}
        ${curves.tracks.map(tr => tr.lines.map((l, i) => `<path d="${path(l)}" fill="none" stroke="${tr.color}" stroke-width="${i ? 2 : 3}" stroke-opacity="${i ? 0.55 : 1}" stroke-linecap="round" stroke-linejoin="round"/>`).join('')).join('')}
        <text x="${X(0)}" y="${top - 2}" fill="#a1a1aa" font-size="15">0 s</text><text x="${X(D)}" y="${top - 2}" fill="#a1a1aa" font-size="15" text-anchor="end">${(D / 1000).toFixed(2)} s</text></svg>`
      const legend = curves.tracks.map(tr => `<div style="display:flex;gap:8px;align-items:center;white-space:nowrap;overflow:hidden"><span style="flex:none;width:16px;height:3px;border-radius:2px;background:${tr.color}"></span><span dir="auto" style="overflow:hidden;text-overflow:ellipsis">${esc(tr.name)} <span style="color:#a1a1aa">${esc(tr.props)}</span></span></div>`).join('')
      const cell = ({ t, file }, i) => `<figure style="margin:0;width:${w}px"><figcaption style="height:${LABEL}px;display:flex;align-items:center;gap:10px"><b>${i + 1}</b><span style="color:#d4d4d8">${(t / 1000).toFixed(2)} s</span></figcaption><img src="${pathToFileURL(file).href}" style="display:block;width:${w}px;margin-top:${INNER}px;outline:1px solid #3f3f46"></figure>`
      const head = `${route} · ${many} frames, ${(a / 1000).toFixed(2)}–${(b / 1000).toFixed(2)} s of a ${(D / 1000).toFixed(2)} s take`
      const html = `<!doctype html><meta charset="utf-8"><body style="margin:0;padding:${PAD}px;width:max-content;background:#18181b;color:#fafafa;font:500 22px/1.2 system-ui,sans-serif">
        <div style="width:${width}px;height:${HEAD}px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600">${esc(head)}</div>
        <div style="display:grid;grid-template-columns:repeat(${cols},${w}px);gap:${GAP}px;align-items:start">${shots.map(cell).join('')}</div>
        <div style="display:flex;gap:16px;margin-top:${GAP}px;width:${width}px;font-size:16px">${svg}<div style="display:flex;flex-direction:column;gap:10px;min-width:0;padding-top:${top}px">${legend}</div></div></body>`
      const file = resolve(outDir, `${fileOf(route)}-frames${flags.at === undefined ? '' : `-${a}-${b}`}${sfx}.png`)
      await compose(html, file, width + 2 * PAD, SHEET)
      console.log(file)
      console.log(`${shots.length} frames in ${resolve(outDir)} (${basename(shots[0].file)} …): open one only for a detail`)
    }
  }
  // Every shot is a fresh tab, and most of its time is the page loading and settling, not Chrome
  // working, so a few run at once. They are listed, and their sheet columns kept, in the order the
  // loop used to take them (desktop before phone), whichever tab finishes first.
  const jobs = (flags.ref || motion ? [] : SIZES).flatMap((size, order) =>
    routes.filter(r => size.mobile || size.every || !phoneOnly(r)).map(route => ({ size, route, order })))
  const printed = []
  const shootOne = async ({ size, route, order }, i) => {
    // A fresh tab per shot: the page reads its route and theme only at load. Each in a window of
    // its own and told it has focus: headless Chrome holds back the frames of a tab that is not in
    // front, and with several open some waited 1-6 s for the design to say it was ready (5 s is
    // when the page stops waiting, so a shot could catch it unfinished). Measured both ways.
    const at = [performance.now()]
    const { targetId } = await send('Target.createTarget', { url: 'about:blank', newWindow: true })
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
    await send('Emulation.setFocusEmulationEnabled', { enabled: true }, sessionId)
    await send('Emulation.setDeviceMetricsOverride', {
      width: size.width, height: size.height, deviceScaleFactor: size.deviceScaleFactor, mobile: size.mobile,
    }, sessionId)
    if (size.mobile) await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }, sessionId)
    const url = new URL(base)
    url.hash = '/' + route.replace(/^\/+/, '')
    at.push(performance.now())
    await send('Page.navigate', { url: url.href }, sessionId)
    let ready = false
    for (let i = 0; i < 100 && !ready; i++) {
      const { result } = await send('Runtime.evaluate', { expression: 'document.documentElement?.dataset.ready === "1"', returnByValue: true }, sessionId)
      if (!(ready = result.value)) await sleep(100)
    }
    at.push(performance.now())
    const copyOn = await copied(sessionId, route)
    await settle(sessionId)
    at.push(performance.now())
    // A state route whose clicks found nothing still shoots, but says so.
    const { result: miss } = await send('Runtime.evaluate', { expression: `[...document.querySelectorAll('[data-missed]')].map(e => e.textContent).join('; ')`, returnByValue: true }, sessionId)
    if (miss.value) console.error(`shoot: ${miss.value} on ${route}`)
    // Interaction states: click each selector inside the design, in order.
    for (const sel of clicks) {
      const { result } = await send('Runtime.evaluate', { expression: clickIn(sel), returnByValue: true }, sessionId)
      if (!result.value) console.error(`shoot: nothing matches ${sel} on ${route}`)
      await sleep(400)
    }
    at.push(performance.now())
    // The stage, and the copy picker's bar under it when copy mode is on: together they are the
    // stage's own size, so a shot in copy mode lines up with one at rest.
    const { result: stage } = await send('Runtime.evaluate', { returnByValue: true, expression: `(() => {
      document.querySelector('[data-overlay]')?.style.setProperty('display', 'none')
      const r = document.querySelector('[data-layers]').getBoundingClientRect()
      const bar = document.querySelector('[data-copy-bar]')?.getBoundingClientRect().height ?? 0
      return { x: r.x, y: r.y, width: r.width, height: r.height + bar, scale: 1 }
    })()` }, sessionId)
    const { data } = await send('Page.captureScreenshot', { format: 'png', clip: stage.value }, sessionId)
    const file = resolve(outDir, `${fileOf(route)}-${size.name}${flags.copy && !copyOn ? suffix.replace('-copy', '') : suffix}.png`)
    writeFileSync(file, Buffer.from(data, 'base64'))
    // For a sheet, the singles are kept for it and summed up in one line after it. A phone
    // prototype's sheet shows the phone alone, cut from its shot: in a phone-size page it sits
    // small in the middle of the stage, and five of them uncut would be half their size.
    if (sheets) {
      const { result: phone } = phoneOnly(route) ? await send('Runtime.evaluate', { returnByValue: true, expression: `(() => {
        const r = document.querySelector('[data-layers] [data-phone]')?.getBoundingClientRect()
        return r && { x: r.x, y: r.y, w: r.width, h: r.height }
      })()` }, sessionId) : {}
      const { x, y, width, height } = stage.value, p = phone?.value, m = 6
      const [x0, y0] = p ? [Math.max(0, p.x - x - m), Math.max(0, p.y - y - m)] : [0, 0]
      const [x1, y1] = p ? [Math.min(width, p.x - x + p.w + m), Math.min(height, p.y - y + p.h + m)] : [width, height]
      taken.set(route, [...taken.get(route) || [], { order, file, x: x0, y: y0, w: x1 - x0, h: y1 - y0, full: width, px: (x1 - x0) * size.deviceScaleFactor }])
    } else printed[i] = file
    at.push(performance.now())
    // A shot normally takes under a second; a slow one says where its time went.
    if (at.at(-1) - at[0] > 3000) {
      const s = i => ((at[i + 1] - at[i]) / 1000).toFixed(1)
      const why = !ready ? ', the page never said it was ready' : at[2] - at[1] > 4900 ? ', the page stopped waiting for the design after 5 s' : ''
      console.error(`shoot: slow ${fileOf(route)} ${size.name} ${((at.at(-1) - at[0]) / 1000).toFixed(1)}s (new tab ${s(0)}s, page ready ${s(1)}s${why}, settle ${s(2)}s, clicks ${s(3)}s, capture ${s(4)}s)`)
    }
    await send('Target.closeTarget', { targetId })
  }
  let next = 0
  await Promise.all(Array.from({ length: Math.min(TABS, jobs.length) }, async () => {
    while (next < jobs.length) { const i = next++; await shootOne(jobs[i], i) }
  }))
  for (const shots of taken.values()) shots.sort((x, y) => x.order - y.order)
  printed.forEach(f => f && console.log(f))
  if (flags.ref) {
    for (const route of routes) {
      const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
      const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
      // Tall enough that the shell shows the phone at 100%; 3x is an iPhone screenshot's scale.
      await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1400, deviceScaleFactor: 3, mobile: false }, sessionId)
      const url = new URL(base)
      url.hash = '/' + route.replace(/^\/+/, '')
      await send('Page.navigate', { url: url.href }, sessionId)
      for (let i = 0; i < 100; i++) {
        const { result } = await send('Runtime.evaluate', { expression: 'document.documentElement?.dataset.ready === "1"', returnByValue: true }, sessionId)
        if (result.value) break
        await sleep(100)
      }
      await copied(sessionId, route)
      await settle(sessionId)
      for (const sel of clicks) {
        await send('Runtime.evaluate', { expression: clickIn(sel) }, sessionId)
        await sleep(400)
      }
      // The screen alone: the phone's rounded corners would hide what the reference shows there.
      const { result: box } = await send('Runtime.evaluate', { returnByValue: true, expression: `(() => {
        const layers = document.querySelector('[data-layers]'), phone = layers.querySelector('[data-phone]')
        if (phone) { phone.style.zoom = '1'; phone.style.borderRadius = '0' }
        const r = (phone || layers).querySelector('[data-mount]').getBoundingClientRect()
        return { x: r.x, y: r.y, width: r.width, height: r.height, phone: !!phone }
      })()` }, sessionId)
      const { x, y, width, height, phone } = box.value
      const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x, y, width, height, scale: phone ? 1 : 2 / 3 } }, sessionId)
      const screen = resolve(outDir, `${fileOf(route)}-screen.png`)
      writeFileSync(screen, Buffer.from(data, 'base64'))
      console.log(screen)
      await send('Target.closeTarget', { targetId })

      // Three panels at one height: the variant, the reference, and the variant at half opacity
      // over the reference, where any shift in size or position shows as a double edge.
      const H = 1100
      const img = (src, extra = '') => `<img src="${pathToFileURL(src).href}" style="height:${H}px;display:block;${extra}">`
      const panel = (label, body) => `<figure style="margin:0"><figcaption style="margin:0 0 12px">${label}</figcaption><div style="position:relative;height:${H}px;width:max-content">${body}</div></figure>`
      const html = `<!doctype html><body style="margin:0;padding:24px;display:flex;gap:24px;width:max-content;background:#18181b;color:#fff;font:600 22px system-ui">${
        panel('Variant', img(screen))}${panel(vs.label, img(flags.ref))}${panel('Overlay', img(flags.ref) + img(screen, 'position:absolute;inset:0 auto auto 0;opacity:.5'))}</body>`
      const file = resolve(outDir, `${fileOf(route)}-${vs.name}.png`)
      await compose(html, file, 2400, H + 120)
      console.log(file)
    }
  }
  // One sheet per prototype, from the singles just taken: a column per variant, its letter and
  // name above, desktop above phone (a phone prototype's variants have the phone only), the
  // picked one outlined. Columns wrap into rows while that keeps them wider; past MIN_COL the
  // variants are split evenly over hero-sheet.png, hero-sheet-2.png …
  for (const p of sheets || []) {
    const cols = p.columns.map(c => ({ ...c, shots: taken.get(c.route) || [] })).filter(c => c.shots.length)
    if (!cols.length) continue
    const ratio = Math.max(...cols.map(c => c.shots.reduce((sum, s) => sum + s.h / s.w, 0)))
    const fixed = LABEL + Math.max(...cols.map(c => c.shots.length)) * INNER
    const most = Math.min(...cols.flatMap(c => c.shots.map(s => s.px)))
    let pages = 1
    while (Math.ceil(cols.length / pages) > 1 && fit(Math.ceil(cols.length / pages), ratio, fixed, most).w < MIN_COL) pages++
    const per = Math.ceil(cols.length / pages)
    for (let i = 0; i < pages; i++) {
      const part = cols.slice(i * per, (i + 1) * per)
      const { w, cols: across } = fit(part.length, ratio, fixed, most)
      const width = across * w + (across - 1) * GAP
      // A shot at the column's width, or the part of it a phone prototype's sheet shows.
      const img = (s, picked) => { const k = w / s.w; return `<div style="width:${w}px;height:${Math.round(s.h * k)}px;margin-top:${INNER}px;overflow:hidden;outline:${picked ? '3px solid #34d399' : '1px solid #3f3f46'}"><img src="${pathToFileURL(s.file).href}" style="display:block;width:${s.full * k}px;margin:${-s.y * k}px 0 0 ${-s.x * k}px"></div>` }
      const cell = c => `<figure style="margin:0;width:${w}px"><figcaption style="height:${LABEL}px;display:flex;align-items:center;gap:10px;white-space:nowrap"><b>${esc(c.id)}</b><span dir="auto" style="min-width:0;overflow:hidden;text-overflow:ellipsis;color:#d4d4d8">${esc(c.name)}</span>${
        c.id === p.picked ? '<span style="flex:none;margin-inline-start:auto;padding:3px 10px;border-radius:99px;background:#065f46;color:#d1fae5;font-size:16px">Picked</span>' : ''}</figcaption>${c.shots.map(s => img(s, c.id === p.picked)).join('')}</figure>`
      const head = [p.title, p.note, pages > 1 && `${i + 1} of ${pages}`].filter(Boolean).map(esc).join(' · ')
      const html = `<!doctype html><meta charset="utf-8"><body style="margin:0;padding:${PAD}px;width:max-content;background:#18181b;color:#fafafa;font:500 22px/1.2 system-ui,sans-serif">
        <div dir="auto" style="width:${width}px;height:${HEAD}px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600">${head}</div>
        <div style="display:grid;grid-template-columns:repeat(${across},${w}px);gap:${GAP}px;align-items:start">${part.map(cell).join('')}</div></body>`
      const file = resolve(outDir, `${p.name}${i ? `-${i + 1}` : ''}${suffix}.png`)
      await compose(html, file, width + 2 * PAD, SHEET)
      console.log(file)
    }
  }
  if (sheets) {
    const singles = [...taken.values()].flat().map(s => basename(s.file))
    console.log(`${singles.length} single shot${singles.length === 1 ? '' : 's'} in ${resolve(outDir)} (${singles.slice(0, 2).join(', ')} …): open one only for a detail`)
  }
  ws.close()
} catch (err) {
  console.error('shoot:', err.message)
  process.exitCode = 1
} finally {
  clearTimeout(timer)
  cleanup()
}
