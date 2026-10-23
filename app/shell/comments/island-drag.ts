// Where the comments island is on a wide stage, and how it is dragged there. It always rests on an
// edge: flat on the foot or the top, upright on the left or the right (flush with that side). The
// engine draws straight to the card's transform every frame, never through a React render: held, the
// card chases the finger on a stiff spring and stretches past the stage's edges; let go, it springs
// to the nearest edge at the speed it was thrown. Near a side it turns upright while still held, and
// pulled well away it lies flat again. Docked, a change of height keeps its foot where it is (the
// rail grows upward from the tab), and opening the full-height panel and closing it again glides
// there and back to the very spot it left.
import { useEffect, useRef, type RefObject } from 'react'
import { listen } from '../quiet'
import type { Edge } from './island-prefs'

export type Side = 'left' | 'right'
type Pt = { x: number; y: number }
type Spring = { k: number; zeta: number }

const INSET = 16
const DOCK_AT = 56, UNDOCK_AT = 150
const HOLD: Spring = { k: 1100, zeta: 1 }
const SETTLE: Spring = { k: 300, zeta: 0.72 }
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi))
/** Past an edge the overshoot grows slower and slower, up to `r`, like a scroll view's. */
const rubber = (v: number, lo: number, hi: number, r = 120) => {
  if (v < lo) return lo - r * (1 - 1 / ((lo - v) * 0.55 / r + 1))
  if (v > hi) return hi + r * (1 - 1 / ((v - hi) * 0.55 / r + 1))
  return v
}
// The stage's edge arrows (shell.ts) sit in the middle of each side, 48 px tall: a tab resting
// upright keeps out of that band, just above or below it, whichever is nearer.
const ARROW = 24 + 8
const clear = (y: number, h: number, d: { H: number; foot: number }) => {
  const top = d.H / 2 - ARROW, bottom = d.H / 2 + ARROW
  if (y >= bottom || y + h <= top) return y
  const above = top - h, below = bottom
  const fitsAbove = above >= INSET, fitsBelow = below + h <= d.H - d.foot
  if (fitsAbove && (!fitsBelow || y - above <= below - y)) return above
  return fitsBelow ? below : y
}
const px = (el: Element, name: string) => parseFloat(getComputedStyle(el).getPropertyValue(name)) || 0

