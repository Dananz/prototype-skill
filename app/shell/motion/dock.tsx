// The motion dock: one slim bar under the design on the stage. Play, a quiet time, the slider (a
// thin track, the playhead, a dot per comment on a moment and a short segment per comment on a
// range), then a moment or a range, the curves, ⋯ (speed, loop, Go to, replay) and Comment. The
// curves, an open comment and the composer open inside the dock, above the track and in its exact
// column, so a moment is the same x on the track and on every curve; the stage gives up the height.
import { memo, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent as RKE, type PointerEvent as RPE, type ReactElement, type ReactNode } from 'react'
import { Menu } from '@base-ui/react/menu'
import { Tooltip } from '@base-ui/react/tooltip'
import { useCtx } from '../comments/ctx'
import { Composer } from '../comments/composer'
import { useRows } from '../comments/list'
import type { Item, Time } from '../comments/types'
import { Body, Icon, PinDot, PRIMARY, Reply, STATE, spanOf } from '../comments/ui'
import type { Player, PlayState } from './player'
import type { Track as Curve } from './curves'

const EASE = 'ease-[cubic-bezier(0.32,0.72,0,1)]'
const SPAN = 300 // a new range's length, ms
const GAP = 40 // the shortest range, ms
const fmt = (ms: number) => `${(ms / 1000).toFixed(2)} s`
const fmtSpan = (a: number, b?: number) => spanOf({ at: Math.min(a, b ?? a), to: b === undefined ? undefined : Math.max(a, b) })

/* Icons the page's set lacks, in its stroke (24 grid, 1.75, round). */
const PATHS = {
  play: 'M8 5.8v12.4a.8.8 0 0 0 1.2.7l9.9-6.2a.8.8 0 0 0 0-1.4L9.2 5.1a.8.8 0 0 0-1.2.7z',
  pause: 'M7 5.5a1 1 0 0 1 1-1h1.5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1zM13.5 5.5a1 1 0 0 1 1-1H16a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-1.5a1 1 0 0 1-1-1z',
  moment: 'M12 9.5V20M9 4h6l-3 4z',
  range: 'M5 5v14M19 5v14M8.5 12h7',
  curves: 'M3 19.5c3.6 0 4.6-14 9.2-14 2.6 0 3 3 5.6 3H21',
  loop: 'M17 3.5l3 3-3 3M4 11.5v-1a4 4 0 0 1 4-4h12M7 20.5l-3-3 3-3M20 12.5v1a4 4 0 0 1-4 4H4',
  speed: 'M5.6 18.4a9 9 0 1 1 12.8 0M12 13.5l3.5-4',
  goto: 'M4 12h10.5M10.5 7.5 15 12l-4.5 4.5M20 5v14',
  replay: 'M4 12a8 8 0 1 0 2.5-5.8M4 4v4h4',
}
type GlyphName = keyof typeof PATHS | 'more'
function Glyph({ name, className = 'size-4' }: { name: GlyphName; className?: string }) {
  if (name === 'more') return <svg className={`${className} shrink-0`} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5.5" cy="12" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="18.5" cy="12" r="1.7" /></svg>
  const solid = name === 'play' || name === 'pause'
  return <svg className={`${className} shrink-0`} viewBox="0 0 24 24" fill={solid ? 'currentColor' : 'none'} stroke={solid ? 'none' : 'currentColor'} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={PATHS[name]} /></svg>
}

/** An element's size, kept current. */
function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const set = () => setSize(s => (s.w === el.clientWidth && s.h === el.clientHeight ? s : { w: el.clientWidth, h: el.clientHeight }))
    set()
    const ro = new ResizeObserver(set)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, size] as const
}

