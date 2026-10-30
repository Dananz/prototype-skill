// The map: every design's screens, the explorations under them and the links between them, on one
// infinite desk (spec decision 11). Drag or scroll moves it; pinch, ⌘/Ctrl+scroll, + and - zoom
// about the pointer; 0 fits. The camera is a translate on the outer layer and CSS zoom on the world
// (never a scale transform), so Safari keeps one real layout per design; labels stay one size at
// any zoom through --iz (1 / zoom). A double click on a screen flies into it and opens it (Focus);
// the shell flies back out here when Focus is left.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from 'react'
import { createRoot } from 'react-dom/client'
import type { Design, Proto, Variant } from '../shell'
import { t, tn } from '../i18n'
import { numberOf } from '../variants'
import { GAP, linePath, worldOf, type Board, type World } from './world'
import { Ph } from '../tree/row'

export type MapInput = {
  protos: Proto[]; designs: Design[]; place: string; hidden: boolean; lines: 'all' | 'selected'; design: string
  /** A share's viewer: look and open only (no notes, links or Build it); the links come with the designs. */
  readOnly?: boolean
  /** Counts edits to the prototypes' files: the links are read again. */
  edits?: number
  /** What the agent is writing now: `route:building` or `route:editing`, space-separated. */
  working?: string
}
export type MapApi = {
  get(): MapInput; subscribe(fn: () => void): () => void
  /** Opens a route in Focus. */
  open(route: string): void
  mount(el: HTMLElement, component: unknown): () => void
  /** The camera's last place, kept across Focus so leaving it flies back to where the map was. */
  camera: { x: number; y: number; z: number } | null
  setLines(mode: 'all' | 'selected'): void
  /** Shows one design only ('' for all). */
  setDesign(id: string): void
  /** Sends words to the agent about the map, on a screen's variant: a note on a link or a flow, or a link to add. */
  ask(on: { proto: string; variant: string }, action: 'map-note' | 'add-link', text: string): Promise<void>
}
/** What a note on the map is about: a link line, a flow, or a link dragged from one screen to another. */
type Note = { kind: 'line' | 'link'; a: Board; b: Board } | { kind: 'flow'; design: string; flow: string; a: Board }
type Cam = { x: number; y: number; z: number }
const MIN_Z = 0.02, MAX_Z = 2, MAX_LIVE = 12
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))
/** Labels keep one size on screen (1 / zoom), shrinking to 60 % when the map is zoomed far out (a phone fitting it all), so they never cover the boards. */
const labelZ = (z: number) => String(clamp(z / 0.2, 0.6, 1) / z)
const ease = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2)

/** A design's variant, drawn inert in its frame while it is on screen and big enough to read. */
function Preview({ v, live, mount }: { v: Variant | undefined; live: boolean; mount: MapApi['mount'] }) {
  const host = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!live || !v) return
    const box = document.createElement('div')
    box.dataset.mount = ''; box.dataset.preview = ''; box.inert = true; box.dir = 'ltr'
    box.className = 'pointer-events-none h-full overflow-hidden'
    if (v.theme) box.dataset.protoTheme = v.theme
    host.current!.append(box)
    let off: (() => void) | null = null, gone = false
    v.load().then(c => { if (!gone) off = mount(box, c) }, () => { /* the card's name stays */ })
    return () => { gone = true; box.remove(); if (off) { const o = off; setTimeout(() => { try { o() } catch { /* gone */ } }) } }
  }, [v, live, mount])
  return <div ref={host} className="absolute inset-0" />
}

/** Each screen's <Go to> targets, read from its variant's source. */
function useLinks(boards: Board[], edits: number, given: Record<string, string[]> | null, hidden: boolean) {
  const [links, setLinks] = useState<Record<string, string[]>>({})
  // Read by the dev server (/__proto/links), again whenever a prototype changes, while the map shows.
  const routes = useMemo(() => [...new Set(boards.filter(b => b.kind === 'screen').map(b => b.route))].join(','), [boards])
  useEffect(() => {
    if (given || hidden || !routes) return
    let gone = false
    fetch('/__proto/links', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ routes: routes.split(',') }) })
      .then(r => r.ok ? r.json() : { links: {} }).then((r: { links: Record<string, string[]> }) => { if (!gone) setLinks(r.links ?? {}) }, () => {})
    return () => { gone = true }
  }, [routes, edits, given, hidden])
  return given ?? links
}

