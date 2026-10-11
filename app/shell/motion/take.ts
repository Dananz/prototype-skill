// A take: the design's motion recorded once, then held, so any moment of it can be shown again.
// It is read off the Web Animations API, which sees CSS transitions, CSS keyframe animations and
// element.animate() alike: the sequence starts, every animation that starts in the design is kept
// with when it started, and the take ends once all of them have finished and nothing new has
// started for a moment. Held, each one is paused and set to the same moment of the take.
//
// Motion run from script (requestAnimationFrame springs, react-spring, GSAP's core) is no animation
// the browser knows of, so a take can't see it. DOM changes that aren't animated (an element added,
// a class swapped without a transition) show their final state at every moment.

export type Part = {
  /** What is held: the design's own animation, or a copy of one (see hold). */
  anim: Animation
  /** The design's own animation's fill, put back on release; null for a copy. */
  fill: FillMode | null
  /** Where its local time 0 falls, in ms of the take, and how fast it runs. */
  offset: number
  rate: number
  /** When it moves, in ms of the take: from the end of its delay to its end (or to when the browser
   *  cancelled it, as a class swap does to the animation it replaces). */
  start: number
  end: number
  target: Element | null
  /** What it animates: the property, or the animation's name. */
  prop: string
  /** The properties its keyframes set. */
  props: string[]
  /** Its timing and keyframes, for the curves, and for holding a copy again after a release. */
  timing: EffectTiming
  keyframes: ComputedKeyframe[]
  pseudo: string | null
  /** Held as a copy: a CSS transition, or an animation the browser cancelled during the take. */
  copy: boolean
  /** The browser had dropped it (a later one filling forwards covers it); it is held anyway. */
  persisted: boolean
  /** Whether it is the one shown for its properties at the moment held (see seek). */
  shown: boolean | null
}
/** t0: the take's 0 on the document's timeline. groups: the parts on each element's property, in
 *  the order they start. error: the sequence's start threw (or rejected). */
export type Take = { duration: number; parts: Part[]; groups: Part[][]; held: boolean; t0?: number; error?: string }

// How long nothing new must start, after the last thing started or finished, for a take to end.
export const QUIET = 500
// The longest take: recording stops there, and a part running past it is cut there (so a take is
// never longer than a comment on it may say).
const LONGEST = 20_000

// A frame, or 50 ms where frames stop (a tab in the background).
export const frame = () => new Promise<void>(r => { const t = setTimeout(r, 50); requestAnimationFrame(() => { clearTimeout(t); r() }) })
export const clock = () => (document.timeline.currentTime as number | null) ?? performance.now()
const endless = (a: Animation) => !Number.isFinite(Number(a.effect?.getComputedTiming().activeDuration ?? 0))
const isTransition = (a: Animation) => typeof CSSTransition !== 'undefined' && a instanceof CSSTransition
const kebab = (p: string) => p.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)
const NOT_PROPS = new Set(['offset', 'computedOffset', 'easing', 'composite'])
const propsIn = (keyframes: ComputedKeyframe[]) => [...new Set(keyframes.flatMap(k => Object.keys(k)).filter(k => !NOT_PROPS.has(k)))]
function propOf(a: Animation, keyframes: ComputedKeyframe[]) {
  if (isTransition(a)) return (a as CSSTransition).transitionProperty
  if (typeof CSSAnimation !== 'undefined' && a instanceof CSSAnimation) return a.animationName
  if (a.id) return a.id
  return propsIn(keyframes).map(kebab).join(', ') || 'animation'
}

/** Ends everything moving in the design (what reset set moving back), endless loops aside. */
export function settle(host: HTMLElement) {
  for (const a of host.getAnimations({ subtree: true })) if (!endless(a)) try { a.finish() } catch { /* no end to go to */ }
}

export const errorOf = (e: unknown) => e instanceof Error ? `${e.name}: ${e.message}` : String(e)

// What an animation was when it was first seen, kept in case the browser cancels it before the
// take ends (a class swap replacing a keyframe animation, a transition turned around): its effect
// may be gone or changed by then.
type Seen = {
  anim: Animation; target: Element | null; pseudo: string | null; keyframes: ComputedKeyframe[]; timing: EffectTiming
  rate: number; prop: string; transition: boolean
  /** Its start on the timeline, the last time it had one; when the browser cancelled it. */
  start: number | null; gone: number | null
}

/**
 * Starts the sequence (go) and records it. Null when it was given up (alive turned false); a take
 * with no parts when nothing animated, or with the error when go threw. What was already there and
 * not moving when go ran (the last take's animations, kept filling forwards) isn't part of it,
 * unless it starts again.
 */
