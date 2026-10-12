import { createContext, useContext } from 'react'
import type { CommentBatch, Sent } from '../shell'
import type { Actions } from './actions'
import type { CopyActions, CopyStore } from './copy'
import type { Store } from './store'
import type { ViewSize } from '../view/sizes'

/** What the shell gives the comment layer: where the design is, how to move, how to send. */
export type Host = {
  /** The stage-sized layer the pins, outlines and composer are drawn on. */
  layer: HTMLElement
  /** The mounted design of the variant on screen (in a device view's frame while one is on); null
   *  where comments are off (a lobby, a tool). */
  mount: () => HTMLElement | null
  /** The device view while one is on (view/): its layout (none for the stage's own artboard), and what is under a point of the page in
   *  its frame (the element, and the point in the frame's own px). */
  view?: () => (Partial<ViewSize> & { at: (x: number, y: number) => { el: Element; x: number; y: number } | null }) | null
  /** Shows a comment's layout: its device view, or none. */
  setView?: (v: ViewSize | null) => void
  go: (proto: string, variant: string, state?: string) => void
  /** Posts a batch; resolves the batch's id, and how each decision in it went. */
  send: (batch: CommentBatch) => Promise<Sent>
  /** Takes back a sent comment the user deleted (batch, and its number in it); never throws. */
  withdraw: (batch: string, n: number) => Promise<void>
  dark: () => boolean
}
/** The comment layer's store and actions, and the copy picker's, which sends through it. */
export type Ctx = { store: Store; host: Host; act: Actions; copyStore: CopyStore; copyAct: CopyActions }
export const CommentsCtx = createContext<Ctx>(null as unknown as Ctx)
export const useCtx = () => useContext(CommentsCtx)