/* ---------- the dock's state: the player's, plus what is chosen here ---------- */
function useDock(player: Player) {
  const p: PlayState = useSyncExternalStore(player.subscribe, player.get)
  const { store, act } = useCtx()
  const { s, rows } = useRows()
  const D = Math.max(1, p.duration)
  const clamp = (t: number) => Math.min(D, Math.max(0, t))
  const snap = (t: number) => clamp(Math.round(t / 10) * 10)
  const around = (t: number): [number, number] => { const len = Math.min(SPAN, D); const a = Math.max(0, Math.min(D - len, snap(t) - len / 2)); return [a, a + len] }
  const [mode, setModeState] = useState<'at' | 'range'>('at')
  const [sel, setSelState] = useState<[number, number] | null>(null)
  const selRef = useRef(sel)
  const setSel = (r: [number, number] | null) => { selRef.current = r; setSelState(r) }
  const [curves, setCurves] = useState(false)
  const [menu, setMenu] = useState(false)
  const [emph, setEmph] = useState<string | null>(null)
  // A drag that starts on a point scrubs instead of opening it.
  const quiet = useRef(-1e9)

  // The comments on the motion of the variant on screen, and the one open in the dock.
  const points = rows.filter(r => r.here && r.item.time)
  const open = points.find(r => r.item.id === s.active && (r.item.sent || s.mode.kind !== 'time')) ?? null
  const composing = s.mode.kind === 'time' ? s.mode : null
  // Opening a comment (its point, or its row in the list) goes to its moment, or loops its range.
  const shown = useRef<string | null>(null)
  useEffect(() => {
    const id = open?.item.id ?? (composing?.id ? composing.id : null)
    if (id === shown.current) return
    shown.current = id
    const it = points.find(r => r.item.id === id)?.item
    if (!it?.time || p.status === 'taking') return
    if (it.time.to !== undefined) void player.loopSpan(it.time.at, it.time.to)
    else void player.seek(it.time.at)
  })

  const setMode = (m: 'at' | 'range') => {
    if (m === mode) return
    if (m === 'range') { const r = around(p.t); setSel(r); void player.seek(Math.min(r[1], Math.max(r[0], p.t))) }
    else { setSel(null); if (p.span) player.pause() }
    setModeState(m)
  }
  const draw = (anchor: number, t: number) => {
    let a = Math.min(anchor, t), b = Math.max(anchor, t)
    if (b - a < GAP) { if (t >= anchor) b = Math.min(D, a + GAP); else a = Math.max(0, b - GAP) }
    setSel([a, b]); void player.seek(t)
  }
  /** Moves one end of the range; dragged past the other end, it becomes that end. Returns the end now held. */
  const moveEdge = (i: 0 | 1, t: number): 0 | 1 => {
    const r = selRef.current
    if (!r) return i
    const other = r[i ? 0 : 1]
    let next: [number, number], held: 0 | 1
    if (i ? t >= other : t <= other) { held = i; next = i ? [other, clamp(Math.max(other + GAP, t))] : [Math.max(0, Math.min(t, other - GAP)), other] }
    else { held = i ? 0 : 1; next = i ? [Math.max(0, Math.min(t, other - GAP)), other] : [other, clamp(Math.max(other + GAP, t))] }
    setSel(next); void player.seek(next[held])
    return held
  }
  const close = () => { if (open || composing) act.close(); if (p.span) player.pause() }
  const toggle = () => {
    if (p.playing) return player.pause()
    if (p.span) return void player.play()
    const r = selRef.current
    if (mode === 'range' && r) return void player.loopSpan(r[0], r[1], false)
    void player.play()
  }
  const time = (): Time => { const r = selRef.current; return mode === 'range' && r ? { at: Math.round(r[0]), to: Math.round(r[1]), take: Math.round(D) } : { at: Math.round(snap(p.t)), take: Math.round(D) } }
  const compose = () => {
    setMenu(false)
    if (composing) return act.close()
    if (p.playing) player.pause()
    act.beginTime(time())
  }
  const openPoint = (id: string) => {
    if (performance.now() - quiet.current < 250) return
    if (open?.item.id === id) return close()
    act.open(id)
  }
  const goTo = (t: number) => { if (open) act.close(); void player.seek(t); if (mode === 'range') setSel(around(t)) }
  const replay = () => { if (open) act.close(); void (async () => { await player.seek(0); await player.play() })() }
  return {
    p, D, points, open, composing, store, mode, sel, curves, menu, emph, quiet,
    seek: (t: number) => void player.seek(snap(t)), snap, toggle, setMode, draw, moveEdge, compose, openPoint, close,
    setCurves, setMenu, setEmph, goTo, replay, player,
    setSpeed: player.setSpeed, setLoop: player.setLoop,
  }
}
type Ctl = ReturnType<typeof useDock>

/** A tooltip for a pointer that hovers (Base UI turns tooltips off for touch). Menus and tooltips
 *  go to the end of the page, above the side panel a submenu may open over. */
function Tip({ label, kbd, side = 'top', children }: { label: ReactNode; kbd?: string; side?: 'top' | 'bottom'; children: ReactElement }) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger render={children} />
      <Tooltip.Portal>
        <Tooltip.Positioner side={side} sideOffset={8} collisionPadding={8} className="z-[60]">
          <Tooltip.Popup className="flex max-w-[260px] origin-[var(--transform-origin)] items-center gap-1.5 rounded-md bg-zinc-900 px-2 py-1 text-[11px] font-medium text-white shadow-lg transition-[opacity,scale] duration-150 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0 dark:bg-zinc-700">
            <span className="min-w-0 truncate">{label}</span>{kbd && <span className="shrink-0 text-white/55">{kbd}</span>}
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}

/** Content that opens and closes by its height, keeping what it showed while it closes. */
function Reveal({ open, className = '', children }: { open: boolean; className?: string; children: ReactNode }) {
  const last = useRef<ReactNode>(children)
  if (open) last.current = children
  return (
    <div inert={!open} className={`grid transition-[grid-template-rows,opacity] duration-[420ms] ${EASE} ${open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'} ${className}`}>
      <div className="min-h-0 overflow-hidden">{last.current}</div>
    </div>
  )
}

/* ---------- The time axis: one inset and one x for a time, for the track and the curves alike. ---------- */
const INSET = 12
const BAND = 44 // the track's own height; its line runs through the middle
const xAt = (t: number, w: number, D: number) => INSET + (t / D) * Math.max(1, w - INSET * 2)
const tAtX = (x: number, w: number, D: number) => Math.min(D, Math.max(0, ((x - INSET) / Math.max(1, w - INSET * 2)) * D))

/** Pointer handling for anything on the time axis: press to seek and drag to scrub; in range mode,
 *  drag to draw a range or move its ends; a tap on a point opens it. */
