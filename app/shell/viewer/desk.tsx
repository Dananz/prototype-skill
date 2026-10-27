// The desk, on a wide screen: every design of the chosen prototype is an artboard on the dotted
// desk, in rows of at most five, ordered by number. Drag or scroll moves it; pinch, ⌘/Ctrl+scroll,
// + and - zoom about the pointer; 0 fits, 1 is 100 %. The artboards shrink with CSS zoom, never a
// transform, so Safari keeps one real layout per design. The artboard nearest the middle of the
// view is the selected one: the bar names it.
//
// A design runs only while its artboard is within one viewport of the view, or is the selected
// one, and at most 8 at once, the nearest first; the others are a light card with their name.
//
// Every artboard is a preview: the design in a fixed frame (a web design's is a 1200x750 desktop
// window, top of the page; a phone prototype's its screen), inert, its animations paused, so every
// row of the desk lines up and nothing in it reacts. The desk is for looking across designs: a drag
// anywhere or a plain wheel moves it, ⌘/Ctrl+wheel and a pinch zoom it. A click on a preview or its
// label (or Enter on a focused one) opens that design full size and live (full.tsx).
//
// Comments (phase 1): a count badge on each label opens the bar on that design's comments, and the
// pins sit on the previews, the same size on screen at any zoom; a pin opens the bar on its comment.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MutableRefObject } from 'react'
import { t, tn } from '../i18n'
import { useTalk } from './comments'
import { Pins } from './pins'
import { Icon, Mounted, type Api, type Screen, type Store } from './ui'

const GAP = 160 // between artboards, in artboard pixels
const LABEL = 34 // the label above an artboard, in screen pixels at any zoom
const PAD = { x: 72, top: 40, bottom: 150 } // room around the board, in screen pixels (the bar sits in the bottom)
const MAX_Z = 2
const MAX_LIVE = 8
// A preview shows the top of the design, cropped to its frame; nothing in it takes a pointer.
const PREVIEW = 'pointer-events-none h-full overflow-hidden'

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

