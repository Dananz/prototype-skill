// The comments island's preferences, kept per browser like the other reviewer choices: the edge it
// rests on, where along that edge, and which news grows it. It always rests on an edge of the stage:
// flat on the foot or the top (`along` is its centre's offset from the stage's middle), or upright
// on the side (`along` is its top, from the stage's top). `right` is the stage's end, beside the side
// panel: the left in Hebrew. Comments never stand on the other side.
import { useSyncExternalStore } from 'react'

export type Edge = 'bottom' | 'top' | 'right'
export type IslandPrefs = {
  place: Edge; along: number; news: 'all' | 'replies' | 'off'
  /** Sizes dragged by hand, in px: the open list's height and width on the foot or the top, and the panel's width on the right. */
  listH?: number; listW?: number; sideW?: number
  /** The classic layout on a wide screen: the comments are a tab of the side panel, docked to the
   *  stage's end, and the top bar has a Comment button. A phone keeps its bar either way. */
  docked?: boolean
}
const KEY = 'proto-island'
const EDGES: Edge[] = ['bottom', 'top', 'right']
const DEFAULT: IslandPrefs = { place: 'bottom', along: 0, news: 'all' }
const read = (): IslandPrefs => {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null')
    return {
      // The left edge is gone: an island kept there stands on the right instead.
      place: s?.place === 'left' ? 'right' : EDGES.includes(s?.place) ? s.place : 'bottom',
      // Before edges, a flat island kept a free offset `at`: its sideways part still holds.
      along: Number.isFinite(s?.along) ? s.along : Number.isFinite(s?.at?.x) ? s.at.x : 0,
      news: s?.news === 'replies' || s?.news === 'off' ? s.news : 'all',
      ...(s?.docked === true ? { docked: true } : {}),
      ...Object.fromEntries((['listH', 'listW', 'sideW'] as const).filter(k => Number.isFinite(s?.[k])).map(k => [k, s[k]])),
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