function useScrub(ctl: Ctl, ref: React.RefObject<HTMLDivElement | null>) {
  type Drag = { x0: number; anchor: number; touch: boolean; moved: boolean; kind: 'seek' | 'draw' | 'tap' | 'point' | 0 | 1 }
  const drag = useRef<Drag | null>(null)
  const at = (clientX: number) => { const r = ref.current!.getBoundingClientRect(); return ctl.snap(tAtX(clientX - r.left, r.width, ctl.D)) }
  return {
    onPointerDown: (e: RPE<HTMLDivElement>) => {
      if (e.button !== 0 || ctl.p.status !== 'ready') return
      const el = e.target as HTMLElement, touch = e.pointerType !== 'mouse'
      if (el.closest('[data-legend]')) return
      const r = ref.current!.getBoundingClientRect(), x = e.clientX - r.left, t = at(e.clientX)
      const h = el.closest('[data-handle]')?.getAttribute('data-handle')
      let edge: 0 | 1 | null = h ? (Number(h) as 0 | 1) : null
      if (edge === null && ctl.mode === 'range' && ctl.sel) {
        const g = touch ? 16 : 8
        if (Math.abs(x - xAt(ctl.sel[0], r.width, ctl.D)) <= g) edge = 0
        else if (Math.abs(x - xAt(ctl.sel[1], r.width, ctl.D)) <= g) edge = 1
      }
      const point = edge === null && !!el.closest('[data-point]')
      drag.current = { x0: e.clientX, anchor: t, touch, moved: false, kind: edge ?? (point ? 'point' : ctl.mode === 'range' ? 'tap' : 'seek') }
      // A press on a point waits: a tap opens it (its click), a drag scrubs from it.
      if (!point) capture(e)
      if (edge !== null) ctl.moveEdge(edge, t)
      else if (!point && ctl.mode === 'at') ctl.seek(t)
    },
    onPointerMove: (e: RPE<HTMLDivElement>) => {
      const d = drag.current
      if (!d) return
      if (!d.moved) {
        if (Math.abs(e.clientX - d.x0) < (d.touch ? 8 : 3)) return
        d.moved = true
        if (d.kind === 'point') { capture(e); d.kind = ctl.mode === 'range' ? 'draw' : 'seek' }
        else if (d.kind === 'tap') d.kind = 'draw'
      }
      const t = at(e.clientX)
      if (d.kind === 'seek') ctl.seek(t)
      else if (d.kind === 'draw') ctl.draw(d.anchor, t)
      else if (d.kind === 0 || d.kind === 1) d.kind = ctl.moveEdge(d.kind, t)
    },
    onPointerUp: () => {
      const d = drag.current
      drag.current = null
      if (!d) return
      if (d.kind === 'tap') ctl.seek(d.anchor)
      if (d.moved) ctl.quiet.current = performance.now()
    },
    onPointerCancel: () => { drag.current = null },
  }
}
// A synthetic pointer (a replayed state) has nothing to capture; a real one does.
const capture = (e: RPE<HTMLElement>) => { try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* not a live pointer */ } }

const stepKeys = (e: RKE, v: number, D: number, set: (t: number) => void) => {
  const big = e.shiftKey || e.key.startsWith('Page') ? 100 : 10
  const next = e.key === 'ArrowLeft' || e.key === 'ArrowDown' || e.key === 'PageDown' ? v - big
    : e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'PageUp' ? v + big
    : e.key === 'Home' ? 0 : e.key === 'End' ? D : null
  if (next === null) return false
  e.preventDefault(); e.stopPropagation(); set(next)
  return true
}

/** The curves: each part's progress over the take, the line every part rests on, an overshoot
 *  filled where it passes that line, gridlines each half second (or second). Drawn once per size. */
const Plot = memo(function Plot({ tracks, D, w, top, base, ymax, clip, emph }: { tracks: Curve[]; D: number; w: number; top: number; base: number; ymax: number; clip: string; emph: string | null }) {
  const X = (t: number) => xAt(t, w, D), Y = (v: number) => base - (v / ymax) * (base - top)
  const paths = useMemo(() => tracks.map(tr => ({ tr, lines: tr.lines.map(l => {
    const pts = l.pts.map(([t, v]) => `${X(t).toFixed(1)},${Y(v).toFixed(1)}`).join('L'), rest = Y(1).toFixed(1)
    return { d: `M${pts}`, fill: `M${X(l.start).toFixed(1)},${rest}L${pts}L${X(l.end).toFixed(1)},${rest}Z` }
  }) })), [tracks, w, top, base, ymax]) // eslint-disable-line react-hooks/exhaustive-deps
  const y1 = Math.round(Y(1)) + 0.5
  const step = D > 3000 ? 1000 : 500, grid: number[] = []
  for (let t = step; t < D - step / 4; t += step) grid.push(t)
  return (
    <g>
      <defs><clipPath id={clip}><rect x={0} y={top - 20} width={w} height={Math.max(0, y1 - top + 20)} /></clipPath></defs>
      <g className="text-zinc-900/[.06] dark:text-white/[.07]" stroke="currentColor">
        {grid.map(t => <line key={t} x1={Math.round(X(t)) + 0.5} x2={Math.round(X(t)) + 0.5} y1={top - 4} y2={base} />)}
      </g>
      <g className="fill-zinc-400 dark:fill-zinc-500" fontSize={10} style={{ fontVariantNumeric: 'tabular-nums' }}>
        {grid.map((t, i) => <text key={t} x={X(t) + 4} y={top + 6}>{i === grid.length - 1 ? `${(t / 1000).toFixed(1)} s` : (t / 1000).toFixed(1)}</text>)}
      </g>
      <line x1={X(0)} x2={X(D)} y1={y1} y2={y1} strokeDasharray="3 3" className="stroke-zinc-300 dark:stroke-zinc-600" />
      <g clipPath={`url(#${clip})`}>
        {paths.flatMap(({ tr, lines }) => lines.map((l, i) => <path key={`${tr.id}${i}`} d={l.fill} fill={tr.color} fillOpacity={emph && emph !== tr.id ? 0.04 : i ? 0.06 : 0.16} className="transition-[fill-opacity] duration-200" />))}
      </g>
      <g fill="none" strokeLinecap="round" strokeLinejoin="round">
        {[...paths].sort((a, b) => Number(a.tr.id === emph) - Number(b.tr.id === emph)).flatMap(({ tr, lines }) => lines.map((l, i) => (
          <path key={`${tr.id}${i}`} d={l.d} stroke={tr.color} strokeWidth={emph === tr.id ? 2.5 : i ? 1.5 : 2} strokeOpacity={(emph && emph !== tr.id ? 0.22 : 1) * (i ? 0.55 : 1)} className="transition-[stroke-opacity] duration-200" />
        )))}
      </g>
    </g>
  )
})

/** The curves with what moves on them: comment spans behind, the range being made, the playhead
 *  with a dot where it crosses each part that is moving. */
