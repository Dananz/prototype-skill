// Zooming and moving a device view (index.tsx), the view only, never the page: where the device sits
// in its area, two fingers or a trackpad's pinch around the point under them, and a wheel or a
// finger moving a zoomed view before the page inside scrolls. All of it measured in this page's px,
// where the frame is drawn at that moment: the frame's own px change with the zoom itself.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'

type Pt = { x: number; y: number }
export type Anchor = { at(p: Pt | null): void; hold(on: boolean): void; move(dx: number, dy: number): void }
/** Two fingers in the frame, in this page's px: the point between them at the start, then how far
 *  apart they are against the start, and the point. */
export type Pinch = { start(x: number, y: number): void; move(ratio: number, x: number, y: number): void; end(): void }

/** 10% to 400%, Fit somewhere between. */
export const MIN = 10
export const MAX = 400
/** A zoom (percent) on its way to `z`, kept to MIN–MAX; near Fit (`lo`) it stops there, as 0. */
const zoomAt = (z: number, lo: number) => { const v = Math.min(MAX, Math.max(MIN, z)); return Math.abs(v - lo) <= Math.max(0.5, lo * 0.02) ? 0 : v }

/** The area's size, kept up to date. */
export function useBox<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [s, setS] = useState({ w: 0, h: 0 })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const f = () => setS(p => (p.w === el.clientWidth && p.h === el.clientHeight ? p : { w: el.clientWidth, h: el.clientHeight }))
    f()
    const ro = new ResizeObserver(f)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, s] as const
}

/** Fit: the device as wide as the area, never above 100%. */
export const fitOf = (area: { w: number; h: number }, d: { w: number; h: number }, pad: number) => (!area.w ? 0.25 : Math.min(1, (area.w - pad * 2) / d.w))

/** Whether the area can still scroll by (dx, dy) on each axis. */
export function room(a: HTMLElement, dx: number, dy: number) {
  // Right to left, scrollLeft runs from minus the overflow up to 0; measured here from the left.
  const max = a.scrollWidth - a.clientWidth, left = getComputedStyle(a).direction === 'rtl' ? a.scrollLeft + max : a.scrollLeft
  const x = dx < 0 ? left > 0 : dx > 0 && left < max - 1
  const y = dy < 0 ? a.scrollTop > 0 : dy > 0 && a.scrollTop < a.scrollHeight - a.clientHeight - 1
  return { x, y }
}

/** Where a point of the frame's own px is drawn on this page, from the frame's box at this moment. */
export function outOf(f: HTMLElement | null | undefined, x: number, y: number) {
  if (!f) return [x, y] as const
  const r = f.getBoundingClientRect(), s = r.width / (f.offsetWidth || 1)
  return [r.left + x * s, r.top + y * s] as const
}

/** One side: the device's start `v` px from the area's start, seen through an area `A` long: the
 *  padding before it, the scroll, and the padding after it that makes that scroll possible. */
const axis = (A: number, S: number, v: number, pad: number) => { const o = Math.max(pad, v), s = o - v; return { o, s, end: Math.max(pad, s + A - o - S) } }
/** How much of the device a drag always leaves in the area, in this page's px. */
const KEEP = 48

/**
 * Places the device in the area. At first it is centred (or at the top, when taller than the area).
 * Zooming keeps the spot of the page under the anchor (the fingers, the pointer, else the middle;
 * beside the device, its nearest edge) where it is, even if that takes part of the device past the
 * area's edge: the room it needs is padding around it, scrolled to. A centring done by layout
 * couldn't do that: the device would grow around the middle, away from the fingers. Once a hand has
 * moved it (a drag, a pinch, a trackpad zoom) it stays where it was left, at any zoom, Fit included:
 * it never goes back to the middle on its own. Another size, or Fit chosen from the zoom control
 * (`home` counts those), centres it again.
 */