export function useEdgeDrag(o: {
  card: RefObject<HTMLDivElement | null>
  /** A wide screen with the island shown. */
  on: boolean
  place: Edge
  along: number
  /** Docked with the panel open: full height, top to foot. */
  full: boolean
  /** The side it is upright on while held (null: flat), so the card can turn as it goes. */
  onSide: (side: Side | null) => void
  onDrop: (place: Edge, along: number) => void
}) {
  const opts = useRef(o)
  opts.current = o
  const api = useRef<{ toPrefs: () => void } | null>(null)

  useEffect(() => {
    const el = o.card.current, host = el?.closest<HTMLElement>('[data-island-host]')
    if (!o.on || !el || !host) return
    const pos: Pt = { x: NaN, y: NaN }, vel: Pt = { x: 0, y: 0 }
    let goal: Pt = { x: 0, y: 0 }, mode: 'idle' | 'held' | 'settle' = 'idle', spring = SETTLE
    let raf = 0, last = 0, tracking = 0, lastH = 0, lastFull = false
    // Where it is upright while held, ahead of the props catching up.
    let side: Side | null = o.place === 'left' || o.place === 'right' ? o.place : null
    // The foot it had before going full height, so closing puts it back on the same spot.
    let foot: number | null = null
    let drag: { x: number; y: number; fx: number; fy: number; moved: boolean; id: number; samples: { t: number; x: number; y: number }[] } | null = null
    let pointer: Pt = { x: 0, y: 0 }

    // The stage's box, less what covers its foot (the phone pill, the motion dock, the copy bar).
    const dims = () => ({ W: host.clientWidth, H: host.clientHeight, w: el.offsetWidth, h: el.offsetHeight, foot: INSET + px(host, '--pill-h') + px(host, '--dock-h') + px(host, '--copy-h') })
    const full = () => !!side && opts.current.full
    const edgeX = (s: Side, d = dims()) => s === 'left' ? 0 : d.W - d.w
    const rest = (p: Pt): Pt => {
      const d = dims()
      if (side) return { x: edgeX(side, d), y: full() ? INSET : clamp(p.y, INSET, d.H - d.h - d.foot) }
      return { x: clamp(p.x, INSET, d.W - d.w - INSET), y: opts.current.place === 'top' ? INSET : d.H - d.h - d.foot }
    }
    const fromPrefs = (): Pt => {
      const { place, along } = opts.current, d = dims()
      if (place === 'left' || place === 'right') return { x: 0, y: along }
      return { x: (d.W - d.w) / 2 + along, y: 0 }
    }
    const draw = () => { el.style.transform = `translate3d(${Math.round(pos.x * 2) / 2}px, ${Math.round(pos.y * 2) / 2}px, 0)` }
    const step = (dt: number, sp: Spring) => {
      const c = 2 * sp.zeta * Math.sqrt(sp.k)
      for (let left = dt; left > 0; left -= 1 / 480) {
        const h = Math.min(left, 1 / 480)
        for (const a of ['x', 'y'] as const) {
          vel[a] += (-sp.k * (pos[a] - goal[a]) - c * vel[a]) * h
          pos[a] += vel[a] * h
        }
      }
    }
    const velocity = (): Pt => {
      const now = performance.now(), s = (drag?.samples ?? []).filter(p => now - p.t < 100)
      if (s.length < 2) return { x: 0, y: 0 }
      const a = s[0], z = s[s.length - 1], dt = (z.t - a.t) / 1000
      return dt > 0 ? { x: clamp((z.x - a.x) / dt, -4000, 4000), y: clamp((z.y - a.y) / dt, -4000, 4000) } : { x: 0, y: 0 }
    }
    const heldGoal = (): Pt => {
      const d = dims()
      if (!drag) return goal
      const y = rubber(pointer.y - drag.fy * d.h, INSET, d.H - d.h - d.foot)
      return side ? { x: edgeX(side, d), y: full() ? INSET : y } : { x: rubber(pointer.x - drag.fx * d.w, INSET, d.W - d.w - INSET), y }
    }
    const tick = (t: number) => {
      raf = 0
      const dt = Math.min((t - (last || t)) / 1000, 1 / 30)
      last = t
      if (mode === 'held') { goal = heldGoal(); step(dt, HOLD) }
      else if (mode === 'settle') {
        goal = rest(goal)
        step(dt, spring)
        if (Math.hypot(pos.x - goal.x, pos.y - goal.y) < 0.3 && Math.hypot(vel.x, vel.y) < 8) { pos.x = goal.x; pos.y = goal.y; vel.x = vel.y = 0; mode = 'idle' }
      } else {
        const hh = el.offsetHeight, f = full()
        if (f && !lastFull && lastH) foot = pos.y + lastH
        // Upright, a change of height keeps the foot where it is: the rail grows upward from the tab.
        if (side && lastH && hh !== lastH && !f && !lastFull && foot === null) pos.y += lastH - hh
        // Into full height and back out, the top glides there while the size animates.
        const to = rest(!f && foot !== null ? { x: pos.x, y: foot - hh } : pos), glide = f || foot !== null
        pos.x = to.x
        pos.y = glide ? pos.y + (to.y - pos.y) * (1 - Math.exp(-dt * 16)) : to.y
        goal = { ...pos }
      }
      lastH = el.offsetHeight
      lastFull = full()
      draw()
      if (mode !== 'idle' || tracking > performance.now()) raf = requestAnimationFrame(tick)
      else {
        last = 0
        // Back from full height: exactly on the foot it left from.
        if (!full() && foot !== null) { const to = rest({ x: pos.x, y: foot - el.offsetHeight }); pos.x = to.x; pos.y = to.y; draw() }
        if (!full()) foot = null
      }
    }
    const run = () => { if (!raf) raf = requestAnimationFrame(tick) }
    const follow = () => { tracking = performance.now() + 600; run() }

    // Where the preferences say, on mount and whenever they change from elsewhere (Settings, a
    // double-click home): it glides there.
    api.current = {
      toPrefs: () => {
        if (mode === 'held') return
        side = opts.current.place === 'left' || opts.current.place === 'right' ? opts.current.place : null
        const to = rest(fromPrefs())
        if (side && !full()) to.y = clear(to.y, el.offsetHeight, dims())
        if (Number.isNaN(pos.x)) { pos.x = to.x; pos.y = to.y; goal = { ...to }; draw(); el.style.visibility = ''; return }
        if (Math.hypot(pos.x - to.x, pos.y - to.y) < 0.5) return
        goal = to
        spring = { k: 260, zeta: 0.9 }
        mode = 'settle'
        run()
      },
    }
    api.current.toPrefs()

    const toHost = (ev: PointerEvent): Pt => { const r = host.getBoundingClientRect(); return { x: ev.clientX - r.left, y: ev.clientY - r.top } }
    // Anywhere on the island but its box and its list: a press that moves is a drag, one that does
    // not is a click. The move and the release are heard on the window, so the drag goes on outside.
    const down = (ev: PointerEvent) => {
      if (ev.button !== 0 || (ev.target as Element).closest('textarea, input, [data-island-list]')) return
      const r = el.getBoundingClientRect()
      drag = { x: ev.clientX, y: ev.clientY, fx: (ev.clientX - r.left) / r.width, fy: (ev.clientY - r.top) / r.height, moved: false, id: ev.pointerId, samples: [] }
    }
    const move = (ev: PointerEvent) => {
      if (!drag || ev.pointerId !== drag.id) return
      if (!drag.moved) {
        if (Math.hypot(ev.clientX - drag.x, ev.clientY - drag.y) < 4) return
        drag.moved = true
        // Moved by hand: the spot it opened the panel from no longer holds.
        foot = null
        el.dataset.held = ''
        mode = 'held'
      }
      pointer = toHost(ev)
      drag.samples.push({ t: performance.now(), ...pointer })
      if (drag.samples.length > 12) drag.samples.shift()
      const W = host.clientWidth
      const next: Side | null = side === 'left' ? (pointer.x > UNDOCK_AT ? null : 'left')
        : side === 'right' ? (pointer.x < W - UNDOCK_AT ? null : 'right')
        : pointer.x < DOCK_AT ? 'left' : pointer.x > W - DOCK_AT ? 'right' : null
      if (next !== side) {
        side = next
        // Flat again, the finger holds the bar's middle.
        if (!next) drag.fx = 0.5
        opts.current.onSide(next)
      }
      run()
    }
    const up = (ev: PointerEvent) => {
      if (!drag || ev.pointerId !== drag.id) return
      const d = drag
      drag = null
      if (!d.moved) return
      delete el.dataset.held
      // Let go anywhere, it goes to the nearest edge: upright on a side, flat on the top or the foot.
      const m = dims(), cx = pos.x + m.w / 2, cy = pos.y + m.h / 2
      let place: Edge = side ?? (cy < m.H - cy ? 'top' : 'bottom')
      if (!side) {
        const near = ([['left', cx], ['right', m.W - cx], ['top', cy], ['bottom', m.H - cy]] as const).reduce((a, b) => b[1] < a[1] ? b : a)[0]
        if (near === 'left' || near === 'right') { side = near; opts.current.onSide(near) }
        place = near
      }
      opts.current.place = place
      goal = rest(pos)
      if (side) goal.y = clear(goal.y, m.h, m)
      vel.x = vel.y = 0
      const v = velocity()
      vel.x = v.x; vel.y = v.y
      spring = SETTLE
      mode = 'settle'
      run()
      opts.current.onDrop(place, side ? goal.y : goal.x + m.w / 2 - m.W / 2)
      const eat = (c: Event) => { c.stopPropagation(); c.preventDefault() }
      el.addEventListener('click', eat, { capture: true, once: true })
      window.setTimeout(() => el.removeEventListener('click', eat, { capture: true }), 0)
    }
    el.addEventListener('pointerdown', down)
    listen(window, 'pointermove', move)
    listen(window, 'pointerup', up)
    listen(window, 'pointercancel', up)
    el.addEventListener('transitionrun', follow)
    // Its size changes (it turned, opened its list, grew for news) and the stage's does (the window,
    // the motion dock or the copy bar): it stays on its edge, inside the stage, as they do.
    const ro = new ResizeObserver(follow)
    ro.observe(el)
    ro.observe(host)
    const mo = new MutationObserver(follow)
    const zone = host.closest('[data-zone]')
    if (zone) mo.observe(zone, { attributes: true, attributeFilter: ['data-dock', 'data-copy', 'style'] })
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      mo.disconnect()
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('transitionrun', follow)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      api.current = null
    }
  }, [o.on])

  // The preferences changed from elsewhere: it goes there.
  useEffect(() => { api.current?.toPrefs() }, [o.place, o.along])
}
