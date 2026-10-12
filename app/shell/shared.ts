// What a design reports about itself (its Try it hints, copy lines, motion) is kept in registries
// the page reads. The page inside a device view (view/frame.ts) is this same app in a frame of the
// page: its design reports into the outer page's registries instead of its own, so the outer
// page's Try it, copy options and the rest work on the design in the frame as on its own stage,
// at its own size, with one set of choices. Same origin, so the frame reaches them directly.
import { framed } from './view/frame'

type Shared = Record<string, unknown>
const own = window as unknown as { __proto?: Shared }

/** The registry `name`: the outer page's when this page is in its device view, else made here
 *  (and offered to a frame of this page). */
export function shared<T>(name: string, make: () => T): T {
  if (framed) {
    try { const outer = (window.parent as unknown as { __proto?: Shared }).__proto?.[name]; if (outer && window.parent !== window) return outer as T } catch { /* not the page's frame */ }
  }
  const made = make()
  ;(own.__proto ??= {})[name] = made
  return made
}

/** Tells each listener. One from a frame that has gone (its page unloaded before it said goodbye)
 *  throws, or no longer lives: it is dropped instead of breaking the rest. */
export function notify(subs: Set<() => void>) {
  for (const f of [...subs]) { try { f() } catch { subs.delete(f) } }
}
