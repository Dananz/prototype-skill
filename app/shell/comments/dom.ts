// Finding and measuring targets inside the mounted design. A design is whatever the
// shell mounted for the variant (`[data-mount]`); every selector is rooted there, and every
// position sent to the agent is from the variant root's top left in CSS px, with a phone frame's
// zoom taken out, so it means the same on any screen.
import type { Box, Target } from './types'

const squash = (s: string) => s.replace(/\s+/g, ' ').trim()
const textOf = (el: HTMLElement) => squash(el.innerText ?? '')

/** The mount's origin: the variant's own root, which scrolls with the content. */
const originOf = (mount: HTMLElement) => (mount.firstElementChild as HTMLElement | null) ?? mount
/** A phone's frame is zoomed to fit the stage; rects read in screen px, the design lives in CSS px. */
export const zoomOf = (mount: HTMLElement) => parseFloat(mount.closest<HTMLElement>('[data-phone]')?.style.zoom || '') || 1

/** The frame a device view (view/) draws the page in, when el is in it. Nothing here is an
 *  instanceof check: an element in the frame belongs to another window, whose classes are its own. */
export const frameOf = (el: Element) => el.ownerDocument !== document ? el.ownerDocument.defaultView?.frameElement as HTMLElement | null ?? null : null
/** How much bigger el is drawn on the page than in its own px: a device view's frame is scaled. */
export const scaleOf = (el: Element) => { const f = frameOf(el); return f ? f.getBoundingClientRect().width / (f.offsetWidth || 1) : 1 }

/** `box` of `el` within `host`, in screen px (for drawing over the design). An element in a device
 *  view's frame is where the frame draws it: its own box, scaled, from the frame's corner. */
export function rel(el: Element, host: Element): Box {
  const r = el.getBoundingClientRect(), h = host.getBoundingClientRect(), f = frameOf(el)
  if (!f) return { x: r.left - h.left, y: r.top - h.top, w: r.width, h: r.height }
  const o = f.getBoundingClientRect(), s = o.width / (f.offsetWidth || 1)
  return { x: o.left + r.left * s - h.left, y: o.top + r.top * s - h.top, w: r.width * s, h: r.height * s }
}

/** The part of a device view's frame that shows, within host (its area scrolls around it when zoomed in). */
function frameShown(el: Element, host: Element): Box | null {
  const f = frameOf(el)
  if (!f) return null
  const r = f.getBoundingClientRect(), h = host.getBoundingClientRect()
  let [l, t, rt, b] = [r.left, r.top, r.right, r.bottom]
  for (let p = f.parentElement; p && p !== document.body; p = p.parentElement) {
    const cs = getComputedStyle(p)
    if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue
    const c = p.getBoundingClientRect()
    l = Math.max(l, c.left); t = Math.max(t, c.top); rt = Math.min(rt, c.right); b = Math.min(b, c.bottom)
  }
  return { x: l - h.left, y: t - h.top, w: rt - l, h: b - t }
}

const cut = (a: Box, b: Box): Box | null => {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y)
  const w = Math.min(a.x + a.w, b.x + b.w) - x, h = Math.min(a.y + a.h, b.y + b.h) - y
  return w > 0 && h > 0 ? { x, y, w, h } : null
}

/**
 * `el`'s box (see `rel`) cut to the part of the design that is on screen: a design scrolls inside
 * its mount (a phone's screen), so an element taller than the screen, or half scrolled away,
 * is only drawn where it can be seen. Null when none of it is.
 */
export function seen(el: Element, mount: Element, host: Element): Box | null {
  const b = cut(rel(el, host), rel(mount, host)), f = frameShown(mount, host)
  return b && f ? cut(b, f) : b
}

/** From the mount down, one `tag:nth-child(n)` per level. */
function pathOf(mount: HTMLElement, el: HTMLElement) {
  const parts: string[] = []
  for (let e: HTMLElement | null = el; e && e !== mount; e = e.parentElement) {
    const i = [...(e.parentElement?.children ?? [])].indexOf(e) + 1
    parts.unshift(`${e.tagName.toLowerCase()}:nth-child(${i})`)
  }
  return `:scope > ${parts.join(' > ')}`
}

export function describe(mount: HTMLElement, el: HTMLElement): Target {
  const r = el.getBoundingClientRect(), o = originOf(mount).getBoundingClientRect(), z = zoomOf(mount)
  const text = textOf(el)
  // Where it is written: its own place in the prototype's files, else that of the nearest element
  // around it they wrote (a part a library or an @project component draws has none of its own).
  const code = el.closest<HTMLElement>('[data-proto-src]')
  const at = code && mount.contains(code) ? code : null
  return {
    label: 'Element',
    selector: pathOf(mount, el),
    ...(el.dataset.shoot ? { shoot: el.dataset.shoot } : {}),
    ...(at ? { src: at.dataset.protoSrc, ...(at.dataset.protoComponent ? { component: at.dataset.protoComponent } : {}) } : {}),
    tag: el.tagName.toLowerCase(),
    text: text.slice(0, 80),
    rect: { x: Math.round((r.left - o.left) / z), y: Math.round((r.top - o.top) / z), w: Math.round(r.width / z), h: Math.round(r.height / z) },
  }
}

/** A spot pinned with a long press, at screen point (cx, cy), with the element under it. */
export function spot(mount: HTMLElement, el: HTMLElement, cx: number, cy: number): Target {
  const t = describe(mount, el), o = originOf(mount).getBoundingClientRect(), z = zoomOf(mount)
  return { ...t, label: 'Spot', point: { x: Math.round((cx - o.left) / z), y: Math.round((cy - o.top) / z) } }
}

/**
 * Where a pinned spot is now (see `rel`), as an empty box: its element's live box plus where in
 * it the spot was, so it moves with the element. Null when the spot is scrolled out of view.
 */
export function spotAt(t: Target, el: Element, mount: HTMLElement, host: Element): Box | null {
  if (!t.point) return null
  const b = rel(el, host), m = rel(mount, host), z = zoomOf(mount) * scaleOf(el)
  const x = b.x + (t.point.x - t.rect.x) * z, y = b.y + (t.point.y - t.rect.y) * z
  return x >= m.x && x <= m.x + m.w && y >= m.y && y <= m.y + m.h ? { x, y, w: 0, h: 0 } : null
}

export function find(mount: HTMLElement | null, t: Pick<Target, 'selector'>): HTMLElement | null {
  try { return mount ? mount.querySelector<HTMLElement>(t.selector) : null } catch { return null }
}
