import { createContext, useContext, useSyncExternalStore } from 'react'
import type { CommentBatch, Sent } from '../shell'
import type { Actions } from './actions'
import type { CopyActions, CopyStore } from './copy'
import type { Store } from './store'
import type { Item, Target } from './types'
import type { ViewSize } from '../view/sizes'

/** What the shell gives the comment layer: where the design is, how to move, how to send. */
export type Host = {
  /** The stage-sized layer the pins, outlines and composer are drawn on. */
  layer: HTMLElement
  /** The mounted design of the variant on screen (in a device view's frame while one is on); null
   *  where comments are off (a lobby, all states or autoplay). Side by side provides a scope containing every pane's mount. */
  mount: () => HTMLElement | null
  /** Whether another variant is visible beside the current one, side by side. */
  visible?: (place: { proto: string; variant: string; state?: string }) => boolean
  /** The device view while one is on (view/): its layout (none for the stage's own artboard), and what is under a point of the page in
   *  its frame (the element, and the point in the frame's own px). */
  view?: () => (Partial<ViewSize> & { at: (x: number, y: number) => { el: Element; x: number; y: number } | null }) | null
  /** Shows a comment's layout: its device view, or none. */
  setView?: (v: ViewSize | null) => void
  go: (proto: string, variant: string, state?: string) => void
  /** Reveals the existing shell Comments panel or phone sheet. */
  show?: () => void
  /** Whole variants available to the native composer’s @ menu. */
  variantMentions?: () => Target[]
  /** Draws a variant live in `el` at that size, as a picture; returns how to let it go. */
  mountThumb?: (el: HTMLElement, proto: string, variant: string, w: number, h: number) => () => void
  /** An opted-in side-by-side surface can turn a guarded cross-pane press into a reference. */
  onGuardPick?: (el: HTMLElement) => boolean
  onReferenceComment?: (item: Item) => boolean
  /** Posts a batch; resolves the batch's id, and how each decision in it went. */
  send: (batch: CommentBatch) => Promise<Sent>
  /** Takes back a sent comment the user deleted (batch, and its number in it); never throws. */
  withdraw: (batch: string, n: number) => Promise<void>
  /** Changes a sent comment the agent has not taken yet; throws with `taken` once it has. */
  edit: (batch: string, n: number, change: { text: string; tags: Target[]; images?: { dataUrl: string; name: string }[] }) => Promise<void>
  agentName?: () => string
  dark: () => boolean
}
/** The comment layer's store and actions, and the copy picker's, which sends through it. */
export type Ctx = { store: Store; host: Host; act: Actions; copyStore: CopyStore; copyAct: CopyActions }
export const CommentsCtx = createContext<Ctx>(null as unknown as Ctx)
export const useCtx = () => useContext(CommentsCtx)

/** Subscribes to session changes as well as inbox changes, without persisting identity in drafts. */
export function useAgentName() {
  const { store, host } = useCtx()
  return useSyncExternalStore(store.subscribe, () => host.agentName?.() ?? 'Agent')
}
