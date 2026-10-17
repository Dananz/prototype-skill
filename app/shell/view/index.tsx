// The device view: this page at a phone's, a tablet's or a desktop's size, shown in the stage (the
// bar and the pill stay), so a phone can see the desktop layout and a desktop the phone's. The view
// shows the page's own place: the page moves it, and when the page in it moves (a link in the
// design; it draws no bar, pill or sidebar of its own, only the design), the page follows. A quiet
// line on top says the size and the zoom; under it the page in a frame, as wide as the area (never
// above 100%), which two fingers or a pinch zoom, from 10% to 400%, and Space and a drag move.
//
// While a view is on, the page's own Comment button and C comment on the design in it: a layer
// covers the frame, the comment layer's inspect looks through it (host.view().at), a drag on it
// scrolls, and what is written is about that layout (comments/). The shell draws the controls (the
// bar's three sizes and its scale button, which zooms the view; the Layout and Zoom rows of the
// pill's menu); this draws the view, in [data-view].
import { useEffect, useLayoutEffect, useRef, useState, type ReactElement, type RefObject } from 'react'
import { createRoot } from 'react-dom/client'
import { useRows } from '../comments/list'
import { useCtx } from '../comments/ctx'
import { Icon } from '../comments/ui'
import { designIn, frameClicks, frameMenus, frameSelections, frameUrl, openFrame, type Frame } from './frame'
import { fitOf, outOf, pinchOn, room, useBox, useGestures, usePinch, usePlace } from './gestures'
import { trackPointer } from '../motion'
import { hoverMove } from '../comments/hover'
import { seeThrough } from '../comments/dom'
import { dims, ORDER, SIZES, type Size } from './sizes'

/** size null: the stage's own artboard (fill), as big as the stage, with no line over it. */
export type View = { size: Size | null; land: boolean; zoom: number; /** Counts Fit chosen from the zoom control: each one centres the device again. */ home?: number }
export type ViewProps = {
  /** The view on, or null. zoom: 0 is Fit, else a percentage. */
  view: View | null
  /** The page's place; the frame follows it. */
  hash: string
  dark: boolean
  set: (patch: Partial<View>) => void
  /** The page in the frame moved there. */
  route: (hash: string) => void
  /** A key pressed in the page in the frame (C comments on it, as out here). */
  onKey: (e: KeyboardEvent) => void
}

// The one frame on screen, for the comment layer to look into.
let live: Frame | null = null

/** The page in a frame, `w` × `h` CSS px, drawn at `scale` in a box of the scaled size. Made once
 *  and kept while the size, the scale or the place change, so the page in it keeps its state. */
function LiveFrame({ hash, dark, w, h, scale, route, bind, ring, children }: {
  hash: string; dark: boolean; w: number; h: number; scale: number; route: (hash: string) => void; bind: (d: Document) => () => void; ring: string; children?: ReactElement | false
}) {
  const box = useRef<HTMLDivElement>(null)
  const ctl = useRef<Frame | null>(null)
  const now = useRef({ hash, dark, route, bind })
  now.current = { hash, dark, route, bind }
  useLayoutEffect(() => {
    const f = openFrame(box.current!, frameUrl(now.current.hash, now.current.dark), {
      route: h => now.current.route(h), bind: d => now.current.bind(d), bound: () => f.go(now.current.hash),
    })
    ctl.current = live = f
    return () => { f.close(); ctl.current = null; if (live === f) live = null }
  }, [])
  // The page moved: the frame goes there too, the same page, no reload.
  useEffect(() => { ctl.current?.go(hash) }, [hash])
  // The theme changes in place, keeping the design's inputs, menus and scroll.
  const was = useRef(dark)
  useEffect(() => {
    if (was.current === dark) return
    was.current = dark
    ctl.current?.theme(dark)
  }, [dark])
  useLayoutEffect(() => {
    const el = ctl.current?.el
    if (!el) return
    el.style.width = `${w}px`
    el.style.height = `${h}px`
    el.style.transform = `scale(${scale})`
  }, [w, h, scale])
  return <div ref={box} data-view-device className={`relative shrink-0 overflow-hidden ${ring}`} style={{ width: Math.round(w * scale), height: Math.round(h * scale) }}>{children}</div>
}

