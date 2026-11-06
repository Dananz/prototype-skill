// Where to click: a press on a design that does nothing briefly outlines, in the prototype's
// purple, what can be clicked on screen right now (as Figma's prototype view does). It only looks:
// every listener is passive and the shell's own (quiet.ts listen), nothing is stopped or prevented,
// and the outlines are drawn in the shell's box (portals.ts uiBox) over the page, never in the
// design's DOM and never taking the pointer.
//
// A press counts as dead only when nothing answers it: no element it lands in looks clickable
// (native controls, a role, a tab stop, a pointer cursor), the design
// doesn't prevent it, and the page doesn't change in reply within a moment (a menu closing on a
// press outside, a handler on the document the first check can't see). Parts of the design that
// were already changing before the press (a clock, a loop animation) don't count as a reply.
//
// What lights is what is on screen now: only elements that show (not cut off by a scroller or the
// stage, not see-through) and are on top where they are, found by hit testing, so the buttons of a
// closed menu, a drawer off screen or the page under an open dialog stay dark.
import { listen } from './quiet'
import { portaled, uiBox } from './portals'

type Opts = { on: () => boolean; paused: () => boolean }
type Box = { x: number; y: number; w: number; h: number }

const WAIT = 260
const QUIET_BEFORE = 2000
const MOVE = 8
const MAX = 80
const SCAN = 5000
const ROLES = new Set(['button', 'link', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option', 'checkbox', 'switch', 'radio', 'slider', 'combobox', 'treeitem', 'spinbutton', 'textbox', 'searchbox'])
const PRESS = ['onClick', 'onClickCapture', 'onPointerDown', 'onPointerUp', 'onMouseDown', 'onMouseUp', 'onTouchStart', 'onTouchEnd', 'onDoubleClick']
const VUE = ['onClick', 'onPointerdown', 'onPointerup', 'onMousedown', 'onMouseup', 'onTouchstart', 'onTouchend', 'onDblclick']
const NATIVE = 'a[href], button, input:not([type="hidden"]), select, textarea, summary, label, [contenteditable=""], [contenteditable="true"], audio[controls], video[controls], [draggable="true"]'

const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches

function handlerKey(el: Element, prefix: string) {
  for (const k in el) if (k.startsWith(prefix)) return k
  return null
}
/** A press handler a framework put on el (React's props, Vue's invokers) or a plain onclick. */
function hasHandler(el: Element) {
  const h = el as HTMLElement & Record<string, unknown>
  if (h.onclick || h.onpointerdown || h.onmousedown || h.ontouchstart) return true
  const rk = handlerKey(el, '__reactProps$')
  if (rk) { const p = h[rk] as Record<string, unknown> | null; if (p && PRESS.some(n => typeof p[n] === 'function')) return true }
  const v = h._vei as Record<string, unknown> | undefined
  if (v && VUE.some(n => v[n])) return true
  return false
}
function disabled(el: Element) {
  return (el as HTMLButtonElement).disabled === true || el.getAttribute('aria-disabled') === 'true' || !!el.closest('[inert]')
}

function createCheck(win: Window) {
  const cursors = new Map<Element, string>()
  const cursor = (el: Element | null): string => {
    if (!el) return 'auto'
    let c = cursors.get(el)
    if (c === undefined) { c = win.getComputedStyle(el).cursor; cursors.set(el, c) }
    return c
  }
  /** Whether el says it is something to press: a control, a role, a tab stop, or its own pointer
   *  cursor (not one it inherits). */
  const says = (el: Element) => {
    if (el.matches(NATIVE)) return true
    const role = el.getAttribute('role')
    if (role && ROLES.has(role)) return true
    const ti = el.getAttribute('tabindex')
    if (ti !== null && Number(ti) >= 0) return true
    const c = cursor(el)
    return (c === 'pointer' || c === 'grab') && cursor(el.parentElement) !== c
  }
  /** A handler alone is often a wrapper's (a dialog's panel stopping presses from reaching its
   *  backdrop): it counts as a spot only with nothing to press inside. A press on it is left to
   *  whether the page answers. */
  return (el: Element, spot: boolean) => {
    if (disabled(el)) return false
    if (says(el)) return true
    if (!spot || !hasHandler(el)) return false
    for (const c of el.querySelectorAll('*')) if (says(c) || hasHandler(c)) return false
    return true
  }
}

const area = (r: { width: number; height: number }) => r.width * r.height
/** A click catcher across most of the design (a root that closes menus) says nothing about where to press. */
const huge = (el: Element, host: Box) => !el.matches('a[href], button, input, select, textarea') && area(el.getBoundingClientRect()) > 0.6 * host.w * host.h

/** What shows of el: cut down by every ancestor that clips, and the window; null when nothing does. */
function shown(el: Element, win: Window): Box | null {
  const r = el.getBoundingClientRect()
  let x0 = r.left, y0 = r.top, x1 = r.right, y1 = r.bottom
  for (let p = el.parentElement; p && p !== el.ownerDocument.documentElement; p = p.parentElement) {
    const s = win.getComputedStyle(p)
    if (s.overflowX !== 'visible' || s.overflowY !== 'visible' || s.contain.includes('paint')) {
      const c = p.getBoundingClientRect()
      x0 = Math.max(x0, c.left); y0 = Math.max(y0, c.top); x1 = Math.min(x1, c.right); y1 = Math.min(y1, c.bottom)
      if (x1 - x0 < 4 || y1 - y0 < 4) return null
    }
  }
  x0 = Math.max(x0, 0); y0 = Math.max(y0, 0); x1 = Math.min(x1, win.innerWidth); y1 = Math.min(y1, win.innerHeight)
  return x1 - x0 < 4 || y1 - y0 < 4 ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}
/** Whether el can be seen (not faded out) and is on top somewhere in what shows of it. */
function onTop(el: Element, b: Box, win: Window) {
  let o = 1
  for (let p: Element | null = el; p && o >= 0.1; p = p.parentElement) o *= Number(win.getComputedStyle(p).opacity) || 0
  if (o < 0.1) return false
  const doc = el.ownerDocument
  for (const [fx, fy] of [[0.5, 0.5], [0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) {
    const hit = doc.elementFromPoint(b.x + b.w * fx, b.y + b.h * fy)
    if (hit && (hit === el || el.contains(hit))) return true
  }
  return false
}

export function installHotspots(doc: Document, opts: Opts) {
  const win = doc.defaultView!
  const changed = new WeakMap<Node, number[]>()
  let watching: MutationObserver | null = null
  let press: { x: number; y: number; t: number; host: HTMLElement; moved: boolean; reply: boolean; e: PointerEvent } | null = null
  let timer = 0, layer: HTMLElement | null = null

  /** The design on the stage el is in: its host, or for a design's portal the stage's. */
  const hostOf = (el: Element): HTMLElement | null => {
    const own = el.closest<HTMLElement>('[data-mount]')
    if (own) return own.closest('[data-thumb], [inert]') ? null : own
    if (!portaled(el)) return null
    return [...doc.querySelectorAll<HTMLElement>('[data-mount]')].find(m => !m.closest('[data-thumb], [inert]') && m.getClientRects().length > 0) ?? null
  }
  const design = (n: Node | null) => {
    const el = n instanceof Element ? n : n?.parentElement ?? null
    if (!el || uiBox().contains(el)) return false
    return !!el.closest('[data-mount]') || portaled(el) || el === doc.body || el === doc.documentElement
  }
  const watch = () => {
    if (watching) return
    watching = new MutationObserver(records => {
      const now = performance.now()
      for (const r of records) {
        if (!design(r.target)) continue
        // A part that kept changing before the press (a ticking clock, a loop) is not a reply to
        // it; one change before (the menu that just opened) says nothing.
        const times = changed.get(r.target) ?? []
        if (press && now >= press.t && times.filter(t => t < press!.t && press!.t - t < QUIET_BEFORE).length < 2) press.reply = true
        changed.set(r.target, [...times, now].slice(-3))
      }
    })
    watching.observe(doc.documentElement, { subtree: true, childList: true, attributes: true, characterData: true })
  }
  const unwatch = () => { watching?.disconnect(); watching = null }

  const answered = (from: Element, host: HTMLElement) => {
    const check = createCheck(win)
    const r = host.getBoundingClientRect(), box = { x: r.left, y: r.top, w: r.width, h: r.height }
    for (let el: Element | null = from; el && el !== doc.body && el !== doc.documentElement; el = el.parentElement) {
      if (el === host) break
      if (check(el, false) && !huge(el, box)) return true
    }
    return false
  }

  listen(doc, 'pointerdown', (e: PointerEvent) => {
    clearTimeout(timer)
    press = null
    if (!opts.on() || opts.paused() || !e.isPrimary || e.button !== 0 || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return
    const t = e.target instanceof Element ? e.target : null
    const host = t && hostOf(t)
    if (!t || !host || answered(t, host)) return
    watch()
    press = { x: e.clientX, y: e.clientY, t: performance.now(), host, moved: false, reply: false, e }
  }, { capture: true, passive: true })
  listen(doc, 'pointermove', (e: PointerEvent) => {
    if (press && e.isPrimary && Math.hypot(e.clientX - press.x, e.clientY - press.y) > MOVE) press.moved = true
  }, { capture: true, passive: true })
  listen(doc, 'pointercancel', () => { press = null }, { capture: true, passive: true })
  listen(doc, 'click', (e: MouseEvent) => {
    const p = press
    if (!p || e.detail > 1) { press = null; return }
    clearTimeout(timer)
    timer = win.setTimeout(() => {
      press = null
      if (p.moved || p.reply || p.e.defaultPrevented || e.defaultPrevented || !opts.on() || opts.paused() || !p.host.isConnected) return
      if (win.getSelection()?.toString()) return
      flash(p.host)
    }, WAIT)
  }, { capture: true, passive: true })

  /** Every element to press that is on screen now, in the design and what it rendered through a portal. */
  function spots(host: HTMLElement): { b: Box; radius: string }[] {
    const check = createCheck(win)
    const r = host.getBoundingClientRect(), hostBox = { x: r.left, y: r.top, w: r.width, h: r.height }
    const roots: Element[] = [host, ...[...doc.body.children].filter(c => portaled(c))]
    const out: { el: Element; b: Box; radius: string }[] = []
    let scanned = 0
    for (const root of roots) {
      for (const el of root.querySelectorAll('*')) {
        if (++scanned > SCAN || out.length >= MAX) break
        if (!check(el, true) || huge(el, hostBox)) continue
        const b = shown(el, win)
        if (!b || !onTop(el, b, win)) continue
        // A wrapper the same size as a lit parent adds nothing.
        const dup = out.find(o => o.el.contains(el) && Math.abs(o.b.x - b.x) < 4 && Math.abs(o.b.y - b.y) < 4 && Math.abs(o.b.w - b.w) < 4 && Math.abs(o.b.h - b.h) < 4)
        if (dup) continue
        out.push({ el, b, radius: win.getComputedStyle(el).borderRadius })
      }
    }
    return out
  }

  function flash(host: HTMLElement) {
    const list = spots(host)
    layer?.remove()
    if (!list.length) return
    const box = uiBox()
    layer = doc.createElement('div')
    layer.setAttribute('data-hotspots', '')
    layer.setAttribute('aria-hidden', 'true')
    layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483646;contain:strict'
    for (const s of list) {
      const d = doc.createElement('div')
      d.style.cssText = `position:absolute;left:${s.b.x}px;top:${s.b.y}px;width:${s.b.w}px;height:${s.b.h}px;border-radius:${s.radius};`
        + 'box-shadow:inset 0 0 0 2px var(--proto-primary-ring,#6366f1);background:color-mix(in srgb,var(--proto-primary-ring,#6366f1) 16%,transparent)'
      layer.append(d)
    }
    box.append(layer)
    const own = layer
    const done = () => { if (layer === own) { own.remove(); layer = null } }
    if (still()) { win.setTimeout(done, 700); return }
    own.animate([{ opacity: 0 }, { opacity: 1, offset: 0.15 }, { opacity: 1, offset: 0.6 }, { opacity: 0 }], { duration: 900, easing: 'ease-out' }).finished.then(done, done)
  }

  // Watching the page costs only while the press is pending, but parts already changing must be
  // known before a press: watch whenever this is on.
  const sync = () => { if (opts.on()) watch(); else { unwatch(); layer?.remove(); layer = null } }
  sync()
  return { sync }
}
