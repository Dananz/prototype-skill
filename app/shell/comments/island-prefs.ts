// The comments island's preferences, kept per browser like the other reviewer choices: where it
// rests (the foot or the top of the stage), which news grows it, and where it was dragged to.
import { useSyncExternalStore } from 'react'

export type IslandPrefs = { place: 'bottom' | 'top'; news: 'all' | 'replies' | 'off'; at: { x: number; y: number } }
const KEY = 'proto-island'
const DEFAULT: IslandPrefs = { place: 'bottom', news: 'all', at: { x: 0, y: 0 } }
const read = (): IslandPrefs => {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null')
    return {
      place: s?.place === 'top' ? 'top' : 'bottom',
      news: s?.news === 'replies' || s?.news === 'off' ? s.news : 'all',
      at: Number.isFinite(s?.at?.x) && Number.isFinite(s?.at?.y) ? { x: s.at.x, y: s.at.y } : { x: 0, y: 0 },
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