/** The nearest part of the framed page that scrolls, from `el` up. */
function scrollerAt(doc: Document, el: Element | null) {
  const w = doc.defaultView!
  for (let e = el; e && e !== doc.body && e !== doc.documentElement; e = e.parentElement) {
    const s = w.getComputedStyle(e)
    if (/(auto|scroll)/.test(s.overflowY + s.overflowX) && (e.scrollHeight > e.clientHeight + 1 || e.scrollWidth > e.clientWidth + 1)) return e as HTMLElement
  }
  return doc.scrollingElement as HTMLElement | null
}

/**
 * The layer over the frame while commenting. The comment layer's inspect does the looking and the
 * picking through it; this keeps what a press on it would otherwise lose: a drag scrolls (the view
 * first when zoomed in, then the page in the frame), a wheel scrolls the page in the frame, and
 * the click that ends a drag picks nothing.
 */
function Pick({ area, scale, zoomed }: { area: RefObject<HTMLDivElement | null>; scale: number; zoomed: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const now = useRef({ scale, zoomed })
  now.current = { scale, zoomed }
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const doc = () => live?.doc() ?? null
    const local = (x: number, y: number) => { const r = el.getBoundingClientRect(); return [(x - r.left) / now.current.scale, (y - r.top) / now.current.scale] as const }
    let drag: { x: number; y: number; moved: boolean; sc: HTMLElement | null; id: number } | null = null, fingers = 0, dragged = 0
    const down = (e: PointerEvent) => {
      if (e.pointerType === 'touch' && ++fingers > 1) { drag = null; return }
      if (e.button !== 0) return
      const d = doc()
      drag = { x: e.clientX, y: e.clientY, moved: false, sc: d && scrollerAt(d, d.elementFromPoint(...local(e.clientX, e.clientY))), id: e.pointerId }
    }
    // Hover-only parts of the design show through the layer: the pointer's moves over it are replayed
    // in the frame (comments/hover.ts), and leaving the layer is leaving the design.
    const hover = (e: PointerEvent) => {
      const d = doc()
      if (!d || e.pointerType !== 'mouse' || drag?.moved) return
      const [x, y] = local(e.clientX, e.clientY)
      hoverMove(d, d.elementFromPoint(x, y), x, y)
    }
    const leave = (e: PointerEvent) => { const d = doc(); if (d && e.pointerType === 'mouse') hoverMove(d, null, ...local(e.clientX, e.clientY)) }
    const move = (e: PointerEvent) => {
      const g = drag
      if (!g || e.pointerId !== g.id) return
      const dx = e.clientX - g.x, dy = e.clientY - g.y
      if (!g.moved && Math.hypot(dx, dy) < 6) return
      g.moved = true; g.x = e.clientX; g.y = e.clientY
      const sc = g.sc, a = area.current
      if (now.current.zoomed && a) { const r = room(a, -dx, -dy); if (r.x || r.y) { a.scrollBy(r.x ? -dx : 0, r.y ? -dy : 0); return } }
      const was = sc ? [sc.scrollLeft, sc.scrollTop] : [0, 0]
      if (sc) { sc.scrollLeft -= dx / now.current.scale; sc.scrollTop -= dy / now.current.scale }
      if (a && (!sc || sc.scrollTop === was[1])) a.scrollTop -= dy
      if (a && (!sc || sc.scrollLeft === was[0])) a.scrollLeft -= dx
    }
    const up = (e: PointerEvent) => {
      if (e.pointerType === 'touch') fingers = Math.max(0, fingers - 1)
      if (drag?.moved) dragged = performance.now()
      if (!drag || e.pointerId === drag.id) drag = null
    }
    // Ahead of the comment layer's own click (on the document), which would pick where a drag ended.
    const click = (e: MouseEvent) => { if (performance.now() - dragged < 400 && el.contains(e.target as Node)) { e.preventDefault(); e.stopImmediatePropagation() } }
    // A wheel over the frame scrolls the page in it, as if the layer weren't there.
    const wheel = (e: WheelEvent) => {
      const d = doc(), a = area.current
      if (!d || e.ctrlKey) return
      e.preventDefault()
      if (now.current.zoomed && a) { const r = room(a, e.deltaX, e.deltaY); if (r.x || r.y) { a.scrollBy(r.x ? e.deltaX : 0, r.y ? e.deltaY : 0); return } }
      const sc = scrollerAt(d, d.elementFromPoint(...local(e.clientX, e.clientY)))
      const was = sc ? sc.scrollTop : 0
      sc?.scrollBy(e.deltaX / now.current.scale, e.deltaY / now.current.scale)
      if (!sc || sc.scrollTop === was) a?.scrollBy(e.deltaX, e.deltaY)
    }
    el.addEventListener('pointerdown', down)
    el.addEventListener('pointermove', hover)
    el.addEventListener('pointerleave', leave)
    addEventListener('pointermove', move)
    addEventListener('pointerup', up)
    addEventListener('pointercancel', up)
    addEventListener('click', click, true)
    el.addEventListener('wheel', wheel, { passive: false })
    return () => {
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('pointermove', hover); el.removeEventListener('pointerleave', leave)
      removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', up)
      removeEventListener('click', click, true)
      el.removeEventListener('wheel', wheel)
    }
  }, [])
  return <div ref={ref} data-view-pick className="absolute inset-0 z-10 cursor-crosshair select-none [-webkit-touch-callout:none]" style={{ touchAction: 'none' }} />
}