export function usePlace(area: RefObject<HTMLDivElement | null>, box: { w: number; h: number }, d: { w: number; h: number }, scale: number, zoomed: boolean, pad: number, key: string, home = 0, ins = { l: 0, t: 0, r: 0, b: 0 }) {
  const wrap = useRef<HTMLDivElement>(null)
  const anchor = useRef<Pt | null>(null)
  const [held, setHeld] = useState(false)
  const moved = useRef(false)
  const prev = useRef<{ key: string; home: number; scale: number; ox: number; oy: number; sl: number; st: number } | null>(null)
  const now = useRef({ box, d, scale, pad, key, home })
  now.current = { box, d, scale, pad, key, home }
  // The scroll as it was before a change, not after the browser clamps it to a smaller device. A
  // scroll is kept as it was asked for, not as the browser rounded it: taken as the truth, the
  // rounding of each step of a pinch adds up, and the page slides out from under the fingers.
  useEffect(() => {
    const el = area.current
    if (!el) return
    const f = () => {
      const p = prev.current
      if (!p) return
      if (Math.abs(el.scrollLeft - p.sl) >= 1) p.sl = el.scrollLeft
      if (Math.abs(el.scrollTop - p.st) >= 1) p.st = el.scrollTop
    }
    el.addEventListener('scroll', f, { passive: true })
    return () => el.removeEventListener('scroll', f)
  }, [])
  // The device's start (vx, vy) from the area's start, laid out as padding and scroll.
  const lay = (vx: number, vy: number) => {
    const el = area.current, w = wrap.current
    if (!el || !w) return
    const { box, d, scale, pad, key, home } = now.current
    const x = axis(box.w, d.w * scale, vx, pad), y = axis(box.h, d.h * scale, vy, pad)
    w.style.padding = `${y.o}px ${x.end}px ${y.end}px ${x.o}px`
    el.scrollLeft = x.s
    el.scrollTop = y.s
    const kept = (asked: number, got: number) => (Math.abs(got - asked) < 1 ? asked : got)
    prev.current = { key, home, scale, ox: x.o, oy: y.o, sl: kept(x.s, el.scrollLeft), st: kept(y.s, el.scrollTop) }
  }
  useLayoutEffect(() => {
    if (!area.current || !wrap.current || !box.w) return
    const W = d.w * scale, H = d.h * scale
    // In the room clear of the chrome over the area (ins), when the area runs under it.
    const mid = (A: number, S: number, a: number, b: number) => a + (S + 2 * pad <= A - a - b ? (A - a - b - S) / 2 : pad)
    const p = prev.current
    const same = !!p && p.key === key && p.home === home
    if (!same) moved.current = false
    else if (held || anchor.current) moved.current = true
    let vx = mid(box.w, W, ins.l, ins.r), vy = mid(box.h, H, ins.t, ins.b)
    if (p && same && (zoomed || held || moved.current)) {
      if (p.scale !== scale) {
        const a = anchor.current ?? { x: ins.l + (box.w - ins.l - ins.r) / 2, y: ins.t + (box.h - ins.t - ins.b) / 2 }
        const fx = (a.x + p.sl - p.ox) / p.scale, fy = (a.y + p.st - p.oy) / p.scale
        // Fingers beside the device hold its nearest edge, so it isn't pushed off the screen.
        const cx = Math.min(d.w, Math.max(0, fx)), cy = Math.min(d.h, Math.max(0, fy))
        vx = a.x + (cx - fx) * p.scale - cx * scale; vy = a.y + (cy - fy) * p.scale - cy * scale
      } else { vx = p.ox - p.sl; vy = p.oy - p.st }
    }
    lay(vx, vy)
  }, [scale, key, home, box.w, box.h, d.w, d.h, zoomed, held, pad, ins.l, ins.t, ins.r, ins.b])
  return {
    wrap,
    anchor: useMemo<Anchor>(() => ({
      at(p) { anchor.current = p },
      hold(on) { setHeld(on) },
      // A drag: the device follows the hand by (dx, dy), at any zoom, and stays where it is let go.
      // Some of it always stays in the area, so it can be taken hold of again.
      move(dx, dy) {
        const p = prev.current
        if (!p) return
        moved.current = true
        const { box, d, scale } = now.current
        const keep = (v: number, A: number, S: number) => Math.min(A - Math.min(KEEP, S), Math.max(Math.min(KEEP, S) - S, v))
        lay(keep(p.ox - p.sl + dx, box.w, d.w * scale), keep(p.oy - p.st + dy, box.h, d.h * scale))
      },
    }), []),
  }
}

