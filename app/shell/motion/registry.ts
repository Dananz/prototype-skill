// What a design says about its motion, for the motion dock: how to start its sequence from rest,
// how to put it back at rest, and the moments in it worth naming. A variant declares it while it
// runs (src/motion.ts, useMotion), and the page shows the dock only for a design on the stage that
// did. Kept per mounted design, like its hints (shell/hints.ts).

import { notify, shared } from '../shared'

/** A moment worth naming, in ms from the start of the sequence: Go to lists these. */
export type Moment = { label: string; at: number }

export type Motion = {
  /** Starts the sequence from rest (opens the sheet, sends the form). Without it, the sequence is
   *  the design's entrance, and a take mounts the design again to see it. */
  start?: () => void
  /** Puts the design back at rest, so start can run again. Without it, a take mounts the design
   *  again first. */
  reset?: () => void
  /** Named moments, for Go to. Without them, Go to lists where each captured animation starts. */
  moments?: Moment[]
}

type Entry = { m: Motion; key: string; n: number }
// What the dock shows, without the callbacks: a design re-renders often and its callbacks are new
// each time, which alone is no reason to redraw the dock.
const keyOf = (m: Motion) => JSON.stringify([!!m.start, !!m.reset, (m.moments ?? []).map(x => [x.label, x.at])])

// One registry for a page and the page in its device view (shared.ts).
export const motion = shared('motion', () => {
  const specs = new Map<Element, Entry>()
  const subs = new Set<() => void>()
  let count = 0
  return {
    /** The design mounted in host declares its motion (on every render). */
    set(host: Element, m: Motion) {
      const was = specs.get(host), key = keyOf(m)
      // A new number for each mount, so a take that mounts the design again knows the new one is in.
      specs.set(host, { m, key, n: was ? was.n : ++count })
      if (!was || was.key !== key) notify(subs)
    },
    drop(host: Element) { if (specs.delete(host)) notify(subs) },
    of: (host: Element | null | undefined) => (host && specs.get(host)?.m) || null,
    /** Which mount declared it; changes when the design is mounted again. */
    mountOf: (host: Element | null | undefined) => (host && specs.get(host)?.n) || 0,
    subscribe(f: () => void) { subs.add(f); return () => { subs.delete(f) } },
  }
})
