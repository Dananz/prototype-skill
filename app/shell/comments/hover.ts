// Parts of a design that only show under the pointer (a dot's readout, a panel that opens on hover)
// can be commented on like anything else, with no key to hold. The rule, while comments are on:
//
//   Whatever appears because of a hover stays up while the pointer is on it.
//
// What a hover made appear is what the design added to the page in the moment after the pointer
// reached something new (REVEAL_MS), for as long as it stays on the page. While the pointer is on one of those parts (pass-through ones
// included, see dom.ts seeThrough) the design hears nothing of it, so its hover stays as it was. When
// the pointer goes elsewhere the design is told after a short grace (GRACE_MS), so crossing the gap
// between a dot and its readout doesn't close the readout on the way.
//
//  - In a device view the layer over the frame (view/index.tsx) takes the pointer, so the page in the
//    frame never sees it move: `hoverMove` replays each move into the frame as a browser would (out /
//    leave from what the pointer left, over / enter on what it reached, then the move), under the
//    same rule. Only handlers see replayed events: a CSS :hover is the browser's own.
//  - While a comment is written, `freeze` holds the design's hover entirely, from the moment its pin
//    goes down until `release`, which then tells the design the pointer left (it is on the composer).
import { seeThrough } from './dom'

const HOVER = ['pointermove', 'mousemove', 'pointerover', 'mouseover', 'pointerout', 'mouseout',
  'pointerenter', 'mouseenter', 'pointerleave', 'mouseleave'] as const
const REVEAL_MS = 1200
const GRACE_MS = 300

/** What the pointer is over in each design document, as the design last heard it. */
const last = new WeakMap<Document, Element | null>()
let frozen: { mount: HTMLElement; stop: (e: Event) => void } | null = null
type Watch = {
  mount: HTMLElement; doc: Document
  revealed: Set<Element>; until: number      // parts hover changes added, and how long the last one may add more
  grace: number; at: { x: number; y: number } // a pending "the pointer went elsewhere"
}
let watching: Watch | null = null

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
// A part stays known as revealed for as long as it is on the page: a readout that opened near a dot
// is still the dot's readout once the pointer is on the dot itself.
const changed = (w: Watch | null) => { if (w) w.until = performance.now() + REVEAL_MS }

/** Tells the design the pointer is over `el` (null: off the design) at (x, y) in its document's px. */
function forward(d: Document, el: Element | null, x: number, y: number) {
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
    if (watching?.doc === d) changed(watching)
  }
  if (el) { fire(el, 'pointermove', x, y, null); fire(el, 'mousemove', x, y, null) }
}

const inMount = (w: Watch, el: Element | null) => (el && w.mount.contains(el) && el !== w.mount ? el : null)
const hitAt = (w: Watch, x: number, y: number) => inMount(w, w.doc.elementFromPoint(x, y))

/** Whether the design may hear the pointer at (x, y), over `plain` (the browser's own hit). */
function mayHear(w: Watch, x: number, y: number, plain: Element | null) {
  for (const n of w.revealed) if (!n.isConnected) w.revealed.delete(n)
  const now = last.get(w.doc) ?? null
  // A part that holds what the pointer is on was rebuilt around it, not revealed by it.
  const shown = [...w.revealed].filter(n => !(now && n.contains(now)))
  const settle = () => { clearTimeout(w.grace); w.grace = 0 }
  if (!shown.length) { settle(); return true }
  const deep = plain && seeThrough(w.doc, x, y, plain)
  // Still on what the hover is about (the dot itself): nothing to hold.
  if (deep && now && now.contains(deep)) { settle(); return true }
  // On what the hover made appear: held.
  if (deep && shown.some(n => n.contains(deep))) { settle(); return false }
  // Elsewhere: held for a moment, then the design catches up with where the pointer is.
  w.at = { x, y }
  if (!w.grace) w.grace = window.setTimeout(() => { w.grace = 0; if (watching === w && !frozen) forward(w.doc, hitAt(w, w.at.x, w.at.y), w.at.x, w.at.y) }, GRACE_MS)
  return false
}

/** Comments are on: the rule above applies to `mount` until the returned stop. */
export function watch(mount: HTMLElement) {
  const doc = mount.ownerDocument
  const w: Watch = { mount, doc, revealed: new Set(), until: 0, grace: 0, at: { x: 0, y: 0 } }
  const mo = new MutationObserver(recs => {
    if (performance.now() > w.until) return
    for (const r of recs) r.addedNodes.forEach(n => { if (n.nodeType === 1) w.revealed.add(n as Element) })
  })
  mo.observe(mount, { childList: true, subtree: true })
  // On this page the browser's own events reach the design: each is let through or held at the
  // mount, ahead of the design's handlers (the comment layer's own listener is on the stage, earlier).
  const gate = (e: Event) => {
    if (!e.isTrusted || frozen) return
    const m = e as MouseEvent
    if (mayHear(w, m.clientX, m.clientY, hitAt(w, m.clientX, m.clientY))) {
      if (e.type === 'pointerover' && last.get(doc) !== e.target) { last.set(doc, e.target as Element); changed(w) }
    } else e.stopImmediatePropagation()
  }
  for (const t of HOVER) mount.addEventListener(t, gate, true)
  watching = w
  return () => {
    clearTimeout(w.grace)
    mo.disconnect()
    for (const t of HOVER) mount.removeEventListener(t, gate, true)
    if (watching === w) watching = null
  }
}

/** A device view's layer: the pointer is over `el` (null: off the frame) at (x, y) in the frame's px. */
export function hoverMove(d: Document, el: Element | null, x: number, y: number) {
  if (frozen) return
  const w = watching?.doc === d ? watching : null
  if (w && !mayHear(w, x, y, el)) return
  forward(d, el, x, y)
}

/** Holds the design's hover where it is (a comment is being written on it). */
export function freeze(mount: HTMLElement) {
  if (frozen?.mount === mount) return
  if (frozen) release()
  const stop = (e: Event) => { if (e.isTrusted) e.stopImmediatePropagation() }
  for (const t of HOVER) mount.addEventListener(t, stop, true)
  frozen = { mount, stop }
}

/** Lets the design's hover go: the pointer has left it. */
export function release() {
  const f = frozen
  if (!f) return
  for (const t of HOVER) f.mount.removeEventListener(t, f.stop, true)
  frozen = null
  forward(f.mount.ownerDocument, null, 0, 0)
}