export function Desk({ screens, size, phone, sel, store, api, onCentre, open, hidden, onBadge }: {
  screens: Screen[]; size: [number, number]; phone: boolean; sel: string; store: Store; api: MutableRefObject<Api | null>; onCentre: (key: string) => void
  /** Opens a design full size. */
  open: (key: string) => void
  /** A design is open full size over the desk: the desk keeps its place and takes no keys. */
  hidden: boolean
  /** A label's comment count was pressed: the bar opens on that design's comments. */
  onBadge: (key: string) => void
}) {
  const talk = useTalk()
  const [W, H] = size
  const cols = Math.min(screens.length, 5), rows = Math.ceil(screens.length / cols)
  const scroller = useRef<HTMLDivElement>(null)
  const world = useRef<HTMLDivElement>(null)
  const centreRef = useRef(onCentre)
  centreRef.current = onCentre
  const selRef = useRef(sel)
  selRef.current = sel
  const hiddenRef = useRef(hidden)
  hiddenRef.current = hidden
  const [live, setLive] = useState<Set<string>>(() => new Set([sel]))
  // The policy, called from outside the desk's effect when the selection changes.
  const hooks = useRef({ policy: () => {} })

  useLayoutEffect(() => {
    const s = scroller.current!, w = world.current!
    let z = 1, fitting = true, anim = 0, ticking = 0
    let steer: string | null = null
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const apply = (nz: number) => {
      z = nz
      w.style.zoom = String(nz)
      w.style.setProperty('--z', String(nz))
      w.style.setProperty('--inv', String(1 / nz))
      w.style.setProperty('--pin', String(Math.max(1, 0.75 / nz)))
      store.set({ z: nz, fit: fitting })
    }
    const view = () => {
      const r = s.getBoundingClientRect()
      return { r, cx: r.left + r.width / 2, cy: r.top + PAD.top + (r.height - PAD.top - PAD.bottom) / 2, vw: r.width - PAD.x * 2, vh: r.height - PAD.top - PAD.bottom - LABEL }
    }
    const toWorld = (sx: number, sy: number) => { const r = w.getBoundingClientRect(); return { x: (sx - r.left) / z, y: (sy - r.top) / z } }
    const place = (wx: number, wy: number, sx: number, sy: number) => {
      const r = w.getBoundingClientRect()
      s.scrollLeft += r.left + wx * z - sx
      s.scrollTop += r.top + wy * z - sy
    }
    const fitZ = () => {
      const { vw, vh } = view(), r = w.getBoundingClientRect()
      const Wd = r.width / z, Hd = r.height / z - rows * LABEL / z
      return Math.min(vw / Wd, (vh + LABEL - rows * LABEL) / Hd, 1)
    }
    const minZ = () => Math.min(0.05, fitZ() * 0.6)
    const clampZ = (n: number) => Math.min(MAX_Z, Math.max(minZ(), n))
    const zoomAt = (nz: number, sx: number, sy: number) => {
      const p = toWorld(sx, sy)
      apply(clampZ(nz))
      place(p.x, p.y, sx, sy)
    }
    const stop = () => { cancelAnimationFrame(anim); anim = 0 }
    const manual = () => { stop(); steer = null; if (fitting) { fitting = false; store.set({ z, fit: false }) } }

    /* Fly: zoom (in log space) and glide the point under the centre of the view, together. */
    const fly = (tz: number, wx: number, wy: number, then?: () => void) => {
      stop()
      const { cx, cy } = view()
      const from = toWorld(cx, cy), z0 = z, t0 = performance.now(), dur = reduce ? 0 : 420
      const frame = (now: number) => {
        const t = dur ? Math.min(1, (now - t0) / dur) : 1, e = ease(t)
        apply(t === 1 ? tz : Math.exp(Math.log(z0) + (Math.log(tz) - Math.log(z0)) * e))
        place(from.x + (wx - from.x) * e, from.y + (wy - from.y) * e, cx, cy)
        if (t < 1) anim = requestAnimationFrame(frame)
        else { anim = 0; then?.() }
      }
      anim = requestAnimationFrame(frame)
    }
    const fitAll = (animate = true) => {
      fitting = true
      const tz = fitZ(), r = w.getBoundingClientRect()
      const Hc = r.height / z - rows * LABEL / z
      const wx = r.width / z / 2, wy = (Hc + rows * LABEL / tz) / 2
      if (animate) fly(tz, wx, wy)
      else { stop(); apply(tz); place(wx, wy, view().cx, view().cy) }
    }
    const frameOf = (key: string) => {
      const f = w.querySelector<HTMLElement>(`[data-board="${CSS.escape(key)}"] [data-frame]`)
      if (!f) return null
      const r = w.getBoundingClientRect(), b = f.getBoundingClientRect()
      return { x: (b.left - r.left) / z, y: (b.top - r.top) / z, w: b.width / z, h: b.height / z }
    }
    const show = (key: string) => {
      const f = frameOf(key)
      if (!f) return
      manual()
      steer = key
      const { vw, vh } = view()
      const tz = Math.min(vw / f.w, vh / f.h, 1)
      fly(tz, f.x + f.w / 2, f.y + f.h / 2 - (LABEL / 2) / tz, () => { steer = null })
    }
    const actual = () => {
      manual()
      const { cx, cy } = view(), p = toWorld(cx, cy)
      fly(1, p.x, p.y)
    }
    const by = (f: number) => { manual(); const { cx, cy } = view(), p = toWorld(cx, cy); fly(clampZ(z * f), p.x, p.y) }
    /* Bring a pin into the part of the desk the grown bar leaves open (inset: the bar's height). */
    const toPin = (id: string, inset = 0) => {
      const pin = w.querySelector<HTMLElement>(`[data-pin="${CSS.escape(id)}"]`)
      if (!pin) return
      manual()
      const r = w.getBoundingClientRect(), b = pin.getBoundingClientRect(), { r: sr, cy } = view()
      const want = sr.top + Math.max(80, (sr.height - inset - 24) / 2)
      const tz = Math.max(z, Math.min(0.75, MAX_Z))
      fly(tz, (b.left + b.width / 2 - r.left) / z, (b.bottom - r.top) / z - 14 / tz + (cy - want) / tz)
    }
    api.current = { show, fit: () => fitAll(true), actual, by, toPin }

    /* Which designs run: the selected one, then those near the view, nearest first, up to 8. */
    const near = new Set<string>()
    const policy = () => {
      const { cx, cy } = view()
      const ranked = [...w.querySelectorAll<HTMLElement>('[data-board]')]
        .filter(el => near.has(el.dataset.board!))
        .map(el => { const b = el.getBoundingClientRect(); return { key: el.dataset.board!, d: Math.hypot(b.left + b.width / 2 - cx, b.top + b.height / 2 - cy) } })
        .sort((a, b) => a.d - b.d)
      const next = new Set([selRef.current])
      for (const { key } of ranked) { if (next.size >= MAX_LIVE) break; next.add(key) }
      setLive(was => (was.size === next.size && [...next].every(k => was.has(k)) ? was : next))
    }
    const io = new IntersectionObserver(entries => {
      for (const e of entries) { const key = (e.target as HTMLElement).dataset.board!; if (e.isIntersecting) near.add(key); else near.delete(key) }
      policy()
    }, { root: s, rootMargin: '100%' })
    w.querySelectorAll('[data-board]').forEach(el => io.observe(el))
    hooks.current = { policy }

    /* The artboard nearest the centre of the view is the one the bar is on. At Fit every design is
       in view, so the one chosen last (the link's own first, as it opens) stays chosen. */
    const nearest = () => {
      ticking = 0
      policy()
      if (steer || fitting) return
      const { cx, cy } = view()
      let best = '', dist = Infinity
      w.querySelectorAll<HTMLElement>('[data-board]').forEach(el => {
        const b = el.getBoundingClientRect()
        const dx = Math.max(b.left - cx, 0, cx - b.right), dy = Math.max(b.top - cy, 0, cy - b.bottom)
        const d = Math.hypot(dx, dy) * 4 + Math.abs(b.left + b.width / 2 - cx)
        if (d < dist) { dist = d; best = el.dataset.board! }
      })
      if (best) centreRef.current(best)
    }
    const onScroll = () => { if (!ticking) ticking = requestAnimationFrame(nearest) }

    /* Ctrl/Cmd + wheel, and a trackpad pinch (Chrome and Firefox send it as Ctrl + wheel), zoom at the pointer. */
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) { if (anim) stop(); if (fitting) manual(); return }
      e.preventDefault()
      manual()
      const d = Math.max(-60, Math.min(60, e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY))
      zoomAt(z * Math.exp(-d * 0.01), e.clientX, e.clientY)
    }
    /* Safari's trackpad pinch. */
    let gz = 1, touching = false
    type GE = Event & { scale: number; clientX: number; clientY: number }
    const onGestureStart = (e: Event) => { e.preventDefault(); if (touching) return; manual(); gz = z }
    const onGestureChange = (e: Event) => { e.preventDefault(); if (touching) return; const g = e as GE; zoomAt(gz * g.scale, g.clientX, g.clientY) }
    /* Two fingers on a touch screen: pinch and pan together. */
    let t0: { d: number; z: number; p: { x: number; y: number } } | null = null
    const two = (e: TouchEvent) => {
      const [a, b] = [e.touches[0], e.touches[1]]
      return { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 }
    }
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 2) return
      touching = true
      manual()
      const m = two(e)
      t0 = { d: m.d, z, p: toWorld(m.x, m.y) }
    }
    const onTouchMove = (e: TouchEvent) => {
      if (!t0 || e.touches.length !== 2) return
      e.preventDefault()
      const m = two(e)
      apply(clampZ(t0.z * m.d / t0.d))
      place(t0.p.x, t0.p.y, m.x, m.y)
    }
    const onTouchEnd = (e: TouchEvent) => { if (e.touches.length < 2) { t0 = null; touching = e.touches.length > 0 } }

    /* Drag with the mouse anywhere but a control to move the desk; the previews are inert, so a
       drag on one moves the desk too, and a press that doesn't move is a click that opens it. */
    let drag: { x: number; y: number; l: number; t: number; id: number; moved: boolean } | null = null
    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || (e.button !== 0 && e.button !== 1)) return
      if (e.button === 0 && (e.target as HTMLElement).closest('button, a, input, [data-label]')) return
      drag = { x: e.clientX, y: e.clientY, l: s.scrollLeft, t: s.scrollTop, id: e.pointerId, moved: false }
      if (e.button === 1) e.preventDefault()
    }
    const onMove = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y
      if (!drag.moved) {
        if (Math.hypot(dx, dy) < 4) return
        drag.moved = true
        manual()
        s.setPointerCapture(e.pointerId)
        s.dataset.drag = ''
      }
      s.scrollLeft = drag.l - dx
      s.scrollTop = drag.t - dy
    }
    const onUp = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return
      if (drag.moved) {
        delete s.dataset.drag
        const eat = (c: MouseEvent) => { c.stopPropagation(); c.preventDefault() }
        s.addEventListener('click', eat, { capture: true, once: true })
        setTimeout(() => s.removeEventListener('click', eat, { capture: true }), 0)
      }
      drag = null
    }
    // The keys work on the desk, and on the page when nothing else has the focus (as when it opens),
    // never while a design is open full size: its keys are its own then.
    const onKey = (e: KeyboardEvent) => {
      const at = e.target as HTMLElement
      if (hiddenRef.current || (at !== s && at !== document.body && at !== document.documentElement)) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const { cx, cy } = view()
      if (e.key === '+' || e.key === '=') { manual(); zoomAt(z * 1.25, cx, cy) }
      else if (e.key === '-' || e.key === '_') { manual(); zoomAt(z / 1.25, cx, cy) }
      else if (e.key === '0') fitAll(true)
      else if (e.key === '1') actual()
      else return
      e.preventDefault()
    }

    apply(1)
    fitAll(false)
    let lastW = s.clientWidth, lastH = s.clientHeight
    const ro = new ResizeObserver(() => {
      if (s.clientWidth === lastW && s.clientHeight === lastH) return
      lastW = s.clientWidth; lastH = s.clientHeight
      if (fitting) fitAll(false)
    })
    ro.observe(s)
    document.fonts?.ready.then(() => { if (fitting && !anim) fitAll(false) })

    s.addEventListener('scroll', onScroll, { passive: true })
    s.addEventListener('wheel', onWheel, { passive: false })
    s.addEventListener('gesturestart', onGestureStart)
    s.addEventListener('gesturechange', onGestureChange)
    s.addEventListener('touchstart', onTouchStart, { passive: true })
    s.addEventListener('touchmove', onTouchMove, { passive: false })
    s.addEventListener('touchend', onTouchEnd)
    s.addEventListener('touchcancel', onTouchEnd)
    s.addEventListener('pointerdown', onDown)
    s.addEventListener('pointermove', onMove)
    s.addEventListener('pointerup', onUp)
    s.addEventListener('pointercancel', onUp)
    window.addEventListener('keydown', onKey)
    return () => {
      stop(); cancelAnimationFrame(ticking); ro.disconnect(); io.disconnect()
      s.removeEventListener('scroll', onScroll)
      s.removeEventListener('wheel', onWheel)
      s.removeEventListener('gesturestart', onGestureStart)
      s.removeEventListener('gesturechange', onGestureChange)
      s.removeEventListener('touchstart', onTouchStart)
      s.removeEventListener('touchmove', onTouchMove)
      s.removeEventListener('touchend', onTouchEnd)
      s.removeEventListener('touchcancel', onTouchEnd)
      s.removeEventListener('pointerdown', onDown)
      s.removeEventListener('pointermove', onMove)
      s.removeEventListener('pointerup', onUp)
      s.removeEventListener('pointercancel', onUp)
      window.removeEventListener('keydown', onKey)
      api.current = null
    }
  }, [api, store, rows])

  // The selected design always runs.
  useEffect(() => { hooks.current.policy() }, [sel])


  return (
    <div ref={scroller} data-viewer-desk tabIndex={0} role="region" inert={hidden} aria-hidden={hidden || undefined} aria-label={t('Every shared design on one desk. Drag to move, pinch or Ctrl+scroll to zoom, 0 fits, 1 is actual size.')}
      className={`absolute inset-0 isolate cursor-grab touch-pan-x touch-pan-y overflow-auto overscroll-contain select-none [scrollbar-width:none] data-[drag]:cursor-grabbing [&::-webkit-scrollbar]:hidden`}>
      <div className="grid min-h-full w-max min-w-full place-items-center" style={{ padding: `${PAD.top}px ${PAD.x}px ${PAD.bottom}px` }}>
        <div ref={world} data-world className="grid items-start [--edge:rgba(0,0,0,.12)] dark:[--edge:rgba(255,255,255,.12)]"
          style={{ gridTemplateColumns: `repeat(${cols}, ${W}px)`, columnGap: GAP, rowGap: GAP * 1.5 }}>
          {screens.map(s => {
            const on = s.key === sel, running = live.has(s.key)
            const count = talk.notes.filter(c => c.variant === s.key).length
            return (
              <section key={s.key} data-board={s.key} aria-label={`#${s.n} ${s.name}`} className="shrink-0" style={{ width: W }}>
                {/* The label, as on a design canvas. It stays the same size on screen at any zoom. */}
                <div data-label className="flex items-center gap-2 pb-2 text-[13px]" style={{ zoom: 'var(--inv, 1)', width: `calc(${W}px * var(--z, 1))`, height: LABEL }}>
                  <button onClick={() => open(s.key)} className="flex min-w-0 items-center gap-1.5 rounded-md text-left">
                    <span className={`font-semibold tabular-nums transition-colors motion-reduce:transition-none ${on ? 'text-sky-600 dark:text-sky-400' : 'text-zinc-400 dark:text-zinc-500'}`}>#{s.n}</span>
                    <span className={`truncate transition-colors motion-reduce:transition-none ${on ? 'font-semibold text-zinc-900 dark:text-zinc-100' : 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100'}`}>{s.name}</span>
                  </button>
                  {count > 0 && (
                    <button data-count-badge onClick={() => onBadge(s.key)} aria-label={tn(count, '{n} comment on #{v}', '{n} comments on #{v}', { v: s.n })}
                      className="ms-auto inline-flex h-6 shrink-0 items-center gap-1 rounded-full bg-zinc-900 px-2 text-[11px] font-semibold text-white tabular-nums dark:bg-white dark:text-zinc-900">
                      <Icon name="chat-fill" className="size-3" />{count}
                    </button>
                  )}
                </div>
                <div data-frame role="button" tabIndex={0} aria-label={t('Open #{n} {name}', { n: s.n, name: s.name })}
                  onClick={() => open(s.key)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(s.key) } }}
                  className={`relative cursor-pointer overflow-hidden bg-white [contain:layout_paint] transition-shadow duration-300 motion-reduce:transition-none dark:bg-zinc-950 [&_*]:![animation-delay:-60s] [&_*]:![animation-play-state:paused] ${on ? '' : '[--ring:var(--edge)] hover:[--ring:rgba(14,165,233,.55)]'}`}
                  style={{
                    height: H,
                    borderRadius: phone ? 'max(28px, calc(12px * var(--inv, 1)))' : 'calc(12px * var(--inv, 1))',
                    boxShadow: `0 0 0 calc(${on ? 2 : 1}px * var(--inv, 1)) ${on ? '#0ea5e9' : 'var(--ring)'}, 0 calc(24px * var(--inv, 1)) calc(60px * var(--inv, 1)) calc(-24px * var(--inv, 1)) rgba(0,0,0,.45)`,
                  }}>
                  <Mounted v={s.v} live={running} inert className={PREVIEW} />
                  {running && <DeskPins board={s.key} />}
                  {!running && (
                    <div aria-hidden="true" className="absolute inset-0 grid place-items-center bg-zinc-50 text-[40px] text-zinc-400 dark:bg-zinc-900 dark:text-zinc-500">
                      <span><span className="tabular-nums">#{s.n}</span> <span className="font-semibold text-zinc-500 dark:text-zinc-400">{s.name}</span></span>
                    </div>
                  )}
                </div>
              </section>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/** The pins on one preview. */
function DeskPins({ board }: { board: string }) {
  const mount = useCallback(() => document.querySelector<HTMLElement>(`[data-board="${CSS.escape(board)}"] [data-frame] [data-mount]`), [board])
  return <Pins variant={board} mount={mount} kind="desk" />
}
