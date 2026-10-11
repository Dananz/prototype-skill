// Zooming and moving a device view (index.tsx), the view only, never the page: where the device sits
// in its area, two fingers or a trackpad's pinch around the point under them, and a wheel or a
// finger moving a zoomed view before the page inside scrolls. All of it measured in this page's px,
// where the frame is drawn at that moment: the frame's own px change with the zoom itself.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'

type Pt = { x: number; y: number }
export type Anchor = { at(p: Pt | null): void; hold(on: boolean): void }
/** Two fingers in the frame, in this page's px: the point between them at the start, then how far
 *  apart they are against the start, and the point. */
export type Pinch = { start(x: number, y: number): void; move(ratio: number, x: number, y: number): void; end(): void }

/** Fit to 200%. */
export const MAX = 200

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
  const x = dx < 0 ? a.scrollLeft > 0 : dx > 0 && a.scrollLeft < a.scrollWidth - a.clientWidth - 1
  const y = dy < 0 ? a.scrollTop > 0 : dy > 0 && a.scrollTop < a.scrollHeight - a.clientHeight - 1
  return { x, y }
}

/** Where a point of the frame's own px is drawn on this page, from the frame's box at this moment. */
export function outOf(f: HTMLElement | null | undefined, x: number, y: number) {
  if (!f) return [x, y] as const
  const r = f.getBoundingClientRect(), s = r.width / (f.offsetWidth || 1)
  return [r.left + x * s, r.top + y * s] as const
}

/**
 * Places the device in the area. At Fit it is centred (or at the top, when taller than the area).
 * Zooming keeps the spot of the page under the anchor (the fingers, the pointer, else the middle;
 * beside the device, its nearest edge) where it is, even if that takes part of the device past the
 * area's edge: the room it needs is padding around it, scrolled to. A centring done by layout
 * couldn't do that: the device would grow around the middle, away from the fingers. While a gesture
 * is held the device stays under the fingers, even at Fit; let go at Fit, it glides to the middle.
 */
export function usePlace(area: RefObject<HTMLDivElement | null>, box: { w: number; h: number }, d: { w: number; h: number }, scale: number, zoomed: boolean, pad: number, key: string) {
  const wrap = useRef<HTMLDivElement>(null)
  const anchor = useRef<Pt | null>(null)
  const [held, setHeld] = useState(false)
  const prev = useRef<{ key: string; scale: number; ox: number; oy: number; sl: number; st: number; free: boolean } | null>(null)
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
  useLayoutEffect(() => {
    const el = area.current, w = wrap.current
    if (!el || !w || !box.w) return
    const W = d.w * scale, H = d.h * scale
    // One side: the device's start `v` px from the area's start, seen through an area `A` long:
    // the padding before it, the scroll, and the padding after it that makes that scroll possible.
    const axis = (A: number, S: number, v: number) => { const o = Math.max(pad, v), s = o - v; return { o, s, end: Math.max(pad, s + A - o - S) } }
    const mid = (A: number, S: number) => (S + 2 * pad <= A ? (A - S) / 2 : pad)
    const p = prev.current
    const free = zoomed || held
    let vx = mid(box.w, W), vy = mid(box.h, H)
    if (p && p.key === key && free) {
      if (p.scale !== scale) {
        const a = anchor.current ?? { x: box.w / 2, y: box.h / 2 }
        const fx = (a.x + p.sl - p.ox) / p.scale, fy = (a.y + p.st - p.oy) / p.scale
        // Fingers beside the device hold its nearest edge, so it isn't pushed off the screen.
        const cx = Math.min(d.w, Math.max(0, fx)), cy = Math.min(d.h, Math.max(0, fy))
        vx = a.x + (cx - fx) * p.scale - cx * scale; vy = a.y + (cy - fy) * p.scale - cy * scale
      } else { vx = p.ox - p.sl; vy = p.oy - p.st }
    }
    const x = axis(box.w, W, vx), y = axis(box.h, H, vy)
    w.style.padding = `${y.o}px ${x.end}px ${y.end}px ${x.o}px`
    el.scrollLeft = x.s
    el.scrollTop = y.s
    // Let go at Fit: from where the fingers left it to the middle, gliding.
    const dev = w.firstElementChild as HTMLElement | null
    if (p && p.key === key && p.free && !free && dev && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const dx = (p.ox - p.sl) - (x.o - el.scrollLeft), dy = (p.oy - p.st) - (y.o - el.scrollTop)
      if (Math.hypot(dx, dy) > 1) dev.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: 280, easing: 'cubic-bezier(0.32, 0.72, 0, 1)' })
    }
    const kept = (asked: number, got: number) => (Math.abs(got - asked) < 1 ? asked : got)
    prev.current = { key, scale, ox: x.o, oy: y.o, sl: kept(x.s, el.scrollLeft), st: kept(y.s, el.scrollTop), free }
  }, [scale, key, box.w, box.h, d.w, d.h, zoomed, held, pad])
  return { wrap, anchor: useMemo<Anchor>(() => ({ at(p) { anchor.current = p }, hold(on) { setHeld(on) } }), []) }
}