export async function record(host: HTMLElement, go: () => unknown, alive: () => boolean): Promise<Take | null> {
  const seen = new Map<Animation, Seen>(), over = new Set<Animation>()
  const before = new Set(host.getAnimations({ subtree: true }).filter(a => a.playState !== 'running'))
  const began = performance.now()
  let last = began, error: string | null = null
  try {
    const r = go() as { then?: unknown; catch?: (f: (e: unknown) => void) => unknown } | undefined
    if (r && typeof r.then === 'function') r.catch?.(e => { error = errorOf(e) })
  } catch (e) { error = errorOf(e) }
  for (;;) {
    if (error) return { duration: 0, parts: [], groups: [], held: false, error }
    await frame()
    if (!alive()) return null
    const now = performance.now()
    for (const a of host.getAnimations({ subtree: true })) {
      // A spinner or a pulse never ends: it isn't part of the sequence.
      if (seen.has(a) || endless(a) || a.playState === 'idle' || (before.has(a) && a.playState !== 'running')) continue
      const e = a.effect as KeyframeEffect | null
      if (!e) continue
      const keyframes = e.getKeyframes()
      seen.set(a, {
        anim: a, target: e.target, pseudo: e.pseudoElement, keyframes, timing: e.getTiming(), rate: a.playbackRate || 1,
        prop: propOf(a, keyframes), transition: isTransition(a), start: a.startTime === null ? null : Number(a.startTime), gone: null,
      })
      last = now
    }
    let moving = false
    for (const s of seen.values()) {
      const a = s.anim
      if (a.playState !== 'idle' && a.startTime !== null) s.start = Number(a.startTime)
      if (a.playState === 'running') moving = true
      else if (!over.has(a)) { over.add(a); last = now; if (a.playState === 'idle') s.gone = clock() }
    }
    if ((!moving && now - last >= QUIET) || now - began > LONGEST) break
  }
  // One cut short by the longest take still has an end, which it is held at past this point.
  const list = [...seen.values()].filter(s => s.start !== null)
  list.forEach(s => { if (s.anim.playState === 'running') try { s.anim.finish() } catch { /* no end */ } })
  // The take's 0 is when the first part started, not when go() was called: the render and the frame
  // before the browser starts it take longer on a slow machine, and the same moment must be at the
  // same time in every take. A delay written in the motion (a transition-delay) is inside its part.
  const t0 = list.length ? Math.min(...list.map(s => s.start!)) : 0
  const parts: Part[] = list.map(s => {
    const c = new KeyframeEffect(null, [], s.timing).getComputedTiming(), rate = s.rate
    const offset = s.start! - t0, delay = Number(c.delay ?? 0)
    let end = Math.min(LONGEST, offset + (delay + Number(c.activeDuration ?? 0)) / rate)
    if (s.gone !== null) end = Math.min(end, s.gone - t0)
    return {
      anim: s.anim, fill: null, offset, rate, start: Math.min(end, offset + delay / rate), end,
      target: s.target, prop: s.prop, props: propsIn(s.keyframes), timing: s.timing, keyframes: s.keyframes,
      pseudo: s.pseudo, copy: s.transition || s.anim.playState === 'idle', persisted: false, shown: null,
    }
  }).sort((x, y) => x.start - y.start)
  // The parts on each element's property, in the order they start: one of them is shown at a time.
  const byKey = new Map<string, Part[]>(), ids = new Map<Element | null, number>()
  for (const p of parts) {
    if (!ids.has(p.target)) ids.set(p.target, ids.size)
    for (const k of p.props) {
      const key = `${ids.get(p.target)}|${p.pseudo ?? ''}|${k}`
      byKey.set(key, [...byKey.get(key) ?? [], p])
    }
  }
  return { duration: Math.max(0, ...parts.map(p => p.end)), parts, groups: [...byKey.values()], held: false, t0 }
}

/**
 * Pauses every part where it can be set to any moment. A CSS transition, and an animation the
 * browser cancelled during the take, are held as copies made with element.animate's API (their
 * keyframes and timing): WebKit starts a new transition when a finished one is set back, Chrome
 * doesn't, and a copy behaves the same in both. The design's own animations are held as they are;
 * one the browser had dropped (a later one filling forwards covers it, as element.animate chained
 * does) is persisted, or it would never be drawn again.
 */
export function hold(take: Take) {
  if (take.held) return
  for (const p of take.parts) {
    if (p.copy) {
      const was = p.anim
      p.anim = new Animation(new KeyframeEffect(p.target, p.keyframes as Keyframe[], { ...p.timing, fill: 'both', ...(p.pseudo ? { pseudoElement: p.pseudo } : {}) }), document.timeline)
      p.anim.playbackRate = p.rate
      p.anim.pause()
      // The transition itself, finished, goes (or the copy before this one): the copy holds what it showed.
      if (was.playState !== 'idle') try { was.cancel() } catch { /* gone */ }
    } else {
      p.fill = p.anim.effect!.getTiming().fill as FillMode
      p.persisted = p.anim.replaceState === 'removed'
      if (p.persisted) try { p.anim.persist() } catch { /* not in this browser */ }
      p.anim.pause()
    }
    p.shown = null
  }
  take.held = true
}

/**
 * The design at moment t. On each element's property exactly one part is shown: the last to have
 * started by t (the first, before any has), filled both ways so it holds its first frame before it
 * moves and its last after. Every other part on that property is set before its start, filled
 * neither way, so it shows nothing: which part the browser draws on top never matters (a copy is
 * made later than the design's own animations, so it would be on top).
 */
export function seek(take: Take, t: number) {
  if (!take.held) return
  const shown = new Set<Part>()
  for (const g of take.groups) {
    let pick = g[0]
    for (const p of g) if (p.start <= t) pick = p
    shown.add(pick)
  }
  for (const p of take.parts) {
    const on = shown.has(p)
    if (p.shown !== on) { p.anim.effect!.updateTiming({ fill: on ? 'both' : 'none' }); p.shown = on }
    p.anim.currentTime = on ? (t - p.offset) * p.rate : -1
  }
}

/** Lets the design go: every part at its end, as the sequence left it, and live again. */
export function release(take: Take) {
  if (!take.held) return
  for (const p of take.parts) {
    try {
      if (p.copy) p.anim.cancel()
      else {
        p.anim.effect!.updateTiming({ fill: p.fill ?? 'auto' })
        p.anim.finish()
        // One the browser had dropped goes again, so the design's animations don't pile up take
        // after take: the later one that covers it is still there, filling forwards.
        if (p.persisted) p.anim.cancel()
      }
    } catch { /* already gone with its element */ }
  }
  take.held = false
}
