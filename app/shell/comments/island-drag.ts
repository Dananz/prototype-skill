// Where the comments island is on a wide stage, and how it is dragged there. It always rests on an
// edge: flat on the foot or the top, or upright on the side, flush with it. The side is the stage's
// end, beside the side panel: the right in English, the left in Hebrew (the engine's x runs from the
// stage's start, and is turned around only where it meets the page: the pointer and the card). The
// engine draws straight to the card's transform every frame, never through a React render: held, the
// card chases the finger on a stiff spring and stretches past the stage's edges; let go, it springs
// to the nearest edge at the speed it was thrown. Near a side it turns upright while still held, and
// pulled well away it lies flat again. Docked, a change of height keeps its foot where it is (the
// rail grows upward from the tab), and opening the full-height panel and closing it again glides
// there and back to the very spot it left. It follows a change of size until the size stops
// changing, not for a set time, so a design that slows the page to a few frames a second can't
// leave it stuck halfway (a full-height panel hanging off the stage's foot).
import { useEffect, useRef, type RefObject } from 'react'
import { listen } from '../quiet'
import { rtl } from '../i18n'
import type { Edge } from './island-prefs'

export type Side = 'right'
type Pt = { x: number; y: number }
type Spring = { k: number; zeta: number }

const INSET = 16
// Docking and undocking are a band apart, so a hand wavering near the edge doesn't flip it; pulled
// a little way off the right edge (about 50px from the tab), it lies flat at once.
const DOCK_AT = 40, UNDOCK_AT = 76
// Held, it sticks to the pointer; only when it moves between the foot and the right edge does it
// glide there (GLIDE_MS), rather than leap. Let go, it settles with barely a wobble.
const HOLD: Spring = { k: 900, zeta: 1 }
const GLIDE_MS = 220
const SETTLE: Spring = { k: 320, zeta: 0.86 }
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
  /** Picked up (true) and let go (false), so its open list can fold out of the way. */
  onHold: (held: boolean) => void
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
    let raf = 0, last = 0, tracking = 0, lastH = 0, lastW = 0, glideUntil = 0
    // A change of height while upright (the rail, the panel, back to the tab): the top moves in step
    // with the height as it animates, from where it was to where it ends, so both edges glide together.
    type Morph = { h0: number; y0: number; h1: number; y1: number }
    let morph: Morph | null = null
    const along = (m: Morph, h: number) => m.y0 + (m.y1 - m.y0) * (m.h1 === m.h0 ? 1 : clamp((h - m.h0) / (m.h1 - m.h0), 0, 1))
    // Where it is upright while held, ahead of the props catching up.
    let side: Side | null = o.place === 'right' ? 'right' : null
    // The foot it had before going full height, so closing puts it back on the same spot.
    let foot: number | null = null
    let drag: { x: number; y: number; fx: number; fy: number; moved: boolean; id: number; samples: { t: number; x: number; y: number }[] } | null = null
    let pointer: Pt = { x: 0, y: 0 }

    // The stage's box, less what covers its foot (the phone pill, the motion dock, the copy bar).
    // `out` is how far past the stage's end the screen goes on: on the desk the stage ends a gap
    // short of the window (or of the side panel), and upright the island stands flush with that edge.
    const dims = () => {
      const zone = host.closest<HTMLElement>('[data-zone]'), hw = zone ? px(zone, '--hw') : 0, r = host.getBoundingClientRect()
      const z = hw && zone ? zone.getBoundingClientRect() : null
      const out = rtl ? r.left - (z ? z.left + hw : 0) : (z ? z.right - hw : document.documentElement.clientWidth) - r.right
      return { W: host.clientWidth, H: host.clientHeight, w: el.offsetWidth, h: el.offsetHeight, out: Math.max(0, out), foot: INSET + px(host, '--pill-h') + px(host, '--dock-h') + px(host, '--copy-h') }
    }
    const full = () => !!side && opts.current.full
    const edgeX = (d = dims()) => d.W - d.w + d.out
    const rest = (p: Pt): Pt => {
      const d = dims()
      if (side) return { x: edgeX(d), y: full() ? INSET : clamp(p.y, INSET, d.H - d.h - d.foot) }
      return { x: clamp(p.x, INSET, d.W - d.w - INSET), y: opts.current.place === 'top' ? INSET : d.H - d.h - d.foot }
    }
    const fromPrefs = (): Pt => {
      const { place, along } = opts.current, d = dims()
      if (place === 'right') return { x: 0, y: along }
      return { x: (d.W - d.w) / 2 + along, y: 0 }
    }
    // In Hebrew the card stands at the stage's right (start-0) and moves left.
    const draw = () => { el.style.transform = `translate3d(${Math.round((rtl ? -pos.x : pos.x) * 2) / 2}px, ${Math.round(pos.y * 2) / 2}px, 0)` }
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
      // Upright, it slides up and down the side edge; pulled off it, it drops onto the foot and slides
      // only sideways along it, until it is pulled to the right edge again.
      if (side) return { x: edgeX(d), y: full() ? INSET : rubber(pointer.y - drag.fy * d.h, INSET, d.H - d.h - d.foot) }
      return { x: rubber(pointer.x - drag.fx * d.w, INSET, d.W - d.w - INSET), y: d.H - d.h - d.foot }
    }
    const tick = (t: number) => {
      raf = 0
      const dt = Math.min((t - (last || t)) / 1000, 1 / 10)
      last = t
      if (mode === 'held') {
        goal = heldGoal()
        if (performance.now() < glideUntil) step(dt, HOLD)
        else { pos.x = goal.x; pos.y = goal.y; vel.x = vel.y = 0 }
      }
      else if (mode === 'settle') {
        // Flat, its spot is its centre (from the preferences), so it keeps it while it widens out.
        goal = side ? rest(goal) : rest(fromPrefs())
        step(dt, spring)
        if (Math.hypot(pos.x - goal.x, pos.y - goal.y) < 0.3 && Math.hypot(vel.x, vel.y) < 8) { pos.x = goal.x; pos.y = goal.y; vel.x = vel.y = 0; mode = 'idle' }
      } else if (side) {
        const d = dims(), f = full(), hh = d.h
        // The height it is animating to: the card's own, or the full one (the stage less its insets).
        const h1 = el.style.height.endsWith('px') ? parseFloat(el.style.height) : d.H - INSET - d.foot
        if (Math.abs(hh - h1) > 0.5) {
          if (!morph || morph.h1 !== h1) {
            // Turned back on the way (the pointer passed quickly): it starts again from where the last
            // change had it at this very height, not from where the last frame drew it at another.
            const h0 = morph ? hh : lastH || hh, y0 = morph ? along(morph, hh) : pos.y
            // Going full height, it remembers its foot; coming back, it ends on that foot; otherwise
            // the foot stays where it is (the rail grows upward from the tab).
            if (f && foot === null) foot = y0 + h0
            const y1 = f ? INSET : foot !== null ? foot - h1 : y0 + h0 - h1
            morph = { h0, y0, h1, y1: clamp(y1, INSET, d.H - h1 - d.foot) }
          }
          pos.y = along(morph, hh)
          pos.x = edgeX(d)
        } else {
          // Done: where the change has it at the height it ended on (its end spot, or, called back
          // between two frames of a slow page, the spot it started from).
          if (morph) { pos.y = along(morph, hh); morph = null }
          if (!f) foot = null
          const to = rest(pos)
          pos.x = to.x
          pos.y = to.y
        }
        goal = { ...pos }
      } else {
        const to = rest(fromPrefs())
        pos.x = to.x
        pos.y = to.y
        goal = { ...pos }
      }
      // Still changing size (a transition, at whatever frame rate): keep following until it rests.
      if (el.offsetHeight !== lastH || el.offsetWidth !== lastW || morph || el.getAnimations().length) tracking = Math.max(tracking, performance.now() + 150)
      lastH = el.offsetHeight
      lastW = el.offsetWidth
      draw()
      if (mode !== 'idle' || tracking > performance.now()) raf = requestAnimationFrame(tick)
      else last = 0
    }
    const run = () => { if (!raf) raf = requestAnimationFrame(tick) }
    const follow = () => { tracking = performance.now() + 600; run() }

    // Where the preferences say, on mount and whenever they change from elsewhere (Settings, a
    // double-click home): it glides there.
    api.current = {
      toPrefs: () => {
        if (mode === 'held') return
        side = opts.current.place === 'right' ? 'right' : null
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

    const toHost = (ev: PointerEvent): Pt => { const r = host.getBoundingClientRect(); return { x: rtl ? r.right - ev.clientX : ev.clientX - r.left, y: ev.clientY - r.top } }
    // Anywhere on the island but its list (and the box while it is being typed in): a press that moves
    // is a drag, one that does not is a click. The box is most of the bar, so it is a handle too until
    // it has the cursor. The move and the release are heard on the window, so the drag goes on outside.
    const down = (ev: PointerEvent) => {
      const at = ev.target as Element, box = at.closest('textarea')
      // The open list's header is a handle too (the rest of the list scrolls and selects).
      if (ev.button !== 0 || at.closest('input, [data-island-resize]') || (at.closest('[data-island-list]') && !at.closest('[data-island-grip]')) || (box && document.activeElement === box)) return
      const r = el.getBoundingClientRect()
      drag = { x: ev.clientX, y: ev.clientY, fx: (rtl ? r.right - ev.clientX : ev.clientX - r.left) / r.width, fy: (ev.clientY - r.top) / r.height, moved: false, id: ev.pointerId, samples: [] }
    }
    const move = (ev: PointerEvent) => {
      if (!drag || ev.pointerId !== drag.id) return
      // No button down any more: the release was missed (let go over the design's iframe, or after
      // the hold on the pointer was lost). It is let go here, so it never sticks to the cursor.
      if (ev.pointerType === 'mouse' && !(ev.buttons & 1)) return up(ev)
      if (!drag.moved) {
        if (Math.hypot(ev.clientX - drag.x, ev.clientY - drag.y) < 4) return
        drag.moved = true
        // Moved by hand: the spot it opened the panel from no longer holds. A press that began on
        // the box gave it the cursor: it goes, so the drag selects nothing.
        foot = null
        morph = null
        if (el.contains(document.activeElement) && document.activeElement instanceof HTMLTextAreaElement) document.activeElement.blur()
        el.dataset.held = ''
        mode = 'held'
        // The design is in an iframe: over it, the page hears no moves unless the island holds the
        // pointer. Held from here (not from the press), so a press that doesn't move still clicks.
        try { el.setPointerCapture(ev.pointerId) } catch { /* the pointer is already gone */ }
        opts.current.onHold(true)
      }
      pointer = toHost(ev)
      drag.samples.push({ t: performance.now(), ...pointer })
      if (drag.samples.length > 12) drag.samples.shift()
      const W = host.clientWidth
      const next: Side | null = side ? (pointer.x < W - UNDOCK_AT ? null : 'right') : pointer.x > W - DOCK_AT ? 'right' : null
      if (next !== side) {
        side = next
        // It turns (the tab on the side, the bar on the foot) at once, held by its middle, and
        // glides to the new edge.
        drag.fx = drag.fy = 0.5
        glideUntil = performance.now() + GLIDE_MS
        opts.current.onSide(next)
      }
      run()
    }
    const up = (ev: PointerEvent) => {
      if (!drag || ev.pointerId !== drag.id) return
      // Where the pointer has it, even if let go in the middle of a glide to a new edge.
      const aim = drag.moved ? heldGoal() : pos
      const d = drag
      drag = null
      if (!d.moved) return
      delete el.dataset.held
      // Let go, it stays on the edge it is held to: upright on the side, or flat on the foot.
      // Flat, it opens out around the puck's middle.
      const m = dims()
      const place: Edge = side ? 'right' : 'bottom'
      opts.current.place = place
      if (side) {
        goal = rest(aim)
        goal.y = clear(goal.y, m.h, m)
      } else opts.current.along = clamp(aim.x, INSET, m.W - m.w - INSET) + m.w / 2 - m.W / 2
      const v = velocity()
      vel.x = v.x; vel.y = v.y
      spring = SETTLE
      mode = 'settle'
      opts.current.onHold(false)
      run()
      opts.current.onDrop(place, side ? goal.y : opts.current.along)
      const eat = (c: Event) => { c.stopPropagation(); c.preventDefault() }
      el.addEventListener('click', eat, { capture: true, once: true })
      window.setTimeout(() => el.removeEventListener('click', eat, { capture: true }), 0)
    }
    el.addEventListener('pointerdown', down)
    listen(window, 'pointermove', move)
    listen(window, 'pointerup', up)
    listen(window, 'pointercancel', up)
    // Its hold on the pointer lost, or the window left mid-drag: let go where it is.
    const letGo = () => { if (drag) up(new PointerEvent('pointerup', { pointerId: drag.id })) }
    el.addEventListener('lostpointercapture', letGo)
    listen(window, 'blur', letGo)
    el.addEventListener('transitionrun', follow)
    el.addEventListener('transitionend', follow)
    // Its size changes (it turned, opened its list, grew for news) and the stage's does (the window,
    // the motion dock or the copy bar): it stays on its edge, inside the stage, as they do. Resting,
    // it moves in the very frame the size changed (an observer runs before that frame paints), so a
    // slow page never shows it a frame at its new size in its old place.
    const ro = new ResizeObserver(() => {
      if (mode !== 'idle') return follow()
      cancelAnimationFrame(raf)
      tick(performance.now())
      follow()
    })
    ro.observe(el)
    ro.observe(host)
    const mo = new MutationObserver(follow)
    const zone = host.closest('[data-zone]')
    if (zone) mo.observe(zone, { attributes: true, attributeFilter: ['data-dock', 'data-copy', 'style'] })
    // A new size set on the card (tab to rail, to the panel, back): follow from that very frame. Waiting
    // for transitionrun lets one frame paint at the new size in the old place, which flickers: the
    // rail hangs below the tab and past the screen's edge, then snaps up.
    let size = ''
    const sized = new MutationObserver(() => {
      const now = `${el.style.width}|${el.style.height}`
      if (now === size) return
      size = now
      follow()
    })
    sized.observe(el, { attributes: true, attributeFilter: ['style'] })
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      mo.disconnect()
      sized.disconnect()
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('transitionrun', follow)
      el.removeEventListener('transitionend', follow)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      el.removeEventListener('lostpointercapture', letGo)
      window.removeEventListener('blur', letGo)
      api.current = null
    }
  }, [o.on])

  // The preferences changed from elsewhere: it goes there.
  useEffect(() => { api.current?.toPrefs() }, [o.place, o.along])
}
