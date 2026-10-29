// The comment layer, as the shell sees it: one store, one set of actions, and the React roots the
// shell places (over the stage, in the side panel, the phone's sheet, the bar's decision menu).
// Everything else the shell needs from it (counts for the bar, the key, Esc) is on what this returns.
import { createRoot } from 'react-dom/client'
import type { Inbox } from '../shell'
import { createActions } from './actions'
import { CommentsCtx, type Ctx, type Host } from './ctx'
import { CopyBar, CopyMarks, CopySheet, createCopyActions, createCopyStore } from './copy'
import { Decide, DecidePop, type DecidePopProps, type Subject } from './decide'
import { Layer } from './layer'
import { ContextPop, type ContextPopProps } from './menu'
import { climb, describe } from './dom'
import { Selection } from './selection'
import { PhoneSheet } from './rail'
import { Island } from './island'
import { watchLinks } from './links'
import { createStore, isRoot, progress, threadOf } from './store'
import { plain } from './ui'
import { inScope, type LinkTray, type Place, type State, type Target, type Item } from './types'

export type { ContextPopProps, DecidePopProps, Place, State, Subject }
export type { MenuRow } from './menu'

export function createComments(host: Host, sessionId: string) {
  const store = createStore(sessionId)
  const act = createActions(store, host)
  // The copy picker and commenting both act on the design, so only one of them is on at a time.
  const copyStore = createCopyStore()
  const copyAct = createCopyActions(copyStore, host, store, () => act.stop())
  const ctx: Ctx = { store, host, act, copyStore, copyAct }
  const wrap = (el: JSX.Element) => <CommentsCtx.Provider value={ctx}>{el}</CommentsCtx.Provider>
  createRoot(host.layer).render(wrap(<><Layer /><Selection /><CopyMarks /></>))
  const api = {
    store,
    /** Reuse this instance from a live prototype rather than creating another comment store. */
    mount: host.mount,
    show: () => host.show?.(),
    mentionVariants(fn: () => Target[]) {
      const previous = host.variantMentions
      host.variantMentions = fn
      return () => { if (host.variantMentions === fn) host.variantMentions = previous }
    },
    referenceComments(fn: (item: Item) => boolean) {
      const previous = host.onReferenceComment
      host.onReferenceComment = fn
      return () => { if (host.onReferenceComment === fn) host.onReferenceComment = previous }
    },
    referenceOnPress(fn: (el: HTMLElement) => boolean) {
      const previous = host.onGuardPick
      host.onGuardPick = fn
      return () => { if (host.onGuardPick === fn) host.onGuardPick = previous }
    },
    hostChanged: () => store.set({}),
    act,
    /** The copy picker (copy.tsx): its state and actions, for the T buttons, Esc and the stage. */
    copy: { store: copyStore, ...copyAct },
    /** Its bar under the stage, and the sheet a phone lists a line's options in (over the stage and the bar). */
    mountCopy(bar: HTMLElement, sheet: HTMLElement) { createRoot(bar).render(wrap(<><CopyBar /><CopySheet container={sheet} /></>)) },
    /** Something drawn in a root of its own (the motion dock) with the comment layer's context. */
    wrap,
    /** The floating comments island over the stage (island.tsx): its bar, its news and, opened, the list.
     *  Docked (Settings), a wide screen draws it in the side panel's Comments tab, `dock`, instead. */
    mountIsland(el: HTMLElement, dock: HTMLElement) { createRoot(el).render(wrap(<Island dock={dock} />)) },
    mountSheet(el: HTMLElement) { createRoot(el).render(wrap(<PhoneSheet />)) },
    /** The bar's Pick, More and Build menu, mounted once; the returned function draws it with new props. */
    mountDecide(el: HTMLElement) { const root = createRoot(el); return (p: DecidePopProps) => root.render(wrap(<DecidePop {...p} />)) },
    /** The right-click menu of everything but a variant (menu.tsx): mounted once, drawn with the rows the shell built. */
    mountContext(el: HTMLElement) { const root = createRoot(el); return (p: ContextPopProps) => root.render(wrap(<ContextPop {...p} />)) },
    /** The same choices for the phone's variant sheet, which renders them in its own root. */
    decideIn: (subject: Subject) => wrap(<Decide key={`${subject.proto}/${subject.variant}`} subject={subject} sheet />),
    /** Comment on an element of the design on the stage (a right-click on it); the layout it is seen in goes with it. */
    commentOn(el: HTMLElement) {
      const mount = host.mount()
      if (!mount || el === mount || !mount.contains(el)) return
      const t = describe(mount, el), v = host.view?.()
      act.begin(v?.size ? { ...t, view: { size: v.size, w: v.w!, h: v.h! } } : t)
    },
    /** Whether an element is part of the design on the stage (not its page's body, nor the root itself). */
    inDesign(el: Element) { const mount = host.mount(); return !!mount && el !== mount && mount.contains(el) && (!mount.hasAttribute('data-comment-compare') || !!el.closest('[data-mount]')) },
    /** The element around one of the design on the stage, if there is one inside it. */
    parentOf(el: HTMLElement): HTMLElement | null { const mount = host.mount(); return mount && mount.contains(el) ? climb(mount, el) : null },
    /** A comment as the list has it (its words as one line), for a menu on it. */
    wordsOf(id: string): string {
      const i = store.get().items.find(x => x.id === id)
      return i ? plain(i) : ''
    },
    setPlace: act.setPlace,
    setInbox(inbox: Inbox | undefined) { store.set({ inbox }) },
    /** The "From links" tray, as the server's `proto:shares` sends it (links.tsx). */
    setLinks(tray: LinkTray) { if (tray && Array.isArray(tray.comments)) store.set({ links: tray }) },
    /** Asks the server for the tray now and on every return to the page; the page that owns the session calls it once. */
    watchLinks: () => watchLinks(store),
    /** Comments waiting to be sent and all of them (those of the prototype on screen), and open (sent, not yet done) ones per variant: for the bar and the tree. */
    counts() {
      const s = store.get()
      const by = new Map<string, number>()
      let drafts = 0, total = 0
      for (const i of s.items) {
        // A thread counts once, as open while its last turn is: a follow-up is no comment of its own.
        if (!isRoot(s.items, i)) continue
        if (inScope(s.scope, i.proto)) { total++; if (!i.sent) drafts++ }
        if (progress(threadOf(s.items, i).at(-1)!, s.inbox).state === 'done') continue
        const k = `${i.proto}/${i.variant}`
        by.set(k, (by.get(k) ?? 0) + 1)
      }
      return { drafts, total, by, picking: s.mode.kind === 'pick' || s.mode.kind === 'tag' || (s.mode.kind === 'time' && !!s.mode.tagging), held: !!s.held && inScope(s.scope, s.held.proto) }
    },
    /** Picking what to comment on (or tag), or writing a comment on the design: the design is only looked at. */
    busy() {
      const m = store.get().mode
      return m.kind === 'pick' || m.kind === 'tag' || m.kind === 'compose' || (m.kind === 'time' && !!m.tagging)
    },
    /** Esc, from the shell's own key handling: true when it put something away. */
    escape(): boolean {
      const s = store.get()
      if (s.sheet) { act.openSheet(false); return true }
      if (s.island && s.mode.kind === 'idle') { act.openIsland(false); return true }
      if (s.mode.kind === 'tag' || (s.mode.kind === 'time' && s.mode.tagging)) { act.tagDone(null); return true }
      if (s.mode.kind !== 'idle' || s.active) { act.close(); return true }
      return false
    },
    /** The phone's comment button: the list if there is one, else straight to picking. */
    tap() {
      const s = store.get()
      if (s.mode.kind !== 'idle') return act.close()
      if (act.inScope().length || (s.held && inScope(s.scope, s.held.proto))) act.openSheet(true)
      else act.toggle()
    },
  }
  registerComments(host.layer.ownerDocument, api)
  return api
}
export type Comments = ReturnType<typeof createComments>


// The stage may live in a same-origin layout iframe. Resolve its owning shell, not the
// framed page's disabled comment instance. The document owns this reference for its lifetime.
const INSTANCE = '__prototypeComments'
function registerComments(doc: Document, comments: Comments) {
  ;(doc as Document & { [INSTANCE]?: Comments })[INSTANCE] = comments
}
export function commentsFor(el: HTMLElement): Comments | null {
  let win: Window | null = el.ownerDocument.defaultView
  while (win) {
    try {
      const comments = (win.document as Document & { [INSTANCE]?: Comments })[INSTANCE]
      if (comments?.mount()?.contains(el)) return comments
      if (win.parent === win) break
      win = win.parent
    } catch { break }
  }
  return null
}
