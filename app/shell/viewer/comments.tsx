// The comments on a share, as its viewer has them (decision 20; spec "Viewer comments, from the
// viewer to Claude and back › On the share"). The look is the reference's (viewer-board/C and
// viewer/parts in session f64ced15): the bar grows upward into the comments of the design in view,
// each a card with its author's GitHub face and login, when, the words, a status (Sent, Seen, In
// progress, Done, In the latest version) and the owner's own reply under it. Claude's replies never
// come here: the host has none.
//
// Everything comes from the share's own host (api/comments, X-Proto: 1): read once, then every 20 s
// while the page is visible and on focus, from the host's `now` on, merged by id. A new comment is
// on the list at once under the viewer's own id, which stays with its draft until the host answers:
// sending again (Retry, or the same draft after a reload) uses the same id, which the host stores
// once. One the host refuses (a 4xx) comes off again and its words go back where they were written,
// with the host's reason; one that got no answer stays on the list as not sent, with Retry. Drafts
// stay in this browser until the host has them. Viewer text is only ever text here (React's escaping).
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { t, tn } from '../i18n'
import { ago } from '../ui'
import { shareInfo } from '../mode'
import type { Me } from './header'
import { Icon, iconBtn } from './ui'

/** Where a pin is: the element's stamps and its path inside the design, the point in it (%), and
 *  the view it was made in. null is a comment on the whole design. As the host keeps it. */
export type Target = { src?: string; component?: string; path?: string; x: number; y: number; view: { size: string; w: number; h: number } }
export type Status = 'new' | 'sent' | 'working' | 'done'
/** One comment, as api/comments answers. pending: written here and not yet stored by the host. */
export type Note = {
  id: string; variant: string; body: string; target: Target | null; status: Status
  owner_reply: string | null; owner_reply_at: number | null
  author: { login: string | null; name: string | null; avatar: string | null }
  mine: boolean; created_at: number; updated_at: number; version: number; done_in: number | null
  /** Written here and not yet stored by the host. */
  pending?: boolean
  /** Sent, and no answer came (the network, or the host failed): Retry sends it again under the same id. */
  failed?: boolean
}

/** A host to talk to: the page came over http(s). A share opened from disk has none. */
export const hosted = /^https?:$/.test(location.protocol)

const call = async (path: string, init?: RequestInit) => {
  const r = await fetch(path, { ...init, cache: 'no-store', headers: { 'X-Proto': '1', ...(init?.body ? { 'content-type': 'application/json' } : {}) } })
  let body: unknown = null
  try { body = await r.json() } catch { /* no body */ }
  return { ok: r.ok, status: r.status, body: body as Record<string, unknown> | null }
}

/** A random UUID, also where the page isn't a secure context (crypto.randomUUID is missing there). */
export function uuid() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const b = crypto.getRandomValues(new Uint8Array(16))
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

/** The host's reason for refusing a comment, in the page's language. */
function reason(code: unknown) {
  if (code === 'too_long') return t('A comment is at most 4,000 characters.')
  if (code === 'hour') return t("You've written 30 comments this hour. Try again in a while.")
  if (code === 'day') return t('This link has had 300 comments today. Try again tomorrow.')
  if (code === 'signin') return t('Sign in with GitHub to comment.')
  if (code === 'comments_off') return t('Comments are off for this link.')
  return t("Couldn't send. Try again")
}

/* ---------------------------------------------------------------- this browser: drafts, the note shown once */

const DRAFTS = 'proto-viewer-drafts', TOLD = 'proto-viewer-told'
const read = (k: string) => { try { return localStorage.getItem(k) } catch { return null } }
const write = (k: string, v: string | null) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v) } catch { /* private mode: this load only */ } }
/** A draft per link and design (and one for the pin being written), kept in this browser, with the
 *  id it was sent under while the host hasn't said it has it. */