const coarse = matchMedia('(pointer: coarse)')

function ViewStage({ view, hash, dark, set, route, onKey }: ViewProps & { view: View }) {
  const { act } = useCtx()
  const { s, rows } = useRows()
  const [area, box] = useBox<HTMLDivElement>()
  // The stage's own artboard is the area's size: at 100% it is the stage as it always was.
  const d = view.size ? dims(view.size, view.land) : { w: box.w, h: box.h }
  const pad = !view.size || box.w < 640 ? 0 : 16
  const fit = fitOf(box, d, pad)
  const scale = view.zoom ? view.zoom / 100 : fit
  const zoomed = scale > fit + 0.001
  const setZoom = (z: number) => set({ zoom: z })
  const { wrap, anchor } = usePlace(area, box, d, scale, zoomed, pad, `${view.size}-${view.land}`, view.home ?? 0)
  const pinch = usePinch(area, scale, fit, setZoom, anchor)
  const gestures = useGestures(area, scale, fit, setZoom, anchor)
  const keys = useRef(onKey)
  keys.current = onKey
  const bind = (doc: Document) => {
    const a = pinchOn(doc, pinch), b = gestures(doc), k = (e: KeyboardEvent) => keys.current(e)
    // The mouse over the frame moves in its page: told here as a point of this page, so the stage's
    // edge arrows show as they do over the stage itself.
    const m = (e: PointerEvent) => { if (e.pointerType !== 'mouse') return; const [x, y] = outOf(doc.defaultView?.frameElement as HTMLElement | null, e.clientX, e.clientY); trackPointer({ clientX: x, clientY: y }) }
    const c = (e: MouseEvent) => frameClicks.forEach(f => f(e))
    // Heard after the design's own handlers (bubbling), so a design that made its own menu keeps it.
    const cm = (e: MouseEvent) => { const [x, y] = outOf(doc.defaultView?.frameElement as HTMLElement | null, e.clientX, e.clientY); frameMenus.forEach(f => f(e, x, y)) }
    const sc = () => frameSelections.forEach(f => f())
    doc.addEventListener('keydown', k)
    doc.addEventListener('selectionchange', sc)
    doc.addEventListener('pointermove', m, true)
    doc.addEventListener('click', c, true)
    doc.addEventListener('contextmenu', cm)
    return () => { a(); b(); doc.removeEventListener('contextmenu', cm); doc.removeEventListener('keydown', k); doc.removeEventListener('selectionchange', sc); doc.removeEventListener('pointermove', m, true); doc.removeEventListener('click', c, true) }
  }
  const [, redraw] = useState(0)
  useEffect(() => { const f = () => redraw(n => n + 1); coarse.addEventListener('change', f); return () => coarse.removeEventListener('change', f) }, [])
  const picking = s.mode.kind === 'pick' || s.mode.kind === 'tag'
  const name = view.size ? SIZES[view.size].name : ''
  // Comments written on the other sizes, open ones, as a chip each that switches to that size.
  const others = ORDER.filter(x => x !== view.size).map(x => ({ x, k: rows.filter(r => r.here && r.state !== 'done' && r.item.target?.view?.size === x).length })).filter(o => o.k)
  const pct = Math.round(scale * 100)
  return (
    <div data-view-stage className="relative flex h-full flex-col bg-zinc-100 text-[13px] text-zinc-900 dark:bg-[#111113] dark:text-zinc-100">
      {!view.size ? null : picking
        ? <div data-view-banner className="flex h-10 shrink-0 items-center gap-2 bg-proto-primary pe-1.5 ps-3 text-xs font-medium text-proto-primary-fg [@media(hover:hover)]:pe-28">
            <Icon name="comment" className="size-4" />
            <span className="min-w-0 flex-1 truncate">{coarse.matches ? 'Tap' : 'Click'} what to change on {name.toLowerCase()}</span>
            <span className="hidden shrink-0 tabular-nums opacity-70 sm:inline">{d.w} × {d.h}</span>
            <button type="button" onClick={() => act.stop()} className="h-7 shrink-0 rounded-full bg-white/20 px-2.5 font-semibold hover:bg-white/30">Done</button>
          </div>
        : <div data-view-line className="flex h-10 shrink-0 items-center gap-1 pe-1 ps-3 text-[11px] text-zinc-500 dark:text-zinc-400 [@media(hover:hover)]:pe-28">
            <span className="shrink-0 tabular-nums"><span className="font-medium text-zinc-800 dark:text-zinc-200">{d.w} × {d.h}</span> · {pct}%</span>
            <span className="ms-auto" />
            {others.map(({ x, k }) => (
              <button key={x} type="button" data-view-other={x} onClick={() => set({ size: x, zoom: 0 })} title={`${k} comment${k === 1 ? '' : 's'} on the ${SIZES[x].name.toLowerCase()} layout`}
                className="inline-flex h-7 shrink-0 items-center gap-1 rounded-full px-2 text-[11px] font-medium text-proto-primary-soft-fg hover:bg-proto-primary-soft">
                <Icon name={x} className="size-3.5" />{k}
              </button>
            ))}
            {view.size === 'tablet' && (
              <button type="button" data-view-turn onClick={() => set({ land: !view.land, zoom: 0 })} aria-label={view.land ? 'Turn upright' : 'Turn on its side'} title={view.land ? 'Upright' : 'On its side'}
                className="grid size-8 shrink-0 place-items-center rounded-full text-zinc-600 hover:bg-zinc-900/5 dark:text-zinc-300 dark:hover:bg-white/10"><Icon name="rotate" className="size-[17px]" /></button>
            )}
          </div>}
      {/* No scrollbars, as on a canvas: one coming and going changes the area's width, and with it Fit, which
          brings it back (the zoom flickered between two values). It moves by drag, wheel and fingers. */}
      <div ref={area} data-view-area className="min-h-0 flex-1 overflow-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" style={{ touchAction: 'pan-x pan-y' }}>
        <div ref={wrap} className="flex h-max min-h-full w-max min-w-full items-start justify-start">
          <LiveFrame hash={hash} dark={dark} w={d.w} h={d.h} scale={scale} route={route} bind={bind}
            ring={!view.size ? 'bg-white dark:bg-zinc-950' : `bg-white ring-1 dark:bg-zinc-950 ${picking ? 'ring-2 ring-proto-primary' : 'ring-black/10 dark:ring-white/[.16]'} ${pad ? 'rounded-[10px]' : ''}`}>
            {picking && <Pick area={area} scale={scale} zoomed={zoomed} />}
          </LiveFrame>
        </div>
      </div>
    </div>
  )
}