function MapView({ api }: { api: MapApi }) {
  const input = useSyncExternalStore(api.subscribe, api.get)
  const [spread, setSpread] = useState<Set<string>>(() => new Set())
  const [sel, setSel] = useState<string | null>(null)
  const designs = useMemo(() => input.design ? input.designs.filter(d => d.id === input.design) : input.designs, [input.designs, input.design])
  const [note, setNote] = useState<Note | null>(null)
  const [build, setBuild] = useState(false)
  // Build it works on one design: the one chosen, or the only one.
  const one = designs.length === 1 ? designs[0] : null
  // A link being dragged from the selected screen's handle: where the pointer is, in world pixels.
  const [drag, setDrag] = useState<{ from: Board; x: number; y: number } | null>(null)
  const world: World = useMemo(() => worldOf(input.protos, designs, spread), [input.protos, designs, spread])
  const given = useMemo(() => input.designs.some(d => d.links) ? Object.assign({}, ...input.designs.map(d => d.links ?? {})) as Record<string, string[]> : null, [input.designs])
  const links = useLinks(world.boards, input.edits ?? 0, given, input.hidden)
  const ro = !!input.readOnly
  const busy = useMemo(() => new Map((input.working ?? '').split(' ').filter(Boolean).map(w => w.split(':') as [string, string])), [input.working])
  const view = useRef<HTMLDivElement>(null), layer = useRef<HTMLDivElement>(null)
  const cam = useRef<Cam>(api.camera ?? { x: 0, y: 0, z: 0.2 })
  const [, redraw] = useState(0)
  // How far the last press moved: a drag that ends on a board doesn't select it.
  const dragged = useRef(0)
  const [size, setSize] = useState({ w: 1, h: 1 })

  const apply = useCallback(() => {
    const c = cam.current, el = layer.current
    if (!el) return
    el.style.transform = `translate(${c.x}px, ${c.y}px)`
    ;(el.firstElementChild as HTMLElement).style.zoom = String(c.z)
    el.style.setProperty('--iz', String(1 / c.z))
    el.style.setProperty('--lz', labelZ(c.z))
    api.camera = { ...c }
  }, [api])
  const set = (c: Cam) => { cam.current = { ...c, z: clamp(c.z, MIN_Z, MAX_Z) }; apply(); redraw(n => n + 1) }
  const fitTo = (b: { x: number; y: number; w: number; h: number }, pad = 0.9): Cam => {
    const z = clamp(Math.min(size.w / b.w, size.h / b.h) * pad, MIN_Z, MAX_Z)
    return { z, x: size.w / 2 - (b.x + b.w / 2) * z, y: size.h / 2 - (b.y + b.h / 2) * z }
  }
  const fly = (to: Cam, ms = 450, done?: () => void) => {
    const from = { ...cam.current }, t0 = performance.now()
    const step = (now: number) => {
      const k = ease(Math.min(1, (now - t0) / ms))
      // Zoom moves geometrically, so the flight feels even at every scale.
      const z = from.z * Math.pow(to.z / from.z, k)
      set({ z, x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k })
      if (k < 1) requestAnimationFrame(step); else done?.()
    }
    requestAnimationFrame(step)
  }
  const fitAll = () => fly(fitTo({ x: 0, y: 0, w: Math.max(world.w, 1), h: Math.max(world.h, 1) }, 0.92))
  const zoomAt = (f: number, px: number, py: number) => { const c = cam.current, z = clamp(c.z * f, MIN_Z, MAX_Z); set({ z, x: px - (px - c.x) * (z / c.z), y: py - (py - c.y) * (z / c.z) }) }

  useLayoutEffect(() => {
    const el = view.current!
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  // First sight: back from Focus, the map flies out from the screen to where it was; else it fits.
  const placed = useRef(false)
  useEffect(() => {
    if (placed.current || size.w < 2 || !world.boards.length) return
    placed.current = true
    const here = world.boards.find(b => b.kind === 'screen' && b.route === input.place) ?? world.boards.find(b => b.route === input.place)
    if (here && api.camera) { const back = { ...api.camera }; set(fitTo(here, 1)); fly(back, 500) }
    else if (api.camera) set(api.camera)
    else set(fitTo({ x: 0, y: 0, w: world.w, h: world.h }, 0.92))
    if (here) setSel(here.key)
  }, [size, world]) // eslint-disable-line react-hooks/exhaustive-deps

  // Pan by drag (one pointer) and pinch (two); wheel pans, ⌘/Ctrl+wheel zooms; Safari's gestures zoom.
  useEffect(() => {
    const el = view.current!, pts = new Map<number, { x: number; y: number }>()
    let last: { x: number; y: number; d: number } | null = null, moved = 0
    const mid = () => { const p = [...pts.values()]; const x = p.reduce((a, q) => a + q.x, 0) / p.length, y = p.reduce((a, q) => a + q.y, 0) / p.length; return { x, y, d: p.length > 1 ? Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) : 0 } }
    const down = (e: PointerEvent) => { if (e.button > 1 || (e.target as HTMLElement).closest?.('[data-map-handle], [data-map-note], [data-map-tools]')) return; pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); last = mid(); moved = 0; dragged.current = 0 }
    const move = (e: PointerEvent) => {
      if (!pts.has(e.pointerId)) return
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY })
      const now = mid(), r = el.getBoundingClientRect()
      if (!last) return
      moved += Math.abs(now.x - last.x) + Math.abs(now.y - last.y)
      if (moved > 4) el.setPointerCapture?.(e.pointerId)
      if (now.d && last.d) zoomAt(now.d / last.d, now.x - r.left, now.y - r.top)
      set({ ...cam.current, x: cam.current.x + now.x - last.x, y: cam.current.y + now.y - last.y })
      dragged.current = moved
      last = now
    }
    const up = (e: PointerEvent) => { pts.delete(e.pointerId); last = pts.size ? mid() : null }
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      if (e.ctrlKey || e.metaKey) zoomAt(Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top)
      else set({ ...cam.current, x: cam.current.x - e.deltaX, y: cam.current.y - e.deltaY })
    }
    let g = 1
    const gs = (e: Event) => { e.preventDefault(); g = 1 }
    const gc = (e: Event) => { e.preventDefault(); const s = (e as unknown as { scale: number; clientX: number; clientY: number }); const r = el.getBoundingClientRect(); zoomAt(s.scale / g, s.clientX - r.left, s.clientY - r.top); g = s.scale }
    el.addEventListener('pointerdown', down); el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up)
    el.addEventListener('wheel', wheel, { passive: false }); el.addEventListener('gesturestart', gs); el.addEventListener('gesturechange', gc)
    return () => {
      el.removeEventListener('pointerdown', down); el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up)
      el.removeEventListener('wheel', wheel); el.removeEventListener('gesturestart', gs); el.removeEventListener('gesturechange', gc)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (input.hidden) return
    const key = (e: KeyboardEvent) => {
      // Typing, or a key for a focused control (a button, a link, a menu), or anywhere outside the map, isn't the map's.
      const at = e.target instanceof Element ? e.target : null
      if (at && at !== document.body && (at.closest('input, textarea, select, [contenteditable], button, a, [role]') || !at.closest('[data-map]'))) return
      const c = { x: size.w / 2, y: size.h / 2 }
      if (e.key === '+' || e.key === '=') zoomAt(1.25, c.x, c.y)
      else if (e.key === '-') zoomAt(0.8, c.x, c.y)
      else if (e.key === '0') fitAll()
      else if (e.key === 'Enter' && sel) { const b = world.boards.find(x => x.key === sel); if (b) openBoard(b) }
      else return
      e.preventDefault()
    }
    addEventListener('keydown', key)
    return () => removeEventListener('keydown', key)
  })

  // A link dragged from a screen's handle: the line follows the pointer; let go over another screen.
  const startLink = (e: ReactPointerEvent, from: Board) => {
    e.preventDefault()
    const at = (ev: PointerEvent) => { const r = view.current!.getBoundingClientRect(), c = cam.current; return { x: (ev.clientX - r.left - c.x) / c.z, y: (ev.clientY - r.top - c.y) / c.z } }
    const move = (ev: PointerEvent) => setDrag({ from, ...at(ev) })
    const up = (ev: PointerEvent) => {
      removeEventListener('pointermove', move); removeEventListener('pointerup', up)
      setDrag(null)
      // The screen under the pointer, found in the world (a label or a pill over it doesn't hide it).
      const p = at(ev)
      const to = world.boards.find(b => b.kind === 'screen' && b.slug !== from.slug && p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h)
      if (to) setNote({ kind: 'link', a: from, b: to })
    }
    addEventListener('pointermove', move); addEventListener('pointerup', up)
    setDrag({ from, x: from.x + from.w, y: from.y + from.h / 2 })
  }
  // A folded stack is one target: a click anywhere on it spreads it out (its label folds it again).
  const spreadOut = (slug: string) => { setSel(k => k?.startsWith(`opt:${slug}/`) ? null : k); setSpread(s => new Set(s).add(slug)) }
  // A click on the selected board and a double click both open it: the second one of a pair is let go.
  const opening = useRef(0)
  const openBoard = (b: Board) => { if (Date.now() - opening.current < 600) return; opening.current = Date.now(); fly(fitTo(b, 1), 380, () => api.open(b.route)) }
  const c = cam.current
  // What is on screen, in world pixels, with a screen's margin around it.
  const vis = { x0: -c.x / c.z - size.w / c.z, y0: -c.y / c.z - size.h / c.z, x1: (size.w * 2 - c.x) / c.z, y1: (size.h * 2 - c.y) / c.z }
  const near = world.boards.filter(b => b.x + b.w > vis.x0 && b.x < vis.x1 && b.y + b.h > vis.y0 && b.y < vis.y1 && b.w * c.z > 90)
    .sort((a, b) => Math.hypot(a.x + a.w / 2 + c.x / c.z - size.w / 2 / c.z, a.y + a.h / 2 + c.y / c.z - size.h / 2 / c.z) - Math.hypot(b.x + b.w / 2 + c.x / c.z - size.w / 2 / c.z, b.y + b.h / 2 + c.y / c.z - size.h / 2 / c.z))
  const live = new Set(near.slice(0, MAX_LIVE).map(b => b.key))
  const variantOf = (b: Board) => input.protos.find(p => p.id === b.slug)?.variants.find(v => v.id === b.letter)
  const selBoard = world.boards.find(b => b.key === sel)
  const screenOf = (slug: string, design?: string) => world.boards.find(b => b.kind === 'screen' && b.slug === slug && (!design || b.design === design))
  const lines = world.boards.filter(b => b.kind === 'screen').flatMap(a => (links[a.route] ?? []).map(to => ({ a, b: screenOf(to, a.design), to })).filter(l => !!l.b && l.b !== a))
    .filter(l => input.lines === 'all' || (selBoard && (l.a.slug === selBoard.slug || l.b!.slug === selBoard.slug)))

  return (
    <div ref={view} data-map className={'absolute inset-0 touch-none select-none overflow-hidden ' + (input.hidden ? 'hidden' : '')} style={{ cursor: 'grab' }}
      onClick={e => { if (e.target === view.current) setSel(null) }}>
      <div ref={layer} className="absolute left-0 top-0 origin-top-left" style={{ ['--iz' as string]: String(1 / c.z), ['--lz' as string]: labelZ(c.z) }}>
        <div className="relative" style={{ width: world.w, height: world.h }}>
          <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width={world.w} height={world.h}>
            {lines.map(({ a, b, to }) => <g key={`${a.key}>${to}`}>
              <path data-map-line={`${a.slug}>${to}`} d={linePath(a, b!)} fill="none" className={note?.kind === 'line' && note.a === a && note.b === b ? 'stroke-violet-500' : 'stroke-sky-500/70'} style={{ strokeWidth: 'calc(2px * var(--iz))' }} />
              {/* A wide, unseen stroke to click: a note on this link. */}
              <path data-map-line-hit={`${a.slug}>${to}`} d={linePath(a, b!)} fill="none" stroke="transparent" className="pointer-events-auto cursor-pointer" style={{ strokeWidth: 'calc(14px * var(--iz))' }}
                onClick={e => { e.stopPropagation(); if (dragged.current < 6 && !ro) setNote({ kind: 'line', a, b: b! }) }} />
            </g>)}
            {drag && <path data-map-drag d={`M${drag.from.x + drag.from.w},${drag.from.y + drag.from.h / 2} L${drag.x},${drag.y}`} fill="none" className="stroke-violet-500" style={{ strokeWidth: 'calc(2px * var(--iz))', strokeDasharray: 'calc(6px * var(--iz))' }} />}
          </svg>
          {world.labels.map(l => (
            // Above its anchor, one size on screen: a design's name over its first flow's, a flow's over its row.
            // Rounds name themselves once their cards are big enough to tell apart; a long name truncates at its round's width.
            (l.kind !== 'round' || (world.boards.find(b => b.slug === l.slug)?.w ?? 0) * c.z > 60) &&
            <div key={l.key} data-map-label={l.key} className="absolute whitespace-nowrap" style={{ left: l.x, top: l.y, ...(l.w ? { maxWidth: l.w + GAP * 0.8 } : {}), fontSize: `calc(${l.kind === 'design' ? 22 : l.kind === 'flow' ? 15 : 13}px * var(--lz))`,
              transform: `translateY(calc(-100% - ${l.kind === 'design' || l.kind === 'section' ? 34 : 8}px * var(--lz)))` }}>
              {l.kind === 'round'
                ? <button type="button" data-map-round={l.slug} onClick={() => setSpread(s => { const n = new Set(s); if (n.has(l.slug!)) n.delete(l.slug!); else n.add(l.slug!); return n })}
                    className="flex max-w-full items-center gap-[calc(6px*var(--iz))] rounded-full text-zinc-600 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-white">
                    <span className={'shrink-0 rounded-full ' + (l.state === 'done' ? 'bg-emerald-500' : 'bg-amber-500')} style={{ width: 'calc(8px*var(--iz))', height: 'calc(8px*var(--iz))' }} />
                    <span dir="auto" className="truncate font-medium">{l.own ? t('Options') : l.text}</span><span className="shrink-0 text-zinc-400">· {l.count}</span>
                  </button>
                : l.kind === 'flow'
                ? <button type="button" data-map-flow={l.key} title={t('A note on this flow')} disabled={ro} onClick={() => { const [, design, ...rest] = l.key.split(':'), flow = rest.join(':'), a = world.boards.find(b => b.kind === 'screen' && b.design === design && b.flow === flow); if (a) setNote({ kind: 'flow', design, flow, a }) }}
                    className="rounded-md font-medium text-zinc-700 hover:text-violet-600 dark:text-zinc-200 dark:hover:text-violet-300"><span dir="auto">{l.text}</span><span className="text-zinc-400"> · {l.count}</span></button>
                : <span dir="auto" className={l.kind === 'design' ? 'font-semibold text-indigo-600 dark:text-indigo-300' : l.kind === 'flow' ? 'font-medium text-zinc-700 dark:text-zinc-200' : 'text-zinc-400'}>
                    {l.kind === 'section' ? t('Explorations on no screen') : l.text}{l.count != null && l.kind === 'flow' ? <span className="text-zinc-400"> · {l.count}</span> : null}
                  </span>}
            </div>
          ))}
          {world.boards.map(b => {
            const on = b.key === sel, here = b.route === input.place
            return (
              <div key={b.key} data-map-board={b.key} {...b.pile != null ? { 'data-map-pile': b.pile } : {}}
                onClick={e => { e.stopPropagation(); if (dragged.current >= 6) return; if (b.pile != null) spreadOut(b.slug); else if (on && e.detail < 2) openBoard(b); else setSel(b.key) }}
                onDoubleClick={() => { if (b.pile == null) openBoard(b) }}
                className={'absolute overflow-hidden rounded-[calc(10px*var(--iz))] bg-white shadow-[0_1px_3px_rgb(0_0_0/.08)] dark:bg-zinc-900'}
                style={{ left: b.x, top: b.y, width: b.w, height: b.h, zIndex: b.pile != null ? 3 - b.pile : undefined, cursor: 'pointer',
                  outline: on || here ? `calc(2px * var(--iz)) solid ${on ? '#0ea5e9' : '#10b981'}` : `calc(1px * var(--iz)) solid rgb(0 0 0 / .08)` }}>
                <div className="absolute left-0 top-0 origin-top-left" style={{ width: b.w / b.scale, height: b.h / b.scale, zoom: b.scale }}>
                  <Preview v={variantOf(b)} live={live.has(b.key) && !input.hidden} mount={api.mount} />
                </div>
                {!live.has(b.key) && <div className={'absolute inset-0 grid place-items-center bg-zinc-50 text-zinc-400 dark:bg-zinc-900'} style={{ fontSize: 'calc(13px * var(--lz))' }}><span dir="auto" className={b.pile ? 'invisible' : ''}>{b.title}</span></div>}
                {busy.has(b.route) && !b.pile && b.kind === 'option' && (
                  // An option's card is small: a dot, its name in the title, so the card's own name stays readable.
                  <span data-map-building={busy.get(b.route)} title={busy.get(b.route) === 'building' ? t('Building') : t('Editing')} className="absolute end-[calc(8px*var(--iz))] top-[calc(8px*var(--iz))] size-[calc(8px*var(--iz))] animate-pulse rounded-full bg-emerald-500 shadow-[0_0_0_calc(2px*var(--iz))_white] dark:shadow-[0_0_0_calc(2px*var(--iz))_rgb(24_24_27)]" style={{ zIndex: 2 }} />
                )}
                {busy.has(b.route) && !b.pile && b.kind === 'screen' && (
                  <span data-map-building={busy.get(b.route)} className="absolute start-[calc(8px*var(--iz))] top-[calc(8px*var(--iz))] inline-flex items-center gap-[calc(6px*var(--iz))] rounded-full bg-zinc-900/80 px-[calc(8px*var(--lz))] py-[calc(3px*var(--lz))] font-medium text-white shadow backdrop-blur" style={{ fontSize: 'calc(11px * var(--lz))', zIndex: 2 }}>
                    <span className="size-[calc(6px*var(--lz))] animate-pulse rounded-full bg-emerald-400" />{busy.get(b.route) === 'building' ? t('Building') : t('Editing')}
                  </span>
                )}
              </div>
            )
          })}
          {world.boards.filter(b => (b.pile ?? 0) === 0 && b.w * c.z > (b.kind === 'screen' ? 60 : 110)).map(b => (
            <div key={`n:${b.key}`} className="pointer-events-none absolute flex items-center gap-[calc(6px*var(--iz))] whitespace-nowrap text-zinc-500" style={{ left: b.x, top: b.y + b.h + 6 / c.z, fontSize: `calc(${b.kind === 'screen' ? 13 : 11}px * var(--lz))`, zIndex: 4 }}>
              {b.kind === 'screen' ? <span dir="auto" className="font-medium text-zinc-700 dark:text-zinc-200">{b.title}</span> : <span className="tabular-nums">#{numberOf(b.letter)}</span>}
              {b.picked && <Ph name="checkFill" className="size-[calc(12px*var(--iz))] text-emerald-500" />}
              {b.standIn && <span className="rounded bg-zinc-900/[.06] px-1 dark:bg-white/10">{t('not picked')}</span>}
            </div>
          ))}
          {selBoard?.kind === 'screen' && !drag && !ro && (
            // Drag from here to another screen: a link, sent to the agent to put on the right element.
            <span data-map-handle role="button" aria-label={t('Drag to another screen to link them')} title={t('Drag to another screen to link them')} onPointerDown={e => startLink(e, selBoard)}
              className="absolute grid cursor-crosshair touch-none place-items-center rounded-full bg-violet-500 shadow ring-white dark:ring-zinc-900"
              style={{ left: selBoard.x + selBoard.w, top: selBoard.y + selBoard.h / 2, width: 'calc(16px * var(--iz))', height: 'calc(16px * var(--iz))', transform: 'translate(-50%, -50%)', boxShadow: '0 0 0 calc(3px * var(--iz)) white', zIndex: 6 }} />
          )}
        </div>
      </div>
      <div data-map-tools className="absolute bottom-3 end-3 flex items-center gap-1 rounded-xl bg-white/90 p-1 text-[12px] shadow ring-1 ring-black/[.06] backdrop-blur dark:bg-zinc-900/90 dark:ring-white/10">
        {input.designs.length > 1 && (
          <select data-map-design aria-label={t('Design')} value={input.design} onChange={e => api.setDesign(e.target.value)}
            className="h-7 max-w-40 rounded-lg bg-transparent px-1 text-zinc-600 hover:bg-zinc-900/5 dark:text-zinc-300 dark:hover:bg-white/10">
            <option value="">{t('All designs')}</option>
            {input.designs.map(d => <option key={d.id} value={d.id}>{d.title}</option>)}
          </select>
        )}
        {one && !ro && <button type="button" data-map-build aria-pressed={build} onClick={() => { setNote(null); setBuild(b => !b) }} className="h-7 rounded-lg px-2 font-medium text-zinc-700 hover:bg-zinc-900/5 dark:text-zinc-200 dark:hover:bg-white/10">{t('Build it…')}</button>}
        <button type="button" data-map-lines aria-pressed={input.lines === 'selected'} onClick={() => api.setLines(input.lines === 'all' ? 'selected' : 'all')}
          className="h-7 rounded-lg px-2 text-zinc-600 hover:bg-zinc-900/5 dark:text-zinc-300 dark:hover:bg-white/10">{input.lines === 'all' ? t('All links') : t('Selected only')}</button>
        <button type="button" data-map-zoom="out" aria-label={t('Zoom out')} title={t('Zoom out') + ' (-)'} onClick={() => zoomAt(0.8, size.w / 2, size.h / 2)} className="grid size-7 place-items-center rounded-lg text-zinc-600 hover:bg-zinc-900/5 dark:text-zinc-300 dark:hover:bg-white/10"><Ph name="minus" className="size-3.5" /></button>
        <button type="button" data-map-zoom="in" aria-label={t('Zoom in')} title={t('Zoom in') + ' (+)'} onClick={() => zoomAt(1.25, size.w / 2, size.h / 2)} className="grid size-7 place-items-center rounded-lg text-zinc-600 hover:bg-zinc-900/5 dark:text-zinc-300 dark:hover:bg-white/10"><Ph name="plus" className="size-3.5" /></button>
        <button type="button" data-map-fit onClick={fitAll} title={t('Fit (0)')} className="h-7 rounded-lg px-2 text-zinc-600 hover:bg-zinc-900/5 dark:text-zinc-300 dark:hover:bg-white/10">{t('Fit')}</button>
        <span className="w-10 text-center tabular-nums text-zinc-400">{Math.round(c.z * 100)}%</span>
      </div>
      {build && one && !note && <BuildBox design={one} boards={world.boards} api={api} onClose={() => setBuild(false)} />}
      {note && <NoteBox key={`${note.kind}:${note.a.key}:${'b' in note ? note.b.key : note.flow}`} note={note} api={api} onClose={() => setNote(null)} />}
      {selBoard && !note && !build && (
        <div className="absolute inset-x-0 bottom-3 mx-auto flex w-fit max-w-[calc(100%-2rem)] items-center gap-2 rounded-xl max-sm:bottom-14 bg-zinc-900 px-3 py-1.5 text-[12px] text-white shadow-lg dark:bg-white dark:text-zinc-900">
          <span dir="auto" className="font-medium">{selBoard.title}</span>{selBoard.kind === 'option' && <span className="opacity-60">#{numberOf(selBoard.letter)}</span>}
          <button type="button" data-map-open onClick={() => openBoard(selBoard)} className="rounded-md bg-white/15 px-2 py-0.5 dark:bg-zinc-900/10">{t('Open')}</button>
        </div>
      )}
    </div>
  )
}

/** Words to the agent about a link, a flow, or a link to add: what it is about, a field, Send. */
function NoteBox({ note, api, onClose }: { note: Note; api: MapApi; onClose: () => void }) {
  const [text, setText] = useState(''), [state, setState] = useState<'' | 'sending' | 'sent' | 'failed'>('')
  const field = useRef<HTMLTextAreaElement>(null)
  useEffect(() => { field.current?.focus() }, [])
  const what = note.kind === 'flow' ? t('A note on the flow {flow}', { flow: note.flow })
    : note.kind === 'line' ? t('A note on the link {a} → {b}', { a: note.a.title, b: note.b.title })
    : t('Link {a} → {b}', { a: note.a.title, b: note.b.title })
  const ok = note.kind === 'link' || text.trim().length > 0
  const send = async () => {
    if (!ok || state === 'sending') return
    const words = text.trim(), on = { proto: note.a.slug, variant: note.a.letter }
    setState('sending')
    try {
      if (note.kind === 'link') await api.ask(on, 'add-link', `Add a link from this screen to ${note.b.slug} (<Go to="${note.b.slug}">)${words ? `: ${words}` : '. Put it on the element it belongs on.'}`)
      else if (note.kind === 'line') await api.ask(on, 'map-note', `About the link from ${note.a.slug} to ${note.b.slug}: ${words}`)
      else await api.ask(on, 'map-note', `About the flow ${note.flow} of the design ${note.design}: ${words}`)
      setState('sent'); setTimeout(onClose, 1200)
    } catch { setState('failed') }
  }
  return (
    <div data-map-note={note.kind} className="absolute inset-x-0 bottom-3 mx-auto max-sm:bottom-14 w-[min(26rem,calc(100%-2rem))] rounded-2xl bg-white p-3 text-[13px] shadow-[0_18px_44px_-14px_rgb(0_0_0/.35)] ring-1 ring-black/[.06] dark:bg-zinc-900 dark:text-zinc-100 dark:ring-white/10">
      <div className="mb-2 flex items-center gap-2"><span dir="auto" className="min-w-0 flex-1 truncate font-medium">{what}</span>
        <button type="button" aria-label={t('Close')} onClick={onClose} className="grid size-7 place-items-center rounded-lg text-zinc-400 hover:bg-zinc-900/5 dark:hover:bg-white/10"><Ph name="x" className="size-3.5" /></button></div>
      <textarea ref={field} data-map-note-field dir="auto" rows={2} value={text} onChange={e => setText(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send() } else if (e.key === 'Escape') { e.stopPropagation(); onClose() } }}
        placeholder={note.kind === 'link' ? t('Which element should link there? (optional)') : t('What should change?')}
        className="w-full resize-none rounded-lg bg-zinc-900/[.04] px-2.5 py-2 outline-none placeholder:text-zinc-400 focus-visible:ring-2 focus-visible:ring-violet-500/40 dark:bg-white/[.06]" />
      <div className="mt-2 flex items-center justify-end gap-2">
        {state === 'sent' && <span className="text-emerald-600">{t('Sent')}</span>}
        {state === 'failed' && <span className="text-rose-600">{t('Could not send it. Try again.')}</span>}
        <button type="button" data-map-note-send disabled={!ok || state === 'sending'} onClick={() => void send()} className="h-8 rounded-full bg-proto-primary px-3 font-medium text-proto-primary-fg hover:bg-proto-primary-hover disabled:opacity-40">{note.kind === 'link' ? t('Ask for this link') : t('Send')}</button>
      </div>
    </div>
  )
}