/** Two fingers on the frame zoom the view around the point between them, from 10% up to 400%. */
export function usePinch(area: RefObject<HTMLElement | null>, scale: number, fit: number, setZoom: (z: number) => void, anchor: Anchor): Pinch {
  const s0 = useRef(scale)
  const now = useRef({ scale, fit, setZoom })
  now.current = { scale, fit, setZoom }
  return useMemo(() => ({
    start() { s0.current = now.current.scale; anchor.hold(true) },
    move(r, x, y) {
      const el = area.current
      if (el) { const a = el.getBoundingClientRect(); anchor.at({ x: x - a.left, y: y - a.top }) }
      now.current.setZoom(zoomAt(s0.current * r * 100, now.current.fit * 100))
    },
    end() { anchor.at(null); anchor.hold(false) },
  }), [])
}

type G = Event & { scale: number; clientX: number; clientY: number }

/**
 * Two fingers in the frame's document: the view's zoom, not the browser's. Each finger is measured
 * in this page's px, from where the frame is drawn at that moment: in the frame's own px a distance
 * shrinks and grows with each step and pushes the zoom back against the fingers (it went 29, 31,
 * 30, 32, 32 …), and Touch.screenX is unknown on iOS inside a frame. Returns the unbinding.
 */
export function pinchOn(d: Document, p: Pinch) {
  let d0 = 0
  const f = () => d.defaultView?.frameElement as HTMLElement | null
  const two = (t: TouchList) => {
    const [ax, ay] = outOf(f(), t[0].clientX, t[0].clientY), [bx, by] = outOf(f(), t[1].clientX, t[1].clientY)
    return { d: Math.hypot(ax - bx, ay - by), x: (ax + bx) / 2, y: (ay + by) / 2 }
  }
  const start = (e: TouchEvent) => { if (e.touches.length === 2) { const g = two(e.touches); d0 = g.d; p.start(g.x, g.y) } }
  const move = (e: TouchEvent) => {
    if (e.touches.length !== 2 || !d0) return
    e.preventDefault()
    const g = two(e.touches)
    p.move(g.d / d0, g.x, g.y)
  }
  const end = (e: TouchEvent) => { if (d0 && e.touches.length < 2) { d0 = 0; p.end() } }
  // Safari's own pinch, which would zoom the page outside.
  const gesture = (e: Event) => e.preventDefault()
  d.addEventListener('touchstart', start, { passive: true, capture: true })
  d.addEventListener('touchmove', move, { passive: false, capture: true })
  d.addEventListener('touchend', end, { capture: true })
  d.addEventListener('touchcancel', end, { capture: true })
  d.addEventListener('gesturestart', gesture, { passive: false })
  return () => {
    d.removeEventListener('touchstart', start, { capture: true }); d.removeEventListener('touchmove', move, { capture: true })
    d.removeEventListener('touchend', end, { capture: true }); d.removeEventListener('touchcancel', end, { capture: true })
    d.removeEventListener('gesturestart', gesture)
  }
}

/**
 * The view zooms on its own, never the page: two fingers anywhere in the area, a trackpad's pinch
 * (ctrl + wheel, or Safari's gesture events), each around the point under them, from 10% to 400%. Held Space drags it, and so does the middle
 * button, from anywhere.
 * Once zoomed in, it moves: a wheel or one finger on the device moves the view first, and only at
 * its edge scrolls the page inside; a mouse drags the space around the device. Returns what binds
 * the same to the frame's document, each time it loads.
 */
