// Small controls a mounted design opts into. Values and defaults belong to that design,
// rather than to the shell, so changing a control uses its current state setter.
import { notify, shared } from './shared'

type Base = { id: string; label: string; note?: string }

export type Tweak = Base & (
  | { kind: 'color'; value: string; defaultValue: string; presets?: { name: string; value: string }[]; set: (value: string) => void }
  | { kind: 'select'; value: string; defaultValue: string; options: string[]; set: (value: string) => void }
  | { kind: 'toggle'; value: boolean; defaultValue: boolean; set: (value: boolean) => void }
)

export const isChanged = (tweak: Tweak) => tweak.value !== tweak.defaultValue

// Setters change on render. Keep the latest ones without redrawing the inspector unless
// the fields it shows changed, as with hints.
const keyOf = (list: Tweak[]) => JSON.stringify(list)

export const tweaks = shared('tweaks', () => {
  const lists = new Map<Element, Tweak[]>()
  const keys = new Map<Element, string>()
  const subs = new Set<() => void>()
  return {
    set(host: Element, list: Tweak[]) {
      const key = keyOf(list), changed = keys.get(host) !== key
      lists.set(host, list)
      keys.set(host, key)
      if (changed) notify(subs)
    },
    drop(host: Element) {
      keys.delete(host)
      if (lists.delete(host)) notify(subs)
    },
    of: (host: Element | null | undefined) => (host && lists.get(host)) || [],
    subscribe(f: () => void) { subs.add(f); return () => { subs.delete(f) } },
    /** Resolve by id at the time of the action, never through a stale render's setter. */
    change(host: Element | null | undefined, id: string, value: unknown) {
      const field = host && lists.get(host)?.find(t => t.id === id)
      if (!field) return false
      if (field.kind === 'toggle') {
        if (typeof value !== 'boolean') return false
        field.set(value)
      } else {
        if (typeof value !== 'string') return false
        if (field.kind === 'select' && !field.options.includes(value)) return false
        if (field.kind === 'color' && !/^#[0-9a-f]{6}$/i.test(value)) return false
        field.set(value)
      }
      return true
    },
    /** Snapshot the initiating host's fields: a setter may immediately publish new state. */
    reset(host: Element | null | undefined, id?: string) {
      const list = host ? [...(lists.get(host) || [])] : []
      for (const field of list) {
        if ((id !== undefined && field.id !== id) || !isChanged(field)) continue
        if (field.kind === 'toggle') field.set(field.defaultValue)
        else field.set(field.defaultValue)
      }
    },
  }
})
