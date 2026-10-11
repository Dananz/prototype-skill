// The playhead over one design's take, as a small store: the dock reads it, and `proto shoot` drives
// it through window.__protoMotion. It records a take (from rest), holds it at its end, seeks, plays
// at a speed, loops a range, and lets the design go when someone uses it.
import { motion, type Moment } from './registry'
import { clock, errorOf, frame, hold, record, release, seek, settle, type Take } from './take'
import { tracksOf, type Track } from './curves'
import { animationsOf, portaled } from '../portals'

/** off: nothing recorded yet; taking: recording now; ready: held; empty: it recorded no motion. */
export type Status = 'off' | 'taking' | 'ready' | 'empty'
export type PlayState = {
  status: Status
  take: Take | null
  tracks: Track[]
  /** The playhead, in ms of the take; while it records, the time since it started. */
  t: number
  duration: number
  playing: boolean
  speed: number
  loop: boolean
  /** A range playing on a loop. */
  span: [number, number] | null
  /** Someone used the design since the take was held, so it runs live; the next move takes it back. */
  live: boolean
  /** Why the take is empty when the sequence's start (or reset) threw. */
  error: string | null
  /** When something started after the take had ended (ms of the take): a step it missed. */
  late: number | null
}

// How long a looped range rests on its last frame before it runs again.
const REST = 360
// How long a design just put on the stage is left alone before its sequence starts.
const ARRIVE = 350
// How long after a take ends something starting in the design is taken for a step it missed.
const LATE = 3000
// A transition of a color, an underline, a focus ring or a shadow: what hover, focus and copy mode
// change, so one that starts up to 1.5 s after the pointer, focus or copy mode moved isn't a step.
const chrome = (a: Animation) => typeof CSSTransition !== 'undefined' && a instanceof CSSTransition && /^(-webkit-)?(text-decoration|box-shadow|outline)|color$/.test(a.transitionProperty)