export function useGestures(area: RefObject<HTMLDivElement | null>, scale: number, fit: number, setZoom: (z: number) => void, anchor: Anchor) {
  const now = useRef({ scale, fit, setZoom })
  now.current = { scale, fit, setZoom }
  const binder = useRef<(d: Document) => () => void>(() => () => {})
  useEffect(() => {
    const a = area.current
    if (!a) return
    let clear = 0, fingers = false
    // Zoom to `z` (percent) keeping the area point (x, y) still.
    const zoomTo = (z: number, x: number, y: number) => {
      const { fit, setZoom } = now.current
      anchor.at({ x, y })
      setZoom(zoomAt(z, fit * 100))
      // A trackpad pinch has no end of its own: it ends when its wheel stops.
      if (!fingers) { anchor.hold(true); clearTimeout(clear); clear = window.setTimeout(() => { anchor.at(null); anchor.hold(false) }, 200) }
    }
    const frame = () => a.querySelector('iframe')
    const fromPage = (x: number, y: number) => { const r = a.getBoundingClientRect(); return [x - r.left, y - r.top] as const }
    const fromFrame = (x: number, y: number) => fromPage(...outOf(frame(), x, y))
    const step = (dy: number) => now.current.scale * 100 * Math.exp(-Math.max(-25, Math.min(25, dy)) * 0.01)
    const zoomed = () => now.current.scale > now.current.fit + 0.001

    // In the area, around the device (and over it, through the layer that covers it while commenting).
    const wheel = (e: WheelEvent) => { if (!e.ctrlKey) return; e.preventDefault(); zoomTo(step(e.deltaY), ...fromPage(e.clientX, e.clientY)) }
    let g0 = 0
    const gStart = (e: Event) => { e.preventDefault(); g0 = now.current.scale; fingers = true; anchor.hold(true) }
    const gEnd = () => { fingers = false; anchor.at(null); anchor.hold(false) }
    const gChange = (e: Event) => { e.preventDefault(); const g = e as G; zoomTo(g0 * g.scale * 100, ...fromPage(g.clientX, g.clientY)) }
    let t0 = 0, s0 = 0
    const dist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY)
    const tStart = (e: TouchEvent) => { if (e.touches.length === 2) { t0 = dist(e.touches); s0 = now.current.scale; fingers = true; anchor.hold(true) } }
    const tMove = (e: TouchEvent) => {
      if (e.touches.length !== 2 || !t0) return
      e.preventDefault()
      const t = e.touches
      zoomTo(s0 * (dist(t) / t0) * 100, ...fromPage((t[0].clientX + t[1].clientX) / 2, (t[0].clientY + t[1].clientY) / 2))
    }
    const tEnd = (e: TouchEvent) => { if (e.touches.length < 2 && t0) { t0 = 0; fingers = false; anchor.at(null); anchor.hold(false) } }
    // A mouse on the space around the device drags the view, and anywhere while Space is held (as in
    // Figma): the frame stops taking the pointer until it is let go.
    let drag: Pt | null = null, space = false
    const pan = (on: boolean) => {
      if (space === on) return
      space = on
      const f = frame()
      if (f) f.style.pointerEvents = on ? 'none' : ''
      if (!drag) a.style.cursor = on ? 'grab' : ''
    }
    // Space is a focused control's own (a button presses on it) and a field's: those keep it.
    const typing = (t: EventTarget | null) => !!(t as Element | null)?.closest?.('input, textarea, select, [contenteditable], button, a[href], summary, [role="button"], [role="menuitem"], [role="option"], [role="tab"], [role="checkbox"], [role="switch"], [role="radio"], [role="slider"]')
    const kDown = (e: KeyboardEvent) => { if (e.key === ' ' && !typing(e.target) && !e.metaKey && !e.ctrlKey && !e.altKey && a.isConnected && a.offsetParent) { e.preventDefault(); pan(true) } }
    const kUp = (e: KeyboardEvent) => { if (e.key === ' ') pan(false) }
    const blur = () => pan(false)
    const pDown = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || e.button !== 0 || (!space && (e.target as Element).closest('iframe, [data-view-pick], button'))) return
      e.preventDefault()
      drag = { x: e.clientX, y: e.clientY }; a.setPointerCapture(e.pointerId); a.style.cursor = 'grabbing'
    }
    const pMove = (e: PointerEvent) => { if (!drag) return; anchor.move(e.clientX - drag.x, e.clientY - drag.y); drag = { x: e.clientX, y: e.clientY } }
    const pUp = () => { drag = null; a.style.cursor = space ? 'grab' : '' }

    // The middle button (the wheel pressed) drags the device from anywhere, over the design too, as in
    // FL Studio: an open hand, the device following it 1:1 at any zoom, and staying where it is let
    // go. Neither the design nor the browser (its autoscroll, a link opening in a new tab) sees that
    // button meanwhile. Measured in this page's px, so the frame moving under it doesn't count.
    let mid: Pt | null = null
    const hand = (on: boolean) => {
      for (const d of [document, frame()?.contentDocument].filter(Boolean) as Document[]) {
        d.querySelector('style[data-view-hand]')?.remove()
        if (on) { const s = d.createElement('style'); s.dataset.viewHand = ''; s.textContent = '*, *::before, *::after { cursor: grab !important; user-select: none !important; }'; (d.head ?? d.documentElement).append(s) }
      }
    }
    const midStart = (x: number, y: number) => { mid = { x, y }; hand(true) }
    const midMove = (x: number, y: number) => { if (!mid) return; anchor.move(x - mid.x, y - mid.y); mid = { x, y } }
    const midEnd = () => { if (!mid) return; mid = null; hand(false) }
    // Only the middle button's own events, and every event while it drags.
    const isMid = (e: MouseEvent) => e.button === 1 || (!!mid && e.type !== 'pointermove')
    const hush = (e: MouseEvent) => { if (isMid(e)) { e.preventDefault(); e.stopImmediatePropagation() } }
    const mDown = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || e.button !== 1) return
      hush(e); a.setPointerCapture(e.pointerId); midStart(e.clientX, e.clientY)
    }
    // Chord releases are pointermove until the last button is up; middle need not own pointerup.
    const mMove = (e: PointerEvent) => {
      if (!mid) return
      if (!(e.buttons & 4)) { hush(e); midEnd(); return }
      midMove(e.clientX, e.clientY)
    }
    const mUp = (e: PointerEvent) => { if (mid && (e.button === 1 || !(e.buttons & 4))) { hush(e); midEnd() } }
    const opts = { passive: false } as AddEventListenerOptions
    a.addEventListener('wheel', wheel, opts)
    a.addEventListener('gesturestart', gStart, opts)
    a.addEventListener('gesturechange', gChange, opts)
    a.addEventListener('gestureend', gEnd)
    a.addEventListener('touchstart', tStart, { passive: true })
    a.addEventListener('touchmove', tMove, opts)
    a.addEventListener('touchend', tEnd); a.addEventListener('touchcancel', tEnd)
    a.addEventListener('pointerdown', pDown); a.addEventListener('pointermove', pMove)
    a.addEventListener('pointerup', pUp); a.addEventListener('pointercancel', pUp)
    addEventListener('keydown', kDown); addEventListener('keyup', kUp); addEventListener('blur', blur)
    a.addEventListener('pointerdown', mDown, true); a.addEventListener('pointermove', mMove, true)
    a.addEventListener('pointerup', mUp, true); a.addEventListener('pointercancel', midEnd, true)
    for (const t of ['mousedown', 'mouseup', 'auxclick'] as const) a.addEventListener(t, hush, true)
    addEventListener('blur', midEnd)

    // In the frame's document: its own two fingers are pinchOn's; here the trackpad's, and moving a
    // zoomed view with the wheel or one finger. One finger is measured in this page's px too, from
    // where the frame is drawn, so the device sliding under it doesn't count as the finger moving.
    binder.current = d => {
      let last: Pt | null = null
      const out = (t: Touch) => { const [x, y] = outOf(d.defaultView?.frameElement as HTMLElement | null, t.clientX, t.clientY); return { x, y } }
      const fWheel = (e: WheelEvent) => {
        if (e.ctrlKey) { e.preventDefault(); zoomTo(step(e.deltaY), ...fromFrame(e.clientX, e.clientY)); return }
        if (!zoomed()) return
        const r = room(a, e.deltaX, e.deltaY)
        if (!r.x && !r.y) return
        e.preventDefault()
        a.scrollBy(r.x ? e.deltaX : 0, r.y ? e.deltaY : 0)
      }
      const fgStart = (e: Event) => { e.preventDefault(); g0 = now.current.scale; fingers = true; anchor.hold(true) }
      const fgChange = (e: Event) => { e.preventDefault(); const g = e as G; zoomTo(g0 * g.scale * 100, ...fromFrame(g.clientX, g.clientY)) }
      const fTStart = (e: TouchEvent) => { last = e.touches.length === 1 ? out(e.touches[0]) : null }
      const fTMove = (e: TouchEvent) => {
        if (!last || e.touches.length !== 1 || !zoomed()) return
        const p = out(e.touches[0]), dx = last.x - p.x, dy = last.y - p.y
        last = p
        const r = room(a, dx, dy)
        if (!r.x && !r.y) return
        e.preventDefault()
        a.scrollBy(r.x ? dx : 0, r.y ? dy : 0)
      }
      const pageOf = (e: MouseEvent) => outOf(d.defaultView?.frameElement as HTMLElement | null, e.clientX, e.clientY)
      const fmDown = (e: PointerEvent) => {
        if (e.pointerType !== 'mouse' || e.button !== 1) return
        hush(e)
        try { d.documentElement.setPointerCapture(e.pointerId) } catch { /* the pointer is gone already */ }
        midStart(...pageOf(e))
      }
      const fmMove = (e: PointerEvent) => {
        if (!mid) return
        if (!(e.buttons & 4)) { hush(e); midEnd(); return }
        midMove(...pageOf(e))
      }
      const fmUp = (e: PointerEvent) => { if (mid && (e.button === 1 || !(e.buttons & 4))) { hush(e); midEnd() } }
      const cap = { passive: false, capture: true } as AddEventListenerOptions
      d.addEventListener('pointerdown', fmDown, cap); d.addEventListener('pointermove', fmMove, true)
      d.addEventListener('pointerup', fmUp, cap); d.addEventListener('pointercancel', midEnd, true)
      for (const t of ['mousedown', 'mouseup', 'auxclick'] as const) d.addEventListener(t, hush, cap)
      d.addEventListener('wheel', fWheel, cap)
      d.addEventListener('gesturestart', fgStart, cap)
      d.addEventListener('gesturechange', fgChange, cap)
      d.addEventListener('gestureend', gEnd, true)
      d.addEventListener('touchstart', fTStart, { passive: true, capture: true })
      d.addEventListener('touchmove', fTMove, cap)
      d.addEventListener('keydown', kDown, true); d.addEventListener('keyup', kUp, true)
      return () => {
        midEnd()
        d.removeEventListener('pointerdown', fmDown, true); d.removeEventListener('pointermove', fmMove, true)
        d.removeEventListener('pointerup', fmUp, true); d.removeEventListener('pointercancel', midEnd, true)
        for (const t of ['mousedown', 'mouseup', 'auxclick'] as const) d.removeEventListener(t, hush, true)
        d.removeEventListener('keydown', kDown, true); d.removeEventListener('keyup', kUp, true)
        d.removeEventListener('wheel', fWheel, true); d.removeEventListener('gesturestart', fgStart, true); d.removeEventListener('gesturechange', fgChange, true); d.removeEventListener('gestureend', gEnd, true)
        d.removeEventListener('touchstart', fTStart, true); d.removeEventListener('touchmove', fTMove, true)
      }
    }
    return () => {
      clearTimeout(clear)
      pan(false)
      midEnd()
      a.removeEventListener('pointerdown', mDown, true); a.removeEventListener('pointermove', mMove, true)
      a.removeEventListener('pointerup', mUp, true); a.removeEventListener('pointercancel', midEnd, true)
      for (const t of ['mousedown', 'mouseup', 'auxclick'] as const) a.removeEventListener(t, hush, true)
      removeEventListener('blur', midEnd)
      removeEventListener('keydown', kDown); removeEventListener('keyup', kUp); removeEventListener('blur', blur)
      binder.current = () => () => {}
      a.removeEventListener('wheel', wheel); a.removeEventListener('gesturestart', gStart); a.removeEventListener('gesturechange', gChange); a.removeEventListener('gestureend', gEnd)
      a.removeEventListener('touchstart', tStart); a.removeEventListener('touchmove', tMove); a.removeEventListener('touchend', tEnd); a.removeEventListener('touchcancel', tEnd)
      a.removeEventListener('pointerdown', pDown); a.removeEventListener('pointermove', pMove); a.removeEventListener('pointerup', pUp); a.removeEventListener('pointercancel', pUp)
    }
  }, [])
  return useCallback((d: Document) => binder.current(d), [])
}