type Draft = { text: string; id?: string }
const allDrafts = (): Record<string, Draft> => {
  try {
    const all = JSON.parse(read(DRAFTS) || '{}') as Record<string, Draft | string>
    return Object.fromEntries(Object.entries(all).map(([k, v]) => [k, typeof v === 'string' ? { text: v } : v]))
  } catch { return {} }
}
const saveDrafts = (all: Record<string, Draft>) => write(DRAFTS, Object.keys(all).length ? JSON.stringify(all) : null)
export const drafts = {
  key: (variant: string, pin = false) => `${location.pathname}|${variant}${pin ? '|pin' : ''}`,
  get: (key: string) => allDrafts()[key]?.text ?? '',
  /** The id this draft was sent under, while the host hasn't answered for it. */
  id: (key: string) => allDrafts()[key]?.id,
  /** New words drop the id (they are a new comment); `id` keeps the one they were sent under. */
  set(key: string, text: string, id?: string) {
    const all = allDrafts()
    if (text) all[key] = id ? { text, id } : { text }; else delete all[key]
    saveDrafts(all)
  },
  /** The host has the comment sent under id: its draft goes. */
  done(id: string) {
    const all = allDrafts()
    for (const [k, v] of Object.entries(all)) if (v.id === id) delete all[k]
    saveDrafts(all)
  },
  /** The host refused the comment sent under id: its draft stays, as a new comment next time. */
  forget(id: string) {
    const all = allDrafts()
    for (const v of Object.values(all)) if (v.id === id) delete v.id
    saveDrafts(all)
  },
}

/** What a send came to: stored; refused for good (a 4xx, with the host's reason); or no answer (kept, to retry). */
export type Sent = { ok: true } | { ok: false; refused: boolean; why: string }

/* ---------------------------------------------------------------- the comments, from the host */

/**
 * The link's comments. on: there is a host and the viewer's identity is known (me not undefined);
 * a sign in or out reads them again (`mine` changes). fresh(id): written since the page opened.
 */
