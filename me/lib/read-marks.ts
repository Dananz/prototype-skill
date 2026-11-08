'use client'
// Read: opening a link marks its comments read in this browser only, by the newest comment seen on
// each link (a comment's status is the Mac's: `sent` means sent to Claude, so /me never changes it).
// The same key the host's own /me page keeps, so a browser that used it keeps what it read.
import { useSyncExternalStore } from 'react'
import type { Link, Note } from './types'

const KEY = 'proto-me-read'
type Marks = Record<string, number>
const EMPTY: Marks = {}

let cache: Marks | null = null
const listeners = new Set<() => void>()

function load(): Marks {
  if (cache) return cache
  try { cache = (JSON.parse(localStorage.getItem(KEY) || '{}') as Marks) || {} } catch { cache = {} }
  return cache
}

function subscribe(fn: () => void) {
  listeners.add(fn)
  // Another tab read something.
  const onStorage = (e: StorageEvent) => { if (e.key === KEY) { cache = null; fn() } }
  window.addEventListener('storage', onStorage)
  return () => { listeners.delete(fn); window.removeEventListener('storage', onStorage) }
}

/** The marks; empty on the server and in the first render, so hydration matches. */
export const useReadMarks = () => useSyncExternalStore(subscribe, load, () => EMPTY)

export function markRead(id: string, latest: number) {
  const marks = load()
  if (!latest || (marks[id] ?? 0) >= latest) return
  cache = { ...marks, [id]: latest }
  try { localStorage.setItem(KEY, JSON.stringify(cache)) } catch { /* a private window: this visit only */ }
  for (const fn of listeners) fn()
}

/** The link's new comments, as this browser counts them. */
export const newOf = (l: Link, marks: Marks) => (l.latest && (marks[l.id] ?? 0) >= l.latest ? 0 : l.comments.new)
/** Whether a comment still says New here. */
export const isNew = (n: Note, shareId: string, marks: Marks) => n.status === 'new' && n.created_at > (marks[shareId] ?? 0)
