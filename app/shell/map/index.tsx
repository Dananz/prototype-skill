// The map: every design's screens, the explorations under them and the links between them, on one
// infinite desk (spec decision 11). Drag or scroll moves it; pinch, ⌘/Ctrl+scroll, + and - zoom
// about the pointer; 0 fits. The camera is a translate on the outer layer and CSS zoom on the world
// (never a scale transform), so Safari keeps one real layout per design; labels stay one size at
// any zoom through --iz (1 / zoom). A double click on a screen flies into it and opens it (Focus);
// the shell flies back out here when Focus is left.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'
import type { Design, Proto, Variant } from '../shell'
import { t } from '../i18n'
import { numberOf } from '../variants'
import { linksIn } from '../../links.mjs'
import { GAP, linePath, worldOf, type Board, type World } from './world'
import { Ph } from '../tree/row'

export type MapInput = { protos: Proto[]; designs: Design[]; place: string; hidden: boolean; lines: 'all' | 'selected'; design: string }
export type MapApi = {
  get(): MapInput; subscribe(fn: () => void): () => void
  /** Opens a route in Focus. */
  open(route: string): void
  mount(el: HTMLElement, component: unknown): () => void
  /** The camera's last place, kept across Focus so leaving it flies back to where the map was. */
  camera: { x: number; y: number; z: number } | null
  setLines(mode: 'all' | 'selected'): void
}
type Cam = { x: number; y: number; z: number }
const MIN_Z = 0.02, MAX_Z = 2, MAX_LIVE = 12
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))
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
function useLinks(boards: Board[], protos: Proto[]) {
  const [links, setLinks] = useState<Record<string, string[]>>({})
  const files = useMemo(() => boards.filter(b => b.kind === 'screen').map(b => ({ route: b.route, file: protos.find(p => p.id === b.slug)?.variants.find(v => v.id === b.letter)?.file })), [boards, protos])
  useEffect(() => {
    let gone = false
    void Promise.all(files.map(async ({ route, file }) => {
      if (!file) return [route, []] as const
      try { const m = await import(/* @vite-ignore */ `${file}?raw`); return [route, linksIn(String(m.default))] as const } catch { return [route, []] as const }
    })).then(all => { if (!gone) setLinks(Object.fromEntries(all)) })
    return () => { gone = true }
  }, [files])
  return links
}

