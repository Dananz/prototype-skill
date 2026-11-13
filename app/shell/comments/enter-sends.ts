// Enter sends: a reviewer's choice, kept per browser. Off, Enter starts a new line and Mod Enter sends,
// as before. On, Enter alone sends too, and Shift Enter starts the new line.
import { useSyncExternalStore } from 'react'
import { MOD } from './ui'

const KEY = 'proto-enter-sends'
const read = () => { try { return localStorage.getItem(KEY) === '1' } catch { return false } }
let on = read()
const listeners = new Set<() => void>()
export const enterSends = {
  get: () => on,
  set(value: boolean) {
    on = value
    try { localStorage.setItem(KEY, value ? '1' : '0') } catch { /* private window: this page only */ }
    listeners.forEach(l => l())
  },
  subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l) } },
}
export const useEnterSends = () => useSyncExternalStore(enterSends.subscribe, enterSends.get)

type Key = { key: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; nativeEvent?: { isComposing?: boolean }; isComposing?: boolean }
/** Whether this key sends: Mod Enter always, and Enter alone (no Shift or Alt) while Enter sends is on. */
export const isSendKey = (e: Key) =>
  e.key === 'Enter' && !(e.nativeEvent?.isComposing ?? e.isComposing) &&
  (e.metaKey || e.ctrlKey || (on && !e.shiftKey && !e.altKey))
/** The send key as a hint shows it. */
export const sendKeyLabel = () => on ? 'Enter' : `${MOD} Enter`
