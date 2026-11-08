// What the share host's /me API answers (host/lib/me.mjs): who is signed in, and their links shaped
// as the page shows them. The host owns this logic; the types only describe it.

export type MeState = 'owner' | 'none' | 'pending' | 'banned'

export type Me = {
  login: string
  name: string | null
  avatar: string | null
  state: MeState
  /** The host's own name, as links print it: prtype.dev. */
  base: string
  /** Where its links live: https://prtype.dev. */
  origin: string
}

export type Face = { login?: string | null; name?: string | null; avatar?: string | null }

export type Note = {
  id: string
  share: { id: string; title: string; version: number }
  variant: string | null
  body: string
  /** The Mac's: new, sent, done. /me never changes it. */
  status: string
  owner_reply: string | null
  hidden: boolean
  author: Face
  created_at: number
  /** "2 min ago", as of the answer. */
  ago: string
}

export type Link = {
  id: string
  title: string
  version: number
  updatedAt: number
  expiresAt: number | null
  message: string | null
  disabled: boolean
  off: boolean
  views: number
  project: string | null
  comments: { total: number; new: number }
  designs: number
  card: boolean
  notes: Note[]
  daysLeft: number | null
  now: (Face & { at: number }) | null
  last: (Face & { at: number }) | null
  /** The newest comment's time: what reading the link marks as read. */
  latest: number
  words: { expiry: string; updated: string; last: string | null; exact: string }
}

export const MESSAGE_MAX = 280
export const REPLY_MAX = 4000
export const SHARES = ['shares'] as const
