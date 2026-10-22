// G · Lift and snap: the P lifts as one body, separates into an exploded view, glides to a grid and
// snaps flat into five isometric checkout screens. On a pick the four plain slabs pull back into
// the P like magnets, and the picked one rises and drops into the purple top-right slot.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowCounterClockwise, CaretRight, Pause, Play } from '@phosphor-icons/react'
import { CUBES, BRAND } from './logo'
import { MiniUI } from './screens'


const CMD = '/prototype the checkout page'
const VARIANTS = [
  { letter: 'A', name: 'One column' },
  { letter: 'B', name: 'Split' },
  { letter: 'C', name: 'Steps' },
  { letter: 'D', name: 'Big total' },
  { letter: 'E', name: 'Express' },
]
const AUTO = 2 // C · Steps, so the unattended run shows a cube travelling to the purple slot

/* The mark's cube, measured from CUBES: half width, half top depth, side height. */
const W = 127.84, D = 73.81, H = 147.62
const LOGO_CY = -110
/* Slot floor points (base centre of each cube), taken from the mark's own top faces. */
const SLOTS = CUBES.map(c => {
  const n = c.top.match(/-?\d+(\.\d+)?/g)!.map(Number) // M x y(top vertex) ...
  return { x: n[0] - 512, y: n[1] + D + H - 512 + LOGO_CY }
})
/* Five screens on the floor, the five of a die, one isometric cell apart, set in front of the mark's
   footprint so the picked screen never sits inside the P while the P rebuilds. */
const G = 1.3, DX = W * G, DY = D * G, FY = 330
const FLOOR = [
  { x: -DX, y: FY - DY }, { x: DX, y: FY - DY }, { x: 0, y: FY }, { x: -DX, y: FY + DY }, { x: DX, y: FY + DY },
]
const SLAB = 0.075 // a flattened cube keeps a thin edge, like a device

/* Timeline (ms). Before the pick: from the run's start. After: from the pick.
   Break: the P breathes up as one body, separates in place, glides to the floor in one move, snaps flat. */
const T = { type: 500, ch: 45, apart: 2100, sep: 2450, glide: 3150, flat: 3900, ui: 4150, auto: 7750 }
/* Rebuild: the four slabs thicken and pull into the P, a beat, then the picked one rises, travels, drops. */
const P = { thick: 330, pull: 620, rise: 1580, travel: 2030, drop: 2730, done: 3330 }
const LIFT = 34 // the breath up
const SPREAD = 1.15 // exploded view: each cube's distance from the mark's centre
const MID = { x: SLOTS.reduce((a, s) => a + s.x, 0) / 5, y: SLOTS.reduce((a, s) => a + s.y, 0) / 5 }

const VB = { w: 540, h: 380 }
type Frame = { cx: number; cy: number; s: number }
const CAM: Record<'logo' | 'apart' | 'glide' | 'screens' | 'both', Frame> = {
  logo: { cx: 0, cy: LOGO_CY, s: 0.5 },
  apart: { cx: 0, cy: LOGO_CY, s: 0.47 }, // the exploded P, with room for the breath up
  glide: { cx: 0, cy: FY - 110, s: 0.6 }, // full cubes standing on the grid
  screens: { cx: 0, cy: FY + 6, s: 0.84 },
  both: { cx: 0, cy: 55, s: 0.39 }, // the P and the grid in front of it
}

const clamp = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
const ease = (v: number) => (v < 0.5 ? 4 * v * v * v : 1 - Math.pow(-2 * v + 2, 3) / 2)
const seg = (t: number, a: number, d: number) => ease(clamp((t - a) / d))
const lin = (t: number, a: number, d: number) => clamp((t - a) / d)
const out = (v: number) => 1 - Math.pow(1 - v, 3)
/** Ease out with one small overshoot (s ~ 1.2 is about 5%). */
const back = (v: number, s = 1.2) => (v <= 0 ? 0 : v >= 1 ? 1 : 1 + (s + 1) * Math.pow(v - 1, 3) + s * Math.pow(v - 1, 2))
/** Magnet: slow to let go, fast at the end, a tiny recoil on contact. */
const magnet = (v: number) => (v <= 0 ? 0 : v < 0.86 ? Math.pow(v / 0.86, 2.4) : 1 + 0.025 * Math.sin(Math.PI * (v - 0.86) / 0.14))
const mix = (a: number, b: number, k: number) => a + (b - a) * k
const mixF = (a: Frame, b: Frame, k: number): Frame => ({ cx: mix(a.cx, b.cx, k), cy: mix(a.cy, b.cy, k), s: mix(a.s, b.s, k) })
function mixHex(a: string, b: string, k: number) {
  const p = (h: string, i: number) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16)
  return `rgb(${[0, 1, 2].map(i => Math.round(mix(p(a, i), p(b, i), k))).join(',')})`
}

