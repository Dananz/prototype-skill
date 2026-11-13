// Pictures of an element as it looks with each of its options, for the options panel's tiles
// (options.tsx). The design gives no picture per option, so each is drawn from the design itself: the
// option is shown on the element through the same way a hover preview shows it (shell/options.ts),
// once the design has rendered it the element is copied with every computed style written inline
// (from the element's own window, so a device view's frame works too), and the copy is kept as HTML.
// While that runs the element is covered by a still copy of itself (the panel draws it), so the user
// does not see it cycle. Pictures are kept per option until the design changes around them: the
// other facets' choices, the theme and the element's width are part of their key.
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

/** What a facet's pictures depend on besides its own option: the other choices, the theme, the width. */
export function keyOf(host: Element, spot: Spot, f: Facet, el: HTMLElement | null) {
  const others = spotsOf(host).flatMap(s => s.facets).filter(x => x.key !== f.key).map(x => [x.key, choiceOf(host, x)])
  const dark = host.ownerDocument.documentElement.classList.contains('dark') || document.documentElement.classList.contains('dark')
  return JSON.stringify([spot.key, f.key, others, dark, el ? Math.round(sizeOf(el).w) : 0])
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

/** The element as HTML that looks the same anywhere: every element's computed style inline. */
export function stillOf(el: HTMLElement): Still | null {
  const win = el.ownerDocument.defaultView
  if (!win) return null
  const src = [el, ...el.querySelectorAll('*')]
  if (src.length > MAX_NODES) return null
  const copy = el.cloneNode(true) as Element
  const dst = [copy, ...copy.querySelectorAll('*')]
  if (dst.length !== src.length) return null
  src.forEach((s, i) => {
    const d = dst[i], cs = win.getComputedStyle(s)
    let css = ''
    for (let k = 0; k < cs.length; k++) { const p = cs[k]; if (!SKIP.test(p)) css += `${p}:${cs.getPropertyValue(p)};` }
    d.removeAttribute('class')
    d.removeAttribute('data-tweak')
    d.removeAttribute('data-copy')
    for (const a of [...d.attributes]) if (a.name.startsWith('on')) d.removeAttribute(a.name)
    // Ids stay inside an SVG (its gradients and masks point at them); elsewhere they go.
    if (!(s instanceof win.SVGElement)) d.removeAttribute('id')
    d.setAttribute('style', css)
  })
  let { w, h } = sizeOf(el)
  // A line of words in a wider block: as wide as its words.
  const cs = win.getComputedStyle(el)
  const text = !el.querySelector('svg, img, video, canvas, picture') && !!el.textContent?.trim() && (cs.backgroundColor === 'transparent' || /,\s*0\)$/.test(cs.backgroundColor)) && !parseFloat(cs.borderTopWidth) && !parseFloat(cs.borderBottomWidth)
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

let running: { cancel: () => void } | null = null
/** Stops drawing now (the pointer moved onto a tile, the panel closed). */
export function stopDrawing() { running?.cancel() }

/**
 * Draws the picture of every option of a facet not drawn yet. `el` finds the element again (a
 * render may replace it). Resolves once done or stopped; the facet shows its choice again either way.
 */
export async function drawFacet(host: HTMLElement, spot: Spot, f: Facet, el: () => HTMLElement | null, onCover: (on: boolean) => void) {
  stopDrawing()
  const first = el()
  if (!first || f.kind === 'words') return
  const key = keyOf(host, spot, f, first)
  const todo = f.options.map((_, i) => i).filter(i => !pictures.has(`${key}#${i}`))
  if (!todo.length) return
  const win = host.ownerDocument.defaultView ?? window
  let stopped = false
  const mine = { cancel: () => { stopped = true } }
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
  }
}
