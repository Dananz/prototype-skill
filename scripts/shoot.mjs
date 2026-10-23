#!/usr/bin/env node
// Screenshot places in a prototype session at desktop and phone size: the stage only (the
// design, or a lobby's grid), without the page's sidebar, bars and floating controls.
// Usage: shoot.mjs <app-url> <out-dir> <route...> [--theme=dark] [--focus=1] [--copy=1] [--click=<css>]... [--ref=<png> [--as=built]] [--phone=<slug,…>] [--sheet=<json>] [--size=<w>x<h>] [--pin=<json>]
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
// --parallax=<x>,<y> holds every parallax() layer at that point of its travel (-1 to 1 each way), so
// the ends can be checked for holes and edges (hero-A-desktop-parallax1_1.png).
//
// --size=<w>x<h> shoots at that one viewport instead (hero-A-834x1194.png), the way the page's
// device view shows a tablet or a desktop: a web prototype's stage at that width, no phone frame.
//
// --pin=<json> (written by `proto shoot --pin`) lists pinned comments, each with the page size and
// theme it was written in, its element and the controls that open the way to it. Each is shot as
// the user saw it: that page size at 2x, the way opened, the element found, its box plus a margin
// (pin-<batch>-<n>.png), a wider crop of the region around it (-context.png) and, when the comment
// has pictures, the shot beside them at one height (-vs-ref.png).
//
// Drives Chrome over the DevTools protocol so the phone shot is a real 390px mobile
// viewport, and waits for the page to say it is ready instead of sleeping.
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { startChrome, stopChrome, waitReady } from './chrome.mjs'
import { numberOf } from '../app/numbers.mjs'

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
if (flags.parallax) base.searchParams.set('parallax', flags.parallax) // parallax() layers held at that end of their travel
const suffix = [flags.focus && 'focus', flags.copy && 'copy', flags.parallax && `parallax${flags.parallax.replace(/,/, '_')}`, flags.theme === 'dark' && 'dark', clicks.length && 'clicked'].filter(Boolean).map(s => `-${s}`).join('')
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
const pins = flags.pin ? JSON.parse(readFileSync(flags.pin, 'utf8')) : null
const taken = new Map() // route → its single shots, desktop first, for the sheets
const esc = s => String(s).replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`)
// --pin's helpers in the page: the design's mount and what shows as the page's comments find them
// (view/frame.ts designIn, comments/dom.ts shows, find, partOpenedBy), the element once found,
// and its geometry in page px.
const PIN_PAGE = `window.__pin = (() => {
  const mount = () => [...document.querySelectorAll('[data-layers] > :not([inert]) [data-mount]')].find(m => !m.closest('[data-thumb], [data-stack-item], [data-play-box], [data-fit]')) ?? null
  const shows = el => {
    if (!el?.isConnected) return false
    const r = el.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) return false
    return el.checkVisibility ? el.checkVisibility({ opacityProperty: true, visibilityProperty: true }) : getComputedStyle(el).visibility !== 'hidden'
  }
  const q = (m, sel) => { try { return m.querySelector(sel) } catch { return null } }
  // A part is open when it shows, or when it is a box of nothing whose insides show (a tab's panel
  // that only holds what is positioned out of it).
  const open = e => shows(e) || (e.isConnected && e.getBoundingClientRect().width < 1 && e.getBoundingClientRect().height < 1 && [...e.querySelectorAll('*')].slice(0, 200).some(shows))
  const part = (m, by) => [...m.querySelectorAll('[data-opened-by]')].find(e => e.getAttribute('data-opened-by') === by && open(e)) ?? null
  const squash = s => String(s ?? '').replace(/\\s+/g, ' ').trim()
  const zoom = m => parseFloat(m.closest('[data-phone]')?.style.zoom || '') || 1
  const root = m => m.firstElementChild ?? m
  const named = el => el.closest('[data-shoot]')?.getAttribute('data-shoot')
  const centre = el => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } }
  const said = el => { const t = squash(el.innerText).slice(0, 40); return '<' + el.tagName.toLowerCase() + '>' + (el.dataset.shoot ? ' [data-shoot=' + el.dataset.shoot + ']' : '') + (t ? ' "' + t + '"' : '') }
  // The comment's box where it would be now: the variant root's corner plus the box, in page px.
  const stored = (m, t) => { const o = root(m).getBoundingClientRect(), z = zoom(m); return { x: o.left + t.rect.x * z, y: o.top + t.rect.y * z, w: t.rect.w * z, h: t.rect.h * z } }
  const nearest = (m, t, list) => {
    if (!t.rect || list.length === 1) return list[0]
    const s = stored(m, t)
    const d = e => { const r = e.getBoundingClientRect(); return Math.abs(r.left - s.x) + Math.abs(r.top - s.y) + Math.abs(r.width - s.w) + Math.abs(r.height - s.h) + (shows(e) ? 0 : 1e6) }
    return list.reduce((a, b) => d(b) < d(a) ? b : a)
  }
  // Whether e has the shape (width to height) of the box the comment recorded, within a quarter: the
  // design can be drawn at another scale than the user's (it fits its stage), never in another shape.
  // One with no size yet (it shows on hover) cannot be told, so it passes.
  const shaped = (m, t, e) => {
    if (!t.rect || t.rect.w < 4 || t.rect.h < 4) return true
    const r = e.getBoundingClientRect()
    if (r.width < 1 && r.height < 1) return true
    const a = (r.width + 2) / (r.height + 2), b = (t.rect.w + 2) / (t.rect.h + 2)
    return Math.max(a, b) / Math.min(a, b) <= 1.25
  }
  let el = null
  return {
    // The design is drawn: its mount has something in it.
    ready: () => !!mount()?.firstElementChild,
    missed: () => [...document.querySelectorAll('[data-missed]')].map(e => e.textContent).join('; '),
    // The stage the design is mounted in, in page px (what a comment records as its stage).
    stage: () => { const r = mount()?.getBoundingClientRect(); return r ? { w: Math.round(r.width), h: Math.round(r.height) } : null },
    // A step of the way: 'open' when its part shows already, 'missing' when its control isn't on the page, else the control's centre.
    opener(by) {
      const m = mount()
      if (!m) return 'missing'
      if (part(m, by)) return 'open'
      const o = q(m, by)
      if (!shows(o)) return 'missing'
      o.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      const c = centre(o), hit = document.elementFromPoint(c.x, c.y)
      return { ...c, covered: !(hit && (hit === o || o.contains(hit))) }
    },
    opened: by => { const m = mount(); return !!m && !!part(m, by) },
    // The page's own other presses (comments/dom.ts pressOn): the click alone, or the down and up alone.
    press(by, how) {
      const m = mount(), o = m && q(m, by)
      if (!o) return false
      const r = o.getBoundingClientRect(), at = { bubbles: true, cancelable: true, composed: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0 }
      if (how === 'down') for (const [K, type] of [[PointerEvent, 'pointerdown'], [MouseEvent, 'mousedown'], [PointerEvent, 'pointerup'], [MouseEvent, 'mouseup']]) o.dispatchEvent(new K(type, { ...at, pointerType: 'mouse', isPrimary: true }))
      else o.click()
      return true
    },
    // Indexed controls of a family that are on the page, nearest index first: for a control the
    // user had (band-dot-2, a band they added) and a fresh page does not (only band-dot-1).
    kin(by) {
      const m = mount(), k = /\\[data-shoot=(["']?)([\\w-]*?)-(\\d+)\\1\\]/.exec(by)
      if (!m || !k) return []
      const want = Number(k[3]), seen = new Set()
      for (const e of m.querySelectorAll('[data-shoot]')) {
        const x = new RegExp('^' + k[2].replace(/[.*+?^$()|[\\]\\\\]/g, '\\\\$&') + '-(\\\\d+)$').exec(e.dataset.shoot)
        if (x && Number(x[1]) !== want && shows(e)) seen.add(Number(x[1]))
      }
      return [...seen].sort((a, b) => Math.abs(a - want) - Math.abs(b - want) || a - b)
        .map(i => ({ by: by.replace(k[0], '[data-shoot=' + k[1] + k[2] + '-' + i + k[1] + ']'), was: k[2] + '-' + k[3], now: k[2] + '-' + i }))
    },
    // By its selector (with the data-shoot it had, as the page's find), else its data-shoot, its
    // path or its source line inside the data-shoot it was in, its words, or its place. A match whose
    // shape (width to height) is far from the box the comment recorded is held back while a later
    // way finds one that has it: the page can hold another element where the user's was.
    find(t) {
      const m = mount()
      el = null
      if (!m) return { how: 'none', why: 'no design on the page' }
      const name = t.shoot ?? t.within
      // The comment's path is from the mount; the part it was in (its data-shoot) can stand elsewhere
      // now (another part opened before it), so its path is tried from that part down, longest tail
      // first. up: that many steps of the path left off its end, for what the element was in.
      const parts = String(t.selector).replace(/^:scope\\s*>\\s*/, '').split(/\\s*>\\s*/)
      const inside = up => {
        const path = parts.slice(0, parts.length - up), tag = up ? /^[a-z0-9-]+/i.exec(path.at(-1) || '')?.[0]?.toLowerCase() : t.tag, out = []
        if (path.length < 2) return out
        for (const w of [...m.querySelectorAll('[data-shoot]')].filter(x => x.dataset.shoot === t.within))
          for (let k = path.length - 1; k >= 1; k--) {
            const e = q(w, ':scope > ' + path.slice(-k).join(' > '))
            if (e && e.tagName.toLowerCase() === tag && named(e) === t.within && !out.includes(e)) out.push(e)
          }
        return out
      }
      const ways = [
        ['selector', () => { const e = q(m, t.selector); return e && (!name || named(e) === name) ? [e] : [] }],
        [t.shoot && 'its [data-shoot=' + t.shoot + ']', () => [...m.querySelectorAll('[data-shoot]')].filter(x => x.dataset.shoot === t.shoot)],
        [t.within && 'its path inside [data-shoot=' + t.within + ']', () => inside(0)],
        [t.within && t.src && 'its source line (' + t.src + ') inside [data-shoot=' + t.within + ']', () =>
          [...m.querySelectorAll('[data-shoot]')].filter(x => x.dataset.shoot === t.within).flatMap(w => [...w.querySelectorAll(t.tag || '*')])
            .filter(e => e.closest('[data-proto-src]')?.getAttribute('data-proto-src') === t.src && named(e) === t.within)],
        [squash(t.text) && t.tag && 'its words', () => [...m.querySelectorAll(t.tag)].filter(x => squash(x.innerText).slice(0, 80) === squash(t.text))],
        // The element itself can be gone (taken out since, as a comment asked): what it was in, the
        // nearest element around it on its path inside its data-shoot that is still there.
        [t.within && 'what it was in', () => {
          for (let up = 1; up < 6; up++) { const c = inside(up); if (c.length) return c }
          return [...m.querySelectorAll('[data-shoot]')].filter(x => x.dataset.shoot === t.within)
        }, true],
        [t.rect && 'its place', () => { const s = stored(m, t), hit = document.elementFromPoint(s.x + s.w / 2, s.y + s.h / 2); return hit && m.contains(hit) ? [hit] : [] }],
      ].filter(w => w[0])
      let first = null
      for (const [how, all, gone] of ways) {
        const c = all()
        if (!c.length) continue
        // Of those with its shape (what it was in has a shape of its own), one with a size, when there
        // is: a box of nothing passes any shape.
        const fit = gone ? c : c.filter(e => shaped(m, t, e)), sized = fit.filter(e => { const r = e.getBoundingClientRect(); return r.width >= 1 || r.height >= 1 })
        if (fit.length) {
          el = nearest(m, t, sized.length ? sized : fit)
          return { how, what: said(el), of: c.length, ...(gone ? { gone: true } : {}), ...(first ? { passed: { how: first.how, what: first.what } } : {}) }
        }
        if (!first) { const e = nearest(m, t, c); first = { how, e, gone, what: said(e), of: c.length } }
      }
      if (first) { el = first.e; return { how: first.how, what: first.what, of: first.of, misshapen: true, ...(first.gone ? { gone: true } : {}) } }
      return { how: 'none', why: 'nothing matches its selector, data-shoot, path, words or place' }
    },
    shows: () => shows(el),
    centre: () => centre(el),
    // Where the pointer goes to make it show: on it, where it was, then on each element around it.
    hovers(t) {
      const m = mount(), out = []
      if (el.getBoundingClientRect().width >= 1) out.push({ ...centre(el), what: 'the element' })
      if (t.rect) { const s = stored(m, t); out.push({ x: s.x + s.w / 2, y: s.y + s.h / 2, what: 'where it was' }) }
      for (let p = el.parentElement, i = 0; p && p !== m && i < 6; p = p.parentElement, i++) if (shows(p)) out.push({ ...centre(p), what: said(p) })
      return out
    },
    // In the page's view: centred in what scrolls around it, when any of it is out of view.
    reveal() {
      const r = el.getBoundingClientRect()
      if (r.top < 0 || r.left < 0 || r.bottom > innerHeight || r.right > innerWidth) el.scrollIntoView({ block: 'center', inline: 'center' })
    },
    // Until nothing that ends is moving for two frames running, at most ms.
    async settle(ms) {
      const frame = () => new Promise(r => requestAnimationFrame(r)), end = performance.now() + ms
      let still = 0
      while (performance.now() < end && still < 2) {
        const moving = document.getAnimations().some(a => a.playState === 'running' && a.effect?.getComputedTiming().iterations !== Infinity)
        still = moving || ![...document.images].every(i => i.complete) ? 0 : still + 1
        await frame()
      }
      return still >= 2
    },
    // Page px, whole px: the element's box; the shot (the box and the margin); the context (the
    // nearest region around it, else three times its box, and the margin); both cut to the stage
    // (widened to the element where it reaches past it) and the page. design: the element's box
    // from the variant's top left in the design's px, as a comment's box is.
    geometry(margin) {
      const m = mount(), r = el.getBoundingClientRect(), z = zoom(m), o = root(m).getBoundingClientRect()
      const st = document.querySelector('[data-layers]')?.getBoundingClientRect() ?? { left: 0, top: 0, right: innerWidth, bottom: innerHeight }
      const L = Math.max(0, Math.min(st.left, r.left)), T = Math.max(0, Math.min(st.top, r.top))
      const R = Math.min(innerWidth, Math.max(st.right, r.right)), B = Math.min(innerHeight, Math.max(st.bottom, r.bottom))
      const cut = (x0, y0, x1, y1) => { const x = Math.floor(Math.max(L, x0)), y = Math.floor(Math.max(T, y0)); return { x, y, w: Math.ceil(Math.min(R, x1)) - x, h: Math.ceil(Math.min(B, y1)) - y } }
      const shot = cut(r.left - margin, r.top - margin, r.right + margin, r.bottom + margin)
      const clipped = r.left - margin < L || r.top - margin < T || r.right + margin > R || r.bottom + margin > B
      // A region is an element around it that is a box of its own (a background, a border, a
      // shadow, a role, or a data-shoot or data-opened-by), clearly bigger than the element and
      // smaller than most of the stage.
      const area = (st.right - st.left) * (st.bottom - st.top)
      let region = null
      for (let p = el.parentElement; p && p !== m; p = p.parentElement) {
        const b = p.getBoundingClientRect()
        if (b.width * b.height > area * 0.75) break
        if (b.width < r.width * 1.5 && b.height < r.height * 1.5) continue
        const cs = getComputedStyle(p)
        if (p.dataset.shoot || p.hasAttribute('data-opened-by') || /^(dialog|menu|listbox|tabpanel|region|group|toolbar)$/.test(p.getAttribute('role') || '') || cs.backgroundColor !== 'rgba(0, 0, 0, 0)' || parseFloat(cs.borderTopWidth) > 0 || cs.boxShadow !== 'none') { region = p; break }
      }
      const g = region ? region.getBoundingClientRect() : { left: r.left - r.width, top: r.top - r.height, right: r.right + r.width, bottom: r.bottom + r.height }
      const context = cut(g.left - margin, g.top - margin, g.right + margin, g.bottom + margin)
      return { box: { x: r.left, y: r.top, w: r.width, h: r.height }, shot, clipped, context, region: region ? said(region) : null, zoom: z, design: { x: (r.left - o.left) / z, y: (r.top - o.top) / z, w: r.width / z, h: r.height / z } }
    },
  }
})()`
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
  const inPage = sessionId => expression => send('Runtime.evaluate', { expression, returnByValue: true }, sessionId).then(r => r.result?.value)
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
  // prepare: an expression run once the images are decoded and before the page is measured.
  const compose = async (html, file, width, height, prepare = '') => {
    const page = join(dirname(file), `.${basename(file, '.png')}.html`)
    writeFileSync(page, html)
    const t = await send('Target.createTarget', { url: 'about:blank' })
    const { sessionId: sid } = await send('Target.attachToTarget', { targetId: t.targetId, flatten: true })
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }, sid)
    await send('Page.navigate', { url: pathToFileURL(page).href }, sid)
    const { result: size } = await send('Runtime.evaluate', { awaitPromise: true, returnByValue: true, expression: `(async () => {
      while (document.readyState !== 'complete') await new Promise(r => setTimeout(r, 50))
      await Promise.all([...document.images].map(i => i.decode()))
      ${prepare}
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
      url.pathname = '/' + route.replace(/^\/+/, '')
      await send('Page.navigate', { url: url.href }, sessionId)
      await waitReady(inPage(sessionId))
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
  // --pin: each pinned comment as the user saw it. Its page size and theme (or the device view's
  // size, in the framed page that view shows), at 2x; the way to it opened as the page's own pin
  // does it (comments/dom.ts reveal: each closed part's control pressed, outermost first, here
  // with the real pointer first); the element found by its selector, else by its data-shoot, its
  // words or its place, saying which; hovered when it only shows on hover. Then its box plus a
  // margin, a wider crop of the region it is in, and the comment's pictures beside the shot.
  async function shootPins() {
    const SCALE = 2
    const said = []
    const one = async (p, i) => {
      const t0 = performance.now(), out = [], missed = []
      const { targetId } = await send('Target.createTarget', { url: 'about:blank', newWindow: true })
      const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
      const page = async expression => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId)).result?.value
      // The helpers go in with each call that needs them: a page the dev server reloads (as it does
      // when it first optimizes a dependency) has lost them.
      const pin = expression => page(`(window.__pin ?? (${PIN_PAGE}), ${expression})`)
      const until = async (expression, ms) => { for (const end = performance.now() + ms; ; await sleep(40)) { if (await page(expression)) return true; if (performance.now() > end) return false } }
      let moved = false
      const move = async (x, y) => { moved = true; await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' }, sessionId) }
      const click = async (x, y) => {
        await move(x, y)
        for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 }, sessionId)
      }
      const name = `pin-${p.batch}-${p.n}`
      const t = p.target
      try {
        await send('Emulation.setFocusEmulationEnabled', { enabled: true }, sessionId)
        const mobile = p.width < 640
        let size = { width: p.width, height: p.height }
        await send('Emulation.setDeviceMetricsOverride', { ...size, deviceScaleFactor: SCALE, mobile }, sessionId)
        if (mobile) await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }, sessionId)
        // The design's own saved settings as the user's page had them when the batch was sent (its
        // localStorage, the page's own keys left out), in before any of its code reads them.
        const kept = p.storage && typeof p.storage === 'object' ? Object.keys(p.storage) : []
        // (The script only goes in on a page whose Page domain is on.)
        if (kept.length) await send('Page.enable', {}, sessionId)
        if (kept.length) await send('Page.addScriptToEvaluateOnNewDocument', { source: `try { const s = ${JSON.stringify(p.storage)}; for (const k of Object.keys(s)) localStorage.setItem(k, s[k]) } catch { /* storage blocked */ }` }, sessionId)
        const url = new URL(base)
        url.searchParams.set('theme', p.theme === 'dark' ? 'dark' : 'light')
        if (p.framed) url.searchParams.set('dv', '1')
        url.pathname = '/' + p.route
        await send('Page.navigate', { url: url.href }, sessionId)
        if (!await waitReady(inPage(sessionId))) missed.push('the page never said it was ready')
        if (!await until(`(window.__pin ?? (${PIN_PAGE})).ready()`, 15000)) missed.push('the design never drew')
        await settle(sessionId)
        await page(`document.querySelector('[data-overlay]')?.style.setProperty('display', 'none')`)
        // The stage the user's design was in: the page's sidebar and bars can take another share of
        // the window here than there, and a design that fits its stage is then drawn at another
        // scale. The window is sized so the stage is theirs.
        const notes = []
        if (p.stage && !p.framed && !mobile) {
          const now = await pin('__pin.stage()')
          if (now && (Math.abs(now.w - p.stage.w) > 1 || Math.abs(now.h - p.stage.h) > 1)) {
            const fit = v => Math.max(320, Math.min(4000, Math.round(v)))
            size = { width: fit(p.width + p.stage.w - now.w), height: fit(p.height + p.stage.h - now.h) }
            await send('Emulation.setDeviceMetricsOverride', { ...size, deviceScaleFactor: SCALE, mobile }, sessionId)
            await sleep(100)
            await settle(sessionId)
            const then = await pin('__pin.stage()')
            notes.push(`stage: ${now.w}x${now.h} at the batch's page size, the user's was ${p.stage.w}x${p.stage.h}; shot at ${size.width}x${size.height} so it is theirs${then && (Math.abs(then.w - p.stage.w) > 1 || Math.abs(then.h - p.stage.h) > 1) ? ` (it came to ${then.w}x${then.h})` : ''}`)
          }
        }
        if (kept.length) notes.push(`its saved settings: ${kept.length} localStorage key${kept.length === 1 ? '' : 's'} of the design restored as the user had them`)
        const miss = await pin('__pin.missed()')
        if (miss) missed.push(`its state: ${miss}`)
        // The way to it. A part that opens on hover opens with the pointer on its control, so the
        // pointer goes there first and a click only follows when that did not open it.
        const steps = [], hoveredBy = []
        for (let by of t.route || []) {
          // A control drawn a moment after the part before it opened is waited for, a little.
          let o
          for (const end = performance.now() + 1500; ; await sleep(50)) {
            o = await pin(`__pin.opener(${JSON.stringify(by)})`)
            if (o !== 'missing' || performance.now() > end) break
          }
          // An indexed control the user's page had and this one has not (band-dot-2: a band they
          // added; the page starts with band 1): the nearest of its family that is here stands in.
          let stand = ''
          if (o === 'missing') {
            for (const k of await pin(`__pin.kin(${JSON.stringify(by)})`) || []) {
              const o2 = await pin(`__pin.opener(${JSON.stringify(k.by)})`)
              if (o2 === 'missing') continue
              stand = `${k.was} is not on the page; used ${k.now}`
              notes.push(`stand-in: ${by} is not on this page (the user's page had it, from something they did there), so ${k.by} opened the way instead: what it opens may differ from what they saw`)
              by = k.by; o = o2
              break
            }
          }
          const say = how => steps.push(`${by} (${stand ? `${stand}, ` : ''}${how})`)
          if (o === 'open') { say('open already'); continue }
          if (o === 'missing') { say('not on the page'); missed.push(`${by}: nothing on the page matches it, so what it opens stays closed`); break }
          const opened = `__pin.opened(${JSON.stringify(by)})`
          let how = ''
          if (!o.covered) {
            await move(o.x, o.y)
            if (await until(opened, 200)) { how = 'hovered'; hoveredBy.push(by) }
            else { await click(o.x, o.y); if (await until(opened, 700)) how = 'clicked' }
          }
          for (const k of ['click', 'down']) if (!how) {
            await pin(`__pin.press(${JSON.stringify(by)}, '${k}')`)
            if (await until(opened, 700)) how = k === 'click' ? 'clicked in script' : 'pressed in script'
          }
          say(how || 'did not open')
          if (!how) { missed.push(`${by}: pressed, but the part it opens never showed`); break }
        }
        // A part that opened on hover closes when the pointer leaves its control (or a scroll moves
        // the control from under it): the pointer goes back onto the control while it is closed.
        const keepOpen = async () => {
          for (const by of hoveredBy) {
            if (await pin(`__pin.opened(${JSON.stringify(by)})`)) continue
            const o = await pin(`__pin.opener(${JSON.stringify(by)})`)
            if (o && typeof o === 'object') { await move(o.x, o.y); await until(`(window.__pin ?? (${PIN_PAGE})).opened(${JSON.stringify(by)})`, 400) }
          }
        }
        // A part just opened can draw its insides a moment later.
        let found
        for (const end = performance.now() + 800; ; await sleep(50)) {
          found = await pin(`__pin.find(${JSON.stringify(t)})`)
          if (found.how !== 'none' || performance.now() > end) break
          await keepOpen()
        }
        let hovered = ''
        if (found.how !== 'none') {
          await pin('__pin.reveal()')
          await keepOpen()
          if (!await pin('__pin.shows()')) {
            for (const h of await pin(`__pin.hovers(${JSON.stringify(t)})`)) {
              await move(h.x, h.y)
              if (await until(`(window.__pin ?? (${PIN_PAGE})).shows()`, 300)) { hovered = h.what; break }
            }
            if (!hovered) missed.push('the element is on the page but does not show (no size, hidden or transparent), even with the pointer on it and on the elements around it')
          }
          // The pointer stays where a part or the element needed it, or on the element with --hover;
          // else it leaves, so the shot has no hover the user did not see.
          if (p.hover) { const c = await pin('__pin.centre()'); await move(c.x, c.y) }
          else if (moved && !hovered && !hoveredBy.length) await move(0, 0)
        }
        await pin('__pin.settle(1500)')
        if (p.after) await sleep(p.after)
        // Still open and still showing at the moment of the shot.
        if (found.how !== 'none' && !hovered && hoveredBy.length && !await pin('__pin.shows()')) await keepOpen()
        const head = `pin ${p.batch}/${p.n} · ${p.route} · ${p.framed ? `view ${p.view} ` : 'page '}${size.width}x${size.height} · ${p.theme}`
        out.push(head)
        if (p.text) out.push(`   "${p.text.split('\n')[0].slice(0, 100)}"`)
        if (steps.length) out.push(`   opened by: ${steps.join(' > ')}`)
        out.push(...notes.map(n => `   ${n}`))
        const capture = async (clip, file) => {
          const { data } = await send('Page.captureScreenshot', { format: 'png', clip: { x: clip.x, y: clip.y, width: clip.w, height: clip.h, scale: 1 } }, sessionId)
          writeFileSync(file, Buffer.from(data, 'base64'))
          return file
        }
        if (found.how === 'none') {
          missed.push(`its element: ${found.why}`)
          const stage = await page(`(() => { const r = document.querySelector('[data-layers]')?.getBoundingClientRect() ?? { x: 0, y: 0, width: innerWidth, height: innerHeight }; return { x: Math.floor(r.x), y: Math.floor(r.y), w: Math.floor(r.width), h: Math.floor(r.height) } })()`)
          out.push(`   element: not found; the stage instead: ${await capture(stage, resolve(outDir, `${name}-context.png`))}`)
          process.exitCode = 1
        } else {
          const g = await pin(`__pin.geometry(${p.margin})`)
          const r = v => Math.round(v), boxOf = b => `${r(b.x)},${r(b.y)} ${r(b.w)}x${r(b.h)}`
          out.push(`   element: ${found.what} (${found.how === 'selector' ? 'by its selector' : `its selector no longer matches; found by ${found.how}${found.of > 1 ? `, the nearest of ${found.of}` : ''}`})`)
          if (found.passed) out.push(`   passed over: ${found.passed.what}, found by ${found.passed.how}: not the shape of the comment's box`)
          if (hovered) out.push(`   shown by: the pointer on ${hovered}`)
          if (p.point) out.push(`   the spot: ${p.point.x},${p.point.y} in the design (pinned with a long press)`)
          if (p.region) out.push(`   the region: ${p.region.x},${p.region.y} ${p.region.w}x${p.region.h} in the design (dragged out with the mouse)`)
          // Another size with the same shape is the same element drawn at another scale (a design
          // that fits its stage, in a stage of another size); another shape is another element, or
          // the page in another state than the user's.
          const before = t.rect, drift = before && (Math.abs(before.w - g.design.w) > 1 || Math.abs(before.h - g.design.h) > 1)
          let warn = ''
          if (found.gone) out.push(`   NOTE: the element itself is not on the page any more (taken out since, as a comment can ask); this is what it was in`)
          if (drift && found.gone) out.push(`   box: ${boxOf(g.box)} page px (in the design ${boxOf(g.design)}; the element the comment had was ${boxOf(before)})`)
          else if (drift && before.w >= 1 && before.h >= 1) {
            const k = Math.sqrt((g.design.w / before.w) * (g.design.h / before.h))
            const a = (g.design.w + 2) / (g.design.h + 2), b = (before.w + 2) / (before.h + 2)
            if (Math.max(a, b) / Math.min(a, b) > 1.25) found.misshapen = true
            if (found.misshapen) warn = `WARNING: its shape is not the one the comment recorded (${r(before.w)}x${r(before.h)} then, ${r(g.design.w)}x${r(g.design.h)} now; nothing on the page has that shape). Either this is not the element the user meant, or the page is not in their state (a size they dragged, something they added or opened): read the shot before trusting it${kept.length ? "" : " (this batch was sent without the design's saved settings, so a size they dragged is not restored)"}`
            out.push(`   box: ${boxOf(g.box)} page px (in the design ${boxOf(g.design)}; the comment had ${boxOf(before)}${found.misshapen ? ', another shape' : `, the same shape drawn at ${k.toFixed(2)}x the user's size: their stage was ${k < 1 ? 'larger' : 'smaller'} than this one, and the design scales to it`})`)
          } else out.push(`   box: ${boxOf(g.box)} page px (in the design ${boxOf(g.design)}${before ? `; the comment had ${boxOf(before)}` : ''})`)
          if (warn) out.push(`   ${warn}`)
          out.push(`   scale: ${SCALE}x, ${SCALE} image px per page px${g.zoom !== 1 ? ` (the phone frame drawn at ${g.zoom.toFixed(2)}, so ${(SCALE * g.zoom).toFixed(2)} per design px)` : ''}`)
          const shot = await capture(g.shot, resolve(outDir, `${name}.png`))
          out.push(`   ${shot}  (${g.shot.w * SCALE}x${g.shot.h * SCALE}: the box and ${p.margin} px around it${g.clipped ? ', cut at the stage' : ''})`)
          const context = await capture(g.context, resolve(outDir, `${name}-context.png`))
          out.push(`   ${context}  (${g.context.w * SCALE}x${g.context.h * SCALE}: ${g.region ? `the region it is in, ${g.region}` : 'three times its box'}; the element at ${r((g.box.x - g.context.x) * SCALE)},${r((g.box.y - g.context.y) * SCALE)} in it)`)
          // The comment's pictures beside the shot, all at one height (at most 900 px, and low enough
          // that the sheet stays within 2000 px across).
          const refs = (p.images || []).filter(im => existsSync(im.file))
          if (refs.length) {
            const fig = (label, src) => `<figure style="margin:0;flex:none"><figcaption style="height:${LABEL}px;display:flex;align-items:center;white-space:nowrap">${esc(label)}</figcaption><img data-fit src="${pathToFileURL(src).href}" style="display:block;height:600px;margin-top:${INNER}px;outline:1px solid #3f3f46"></figure>`
            const html = `<!doctype html><meta charset="utf-8"><body style="margin:0;padding:${PAD}px;width:max-content;background:#18181b;color:#fafafa;font:500 22px/1.2 system-ui,sans-serif">
              <div style="max-width:1100px;height:${HEAD}px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600">${esc(`${p.batch}/${p.n} · ${p.route}${p.text ? ` · ${p.text.split('\n')[0]}` : ''}`)}</div>
              <div style="display:flex;gap:${GAP}px;align-items:flex-start">${fig('now', shot)}${refs.map((im, k) => fig(`reference ${k + 1}${im.name ? ` · ${im.name}` : ''}`, im.file)).join('')}</div></body>`
            const fitAll = `{ const im = [...document.querySelectorAll('img[data-fit]')], ratio = im.reduce((s, i) => s + i.naturalWidth / i.naturalHeight, 0)
              const H = Math.round(Math.max(120, Math.min(900, Math.max(...im.map(i => i.naturalHeight)), (${SHEET} - ${2 * PAD} - ${GAP} * (im.length - 1)) / ratio)))
              for (const i of im) i.style.height = H + 'px' }`
            const file = resolve(outDir, `${name}-vs-ref.png`)
            await compose(html, file, SHEET, SHEET, fitAll)
            out.push(`   ${file}  (now beside ${refs.length} reference${refs.length === 1 ? '' : 's'}, at one height)`)
          }
          if (p.take) out.push(`   on the motion at ${p.at} ms of its take: this shot is at rest; see that moment with proto shoot ${p.route} --at ${p.at}`)
        }
        if (missed.length) out.push(...missed.map(m => `   not replayed: ${m}`))
        out[0] += `  (${((performance.now() - t0) / 1000).toFixed(1)} s)`
      } catch (e) {
        out.push(`pin ${p.batch}/${p.n}: ${e.message}`)
        process.exitCode = 1
      } finally {
        await send('Target.closeTarget', { targetId }).catch(() => {})
      }
      said[i] = out.join('\n')
    }
    let next = 0
    await Promise.all(Array.from({ length: Math.min(TABS, pins.length) }, async () => {
      while (next < pins.length) { const i = next++; await one(pins[i], i) }
    }))
    console.log(said.join('\n\n'))
  }
  if (pins) await shootPins()
  // Every shot is a fresh tab, and most of its time is the page loading and settling, not Chrome
  // working, so a few run at once. They are listed, and their sheet columns kept, in the order the
  // loop used to take them (desktop before phone), whichever tab finishes first.
  const jobs = (flags.ref || motion || pins ? [] : SIZES).flatMap((size, order) =>
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
    url.pathname = '/' + route.replace(/^\/+/, '')
    at.push(performance.now())
    await send('Page.navigate', { url: url.href }, sessionId)
    const ready = await waitReady(inPage(sessionId))
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
      url.pathname = '/' + route.replace(/^\/+/, '')
      await send('Page.navigate', { url: url.href }, sessionId)
      await waitReady(inPage(sessionId))
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
      const cell = c => `<figure style="margin:0;width:${w}px"><figcaption style="height:${LABEL}px;display:flex;align-items:center;gap:10px;white-space:nowrap"><b>${numberOf(c.id) ? `#${numberOf(c.id)}` : esc(c.id)}</b><span dir="auto" style="min-width:0;overflow:hidden;text-overflow:ellipsis;color:#d4d4d8">${esc(c.name)}</span>${
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