type CubeState = { i: number; x: number; y: number; h: number; L: number; p: number; ui: number; z: number }

/** A one-line message that slides the old words up and out as the new ones come in. */
function SwapLine({ k, children, className = '' }: { k: string; children: ReactNode; className?: string }) {
  const [lines, setLines] = useState([{ k, node: children, out: false }])
  const shown = useRef(children)
  useEffect(() => {
    if (lines[lines.length - 1].k === k) return
    setLines(ls => [...ls.filter(l => !l.out).slice(-1).map(l => ({ ...l, node: shown.current, out: true })), { k, node: null, out: false }])
    const t = window.setTimeout(() => setLines(ls => ls.filter(l => !l.out)), 320)
    return () => window.clearTimeout(t)
  }, [k]) // eslint-disable-line react-hooks/exhaustive-deps
  if (lines[lines.length - 1].k === k) shown.current = children
  return (
    <div className={`relative h-6 overflow-hidden ${className}`} aria-live="polite">
      {lines.map(l => (
        <p key={l.k} className={`absolute inset-x-0 top-0 truncate ${l.out ? 'mcd-swap-out' : 'mcd-swap-in'}`} aria-hidden={l.out || undefined}>{l.out ? l.node : l.k === k ? children : shown.current}</p>
      ))}
    </div>
  )
}

/** Every cube and the camera at time t. Pure, so reduced motion can ask for any moment. */
function scene(t: number, pickT: number | null, picked: number, hov: number[]) {
  const cubes: CubeState[] = []
  const others = [0, 1, 2, 3, 4].filter(i => i !== picked)
  const lift = LIFT * out(lin(t, T.apart, 420))
  const sep = back(lin(t, T.sep, 480), 1.4)
  const glide = seg(t, T.glide, 750)
  const flat = back(lin(t, T.flat, 200), 1.6)
  for (let i = 0; i < 5; i++) {
    // Exploded view: in P formation, every cube pushed out from the centre by the same factor.
    const ex = mix(SLOTS[i].x, MID.x + (SLOTS[i].x - MID.x) * SPREAD, sep)
    const ey = mix(SLOTS[i].y, MID.y + (SLOTS[i].y - MID.y) * SPREAD, sep) - lift
    let x = mix(ex, FLOOR[i].x, glide)
    let y = mix(ey, FLOOR[i].y, glide)
    let h = 1 - (1 - SLAB) * flat
    let L = i === 4 ? 14 * (1 - seg(t, T.apart, 420)) : 0
    let p = i === 4 ? 1 - seg(t, T.apart, 420) : 0
    let ui = seg(t, T.ui + i * 50, 420)
    // Paint order: the mark's own order (left column, then right) while assembled, depth on the floor.
    let z = glide < 0.5 ? i : 10 + FLOOR[i].y / 1000 + FLOOR[i].x / 1e6
    if (pickT === null) {
      L += 12 * hov[i]
    } else {
      const tau = t - pickT
      if (i === picked) {
        // Turns purple in place, waits on its tile, then rises, travels and drops with the logo's lift.
        p = seg(tau, 0, 320)
        const r = out(lin(tau, P.rise, 450))
        h = mix(h, 1, back(lin(tau, P.rise, 450), 1.2))
        ui = 1 - seg(tau, P.rise, 300)
        const go = seg(tau, P.travel, 700)
        x = mix(FLOOR[i].x, SLOTS[4].x, go)
        y = mix(FLOOR[i].y, SLOTS[4].y, go) - 50 * Math.sin(Math.PI * go)
        const d = back(lin(tau, P.drop, 480), 2.2)
        L = 12 * hov[i] + mix(70 * r, 14, d)
        z = tau > P.rise ? 20 : z
      } else {
        const rank = others.indexOf(i)
        h = mix(h, 1, back(lin(tau, P.thick, 340), 1.4))
        ui = 1 - seg(tau, 0, 260)
        L = 12 * hov[i]
        const m = magnet(lin(tau, P.pull, 630))
        x = mix(FLOOR[i].x, SLOTS[rank].x, m)
        y = mix(FLOOR[i].y, SLOTS[rank].y, m)
        if (m >= 0.5) z = rank
      }
    }
    cubes.push({ i, x, y, h, L, p, ui, z })
  }
  let cam = CAM.logo
  cam = mixF(cam, CAM.apart, seg(t, T.apart, 900))
  cam = mixF(cam, CAM.glide, glide)
  cam = mixF(cam, CAM.screens, out(lin(t, T.flat, 600)))
  const tile = seg(t, T.flat - 40, 160)
  const slots = [0, 1, 2, 3, 4].map(() => tile)
  if (pickT !== null) {
    const tau = t - pickT
    cam = mixF(cam, CAM.both, out(lin(tau, 0, 650)))
    cam = mixF(cam, CAM.logo, seg(tau, P.travel, 1000))
    for (let i = 0; i < 5; i++) slots[i] *= 1 - seg(tau, i === picked ? P.rise + 200 : P.pull + 300, 350)
  }
  return { cubes, cam, slots }
}

