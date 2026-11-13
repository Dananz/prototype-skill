// Pictures of an element as it looks with each of its options, for the options panel's tiles
// (options.tsx). The design gives no picture per option, so each is drawn from the design itself: the
// option is shown on the element through the same way a hover preview shows it (shell/options.ts),
// once the design has rendered it the element is copied with every computed style written inline
// (from the element's own window, so a device view's frame works too), and the copy is kept as HTML.
// While that runs the element is covered by a still copy of itself (the panel draws it), so the user
// does not see it cycle. Pictures are kept per option until the design changes around them: the
// other facets' choices, the theme and the design's width are part of their key (never the element's
// own width, which its own options change).
import { options, choiceOf, spotsOf, type Facet, type Spot } from '../options'

/** A copy of the element, 'empty' when the option hides it, 'failed' when it could not be copied. */
export type Picture = Still | 'empty' | 'failed'
/** `text`: a line of words (no box of its own), drawn as wide as its words. */
export type Still = { html: string; w: number; h: number; text?: boolean }

const pictures = new Map<string, Picture>()
const subs = new Set<() => void>()
let version = 0
const bump = () => { version++; for (const f of [...subs]) f() }
export const pictureStore = {
  subscribe(f: () => void) { subs.add(f); return () => { subs.delete(f) } },
  version: () => version,
}

/** What a facet's pictures depend on besides its own option: the other choices, the theme, and the
 *  design's width (the element's own width changes with its options, so it is no part of it). */
export function keyOf(host: Element, spot: Spot, f: Facet) {
  const others = spotsOf(host).flatMap(s => s.facets).filter(x => x.key !== f.key).map(x => [x.key, choiceOf(host, x)])
  const dark = host.ownerDocument.documentElement.classList.contains('dark') || document.documentElement.classList.contains('dark')
  return JSON.stringify([spot.key, f.key, others, dark, Math.round(sizeOf(host).w)])
}
// The last picture of each option whatever the rest of the design was, shown until one is drawn again.
const latest = new Map<string, Picture>()
const looseOf = (key: string, i: number) => { try { const [spot, facet] = JSON.parse(key); return `${spot}\n${facet}#${i}` } catch { return '' } }
export const pictureOf = (key: string, i: number) => pictures.get(`${key}#${i}`) ?? latest.get(looseOf(key, i))

/** An element's own size in its layout px (a transform or the frame's scale left out). */
export function sizeOf(el: Element) {
  if (el instanceof (el.ownerDocument.defaultView ?? window).HTMLElement) return { w: (el as HTMLElement).offsetWidth, h: (el as HTMLElement).offsetHeight }
  const r = el.getBoundingClientRect()
  return { w: r.width, h: r.height }
}

// Left out of a copy: what moves (a copy is a still), what only matters on the page.
const SKIP = /^(transition|animation|will-change|cursor|pointer-events|user-select|-webkit-user-select|view-transition|anchor|offset|scroll-|overscroll|touch-action|caret|outline|content-visibility|contain)/
const MAX_NODES = 600
let copies = 0
// Attributes that would make a copy act as a part of the page: a field's name or form, a label's for,
// autofocus. Ids go too (a copy's own SVG ids are renamed instead).
const LOOSE = ['name', 'form', 'for', 'autofocus', 'id', 'popover', 'popovertarget', 'commandfor', 'accesskey']

/** The element as HTML that looks the same anywhere: every element's computed style inline. */
export function stillOf(el: HTMLElement): Still | null {
  const win = el.ownerDocument.defaultView
  if (!win) return null
  const src = [el, ...el.querySelectorAll('*')]
  if (src.length > MAX_NODES) return null
  const copy = el.cloneNode(true) as Element
  const dst = [copy, ...copy.querySelectorAll('*')]
  if (dst.length !== src.length) return null
  // An SVG's ids (its gradients, masks and clips) are renamed for this copy, and what points at them
  // with it, so several copies on the page never point at each other's (or the design's).
  const tag = `pc${++copies}-`
  const ids = new Set(src.filter(s => s instanceof win.SVGElement && s.id).map(s => s.id))
  const esc = (id: string) => id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const point = ids.size ? new RegExp(`url\\((['"]?)#(${[...ids].map(esc).join('|')})\\1\\)`, 'g') : null
  const repoint = (v: string) => point ? v.replace(point, (_m, q, id) => `url(${q}#${tag}${id}${q})`) : v
  src.forEach((s, i) => {
    const d = dst[i], cs = win.getComputedStyle(s)
    let css = ''
    for (let k = 0; k < cs.length; k++) { const p = cs[k]; if (!SKIP.test(p)) css += `${p}:${cs.getPropertyValue(p)};` }
    d.removeAttribute('class')
    d.removeAttribute('data-tweak')
    d.removeAttribute('data-copy')
    for (const a of [...d.attributes]) if (a.name.startsWith('on')) d.removeAttribute(a.name)
    const svgId = s instanceof win.SVGElement && ids.has(s.id) ? s.id : ''
    for (const a of LOOSE) d.removeAttribute(a)
    if (svgId) d.setAttribute('id', tag + svgId)
    if (ids.size) for (const a of [...d.attributes]) {
      if ((a.name === 'href' || a.name === 'xlink:href') && a.value.startsWith('#') && ids.has(a.value.slice(1))) d.setAttribute(a.name, `#${tag}${a.value.slice(1)}`)
      else if (a.value.includes('url(')) d.setAttribute(a.name, repoint(a.value))
    }
    d.setAttribute('style', repoint(css))
  })
  let { w, h } = sizeOf(el)
  // A line of words in a wider block: as wide as its words.
  const cs = win.getComputedStyle(el)
  const text = !el.querySelector('svg, img, video, canvas, picture') && !!el.textContent?.trim() && (cs.backgroundColor === 'transparent' || /,\s*0\)$/.test(cs.backgroundColor)) && cs.backgroundImage === 'none' && !parseFloat(cs.borderTopWidth) && !parseFloat(cs.borderBottomWidth)
  if (text) {
    const range = el.ownerDocument.createRange()
    range.selectNodeContents(el)
    const rw = range.getBoundingClientRect().width / ((el.getBoundingClientRect().width || 1) / (w || 1))
    if (rw > 0 && rw < w) w = Math.ceil(rw) + 2
  }
  const root = copy as HTMLElement
  root.style.position = 'static'
  root.style.margin = '0'
  root.style.inset = 'auto'
  root.style.transform = 'none'
  root.style.translate = 'none'
  root.style.rotate = 'none'
  root.style.scale = 'none'
  root.style.opacity = '1'
  root.style.width = `${w}px`
  root.style.height = `${h}px`
  root.style.boxSizing = 'border-box'
  root.style.flex = 'none'
  root.setAttribute('aria-hidden', 'true')
  // A still: nothing in it takes focus, a click or a form's submit.
  root.setAttribute('inert', '')
  if (root.tagName === 'BUTTON' || root.tagName === 'A' || root.tagName === 'INPUT') root.setAttribute('tabindex', '-1')
  if (text) { root.style.whiteSpace = 'nowrap'; root.style.paddingInline = '0' }
  return { html: root.outerHTML, w, h, ...(text ? { text: true } : {}) }
}