export function useNotes(on: boolean, me: Me | null | undefined) {
  const [notes, setNotes] = useState<Note[]>([])
  const first = useRef<Set<string> | null>(null)
  const since = useRef(0)
  const [told, setTold] = useState(() => read(TOLD) === '1')
  const load = useCallback(async () => {
    const from = since.current
    const r = await call(from ? `api/comments?since=${from}` : 'api/comments').catch(() => null)
    if (!r?.ok || !r.body || !Array.isArray(r.body.comments)) return
    const got = r.body.comments as Note[], removed = Array.isArray(r.body.removed) ? r.body.removed as string[] : []
    since.current = typeof r.body.now === 'number' ? r.body.now : Date.now()
    if (!first.current) first.current = new Set(got.map(n => n.id))
    setNotes(list => {
      // A poll that brings nothing new leaves the list as it was (no new array, no redraw).
      if (from && !removed.some(id => list.some(n => n.id === id))
        && got.every(n => { const o = list.find(x => x.id === n.id); return o && !o.pending && !o.failed && o.updated_at === n.updated_at })) return list
      const m = new Map((from ? list : list.filter(n => n.pending || n.failed)).map(n => [n.id, n]))
      for (const n of got) m.set(n.id, n)
      for (const id of removed) m.delete(id)
      return [...m.values()].sort((a, b) => a.created_at - b.created_at)
    })
    if (got.some(n => n.mine)) { setTold(true); write(TOLD, '1') }
  }, [])
  useEffect(() => {
    if (!on || me === undefined) return
    since.current = 0
    void load()
    const look = () => { if (document.visibilityState === 'visible') void load() }
    const every = setInterval(look, 20_000)
    addEventListener('focus', look)
    document.addEventListener('visibilitychange', look)
    return () => { clearInterval(every); removeEventListener('focus', look); document.removeEventListener('visibilitychange', look) }
  }, [on, me, load])

  /**
   * Writes a comment under `id` (the same id again for a retry: the host stores it once). On the list
   * at once; a 4xx takes it off (refused, with the host's reason); no answer leaves it there as failed.
   */
  const add = async (id: string, variant: string, body: string, target: Target | null): Promise<Sent> => {
    const now = Date.now()
    const note: Note = {
      id, variant, body, target, status: 'new', owner_reply: null, owner_reply_at: null,
      author: { login: me?.login ?? null, name: me?.name ?? null, avatar: me?.avatar ?? null }, mine: true,
      created_at: now, updated_at: now, version: shareInfo?.version ?? 1, done_in: null, pending: true,
    }
    setNotes(l => (l.some(n => n.id === id) ? l.map(n => (n.id === id ? { ...n, pending: true, failed: false } : n)) : [...l, note]))
    const r = await call('api/comments', { method: 'POST', body: JSON.stringify({ id, variant, body, target }) }).catch(() => null)
    if (r?.ok && r.body && r.body.id === id) {
      setNotes(l => l.map(n => (n.id === id ? r.body as unknown as Note : n)))
      drafts.done(id)
      setTold(true); write(TOLD, '1')
      return { ok: true }
    }
    if (r && r.status >= 400 && r.status < 500 && r.status !== 408) {
      setNotes(l => l.filter(n => n.id !== id))
      return { ok: false, refused: true, why: reason(r.body?.code) }
    }
    setNotes(l => l.map(n => (n.id === id ? { ...n, pending: false, failed: true } : n)))
    return { ok: false, refused: false, why: t("Couldn't send. Try again") }
  }
  /** Sends a comment that got no answer again, under its own id. */
  const retry = async (id: string): Promise<string | null> => {
    const n = notes.find(x => x.id === id)
    if (!n) return null
    const r = await add(n.id, n.variant, n.body, n.target)
    if (r.ok) return null
    // Refused for good: the card went; a draft still holding its words sends them under a new id.
    if (r.refused) drafts.forget(id)
    return r.why
  }
  /** Deletes the viewer's own comment while it is new; null when it went, else why not. */
  const remove = async (id: string): Promise<string | null> => {
    const was = notes.find(n => n.id === id)
    // One that never reached the host only leaves this page.
    if (was?.failed) { setNotes(l => l.filter(n => n.id !== id)); drafts.done(id); return null }
    setNotes(l => l.filter(n => n.id !== id))
    const r = await call(`api/comments/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => null)
    if (r?.ok) return null
    if (was) setNotes(l => [...l, was].sort((a, b) => a.created_at - b.created_at))
    return t("Couldn't delete it. Try again")
  }
  const fresh = (id: string) => !!first.current && !first.current.has(id)
  return { notes, add, retry, remove, fresh, told }
}

/* ---------------------------------------------------------------- what the viewer's parts share about comments */

/** A pin being placed: the id its comment will have, on which design, where, and in which view of it (the desk under the full view has the same design). */
export type Placing = { id: string; variant: string; target: Target; where: 'desk' | 'full' | 'phone' }
export type Talk = {
  /** A host to talk to. */
  hosted: boolean
  /** write: comments on and signed in; signin: on, signed out; off: not set up for this link. */
  can: 'write' | 'signin' | 'off'
  signIn: string | null
  owner: string
  me: Me | null | undefined
  notes: Note[]
  fresh: (id: string) => boolean
  told: boolean
  add: (id: string, variant: string, body: string, target: Target | null) => Promise<Sent>
  retry: (id: string) => Promise<string | null>
  remove: (id: string) => Promise<string | null>
  /** The bar grown into the comments. */
  open: boolean; setOpen: (o: boolean) => void
  /** The comment lit (its card and its pin). */
  active: string | null; setActive: (id: string | null) => void
  /** Pin mode: the next click on the design places a pin there. */
  pinMode: boolean; setPinMode: (on: boolean) => void
  /** The pin placed and being written. */
  placing: Placing | null; setPlacing: (p: Placing | null) => void
  /** Whether the open full view's design can be reached (same origin): pins need it. */
  reach: boolean
  /** A pin pressed (on the desk, in the full view or on a phone). */
  onPin: (n: Note) => void
  /** Bring a comment's pin into view; at changes each time it is asked. */
  seek: { id: string; at: number } | null
  seekTo: (id: string) => void
  /** Pins whose element is gone from the design as it is drawn now (the spot changed). */
  lost: Set<string>
  /** A pin layer says which of its pins are lost. */
  setLost: (layer: string, ids: string[]) => void
}
export const TalkCtx = createContext<Talk | null>(null)
export const useTalk = () => useContext(TalkCtx)!

/** The comments on one design, oldest first, and the number of each pinned one. */
export function ofDesign(notes: Note[], variant: string) {
  const here = notes.filter(n => n.variant === variant)
  const num = new Map<string, number>()
  here.filter(n => n.target).forEach((n, k) => num.set(n.id, k + 1))
  return { here, num }
}

/* ---------------------------------------------------------------- small pieces */

/** A commenter's GitHub picture, or the first letter of their login when there is none or it doesn't load. */
export function Face({ who, size = 20, ring = false }: { who: Note['author'] | Me; size?: number; ring?: boolean }) {
  const cls = `inline-grid shrink-0 place-items-center overflow-hidden rounded-full bg-zinc-200 text-[10px] font-semibold text-zinc-600 dark:bg-zinc-700 dark:text-zinc-200 ${ring ? 'ring-2 ring-white dark:ring-zinc-900' : ''}`
  const style = { width: size, height: size }
  const [broken, setBroken] = useState<string | null>(null)
  return who.avatar && broken !== who.avatar
    ? <img data-face src={who.avatar} alt="" referrerPolicy="no-referrer" style={style} className={cls} onError={() => setBroken(who.avatar)} />
    : <span data-face aria-hidden="true" style={style} className={cls}>{((who.login || '?')[0] ?? '?').toUpperCase()}</span>
}

const TONE = {
  sending: 'text-zinc-400 dark:text-zinc-500',
  failed: 'text-red-600 dark:text-red-400',
  sent: 'text-zinc-500 dark:text-zinc-400',
  seen: 'text-zinc-600 dark:text-zinc-300',
  working: 'text-amber-600 dark:text-amber-400',
  done: 'text-emerald-600 dark:text-emerald-400',
}
/** Sent → Seen → In progress → Done → In the latest version (after the update that has it). */
export function StatusChip({ n }: { n: Note }) {
  const [label, tone, icon] = n.failed ? [t('Not sent'), TONE.failed, 'circle' as const]
    : n.pending ? [t('Sending…'), TONE.sending, 'circle' as const]
    : n.status === 'new' ? [t('Sent'), TONE.sent, 'circle' as const]
    : n.status === 'sent' ? [t('Seen'), TONE.seen, 'seen' as const]
    : n.status === 'working' ? [t('In progress'), TONE.working, 'working' as const]
    : n.done_in ? [t('In the latest version'), TONE.done, 'done' as const]
    : [t('Done'), TONE.done, 'done' as const]
  return <span className={`inline-flex items-center gap-1 text-[11px] font-medium ${tone}`}><Icon name={icon} className="size-3" /><span data-status>{label}</span></span>
}

/** A comment's number on its pin and in its card. */
export function PinNumber({ n, active = false }: { n: number; active?: boolean }) {
  return <span className={`grid size-5 shrink-0 place-items-center rounded-full text-[10px] font-bold text-white ${active ? 'bg-sky-500' : 'bg-zinc-900 dark:bg-zinc-600'}`}>{n}</span>
}

/** One comment: who, when, the words, its status, the owner's reply; Delete on one's own while it is
 *  new; Retry on one that got no answer. lost: its pin's element is gone from the design. */
export function CommentCard({ n, num, active, owner, lost, onShow, onDelete, onRetry }: {
  n: Note; num?: number; active: boolean; owner: string; lost: boolean; onShow: () => void; onDelete: () => void; onRetry: () => void
}) {
  const name = n.author.login || n.author.name || '?'
  return (
    <article data-comment-card={n.id} onClick={onShow}
      className={`group/card cursor-default rounded-xl p-3 text-start transition-colors motion-reduce:transition-none ${active ? 'bg-sky-500/10 ring-1 ring-sky-500/40' : 'hover:bg-zinc-900/[.04] dark:hover:bg-white/[.04]'}`}>
      <div className="flex items-center gap-2">
        {num !== undefined && (
          <button onClick={e => { e.stopPropagation(); onShow() }} aria-label={t('Show pin {n} on the design', { n: num })} className="rounded-full"><PinNumber n={num} active={active} /></button>
        )}
        <Face who={n.author} />
        <span dir="ltr" className="min-w-0 truncate text-[13px] font-semibold text-zinc-900 dark:text-zinc-100">{name}</span>
        {n.mine && <span className="shrink-0 text-[12px] text-zinc-400">{t('(you)')}</span>}
        <span className="ms-auto shrink-0 text-[11px] text-zinc-400">{n.pending ? '' : ago(n.created_at)}</span>
      </div>
      <p data-comment-body dir="auto" className="mt-1.5 whitespace-pre-wrap break-words text-[13px] leading-snug text-zinc-700 dark:text-zinc-300">{n.body}</p>
      {lost && <p data-lost className="mt-1 text-[11.5px] text-zinc-500 dark:text-zinc-400">{t('The spot changed')}</p>}
      <div className="mt-2 flex items-center gap-2">
        <StatusChip n={n} />
        {n.failed && (
          <button data-retry onClick={e => { e.stopPropagation(); onRetry() }}
            className="inline-flex h-6 items-center rounded-md px-1.5 text-[11px] font-medium text-sky-600 hover:bg-sky-500/10 dark:text-sky-400">{t('Retry')}</button>
        )}
        {n.mine && n.status === 'new' && !n.pending && (
          <button data-delete onClick={e => { e.stopPropagation(); onDelete() }} title={t('Delete comment')} aria-label={t('Delete comment')}
            className="ms-auto inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[11px] text-zinc-500 hover:bg-zinc-900/5 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-zinc-100">
            <Icon name="trash" className="size-3.5" />{t('Delete')}
          </button>
        )}
      </div>
      {n.owner_reply && (
        <div data-owner-reply className="mt-2.5 flex gap-2 border-s-2 border-zinc-200 ps-2.5 dark:border-white/10">
          <Face who={{ login: owner, name: owner, avatar: null }} size={18} />
          <p dir="auto" className="min-w-0 whitespace-pre-wrap break-words text-[12.5px] leading-snug text-zinc-600 dark:text-zinc-400"><span className="font-semibold text-zinc-800 dark:text-zinc-200">{owner}</span> {n.owner_reply}</p>
        </div>
      )}
    </article>
  )
}

/** A comment written since the page opened opens its own height from nothing, fading and rising in (280 ms). */
export function Grow({ fresh, children }: { fresh: boolean; children: ReactNode }) {
  const [shown, setShown] = useState(!fresh)
  useEffect(() => {
    if (shown) return
    let b = 0
    const a = requestAnimationFrame(() => { b = requestAnimationFrame(() => setShown(true)) })
    return () => { cancelAnimationFrame(a); cancelAnimationFrame(b) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return (
    <div className={`grid transition-[grid-template-rows,opacity,translate] duration-[280ms] ease-[cubic-bezier(.2,.8,.2,1)] motion-reduce:transition-none ${shown ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] translate-y-2 opacity-0'}`}>
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  )
}

/* ---------------------------------------------------------------- the bar's comments: the list it grows into, its comment row */

/** What the bar knows of the design in view. */
export type Here = { variant: string; n: number; name: string; about?: string }

/**
 * The comments of the design in view, the part of the bar that grows upward (230 ms, the
 * grid-rows transition): how many and who sees them, the owner's note for the design, the cards.
 * wide: the desk's bar (its first line counts); else a phone's sheet (its first line names the design).
 */
export function Panel({ here, wide, list }: { here: Here; wide: boolean; list: RefObject<HTMLDivElement | null> }) {
  const talk = useTalk()
  const { here: notes, num } = ofDesign(talk.notes, here.variant)
  const [error, setError] = useState('')
  useEffect(() => setError(''), [here.variant, talk.open])
  // The comment asked for is lit and scrolled into the list (only the list scrolls).
  useEffect(() => {
    if (!talk.open || !talk.active) return
    const id = requestAnimationFrame(() => {
      const el = list.current?.querySelector<HTMLElement>(`[data-comment-card="${CSS.escape(talk.active!)}"]`)
      if (el && list.current) list.current.scrollTo({ top: el.offsetTop - 6, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
    })
    return () => cancelAnimationFrame(id)
  }, [talk.open, talk.active, here.variant, list])
  const count = notes.length
  return (
    <div inert={!talk.open} aria-hidden={!talk.open}
      className={`grid transition-[grid-template-rows] duration-[230ms] ease-[cubic-bezier(.2,.8,.2,1)] motion-reduce:transition-none ${talk.open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
      <div className="min-h-0 overflow-hidden">
        <section data-comments aria-label={t('Comments on #{n} {name}', { n: here.n, name: here.name })} className="flex flex-col"
          style={{ maxHeight: wide ? 'min(470px, calc(var(--rh, 800px) * .66 - 104px))' : 'calc(var(--rh, 800px) * .7 - 104px)' }}>
          <div className="flex shrink-0 items-center gap-2 ps-2.5 pe-0.5 pt-0.5 pb-1.5">
            <p className="min-w-0 flex-1 truncate text-[12.5px] text-zinc-500 dark:text-zinc-400">
              {wide
                ? <><span className="font-semibold text-zinc-900 dark:text-zinc-100">{count ? tn(count, '{n} comment', '{n} comments') : t('No comments yet')}</span> · {t('everyone on this link sees them')}</>
                : <><span className="text-zinc-400 tabular-nums">#{here.n}</span> <span className="font-semibold text-zinc-900 dark:text-zinc-100">{here.name}</span> · {count ? tn(count, '{n} comment', '{n} comments') : t('no comments')}</>}
            </p>
            <button onClick={() => talk.setOpen(false)} className={iconBtn} aria-label={t('Close comments')} title={t('Close (Esc)')}><Icon name="close" /></button>
          </div>
          {here.about && (
            <p dir="auto" className="mx-1.5 mb-1.5 shrink-0 rounded-xl bg-zinc-900/[.04] px-3 py-2 text-[12.5px] leading-snug text-zinc-600 dark:bg-white/[.05] dark:text-zinc-400">
              <span className="font-semibold text-zinc-800 dark:text-zinc-200">{talk.owner || t('The owner')}:</span> {here.about}
            </p>
          )}
          <div ref={list} className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {count
              ? notes.map(c => (
                <Grow key={c.id} fresh={talk.fresh(c.id)}>
                  <CommentCard n={c} num={num.get(c.id)} active={talk.active === c.id} owner={talk.owner} lost={talk.lost.has(c.id)}
                    onShow={() => { talk.setActive(c.id); if (c.target) talk.seekTo(c.id) }}
                    onDelete={() => { void talk.remove(c.id).then(e => setError(e ?? '')) }} onRetry={() => { void talk.retry(c.id).then(e => setError(e ?? '')) }} />
                </Grow>
              ))
              : <p className="px-3 py-6 text-center text-[13px] text-zinc-500">{t('Nothing on #{n} yet. Say what you think.', { n: here.n })}</p>}
          </div>
          {error && <p role="alert" className="mx-2.5 mt-1 shrink-0 text-[12px] text-red-600 dark:text-red-400">{error}</p>}
          {talk.can === 'write' && !talk.told && (
            <p data-told className="mx-2.5 mt-1.5 shrink-0 text-[12px] leading-snug text-zinc-500 dark:text-zinc-400">{t('Everyone with this link sees your name and comments.')}</p>
          )}
        </section>
        <div className="mx-1.5 mt-1.5 mb-1 border-t border-zinc-200 dark:border-white/10" />
      </div>
    </div>
  )
}

/**
 * The bar's comment row: the field ("Comment on #n…", one field that looks the same folded and
 * grown; a comment on the whole design), or, signed out, the way to sign in; then the Comment
 * toggle where pins can be placed (the full view, a phone), and the commenters' faces with the count.
 * Comments not set up for the link: no field, the comments already on it still show.
 */
export function Foot({ here, pins, onSent }: { here: Here; pins: boolean; onSent: () => void }) {
  const talk = useTalk()
  const notes = talk.notes.filter(n => n.variant === here.variant)
  const people = [...new Map(notes.map(n => [n.author.login ?? n.id, n.author])).values()].slice(0, 2)
  if (!talk.hosted) return null
  const grow = (type: boolean) => {
    talk.setOpen(true)
    if (type) setTimeout(() => document.querySelector<HTMLInputElement>('[data-comment-field]')?.focus({ preventScroll: true }), 30)
  }
  return (
    <div data-comment-foot className="flex shrink-0 items-center gap-1.5">
      {talk.can === 'write'
        ? <Field here={here} onFocus={() => { if (!talk.open) grow(false) }} onSent={onSent} />
        : talk.can === 'signin' && talk.signIn
        ? <a data-comment-signin href={talk.signIn}
            className="flex h-11 min-w-0 flex-1 items-center gap-2.5 rounded-[18px] bg-zinc-900/[.05] px-4 text-[14px] text-zinc-600 transition-colors hover:bg-zinc-900/[.08] hover:text-zinc-900 motion-reduce:transition-none dark:bg-white/[.07] dark:text-zinc-300 dark:hover:bg-white/10 dark:hover:text-zinc-100">
            <Icon name="github" className="size-4" /><span className="truncate">{t('Sign in with GitHub to comment')}</span>
          </a>
        : <div className="flex-1" />}
      {pins && talk.can === 'write' && <PinToggle />}
      <button data-comments-toggle onClick={() => (talk.open ? talk.setOpen(false) : grow(false))} aria-expanded={talk.open}
        aria-label={talk.open ? t('Hide comments') : tn(notes.length, '{n} comment on #{v}', '{n} comments on #{v}', { v: here.n })}
        className="flex h-11 shrink-0 items-center gap-1.5 rounded-[18px] px-3 text-[13px] text-zinc-600 transition-colors hover:bg-zinc-900/5 motion-reduce:transition-none dark:text-zinc-300 dark:hover:bg-white/10">
        {people.length > 0
          ? <span className="flex -space-x-1">{people.map((p, k) => <Face key={k} who={p} ring />)}</span>
          : <Icon name="chat" className="size-4" />}
        <span className="tabular-nums">{notes.length}</span>
        <Icon name="caret-down" className={`size-3 transition-transform duration-200 motion-reduce:transition-none ${talk.open ? '' : 'rotate-180'}`} />
      </button>
    </div>
  )
}

/** Pin mode, on and off (C in the full view). Off where the design can't be reached (a frame from disk). */
function PinToggle() {
  const talk = useTalk()
  const wide = innerWidth >= 640
  const off = !talk.reach
  return (
    <button data-pin-toggle type="button" disabled={off} aria-pressed={talk.pinMode} onClick={() => talk.setPinMode(!talk.pinMode)}
      title={off ? t("This view can't reach the design: comments here are read-only.") : t('Comment on a spot (C)')} aria-label={t('Comment on a spot')}
      className={`flex h-11 shrink-0 items-center gap-1.5 rounded-[18px] px-3 text-[13px] font-medium transition-colors disabled:opacity-40 motion-reduce:transition-none ${talk.pinMode ? 'bg-sky-500/15 text-sky-600 dark:text-sky-400' : 'text-zinc-600 hover:bg-zinc-900/5 dark:text-zinc-300 dark:hover:bg-white/10'}`}>
      <Icon name="chat-dots" className="size-4" />{wide && <span>{t('Comment')}</span>}
    </button>
  )
}

/** The field: Enter sends a comment on the whole design. Its words stay stored, with the id they went
 *  under, until the host has them; a refused one comes back into the field with the host's reason. */
function Field({ here, onFocus, onSent }: { here: Here; onFocus: () => void; onSent: () => void }) {
  const talk = useTalk()
  const key = drafts.key(here.variant)
  const [text, setText] = useState(() => drafts.get(key))
  const [error, setError] = useState('')
  useEffect(() => { setText(drafts.get(key)); setError('') }, [key])
  const change = (v: string) => { setText(v); drafts.set(key, v); if (error) setError('') }
  const send = async () => {
    const body = text.trim()
    if (!body) return
    const id = drafts.id(key) ?? uuid()
    drafts.set(key, body, id)
    setText(''); setError('')
    onSent()
    const r = await talk.add(id, here.variant, body, null)
    if (r.ok) return
    if (r.refused) { setText(body); drafts.set(key, body); setError(r.why) }
    else setError(r.why)
  }
  return (
    <div className="relative flex min-w-0 flex-1 flex-col">
      {error && <p data-comment-error role="alert" className="absolute bottom-full mb-1.5 ps-3 text-[12px] text-red-600 dark:text-red-400">{error}</p>}
      <form onSubmit={e => { e.preventDefault(); void send() }}
        className="flex h-11 min-w-0 items-center gap-2.5 rounded-[18px] bg-zinc-900/[.05] ps-4 pe-1.5 transition-colors focus-within:bg-zinc-900/[.08] hover:bg-zinc-900/[.08] motion-reduce:transition-none dark:bg-white/[.07] dark:focus-within:bg-white/10 dark:hover:bg-white/10">
        <Icon name="chat-text" className="size-4 text-sky-500" />
        <input data-comment-field value={text} onChange={e => change(e.target.value)} onFocus={onFocus} onClick={onFocus} dir="auto"
          placeholder={t('Comment on #{n}…', { n: here.n })} aria-label={t('Comment on #{n}', { n: here.n })}
          className="h-full min-w-0 flex-1 bg-transparent text-[14px] text-zinc-900 outline-none placeholder:text-zinc-500 dark:text-zinc-100 dark:placeholder:text-zinc-400" />
        {talk.open && text.trim() && (
          <button aria-label={t('Send to {owner}', { owner: talk.owner || t('the owner') })} title={t('Send to {owner}', { owner: talk.owner || t('the owner') })}
            className="grid size-8 shrink-0 place-items-center rounded-full bg-sky-500 text-white"><Icon name="send" className="size-4" /></button>
        )}
      </form>
    </div>
  )
}
