'use client'
// G · Lift and snap: the P lifts as one body, separates into an exploded view, glides to a grid and
// snaps flat into five isometric checkout screens. On a pick the four plain slabs pull back into
// the P like magnets, and the picked one rises and drops into the purple top-right slot.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { ArrowCounterClockwiseIcon, CaretRightIcon, PauseIcon, PlayIcon } from '@phosphor-icons/react'
import { AnimatedIcon } from '@/components/animated-icon'
import { useMounted, useReducedPref } from '@/lib/media'
import { CUBES, BRAND } from './mark'
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

/** A one-line message that slides the old words up and out as the new ones come in (Motion). Before
 * the page is live it is plain text: Motion's inline styles in the server's HTML would meet the CSP. */
function SwapLine({ k, children, className = '' }: { k: string; children: ReactNode; className?: string }) {
  const mounted = useMounted()
  const reduce = useReducedMotion()
  const line = 'absolute inset-x-0 top-0 truncate'
  return (
    <div className={`relative h-6 overflow-hidden ${className}`} aria-live="polite">
      {mounted ? (
        <AnimatePresence initial={false}>
          <motion.p key={k} className={line}
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: '70%', filter: 'blur(2px)' }}
            animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0, filter: 'blur(0px)', transition: { duration: 0.38, ease: [0.2, 0.8, 0.2, 1] } }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: '-70%', filter: 'blur(2px)', transition: { duration: 0.3, ease: [0.4, 0, 0.6, 1] } }}>
            {children}
          </motion.p>
        </AnimatePresence>
      ) : <p className={line}>{children}</p>}
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
      onClick={live ? onPick : undefined} className={live ? 'cursor-pointer' : undefined}>
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



type Sim = { pickT: number | null; picked: number; hover: number; focus: number; hov: number[]; leftAt: number; viaKey: boolean; clock: number; paused: boolean; off: boolean }
/** What a frame draws: the run's clock and a copy of the parts of the run it shows. */
type View = { t: number; pickT: number | null; picked: number; hover: number; focus: number; hov: number[]; viaKey: boolean }
const viewOf = (m: Sim, t: number): View => ({ t, pickT: m.pickT, picked: m.picked, hover: m.hover, focus: m.focus, hov: [...m.hov], viaKey: m.viaKey })

const fresh = (): Sim => ({ pickT: null, picked: AUTO, hover: -1, focus: -1, hov: [0, 0, 0, 0, 0], leftAt: 0, viaKey: false, clock: 0, paused: false, off: false })
const END = 1e7, STILL = T.ui + 2000 // reduced motion renders this one moment, before or long after the pick

