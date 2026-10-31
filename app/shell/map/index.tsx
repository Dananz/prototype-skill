// The map: every design's screens, the explorations under them and the links between them, on one
// infinite desk (spec decision 11). Drag or scroll moves it; pinch, ⌘/Ctrl+scroll, + and - zoom
// about the pointer; 0 fits. The camera is a translate on the outer layer and CSS zoom on the world
// (never a scale transform), so Safari keeps one real layout per design; labels stay one size at
// any zoom through --iz (1 / zoom). A double click on a screen flies into it and opens it (Focus);
// the shell flies back out here when Focus is left.
import { domToCanvas } from 'modern-screenshot'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from 'react'
import { createRoot } from 'react-dom/client'
import type { Design, Proto, Variant } from '../shell'
import { t, tn } from '../i18n'
import { numberOf } from '../variants'
import { CARD, GAP, linePath, worldOf, type Board, type World } from './world'
import { Ph } from '../tree/row'

export type MapInput = {
  protos: Proto[]; designs: Design[]; place: string; hidden: boolean; lines: 'all' | 'selected'; design: string
  /** A share's viewer: look and open only (no notes, links or Build it); the links come with the designs. */
  readOnly?: boolean
  /** Counts edits to the prototypes' files: the links are read again. */
  edits?: number
  /** The clear part of the map (`left,top,right,bottom` insets in px) when it runs under the page's cards: fits centre there. */
  safe?: string
  /** An area to show (a design's or flow's key, `#n` to ask again): the camera fits it, ending any Focus flight back. */
  frame?: string
  /** Each prototype's count of file edits (`slug:n`, space-separated): a board's still is taken again when it moves. */
  stamps?: string
  /** What the agent is writing now: `route:building` or `route:editing`, space-separated. */
  working?: string
  /** The route in Focus, drawn in place on its board: the map stays, the page's view of it sits in the board's slot. */
  focus?: string
}
export type MapApi = {
  get(): MapInput; subscribe(fn: () => void): () => void
  /** Opens a route in Focus. */
  open(route: string): void
  /** The focused board's slot, where the page puts its view of the design (null when none). */
  slot?(el: HTMLElement | null): void
  /** Ends Focus where the map is (zoomed out past the focused board). */
  leave?(): void
  /** The page's controls for the map (its zoom pill and strip), set by the map. */
  ctl?: { zoom(f: number): void; fit(): void; build(): void }
  /** The map's state for those controls: its zoom as the design's own size, Build it open and offered. With it, the page draws the controls. */
  report?(s: { pct: number; build: boolean; one: boolean }): void
  /** A box of the map's (Build it, a note) opened or closed: the comments island steps aside for it. */
  panel?(open: boolean): void
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
// The zoom reads as the design's own size (an option card is CARD of it), up to MAX_SIZE of it.
const MAX_SIZE = 5, MIN_Z = 0.02, MAX_Z = MAX_SIZE / CARD
/** A fold or a spread animates at most this many cards (those in view nearest the middle), for this long. */
const MAX_ANIM = 24, ANIM_MS = 380
/** How far under its fit the design in Focus is zoomed out before the map takes over again. */
const OUT = 0.55
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))
/** Labels keep one size on screen (1 / zoom), shrinking to 60 % when the map is zoomed far out (a phone fitting it all), so they never cover the boards. */
const labelZ = (z: number) => String(clamp(z / 0.2, 0.6, 1) / z)

