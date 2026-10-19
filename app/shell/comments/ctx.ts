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
   *  where comments are off (a lobby, all states or autoplay). Compare provides a scope containing both mounts. */
  mount: () => HTMLElement | null
  /** Whether another variant is visible beside the current one in Compare. */
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
  /** An opted-in compare surface can turn a guarded cross-pane press into a reference. */
  onGuardPick?: (el: HTMLElement) => boolean
  onReferenceComment?: (item: Item) => boolean
  /** Posts a batch; resolves the batch's id, and how each decision in it went. */
  send: (batch: CommentBatch) => Promise<Sent>
  /** Takes back a sent comment the user deleted (batch, and its number in it); never throws. */
  withdraw: (batch: string, n: number) => Promise<void>
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
