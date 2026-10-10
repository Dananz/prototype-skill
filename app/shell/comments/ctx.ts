import { createContext, useContext } from 'react'
import type { CommentBatch, Sent } from '../shell'
import type { Actions } from './actions'
import type { CopyActions, CopyStore } from './copy'
import type { Store } from './store'

/** What the shell gives the comment layer: where the design is, how to move, how to send. */
export type Host = {
  /** The stage-sized layer the pins, outlines and composer are drawn on. */
  layer: HTMLElement
  /** The mounted design of the variant on screen; null where comments are off (a lobby, a tool). */
  mount: () => HTMLElement | null
  go: (proto: string, variant: string, state?: string) => void
  /** Posts a batch; resolves the batch's id, and how each decision in it went. */
  send: (batch: CommentBatch) => Promise<Sent>
  dark: () => boolean
}
/** The comment layer's store and actions, and the copy picker's, which sends through it. */
export type Ctx = { store: Store; host: Host; act: Actions; copyStore: CopyStore; copyAct: CopyActions }
export const CommentsCtx = createContext<Ctx>(null as unknown as Ctx)
export const useCtx = () => useContext(CommentsCtx)