export function Machine() {
  const reduced = useReducedPref()
  // The run lives in a ref, read and written by the frame loop and the handlers; each frame renders a
  // copy of it (view).
  const sim = useRef<Sim>(fresh())
  const [view, setView] = useState<View>(() => viewOf(fresh(), 0))
  const [run, setRun] = useState(0)
  const [paused, setPaused] = useState(false)
  const replayRef = useRef<HTMLButtonElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const { t } = view

  const pick = useCallback((i: number, viaKey = false) => {
    const m = sim.current
    if (m.pickT !== null) return
    m.picked = i; m.viaKey = viaKey
    if (reduced) { m.pickT = STILL - END; setView(viewOf(m, STILL)); return }
    m.pickT = m.clock
    if (m.paused) { m.paused = false; setPaused(false) }
  }, [reduced])

  useEffect(() => {
    const m = sim.current
    let raf = 0
    if (reduced) {
      // Reduced motion: the end state; Pick again opens the five screens, still, to pick from.
      if (run === 0) { m.pickT = STILL - END; m.picked = AUTO }
      else { m.pickT = null; m.hov = [0, 0, 0, 0, 0] }
      raf = requestAnimationFrame(() => setView(viewOf(m, STILL)))
      return () => cancelAnimationFrame(raf)
    }
    const start = performance.now()
    m.clock = 0; m.paused = false; m.pickT = null; m.picked = AUTO
    m.hover = -1; m.focus = -1; m.hov = [0, 0, 0, 0, 0]; m.leftAt = 0
    let last = start
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
      if ((!m.paused && !m.off) || moved) setView(viewOf(m, time))
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

  const choosing = view.pickT === null && t > T.ui
  const tau = view.pickT === null ? -1 : t - view.pickT
  const done = view.pickT !== null && tau > P.done
  useEffect(() => { if (done && view.viaKey) replayRef.current?.focus() }, [done, view.viaKey])

  const active = view.hover >= 0 ? view.hover : view.focus
  const hov = reduced ? view.hov.map((_, i) => (i === active && choosing ? 1 : 0)) : view.hov
  const { cubes, cam, slots } = scene(t, view.pickT, view.picked, hov)
  const order = [...cubes].sort((a, b) => a.z - b.z)
  const typed = reduced ? CMD.length : Math.max(0, Math.min(CMD.length, Math.floor((t - T.type) / T.ch)))
  const v = VARIANTS[view.picked]
  const point = (key: 'hover' | 'focus', i: number) => {
    const m = sim.current
    m[key] = i
    if (i < 0) m.leftAt = t
    setView(viewOf(m, t))
  }
  const setHover = (i: number) => point('hover', i)
  const setFocus = (i: number) => point('focus', i)

  let caption: ReactNode = null
  if (done) caption = <><b className="font-semibold text-[#c4c1fc]">{v.letter} · {v.name}</b> picked. Building it into your codebase.</>
  else if (view.pickT !== null) caption = <>Picked <b className="font-semibold text-[#c4c1fc]">{v.letter} · {v.name}</b></>
  else if (choosing) caption = active >= 0
    ? <><b className="font-semibold text-white">{VARIANTS[active].letter} · {VARIANTS[active].name}</b>{view.hover >= 0 ? ', click to pick it' : ', press Enter to pick it'}</>
    : <>Five versions are live. Pick one.</>
  else if (t > T.apart) caption = <>Building five versions on one live link</>

  return (
    <div ref={rootRef} className="mcd relative mx-auto w-full max-w-[620px] overflow-hidden rounded-[22px] border border-[#e6e4fc] bg-[#f6f5ff] text-[#121019] shadow-[0_30px_60px_-30px_rgba(49,42,184,.35)]">
      <div className="m-2 rounded-[14px] bg-[#121019] px-4 py-2.5 text-[12.5px] leading-6 text-white sm:text-[13px]">
        <div className="flex items-center gap-2">
          <CaretRightIcon size={13} weight="bold" aria-hidden="true" className="shrink-0 text-[#a8a4f8]" />
          <span className="min-w-0 truncate">
            {CMD.slice(0, typed)}
            {!reduced && t < T.apart + 400 && <span className="mcd-blink ml-px inline-block h-[15px] w-[7px] translate-y-[2px] bg-[#c4c1fc]" />}
          </span>
          <span className="ml-auto hidden shrink-0 text-[11px] text-white/50 sm:inline">your-project</span>
        </div>
        <SwapLine k={`${run}-${done}-${view.pickT !== null}-${choosing}-${choosing ? active : ''}-${t > T.apart}`} className="pl-[21px] text-white/60">{caption}</SwapLine>
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
          <motion.button ref={replayRef} type="button" onClick={() => { sim.current.viaKey = false; setRun(r => r + 1) }}
            initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: [0.2, 0.8, 0.2, 1] }}
            className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[13px] text-[#5b5870] transition-colors hover:bg-white hover:text-[#121019] focus-visible:ring-2 focus-visible:ring-[#6d68f0] focus-visible:outline-none">
            <ArrowCounterClockwiseIcon size={15} aria-hidden="true" /> {reduced ? 'Pick again' : 'Replay'}
          </motion.button>
        ) : (
          <button type="button" disabled={reduced} onClick={() => { const m = sim.current; m.paused = !m.paused; setPaused(m.paused) }}
            aria-label={paused ? 'Play' : 'Pause'} aria-pressed={paused}
            className="grid size-9 shrink-0 place-items-center rounded-lg text-[#5b5870] transition-colors hover:bg-white hover:text-[#121019] focus-visible:ring-2 focus-visible:ring-[#6d68f0] focus-visible:outline-none disabled:opacity-40">
            <AnimatedIcon state={paused ? 'play' : 'pause'} size={16}>{paused ? <PlayIcon size={16} weight="fill" /> : <PauseIcon size={16} weight="fill" />}</AnimatedIcon>
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