function Curves({ ctl, w, top, base }: { ctl: Ctl; w: number; top: number; base: number }) {
  const clip = useId().replace(/:/g, '')
  const { D } = ctl, tracks = ctl.p.tracks
  const ymax = useMemo(() => Math.max(1.15, ...tracks.flatMap(tr => tr.lines.flatMap(l => l.pts.map(([, v]) => v + 0.05)))), [tracks])
  const X = (t: number) => xAt(t, w, D), Y = (v: number) => base - (v / ymax) * (base - top)
  const hx = Math.round(X(ctl.p.t)) + 0.5
  const near = (pts: [number, number][], t: number) => { let best = pts[0]; for (const q of pts) if (Math.abs(q[0] - t) < Math.abs(best[0] - t)) best = q; return best[1] }
  return (
    <svg width={w} height={base + 2} className="pointer-events-none absolute left-0 top-0 overflow-visible" aria-hidden="true">
      {ctl.points.map(({ item: c }) => c.time!.to !== undefined
        ? <rect key={c.id} x={X(c.time!.at)} y={top - 8} width={Math.max(2, X(c.time!.to) - X(c.time!.at))} height={base - top + 8} rx={4} style={{ fill: 'var(--proto-primary)' }} fillOpacity={ctl.open?.item.id === c.id ? 0.14 : 0.06} />
        : <line key={c.id} x1={Math.round(X(c.time!.at)) + 0.5} x2={Math.round(X(c.time!.at)) + 0.5} y1={top - 8} y2={base} strokeDasharray="2 3" style={{ stroke: 'var(--proto-primary)' }} strokeOpacity={ctl.open?.item.id === c.id ? 0.9 : 0.45} />)}
      {ctl.mode === 'range' && ctl.sel && (
        <g style={{ fill: 'var(--proto-primary)', stroke: 'var(--proto-primary)' }}>
          <rect x={X(ctl.sel[0])} y={top - 8} width={Math.max(1, X(ctl.sel[1]) - X(ctl.sel[0]))} height={base - top + 8} fillOpacity={0.1} stroke="none" />
          <line x1={Math.round(X(ctl.sel[0])) + 0.5} x2={Math.round(X(ctl.sel[0])) + 0.5} y1={top - 8} y2={base} strokeOpacity={0.5} />
          <line x1={Math.round(X(ctl.sel[1])) + 0.5} x2={Math.round(X(ctl.sel[1])) + 0.5} y1={top - 8} y2={base} strokeOpacity={0.5} />
        </g>
      )}
      <Plot tracks={tracks} D={D} w={w} top={top} base={base} ymax={ymax} clip={clip} emph={ctl.emph} />
      <line x1={hx} x2={hx} y1={top - 8} y2={base} strokeWidth={1.25} className="stroke-zinc-900/80 dark:stroke-white/80" />
      {tracks.flatMap(tr => tr.lines.filter(l => ctl.p.t >= l.start && ctl.p.t <= l.end).slice(0, 1).map(l => (
        <circle key={tr.id} cx={hx} cy={Y(near(l.pts, ctl.p.t))} r={3.5} stroke={tr.color} strokeWidth={2} opacity={ctl.emph && ctl.emph !== tr.id ? 0.3 : 1} className="fill-white dark:fill-zinc-950" />
      )))}
    </svg>
  )
}

/** The parts' names in their colors, and what each animates (not on a phone, where room is short);
 *  a name brings its curve out, again puts it back. */
function Legend({ ctl, short = false, className = '' }: { ctl: Ctl; short?: boolean; className?: string }) {
  return (
    <div role="group" aria-label="Curves" data-legend className={`flex flex-wrap items-center gap-x-0.5 ${className}`}>
      {ctl.p.tracks.map(tr => {
        const on = ctl.emph === tr.id, dim = !!ctl.emph && !on
        return (
          <Tip key={tr.id} label={<>{on ? 'Show every curve' : `Bring out ${tr.name}`}<span className="ms-1.5 text-white/55">{tr.props} · {fmtSpan(tr.start, tr.end)}</span></>}>
            <button data-motion={`curve-${tr.id}`} aria-pressed={on} onClick={() => ctl.setEmph(on ? null : tr.id)}
              className={`inline-flex h-7 max-w-full cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-md px-1.5 text-[11px] outline-none transition-colors hover:bg-zinc-900/5 focus-visible:ring-2 focus-visible:ring-proto-primary-ring dark:hover:bg-white/10 [@media(pointer:coarse)]:h-9 ${on ? 'font-medium text-zinc-900 dark:text-white' : dim ? 'text-zinc-400 dark:text-zinc-500' : 'text-zinc-500 dark:text-zinc-400'}`}>
              <span className="h-0.5 w-3 shrink-0 rounded-full transition-opacity" style={{ background: tr.color, opacity: dim ? 0.35 : 1 }} /><span dir="auto" className="truncate">{tr.name}</span>{!short && tr.props.toLowerCase() !== tr.name.toLowerCase() && <span className="truncate text-zinc-400 dark:text-zinc-500">{tr.props}</span>}
            </button>
          </Tip>
        )
      })}
    </div>
  )
}

/**
 * The slider: a thin track with the playhead, a dot per comment on a moment and a short segment
 * per comment on a range, and in range mode the range with two handles. `graph` grows the curves
 * above its line on the same surface; `track={false}` is the curves alone.
 */