export function createPlayer(host: HTMLElement, o: { remount: () => Promise<unknown> }) {
  let s: PlayState = { status: 'off', take: null, tracks: [], t: 0, duration: 0, playing: false, speed: 1, loop: false, span: null, live: false, error: null, late: null }
  const subs = new Set<() => void>()
  const set = (patch: Partial<PlayState>) => { s = { ...s, ...patch }; subs.forEach(f => f()) }
  let run = 0, raf = 0, last = 0, rest = 0
  // Whether the design changed while it ran live (in its host, in a portal it renders on <body>, or
  // such a portal came or went): then its take is out of date.
  let changed = false
  const watch = new MutationObserver(records => {
    if (records.some(r => r.target !== document.body || [...r.addedNodes, ...r.removedNodes].some(n => n instanceof Element && !n.hasAttribute('data-proto-ui')))) changed = true
  })
  const stopClock = () => { cancelAnimationFrame(raf); raf = 0 }

  const at = (t: number) => { if (s.take) seek(s.take, t); set({ t }) }
  function tick(now: number) {
    const dt = Math.min(100, now - last)
    last = now
    const [a, b] = s.span ?? [0, s.duration]
    if (rest > 0) { rest -= dt; if (rest <= 0) at(a) }
    else {
      const next = s.t + dt * s.speed
      if (next >= b) {
        at(b)
        if (s.span || s.loop) rest = REST
        else { raf = 0; set({ playing: false }); return }
      } else at(next)
    }
    raf = requestAnimationFrame(tick)
  }
  const startClock = () => { stopClock(); last = performance.now(); rest = 0; raf = requestAnimationFrame(tick); set({ playing: true }) }

  /**
   * Records the sequence from rest and holds it at its end. fresh: the design was just mounted, so
   * it is at rest already (and an entrance is running now, to be caught as it is).
   */
  async function take(fresh = false) {
    const my = ++run
    stopClock()
    if (s.take) release(s.take)
    watch.disconnect()
    changed = false
    const before = s.duration
    set({ status: 'taking', playing: true, span: null, live: false, t: 0, error: null, late: null })
    const alive = () => my === run && host.isConnected
    const spec = motion.of(host)
    let go: () => unknown = () => {}
    const empty = (error: string | null) => set({ status: 'empty', take: null, tracks: [], playing: false, duration: 0, t: 0, error })
    if (spec?.start) {
      // Just mounted, a design may still be laying itself out (a size it measures first), and the
      // page is fading the last design out over it: the sequence starts once both are done.
      if (fresh) await new Promise(r => setTimeout(r, ARRIVE))
      else if (spec.reset) {
        try { spec.reset() } catch (e) { return empty(`reset() threw ${errorOf(e)}`) }
        await frame(); await frame()
      } else await again()
      if (!alive()) return
      // At rest: what reset set moving back, or an entrance, ends now.
      settle(host)
      go = () => motion.of(host)?.start?.()
    } else if (!fresh) go = again
    // The playhead follows the clock while it records, on the last take's scale.
    const began = performance.now()
    const follow = () => { if (my === run && s.status === 'taking') { set({ t: Math.min(performance.now() - began, before || Infinity) }); requestAnimationFrame(follow) } }
    requestAnimationFrame(follow)
    const got = await record(host, go, alive)
    if (!got || !alive()) return
    if (got.error) return empty(`start() threw ${got.error}`)
    if (!got.parts.length) return empty(null)
    hold(got)
    seek(got, got.duration)
    set({ status: 'ready', take: got, tracks: tracksOf(got, host.firstElementChild), duration: got.duration, t: got.duration, playing: false })
    void lateStep(my, got)
  }
  // A step that starts after the take ended (a setTimeout longer than the quiet that ends a take)
  // runs live under the held take: say so. What the page and the pointer start aren't steps: hover
  // and focus transitions (the pointer moving, over or out, focus moving in or out of the design),
  // copy mode marking its lines, and the small transitions those use (see chrome).
  async function lateStep(my: number, got: Take) {
    const known = new Set(got.parts.map(p => p.anim)), began = performance.now()
    let moved = -1e9
    const mark = (e: Event) => { if (e.isTrusted && e.target instanceof Node && (host.contains(e.target) || portaled(e.target))) moved = performance.now() }
    const kinds = ['pointermove', 'pointerover', 'pointerout', 'focusin', 'focusout']
    kinds.forEach(k => document.addEventListener(k, mark, true))
    const copyMode = new MutationObserver(() => { moved = performance.now() })
    copyMode.observe(host, { attributes: true, attributeFilter: ['data-copy-on'] })
    try {
      while (my === run && s.take === got && !s.live && performance.now() - began < LATE) {
        await frame()
        const now = performance.now()
        for (const a of animationsOf(host)) {
          if (known.has(a) || a.playState !== 'running' || !Number.isFinite(Number(a.effect?.getComputedTiming().activeDuration))) continue
          known.add(a)
          // A color alone can be a step (a Save turning green): it is only taken for chrome just after a move.
          if (now - moved < 300 || (chrome(a) && now - moved < 1500)) continue
          return set({ late: Math.round((a.startTime === null ? clock() : Number(a.startTime)) - (got.t0 ?? 0)) })
        }
      }
    } finally {
      kinds.forEach(k => document.removeEventListener(k, mark, true))
      copyMode.disconnect()
    }
  }
  // The design mounted again, its entrance starting; done once the new mount has declared its motion.
  async function again() {
    const n = motion.mountOf(host)
    await o.remount()
    for (let i = 0; i < 60 && [0, n].includes(motion.mountOf(host)); i++) await frame()
  }

  /** Before any move on the dock: a design used live is held again, or taken again if it changed. */
  async function ready() {
    if (s.status === 'taking') return false
    if (s.status !== 'ready' || !s.take) { await take(); return s.status === 'ready' }
    if (s.live) {
      watch.disconnect()
      if (changed) { await take(); return s.status === 'ready' }
      hold(s.take)
      set({ live: false })
    }
    return true
  }

  const player = {
    get: () => s,
    subscribe(f: () => void) { subs.add(f); return () => { subs.delete(f) } },
    take,
    ready,
    /** The playhead to t, stopped (a range stops looping). */
    async seek(t: number) {
      if (!await ready()) return
      stopClock()
      at(Math.min(s.duration, Math.max(0, t)))
      set({ playing: false, span: null })
    },
    async play() {
      if (!await ready()) return
      const [a, b] = s.span ?? [0, s.duration]
      if (s.t >= b - 1 || s.t < a) at(a)
      startClock()
    },
    pause() { if (s.status !== 'ready') return; stopClock(); set({ playing: false }) },
    /** Plays a range on a loop, from its start (or from where the playhead is, inside it). */
    async loopSpan(a: number, b: number, fromStart = true) {
      if (!await ready()) return
      set({ span: [a, b] })
      if (fromStart || s.t < a || s.t >= b - 1) at(a)
      startClock()
    },
    /** Puts away the note about a step the take missed. */
    dismissLate() { set({ late: null }) },
    setSpeed(v: number) { set({ speed: v }) },
    setLoop(v: boolean) { set({ loop: v }) },
    /** Someone used the design: it runs live from its end, until the dock is used again. */
    letGo() {
      if (s.status !== 'ready' || !s.take || s.live) return
      ++run
      stopClock()
      release(s.take)
      changed = false
      watch.observe(host, { subtree: true, childList: true, attributes: true, characterData: true })
      watch.observe(document.body, { childList: true })
      // What it renders on <body> through a portal (a sheet going to its next step), never the
      // shell's root, where every design and the shell's chrome are.
      for (const el of document.body.children) if (portaled(el)) watch.observe(el, { subtree: true, childList: true, attributes: true, characterData: true })
      set({ live: true, playing: false, span: null, t: s.duration })
    },
    /** The design's files changed: take it again (Fast Refresh keeps its state, not its old animations). */
    edited() {
      if (s.status === 'off') return
      void take()
    },
    dispose() { ++run; stopClock(); watch.disconnect(); if (s.take) release(s.take); subs.clear() },
    /** Go to's moments: the design's own, else where each captured animation starts. */
    moments(): Moment[] {
      const own = motion.of(host)?.moments
      if (own?.length) return own
      const seen = new Set<number>()
      return s.tracks.map(tr => ({ label: tr.name, at: Math.round(tr.start) })).filter(m => !seen.has(m.at) && seen.add(m.at))
    },
  }
  return player
}
export type Player = ReturnType<typeof createPlayer>