/** Two fingers on the frame zoom the view around the point between them, from Fit up to 200%. */
export function usePinch(area: RefObject<HTMLElement | null>, scale: number, fit: number, setZoom: (z: number) => void, anchor: Anchor): Pinch {
  const s0 = useRef(scale)
  const now = useRef({ scale, fit, setZoom })
  now.current = { scale, fit, setZoom }
  return useMemo(() => ({
    start() { s0.current = now.current.scale; anchor.hold(true) },
    move(r, x, y) {
      const el = area.current
      if (el) { const a = el.getBoundingClientRect(); anchor.at({ x: x - a.left, y: y - a.top }) }
      const lo = now.current.fit * 100
      const z = Math.min(MAX, Math.max(lo, s0.current * r * 100))
      now.current.setZoom(z <= lo + 0.5 ? 0 : z)
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
 * (ctrl + wheel, or Safari's gesture events), each around the point under them, from Fit to 200%.
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
      const lo = fit * 100, v = Math.min(MAX, Math.max(lo, z))
      anchor.at({ x, y })
      setZoom(v <= lo + 0.5 ? 0 : v)
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
    // A mouse on the space around the device drags the view.
    let drag: Pt | null = null
    const pDown = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || e.button !== 0 || (e.target as Element).closest('iframe, [data-view-pick], button')) return
      drag = { x: e.clientX, y: e.clientY }; a.setPointerCapture(e.pointerId); a.style.cursor = 'grabbing'
    }
    const pMove = (e: PointerEvent) => { if (!drag) return; a.scrollLeft -= e.clientX - drag.x; a.scrollTop -= e.clientY - drag.y; drag = { x: e.clientX, y: e.clientY } }
    const pUp = () => { drag = null; a.style.cursor = '' }
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
      const cap = { passive: false, capture: true } as AddEventListenerOptions
      d.addEventListener('wheel', fWheel, cap)
      d.addEventListener('gesturestart', fgStart, cap)
      d.addEventListener('gesturechange', fgChange, cap)
      d.addEventListener('gestureend', gEnd, true)
      d.addEventListener('touchstart', fTStart, { passive: true, capture: true })
      d.addEventListener('touchmove', fTMove, cap)
      return () => {
        d.removeEventListener('wheel', fWheel, true); d.removeEventListener('gesturestart', fgStart, true); d.removeEventListener('gesturechange', fgChange, true); d.removeEventListener('gestureend', gEnd, true)
        d.removeEventListener('touchstart', fTStart, true); d.removeEventListener('touchmove', fTMove, true)
      }
    }
    return () => {
      clearTimeout(clear)
      binder.current = () => () => {}
      a.removeEventListener('wheel', wheel); a.removeEventListener('gesturestart', gStart); a.removeEventListener('gesturechange', gChange); a.removeEventListener('gestureend', gEnd)
      a.removeEventListener('touchstart', tStart); a.removeEventListener('touchmove', tMove); a.removeEventListener('touchend', tEnd); a.removeEventListener('touchcancel', tEnd)
      a.removeEventListener('pointerdown', pDown); a.removeEventListener('pointermove', pMove); a.removeEventListener('pointerup', pUp); a.removeEventListener('pointercancel', pUp)
    }
  }, [])
  return useCallback((d: Document) => binder.current(d), [])
}
