// What the comment layer can do, shared by the stage, the rail, the bar's button and the keys.
// The flow: Comment turns picking on; a pick opens a composer on the element; Add saves a draft;
// Send posts every draft as one batch. Whatever is being written when the composer is put away
// any way but Cancel or Add is held, and comes back with the next comment.
import type { CommentBatch } from '../shell'
import { climb, describe, find } from './dom'
import { ACTION, plain } from './ui'
import type { Ctx, Host } from './ctx'
import { progress, type Store } from './store'
import type { Action, Draft, Item, Place, Target, Time } from './types'
import { shotsOf } from './types'
import { routeOf } from './types'
import { sameView } from '../view/sizes'

const uid = () => Math.random().toString(36).slice(2, 9)
const hasWords = (d: Draft) => d.body.some(s => typeof s !== 'string' || s.trim()) || d.tags.length > 0 || shotsOf(d).length > 0

export function createActions(store: Store, host: Host) {
  const get = store.get, set = store.set
  const here = (i: Item) => { const p = get().place; return !!p && i.proto === p.proto && i.variant === p.variant && (i.state ?? '') === (p.state ?? '') }
  const act = {
    here,
    /** Comments on what is on screen. */
    onScreen: () => get().items.filter(here),
    drafts: () => get().items.filter(i => !i.sent),

    /** The page moved (or stopped being somewhere comments can go). */
    setPlace(place: Place | null) {
      const was = get().place
      const same = !!place && !!was && place.proto === was.proto && place.variant === was.variant && (place.state ?? '') === (was.state ?? '')
      // Another device view (or none) is another layout: a comment open on the last one is held.
      if (same && !sameView(place!.view, was!.view)) { set(s => ({ place, ...(s.mode.kind === 'compose' || s.mode.kind === 'tag' ? { mode: { kind: 'idle' as const }, pendingTag: null } : {}) })); return }
      if (same) { if (place!.title !== was!.title || place!.phone !== was!.phone) set({ place }); return }
      // A comment half-written stays held (it was kept as it was typed); picking just stops.
      set({ place, mode: { kind: 'idle' }, active: null, pendingTag: null })
    },

    toggle() { if (get().place) set(s => ({ mode: s.mode.kind === 'pick' ? { kind: 'idle' } : { kind: 'pick' }, active: null })) },
    stop() { set({ mode: { kind: 'idle' } }) },
    close() { set({ mode: { kind: 'idle' }, active: null, pendingTag: null }) },
    begin(target: Target) { set({ mode: { kind: 'compose', target }, active: null }) },
    /**
     * Moves the new comment being written up to the element around the one it is on, keeping what
     * was typed; `down` steps back to the element it came up from. A saved comment, or one on a
     * spot, stays where it is.
     */
    parent() {
      const m = get().mode, mount = host.mount()
      if (m.kind !== 'compose' || m.id || m.target.point || !mount) return
      const el = find(mount, m.target), up = el && climb(mount, el)
      if (!up) return
      const t = describe(mount, up)
      set({ mode: { ...m, target: m.target.view ? { ...t, view: m.target.view } : t, trail: [...(m.trail ?? []), m.target] } })
    },
    down() {
      const m = get().mode
      if (m.kind !== 'compose' || !m.trail?.length) return
      set({ mode: { ...m, target: m.trail[m.trail.length - 1], trail: m.trail.slice(0, -1) } })
    },
    /** A comment on a moment or a range of the motion, written in the motion dock. */
    beginTime(time: Time) { set({ mode: { kind: 'time', time }, active: null }) },
    /** Pick an element to tag from the open composer; it comes back to it with the pick. */
    tagPick() { set(s => s.mode.kind === 'compose' ? { mode: { ...s.mode, kind: 'tag' } } : s.mode.kind === 'time' ? { mode: { ...s.mode, tagging: true } } : {}) },
    tagDone(picked: Target | null) {
      set(s => s.mode.kind === 'tag' ? { mode: { ...s.mode, kind: 'compose' }, pendingTag: picked }
        : s.mode.kind === 'time' && s.mode.tagging ? { mode: { ...s.mode, tagging: false }, pendingTag: picked } : {})
    },
    tagTaken() { set({ pendingTag: null }) },
    open(id: string) {
      const i = get().items.find(x => x.id === id)
      if (!i) return
      // A comment on the design shows on the layout it was written on: its device view, or none.
      if (i.target || i.time) host.setView?.(i.target?.view ?? null)
      if (!here(i)) { host.go(i.proto, i.variant, i.state); set({ active: id }); return }
      set({ active: id, mode: i.sent ? { kind: 'idle' } : i.time ? { kind: 'time', time: i.time, id } : i.target ? { kind: 'compose', target: i.target, id } : { kind: 'idle' } })
      if (i.target) find(host.mount(), i.target)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    },
    resume() { const h = get().held; if (h) set({ active: null, mode: h.time ? { kind: 'time', time: h.time } : { kind: 'compose', target: h.target! } }) },
    discardHeld() { set({ held: null }) },
    /** Called as a new comment is written, so it survives being put away. */
    hold(d: Draft, target?: Target, time?: Time) { set({ held: hasWords(d) ? { ...d, ...(time ? { time } : { target }) } : null }) },
    /** Pressing the design while a comment is open: the comment stays where it is and the composer says so. */
    guard() { if (get().mode.kind === 'compose') set(s => ({ nudge: s.nudge + 1 })) },

    save(d: Draft, target: Target | undefined, id?: string, time?: Time) {
      const p = get().place
      if (!p) return
      if (id) set(s => ({ items: s.items.map(i => i.id === id ? { ...i, ...d } : i), held: null, mode: { kind: 'idle' }, active: null }))
      else {
        const n = Math.max(0, ...get().items.filter(i => i.proto === p.proto && i.variant === p.variant).map(i => i.n)) + 1
        const item: Item = { id: uid(), proto: p.proto, variant: p.variant, ...(p.state ? { state: p.state } : {}), n, ...d, ...(time ? { time } : { target }), at: Date.now() }
        set(s => ({ items: [...s.items, item], held: null, mode: { kind: 'idle' }, active: null }))
        // Send as I add: it goes now, and Claude starts on it while the next one is written.
        if (get().live) void act.send()
      }
    },
    setLive(on: boolean) { set({ live: on }) },
    cancel() { set({ held: null, mode: { kind: 'idle' }, active: null, pendingTag: null }) },
    remove(id: string) { act.removeAll([id]) },
    /**
     * Deletes comments from the list, whatever became of them. One sent and not done is taken back
     * from Claude too (the server marks it withdrawn, or drops a batch nobody took yet); a done one,
     * or one whose batch the server no longer lists (an old one that got stuck), only leaves the list.
     * What is open stays open unless it is one of these.
     */
    removeAll(ids: string[]) {
      const gone = new Set(ids), s = get()
      if (!gone.size) return
      const m = s.mode
      const open = (s.active && gone.has(s.active)) || ((m.kind === 'compose' || m.kind === 'tag' || m.kind === 'time') && !!m.id && gone.has(m.id))
      for (const i of s.items) if (gone.has(i.id) && i.sent && progress(i, s.inbox).state !== 'done') void host.withdraw(i.sent.batch, i.sent.i)
      set(x => ({ items: x.items.filter(i => !gone.has(i.id)), ...(open ? { mode: { kind: 'idle' as const }, active: null } : {}) }))
    },

    /** Every draft, as one batch. */
    async send() {
      const drafts = get().items.filter(i => !i.sent)
      if (!drafts.length || get().sending) return
      const phone = get().place?.phone ?? false
      const batch: CommentBatch = {
        theme: host.dark() ? 'dark' : 'light',
        viewport: { w: innerWidth, h: innerHeight, phone },
        comments: drafts.map(i => ({
          route: routeOf(i),
          text: plain(i),
          ...(i.target?.point ? { point: i.target.point } : {}),
          target: i.target,
          // Written in a device view: about that layout.
          ...(i.target?.view ? { view: i.target.view } : {}),
          // On the motion: a moment or a range, in ms of the take, and how long the take is.
          ...(i.time ? { at: i.time.at, ...(i.time.to !== undefined ? { to: i.time.to } : {}), take: i.time.take } : {}),
          ...(i.tags.length ? { tags: i.tags } : {}),
          ...(shotsOf(i).length ? { images: shotsOf(i).map(s => ({ dataUrl: s.src, name: s.pasted ? 'pasted by the user' : 'marked up' })) } : {}),
        })),
      }
      set({ sending: true, error: '' })
      try {
        const { id: batchId } = await host.send(batch)
        const at = new Map(drafts.map((d, k) => [d.id, k + 1]))
        set(s => ({ sending: false, items: s.items.map(i => at.has(i.id) ? { ...i, sent: { batch: batchId, i: at.get(i.id)! } } : i) }))
        // One added while this send was on its way is still a draft: in Send as I add, it follows at once.
        if (get().live && get().items.some(i => !i.sent)) void act.send()
      } catch (e) {
        set({ sending: false, error: e instanceof Error ? e.message : 'Could not send' })
      }
    },
    /**
     * A decision on a variant (Pick, More like this, Build it), sent at once as a batch of its own:
     * a comment with the action and no element, the note as its words. It joins the list as already
     * sent, so it waits with Claude until answered like any comment, and drafts are left for their
     * own send. Throws with the server's reason, also when the batch arrived but a pick in it
     * couldn't be made (it waits with Claude then, saying why).
     */
    async decide(to: { proto: string; variant: string }, action: Action, note = '') {
      const say = ACTION[action].say(to.variant), words = note.trim()
      const sent = await host.send({
        theme: host.dark() ? 'dark' : 'light',
        viewport: { w: innerWidth, h: innerHeight, phone: innerWidth < 640 },
        comments: [{ route: `${to.proto}/${to.variant}`, text: words ? `${say}: ${words}` : say, action }],
      })
      const item: Item = { id: uid(), proto: to.proto, variant: to.variant, n: 0, body: words ? [words] : [], tags: [], action, at: Date.now(), sent: { batch: sent.id, i: 1 } }
      set(s => ({ items: s.items.some(i => i.sent?.batch === sent.id && i.sent.i === 1) ? s.items : [...s.items, item] }))
      const r = sent.results[0]
      if (!r?.failed) return
      if (r.nothing) throw new Error(`${to.variant} isn’t picked any more, so there was nothing to take back.`)
      if (r.marked) throw new Error(`Picked ${to.variant}, but your requests still change the variant they did (${r.failed}). Claude is told.`)
      throw new Error(`Couldn’t ${action === 'pick' ? `pick ${to.variant}` : 'take the pick back'}: ${r.failed}. Claude is told.`)
    },
    clearError() { set({ error: '' }) },
    openSheet(open: boolean) { set({ sheet: open }) },
  }
  return act
}
export type Actions = ReturnType<typeof createActions>
export type { Ctx }