function rhombus(x: number, y: number) {
  return `M${x} ${y - D}L${x + W} ${y}L${x} ${y + D}L${x - W} ${y}Z`
}

function Block({ c, hl, live, onEnter, onLeave, onPick }: {
  c: CubeState; hl: boolean; live: boolean; onEnter: () => void; onLeave: () => void; onPick: () => void
}) {
  const { x, h, L, p } = c
  const b = c.y - L, tc = b - h * H
  const pal = [0, 1, 2].map(k => mixHex(BRAND.plain[k], BRAND.picked[k], p))
  return (
    <g data-v={c.i} onPointerEnter={live ? onEnter : undefined} onPointerLeave={live ? onLeave : undefined}
      onClick={live ? onPick : undefined} style={{ cursor: live ? 'pointer' : undefined }}>
      <path d={`M${x - W} ${tc}L${x} ${tc + D}L${x} ${b + D}L${x - W} ${b}Z`} fill={pal[1]} />
      <path d={`M${x + W} ${tc}L${x} ${tc + D}L${x} ${b + D}L${x + W} ${b}Z`} fill={pal[2]} />
      <path d={rhombus(x, tc)} fill={pal[0]} />
      {c.ui > 0.01 && (
        <g opacity={c.ui} transform={`matrix(${W / 100} ${-D / 100} ${W / 100} ${D / 100} ${x - W} ${tc})`}>
          <MiniUI i={c.i} p={p} hl={hl} />
        </g>
      )}
      {hl && c.ui > 0.5 && (
        <path d={rhombus(x, tc)} fill="none" stroke={BRAND.violet} strokeWidth={2} vectorEffect="non-scaling-stroke" />
      )}
    </g>
  )
}