/** A design's variant, drawn inert in its frame while it is on screen and big enough to read. */
// A board shows its page as a still, once its entrance settled, instead of the live page: a map full of
// live pages loads every one of them and keeps them all animating. The dev server takes them in
// headless Chrome (app/stills.mjs), at the screen's own size and 2x, with a small one for a board seen
// small, and keeps them on disk until its prototype's files change. Where there is no server (a share)
// the page takes them itself, one at a time, in a hidden box of the board's frame.
type Shot = { url: string; thumb?: string }
const stills = new Map<string, Shot>(), latest = new Map<string, Shot>(), asked = new Map<string, Promise<Shot | null>>()
type Served = { url?: string; thumb?: string; error?: string }
const heard = new Map<string, (r: Served) => void>()
if (import.meta.hot) import.meta.hot.on('proto:still', (d: Served & { hash: string }) => { heard.get(d.hash)?.(d); heard.delete(d.hash) })
let noServer = !import.meta.hot
/** The server's still of a route, once it's taken; null where the server takes none. */
async function served(route: string, w: number, h: number, theme: string): Promise<Served | null> {
  if (noServer) return null
  try {
    const r = await fetch('/__proto/still', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ route, w: Math.round(w), h: Math.round(h), theme }) })
    if (!r.ok) { if (r.status === 404 || r.status === 405) noServer = true; return null }
    const d = await r.json() as Served & { hash: string; pending?: boolean; unavailable?: boolean }
    if (d.unavailable) { noServer = true; return null }
    if (!d.pending) return d
    return await new Promise<Served>(ok => {
      heard.set(d.hash, ok)
      setTimeout(() => { if (heard.get(d.hash) === ok) { heard.delete(d.hash); ok({ error: 'took too long' }) } }, 30_000)
    })
  } catch { return null }
}
// The stills waiting, the best ranked first (screens, then nearest the middle): three asked of the
// server at once (it takes them in three tabs), one at a time where the page takes them itself.
const waiting: { rank: () => number; run: () => Promise<void> }[] = []
let taking = 0
async function pump() {
  if (taking >= (noServer ? 1 : 3)) return
  taking++
  while (waiting.length) {
    waiting.sort((a, b) => a.rank() - b.rank())
    await waiting.shift()!.run()
  }
  taking--
}
const SETTLE_MIN = 2000, SETTLE_MAX = 4500
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
/** Waits out the entrance: a floor (script-driven motion can't be seen), then until no finite animation runs. */
async function settle(box: HTMLElement) {
  const t0 = performance.now()
  await sleep(SETTLE_MIN)
  while (performance.now() - t0 < SETTLE_MAX && box.getAnimations({ subtree: true }).some(a => a.playState === 'running' && a.effect?.getTiming().iterations !== Infinity)) await sleep(150)
  await document.fonts.ready
  await Promise.all([...box.querySelectorAll('img')].map(i => i.decode().catch(() => {})))
}
function stillOf(key: string, route: string, v: Variant, w: number, h: number, scale: number, mount: MapApi['mount'], wanted: () => boolean, rank: () => number): Promise<Shot | null> {
  const had = asked.get(key)
  if (had) return had
  let done: (u: Shot | null) => void = () => {}
  const job = new Promise<Shot | null>(r => { done = r })
  const take = async (): Promise<Shot | null> => {
    if (!wanted()) { asked.delete(key); return null }
    const dark = document.documentElement.classList.contains('dark')
    const got = await served(route, w, h, dark ? 'dark' : 'light')
    if (got?.url) { const shot = { url: got.url, thumb: got.thumb }; stills.set(key, shot); latest.set(route, shot); return shot }
    if (got?.error && !wanted()) { asked.delete(key); return null }
    const box = document.createElement('div')
    box.dataset.mount = ''; box.dataset.mapCapture = ''; box.inert = true; box.dir = 'ltr'
    if (v.theme) box.dataset.protoTheme = v.theme
    box.style.cssText = `position:fixed;left:0;top:0;width:${w}px;height:${h}px;overflow:hidden;opacity:0;pointer-events:none;contain:strict;z-index:-1`
    document.body.append(box)
    let off: (() => void) | null = null
    try {
      off = mount(box, await v.load())
      await settle(box)
      const canvas = await domToCanvas(box, {
        scale, width: w, height: h, backgroundColor: dark ? '#09090b' : '#ffffff',
        style: { opacity: '1', position: 'static', zIndex: 'auto' },
        filter: n => !(n.nodeType === 1 && (n as Element).matches('[data-proto-ui], vite-error-overlay')),
      })
      const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, 'image/webp', 0.9))
      if (!blob) throw new Error('no still')
      const shot = { url: URL.createObjectURL(blob) }
      stills.set(key, shot); latest.set(route, shot)
      return shot
    } catch { asked.delete(key); return null }
    finally { try { off?.() } catch { /* gone */ } box.remove() }
  }
  waiting.push({ rank, run: () => take().then(done, () => done(null)) })
  asked.set(key, job)
  void pump(); void pump(); void pump()
  return job
}
function Still({ v, route, w, h, size, want, sharp, rank, stamp, mount }: { v: Variant | undefined; route: string; w: number; h: number; size: number; want: boolean; sharp: boolean; rank: number; stamp: string; mount: MapApi['mount'] }) {
  const ranked = useRef(rank); ranked.current = rank
  // Taken in the tab: sharp at the board's size on the map at 100% (an option card is a third of its frame), on this screen.
  const scale = Math.round(Math.min(2, devicePixelRatio || 1) * size * 100) / 100
  const key = `${route}|${stamp}|${noServer ? scale : `${Math.round(w)}x${Math.round(h)}`}|${document.documentElement.classList.contains('dark') ? 'dark' : 'light'}`
  // The last still of this route shows while a new one is taken.
  const [shot, setShot] = useState<Shot | null>(() => stills.get(key) ?? latest.get(route) ?? null)
  // The full size is laid over the small one once it has loaded, so the board never blinks.
  const [full, setFull] = useState<string | null>(null)
  useEffect(() => {
    const have = stills.get(key)
    if (have) { setShot(have); return }
    if (!want || !v) return
    let gone = false
    stillOf(key, route, v, w, h, scale, mount, () => !gone, () => ranked.current).then(u => { if (!gone && u) setShot(u) })
    return () => { gone = true }
  }, [key, want, v, mount]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!shot) return null
  const cls = 'pointer-events-none absolute inset-0 h-full w-full object-cover object-top'
  if (!shot.thumb) return <img data-map-still src={shot.url} alt="" draggable={false} className={cls} />
  return <>
    <img data-map-still src={shot.thumb} alt="" draggable={false} className={cls} />
    {(sharp || full === shot.url) && <img data-map-still="full" src={shot.url} alt="" draggable={false} decoding="async" onLoad={() => setFull(shot.url)} className={cls} style={{ opacity: full === shot.url ? 1 : 0 }} />}
  </>
}
/** The board being read, live: sharp at any zoom. It shows over its still once its entrance has played out. */
function Live({ v, mount }: { v: Variant | undefined; mount: MapApi['mount'] }) {
  const host = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!v) return
    const box = document.createElement('div')
    box.dataset.mount = ''; box.dataset.mapLive = ''; box.inert = true; box.dir = 'ltr'
    box.className = 'pointer-events-none absolute inset-0 overflow-hidden bg-white opacity-0 transition-opacity duration-200 dark:bg-zinc-950'
    if (v.theme) box.dataset.protoTheme = v.theme
    host.current!.append(box)
    let off: (() => void) | null = null, gone = false
    v.load().then(async c => {
      if (gone) return
      off = mount(box, c)
      const t0 = performance.now()
      await sleep(300)
      while (!gone && performance.now() - t0 < 2500 && box.getAnimations({ subtree: true }).some(a => a.playState === 'running' && a.effect?.getTiming().iterations !== Infinity)) await sleep(120)
      if (!gone) box.style.opacity = '1'
    }, () => { /* the still stays */ })
    return () => { gone = true; box.remove(); if (off) { const o = off; setTimeout(() => { try { o() } catch { /* gone */ } }) } }
  }, [v, mount])
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
  const sizeRef = useRef(size); sizeRef.current = size
  // The board the zoom is read against: the one in Focus, else the nearest the middle.
  const refScale = useRef(1)
  const safe = useMemo(() => { const [l = 0, t = 0, r = 0, b = 0] = (input.safe ?? '').split(',').map(Number); return { l, t, r, b } }, [input.safe])
  const safeRef = useRef(safe); safeRef.current = safe
  /** The clear part of the map: where fits land and zooms centre. */
  const clear = () => { const s = sizeRef.current, k = safeRef.current; return { x: k.l, y: k.t, w: Math.max(1, s.w - k.l - k.r), h: Math.max(1, s.h - k.t - k.b) } }

  const apply = useCallback(() => {
    const c = cam.current, el = layer.current
    if (!el) return
    el.style.transform = `translate(${c.x}px, ${c.y}px)`
    ;(el.firstElementChild as HTMLElement).style.zoom = String(c.z)
    el.style.setProperty('--iz', String(1 / c.z))
    el.style.setProperty('--lz', labelZ(c.z))
    api.camera = { ...c }
  }, [api])
  // The camera at rest: a quarter second after its last move (a board goes live only then).
  const [resting, setResting] = useState(true)
  const restTimer = useRef(0)
  const set = (c: Cam) => {
    cam.current = { ...c, z: clamp(c.z, MIN_Z, MAX_Z) }; apply(); redraw(n => n + 1)
    setResting(false); clearTimeout(restTimer.current); restTimer.current = window.setTimeout(() => setResting(true), 250)
  }
  const fitTo = (b: { x: number; y: number; w: number; h: number }, pad = 0.9): Cam => {
    const a = clear(), z = clamp(Math.min(a.w / b.w, a.h / b.h) * pad, MIN_Z, MAX_Z)
    return { z, x: a.x + a.w / 2 - (b.x + b.w / 2) * z, y: a.y + a.h / 2 - (b.y + b.h / 2) * z }
  }
  // One flight at a time: a new one takes over from the one under way. It leaves at once and settles
  // softly (a quartic ease-out), a little longer the further it goes: about a third of a second for a step,
  // at most 0.65 s across the map. The middle of the view travels through the world while the zoom moves
  // geometrically, so what it flies to comes straight at you instead of swinging in.
  const flight = useRef(0)
  // Where a run of + or - presses is headed, so each press steps on from the last, not from mid-glide.
  const flightTo = useRef<Cam | null>(null)
  const fly = (to: Cam, ms?: number, done?: () => void) => {
    const from = { ...cam.current }, id = ++flight.current
    flightTo.current = null
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { set(to); done?.(); return }
    const a = clear(), px = a.x + a.w / 2, py = a.y + a.h / 2
    const w0 = { x: (px - from.x) / from.z, y: (py - from.y) / from.z }, w1 = { x: (px - to.x) / to.z, y: (py - to.y) / to.z }
    const far = (Math.hypot(w1.x - w0.x, w1.y - w0.y) * Math.min(from.z, to.z)) / Math.max(a.w, 1)
    const dur = ms ?? clamp(340 + 90 * Math.abs(Math.log(to.z / from.z)) + 140 * far, 340, 650)
    const t0 = performance.now()
    const step = (now: number) => {
      if (id !== flight.current) return
      const t = Math.min(1, (now - t0) / dur), k = 1 - Math.pow(1 - t, 4)
      const z = from.z * Math.pow(to.z / from.z, k), cx = w0.x + (w1.x - w0.x) * k, cy = w0.y + (w1.y - w0.y) * k
      set(t < 1 ? { z, x: px - cx * z, y: py - cy * z } : to)
      if (t < 1) requestAnimationFrame(step); else done?.()
    }
    requestAnimationFrame(step)
  }
  const fitAll = () => fly(fitTo({ x: 0, y: 0, w: Math.max(world.w, 1), h: Math.max(world.h, 1) }, 0.92))
  // The hand takes over from a flight under way (a wheel, a pinch, a drag): it stops where it is.
  const grab = () => { flight.current++; flightTo.current = null }
  const zoomAt = (f: number, px: number, py: number) => {
    grab()
    const c = cam.current, z = clamp(c.z * f, MIN_Z, MAX_SIZE / refScale.current)
    set({ z, x: px - (px - c.x) * (z / c.z), y: py - (py - c.y) * (z / c.z) })
    if (f < 1) leaveIfOut()
  }
  // Zoomed out well past the design in Focus: that is the map again, right where the camera is.
  const leaveIfOut = () => {
    const fb = focusRef.current, a = clear()
    if (fb && cam.current.z < Math.min(a.w / fb.w, a.h / fb.h) * OUT) { before.current = null; was.current = ''; api.leave?.() }
  }

  useLayoutEffect(() => {
    const el = view.current!
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  // First sight: back from Focus, the map flies out from the screen to where it was; else it fits.
  const placed = useRef(false)
  // The focus seen last, and the camera before Focus took it (where leaving it flies back to).
  const was = useRef(''), before = useRef<Cam | null>(null), focusRef = useRef<Board | null>(null)
  useEffect(() => {
    if (placed.current || size.w < 2 || !world.boards.length) return
    placed.current = true
    const here = world.boards.find(b => b.kind === 'screen' && b.route === input.place) ?? world.boards.find(b => b.route === input.place)
    const focused = input.focus ? world.boards.find(b => b.kind === 'screen' && b.route === input.focus) ?? world.boards.find(b => b.route === input.focus) : undefined
    if (focused) { before.current = fitTo({ x: 0, y: 0, w: world.w, h: world.h }, 0.92); set(fitTo(focused, 1)); was.current = input.focus ?? '' }
    else if (here && api.camera) { const back = { ...api.camera }; set(fitTo(here, 1)); fly(back) }
    else if (api.camera) set(api.camera)
    else set(fitTo({ x: 0, y: 0, w: world.w, h: world.h }, 0.92))
    if (here) setSel(here.key)
  }, [size, world]) // eslint-disable-line react-hooks/exhaustive-deps

  // Pan by drag (one pointer) and pinch (two); wheel pans, ⌘/Ctrl+wheel zooms; Safari's gestures zoom.
  useEffect(() => {
    const el = view.current!, pts = new Map<number, { x: number; y: number }>()
    let last: { x: number; y: number; d: number } | null = null, moved = 0
    const mid = () => { const p = [...pts.values()]; const x = p.reduce((a, q) => a + q.x, 0) / p.length, y = p.reduce((a, q) => a + q.y, 0) / p.length; return { x, y, d: p.length > 1 ? Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) : 0 } }
    const down = (e: PointerEvent) => { if (e.button > 1 || (e.target as HTMLElement).closest?.('[data-map-handle], [data-map-note], [data-map-tools], [data-map-slot]')) return; pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); last = mid(); moved = 0; dragged.current = 0 }
    const move = (e: PointerEvent) => {
      if (!pts.has(e.pointerId)) return
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY })
      const now = mid(), r = el.getBoundingClientRect()
      if (!last) return
      moved += Math.abs(now.x - last.x) + Math.abs(now.y - last.y)
      if (moved > 4) el.setPointerCapture?.(e.pointerId)
      if (now.d && last.d) zoomAt(now.d / last.d, now.x - r.left, now.y - r.top)
      grab()
      set({ ...cam.current, x: cam.current.x + now.x - last.x, y: cam.current.y + now.y - last.y })
      dragged.current = moved
      last = now
    }
    const up = (e: PointerEvent) => { pts.delete(e.pointerId); last = pts.size ? mid() : null }
    const wheel = (e: WheelEvent) => {
      // Over the design in Focus a wheel scrolls it; only ⌘/Ctrl+wheel moves the camera.
      if (!e.ctrlKey && !e.metaKey && (e.target as HTMLElement).closest?.('[data-map-slot]')) return
      e.preventDefault()
      const r = el.getBoundingClientRect()
      if (e.ctrlKey || e.metaKey) zoomAt(Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top)
      else { grab(); set({ ...cam.current, x: cam.current.x - e.deltaX, y: cam.current.y - e.deltaY }) }
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
      if (at && at !== document.body && (at.closest('input, textarea, select, [contenteditable], button, a, [role], [data-map-slot]') || !at.closest('[data-map]'))) return
      const a = clear(), c = { x: a.x + a.w / 2, y: a.y + a.h / 2 }
      if (e.key === '+' || e.key === '=') zoomAt(1.25, c.x, c.y)
      else if (e.key === '-') zoomAt(0.8, c.x, c.y)
      else if (e.key === '0') { if (focusBoard) fly(fitTo(focusBoard, 1)); else fitAll() }
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
  const spreadOut = (slug: string) => turnRound(slug, true)
  // A round folding or spreading moves what is in view: from where it was to where it is (a new card
  // from the stack; a card folding away as a ghost into it). At most MAX_ANIM of them, the nearest the
  // middle, so a round of hundreds of options moves a few and the rest are just there.
  const moving = useRef<{ slug: string; was: Map<string, Board>; stack: { x: number; y: number } | null } | null>(null)
  const [ghosts, setGhosts] = useState<{ b: Board; to: { x: number; y: number } }[]>([])
  const turnRound = (slug: string, open: boolean) => {
    const lab = world.labels.find(l => l.key === `round:${slug}`)
    moving.current = { slug, was: new Map(world.boards.map(b => [b.key, b])), stack: lab ? { x: lab.x, y: lab.y } : null }
    setSel(k => k?.startsWith(`opt:${slug}/`) ? null : k)
    setSpread(s => { const n = new Set(s); if (open) n.add(slug); else n.delete(slug); return n })
  }
  useLayoutEffect(() => {
    const m = moving.current
    if (!m) return
    moving.current = null
    if (matchMedia('(prefers-reduced-motion: reduce)').matches || !layer.current) return
    const c = cam.current, sz = sizeRef.current
    const x0 = -c.x / c.z, y0 = -c.y / c.z, x1 = (sz.w - c.x) / c.z, y1 = (sz.h - c.y) / c.z, mx = (x0 + x1) / 2, my = (y0 + y1) / 2
    type R = { x: number; y: number; w: number; h: number }
    const seen = (r: R) => r.x + r.w > x0 && r.x < x1 && r.y + r.h > y0 && r.y < y1
    const near = (r: R) => Math.hypot(r.x + r.w / 2 - mx, r.y + r.h / 2 - my)
    const gone = [...m.was.values()].filter(o => o.slug === m.slug && !world.boards.some(b => b.key === o.key) && seen(o)).sort((a, b) => near(a) - near(b)).slice(0, m.stack ? MAX_ANIM / 2 : 0)
    const moves = world.boards.flatMap(b => {
      const o = m.was.get(b.key) ?? (b.slug === m.slug && m.stack ? { ...b, x: m.stack.x, y: m.stack.y } : null)
      return o && (o.x !== b.x || o.y !== b.y) && (seen(b) || seen(o)) ? [{ b, o, fresh: !m.was.has(b.key) }] : []
    }).sort((p, q) => near(p.b) - near(q.b)).slice(0, MAX_ANIM - gone.length)
    for (const { b, o, fresh } of moves) {
      const el = layer.current.querySelector<HTMLElement>(`[data-map-board="${CSS.escape(b.key)}"]`)
      el?.animate([{ transform: `translate(${o.x - b.x}px, ${o.y - b.y}px)`, opacity: fresh ? 0.5 : 1 }, { transform: 'translate(0, 0)', opacity: 1 }], { duration: ANIM_MS, easing: 'cubic-bezier(.2, .8, .2, 1)' })
    }
    if (gone.length && m.stack) {
      const to = m.stack
      setGhosts(gone.map(b => ({ b, to })))
      setTimeout(() => setGhosts([]), ANIM_MS + 60)
    }
  }, [world]) // eslint-disable-line react-hooks/exhaustive-deps
  // A click on the selected board and a double click both open it: the second one of a pair is let go.
  const opening = useRef(0)
  const openBoard = (b: Board) => { if (Date.now() - opening.current < 600) return; opening.current = Date.now(); api.open(b.route) }
  const c = cam.current
  // What is on screen, in world pixels, with a screen's margin around it.
  const vis = { x0: -c.x / c.z - size.w / c.z, y0: -c.y / c.z - size.h / c.z, x1: (size.w * 2 - c.x) / c.z, y1: (size.h * 2 - c.y) / c.z }
  const near = world.boards.filter(b => b.x + b.w > vis.x0 && b.x < vis.x1 && b.y + b.h > vis.y0 && b.y < vis.y1 && b.w * c.z > 40)
    .sort((a, b) => Math.hypot(a.x + a.w / 2 + c.x / c.z - size.w / 2 / c.z, a.y + a.h / 2 + c.y / c.z - size.h / 2 / c.z) - Math.hypot(b.x + b.w / 2 + c.x / c.z - size.w / 2 / c.z, b.y + b.h / 2 + c.y / c.z - size.h / 2 / c.z))
  // The boards whose stills are wanted: those on screen, nearest the middle first.
  const live = new Set(near.map(b => b.key)), rankOf = new Map(near.map((b, i) => [b.key, i]))
  const stampOf = useMemo(() => new Map((input.stamps ?? '').split(' ').filter(Boolean).map(x => { const i = x.lastIndexOf(':'); return [x.slice(0, i), Number(x.slice(i + 1))] as [string, number] })), [input.stamps])
  const variantOf = (b: Board) => input.protos.find(p => p.id === b.slug)?.variants.find(v => v.id === b.letter)
  const selBoard = world.boards.find(b => b.key === sel)
  const focusBoard = input.focus ? world.boards.find(b => b.kind === 'screen' && b.route === input.focus) ?? world.boards.find(b => b.route === input.focus) : undefined
  // An option of a folded stack opened (from the tree, say): the stack spreads, so it opens on its own card.
  const foldedFocus = !!input.focus && (!focusBoard || focusBoard.pile != null) && world.labels.some(l => l.key === `round:${input.focus.split('/')[0]}`) ? input.focus.split('/')[0] : null
  useEffect(() => { if (foldedFocus && !spread.has(foldedFocus)) spreadOut(foldedFocus) }, [foldedFocus]) // eslint-disable-line react-hooks/exhaustive-deps
  focusRef.current = focusBoard ?? null
  // The board being read: the one nearest the middle, once it fills most of the stage and the camera
  // rests. It is the live page, sharp at any zoom; every other board stays a still. Never the one in
  // Focus (that one is the shell's own) and never a folded stack.
  const room = clear()
  const lensBoard = !focusBoard && resting && !input.hidden && near[0] && near[0].pile == null && (near[0].w * c.z >= room.w * 0.5 || near[0].h * c.z >= room.h * 0.5) ? near[0] : undefined
  refScale.current = (focusBoard ?? near[0])?.scale ?? 1
  const pct = Math.round(c.z * refScale.current * 100)
  const hosted = !!api.report
  useEffect(() => { api.report?.({ pct, build, one: !!one && !ro }) }, [pct, build, !!one, ro]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    // A step of the pill's + or - glides (a short flight), and past the design in Focus it is the map again.
    api.ctl = { zoom: f => {
      const a = clear(), px = a.x + a.w / 2, py = a.y + a.h / 2, c = flightTo.current ?? cam.current, z = clamp(c.z * f, MIN_Z, MAX_SIZE / refScale.current)
      const to = { z, x: px - (px - c.x) * (z / c.z), y: py - (py - c.y) * (z / c.z) }
      fly(to, 220, () => { flightTo.current = null; if (f < 1) leaveIfOut() })
      flightTo.current = to
    }, fit: () => { const fb = focusRef.current; if (fb) fly(fitTo(fb, 1)); else fitAll() }, build: () => { setNote(null); setBuild(b => !b) } }
  })
  // Focus moves the camera: onto the board it takes, and back to where the map was when it ends.
  useEffect(() => {
    // Hidden (a device size or a tool has the stage) the map has no size to fly in: it waits as it is.
    if (!placed.current || input.hidden || size.w < 2) return
    const now = input.focus ?? ''
    if (now === was.current) return
    if (!was.current) before.current = { ...cam.current }
    was.current = now
    if (focusBoard) fly(fitTo(focusBoard, 1))
    else if (before.current) { fly(before.current); before.current = null }
  }, [input.focus, focusBoard?.key, input.hidden, size.w < 2]) // eslint-disable-line react-hooks/exhaustive-deps
  // A design's or flow's area: its name down to the next name at its level or above, with the boards in it.
  const areaOf = (key: string) => {
    const ls = [...world.labels].sort((a, b) => a.y - b.y), at = ls.find(l => l.key === key)
    if (!at) return null
    const level = (l: { kind: string }) => l.kind === 'flow' ? 1 : l.kind === 'round' ? 2 : 0
    const next = ls.find(l => l.y > at.y && level(l) <= level(at)), end = next ? next.y : Infinity
    const inside = world.boards.filter(b => b.y >= at.y && b.y < end)
    if (!inside.length) return null
    const top = at.y - (at.kind === 'flow' ? 70 : 150), right = Math.max(...inside.map(b => b.x + b.w)), bottom = Math.max(...inside.map(b => b.y + b.h)) + 80
    return { x: Math.min(at.x, ...inside.map(b => b.x)), y: top, w: right - Math.min(at.x, ...inside.map(b => b.x)), h: bottom - top }
  }
  // The tree asked for an area: the camera fits it (and Focus, if it was on, doesn't fly back).
  useEffect(() => {
    if (!placed.current || !input.frame || input.hidden || size.w < 2) return
    const a = areaOf(input.frame.split('#')[0])
    if (!a) return
    before.current = null
    fly(fitTo(a, 0.92))
  }, [input.frame, input.hidden, size.w < 2]) // eslint-disable-line react-hooks/exhaustive-deps
  // The stage resized (the window, the sidebar, the map shown again) with a design in Focus: it fits again.
  useEffect(() => {
    if (placed.current && !input.hidden && size.w >= 2 && focusBoard && was.current === input.focus) set(fitTo(focusBoard, 1))
  }, [size.w, size.h, input.safe]) // eslint-disable-line react-hooks/exhaustive-deps
  const slot = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    api.slot?.(slot.current)
    return () => api.slot?.(null)
  }, [focusBoard?.key, api])
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
                ? <button type="button" data-map-round={l.slug} onClick={() => turnRound(l.slug!, !l.open)}
                    title={l.state === 'done' ? (l.open ? t('Fold into a stack') : t('Spread out')) : undefined}
                    className="group flex max-w-full items-center gap-[calc(6px*var(--iz))] rounded-full text-zinc-600 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-white">
                    <span className={'shrink-0 rounded-full ' + (l.state === 'done' ? 'bg-emerald-500' : 'bg-amber-500')} style={{ width: 'calc(8px*var(--iz))', height: 'calc(8px*var(--iz))' }} />
                    <span dir="auto" className="truncate font-medium">{l.own ? t('Options') : l.text}</span><span className="shrink-0 text-zinc-400">· {l.count}</span>
                    {l.state === 'done' && (
                      // What a click does, coming in on hover: fold the spread options into a stack, or spread the stack.
                      <span data-map-round-icon={l.open ? 'fold' : 'spread'} className="grid max-w-0 shrink-0 overflow-hidden opacity-0 transition-all duration-200 ease-out group-hover:max-w-[1.3em] group-hover:opacity-100 group-focus-visible:max-w-[1.3em] group-focus-visible:opacity-100 motion-reduce:transition-none">
                        <Ph name={l.open ? 'foldIn' : 'spreadOut'} className="size-[1.1em]" />
                      </span>
                    )}
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
                <div className={'absolute inset-0 grid place-items-center bg-zinc-50 text-zinc-400 dark:bg-zinc-900'} style={{ fontSize: 'calc(13px * var(--lz))' }}><span dir="auto" className={b.pile ? 'invisible' : ''}>{b.title}</span></div>
                <div className="absolute left-0 top-0 origin-top-left" style={{ width: b.w / b.scale, height: b.h / b.scale, zoom: b.scale }}>
                  <Still v={variantOf(b)} route={b.route} w={b.w / b.scale} h={b.h / b.scale} size={b.scale} want={live.has(b.key) && !input.hidden && b !== focusBoard}
                    sharp={c.z * b.scale * (devicePixelRatio || 1) > 0.55}
                    rank={(b.kind === 'screen' ? 0 : 1000) + (rankOf.get(b.key) ?? 999)}
                    stamp={`${stampOf.get(b.slug) ?? 0}:${busy.get(b.route) ?? ''}`} mount={api.mount} />
                  {b === lensBoard && <Live key={`${b.route}|${stampOf.get(b.slug) ?? 0}`} v={variantOf(b)} mount={api.mount} />}
                </div>
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
          {ghosts.map(({ b, to }) => (
            <div key={`ghost:${b.key}`} data-map-ghost aria-hidden className="pointer-events-none absolute overflow-hidden rounded-[calc(10px*var(--iz))] bg-white dark:bg-zinc-900"
              style={{ left: b.x, top: b.y, width: b.w, height: b.h, zIndex: 2 }}
              ref={el => { if (el && !el.dataset.went) { el.dataset.went = '1'; el.animate([{ transform: 'translate(0, 0)', opacity: 1 }, { transform: `translate(${to.x - b.x}px, ${to.y - b.y}px)`, opacity: 0 }], { duration: ANIM_MS, easing: 'cubic-bezier(.2, .8, .2, 1)', fill: 'forwards' }) } }}>
              {latest.get(b.route) && <img src={latest.get(b.route)} alt="" className="h-full w-full object-cover object-top" />}
            </div>
          ))}
          {focusBoard && (
            // The design in Focus, in place on its board: the page puts its view here (MapApi.slot), and the camera carries it.
            <div key={`slot:${focusBoard.key}`} data-map-slot={focusBoard.route} className="absolute overflow-hidden rounded-[calc(10px*var(--iz))] bg-white shadow-[0_2px_24px_rgb(0_0_0/.18)] dark:bg-zinc-950"
              style={{ left: focusBoard.x, top: focusBoard.y, width: focusBoard.w, height: focusBoard.h, zIndex: 5, cursor: 'auto', userSelect: 'text', touchAction: 'auto' }}>
              <div ref={slot} className="relative" style={{ width: focusBoard.w / focusBoard.scale, height: focusBoard.h / focusBoard.scale, zoom: focusBoard.scale }} />
            </div>
          )}
          {world.boards.filter(b => (b.pile ?? 0) === 0 && b.w * c.z > (b.kind === 'screen' ? 60 : 110)).map(b => (
            <div key={`n:${b.key}`} className="pointer-events-none absolute flex items-center gap-[calc(6px*var(--iz))] whitespace-nowrap text-zinc-500" style={{ left: b.x, top: b.y + b.h + 6 / c.z, fontSize: `calc(${b.kind === 'screen' ? 13 : 11}px * var(--lz))`, zIndex: 4 }}>
              {b.kind === 'screen' ? <span dir="auto" className="font-medium text-zinc-700 dark:text-zinc-200">{b.title}</span> : <span className="tabular-nums">#{numberOf(b.letter)}</span>}
              {b.picked && <Ph name="checkFill" className="size-[calc(12px*var(--iz))] text-emerald-500" />}
              {b.standIn && <span className="rounded bg-zinc-900/[.06] px-1 dark:bg-white/10">{t('not picked')}</span>}
            </div>
          ))}
          {selBoard?.kind === 'screen' && selBoard !== focusBoard && !drag && !ro && (
            // Drag from here to another screen: a link, sent to the agent to put on the right element.
            <span data-map-handle role="button" aria-label={t('Drag to another screen to link them')} title={t('Drag to another screen to link them')} onPointerDown={e => startLink(e, selBoard)}
              className="absolute grid cursor-crosshair touch-none place-items-center rounded-full bg-violet-500 shadow ring-white dark:ring-zinc-900"
              style={{ left: selBoard.x + selBoard.w, top: selBoard.y + selBoard.h / 2, width: 'calc(16px * var(--iz))', height: 'calc(16px * var(--iz))', transform: 'translate(-50%, -50%)', boxShadow: '0 0 0 calc(3px * var(--iz)) white', zIndex: 6 }} />
          )}
        </div>
      </div>
      {/* The map's own controls stay in its clear part, off the page's cards. */}
      <div className="pointer-events-none absolute [&>*]:pointer-events-auto" style={{ left: safe.l, top: safe.t, right: safe.r, bottom: safe.b }}>
        {!hosted && <div data-map-tools className="absolute bottom-3 end-3 flex items-center gap-1 rounded-xl bg-white/90 p-1 text-[12px] shadow ring-1 ring-black/[.06] backdrop-blur dark:bg-zinc-900/90 dark:ring-white/10">
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
          <button type="button" data-map-zoom="out" aria-label={t('Zoom out')} title={t('Zoom out') + ' (-)'} onClick={() => { const a = clear(); zoomAt(0.8, a.x + a.w / 2, a.y + a.h / 2) }} className="grid size-7 place-items-center rounded-lg text-zinc-600 hover:bg-zinc-900/5 dark:text-zinc-300 dark:hover:bg-white/10"><Ph name="minus" className="size-3.5" /></button>
          <button type="button" data-map-zoom="in" aria-label={t('Zoom in')} title={t('Zoom in') + ' (+)'} onClick={() => { const a = clear(); zoomAt(1.25, a.x + a.w / 2, a.y + a.h / 2) }} className="grid size-7 place-items-center rounded-lg text-zinc-600 hover:bg-zinc-900/5 dark:text-zinc-300 dark:hover:bg-white/10"><Ph name="plus" className="size-3.5" /></button>
          <button type="button" data-map-fit onClick={fitAll} title={t('Fit (0)')} className="h-7 rounded-lg px-2 text-zinc-600 hover:bg-zinc-900/5 dark:text-zinc-300 dark:hover:bg-white/10">{t('Fit')}</button>
          <span className="w-10 text-center tabular-nums text-zinc-400">{Math.round(c.z * 100)}%</span>
        </div>}
        {build && one && !note && <BuildBox design={one} boards={world.boards} api={api} onClose={() => setBuild(false)} />}
        {note && <NoteBox key={`${note.kind}:${note.a.key}:${'b' in note ? note.b.key : note.flow}`} note={note} api={api} onClose={() => setNote(null)} />}
        {selBoard && selBoard !== focusBoard && !note && !build && (
          <div className="absolute inset-x-0 bottom-3 mx-auto flex w-fit max-w-[calc(100%-2rem)] items-center gap-2 rounded-xl max-sm:bottom-14 bg-zinc-900 px-3 py-1.5 text-[12px] text-white shadow-lg dark:bg-white dark:text-zinc-900">
            <span dir="auto" className="font-medium">{selBoard.title}</span>{selBoard.kind === 'option' && <span className="opacity-60">#{numberOf(selBoard.letter)}</span>}
            <button type="button" data-map-open onClick={() => openBoard(selBoard)} className="rounded-md bg-white/15 px-2 py-0.5 dark:bg-zinc-900/10">{t('Open')}</button>
          </div>
        )}
      </div>
    </div>
  )
}

