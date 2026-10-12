import type { Inbox } from '../shell'
import type { ViewSize } from '../view/sizes'

/** A box in CSS px. Display boxes are measured from the comment layer; a Target's rect from the variant root. */
export type Box = { x: number; y: number; w: number; h: number }

/**
 * What a comment is on, or tags. `selector` finds it again from the variant's mount (it holds
 * across hot reloads while the structure does); `rect` is where it was, in CSS px from the
 * variant root's top left, which is what the agent is told. A comment pinned with a long press
 * has a `point` too, in the same px: the spot itself, with the element under it for context.
 * `src` is where it is written, its file under src/protos and line (`today/parts.tsx:30`), and
 * `component` the component it is written in (both stamped by source.mjs). One picked in a device
 * view (view/) has its `view`: the layout it is on, which its rect is measured in.
 */
/** label stays in saved data for compatibility; the UI uses numbered references, not element names. */
export type Target = { label: string; selector: string; shoot?: string; src?: string; component?: string; tag: string; text: string; rect: Box; point?: { x: number; y: number }; view?: ViewSize }

/** A comment's words: text, and tags (an index into the comment's `tags`) between. */
export type Seg = string | { tag: number }
/** `shot` is a picture of the design (the camera, marked up or not), or an image the user pasted or dropped (`pasted`). */
export type Draft = { body: Seg[]; tags: Target[]; shot?: string; pasted?: boolean }
/**
 * A moment of the design's motion, in ms of its take (the motion dock, motion/), or a range of it
 * from `at` to `to`; `take` is how long the take is.
 */
export type Time = { at: number; to?: number; take: number }
/** An unfinished new comment, and the element (or the moment of the motion) it was started on. */
export type Held = Draft & { target?: Target; time?: Time }

/**
 * A decision on a variant, made in the page: pick it (or take the pick back), more like it, build
 * it. It goes to Claude as a comment with this and no element; its body is the optional note. A
 * copy choice (copy.tsx) is one too, on the element of the line it changes.
 */
export type Action = 'pick' | 'unpick' | 'more' | 'build' | 'copy' | 'try-it' | 'copy-options'

export type Item = Draft & {
  id: string
  proto: string
  variant: string
  state?: string
  /** The pin's number, counted within its variant (0 for an action, which has no pin). */
  n: number
  /** What it is on; an action has none. */
  target?: Target
  action?: Action
  /** The moment or range of the motion it is on, when it was written in the motion dock. */
  time?: Time
  at: number
  /** Once sent: the batch, and its place in it (1-based, as `proto reply` counts). */
  sent?: { batch: string; i: number }
}

export type CState = 'draft' | 'sent' | 'seen' | 'done'
export type Mode =
  | { kind: 'idle' }
  | { kind: 'pick' }
  | { kind: 'compose'; target: Target; id?: string }
  | { kind: 'tag'; target: Target; id?: string }
  /** Writing on a moment or a range of the motion, in the dock; tagging: picking an element to tag. */
  | { kind: 'time'; time: Time; id?: string; tagging?: boolean }

/** Where the page is, when it is on a single variant that can be commented on; view: the device
 *  view's layout while one is on, where comments are written and their pins shown. */
export type Place = { proto: string; variant: string; state?: string; phone: boolean; title: string; view?: ViewSize }

export type State = {
  items: Item[]
  held: Held | null
  mode: Mode
  active: string | null
  /** Bumped to make a composer that can't take a click say so (it shakes). */
  nudge: number
  /** An element picked to be tagged, waiting for the open composer to take it. */
  pendingTag: Target | null
  place: Place | null
  inbox?: Inbox
  /** The phone's list, in a sheet. */
  sheet: boolean
  sending: boolean
  error: string
}

export const routeOf = (p: { proto: string; variant: string; state?: string }) => `${p.proto}/${p.variant}${p.state ? `/${p.state}` : ''}`