function useReduced() {
  const [r] = useState(() => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  return r
}

const css = `
.mcd{font-family:var(--font-sans)}
.mcd-code{font-family:var(--font-code)}
@keyframes mcd-blink{50%{opacity:0}}
.mcd-blink{animation:mcd-blink 1s steps(1) infinite}
@keyframes mcd-in{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
.mcd-in{animation:mcd-in .4s cubic-bezier(.2,.8,.2,1) both}
.mcd-swap-in{animation:mcd-swap-in .38s cubic-bezier(.2,.8,.2,1) both}
.mcd-swap-out{animation:mcd-swap-out .3s cubic-bezier(.4,0,.6,1) both}
@keyframes mcd-swap-in{from{opacity:0;transform:translateY(70%);filter:blur(2px)}to{opacity:1;transform:none;filter:none}}
@keyframes mcd-swap-out{from{opacity:1;transform:none}to{opacity:0;transform:translateY(-70%);filter:blur(2px)}}
@media (prefers-reduced-motion:reduce){.mcd *{animation:none!important}}
`

export default function MachineG() {
  const reduced = useReduced()
  const END = 1e7, STILL = T.ui + 2000 // reduced motion renders this one moment, before or long after the pick
  // The run lives in a ref; `t` is the frame we render.
  const sim = useRef({ start: 0, pickT: (reduced ? T.ui + 2000 - 1e7 : null) as number | null, picked: AUTO, hover: -1, focus: -1, hov: [0, 0, 0, 0, 0], leftAt: 0, viaKey: false, clock: 0, paused: false, off: false })
  const [t, setT] = useState(() => (reduced ? STILL : 0))
  const [, force] = useState(0)
  const [run, setRun] = useState(0)
  const [paused, setPaused] = useState(false)
  const replayRef = useRef<HTMLButtonElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const s = sim.current

  const pick = useCallback((i: number, viaKey = false) => {
    const m = sim.current
    if (m.pickT !== null) return
    m.picked = i; m.viaKey = viaKey
    if (reduced) { m.pickT = STILL - END; setT(STILL); force(n => n + 1); return }
    m.pickT = m.clock
    if (m.paused) { m.paused = false; setPaused(false) }
  }, [reduced])

  useEffect(() => {
    const m = sim.current
    if (reduced) {
      // Reduced motion: the end state; Play again opens the five screens, still, to pick from.
      if (run === 0) { m.pickT = STILL - END; m.picked = AUTO }
      else { m.pickT = null; m.hov = [0, 0, 0, 0, 0] }
      setT(STILL); force(n => n + 1)
      return
    }
    m.start = performance.now(); m.clock = 0; m.paused = false; setPaused(false); m.pickT = null; m.picked = AUTO
    m.hover = -1; m.focus = -1; m.hov = [0, 0, 0, 0, 0]; m.leftAt = 0
    let raf = 0, last = m.start
    const tick = (now: number) => {
      const dt = Math.min(64, now - last); last = now
      // The clock stands still while paused or scrolled out of view, so the run picks up where it was.
      if (!m.paused && !m.off) m.clock += dt
      const time = m.clock
      const active = m.hover >= 0 ? m.hover : m.focus
      let moved = false
      for (let i = 0; i < 5; i++) {
        const target = m.pickT === null && time > T.ui && i === active ? 1 : 0
        const d = (target - m.hov[i]) * (1 - Math.exp(-dt / 90))
        m.hov[i] += d
        if (Math.abs(d) > 1e-3) moved = true
      }
      if (m.pickT === null && time > Math.max(T.auto, m.leftAt + 2200) && active < 0) m.pickT = time
      if (!m.paused && !m.off) setT(time)
      else if (moved) force(n => n + 1)
      if (m.pickT !== null && time - m.pickT > P.done + 200) return
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [run, reduced])

  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => { sim.current.off = !e.isIntersecting })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  const choosing = s.pickT === null && t > T.ui
  const tau = s.pickT === null ? -1 : t - s.pickT
  const done = s.pickT !== null && tau > P.done
  useEffect(() => { if (done && s.viaKey) replayRef.current?.focus() }, [done, s.viaKey])

  const hov = reduced ? s.hov.map((_, i) => (i === (s.hover >= 0 ? s.hover : s.focus) && choosing ? 1 : 0)) : s.hov
  const { cubes, cam, slots } = scene(t, s.pickT, s.picked, hov)
  const order = [...cubes].sort((a, b) => a.z - b.z)
  const typed = reduced ? CMD.length : Math.max(0, Math.min(CMD.length, Math.floor((t - T.type) / T.ch)))
  const active = s.hover >= 0 ? s.hover : s.focus
  const v = VARIANTS[s.picked]
  const setHover = (i: number) => { s.hover = i; if (i < 0) s.leftAt = t; force(n => n + 1) }
  const setFocus = (i: number) => { s.focus = i; if (i < 0) s.leftAt = t; force(n => n + 1) }

  let caption: ReactNode = null
  if (done) caption = <><b className="font-semibold text-[#c4c1fc]">{v.letter} · {v.name}</b> picked. Building it into your codebase.</>
  else if (s.pickT !== null) caption = <>Picked <b className="font-semibold text-[#c4c1fc]">{v.letter} · {v.name}</b></>
  else if (choosing) caption = active >= 0
    ? <><b className="font-semibold text-white">{VARIANTS[active].letter} · {VARIANTS[active].name}</b>{s.hover >= 0 ? ', click to pick it' : ', press Enter to pick it'}</>
    : <>Five versions are live. Pick one.</>
  else if (t > T.apart) caption = <>Building five versions on one live link</>

  return (
    <div ref={rootRef} className="mcd relative mx-auto w-full max-w-[620px] overflow-hidden rounded-[22px] border border-[#e6e4fc] bg-[#f6f5ff] text-[#121019] shadow-[0_30px_60px_-30px_rgba(49,42,184,.35)]">
      <style>{css}</style>
      <div className="mcd-code m-2 rounded-[14px] bg-[#121019] px-4 py-2.5 text-[12.5px] leading-6 text-white sm:text-[13px]">
        <div className="flex items-center gap-2">
          <CaretRight size={13} weight="bold" className="shrink-0 text-[#a8a4f8]" />
          <span className="min-w-0 truncate">
            {CMD.slice(0, typed)}
            {!reduced && t < T.apart + 400 && <span className="mcd-blink ml-px inline-block h-[15px] w-[7px] translate-y-[2px] bg-[#c4c1fc]" />}
          </span>
          <span className="ml-auto hidden shrink-0 text-[11px] text-white/50 sm:inline">your-project</span>
        </div>
        <SwapLine k={`${run}-${done}-${s.pickT !== null}-${choosing}-${choosing ? active : ''}-${t > T.apart}`} className="pl-[21px] text-white/60">{caption}</SwapLine>
      </div>

      <svg viewBox={`0 0 ${VB.w} ${VB.h}`} className="block h-auto w-full select-none" aria-hidden>
        <g transform={`translate(${VB.w / 2} ${VB.h / 2}) scale(${cam.s}) translate(${-cam.cx} ${-cam.cy})`}>
          {FLOOR.map((f, i) => slots[i] > 0.01 && (
            <path key={i} d={rhombus(f.x, f.y)} fill="#ebe9fd" opacity={slots[i]} />
          ))}
          {order.map(c => (
            <Block key={c.i} c={c} hl={choosing && active === c.i} live={choosing}
              onEnter={() => setHover(c.i)} onLeave={() => setHover(-1)} onPick={() => pick(c.i)} />
          ))}
        </g>
      </svg>

      <div className="absolute bottom-3 left-3 flex items-center gap-3">
        {done ? (
          <button ref={replayRef} type="button" onClick={() => { s.viaKey = false; setRun(r => r + 1) }}
            className="mcd-in flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[13px] text-[#5b5870] transition-colors hover:bg-white hover:text-[#121019] focus-visible:ring-2 focus-visible:ring-[#6d68f0] focus-visible:outline-none">
            <ArrowCounterClockwise size={15} /> {reduced ? 'Pick again' : 'Replay'}
          </button>
        ) : (
          <button type="button" disabled={reduced} onClick={() => { s.paused = !s.paused; setPaused(s.paused) }}
            aria-label={paused ? 'Play' : 'Pause'} aria-pressed={paused}
            className="grid size-9 shrink-0 place-items-center rounded-lg text-[#5b5870] transition-colors hover:bg-white hover:text-[#121019] focus-visible:ring-2 focus-visible:ring-[#6d68f0] focus-visible:outline-none disabled:opacity-40">
            <span key={paused ? 'play' : 'pause'} className="mcd-in grid place-items-center">{paused ? <Play size={16} weight="fill" /> : <Pause size={16} weight="fill" />}</span>
          </button>
        )}
      </div>

      {choosing && (
        <div className="sr-only" role="group" aria-label="Pick a version">
          {VARIANTS.map((x, i) => (
            <button key={x.letter} type="button" onFocus={() => setFocus(i)} onBlur={() => setFocus(-1)}
              onClick={() => pick(i, true)}>Pick {x.letter} · {x.name}</button>
          ))}
        </div>
      )}
    </div>
  )
}