// While pictures are drawn, the design's transitions and animations are off, so each option is
// copied as it ends up, not halfway there.
const STILL = '[data-options-drawing], [data-options-drawing] * { transition: none !important; animation-duration: 0s !important; animation-delay: 0s !important }'
function still(host: HTMLElement, on: boolean) {
  const doc = host.ownerDocument
  if (on && !doc.getElementById('proto-options-still')) {
    const st = doc.createElement('style')
    st.id = 'proto-options-still'
    st.textContent = STILL
    doc.head.append(st)
  }
  host.toggleAttribute('data-options-drawing', on)
}

const frame = (win: Window) => new Promise<void>(r => win.requestAnimationFrame(() => r()))

let running: { cancel: () => void; done: Promise<void> } | null = null
// Each call's number: a call that is no longer the newest once the run before it ended gives way.
let calls = 0
/** Stops drawing now (the panel closed, another facet is on show). */
export function stopDrawing() { calls++; running?.cancel() }
// The element as it was when a facet's pictures were drawn, with the same choices: if it reads
// otherwise now, its source changed (a hot reload), so the pictures are drawn again.
const drawnFrom = new Map<string, string>()

/**
 * Draws the picture of every option of a facet not drawn yet. `el` finds the element again (a
 * render may replace it). Resolves once done or stopped; the facet shows its choice again either way.
 */
export async function drawFacet(host: HTMLElement, f: Facet, key: string, el: () => HTMLElement | null, onCover: (on: boolean) => void) {
  // One run at a time: the one stopped finishes (and puts the design back) before this one starts,
  // and of the calls waiting meanwhile only the newest goes on.
  const me = ++calls
  while (running) { running.cancel(); await running.done }
  if (me !== calls) return
  const first = el()
  if (!first || f.kind === 'words') return
  const from = `${key}@${JSON.stringify(choiceOf(host, f))}`
  if (drawnFrom.has(from) && drawnFrom.get(from) !== first.outerHTML) for (let i = 0; i < f.options.length; i++) pictures.delete(`${key}#${i}`)
  drawnFrom.set(from, first.outerHTML)
  const todo = f.options.map((_, i) => i).filter(i => !pictures.has(`${key}#${i}`))
  if (!todo.length) return
  const win = host.ownerDocument.defaultView ?? window
  let stopped = false, finish = () => {}
  const mine = { cancel: () => { stopped = true }, done: new Promise<void>(r => { finish = r }) }
  // Claimed before anything is awaited, so no other run starts beside it.
  running = mine
  onCover(true)
  still(host, true)
  try {
    for (const i of todo) {
      if (stopped) break
      options.draw(host, f, i)
      for (const end = performance.now() + 700; !options.shows(host, f, i) && performance.now() < end && !stopped;) await frame(win)
      await frame(win)
      await frame(win)
      if (stopped) break
      const now = el()
      const pic = now && now.isConnected ? stillOf(now) : null
      const gone = !now || !now.isConnected || (pic && (!pic.w || !pic.h))
      const got: Picture = pic && !gone ? pic : gone && f.kind === 'toggle' ? 'empty' : 'failed'
      pictures.set(`${key}#${i}`, got)
      latest.set(looseOf(key, i), got)
      bump()
    }
  } finally {
    options.draw(host, null)
    await frame(win)
    still(host, false)
    onCover(false)
    if (running === mine) running = null
    finish()
  }
}
