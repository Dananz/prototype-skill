// Finding and measuring targets inside the mounted design. A design is whatever the
// shell mounted for the variant (`[data-mount]`); every selector is rooted there, and every
// position sent to the agent is from the variant root's top left in CSS px, with a phone frame's
// zoom taken out, so it means the same on any screen.
import type { Box, Target, Use } from './types'

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

/** A rect read in `doc` (the page's own, or a device view's frame), as `rel` draws an element's: from `host`'s corner, scaled. */
export function rectIn(r: DOMRect, doc: Document, host: Element): Box {
  const h = host.getBoundingClientRect(), f = doc !== document ? doc.defaultView?.frameElement as HTMLElement | null : null
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
 * Cut to the visible scroll viewports, not the mount's layout height. A desktop mount can
 * overflow into its parent's scroller; its own one-screen box then scrolls out of view while
 * the rest of the design is still visible. Phone mounts clip their own scrolling content.
 */
export function seen(el: Element, mount: Element, host: Element): Box | null {
  let b: Box | null = cut(rel(el, host), { x: 0, y: 0, w: host.clientWidth, h: host.clientHeight })
  for (let p = el.parentElement; b && p; p = p.parentElement) {
    const cs = p.ownerDocument.defaultView!.getComputedStyle(p), r = rel(p, host)
    const clipX = cs.overflowX !== 'visible', clipY = cs.overflowY !== 'visible'
    if (clipX || clipY) b = cut(b, {
      x: clipX ? r.x : b.x, y: clipY ? r.y : b.y,
      w: clipX ? r.w : b.w, h: clipY ? r.h : b.h,
    })
  }
  const f = frameShown(mount, host)
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
    ...(el.dataset.shoot ? { shoot: el.dataset.shoot } : (() => {
      const w = el.parentElement?.closest<HTMLElement>('[data-shoot]')
      return w && mount.contains(w) ? { within: w.dataset.shoot } : {}
    })()),
    ...(at ? { src: at.dataset.protoSrc, ...(at.dataset.protoComponent ? { component: at.dataset.protoComponent } : {}) } : {}),
    ...(() => { const u = usesOf(el); return u.length ? { uses: u } : {} })(),
    ...(() => { const r = routeOf(mount, el); return r.length ? { route: r } : {} })(),
    tag: el.tagName.toLowerCase(),
    text: text.slice(0, 80),
    rect: { x: Math.round((r.left - o.left) / z), y: Math.round((r.top - o.top) / z), w: Math.round(r.width / z), h: Math.round(r.height / z) },
    // The stage the design is mounted in, in page px: a design that fits its stage is drawn at the
    // scale this sets, so `proto shoot --pin` sizes its window until its stage is this one.
    ...(() => { const s = mount.getBoundingClientRect(); return s.width >= 1 && s.height >= 1 ? { stage: { w: Math.round(s.width), h: Math.round(s.height) } } : {} })(),
  }
}

/**
 * The design's own saved settings (its localStorage, the page's own `proto-` keys left out), sent
 * with a batch so `proto shoot --pin` can open the design as the user had it (a panel they resized,
 * a range they chose). Nothing when it is more than 64 KB, or storage is blocked.
 */
export function designStorage(): Record<string, string> | undefined {
  try {
    const out: Record<string, string> = {}
    let size = 0
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (!k || k.startsWith('proto-')) continue
      const v = localStorage.getItem(k) ?? ''
      size += k.length + v.length
      if (size > 64 * 1024) return undefined
      out[k] = v
    }
    return Object.keys(out).length ? out : undefined
  } catch { return undefined }
}

/** The variant as a whole, as a target: its root element, with the variant's name in place of the root's text. */
export function wholeTarget(mount: HTMLElement, name = ''): Target {
  const t = describe(mount, originOf(mount))
  return { ...t, label: 'Variant', whole: true, text: name.slice(0, 80) }
}

/**
 * Where the components around `el` are used, innermost first, up to four: going up React's fibers
 * from the element, each component whose props jsx.ts saw used in the prototype's files (see there).
 * Empty outside React, or for a part no prototype file wrote.
 */