/** A box of the map's grows out of the comments island (which steps aside meanwhile), as if the island became it. */
function useFromIsland(api: MapApi) {
  const box = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = box.current, from = document.querySelector('[data-island-host] [data-island]')?.getBoundingClientRect()
    api.panel?.(true)
    if (el && from && from.width && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const to = el.getBoundingClientRect()
      el.animate([
        { transform: `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width}, ${from.height / to.height})`, borderRadius: '999px', opacity: 0.5 },
        { transform: 'none', borderRadius: '16px', opacity: 1 },
      ], { duration: 280, easing: 'cubic-bezier(.2, .9, .25, 1)' })
    }
    return () => api.panel?.(false)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return box
}

/** Words to the agent about a link, a flow, or a link to add: what it is about, a field, Send. */
function NoteBox({ note, api, onClose }: { note: Note; api: MapApi; onClose: () => void }) {
  const [text, setText] = useState(''), [state, setState] = useState<'' | 'sending' | 'sent' | 'failed'>('')
  const field = useRef<HTMLTextAreaElement>(null), box = useFromIsland(api)
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
    <div ref={box} data-map-note={note.kind} style={{ transformOrigin: 'top left' }} className="absolute inset-x-0 bottom-3 mx-auto max-sm:bottom-14 w-[min(26rem,calc(100%-2rem))] rounded-2xl bg-white p-3 text-[13px] shadow-[0_18px_44px_-14px_rgb(0_0_0/.35)] ring-1 ring-black/[.06] dark:bg-zinc-900 dark:text-zinc-100 dark:ring-white/10">
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
  const chosen = screens.filter(b => on.has(b.key)), box = useFromIsland(api)
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
    <div ref={box} data-map-build-box data-map-note="build" style={{ transformOrigin: 'top left' }} className="absolute inset-x-0 bottom-3 mx-auto max-sm:bottom-14 w-[min(24rem,calc(100%-2rem))] rounded-2xl bg-white p-3 text-[13px] shadow-[0_18px_44px_-14px_rgb(0_0_0/.35)] ring-1 ring-black/[.06] dark:bg-zinc-900 dark:text-zinc-100 dark:ring-white/10">
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
