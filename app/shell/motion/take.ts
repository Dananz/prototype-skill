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
  /** What is held: the design's own animation, or a copy of a CSS transition (see hold). */
  anim: Animation
  /** The design's own animation's fill, put back on release; null for a copy. */
  fill: FillMode | null
  /** Where its local time 0 falls, in ms of the take, and how fast it runs. */
  offset: number
  rate: number
  /** When it moves, in ms of the take: from the end of its delay to its end. */
  start: number
  end: number
  target: Element | null
  /** What it animates: the property, or the animation's name. */
  prop: string
  /** Its timing and keyframes, for the curves, and for holding a copy again after a release. */
  timing: EffectTiming
  keyframes: ComputedKeyframe[]
  pseudo: string | null
  copy: boolean
}
export type Take = { duration: number; parts: Part[]; held: boolean }

// How long nothing new must start, after the last thing started or finished, for a take to end.
const QUIET = 500
const LONGEST = 20_000

// A frame, or 50 ms where frames stop (a tab in the background).
export const frame = () => new Promise<void>(r => { const t = setTimeout(r, 50); requestAnimationFrame(() => { clearTimeout(t); r() }) })
const clock = () => (document.timeline.currentTime as number | null) ?? performance.now()
const endless = (a: Animation) => !Number.isFinite(Number(a.effect?.getComputedTiming().activeDuration ?? 0))
const isTransition = (a: Animation) => typeof CSSTransition !== 'undefined' && a instanceof CSSTransition
const kebab = (p: string) => p.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)
const NOT_PROPS = new Set(['offset', 'computedOffset', 'easing', 'composite'])
function propOf(a: Animation) {
  if (isTransition(a)) return (a as CSSTransition).transitionProperty
  if (typeof CSSAnimation !== 'undefined' && a instanceof CSSAnimation) return a.animationName
  if (a.id) return a.id
  const keys = (a.effect as KeyframeEffect).getKeyframes().flatMap(k => Object.keys(k)).filter(k => !NOT_PROPS.has(k))
  return [...new Set(keys.map(kebab))].join(', ') || 'animation'
}

/** Ends everything moving in the design (what reset set moving back), endless loops aside. */
export function settle(host: HTMLElement) {
  for (const a of host.getAnimations({ subtree: true })) if (!endless(a)) try { a.finish() } catch { /* no end to go to */ }
}

/**
 * Starts the sequence (go) and records it. Null when it was given up (alive turned false); a take
 * with no parts when nothing animated.
 */
export async function record(host: HTMLElement, go: () => unknown, alive: () => boolean): Promise<Take | null> {
  const seen = new Set<Animation>(), over = new Set<Animation>()
  const began = performance.now()
  let last = began
  go()
  for (;;) {
    await frame()
    if (!alive()) return null
    const now = performance.now()
    for (const a of host.getAnimations({ subtree: true })) {
      // A spinner or a pulse never ends: it isn't part of the sequence.
      if (seen.has(a) || endless(a) || a.playState === 'idle') continue
      seen.add(a)
      last = now
    }
    let moving = false
    for (const a of seen) {
      if (a.playState === 'running') moving = true
      else if (!over.has(a)) { over.add(a); last = now }
    }
    if ((!moving && now - last >= QUIET) || now - began > LONGEST) break
  }
  // One cut short by the longest take still has an end, which it is held at past this point.
  const kept = [...seen].filter(a => a.playState !== 'idle' && a.effect)
  kept.forEach(a => { if (a.playState === 'running') try { a.finish() } catch { /* no end */ } })
  const zero = (a: Animation) => a.startTime !== null ? Number(a.startTime) : clock() - Number(a.currentTime ?? 0) / (a.playbackRate || 1)
  // The take's 0 is when the first part started, not when go() was called: the render and the frame
  // before the browser starts it take longer on a slow machine, and the same moment must be at the
  // same time in every take. A delay written in the motion (a transition-delay) is inside its part.
  const t0 = kept.length ? Math.min(...kept.map(zero)) : 0
  const parts: Part[] = kept.map(a => {
    const effect = a.effect as KeyframeEffect, c = effect.getComputedTiming(), rate = a.playbackRate || 1
    const offset = zero(a) - t0, delay = Number(c.delay ?? 0)
    return {
      anim: a, fill: null, offset, rate,
      start: offset + delay / rate, end: offset + (delay + Number(c.activeDuration ?? 0)) / rate,
      target: effect.target, prop: propOf(a), timing: effect.getTiming(), keyframes: effect.getKeyframes(),
      pseudo: effect.pseudoElement, copy: isTransition(a),
    }
  }).sort((x, y) => x.start - y.start)
  return { duration: Math.max(0, ...parts.map(p => p.end)), parts, held: false }
}

const propsOf = (p: Part) => new Set(p.keyframes.flatMap(k => Object.keys(k)).filter(k => !NOT_PROPS.has(k)))

/**
 * Pauses every part where it can be set to any moment. The first part to move a property of an
 * element is filled both ways, so before it starts it shows its first keyframe rather than the design
 * at rest after the take. A later part on that property (a toast in, then out) is filled forwards
 * only: filled backwards, it would sit over the earlier one, being later in the stack, and show its
 * own first keyframe while the earlier one moves. A CSS transition is held as a copy made with
 * element.animate's API (its keyframes and timing): WebKit starts a new transition when a finished
 * one is set back, Chrome doesn't, and a copy behaves the same in both. The design's own animations
 * are persisted: the browser drops one that a later one filling forwards covers (element.animate
 * chained), and a dropped one is never drawn again.
 */
export function hold(take: Take) {
  if (take.held) return
  const moved = new Map<Element | null, Map<string | null, Set<string>>>()
  for (const p of take.parts) {
    const byPseudo = moved.get(p.target) ?? new Map<string | null, Set<string>>()
    moved.set(p.target, byPseudo)
    const done = byPseudo.get(p.pseudo) ?? new Set<string>()
    byPseudo.set(p.pseudo, done)
    const props = propsOf(p)
    const fill: FillMode = [...props].some(k => done.has(k)) ? 'forwards' : 'both'
    props.forEach(k => done.add(k))
    if (p.copy) {
      const was = p.anim
      p.anim = new Animation(new KeyframeEffect(p.target, p.keyframes as Keyframe[], { ...p.timing, fill, ...(p.pseudo ? { pseudoElement: p.pseudo } : {}) }), document.timeline)
      p.anim.playbackRate = p.rate
      p.anim.pause()
      // The transition itself, finished, goes (or the copy before this one): the copy holds what it showed.
      if (was.playState !== 'idle') try { was.cancel() } catch { /* gone */ }
    } else {
      p.fill = p.anim.effect!.getTiming().fill as FillMode
      p.anim.effect!.updateTiming({ fill })
      try { p.anim.persist() } catch { /* not in this browser */ }
      p.anim.pause()
    }
  }
  take.held = true
}

export function seek(take: Take, t: number) {
  if (!take.held) return
  for (const p of take.parts) p.anim.currentTime = (t - p.offset) * p.rate
}

/** Lets the design go: every part at its end, as the sequence left it, and live again. */
export function release(take: Take) {
  if (!take.held) return
  for (const p of take.parts) {
    try {
      if (p.copy) p.anim.cancel()
      else { p.anim.effect!.updateTiming({ fill: p.fill ?? 'auto' }); p.anim.finish() }
    } catch { /* already gone with its element */ }
  }
  take.held = false
}
