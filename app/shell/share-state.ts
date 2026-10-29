// What the owner's page knows about this session's share links, outside React: who the owner is on
// the share host (GitHub, signed in or not) and the links with who is in them now. The bar's Share
// button reads it as it is drawn (an amber dot for a link behind its edits, a green count for the
// people in a link now); the popover and the sheet read and refresh it. Both come from the session
// server (/__proto/share/owner and /__proto/share/list, app/share/routes.mjs).
//
// The list is asked for as the page opens, when it gets the focus back, after a link is made or
// updated, and once a minute while the page is in view and the session has a link ("now" is the
// last two minutes on the host). The owner is asked when the popover or the sheet first opens.
import { post } from './transport'

/** A viewer the host saw in a link: `now` while they were in it in the last two minutes. */
export type LinkViewer = { login: string; name: string | null; avatar: string | null; route: string | null; at: number; now?: boolean }
export type ShareRow = {
  id: string; title: string; scope: { protos: { id: string; variants: string[] }[]; start: string }; version: number; publishedAt: string
  note?: string; message?: string | null; host: string; link: string | null; changed: boolean; comments: { total: number; new: number }; live?: boolean | null
  views?: number | null; viewers?: LinkViewer[]; changedVariants?: { key: string; name: string }[]
}
export type Listed = { host: { name: string; stage: string; owner: string } | null; hostError: string | null; shares: ShareRow[]; setup?: string }
/**
 * The owner on the host, as the session server's `owner` answers. signin: whether the host can run
 * GitHub sign-in. status: on a host many people share to, whether the maintainer let them in yet.
 */
export type Owner = { host: string | null; signedIn: boolean; login: string | null; name: string | null; avatar: string | null; signin: boolean; status?: 'active' | 'pending' | 'banned' }
export type Answer = { status: number; body: Record<string, any> }

/**
 * Fix before sharing: the shell's way to send the agent a request from a share review (a comment
 * with action share-fix, on the variant given or the one on screen), and the agent's name for the
 * button. Null until the shell sets it (a shared page has none).
 */
export type ShareAsk = { agent: string; send: (on: { proto: string; variant: string } | null, text: string) => Promise<void> }
let asker: ShareAsk | null = null
export const setShareAsk = (a: ShareAsk | null) => { asker = a }
export const shareAsk = () => asker

/** One of the session server's share routes, never throwing: status 0 when it can't be reached. */
export async function route(name: string, body: Record<string, unknown> = {}): Promise<Answer> {
  try {
    const res = await post(`share/${name}`, body)
    return { status: res.status, body: await res.json().catch(() => ({})) }
  } catch (e) { return { status: 0, body: { error: e instanceof Error ? e.message : String(e) } } }
}

type State = {
  /** undefined until asked (or when the server has no such route: then nothing is gated). */
  owner: Owner | undefined
  listed: Listed | null
  listErr: string
  loading: boolean
}
let state: State = { owner: undefined, listed: null, listErr: '', loading: false }
const subs = new Set<() => void>()
const set = (next: Partial<State>) => { state = { ...state, ...next }; subs.forEach(f => f()) }

export const shareState = {
  get: () => state,
  subscribe(f: () => void) { subs.add(f); return () => { subs.delete(f) } },
}

// Only the latest list answers: an older one arriving late can't put back what a newer one replaced.
let asked = 0
export async function loadList() {
  const n = ++asked
  set({ loading: true })
  const r = await route('list')
  if (n !== asked) return
  if (r.status === 200 && Array.isArray(r.body.shares)) set({ listed: r.body as Listed, listErr: '', loading: false })
  else set({ listErr: r.body.error || `${r.status}`, loading: false })
}

/** A list the sheet asked for itself: the bar's dot and count follow it too. */
export const putListed = (listed: Listed) => { asked++; set({ listed, listErr: '', loading: false }) }

let ownerAsked = 0
/** Who the owner is on the host. refresh: ask the host now rather than the server's minute-old answer. */
export async function loadOwner(refresh = false): Promise<Owner | undefined> {
  const n = ++ownerAsked
  const r = await route('owner', refresh ? { refresh: true } : {})
  if (n !== ownerAsked) return state.owner
  // A server without the route, or one that couldn't ask the host (no token, the host away: `code`),
  // gates nothing: a publish refused for sign-in says so then. No host at all is not signed out either.
  const said = r.status === 200 && typeof r.body.signedIn === 'boolean' && !r.body.code && r.body.host ? r.body as Owner : undefined
  // Signed out is asked of the host itself before the page says so (the server's answer may be a minute old, or a guess).
  if (said && !said.signedIn && !refresh) return loadOwner(true)
  if (said) set({ owner: said })
  return said ?? state.owner
}
/** Whether the owner is known to be signed out of the share host: then a new link starts with signing in. */
export const mustSignIn = (owner: Owner | undefined) => !!owner && !!owner.host && owner.signedIn === false
/** Whether the owner is signed in but not let in to share (yet): then a new link shows why instead. */
export const mustWait = (owner: Owner | undefined) => !!owner?.signedIn && (owner.status === 'pending' || owner.status === 'banned')
/** A publish refused because the owner isn't let in yet (or any more): asked again, it shows why. */
export const notLetIn = () => { void loadOwner(true) }
/** A publish refused because the owner isn't signed in: the owner is signed out, whatever was known. */
export const signedOut = () => set({ owner: { ...(state.owner ?? { host: 'host', login: null, name: null, avatar: null, signin: true }), signedIn: false } })

/** Asks the list now, on focus, and each minute while the page is visible and the session has a link. Returns the stop. */
export function watchShares() {
  const ask = () => { if (document.visibilityState === 'visible') void loadList() }
  void loadList()
  const tick = window.setInterval(() => { if (state.listed?.shares.length) ask() }, 60_000)
  window.addEventListener('focus', ask)
  return () => { clearInterval(tick); window.removeEventListener('focus', ask) }
}

/** Whether a viewer is in the link now: the host marked them so, or saw them in the last two minutes. */
export const isNow = (v: LinkViewer) => v.now ?? Date.now() - v.at < 120_000
/** Who is in a link now. */
export const nowIn = (s: ShareRow) => (s.viewers ?? []).filter(isNow)

/** What the bar's Share button shows: a link behind its edits, and how many people are in the links now. */
export function badge() {
  const shares = state.listed?.shares ?? []
  const people = new Set(shares.flatMap(s => nowIn(s).map(v => v.login)))
  return { behind: shares.some(s => s.changed), now: people.size }
}