function Timeline({ ctl, graph = 0, track = true, className = '' }: { ctl: Ctl; graph?: number; track?: boolean; className?: string }) {
  const [ref, size] = useSize<HTMLDivElement>()
  const scrub = useScrub(ctl, ref)
  const w = size.w, h = size.h || graph + (track ? BAND : 0)
  const base = track ? h - BAND / 2 : h - 8
  const top = 18
  const room = base - top
  const shown = Math.max(0, Math.min(1, (room - 24) / 60))
  return (
    <div ref={ref} {...scrub}
      role={track ? 'slider' : undefined} tabIndex={track ? 0 : -1} aria-hidden={track ? undefined : true} data-motion={track ? 'track' : undefined}
      aria-label="Playhead" aria-valuemin={0} aria-valuemax={Math.round(ctl.D)} aria-valuenow={Math.round(ctl.p.t)} aria-valuetext={fmt(ctl.p.t)}
      onKeyDown={e => { if (e.key === ' ' || e.key === 'k') { e.preventDefault(); ctl.toggle() } else stepKeys(e, ctl.p.t, ctl.D, ctl.seek) }}
      className={`relative touch-none select-none rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-proto-primary-ring/60 ${ctl.mode === 'range' ? 'cursor-crosshair' : 'cursor-ew-resize'} ${className}`}
      style={{ height: graph + (track ? BAND : 0) }}>
      {w > 0 && room > 8 && ctl.p.status === 'ready' && (
        <div className="absolute inset-0" style={{ opacity: shown }}>
          <Curves ctl={ctl} w={w} top={top} base={base} />
        </div>
      )}
      {track && w > 0 && <Track ctl={ctl} w={w} lift={room > 8} />}
    </div>
  )
}

/** Points that would overlap take the next lane up or down, so each stays tappable. */
const LANES = [0, -11, 11, -20]
function lanesOf(list: Item[], X: (t: number) => number) {
  const ends: number[] = [], lane: Record<string, number> = {}
  for (const c of [...list].sort((a, b) => a.time!.at - b.time!.at)) {
    const x0 = X(c.time!.at) - 7, x1 = (c.time!.to !== undefined ? X(c.time!.to) : X(c.time!.at)) + 7
    let i = ends.findIndex(e => e < x0)
    if (i < 0 || i >= LANES.length) { i = Math.min(ends.length, LANES.length - 1); ends[i] = x1 } else ends[i] = x1
    lane[c.id] = i
  }
  return lane
}

function Track({ ctl, w, lift }: { ctl: Ctl; w: number; lift: boolean }) {
  const X = (t: number) => xAt(t, w, ctl.D)
  const sel = ctl.mode === 'range' ? ctl.sel : null
  const lane = lanesOf(ctl.points.map(r => r.item), X)
  const taking = ctl.p.status === 'taking'
  return (
    <div className="absolute inset-x-0 bottom-0 h-11">
      <div className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-zinc-900/[.09] dark:bg-white/[.12]" style={{ left: INSET, right: INSET }} />
      {sel && <>
        <div className="absolute top-1/2 h-6 -translate-y-1/2 rounded-md bg-proto-primary-soft" style={{ left: X(sel[0]), width: X(sel[1]) - X(sel[0]) }} />
        <div className="absolute top-1/2 h-1 -translate-y-1/2 bg-proto-primary/60" style={{ left: X(sel[0]), width: X(sel[1]) - X(sel[0]) }} />
      </>}
      {ctl.p.status === 'ready' && ctl.points.map(({ item: c, state, reply }) => {
        const tm = c.time!, on = ctl.open?.item.id === c.id, x0 = X(tm.at), x1 = tm.to !== undefined ? X(tm.to) : x0
        const hit = Math.max(28, x1 - x0 + 12), dy = LANES[lane[c.id] ?? 0], answered = !!reply || state === 'done'
        return (
          <Tip key={c.id} label={<><b className="me-1 font-semibold tabular-nums">{spanOf(tm)}</b>{STATE[state].label}</>}>
            <button data-point data-motion={`point-${c.n}`} data-state={state} onClick={() => ctl.openPoint(c.id)} aria-pressed={on}
              aria-label={`Comment ${c.n}, ${tm.to !== undefined ? 'on' : 'at'} ${spanOf(tm)}, ${STATE[state].label.toLowerCase()}`}
              className={`group absolute grid cursor-pointer place-items-center rounded-md outline-none transition-opacity focus-visible:ring-2 focus-visible:ring-proto-primary-ring ${dy ? 'z-[3] h-5' : 'top-0 z-[2] h-11'} ${sel && !on ? 'opacity-35 hover:opacity-100' : ''}`}
              style={{ left: (x0 + x1) / 2 - hit / 2, width: hit, top: dy ? 22 + dy - 10 : undefined }}>
              {tm.to !== undefined
                ? <span className={`block rounded-full ring-2 ring-[var(--surface)] transition-[height,box-shadow] duration-200 ${answered ? 'bg-proto-primary' : state === 'draft' ? 'bg-proto-primary/45' : 'bg-proto-primary/75'} ${on ? 'h-2 shadow-[0_0_0_5px_var(--proto-primary-soft)]' : 'h-1.5 group-hover:h-2'}`} style={{ width: Math.max(8, x1 - x0) }} />
                : <span className={`block rounded-full ring-2 ring-[var(--surface)] transition-[width,height,box-shadow] duration-200 ${answered ? 'bg-proto-primary' : `bg-[var(--surface)] ${state === 'draft' ? 'shadow-[inset_0_0_0_2px_color-mix(in_srgb,var(--proto-primary)_50%,transparent)]' : 'shadow-[inset_0_0_0_2px_var(--proto-primary)]'}`} ${on ? 'size-3 shadow-[0_0_0_5px_var(--proto-primary-soft)]' : 'size-2.5 group-hover:size-3'}`} />}
            </button>
          </Tip>
        )
      })}
      {ctl.p.status === 'ready' && <>
        {lift && <span className="pointer-events-none absolute bottom-1/2 z-[3] w-[1.5px] -translate-x-1/2 bg-zinc-900 dark:bg-white" style={{ left: X(ctl.p.t), height: 12 }} />}
        <span data-motion="playhead" className="pointer-events-none absolute top-1/2 z-[3] h-[22px] w-[5px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-zinc-900 shadow-sm ring-2 ring-[var(--surface)] dark:bg-white" style={{ left: X(ctl.p.t) }} />
      </>}
      {/* While a take records, the track fills as the time passes; the first one has no length yet. */}
      {taking && <span className="absolute top-1/2 h-1 -translate-y-1/2 animate-pulse rounded-full bg-zinc-900/25 dark:bg-white/30" style={{ left: INSET, width: ctl.p.duration ? Math.max(0, X(ctl.p.t) - INSET) : '30%' }} />}
      {sel && ([0, 1] as const).map(i => (
        <div key={i} data-handle={i} role="slider" tabIndex={0} aria-label={i ? 'Range end' : 'Range start'}
          aria-valuemin={0} aria-valuemax={Math.round(ctl.D)} aria-valuenow={Math.round(sel[i])} aria-valuetext={fmt(sel[i])}
          onKeyDown={e => stepKeys(e, sel[i], ctl.D, t => ctl.moveEdge(i, ctl.snap(t)))}
          className="group absolute top-0 z-[4] grid h-11 w-7 -translate-x-1/2 cursor-ew-resize place-items-center outline-none" style={{ left: X(sel[i]) }}>
          <span className="block h-5 w-1.5 rounded-full bg-proto-primary ring-2 ring-[var(--surface)] transition-[height] duration-150 group-hover:h-6 group-focus-visible:ring-proto-primary-ring" />
        </div>
      ))}
    </div>
  )
}

