// The comments island's preferences, kept per browser like the other reviewer choices: the edge it
// rests on, where along that edge, and which news grows it. It always rests on an edge of the stage:
// flat on the foot or the top (`along` is its centre's offset from the stage's middle), or upright
// on the left or the right (`along` is its top, from the stage's top).
import { useSyncExternalStore } from 'react'

export type Edge = 'bottom' | 'top' | 'left' | 'right'
export type IslandPrefs = { place: Edge; along: number; news: 'all' | 'replies' | 'off' }
const KEY = 'proto-island'
const EDGES: Edge[] = ['bottom', 'top', 'left', 'right']
const DEFAULT: IslandPrefs = { place: 'bottom', along: 0, news: 'all' }
const read = (): IslandPrefs => {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null')
    return {
      place: EDGES.includes(s?.place) ? s.place : 'bottom',
      // Before edges, a flat island kept a free offset `at`: its sideways part still holds.
      along: Number.isFinite(s?.along) ? s.along : Number.isFinite(s?.at?.x) ? s.at.x : 0,
      news: s?.news === 'replies' || s?.news === 'off' ? s.news : 'all',
    }
  } catch { return DEFAULT }
}
let prefs = read()
const listeners = new Set<() => void>()
export const islandPrefs = {
  get: () => prefs,
  set(patch: Partial<IslandPrefs>) {
    prefs = { ...prefs, ...patch }
    try { localStorage.setItem(KEY, JSON.stringify(prefs)) } catch { /* private window: this page only */ }
    listeners.forEach(l => l())
  },
  subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l) } },
}
export const useIslandPrefs = () => useSyncExternalStore(islandPrefs.subscribe, islandPrefs.get)