function MapView({ api }: { api: MapApi }) {
  const input = useSyncExternalStore(api.subscribe, api.get)
  const [spread, setSpread] = useState<Set<string>>(() => new Set())
  const [sel, setSel] = useState<string | null>(null)
  const designs = input.design ? input.designs.filter(d => d.id === input.design) : input.designs
  const world: World = useMemo(() => worldOf(input.protos, designs, spread), [input.protos, designs, spread])
  const links = useLinks(world.boards, input.protos)
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
    const down = (e: PointerEvent) => { if (e.button > 1) return; pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); last = mid(); moved = 0; dragged.current = 0 }
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
      if ((e.target as HTMLElement)?.closest?.('input, textarea, [contenteditable]')) return
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

  const openBoard = (b: Board) => fly(fitTo(b, 1), 380, () => api.open(b.route))
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
      <div ref={layer} className="absolute left-0 top-0 origin-top-left" style={{ ['--iz' as string]: String(1 / c.z) }}>
        <div className="relative" style={{ width: world.w, height: world.h }}>
          <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width={world.w} height={world.h}>
            {lines.map(({ a, b, to }) => <path key={`${a.key}>${to}`} data-map-line={`${a.slug}>${to}`} d={linePath(a, b!)} fill="none" className="stroke-sky-500/70" style={{ strokeWidth: 'calc(2px * var(--iz))' }} />)}
          </svg>
          {world.labels.map(l => (
            // Above its anchor, one size on screen: a design's name over its first flow's, a flow's over its row.
            // Rounds name themselves once their cards are big enough to tell apart; a long name truncates at its round's width.
            (l.kind !== 'round' || (world.boards.find(b => b.slug === l.slug)?.w ?? 0) * c.z > 60) &&
            <div key={l.key} data-map-label={l.key} className="absolute whitespace-nowrap" style={{ left: l.x, top: l.y, ...(l.w ? { maxWidth: l.w + GAP * 0.8 } : {}), fontSize: `calc(${l.kind === 'design' ? 22 : l.kind === 'flow' ? 15 : 13}px * var(--iz))`,
              transform: `translateY(calc(-100% - ${l.kind === 'design' || l.kind === 'section' ? 34 : 8}px * var(--iz)))` }}>
              {l.kind === 'round'
                ? <button type="button" data-map-round={l.slug} onClick={() => setSpread(s => { const n = new Set(s); if (n.has(l.slug!)) n.delete(l.slug!); else n.add(l.slug!); return n })}
                    className="flex max-w-full items-center gap-[calc(6px*var(--iz))] rounded-full text-zinc-600 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-white">
                    <span className={'shrink-0 rounded-full ' + (l.state === 'done' ? 'bg-emerald-500' : 'bg-amber-500')} style={{ width: 'calc(8px*var(--iz))', height: 'calc(8px*var(--iz))' }} />
                    <span dir="auto" className="truncate font-medium">{l.own ? t('Options') : l.text}</span><span className="shrink-0 text-zinc-400">· {l.count}</span>
                  </button>
                : <span dir="auto" className={l.kind === 'design' ? 'font-semibold text-indigo-600 dark:text-indigo-300' : l.kind === 'flow' ? 'font-medium text-zinc-700 dark:text-zinc-200' : 'text-zinc-400'}>
                    {l.kind === 'section' ? t('Explorations on no screen') : l.text}{l.count != null && l.kind === 'flow' ? <span className="text-zinc-400"> · {l.count}</span> : null}
                  </span>}
            </div>
          ))}
          {world.boards.map(b => {
            const on = b.key === sel, here = b.route === input.place
            return (
              <div key={b.key} data-map-board={b.key} onClick={e => { e.stopPropagation(); if (dragged.current < 6) setSel(b.key) }} onDoubleClick={() => openBoard(b)}
                className={'absolute overflow-hidden rounded-[calc(10px*var(--iz))] bg-white shadow-[0_1px_3px_rgb(0_0_0/.08)] dark:bg-zinc-900'}
                style={{ left: b.x, top: b.y, width: b.w, height: b.h, zIndex: b.pile != null ? 3 - b.pile : undefined, cursor: 'pointer',
                  outline: on || here ? `calc(2px * var(--iz)) solid ${on ? '#0ea5e9' : '#10b981'}` : `calc(1px * var(--iz)) solid rgb(0 0 0 / .08)` }}>
                <div className="absolute left-0 top-0 origin-top-left" style={{ width: b.w / b.scale, height: b.h / b.scale, zoom: b.scale }}>
                  <Preview v={variantOf(b)} live={live.has(b.key) && !input.hidden} mount={api.mount} />
                </div>
                {!live.has(b.key) && <div className={'absolute inset-0 grid place-items-center bg-zinc-50 text-zinc-400 dark:bg-zinc-900'} style={{ fontSize: 'calc(13px * var(--iz))' }}><span dir="auto" className={b.pile ? 'invisible' : ''}>{b.title}</span></div>}
              </div>
            )
          })}
          {world.boards.filter(b => (b.pile ?? 0) === 0 && b.w * c.z > (b.kind === 'screen' ? 60 : 110)).map(b => (
            <div key={`n:${b.key}`} className="pointer-events-none absolute flex items-center gap-[calc(6px*var(--iz))] whitespace-nowrap text-zinc-500" style={{ left: b.x, top: b.y + b.h + 6 / c.z, fontSize: `calc(${b.kind === 'screen' ? 13 : 11}px * var(--iz))`, zIndex: 4 }}>
              {b.kind === 'screen' ? <span dir="auto" className="font-medium text-zinc-700 dark:text-zinc-200">{b.title}</span> : <span className="tabular-nums">#{numberOf(b.letter)}</span>}
              {b.picked && <Ph name="checkFill" className="size-[calc(12px*var(--iz))] text-emerald-500" />}
              {b.standIn && <span className="rounded bg-zinc-900/[.06] px-1 dark:bg-white/10">{t('not picked')}</span>}
            </div>
          ))}
        </div>
      </div>
      <div className="absolute bottom-3 end-3 flex items-center gap-1 rounded-xl bg-white/90 p-1 text-[12px] shadow ring-1 ring-black/[.06] backdrop-blur dark:bg-zinc-900/90 dark:ring-white/10">
        <button type="button" data-map-lines aria-pressed={input.lines === 'selected'} onClick={() => api.setLines(input.lines === 'all' ? 'selected' : 'all')}
          className="h-7 rounded-lg px-2 text-zinc-600 hover:bg-zinc-900/5 dark:text-zinc-300 dark:hover:bg-white/10">{input.lines === 'all' ? t('All links') : t('Selected only')}</button>
        <button type="button" data-map-fit onClick={fitAll} title={t('Fit (0)')} className="h-7 rounded-lg px-2 text-zinc-600 hover:bg-zinc-900/5 dark:text-zinc-300 dark:hover:bg-white/10">{t('Fit')}</button>
        <span className="w-10 text-center tabular-nums text-zinc-400">{Math.round(c.z * 100)}%</span>
      </div>
      {selBoard && (
        <div className="absolute bottom-3 start-1/2 flex -translate-x-1/2 items-center gap-2 rounded-xl bg-zinc-900 px-3 py-1.5 text-[12px] text-white shadow-lg dark:bg-white dark:text-zinc-900">
          <span dir="auto" className="font-medium">{selBoard.title}</span>{selBoard.kind === 'option' && <span className="opacity-60">#{numberOf(selBoard.letter)}</span>}
          <button type="button" data-map-open onClick={() => openBoard(selBoard)} className="rounded-md bg-white/15 px-2 py-0.5 dark:bg-zinc-900/10">{t('Open')}</button>
        </div>
      )}
    </div>
  )
}

export function mountMap(host: HTMLElement, api: MapApi) {
  createRoot(host).render(<MapView api={api} />)
}