export function usesOf(el: HTMLElement): Use[] {
  const map = (el.ownerDocument.defaultView as unknown as { __protoUses?: WeakMap<object, string> } | null)?.__protoUses
  const k = map && Object.keys(el).find(n => n.startsWith('__reactFiber$'))
  type Fiber = { type: unknown; key: string | null; memoizedProps: unknown; return: Fiber | null }
  const out: Use[] = []
  for (let f = k ? (el as unknown as Record<string, Fiber>)[k] : null, n = 0; f && n < 300 && out.length < 4; f = f.return, n++) {
    if (typeof f.type === 'string' || !f.memoizedProps || typeof f.memoizedProps !== 'object') continue
    const at = map!.get(f.memoizedProps)
    if (!at || out.at(-1)?.at === at) continue
    const t = f.type as { displayName?: string; name?: string; type?: { name?: string }; render?: { name?: string } } | null
    const component = t?.displayName || t?.name || t?.type?.name || t?.render?.name || '?'
    // Up to three short text or number props, which name this use (`shoot="phase-menu"`).
    const props = Object.entries(f.memoizedProps as Record<string, unknown>)
      .filter(([k, v]) => !['children', 'className', 'style'].includes(k) && (typeof v === 'string' || typeof v === 'number') && String(v).length <= 60)
      .slice(0, 3).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(' ')
    out.push({ component, at, ...(f.key != null ? { key: String(f.key) } : {}), ...(props ? { props } : {}) })
  }
  return out
}

/**
 * How to reach `el` when it is in something that opens: going out from it, the `data-opened-by` of
 * each part it is in (a menu, a popup, a tab's panel: the selector of the control that opens that
 * part), outermost first.
 */
export function routeOf(mount: HTMLElement, el: HTMLElement): string[] {
  const out: string[] = []
  for (let p: HTMLElement | null = el; p && p !== mount && mount.contains(p); p = p.parentElement) {
    const by = p.getAttribute('data-opened-by')
    if (by) out.unshift(by)
  }
  return out
}

const q = (mount: HTMLElement, sel: string) => { try { return mount.querySelector<HTMLElement>(sel) } catch { return null } }
/**
 * Whether an element shows: some size, and not hidden or transparent. A part can stay on the page
 * while closed (a strip collapsed to nothing, a column faded out); that is closed, not open.
 */
export function shows(el: HTMLElement | null): el is HTMLElement {
  if (!el?.isConnected) return false
  const r = el.getBoundingClientRect()
  if (r.width < 1 || r.height < 1) return false
  const c = el as HTMLElement & { checkVisibility?: (o: object) => boolean }
  return c.checkVisibility ? c.checkVisibility({ opacityProperty: true, visibilityProperty: true }) : el.ownerDocument.defaultView?.getComputedStyle(el).visibility !== 'hidden'
}
const partOpenedBy = (mount: HTMLElement, by: string) => [...mount.querySelectorAll<HTMLElement>('[data-opened-by]')].find(e => e.getAttribute('data-opened-by') === by && shows(e)) ?? null

/** What opens a hidden element: the innermost control on its route that is on the page now. */
export function openerOf(mount: HTMLElement, t: Pick<Target, 'route'>): HTMLElement | null {
  for (let i = (t.route?.length ?? 0) - 1; i >= 0; i--) { const o = q(mount, t.route![i]); if (shows(o)) return o }
  return null
}

/** Set while reveal presses an opener: the comment layer lets those presses reach the design. */
export const passing = { on: false }

/**
 * A press the design takes as the user's. `full` is what a mouse sends (pointer and mouse down and
 * up, then a click); a control that acts on both its down and its click would open and close at
 * once, so `click` sends the click alone and `down` the down and up alone.
 */
type Press = 'full' | 'click' | 'down'
function pressOn(el: HTMLElement, how: Press) {
  const w = el.ownerDocument.defaultView as (Window & typeof globalThis) | null
  if (!w) return
  const r = el.getBoundingClientRect(), at = { bubbles: true, cancelable: true, composed: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0 }
  passing.on = true
  try {
    if (how !== 'click') {
      el.dispatchEvent(new w.PointerEvent('pointerdown', { ...at, pointerType: 'mouse', isPrimary: true }))
      el.dispatchEvent(new w.MouseEvent('mousedown', at))
      el.dispatchEvent(new w.PointerEvent('pointerup', { ...at, pointerType: 'mouse', isPrimary: true }))
      el.dispatchEvent(new w.MouseEvent('mouseup', at))
    }
    if (how !== 'down') el.click()
  } finally { passing.on = false }
}

const until = async (f: () => boolean, ms = 1500) => { for (const end = performance.now() + ms; performance.now() < end; await new Promise(r => setTimeout(r, 40))) if (f()) return true; return f() }