/* ---------- Buttons ---------- */
const IBTN = 'inline-grid size-9 shrink-0 place-items-center rounded-lg text-zinc-600 outline-none transition-colors hover:bg-zinc-900/5 hover:text-zinc-900 focus-visible:ring-2 focus-visible:ring-proto-primary-ring disabled:pointer-events-none disabled:opacity-40 aria-pressed:bg-zinc-900/[.07] aria-pressed:text-zinc-900 data-popup-open:bg-zinc-900/[.07] data-popup-open:text-zinc-900 dark:text-zinc-300 dark:hover:bg-white/10 dark:hover:text-white dark:aria-pressed:bg-white/[.12] dark:aria-pressed:text-white dark:data-popup-open:bg-white/[.12] dark:data-popup-open:text-white'

function PlayButton({ ctl }: { ctl: Ctl }) {
  const label = ctl.p.status === 'taking' ? 'Recording the motion' : ctl.p.playing ? 'Pause' : ctl.mode === 'range' && ctl.sel ? 'Play the range' : ctl.p.status === 'empty' ? 'Run it again' : 'Play'
  return (
    <Tip label={label} kbd={ctl.p.status === 'ready' ? 'Space' : undefined}>
      <button data-motion="play" onClick={ctl.toggle} aria-label={label} disabled={ctl.p.status === 'taking'} className={`${IBTN} text-zinc-800 dark:text-zinc-100`}>
        <Glyph name={ctl.p.playing || ctl.p.status === 'taking' ? 'pause' : 'play'} className="size-[18px]" />
      </button>
    </Tip>
  )
}

/** The time, small: the playhead's moment, or the range's span in range mode. */
function Readout({ ctl, className = '' }: { ctl: Ctl; className?: string }) {
  const text = ctl.p.status === 'taking' ? 'Recording…' : ctl.mode === 'range' && ctl.sel ? fmtSpan(ctl.sel[0], ctl.sel[1]) : fmt(ctl.p.t)
  return <span aria-live="off" className={`truncate text-[11px] tabular-nums text-zinc-400 dark:text-zinc-500 ${className}`}>{text}</span>
}

/** A moment or a range, as two small icons. */
function ModeToggle({ ctl }: { ctl: Ctl }) {
  return (
    <div role="radiogroup" aria-label="Comment on" className="flex shrink-0 rounded-lg bg-zinc-900/[.05] p-0.5 dark:bg-white/[.07]">
      {(['at', 'range'] as const).map(m => {
        const on = ctl.mode === m
        return (
          <Tip key={m} label={m === 'at' ? 'A moment' : 'A range: drag on the track'}>
            <button role="radio" aria-checked={on} aria-label={m === 'at' ? 'A moment' : 'A range'} data-motion={m === 'at' ? 'mode-moment' : 'mode-range'} onClick={() => ctl.setMode(m)} disabled={ctl.p.status !== 'ready'}
              className={`grid size-8 place-items-center rounded-md outline-none transition-colors focus-visible:ring-2 focus-visible:ring-proto-primary-ring disabled:opacity-40 ${on ? 'bg-white text-zinc-900 shadow-sm ring-1 ring-black/5 dark:bg-zinc-600 dark:text-white dark:ring-white/10' : 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white'}`}>
              <Glyph name={m === 'at' ? 'moment' : 'range'} />
            </button>
          </Tip>
        )
      })}
    </div>
  )
}

function CurvesButton({ ctl }: { ctl: Ctl }) {
  return (
    <Tip label={ctl.curves ? 'Hide the curves' : 'Show the curves'}>
      <button data-motion="curves" aria-pressed={ctl.curves} aria-label="Curves" onClick={() => ctl.setCurves(!ctl.curves)} disabled={ctl.p.status !== 'ready'} className={IBTN}>
        <Glyph name="curves" />
      </button>
    </Tip>
  )
}

/** The one primary: comment on the playhead's moment, or on the range. */
function ComposeButton({ ctl }: { ctl: Ctl }) {
  const on = !!ctl.composing
  const label = ctl.mode === 'range' && ctl.sel ? `Comment on ${fmtSpan(ctl.sel[0], ctl.sel[1])}` : `Comment at ${fmt(ctl.p.t)}`
  return (
    <Tip label={on ? 'Close the comment' : label} kbd={on ? 'Esc' : undefined}>
      <button data-motion="compose" aria-label={on ? 'Close the comment' : label} aria-expanded={on} onClick={ctl.compose} disabled={ctl.p.status !== 'ready'}
        className={`inline-grid size-9 shrink-0 place-items-center rounded-lg shadow-sm shadow-proto-primary/25 disabled:opacity-40 [@media(pointer:coarse)]:size-11 [@media(pointer:coarse)]:rounded-xl ${PRIMARY}`}>
        <Icon name={on ? 'x' : 'comment'} className="size-[18px]" />
      </button>
    </Tip>
  )
}

