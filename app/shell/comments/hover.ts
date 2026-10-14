// Parts of a design that only show under the pointer (a dot over a key, a panel that opens on hover)
// can be commented on like anything else:
//  - In a device view the layer over the frame (view/index.tsx) takes the pointer, so the page in the
//    frame never sees it move. `forward` replays each move into the frame the way a browser would
//    (out / leave from what the pointer left, over / enter on what it reached, then the move), so the
//    design's own hover handlers run and those parts show.
//  - While a comment is written, `freeze` keeps the design's hover as it was when the pin went down:
//    no pointer move / over / out / enter / leave reaches the design until `release`, which then tells
//    it the pointer left, as it has by then (it is on the composer).
// Only handlers see replayed events: a CSS :hover is the browser's own and doesn't follow them.

const HOVER = ['pointermove', 'mousemove', 'pointerover', 'mouseover', 'pointerout', 'mouseout',
  'pointerenter', 'mouseenter', 'pointerleave', 'mouseleave'] as const

/** What the pointer is over in each design document, as the design last heard it. */
const last = new WeakMap<Document, Element | null>()
let frozen: { win: Window; mount: HTMLElement; stop: (e: Event) => void } | null = null

const fire = (el: Element, type: string, x: number, y: number, related: Element | null) => {
  const w = el.ownerDocument.defaultView as (Window & typeof globalThis) | null
  if (!w) return
  const bubbles = !type.endsWith('enter') && !type.endsWith('leave')
  const init = { bubbles, cancelable: bubbles, composed: true, clientX: x, clientY: y, view: w, relatedTarget: related }
  el.dispatchEvent(type.startsWith('pointer')
    ? new w.PointerEvent(type, { ...init, pointerId: 1, pointerType: 'mouse', isPrimary: true })
    : new w.MouseEvent(type, init))
}
// el and its ancestors up to (not including) the first one that holds `other`, outermost last.
const chain = (el: Element | null, other: Element | null) => {
  const out: Element[] = []
  for (let a = el; a && !(other && a.contains(other)); a = a.parentElement) out.push(a)
  return out
}

/** The pointer is over `el` (null: off the design) at (x, y) in its document's px. */
export function forward(d: Document, el: Element | null, x: number, y: number) {
  if (frozen) return
  const was = last.get(d) ?? null
  if (el !== was) {
    if (was?.isConnected) {
      fire(was, 'pointerout', x, y, el); fire(was, 'mouseout', x, y, el)
      for (const a of chain(was, el)) { fire(a, 'pointerleave', x, y, el); fire(a, 'mouseleave', x, y, el) }
    }
    if (el) {
      fire(el, 'pointerover', x, y, was); fire(el, 'mouseover', x, y, was)
      for (const a of chain(el, was).reverse()) { fire(a, 'pointerenter', x, y, was); fire(a, 'mouseenter', x, y, was) }
    }
    last.set(d, el)
  }
  if (el) { fire(el, 'pointermove', x, y, null); fire(el, 'mousemove', x, y, null) }
}

/** Follows what the pointer is really over in a design on this page (no device view), so `release`
 *  knows what to tell it left. Returns the stop. */
export function track(mount: HTMLElement) {
  const d = mount.ownerDocument
  const over = (e: Event) => { if (!frozen && e.isTrusted && mount.contains(e.target as Node)) last.set(d, e.target as Element) }
  d.addEventListener('pointerover', over, true)
  return () => d.removeEventListener('pointerover', over, true)
}

/** Holds the design's hover where it is. */
export function freeze(mount: HTMLElement) {
  if (frozen) release()
  const win = mount.ownerDocument.defaultView
  if (!win) return
  // Ahead of everything in the design's window (React listens on its root), and only for the design:
  // the composer and the rest of the page keep their own hover.
  const stop = (e: Event) => { if (mount.contains(e.target as Node)) e.stopImmediatePropagation() }
  for (const t of HOVER) win.addEventListener(t, stop, true)
  frozen = { win, mount, stop }
}

/** Lets the design's hover go: the pointer has left it. */
export function release() {
  const f = frozen
  if (!f) return
  for (const t of HOVER) f.win.removeEventListener(t, f.stop, true)
  frozen = null
  forward(f.mount.ownerDocument, null, 0, 0)
}