/**
 * Opens the way to a comment's element: each part on its route that is not open yet is opened by
 * pressing its control, outermost first, waiting for it to show. A part already open is left as it
 * is (pressing its control again would close it). Resolves to the element, or null.
 */
export async function reveal(mount: HTMLElement | null, t: Target, current: () => boolean = () => true): Promise<HTMLElement | null> {
  if (!mount || !current()) return null
  const have = find(mount, t)
  if (shows(have) || !t.route?.length) return shows(have) ? have : null
  for (const by of t.route) {
    if (!current() || !mount.isConnected) return null
    if (partOpenedBy(mount, by)) continue
    // The usual press first; if the part did not show (it opened and closed again, or the control
    // listens to only one of them), the click alone, then the down alone.
    let open = false
    for (const how of ['full', 'click', 'down'] as const) {
      if (!current() || !mount.isConnected) return null
      const opener = q(mount, by)
      if (!shows(opener)) break
      pressOn(opener, how)
      if ((open = await until(() => !current() || !!partOpenedBy(mount, by), 700))) break
    }
    if (!open) break
  }
  await until(() => !current() || shows(find(mount, t)), 800)
  const el = find(mount, t)
  return current() && shows(el) ? el : null
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

export function find(mount: HTMLElement | null, t: Pick<Target, 'selector' | 'shoot' | 'within'>): HTMLElement | null {
  let el: HTMLElement | null
  try { el = mount ? mount.querySelector<HTMLElement>(t.selector) : null } catch { return null }
  // One place in the page can hold another element later (the menu open now where another menu was
  // open when the comment was made). The comment stays on its own: the element's data-shoot, or the
  // nearest one around it, has to be the one it had.
  const name = t.shoot ?? t.within
  if (el && name && el.closest('[data-shoot]')?.getAttribute('data-shoot') !== name) return null
  return el
}

/**
 * The element a comment moves up to with Parent: the nearest one around `el`, inside the design,
 * that shows as a region of its own. Wrappers with no size (their children are positioned out of
 * them) or exactly `el`'s size would draw no outline, or the same one, so they are skipped.
 */
export function climb(mount: HTMLElement, el: HTMLElement): HTMLElement | null {
  const a = el.getBoundingClientRect()
  for (let p = el.parentElement; p && p !== mount && mount.contains(p); p = p.parentElement) {
    const b = p.getBoundingClientRect()
    if (b.width < 1 || b.height < 1) continue
    if (Math.abs(b.left - a.left) < 1 && Math.abs(b.top - a.top) < 1 && Math.abs(b.width - a.width) < 1 && Math.abs(b.height - a.height) < 1) continue
    return p
  }
  return null
}

// What a comment is on, under a point, including parts the pointer passes through. A design often
// draws hover readouts, labels and badges with `pointer-events: none` so they never get in the way of
// what is under them; the browser's own hit test then skips them and they could not be commented on.
// Here every part of a design is briefly hit-testable (a stylesheet switched on and off, no DOM
// change), and the topmost part over `plain` (what the plain hit test found) wins, unless it covers
// all of `plain`: a full-size overlay layer (a canvas, an SVG over the whole plot) is not what the
// pointer means.
const seeSheets = new WeakMap<Document, CSSStyleSheet>()
const seeSheet = (d: Document) => {
  let s = seeSheets.get(d)
  if (!s) {
    const el = d.createElement('style')
    el.setAttribute('data-proto-see', '')
    el.textContent = '[data-mount] * { pointer-events: auto !important; }'
    d.head.appendChild(el)
    s = el.sheet!
    s.disabled = true
    seeSheets.set(d, s)
  }
  return s
}
export function seeThrough(d: Document, x: number, y: number, plain: Element | null): Element | null {
  if (!plain) return plain
  const sheet = seeSheet(d)
  let all: Element[]
  sheet.disabled = false
  try { all = d.elementsFromPoint(x, y) } finally { sheet.disabled = true }
  const p = plain.getBoundingClientRect()
  // Everything listed above `plain` is something the pointer passes through. An SVG part stands for
  // the HTML element around it, as everywhere in comments.
  for (const el of all) {
    if (el === plain) return plain
    let h: Element | null = el
    while (h && h.namespaceURI !== 'http://www.w3.org/1999/xhtml') h = h.parentElement
    if (!h || h.contains(plain) || !h.closest('[data-mount]')) continue
    const r = h.getBoundingClientRect()
    if (r.left <= p.left && r.top <= p.top && r.right >= p.right && r.bottom >= p.bottom) continue
    return h
  }
  return plain
}