const POP = 'w-60 origin-[var(--transform-origin)] rounded-2xl border border-black/10 bg-white p-1.5 text-[13px] text-zinc-800 shadow-xl shadow-black/10 outline-none transition-[opacity,scale] duration-150 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0 dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-200'
const ROW = 'flex h-9 w-full cursor-default items-center gap-2.5 rounded-lg px-2 text-start outline-none select-none data-highlighted:bg-zinc-900/[.05] data-popup-open:bg-zinc-900/[.05] data-disabled:opacity-40 dark:data-highlighted:bg-white/[.07] dark:data-popup-open:bg-white/[.07] [@media(pointer:coarse)]:h-11'

/** Everything secondary, behind ⋯: speed, loop, a named moment to go to, replay. */
function More({ ctl }: { ctl: Ctl }) {
  const moments = ctl.p.status === 'ready' ? ctl.player.moments() : []
  return (
    <Menu.Root modal={false} open={ctl.menu} onOpenChange={o => ctl.setMenu(o)}>
      <Tip label="More">
        <Menu.Trigger data-motion="more" aria-label="More" className={IBTN}><Glyph name="more" /></Menu.Trigger>
      </Tip>
      <Menu.Portal>
        <Menu.Positioner side="top" align="end" sideOffset={8} collisionPadding={8} className="z-50 outline-none">
          <Menu.Popup className={POP} finalFocus={type => type === 'keyboard'}>
            <div className="flex h-9 items-center gap-2.5 ps-2 pe-0.5 [@media(pointer:coarse)]:h-11">
              <Glyph name="speed" className="size-4 text-zinc-400" /><span className="flex-1">Speed</span>
              <Menu.RadioGroup value={ctl.p.speed} onValueChange={v => ctl.setSpeed(v as number)} className="flex rounded-lg bg-zinc-900/[.05] p-0.5 dark:bg-white/[.07]">
                {[0.25, 0.5, 1].map(v => (
                  <Menu.RadioItem key={v} value={v} closeOnClick={false} data-motion={`speed-${v}`} aria-label={`${v}× speed`}
                    className="grid h-7 min-w-9 cursor-default place-items-center rounded-md px-1.5 text-xs tabular-nums text-zinc-500 outline-none data-checked:bg-white data-checked:font-medium data-checked:text-zinc-900 data-checked:shadow-sm data-highlighted:text-zinc-900 dark:text-zinc-400 dark:data-checked:bg-zinc-600 dark:data-checked:text-white dark:data-highlighted:text-white [@media(pointer:coarse)]:h-9">
                    {v}×
                  </Menu.RadioItem>
                ))}
              </Menu.RadioGroup>
            </div>
            <Menu.CheckboxItem checked={ctl.p.loop} onCheckedChange={v => ctl.setLoop(v)} closeOnClick={false} data-motion="loop" className={ROW}>
              <Glyph name="loop" className="size-4 text-zinc-400" /><span className="flex-1">Loop</span>
              <Menu.CheckboxItemIndicator className="text-proto-primary-soft-fg"><Icon name="check" className="size-4" /></Menu.CheckboxItemIndicator>
            </Menu.CheckboxItem>
            <Menu.Separator className="mx-2 my-1 h-px bg-black/[.06] dark:bg-white/10" />
            <Menu.SubmenuRoot>
              <Menu.SubmenuTrigger data-motion="go" disabled={!moments.length} className={ROW}>
                <Glyph name="goto" className="size-4 text-zinc-400" /><span className="flex-1">Go to</span><Icon name="right" className="size-3.5 text-zinc-400" />
              </Menu.SubmenuTrigger>
              <Menu.Portal>
                <Menu.Positioner side="inline-end" align="start" sideOffset={6} alignOffset={-6} collisionPadding={8} className="z-50 outline-none">
                  <Menu.Popup className={`${POP} w-56`} finalFocus={type => type === 'keyboard'}>
                    {moments.map((m, i) => (
                      <Menu.Item key={`${m.at}${i}`} data-motion={`go-${i}`} onClick={() => ctl.goTo(m.at)} className={ROW}>
                        <span dir="auto" className="flex-1 truncate">{m.label}</span><span className="text-xs tabular-nums text-zinc-400">{fmt(m.at)}</span>
                      </Menu.Item>
                    ))}
                  </Menu.Popup>
                </Menu.Positioner>
              </Menu.Portal>
            </Menu.SubmenuRoot>
            <Menu.Item data-motion="replay" onClick={ctl.replay} className={ROW}>
              <Glyph name="replay" className="size-4 text-zinc-400" /><span className="flex-1">Replay</span><span className="text-xs text-zinc-400">from 0</span>
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  )
}

/** The controls to the left of the track and to its right, at fixed widths so the curves above
 *  the track can take its exact column. */
const COLS = 'grid-cols-[112px_minmax(0,1fr)_188px] [@media(pointer:coarse)]:grid-cols-[112px_minmax(0,1fr)_196px]'
function LeftControls({ ctl, className = '' }: { ctl: Ctl; className?: string }) {
  return <div className={`flex min-w-0 items-center gap-2 ${className}`}><PlayButton ctl={ctl} /><Readout ctl={ctl} /></div>
}
function RightControls({ ctl, className = '' }: { ctl: Ctl; className?: string }) {
  return <div className={`flex items-center justify-end gap-1 ${className}`}><ModeToggle ctl={ctl} /><CurvesButton ctl={ctl} /><More ctl={ctl} /><ComposeButton ctl={ctl} /></div>
}

/* ---------- A comment, and the composer ---------- */
const rise = (el: HTMLElement | null) => el?.animate([{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }], { duration: 260, easing: 'cubic-bezier(0.32,0.72,0,1)' })

