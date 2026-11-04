// What the tree keeps in this browser, beside what is on disk: which options were opened, when each
// prototype was last visited, and what the user moved to or from the shelf by hand. A project's app
// is its own origin, so this is per project. What existed before the first visit counts as seen, so
// an upgrade doesn't mark every old option as new.
const KEY = 'proto-tree-memory'
type Stored = { since: number; seen: string[]; visits: Record<string, number>; aside: Record<string, 'settled' | 'active'> }

function load(): Stored {
  try {
    const m = JSON.parse(localStorage.getItem(KEY) ?? 'null')
    if (m && typeof m.since === 'number') return { since: m.since, seen: m.seen ?? [], visits: m.visits ?? {}, aside: m.aside ?? {} }
  } catch { /* private window, or not ours */ }
  return { since: Date.now(), seen: [], visits: {}, aside: {} }
}

const data = load()
const seen = new Set(data.seen)
const watchers = new Set<() => void>()
let version = 0
const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ ...data, seen: [...seen] })) } catch { /* private window */ } }
const changed = () => { version++; save(); for (const fn of watchers) fn() }

export const memory = {
  subscribe(fn: () => void) { watchers.add(fn); return () => { watchers.delete(fn) } },
  version: () => version,
  /** The place on screen: its option is seen now and its prototype was visited now. */
  visit(route: string) {
    const [slug, letter] = route.split('/')
    if (!slug) return
    data.visits[slug] = Date.now()
    if (letter && !seen.has(route)) { seen.add(route); changed() } else save()
  },
  isSeen: (route: string, created: string) => seen.has(route) || Date.parse(created) < data.since,
  visitedAt: (slug: string) => data.visits[slug] ?? 0,
  asideOf: (slug: string) => data.aside[slug],
  setAside(slug: string, to: 'settled' | 'active') { data.aside[slug] = to; changed() },
  /** What the tree drew last, for the row menu: the chains on the shelf and the roots that could go there. */
  settled: new Set<string>(),
  loose: new Set<string>(),
}