/** Mounts the view once, in `host`; paint draws it with new props (null view: none, and its frame goes). */
export function createView(host: HTMLElement, wrap: (el: ReactElement) => ReactElement) {
  const root = createRoot(host)
  let wait = 0
  return {
    paint(p: ViewProps) {
      host.hidden = !p.view
      root.render(wrap(p.view ? <ViewStage {...p} view={p.view} /> : <></>))
      // The stage's own artboard stays unseen (laid out, so the frame loads at its size) until the
      // design is in its frame: meanwhile the stage under it shows the same design, not an empty frame.
      cancelAnimationFrame(wait)
      const show = () => {
        const on = !p.view || !!p.view.size || !!designIn(live?.doc() ?? null)
        host.style.visibility = on ? '' : 'hidden'
        if (!on) wait = requestAnimationFrame(show)
      }
      show()
    },
    /** The design in the frame, while a view is on and the page in it has one on its stage. */
    mount: () => designIn(live?.doc() ?? null),
    /** What is under a point of this page in the frame: the element, and the point in the frame's px. */
    at(x: number, y: number) {
      const f = live?.el, d = live?.doc()
      if (!f || !d) return null
      const r = f.getBoundingClientRect()
      if (x < r.left || x > r.right || y < r.top || y > r.bottom) return null
      const s = r.width / (f.offsetWidth || 1), fx = (x - r.left) / s, fy = (y - r.top) / s
      const el = seeThrough(d, fx, fy, d.elementFromPoint(fx, fy))
      return el ? { el, x: fx, y: fy } : null
    },
  }
}
