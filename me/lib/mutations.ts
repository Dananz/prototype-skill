'use client'
// Every change on /me shows at once and rolls back if the host refuses it. Each one: cancel the list's
// fetches, note the one value it changes, write the new value into the cache, send it, then on an
// error put back what it noted, and on success take the host's answer. Only that one value is noted
// and put back, never the whole list, and only by the latest change to it: two quick changes to one
// thing (off, then on) can't have the first one's failure undo the second, and a change to another
// link or comment meanwhile is never touched.
import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { send, HostError } from './api'
import { SHARES, type Link, type Note } from './types'

const latest = new Map<string, number>()
const failed = (e: unknown) => {
  if (e instanceof HostError && e.status === 401) return
  toast.error('That didn’t go through. Try again.')
}

type Spec<V, R, P> = {
  /** What this change touches, e.g. `share:<id>:message`: the latest change to it is the one that counts. */
  key: (v: V) => string
  read: (list: Link[], v: V) => P
  write: (list: Link[], v: V, value: P) => Link[]
  next: (v: V) => P
  request: (v: V) => Promise<R>
  /** The host's answer, into the cache. */
  settle?: (list: Link[], v: V, r: R) => Link[]
}

function useOptimistic<V, R, P>(spec: Spec<V, R, P>) {
  const qc = useQueryClient()
  return useMutation({
    mutationKey: ['me'],
    mutationFn: spec.request,
    onMutate: async (v: V) => {
      await qc.cancelQueries({ queryKey: SHARES })
      const list = qc.getQueryData<Link[]>(SHARES) ?? []
      const key = spec.key(v)
      const token = (latest.get(key) ?? 0) + 1
      latest.set(key, token)
      const before = spec.read(list, v)
      edit(qc, l => spec.write(l, v, spec.next(v)))
      return { key, token, before }
    },
    onError: (e, v, ctx) => {
      if (ctx && latest.get(ctx.key) === ctx.token) edit(qc, l => spec.write(l, v, ctx.before))
      failed(e)
    },
    onSuccess: (r, v, ctx) => {
      if (spec.settle && ctx && latest.get(ctx.key) === ctx.token) edit(qc, l => spec.settle!(l, v, r))
    },
  })
}

const edit = (qc: QueryClient, fn: (l: Link[]) => Link[]) => qc.setQueryData<Link[]>(SHARES, l => (l ? fn(l) : l))
const onLink = (list: Link[], id: string, fn: (l: Link) => Link) => list.map(l => (l.id === id ? fn(l) : l))
const onNote = (list: Link[], share: string, id: string, fn: (n: Note) => Note) =>
  onLink(list, share, l => ({ ...l, notes: l.notes.map(n => (n.id === id ? fn(n) : n)) }))
const linkOf = (list: Link[], id: string) => list.find(l => l.id === id)
const noteOf = (list: Link[], share: string, id: string) => linkOf(list, share)?.notes.find(n => n.id === id)

/** The message for viewers: trimmed, at most 280; '' clears it. */
export const useSaveMessage = () =>
  useOptimistic<{ id: string; message: string }, { message: string | null }, string | null>({
    key: v => `share:${v.id}:message`,
    read: (list, v) => linkOf(list, v.id)?.message ?? null,
    write: (list, v, message) => onLink(list, v.id, l => ({ ...l, message })),
    next: v => v.message.trim() || null,
    request: v => send('PATCH', `shares/${v.id}`, { message: v.message.trim() || null }),
    settle: (list, v, r) => onLink(list, v.id, l => ({ ...l, message: r.message ?? null })),
  })

/** Turn off, turn on: the page and its comments stay either way. */
export const useSetOff = () =>
  useOptimistic<{ id: string; off: boolean }, { disabled: boolean }, boolean>({
    key: v => `share:${v.id}:off`,
    read: (list, v) => !!linkOf(list, v.id)?.off,
    write: (list, v, off) => onLink(list, v.id, l => ({ ...l, off, disabled: off })),
    next: v => v.off,
    request: v => send('PATCH', `shares/${v.id}`, { disabled: v.off }),
    settle: (list, v, r) => onLink(list, v.id, l => ({ ...l, off: r.disabled, disabled: r.disabled })),
  })

type NoteAnswer = { owner_reply: string | null; hidden: boolean }

export const useReply = () =>
  useOptimistic<{ share: string; id: string; reply: string }, NoteAnswer, string | null>({
    key: v => `note:${v.share}:${v.id}:reply`,
    read: (list, v) => noteOf(list, v.share, v.id)?.owner_reply ?? null,
    write: (list, v, reply) => onNote(list, v.share, v.id, n => ({ ...n, owner_reply: reply })),
    next: v => v.reply,
    request: v => send('PATCH', `comments/${v.id}`, { share: v.share, reply: v.reply }),
    settle: (list, v, r) => onNote(list, v.share, v.id, n => ({ ...n, owner_reply: r.owner_reply })),
  })

export const useSetHidden = () =>
  useOptimistic<{ share: string; id: string; hidden: boolean }, NoteAnswer, boolean>({
    key: v => `note:${v.share}:${v.id}:hidden`,
    read: (list, v) => !!noteOf(list, v.share, v.id)?.hidden,
    write: (list, v, hidden) => onNote(list, v.share, v.id, n => ({ ...n, hidden })),
    next: v => v.hidden,
    request: v => send('PATCH', `comments/${v.id}`, { share: v.share, hidden: v.hidden }),
    settle: (list, v, r) => onNote(list, v.share, v.id, n => ({ ...n, hidden: r.hidden })),
  })

/**
 * Remove. The one change here with no Undo: the host deletes the page, its comments and its card for
 * good and has no way back, so it asks first (an Alert Dialog, a drawer on a phone) and is the safety
 * exception to Undo. Once confirmed, the link leaves the list at once and comes back where it was if
 * the host refuses.
 */
export const useRemove = () =>
  useOptimistic<{ id: string }, { id: string }, { link: Link; at: number } | null>({
    key: v => `share:${v.id}:removed`,
    read: (list, v) => { const at = list.findIndex(l => l.id === v.id); return at < 0 ? null : { link: list[at], at } },
    write: (list, v, kept) => {
      const rest = list.filter(l => l.id !== v.id)
      if (!kept) return rest
      rest.splice(Math.min(kept.at, rest.length), 0, kept.link)
      return rest
    },
    next: () => null,
    request: v => send('DELETE', `shares/${v.id}`),
  })