/** Build it on a design: its screens to tick (the picked ones by default; an open one is marked), then one request to the agent. */
function BuildBox({ design, boards, api, onClose }: { design: Design; boards: Board[]; api: MapApi; onClose: () => void }) {
  const screens = boards.filter(b => b.kind === 'screen' && b.design === design.id)
  const [on, setOn] = useState(() => new Set(screens.filter(b => !b.standIn).map(b => b.key)))
  const [state, setState] = useState<'' | 'sending' | 'sent' | 'failed'>('')
  const chosen = screens.filter(b => on.has(b.key))
  const send = async () => {
    if (!chosen.length || state === 'sending') return
    const list = chosen.map(b => b.key.slice('screen:'.length)), open = chosen.filter(b => b.standIn).map(b => b.slug)
    setState('sending')
    try {
      await api.ask({ proto: chosen[0].slug, variant: chosen[0].letter }, 'build-design',
        `Build the design ${design.title} (${design.id}): ${list.join(', ')}. Plan: proto handoff --design ${design.id} --screens ${list.join(',')}.${open.length ? ` Still open, #1 stands in: ${open.join(', ')}.` : ''}`)
      setState('sent'); setTimeout(onClose, 1200)
    } catch { setState('failed') }
  }
  return (
    <div data-map-build-box data-map-note="build" className="absolute inset-x-0 bottom-3 mx-auto max-sm:bottom-14 w-[min(24rem,calc(100%-2rem))] rounded-2xl bg-white p-3 text-[13px] shadow-[0_18px_44px_-14px_rgb(0_0_0/.35)] ring-1 ring-black/[.06] dark:bg-zinc-900 dark:text-zinc-100 dark:ring-white/10">
      <div className="mb-1 flex items-center gap-2"><span dir="auto" className="min-w-0 flex-1 truncate font-medium">{t('Build {name}', { name: design.title })}</span>
        <button type="button" aria-label={t('Close')} onClick={onClose} className="grid size-7 place-items-center rounded-lg text-zinc-400 hover:bg-zinc-900/5 dark:hover:bg-white/10"><Ph name="x" className="size-3.5" /></button></div>
      <p className="mb-2 text-zinc-500">{t('The screens you tick, with their links as real navigation.')}</p>
      <div className="max-h-56 space-y-px overflow-y-auto">
        {screens.map(b => (
          <label key={b.key} className="flex h-9 cursor-pointer items-center gap-2.5 rounded-lg px-2 hover:bg-zinc-900/[.03] dark:hover:bg-white/5">
            <input type="checkbox" data-map-build-screen={b.key} checked={on.has(b.key)} onChange={() => setOn(s => { const n = new Set(s); if (n.has(b.key)) n.delete(b.key); else n.add(b.key); return n })} className="size-4 accent-violet-600" />
            <span dir="auto" className="min-w-0 flex-1 truncate">{b.title}</span>
            <span className={'shrink-0 text-[11px] ' + (b.standIn ? 'text-amber-600' : 'text-zinc-400')}>{b.standIn ? t('not picked') : `#${numberOf(b.letter)}`}</span>
          </label>
        ))}
      </div>
      <div className="mt-2 flex items-center justify-end gap-2">
        {state === 'sent' && <span className="text-emerald-600">{t('Sent')}</span>}
        {state === 'failed' && <span className="text-rose-600">{t('Could not send it. Try again.')}</span>}
        <button type="button" data-map-build-send disabled={!chosen.length || state === 'sending'} onClick={() => void send()} className="h-8 rounded-full bg-proto-primary px-3 font-medium text-proto-primary-fg hover:bg-proto-primary-hover disabled:opacity-40">{tn(chosen.length, 'Build 1 screen', 'Build {n} screens')}</button>
      </div>
    </div>
  )
}

export function mountMap(host: HTMLElement, api: MapApi) {
  const root = createRoot(host)
  root.render(<MapView api={api} />)
  return () => root.unmount()
}