/** An open comment: its number, its moment or range, the words, and what Claude said. */
function Thread({ ctl, compact = false }: { ctl: Ctl; compact?: boolean }) {
  const r = ctl.open
  const had = useRef(!!r?.reply), reply = useRef<HTMLDivElement>(null)
  useEffect(() => { if (r?.reply && !had.current) rise(reply.current); had.current = !!r?.reply }, [r?.reply])
  if (!r) return null
  const { item: c, state } = r, tm = c.time!, span = tm.to !== undefined
  return (
    <div data-thread className="flex items-start gap-2.5">
      <span className="mt-[7px]"><PinDot n={c.n} done={state === 'done'} /></span>
      <div className="min-w-0 flex-1 py-1.5">
        <div className="flex items-center gap-2 text-[11px] tabular-nums">
          <span className="inline-flex items-center gap-1 font-semibold text-proto-primary-soft-fg"><Glyph name={span ? 'range' : 'moment'} className="size-3.5" />{spanOf(tm)}</span>
          {span && ctl.p.span && ctl.p.playing && <span className="text-zinc-400">Looping</span>}
          <span className={STATE[state].cls}>{STATE[state].label}</span>
        </div>
        <Body c={c} className="mt-1 block text-[13px] leading-5 text-zinc-900 dark:text-zinc-100" />
        {r.reply && <div ref={reply} className={compact ? 'mt-1.5' : 'mt-2'}><Reply text={r.reply.text} by={r.reply.by} small={compact} /></div>}
      </div>
      <Tip label="Close" kbd="Esc">
        <button data-motion="close" onClick={ctl.close} aria-label="Close the comment" className={`${IBTN} size-8 text-zinc-400`}><Icon name="x" /></button>
      </Tip>
    </div>
  )
}

/** The page's own comment composer, on the moment or the range, laid out in the dock. */
function DockComposer({ ctl }: { ctl: Ctl }) {
  const { s } = useRows()
  const m = ctl.composing!
  const item = m.id ? s.items.find(i => i.id === m.id) : undefined
  const n = item?.n ?? Math.max(0, ...s.items.filter(i => i.proto === s.place?.proto && i.variant === s.place?.variant).map(i => i.n)) + 1
  return <Composer key={m.id ?? `${m.time.at}-${m.time.to ?? ''}`} time={m.time} docked n={n} place={null} sheet={false} tagging={!!m.tagging} editing={!!item} id={item?.id}
    initial={item ?? (s.held?.time ? s.held : undefined)} />
}

/** What the take has to say instead of the slider: it is recording, or it saw no motion. */
function Note({ ctl }: { ctl: Ctl }) {
  if (ctl.p.status !== 'empty') return null
  return (
    <p data-motion="empty" className="px-1 pt-2.5 text-xs leading-[18px] text-zinc-500 dark:text-zinc-400">
      <b className="font-medium text-zinc-700 dark:text-zinc-200">This take caught no motion.</b> Only CSS transitions, CSS animations and element.animate() can be recorded; motion run from script (requestAnimationFrame, react-spring, GSAP) can’t. Play runs it again.
    </p>
  )
}

export function Dock({ player }: { player: Player }) {
  const ctl = useDock(player)
  const [ref, box] = useSize<HTMLDivElement>()
  const narrow = box.w > 0 && box.w < 560
  // On a phone with the curves on, a comment gets a shorter graph and a smaller reply, so the
  // design keeps a useful size above the dock.
  const busy = narrow && ctl.curves && (!!ctl.composing || !!ctl.open)
  const detail = ctl.composing ? <DockComposer ctl={ctl} /> : <Thread ctl={ctl} compact={busy} />
  const curvesOn = ctl.curves && ctl.p.status === 'ready'
  return (
    <Tooltip.Provider delay={500}>
      <div data-motion-bar className="relative border-t border-black/[.07] bg-white pb-[env(safe-area-inset-bottom,0px)] text-[13px] text-zinc-900 [--surface:#fff] dark:border-white/10 dark:bg-zinc-950 dark:text-zinc-100 dark:[--surface:var(--color-zinc-950)]">
        <div ref={ref} className="mx-auto w-full max-w-[880px] px-3 sm:px-5">
          {narrow ? (
            <>
              <Note ctl={ctl} />
              <Reveal open={!!ctl.composing || !!ctl.open}><div className="pt-2.5">{detail}</div></Reveal>
              <Reveal open={curvesOn}>
                <div className="pt-3">
                  <Legend ctl={ctl} short className="px-1.5" />
                  <Timeline ctl={ctl} graph={busy ? 96 : 150} track={false} className={`transition-[height] duration-[420ms] ${EASE}`} />
                </div>
              </Reveal>
              <Timeline ctl={ctl} className="mt-1" />
              <div className="-mt-0.5 flex items-center justify-between pb-2.5">
                <LeftControls ctl={ctl} />
                <RightControls ctl={ctl} />
              </div>
            </>
          ) : (
            <div className={`grid ${COLS} gap-x-3`}>
              <div className="col-start-2"><Note ctl={ctl} /></div>
              <Reveal open={!!ctl.composing || !!ctl.open} className="col-start-2"><div className="pt-3">{detail}</div></Reveal>
              <Reveal open={curvesOn} className="col-start-2 col-end-4">
                <div className="grid grid-cols-[minmax(0,1fr)_188px] gap-x-3 pt-3 [@media(pointer:coarse)]:grid-cols-[minmax(0,1fr)_196px]">
                  <Timeline ctl={ctl} graph={176} track={false} />
                  <Legend ctl={ctl} className="min-w-0 flex-col !items-start pt-[22px]" />
                </div>
              </Reveal>
              <LeftControls ctl={ctl} className="col-start-1 h-14" />
              <Timeline ctl={ctl} className="self-center" />
              <RightControls ctl={ctl} className="h-14" />
            </div>
          )}
        </div>
      </div>
    </Tooltip.Provider>
  )
}
