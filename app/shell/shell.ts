// The session shell: a switcher whose dropdown is the session in columns (a prototype built from
// another one's variant comes after that variant), a sidebar with the same columns stacked, the
// variant your requests change on top, edge arrows, focus mode with a growing dock, and a
// crossfade between designs.
//
// One rule holds it together: the chrome re-renders freely, the designs never do. Each
// place (session lobby, prototype lobby, one variant) is a layer with its components
// mounted once; moving somewhere builds a new layer under the old one and fades the old
// one out. Live edits reach the mounted components through the framework's own HMR.

// First: it wraps the page listeners every later import, and every design, adds (see quiet.ts).
import { listen, quiet } from './quiet'
import { agentName, type Agent } from './agent'
import { variantLabel } from './variants'
import { VirtualList, virtualHTML, scrollParent, VIRTUAL_THRESHOLD } from './virtual'
import { ic, esc, bd, ON, TAB_ON, TAB_OFF, IB, SEP, pulse, pop, ago, clock } from './ui'
import { BUILDING_CLASS, ERROR_CLASS, ownerOfPath, refOfPath } from './building'
import { dock, edge, smooth, runDock, restoreEdgeLabels, installPointerTracking, fadeOut } from './motion'
import { hints, fillField, type Hint } from './hints'
import { tweaks, isChanged } from './tweaks'
import { createTweakControls, createTweaksDrawer } from './tweaks-ui'
import { copy } from './copy'
import { createSheet, createMenuSheet, createTrySheet } from './sheet'
import { createSpotlight, showable, showIcon, whereIs } from './spotlight'
import { createComments, type MenuRow, type Subject } from './comments/index'
import { createMotion } from './motion/index'
import { motion } from './motion/registry'
import type { Action } from './comments/types'
import { tabIcon } from './favicon'
import { setShellRoot } from './portals'
import { createView } from './view/index'
import { createSettings, type Appearance } from './settings'
import { createShare } from './share'
import { framed, frameClicks, frameMenus, offerTheme } from './view/frame'
import { MAX as ZOOM_MAX, MIN as ZOOM_MIN } from './view/gestures'
import { dims, nativeOf, ORDER, SIZES, sizeIcon, type Size, type ViewSize } from './view/sizes'

export type Variant = { id: string; name: string; file: string; load: () => Promise<unknown> }
/** Something behind clicks in a prototype's variants (a menu, a drawer, a dialog), reached by
 *  clicking its selectors in order. about: one line per variant; only: the variants that have it. */
export type State = { id: string; name: string; click: string[]; about?: Record<string, string>; only?: string[] }
export type Proto = { id: string; title: string; ask: string; kind: 'web' | 'phone'; created: string; archived: boolean; from?: { proto: string; variant: string }; slot?: string; also: { proto: string; variant: string }[]; picked?: string; count?: number; screen: [number, number]; about: Record<string, string>; states: State[]; variants: Variant[] }
/** A variant of one prototype ("pricing" and "C"). */
export type Ref = { proto: string; variant: string }
/** work: the variant being changed now; before: the ones worked on before it (newest first);
 *  asks: what the user asked for on each variant ("pricing/C"), oldest first. */
export type Session = { agent?: Agent; id: string; name: string; path: string; createdAt: string; url?: string; localUrl?: string; work?: (Ref & { at?: string }) | null; before?: Ref[]; asks?: Record<string, { at: string; text: string }[]>; building?: Record<string, string> }
type Mount = (el: HTMLElement, component: any) => () => void
// A variant can be shown in one of its states, or through a tool: all its states at once
// (all), playing through them (play), or next to another variant (compare).
type Tool = 'play' | 'all' | 'compare'
type Place = { view: 'session' } | { view: 'proto'; proto: string } | { view: 'variant'; proto: string; variant: string; state?: string; tool?: Tool }
type Layer = { el: HTMLElement; refs: unknown[]; ready: Promise<unknown>; dispose: () => void; player?: { toggle: () => void; jump: (i: number) => void }; remount?: () => Promise<unknown>; refresh?: () => void }
// Comments sent from the page to the agent running the session (`proto inbox`), and what came back.
export type Inbox = {
  new: number
  listening: boolean
  /** The last agent that ran proto commands here: still running, or gone (T3 Code restarted, the terminal closed). */
  agent?: 'alive' | 'gone' | null
  batches: { id: string; at: string; state: 'sent' | 'seen' | 'lost' | 'done'; reply: { text: string; at: string; by?: 'claude' | 'codex' | 'agent' } | null
    comments: { n: number; route: string; action?: Action; done: boolean; withdrawn?: boolean; scoped?: boolean; reply: { text: string; at: string; by?: 'claude' | 'codex' | 'agent' } | null }[] }[]
}
/** An element a comment is on or tags. Rect is in CSS px from the variant root's top left; src and
 *  component say where it is written (`today/parts.tsx:30`, `PriceCard`). */
export type Pinned = { selector?: string; shoot?: string; src?: string; component?: string; tag?: string; text?: string; rect?: { x: number; y: number; w: number; h: number } }
/** One send: route is <slug>/<letter>[/<state>]; images are data URLs (png, jpeg, webp). A decision
 *  on a variant (pick, unpick, more, build) is a comment with an action and no target. */
export type CommentBatch = {
  comments: { route: string; text: string; action?: Action; note?: string; count?: number; point?: { x: number; y: number }; target?: Pinned; tags?: Pinned[]; images?: { dataUrl: string; name?: string }[]
    /** On the motion (motion/): a moment of its take in ms, or a range to `to`, and the take's length. */
    at?: number; to?: number; take?: number
    /** Written in a device view (view/): about that layout. */
    view?: ViewSize
    /** A follow-up: the sent comment (its batch, and its number in it) whose reply this answers. */
    re?: { batch: string; n: number } }[]
  viewport?: { w: number; h: number; phone?: boolean }
  /** The design's own localStorage when it was sent (comments/dom.ts designStorage), for `proto shoot --pin`. */
  storage?: Record<string, string>
  theme?: 'light' | 'dark'
}
/** How a send went: its batch, and for each decision in it whether the server made it, or why not
 *  (marked: the pick is in meta.ts and only the working variant didn't move; nothing: an unpick of a
 *  variant that wasn't the pick). */
export type Sent = { id: string; results: { n: number; action: Action; done: boolean; failed?: string; marked?: boolean; nothing?: boolean }[] }
type Status = { lastEdit: number; edits?: Record<string, number>; keep: boolean; idleHours: number; deleteDays: number; work?: Ref | null; inbox?: Inbox }

const PHONE = 'shrink-0 overflow-hidden rounded-[55px] border-[10px] border-zinc-900 bg-white text-zinc-900 shadow-xl dark:border-zinc-700 dark:bg-black dark:text-white'
// The phone scale: Fit (0) or a percentage. The menu offers these in a row and a slider for
// anything between, which lands on one of them within two points.
const SCALES = [0, 50, 75, 100]
const SCALE_MIN = 25
const SCALE_MAX = 100
const segCls = (on: boolean) => `h-9 flex-1 rounded-md text-xs font-medium tabular-nums ${on ? TAB_ON : TAB_OFF}`
// A range input drawn the same in every browser (iOS Safari restyles its own): the track fills
// to --p, the thumb is a white disc.
const RANGE = 'h-11 min-w-0 flex-1 cursor-pointer appearance-none bg-transparent px-1 outline-none [--fill:#18181b] [--rest:rgb(24_24_27/.1)] dark:[--fill:#fff] dark:[--rest:rgb(255_255_255/.15)] '
  + '[&::-webkit-slider-runnable-track]:h-1.5 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-[linear-gradient(to_right,var(--fill)_var(--p),var(--rest)_var(--p))] '
  + '[&::-webkit-slider-thumb]:-mt-[9px] [&::-webkit-slider-thumb]:size-6 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-[0_1px_4px_rgba(0,0,0,.25),0_0_0_1px_rgba(0,0,0,.08)] focus-visible:[&::-webkit-slider-thumb]:shadow-[0_0_0_2px_#0ea5e9] '
  + '[&::-moz-range-track]:h-1.5 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-(--rest) [&::-moz-range-progress]:h-1.5 [&::-moz-range-progress]:rounded-full [&::-moz-range-progress]:bg-(--fill) '
  + '[&::-moz-range-thumb]:size-6 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:shadow-[0_1px_4px_rgba(0,0,0,.25),0_0_0_1px_rgba(0,0,0,.08)]'
// The sidebar's width: dragged between these, double-click resets it.
const SIDE_W = 320, SIDE_MIN = 260, SIDE_MAX = 480
// Where the sidebar's two columns meet, as the share the first one takes of them: dragged between these.
const SPLIT_W = 0.5, SPLIT_LO = 0.2, SPLIT_HI = 0.8
const INTERACTIVE = 'input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="slider"], [role="listbox"], [role="menu"]'
const TOOLS: Record<Tool, { name: string; icon: string; hint: string }> = {
  play: { name: 'Autoplay', icon: 'play', hint: 'Clicks through every state for you' },
  all: { name: 'All states', icon: 'grid', hint: 'Every state on one page' },
  compare: { name: 'Compare', icon: 'diff', hint: 'Side by side, in the same state' },
}

// ---------- reaching a state: click its selectors inside the design, in order ----------
const frame = () => new Promise(r => requestAnimationFrame(r))
const wait = (ms: number) => new Promise(r => setTimeout(r, ms))
async function until<T>(get: () => T | null | undefined, ms: number): Promise<T | null> {
  const end = performance.now() + ms
  for (;;) {
    let x: T | null | undefined = null
    try { x = get() } catch { /* a bad selector: treated as not found */ }
    if (x) return x
    if (performance.now() > end) return null
    await frame()
  }
}
// The whole sequence a real click makes, so menus that open on pointerdown open too. Dispatched
// events reach the design's own handlers even inside an inert preview.
function press(el: Element) {
  const o = { bubbles: true, cancelable: true, composed: true, view: window, button: 0 }
  const ptr = { ...o, pointerId: 1, isPrimary: true, pointerType: 'mouse' }
  el.dispatchEvent(new PointerEvent('pointerdown', ptr))
  el.dispatchEvent(new MouseEvent('mousedown', o))
  el.dispatchEvent(new PointerEvent('pointerup', ptr))
  el.dispatchEvent(new MouseEvent('mouseup', o))
  el.dispatchEvent(new MouseEvent('click', o))
}
/** Clicks each selector inside the host; returns the first one that matched nothing. */
async function replay(host: HTMLElement, steps: string[], alive: () => boolean, each?: (el: Element) => Promise<void>) {
  if (!await until(() => host.firstElementChild, 3000)) return steps[0] ?? null
  await frame(); await frame()
  for (const sel of steps) {
    const el = await until(() => host.querySelector(sel), 1500)
    if (!alive()) return null
    if (!el) return sel
    if (each) await each(el)
    if (!alive()) return null
    press(el)
    await frame(); await frame(); await wait(30)
  }
  return null
}

export function createShell(root: HTMLElement, opts: { mount: Mount; protos: Proto[]; session: Session }) {
  const { mount } = opts
  let protos = opts.protos
  let session = opts.session
  // The page inside a device view (view/frame.ts) shares this browser's storage with the page
  // outside, so it keeps comments under names of its own, and writes nothing else: what it chooses
  // (its place, theme, sidebar, panel) lasts until it reloads. Its copy choices are the page's own
  // (the store is shared, see shared.ts), so configuring it again is nothing.
  copy.configure(framed && !new URLSearchParams(location.search).has('shot') ? `${session.id}~view` : session.id)
  const remember = (key: string, value: string) => { if (!framed) localStorage.setItem(key, value) }
  setShellRoot(root)
  const q = new URLSearchParams(location.search)
  const stored = localStorage.getItem('proto-theme')
  let appearance: Appearance = stored === 'light' || stored === 'dark' ? stored : 'system'
  let themeOverride = q.has('theme')
  const systemTheme = matchMedia('(prefers-color-scheme: dark)')
  let settingsOpen = false, shareOpen = false
  let settingsOrigin: 'bar' | 'dock' = 'bar'
  const st = {
    place: { view: 'session' } as Place,
    focus: false,
    open: null as string | null,
    /** The variant whose options are open (from its row in the sidebar), and where. */
    vmenu: null as { proto: string; variant: string; x: number; y: number; hint?: boolean; el?: HTMLElement; art?: boolean } | null,
    /** The right-click menu of what is not a variant: where, and on what. */
    ctx: null as { x: number; y: number; on: CtxOn } | null,
    archived: false,
    side: q.has('side') ? q.get('side') !== '0' : localStorage.getItem('proto-side') !== '0',
    sideW: Math.min(SIDE_MAX, Math.max(SIDE_MIN, Number(localStorage.getItem('proto-side-w')) || SIDE_W)),
    split: Math.min(SPLIT_HI, Math.max(SPLIT_LO, Number(localStorage.getItem('proto-split')) || SPLIT_W)),
    drawer: false,
    // The phone's variant sheet, opened from the bottom pill.
    sheet: false,
    // The phone's bar opens its menus as sheets: the prototypes, or the session.
    menu: '' as '' | 'protos' | 'session',
    // On a phone the grid's phone cards open at half size; Fit leaves them tiny there.
    scale: matchMedia('(max-width: 639px)').matches ? 50 : 0,
    // The motion dock, asked for (Motion in the pill's menu, the bar's curves): page tools stay out
    // of the way until then, so a design with motion runs live and nothing sits under it.
    motion: false,
    stack: q.has('stack') ? q.get('stack') !== '0' : localStorage.getItem('proto-lobby') === 'stack',
    dark: q.get('theme') ? q.get('theme') === 'dark' : appearance === 'system' ? systemTheme.matches : appearance === 'dark',
    copied: false,
    live: true,
    stopped: false,
    lastEdit: 0,
    editing: null as null | { proto: string; variant: string },
    status: null as Status | null,
    vs: new Map<string, string>(),
    playing: '' as string,
    // The working variant's strip: whether its requests are open, and the move Claude just made
    // (offered back for a few seconds).
    asks: false,
    moved: null as Ref | null,
    // A Keep, Stop or Undo the server turned down, said where it was asked for.
    failed: null as null | { at: 'session' | 'work'; text: string },
    // The sidebar's level shown as columns (null: the last two), and the phone sheet's column.
    pairAt: null as number | null,
    drill: null as number | null,
    // The device view (view/): the page at another size in the stage. size null: none, the page as
    // this screen is; zoom 0: Fit, else a percentage.
    view: { size: null as Size | null, land: false, zoom: 0, home: 0 },
  }

  // ---------- data helpers ----------
  const active = () => protos.filter(p => !p.archived)
  const archived = () => protos.filter(p => p.archived)
  const byId = (id: string) => protos.find(p => p.id === id)
  // A variant is building from `proto add` until `proto done` (or, if that never comes, a few
  // minutes after its last edit: seen here, or, for edits before this page loaded, known to the
  // dev server's status): it is marked, and a render error keeps its last good frame.
  const BUILD_IDLE = 180_000
  const editedAt = new Map<string, number>()
  const buildingUntil = (key: string) => {
    const at = session.building?.[key]
    return at ? Math.max(Date.parse(at), editedAt.get(key) ?? 0, st.status?.edits?.[key] ?? 0) + BUILD_IDLE : 0
  }
  const building = (p: string, v: string) => buildingUntil(`${p}/${v}`) > Date.now()
  const buildingIn = (p: string) => Object.keys(session.building ?? {}).some(k => k.startsWith(`${p}/`) && building(p, k.slice(p.length + 1)))
  const markBuilding = (host: HTMLElement) => { const [p, v] = (host.dataset.route ?? '').split('/'); host.toggleAttribute('data-building', !!v && building(p, v)) }
  const editing = (p: string, v?: string) => (!!st.editing && st.editing.proto === p && (!v || st.editing.variant === v)) || (v ? building(p, v) : buildingIn(p))
  const cur = () => (st.place.view === 'session' ? undefined : byId(st.place.proto))

  // ---------- the working variant ----------
  // One per session, set by Claude (`proto work`, a pick), never by an edit. A target that was
  // archived or removed counts as none.
  const same = (a?: Ref | null, b?: Ref | null) => !!a && !!b && a.proto === b.proto && a.variant === b.variant
  const refOk = (r?: Ref | null) => { const p = r && byId(r.proto); const v = p && !p.archived && p.variants.find(x => x.id === r!.variant); return v ? { p: p!, v } : null }
  const workOf = () => refOk(session.work)
  const atWork = () => st.place.view === 'variant' && same(st.place, session.work) && !!workOf()
  const visible = (p: Proto) => p.variants
  const asksOf = (r: Ref) => session.asks?.[`${r.proto}/${r.variant}`] ?? []
  // States: those a variant has, the one a place points at, and whether a variant's note says
  // something changed. The first variant is the reference: its notes describe each state, the
  // others' notes say what they change, and a state they leave out is the same as there.
  const statesOf = (p: Proto, v: string) => p.states.filter(s => !s.only?.length || s.only.includes(v))
  const stateOf = (p: Proto, v: string, id?: string) => (id ? statesOf(p, v).find(s => s.id === id) : undefined)
  const refOf = (p: Proto) => p.variants[0]?.id ?? ''
  const changed = (p: Proto, v: string, s: State) => v !== refOf(p) && !!s.about?.[v]
  const toolOk = (p: Proto, v: string, t?: Tool) => !t || (t === 'compare' ? p.variants.length > 1 : statesOf(p, v).length > 0)
  const hashOf = (p: Place) => p.view === 'session' ? '#/' : p.view === 'proto' ? `#/${p.proto}` : `#/${p.proto}/${p.variant}${p.tool ? `/~${p.tool}` : ''}${p.state ? `/${encodeURIComponent(p.state)}` : ''}`
  const valid = (p: Place): boolean => {
    if (p.view === 'session') return true
    const proto = byId(p.proto)
    if (!proto) return false
    if (p.view === 'proto') return true
    return proto.variants.some(v => v.id === p.variant) && (!p.state || !!stateOf(proto, p.variant, p.state)) && toolOk(proto, p.variant, p.tool)
  }
  const parseHash = (hash = location.hash): Place | null => {
    const [proto, variant, a, b] = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent)
    const tool = a?.startsWith('~') ? a.slice(1) as Tool : undefined
    const state = tool ? b : a
    const p: Place = !proto ? { view: 'session' } : !variant ? { view: 'proto', proto } : { view: 'variant', proto, variant }
    if (!hash || !valid(p)) return null
    // A state or tool that isn't there (renamed, removed) falls back to the variant at rest.
    if (p.view === 'variant') {
      const q = byId(proto)!
      if (state && stateOf(q, variant, state)) p.state = state
      if (tool && TOOLS[tool] && toolOk(q, variant, tool)) p.tool = tool
    }
    return p
  }
  /** Moving to another variant keeps the state and tool, where that variant has them. */
  const keepIn = (proto: Proto, variant: string): Place => {
    const here = st.place.view === 'variant' && st.place.proto === proto.id ? st.place : null
    const state = here?.state && stateOf(proto, variant, here.state) ? here.state : undefined
    const tool = here?.tool && toolOk(proto, variant, here.tool) ? here.tool : undefined
    return { view: 'variant', proto: proto.id, variant, ...(state ? { state } : {}), ...(tool ? { tool } : {}) }
  }
  const defaultPlace = (): Place => {
    const newest = active().at(-1)
    return newest ? { view: 'proto', proto: newest.id } : { view: 'session' }
  }

  // ---------- nesting: a prototype built from another one's variant sits under it ----------
  const parentOf = (p: Proto) => { const a = p.from && byId(p.from.proto); return a && !a.archived && a.id !== p.id ? a : undefined }
  // A prototype that combines several (`--from a/E,b/B`) nests under the first only and keeps
  // the rest in also. Its sources are all of them still in the session, the first one first,
  // each with the variant taken; with the first archived, the next one leads.
  const sources = (p: Proto) => [p.from, ...p.also].flatMap(r => { const a = r && byId(r.proto); return a && !a.archived && a.id !== p.id ? [{ p: a, v: r!.variant }] : [] })
  const alsoOf = (p: Proto) => sources(p).slice(parentOf(p) ? 1 : 0)
  /** One of the others, named: "Style B" in a line ("Style · B" on a chip), or just "B" when it
   *  is another variant of the prototype it nests under. */
  const srcName = (k: Proto, s: { p: Proto; v: string }, sep = ' ') => s.p === parentOf(k) && s.v ? esc(variantLabel(s.p, s.v)) : `${bd(s.p.title)}${s.v ? `${sep}${esc(variantLabel(s.p, s.v))}` : ''}`
  const isRoot = (p: Proto) => !parentOf(p)
  /** What a prototype was built from, oldest first, each with the variant the next one came from. */
  const lineage = (p: Proto) => {
    const out: { p: Proto; v: string }[] = []
    const seen = new Set([p.id])
    for (let q = p, a = parentOf(p); a && !seen.has(a.id); q = a, a = parentOf(a)) { seen.add(a.id); out.unshift({ p: a, v: q.from!.variant }) }
    return out
  }
  const kidsOf = (p: Proto, v?: string) => active().filter(k => k !== p && parentOf(k) === p && (v === undefined || k.from!.variant === v))
  // An overview lists under a variant everything built from it, whether it nests there or
  // takes that variant as one of its others; the tree (columns, lobby) follows kidsOf only.
  const builtFrom = (p: Proto, v: string) => active().filter(k => k !== p && sources(k).some(s => s.p === p && s.v === v))
  // Built from the prototype as a whole (or from a variant it no longer has), as what it nests
  // under or as one of the others: the overview lists these under its title, as the grid lists
  // the rest under each variant. The tree's looseKids still follows the first parent only.
  const wholeKids = (p: Proto) => active().filter(k => k !== p && sources(k).some(s => s.p === p && !p.variants.some(v => v.id === s.v)))
  // Built from the prototype as a whole, or from a variant that no longer exists.
  const looseKids = (p: Proto) => kidsOf(p).filter(k => !p.variants.some(v => v.id === k.from!.variant))
  const family = (p: Proto, depth = 1): { p: Proto; depth: number }[] =>
    [...p.variants.flatMap(v => kidsOf(p, v.id)), ...looseKids(p)].flatMap(k => [{ p: k, depth }, ...family(k, depth + 1)])
  // Nesting shows as one step in, then a small step per level, and stops at three, so a deep
  // chain doesn't squeeze its titles and asks; the branch icon carries the rest.
  const nestIndent = (depth: number) => depth ? 14 + 6 * (Math.min(depth, 3) - 1) : 0
  const treeOrder = () => active().filter(isRoot).flatMap(p => [{ p, depth: 0 }, ...family(p)])
  const editingUnder = (p: Proto): boolean => editing(p.id) || kidsOf(p).some(editingUnder)
  const nestKey = () => active().map(p => `${p.id}<${p.from?.proto ?? ''}/${p.from?.variant ?? ''}${p.also.map(r => `+${r.proto}/${r.variant}`).join('')}:${p.title}:${p.variants.length}:${pickOf(p)}`).join('|')
  // The variant the user chose ("go with A"); it's listed first and the rest stay reachable.
  const pickOf = (p: Proto) => p.picked && p.variants.some(v => v.id === p.picked) ? p.picked : ''
  const lobbyOrder = (p: Proto) => { const k = pickOf(p); return k ? [...p.variants.filter(v => v.id === k), ...p.variants.filter(v => v.id !== k)] : p.variants }
  const PICK = 'text-emerald-700 dark:text-emerald-400'
  const pickChip = (p: Proto, cls = '') => pickOf(p) ? `<span title="Picked ${esc(variantLabel(p, pickOf(p)))} · ${esc(p.variants.find(v => v.id === pickOf(p))!.name)}" class="inline-flex h-5 shrink-0 items-center gap-0.5 rounded-full bg-emerald-500/10 px-1.5 text-[11px] font-semibold ${PICK} ${cls}">${ic('check', 'size-3')}${esc(variantLabel(p, pickOf(p)))}</span>` : ''
  const wide = () => matchMedia('(min-width: 1024px)').matches

  // ---------- the path, as columns ----------
  // The switcher's dropdown, the sidebar and the phone's sheet all draw these. The first column
  // is the prototypes that weren't built from anything; then each level is one prototype's
  // variants, the one on the way here lit. A variant that more than one prototype was built from
  // gets a column of those prototypes; with one, its variants come next directly. Past the place
  // shown, what was built from it comes next, so the way on is one click.
  type Col = { kind: 'protos'; list: Proto[]; sel: string; from?: Ref } | { kind: 'variants'; p: Proto; sel: string }
  function columns(): Col[] {
    const p = cur(), vid = st.place.view === 'variant' ? st.place.variant : ''
    const roots = active().filter(isRoot)
    if (!p) return [{ kind: 'protos', list: roots, sel: '' }]
    const chain = [...lineage(p), { p, v: vid }]
    const cols: Col[] = [{ kind: 'protos', list: chain[0].p.archived ? [...roots, chain[0].p] : roots, sel: chain[0].p.id }]
    chain.forEach(({ p: q, v }, i) => {
      const next = chain[i + 1], real = q.variants.some(x => x.id === v)
      cols.push({ kind: 'variants', p: q, sel: real ? v : '' })
      const kids = real ? kidsOf(q, v) : next ? looseKids(q) : []
      const from = { proto: q.id, variant: v }
      if (next) { if (kids.length > 1 || !real) cols.push({ kind: 'protos', list: kids, sel: next.p.id, from }) }
      else if (kids.length > 1) cols.push({ kind: 'protos', list: kids, sel: '', from })
      else if (kids.length === 1) cols.push({ kind: 'variants', p: kids[0], sel: '' })
    })
    return cols
  }
  const colName = (c: Col) => {
    if (c.kind === 'variants') return c.p.title
    if (!c.from) return 'Prototypes'
    const p = byId(c.from.proto)
    return `Built from ${p && c.from.variant ? variantLabel(p, c.from.variant) : c.from.variant || p?.title || ''}`
  }
  const colKey = (c: Col) => c.kind === 'variants' ? `v:${c.p.id}` : `p:${c.from ? `${c.from.proto}/${c.from.variant}` : ''}`
  const colCount = (c: Col) => c.kind === 'variants' ? c.p.variants.length : c.list.length
  const ROWC = 'text-zinc-700 hover:bg-zinc-900/[.04] dark:text-zinc-300 dark:hover:bg-white/[.06]'
  const SELC = 'bg-zinc-900/[.06] font-medium text-zinc-900 dark:bg-white/[.09] dark:text-white'
  const rowCls = (big: boolean) => `flex w-full min-w-0 items-center text-left ${big ? 'h-11 gap-2.5 rounded-lg px-2.5 text-[15px]' : 'h-[30px] gap-1.5 rounded-md px-1.5'}`
  /** One variant in a column: the one shown is blue, the others on the way here are gray. */
  function vRow(q: Proto, v: Variant, sel: boolean, big = false) {
    const pl = st.place, here = pl.view === 'variant' && pl.proto === q.id && pl.variant === v.id
    const w = workOf(), kids = kidsOf(q, v.id).length > 0
    return `<div data-mv="${esc(q.id)}:${v.id}" class="group/vr relative"><button data-act="mv:${esc(q.id)}:${v.id}" aria-current="${sel}"${kids ? ' data-opens' : ''} class="${rowCls(big)} ${here ? 'bg-sky-500/15 font-medium text-sky-950 dark:text-sky-50' : sel ? SELC : ROWC}">
      <span class="min-w-3.5 shrink-0 text-center text-[11px] font-semibold tabular-nums ${sel ? '' : 'text-zinc-400'}">${variantLabel(q, v.id)}</span><span dir="auto" class="min-w-0 flex-1 truncate">${esc(v.name)}</span><span class="flex shrink-0 items-center justify-end gap-1.5 ${big ? 'min-w-8' : 'min-w-6'} group-hover/vr:invisible group-has-[:focus-visible]/vr:invisible group-has-[[aria-expanded=true]]/vr:invisible [@media(pointer:coarse)]:me-6">${v.id === pickOf(q) ? `<span title="Picked" class="shrink-0">${ic('picked', `size-4 ${PICK}`)}</span>` : ''}${w?.p === q && w.v === v ? `<span title="Your requests change this one" class="shrink-0">${ic('pin', 'size-3 text-emerald-600 dark:text-emerald-400')}</span>` : ''}${openComments(q.id, v.id)}${editing(q.id, v.id) ? pulse('size-1.5') : ''}${kids ? ic('right', `size-3 shrink-0 ${sel ? 'text-sky-600 dark:text-sky-400' : 'text-zinc-400'}`) : ''}</span></button><button data-act="vm:${esc(q.id)}:${v.id}" aria-label="Options for ${esc(v.name)}" aria-haspopup="menu" aria-expanded="${st.open === 'vmenu' && st.vmenu?.proto === q.id && st.vmenu.variant === v.id}" title="Options: comment on this, pick, build, Try it, copy options, share screenshots" class="absolute ${big ? 'right-2 size-8' : 'right-1 size-6'} top-1/2 grid -translate-y-1/2 place-items-center rounded-md text-zinc-500 opacity-0 hover:bg-zinc-900/10 hover:text-zinc-900 focus-visible:opacity-100 group-hover/vr:opacity-100 group-has-[:focus-visible]/vr:opacity-100 aria-expanded:bg-zinc-900/10 aria-expanded:opacity-100 dark:text-zinc-400 dark:hover:bg-white/15 dark:hover:text-white dark:aria-expanded:bg-white/15 [@media(pointer:coarse)]:opacity-100">${ic('dots', 'size-5')}</button></div>`
  }
  /** One prototype in a column; choosing it opens its variants. */
  const pRow = (k: Proto, sel: boolean, big = false) => `<button data-act="mp:${esc(k.id)}" aria-current="${sel}" data-opens class="${rowCls(big)} ${sel ? SELC : k.archived ? 'text-zinc-400 hover:bg-zinc-900/[.04] dark:hover:bg-white/[.06]' : ROWC}">
      <span dir="auto" class="min-w-0 flex-1 truncate ${k.archived ? 'line-through decoration-zinc-300' : ''}">${esc(k.title)}</span>${k.kind === 'phone' ? ic('phone', 'size-3 shrink-0 text-zinc-400') : ''}${pickChip(k)}${editingUnder(k) ? pulse('size-1.5') : ''}<span class="shrink-0 text-[10px] tabular-nums text-zinc-400">${k.variants.length}</span>${ic('right', 'size-3 shrink-0 text-zinc-400')}</button>`
  function colRows(c: Col, big = false) {
    const none = (t: string) => `<p class="px-2 py-1.5 text-[11px] text-zinc-400">${t}</p>`
    if (c.kind === 'variants' && c.p.variants.length > VIRTUAL_THRESHOLD) return `<div data-virtual-list="${esc(c.p.id)}" data-virtual-big="${big}" data-virtual-selected="${esc(c.sel)}"></div>`
    if (c.kind === 'variants') return c.p.variants.map(v => vRow(c.p, v, c.sel === v.id, big)).join('') || none('No variants yet')
    const rows = c.list.map(k => pRow(k, c.sel === k.id, big)).join('') || none('None yet')
    // Archived prototypes fold under the first column.
    const gone = c.from ? [] : archived().filter(k => !c.list.includes(k))
    return rows + (gone.length ? `<button data-act="archived" aria-expanded="${st.archived}" class="${rowCls(big)} text-[11px] text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200">${ic(st.archived ? 'chev' : 'right', 'size-3')}Archived<span class="ml-auto tabular-nums">${gone.length}</span></button>${st.archived ? gone.map(k => pRow(k, false, big)).join('') : ''}` : '')
  }
  // Chrome can redraw without throwing away recently visited rows. Each surface owns its
  // window; the small pool also bounds memory when navigating between prototypes.
  const navWindows = new Map<string, VirtualList<Variant>>()
  const navLists = new WeakMap<Element, VirtualList<Variant>>()
  function detachNav(host: HTMLElement) {
    for (const window of navWindows.values()) if (window.element && host.contains(window.element)) window.disconnect()
  }
  function bindNav(host: HTMLElement, scope: string) {
    const bound: VirtualList<Variant>[] = []
    for (const marker of host.querySelectorAll<HTMLElement>('[data-virtual-list]')) {
      const p = byId(marker.dataset.virtualList!), list = marker.closest<HTMLElement>('[data-vlist]')
      if (!p || !list) continue
      const big = marker.dataset.virtualBig === 'true', key = `${scope}:${p.id}:${big}`
      let window = navWindows.get(key)
      const options = {
        items: p.variants, key: (v: Variant) => v.id,
        render: (v: Variant, _i: number, previous?: HTMLElement) => virtualHTML(vRow(p, v, marker.dataset.virtualSelected === v.id, big), previous),
        estimate: () => big ? 44 : 30, gap: 1, overscan: 3, cacheSize: 64,
      }
      if (window) { window.disconnect(); window.update(options) }
      else window = new VirtualList(options)
      navWindows.delete(key); navWindows.set(key, window)
      window.connect(marker, scrollParent(marker))
      navLists.set(list, window); bound.push(window)
    }
    for (const [key, window] of navWindows) {
      if (navWindows.size <= 8) break
      if (!window.element) { window.destroy(); navWindows.delete(key) }
    }
    return bound
  }
  const menuReady = (host: HTMLElement) => {
    const bound = bindNav(host, 'menu').map(window => ({ window, element: window.element }))
    return () => { for (const { window, element } of bound) if (window.element === element) window.disconnect() }
  }
  /** A column's head: a prototype's opens its overview, the first column's the session's. */
  const colHead = (c: Col) => {
    const act = c.kind === 'variants' ? `lobby:proto:${esc(c.p.id)}` : c.from ? '' : 'lobby:session'
    const title = c.kind === 'variants' ? `All ${c.p.variants.length} variants of ${esc(c.p.title)}` : c.from ? '' : 'Overview of the session'
    const inner = `<span dir="auto" class="truncate">${esc(colName(c))}</span>${act ? ic('grid', 'size-3 shrink-0 opacity-0 group-hover/h:opacity-100') : ''}<span class="ml-auto shrink-0 tabular-nums">${colCount(c)}</span>`
    const cls = 'group/h flex h-7 w-full min-w-0 shrink-0 items-center gap-1 px-2.5 text-left text-[10px] font-medium text-zinc-400'
    return act ? `<button data-act="${act}" title="${title}" class="${cls} hover:text-zinc-900 dark:hover:text-white">${inner}</button>` : `<div class="${cls}">${inner}</div>`
  }

  // ---------- skeleton ----------
  // A comment being written lifts its layer over the side panel and its edge tabs (z-20), which
  // otherwise cover the composer's buttons where it docks at the bottom of a phone. Two bars can
  // sit under the stage, each taking its height from it: the motion dock (--dock-h) just above the
  // pill, where it always is, and the copy picker's bar (--copy-h) over the dock while copy mode is
  // on. The copy picker's phone sheet covers both. A device view covers the stage, under the edge
  // arrows, the spotlight and the comment layer.
  root.innerHTML = `<div class="flex h-dvh bg-white text-[13px] text-zinc-900 antialiased dark:bg-zinc-950 dark:text-zinc-100">
    <aside data-side></aside>
    <div data-grip role="separator" aria-orientation="vertical" aria-label="Resize sidebar" tabindex="0" title="Drag to resize · double-click to reset" class="group relative z-40 -mx-1 hidden w-2 shrink-0 cursor-col-resize touch-none outline-none">
      <span class="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-transparent transition-colors group-hover:bg-sky-500/50 group-focus-visible:bg-sky-500 group-data-[dragging]:bg-sky-500"></span>
    </div>
    <div class="flex min-w-0 flex-1 flex-col">
      <header data-bar class="relative z-30 ${framed ? 'hidden' : 'flex'} h-12 shrink-0 items-center gap-1 border-b border-black/[.07] px-2 dark:border-white/10"></header>
      <div data-zone>
        <div data-layers class="absolute inset-0 overflow-hidden" style="right:var(--hw,0px);bottom:calc(var(--pill-h,0px) + var(--dock-h,0px) + var(--copy-h,0px))"></div>
        <div data-view hidden class="absolute inset-0 z-[5]" style="right:var(--hw,0px);bottom:calc(var(--pill-h,0px) + var(--dock-h,0px) + var(--copy-h,0px))"></div>
        <div data-spot class="pointer-events-none absolute inset-0 z-[15] overflow-hidden" style="right:var(--hw,0px);bottom:calc(var(--pill-h,0px) + var(--dock-h,0px) + var(--copy-h,0px))"></div>
        <div data-comments class="pointer-events-none absolute inset-0 z-[16] has-[[data-composer]]:z-[25]" style="right:var(--hw,0px);bottom:calc(var(--pill-h,0px) + var(--dock-h,0px) + var(--copy-h,0px))"></div>
        <div data-motion-dock class="absolute left-0 z-[18]" style="right:var(--hw,0px);bottom:var(--pill-h,0px)"></div>
        <div data-copy-bar class="absolute left-0 z-[14]" style="right:var(--hw,0px);bottom:calc(var(--pill-h,0px) + var(--dock-h,0px))"></div>
        <div data-copy-sheet class="pointer-events-none absolute inset-0 z-[19] overflow-hidden" style="right:var(--hw,0px);bottom:var(--pill-h,0px)"></div>
        <div data-overlay></div>
        <div data-pill></div>
        <div data-scale-card></div>
        <aside data-hints></aside>
      </div>
    </div>
    <div data-drawer></div>
    <div data-sheet></div>
    <div data-menu-sheet></div>
    <div data-comments-sheet></div>
    <div data-decide></div>
    <div data-vmenu></div>
    <div data-ctx></div>
  </div>`
  const side = root.querySelector<HTMLElement>('[data-side]')!
  const grip = root.querySelector<HTMLElement>('[data-grip]')!
  const drawer = root.querySelector<HTMLElement>('[data-drawer]')!
  const bar = root.querySelector<HTMLElement>('[data-bar]')!
  const zone = root.querySelector<HTMLElement>('[data-zone]')!
  const layers = root.querySelector<HTMLElement>('[data-layers]')!
  const overlay = root.querySelector<HTMLElement>('[data-overlay]')!
  const hintBox = root.querySelector<HTMLElement>('[data-hints]')!
  const pill = root.querySelector<HTMLElement>('[data-pill]')!
  const paintSheet = createSheet(root.querySelector<HTMLElement>('[data-sheet]')!)
  const paintMenu = createMenuSheet(root.querySelector<HTMLElement>('[data-menu-sheet]')!)
  const cardHost = root.querySelector<HTMLElement>('[data-scale-card]')!

  // ---------- layers ----------
  let layer: Layer | null = null
  // What the bar was last drawn with, for the copy and motion buttons (see render's end).
  let copyKey = '', motionKey = ''

  const refsFor = (p: Place): unknown[] => {
    if (p.view === 'session') return [nestKey(), ...lobbyRoots().flatMap(q => [q.id, q.title, ...lobbyOrder(q).slice(0, 1).flatMap(v => [v.file, v.name])])]
    const proto = byId(p.proto)!
    if (p.view === 'proto') return [st.stack, nestKey(), proto.title, proto.kind, ...lobbyOrder(proto).flatMap(v => [v.id, v.name, v.file])]
    const v = proto.variants.find(v => v.id === p.variant)!
    return [proto.kind, v.file, p.state, p.tool, p.tool === 'compare' ? otherOf(proto, v.id) : '', JSON.stringify(proto.states), ...(p.tool === 'compare' ? proto.variants.map(x => x.file) : [])]
  }
  /** A variant's file (/src/protos/today/C.tsx) as its route, today/C. */
  const routeOfFile = (file: string) => { const [, , , slug = '', name = ''] = file.split('/'); return `${slug}/${name.replace(/\.\w+$/, '')}` }
  // What a variant is compared with: the one chosen, else the reference (else the next one).
  const otherOf = (p: Proto, v: string) => {
    const want = st.vs.get(p.id)
    if (want && want !== v && p.variants.some(x => x.id === want)) return want
    const ref = refOf(p)
    return ref !== v ? ref : p.variants.find(x => x.id !== v)?.id ?? v
  }

  // ---------- loading designs ----------
  // A variant's module loads the first time it is shown and is kept by file, so a session
  // with hundreds of variants (picked, archived, never opened) only pays for what is on
  // screen. A module that fails to load shows its error in place and is retried after edits.
  const loaded = new Map<string, unknown>()
  const loading = new Map<string, Promise<unknown>>()
  const failed = new Set<string>()
  // The browser keeps a failed import for good, so after an edit a broken file is fetched again
  // under a fresh URL.
  const retry = new Map<string, number>()
  function load(v: Variant) {
    if (loaded.has(v.file)) return Promise.resolve(loaded.get(v.file))
    const t = retry.get(v.file)
    const get = t ? () => import(/* @vite-ignore */ `${v.file}?t=${t}`).then(m => m.default) : v.load
    if (!loading.has(v.file)) loading.set(v.file, get().then(
      c => { loaded.set(v.file, c); loading.delete(v.file); failed.delete(v.file); return c },
      e => { loading.delete(v.file); failed.add(v.file); throw e }))
    return loading.get(v.file)!
  }
  // Every hot update leaves its old module in the browser's module map for good. After many,
  // the page reloads itself while its tab is hidden, which frees them; it comes back where it was.
  let updates = 0
  const reloadIfStale = () => { if (updates > 300 && document.visibilityState === 'hidden') location.reload() }
  document.addEventListener('visibilitychange', reloadIfStale)

  // The 10px bezel sits outside the screen, so the frame is the screen plus 20 each way.
  // The scale control works on the device view while one is on, else on a phone prototype's phones.
  const scaleNow = () => (frameOn() ? st.view.zoom : st.scale)
  const scaleRange = () => (frameOn() ? [ZOOM_MIN, ZOOM_MAX] : [SCALE_MIN, SCALE_MAX])
  const rangeAt = (v: number) => { const [lo, hi] = scaleRange(); return ((v - lo) / (hi - lo)) * 100 }
  const scaleLabel = () => (scaleNow() ? `${Math.round(scaleNow())}%` : 'Fit')
  function setScale(v: number) {
    // Fit chosen here also puts a device that was dragged away back in the middle.
    if (frameOn()) return patchView(v ? { zoom: v } : { zoom: 0, home: st.view.home + 1 })
    st.scale = v; render(); fit()
  }
  const phoneSize = (proto: Proto) => `width:${proto.screen[0] + 20}px;height:${proto.screen[1] + 20}px`
  // A phone's card holds the phone itself, so the phone scale can size it (see fit).
  const thumb = (proto: Proto, aspect: string) => proto.kind === 'phone'
    ? `<div data-thumb data-pthumb class="relative flex w-full items-center justify-center overflow-hidden bg-zinc-100 dark:bg-zinc-900 ${aspect}"><div inert class="pointer-events-none ${PHONE} [contain:layout_paint]" style="${phoneSize(proto)}"><div data-mount class="h-full overflow-hidden"></div></div></div>`
    : `<div data-thumb class="relative w-full overflow-hidden bg-white dark:bg-zinc-950 ${aspect}"><div inert class="pointer-events-none overflow-hidden [contain:layout_paint]" style="width:1200px;height:750px"><div data-mount class="h-full"></div></div></div>`

  const frameOf = (proto: Proto) => proto.kind === 'phone' && !q.has('shot')
    ? `<div data-phones class="flex min-h-full items-center justify-center p-6"><div data-phone class="${PHONE} [contain:layout_paint]" style="${phoneSize(proto)}"><div data-mount class="h-full overflow-y-auto"></div></div></div>`
    : '<div data-mount class="h-full"></div>'

  const previewWindows = new Map<string, VirtualList<Variant>>()
  function buildLayer(p: Place): Layer {
    // The outer box doesn't scroll and is the containing block for the design's own
    // position:fixed (drawers, sheets, toasts), so they stay on the stage, pinned, instead
    // of covering the shell. The inner box scrolls.
    const el = document.createElement('div')
    el.className = 'absolute inset-0 [contain:layout_paint]'
    // Each host runs its design while it is mounted; lobbies mount a host only while it is on or
    // near the screen, so a long grid or the full-size list costs what is visible, not all of it.
    const live = new Map<HTMLElement, () => void>()
    const generations = new WeakMap<HTMLElement, object>()
    let gone = false
    const pending: Promise<unknown>[] = []
    // A state that can't be reached says so where it would have been, instead of quietly
    // showing the design at rest.
    const missed = (host: HTMLElement, s: State, sel: string) => {
      console.warn(`[prototype] can't open "${s.name}": nothing matches ${sel}`)
      const box = host.closest<HTMLElement>('[data-chipbox]') ?? el
      box.insertAdjacentHTML('beforeend', `<div data-missed class="pointer-events-none absolute left-3 top-3 z-20 max-w-[calc(100%-1.5rem)] rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 shadow ring-1 ring-amber-500/30 dark:bg-amber-950 dark:text-amber-100">Couldn’t open <b>${bd(s.name)}</b>: nothing matches <code>${esc(sel)}</code></div>`)
    }
    const start = (host: HTMLElement, v: Variant, s?: State): Promise<unknown> => {
      if (live.has(host)) return Promise.resolve()
      live.set(host, () => {})
      const generation = {}; generations.set(host, generation)
      // Copy choices are kept per variant, so every place it is mounted reads the same words.
      copy.bind(host, routeOfFile(v.file))
      host.dataset.route = routeOfFile(v.file)
      markBuilding(host)
      const here = () => !gone && live.has(host) && generations.get(host) === generation
      return load(v).then(
        c => {
          if (!here()) return
          live.set(host, mount(host, c))
          if (s?.click.length) return replay(host, s.click, here).then(miss => { if (miss && here()) missed(host, s, miss) })
        },
        // A file that doesn't load yet while it is being built says so, quietly; its error shows
        // once it is done (setSession tries it again then).
        e => { if (here()) host.innerHTML = host.hasAttribute('data-building') ? `<div class="${BUILDING_CLASS}">Building…</div>` : `<pre class="${ERROR_CLASS}">${esc(e?.stack || e)}</pre>` })
    }
    const stop = (host: HTMLElement) => {
      const off = live.get(host)
      if (!off) return
      live.delete(host)
      try { off() } catch { /* already gone */ }
      host.replaceChildren()
    }
    let io: IntersectionObserver | null = null
    type Show = { v: Variant; s?: State }
    const mountAll = (list: Show[], lazy: boolean) => {
      const hosts = [...el.querySelectorAll<HTMLElement>('[data-mount]')]
      const of = new Map(hosts.map((h, i) => [h, list[i]]))
      if (!lazy) return hosts.forEach(h => pending.push(start(h, of.get(h)!.v, of.get(h)!.s)))
      io = new IntersectionObserver(entries => {
        for (const e of entries) { const h = e.target as HTMLElement, x = of.get(h)!; e.isIntersecting ? start(h, x.v, x.s) : stop(h) }
      }, { root: el.firstElementChild, rootMargin: '600px 0px' })
      hosts.forEach(h => io!.observe(h))
    }
    let window: VirtualList<Variant> | undefined, windowHost: HTMLElement | null = null
    let player: Layer['player']
    let remount: Layer['remount']
    let quit = () => {}
    if (p.view === 'variant') {
      const proto = byId(p.proto)!, v = proto.variants.find(x => x.id === p.variant)!, s = stateOf(proto, v.id, p.state)
      if (p.tool === 'all') {
        el.innerHTML = `<div class="h-full overflow-auto">${allStates(proto, v)}</div>`
        mountAll([{ v }, ...statesOf(proto, v.id).map(s => ({ v, s }))], true)
      } else if (p.tool === 'compare') {
        const o = proto.variants.find(x => x.id === otherOf(proto, v.id))!
        const pair = [o, v].sort((a, b) => proto.variants.indexOf(a) - proto.variants.indexOf(b))
        el.innerHTML = compareView(proto, v, o, s, pair)
        mountAll(pair.map(x => ({ v: x, s: stateOf(proto, x.id, p.state) })), false)
      } else if (p.tool === 'play') {
        el.innerHTML = playView(proto, v)
        ;({ player, quit } = autoplay(proto, v))
      } else {
        el.innerHTML = `<div class="h-full overflow-auto">${frameOf(proto)}</div>`
        mountAll([{ v, s }], false)
        // The motion dock mounts the design again to record its entrance (motion/).
        const host = el.querySelector<HTMLElement>('[data-mount]')!
        remount = () => { stop(host); return start(host, v, s) }
      }
    } else {
      el.innerHTML = `<div class="h-full overflow-auto">${p.view === 'proto' ? protoLobby(byId(p.proto)!) : sessionLobby()}</div>`
      if (p.view === 'proto') {
        const proto = byId(p.proto)!
        windowHost = el.querySelector<HTMLElement>('[data-virtual-preview]')
        if (windowHost) {
          const host = windowHost, stacked = st.stack, key = `${proto.id}:${stacked}`
          window = previewWindows.get(key)
          // Disconnect with the previous layer's lifecycle callbacks before changing ownership.
          window?.disconnect()
          const options = {
            items: lobbyOrder(proto), key: (v: Variant) => v.id,
            render: (v: Variant, _index: number, previous?: HTMLElement) => virtualHTML(stacked ? stackCard(proto, v) : gridCard(proto, v), previous),
            columns: (width: number) => stacked ? (proto.kind === 'phone' ? Math.max(1, Math.floor((width + 40) / ((proto.screen[0] + 20) * phoneZoom(proto.screen[0] + 20, proto.screen[1] + 20, el) + 40))) : 1) : Math.max(1, getComputedStyle(host).gridTemplateColumns.split(' ').length),
            columnWidth: stacked && proto.kind === 'phone' ? () => (proto.screen[0] + 20) * phoneZoom(proto.screen[0] + 20, proto.screen[1] + 20, el) : undefined,
            estimate: (_v: Variant, width: number) => stacked ? (proto.kind === 'phone' ? 44 + (proto.screen[1] + 20) * phoneZoom(proto.screen[0] + 20, proto.screen[1] + 20, el) : layers.clientHeight + 44) : width * (innerWidth < 640 && proto.kind === 'web' ? 1.4 : .625) + 32,
            gap: stacked ? 32 : 20, columnGap: stacked && proto.kind === 'phone' ? 40 : undefined, overscan: 1, cacheSize: stacked ? 8 : 40,
            onAttach: (cell: HTMLElement, v: Variant) => { for (const mount of cell.querySelectorAll<HTMLElement>('[data-mount]')) void start(mount, v) },
            onDetach: (cell: HTMLElement) => cell.querySelectorAll<HTMLElement>('[data-mount]').forEach(stop),
            onChange: () => { if (el.isConnected) fit() },
          }
          if (window) window.update(options)
          else window = new VirtualList(options)
          previewWindows.delete(key); previewWindows.set(key, window)
          window.connect(host, el.firstElementChild as HTMLElement)
          for (const [id, cached] of previewWindows) { if (previewWindows.size <= 4) break; if (!cached.element) { cached.destroy(); previewWindows.delete(id) } }
        } else mountAll(lobbyOrder(proto).map(v => ({ v })), true)
      }
      else mountAll(lobbyRoots().flatMap(q => lobbyOrder(q).slice(0, 1)).map(v => ({ v })), true)
    }

    // ---------- autoplay: a cursor clicks through each state while a timeline fills ----------
    function autoplay(proto: Proto, v: Variant) {
      const MOVE = 800, HOLD = 2200
      const list = statesOf(proto, v.id)
      const host = el.querySelector<HTMLElement>('[data-mount]')!, box = el.querySelector<HTMLElement>('[data-play-box]')!
      const cursor = el.querySelector<HTMLElement>('[data-cursor]')!
      let at = 0, playing = false, done = false, run = 0, fill: Animation | null = null
      const paint = () => {
        const s = list[at]
        el.querySelector('[data-play-label]')!.innerHTML = `${at + 1}/${list.length} · ${bd(s.name)}`
        el.querySelector('[data-play-note]')!.textContent = s.about?.[v.id] ?? ''
        el.querySelector('[data-play-btn]')!.innerHTML = `${ic(playing ? 'pause' : done ? 'replay' : 'play', 'size-4')}${playing ? '' : `<span>${done ? 'Again' : 'Play'}</span>`}`
        el.querySelector('[data-play-btn]')!.setAttribute('aria-label', playing ? 'Pause' : 'Play')
        el.querySelectorAll<HTMLElement>('[data-seg]').forEach((b, i) => { if (i !== at || !playing) b.style.width = i < at || done || (i === at && !playing) ? '100%' : '0%' })
        if (st.playing !== s.id) { st.playing = s.id; render() }
      }
      const point = (x: number, y: number) => { cursor.hidden = false; cursor.style.transform = `translate(${x}px, ${y}px)` }
      // One state: start the design fresh, then click through to the state, the cursor leading.
      async function reach(i: number, glide: boolean, my: number) {
        at = i
        paint()
        stop(host)
        await start(host, v)
        if (my !== run || gone) return
        const s = list[i]
        const miss = await replay(host, s.click, () => my === run && !gone, glide ? async target => {
          const b = target.getBoundingClientRect(), o = box.getBoundingClientRect()
          point(b.left - o.left + Math.min(b.width / 2, 48), b.top - o.top + b.height / 2)
          await wait(MOVE)
          cursor.querySelector('[data-ripple]')?.animate([{ transform: 'scale(.4)', opacity: .8 }, { transform: 'scale(1.6)', opacity: 0 }], { duration: 450, easing: 'ease-out' })
        } : undefined)
        if (miss && my === run) missed(host, s, miss)
      }
      async function loop(my: number) {
        for (let i = at; i < list.length; i++) {
          fill?.cancel()
          fill = el.querySelector<HTMLElement>(`[data-seg="${i}"]`)!.animate([{ width: '0%' }, { width: '100%' }], { duration: MOVE * list[i].click.length + HOLD + 400, fill: 'forwards' })
          await reach(i, true, my)
          if (my !== run || gone) return
          await wait(HOLD)
          if (my !== run || gone) return
        }
        playing = false; done = true; paint()
      }
      const play = () => { if (done) { done = false; at = 0 } run++; playing = true; paint(); loop(run) }
      const pause = () => { run++; playing = false; fill?.pause(); paint() }
      box.addEventListener('pointerdown', e => { if (e.isTrusted && playing) pause() }, true)
      pending.push(start(host, v))
      cursor.style.transition = 'none'
      cursor.style.transform = `translate(${box.clientWidth * 0.6}px, ${box.clientHeight * 0.75}px)`
      requestAnimationFrame(() => { cursor.style.transition = '' })
      const first = setTimeout(play, 700)
      paint()
      return {
        player: { toggle: () => (playing ? pause() : play()), jump: (i: number) => { run++; playing = false; done = false; fill?.cancel(); reach(i, false, run).then(paint) } },
        quit: () => { clearTimeout(first); run++; st.playing = '' },
      }
    }

    const ready = Promise.all(pending)
    return { el, refs: refsFor(p), ready, player, remount, refresh: () => window?.refresh(), dispose: () => { gone = true; quit(); io?.disconnect(); if (window?.element === windowHost) window?.disconnect(); [...live.keys()].forEach(stop) } }
  }

  // ---------- the tools' views ----------
  const dot = (proto: Proto, v: string, s?: State, on = false) => `<span class="mt-[5px] size-1.5 shrink-0 rounded-full ${s && changed(proto, v, s) ? 'bg-amber-500' : on ? 'bg-zinc-900 dark:bg-white' : 'bg-zinc-300 dark:bg-zinc-600'}"></span>`
  const noteCls = (proto: Proto, v: string, s: State) => changed(proto, v, s) ? 'text-amber-700/85 dark:text-amber-300/70' : 'text-zinc-500'
  const closeTool = (proto: Proto, v: Variant, t: Tool, label: string) => `<button data-act="tool:${esc(proto.id)}:${v.id}:${t}" aria-label="${label}" title="${label} · Esc" class="${IB} shrink-0">${ic('x')}</button>`

  function allStates(proto: Proto, v: Variant) {
    const card = (s?: State) => {
      const note = s?.about?.[v.id]
      return `<div data-chipbox class="relative min-w-0"><button data-act="pvs:${esc(proto.id)}:${v.id}:${esc(s?.id ?? '')}" class="group block w-full min-w-0 text-left">
        <div class="overflow-hidden rounded-lg ring-1 ring-black/10 transition group-hover:ring-2 group-hover:ring-zinc-900 dark:ring-white/10 dark:group-hover:ring-white">${thumb(proto, 'aspect-[16/10]')}</div>
        <div class="mt-2 flex items-start gap-2">${s ? dot(proto, v.id, s) : dot(proto, v.id)}<div class="min-w-0"><div dir="auto" class="font-semibold">${esc(s?.name ?? 'At rest')}</div>${note && s ? `<p dir="auto" class="mt-0.5 text-xs ${noteCls(proto, v.id, s)}">${esc(note)}</p>` : ''}</div></div></button></div>`
    }
    return `<div class="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 pt-5 sm:px-6"><h2 class="text-xl font-semibold tracking-tight">Every state of ${variantLabel(proto, v.id)} <span class="font-normal text-zinc-500">· ${bd(v.name)}</span></h2><p class="text-xs text-zinc-500">Click one to try it live</p><span class="ml-auto">${closeTool(proto, v, 'all', 'Close all states')}</span></div>
      <div class="${GRID} p-4 sm:p-6">${[undefined, ...statesOf(proto, v.id)].map(card).join('')}</div>`
  }

  function compareView(proto: Proto, v: Variant, o: Variant, s: State | undefined, pair: Variant[]) {
    const ref = refOf(proto)
    // The note shown is the one that says what changed: the non-reference side's.
    const side = v.id !== ref ? v : o
    const line = s ? (s.about?.[side.id] && side.id !== ref ? s.about[side.id] : '') : proto.about[side.id] ?? ''
    const others = proto.variants.filter(x => x.id !== v.id)
    const diffs = statesOf(proto, v.id).filter(x => changed(proto, v.id, x) || changed(proto, o.id, x))
    const pane = (x: Variant) => `<div class="flex min-h-0 min-w-0 flex-1 flex-col">
        <div class="flex h-9 shrink-0 items-center gap-2 border-b border-black/[.07] px-3 text-xs dark:border-white/10"><b>${variantLabel(proto, x.id)}</b><span dir="auto" class="truncate text-zinc-500">${esc(x.name)}</span>${x.id === v.id ? '' : `<button data-act="pvs:${esc(proto.id)}:${x.id}:${esc(s?.id ?? '')}" class="ml-auto shrink-0 rounded-md px-1.5 py-1 text-zinc-500 hover:bg-zinc-900/5 hover:text-zinc-900 dark:hover:bg-white/10 dark:hover:text-white">Open ${variantLabel(proto, x.id)}</button>`}</div>
        <div data-fit data-chipbox ${x.id !== ref ? 'data-compare' : ''} class="relative min-h-0 flex-1 [contain:layout_paint]"><div class="absolute inset-0 overflow-auto">${frameOf(proto)}</div></div></div>`
    return `<div class="flex h-full flex-col">
      <div class="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-amber-500/30 bg-amber-50 px-3 py-2 text-xs dark:bg-amber-500/10">
        <span class="flex items-center gap-1.5 font-semibold text-amber-900 dark:text-amber-200">${variantLabel(proto, v.id)} against${others.length > 1 ? `<span class="flex gap-0.5 rounded-md bg-amber-500/10 p-0.5">${others.map(x => `<button data-act="vs:${x.id}" aria-pressed="${x.id === o.id}" class="h-6 min-w-6 rounded px-1.5 ${x.id === o.id ? 'bg-white text-amber-900 shadow-sm dark:bg-amber-200 dark:text-amber-950' : 'text-amber-800 hover:bg-amber-500/15 dark:text-amber-200'}">${variantLabel(proto, x.id)}</button>`).join('')}</span>` : ` ${variantLabel(proto, o.id)}`}</span>
        <span class="min-w-0 flex-1 text-amber-900/80 dark:text-amber-200/80"><b class="font-medium">${bd(s?.name ?? 'At rest')}</b>${line ? ` · ${bd(line)}` : ''}</span>
        ${diffs.length ? `<button data-act="nextdiff" class="flex h-8 items-center gap-1 rounded-lg bg-amber-500/15 px-2.5 font-medium text-amber-900 hover:bg-amber-500/25 dark:text-amber-200">Next difference${ic('right', 'size-3.5')}</button>` : ''}
        ${closeTool(proto, v, 'compare', 'Stop comparing')}
      </div>
      <div class="flex min-h-0 flex-1 flex-col divide-y divide-black/[.07] md:flex-row md:divide-x md:divide-y-0 dark:divide-white/10">${pair.map(pane).join('')}</div></div>`
  }

  function playView(proto: Proto, v: Variant) {
    const list = statesOf(proto, v.id)
    return `<div class="flex h-full flex-col">
      <div data-play-box class="relative min-h-0 flex-1">
        <div data-fit data-chipbox class="absolute inset-0 overflow-auto [contain:layout_paint]">${frameOf(proto)}</div>
        <div data-cursor hidden class="pointer-events-none absolute left-0 top-0 z-30 transition-transform duration-700 ease-in-out" style="transform:translate(60%,70%)"><span data-ripple class="absolute -left-4 -top-4 size-8 rounded-full bg-sky-400/50 opacity-0"></span><svg width="22" height="22" viewBox="0 0 24 24" class="drop-shadow-md"><path d="M4 2l16 9-7 2-3 7z" fill="#18181b" stroke="white" stroke-width="1.5" stroke-linejoin="round"/></svg></div>
      </div>
      <div class="flex shrink-0 items-center gap-3 border-t border-black/[.07] bg-white px-3 py-2 dark:border-white/10 dark:bg-zinc-950">
        <button data-act="play:toggle" data-play-btn class="flex h-10 shrink-0 items-center justify-center gap-2 rounded-full bg-zinc-900 px-3.5 text-sm font-semibold text-white hover:bg-zinc-700 dark:bg-white dark:text-zinc-900"></button>
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2 text-xs"><span data-play-label class="shrink-0 font-semibold"></span><span data-play-note dir="auto" class="truncate text-zinc-500"></span></div>
          <div class="mt-1 flex gap-1">${list.map((s, i) => `<button data-act="play:jump:${i}" title="${esc(s.name)}" aria-label="${esc(s.name)}" class="group flex-1 py-1.5"><span class="block h-1.5 overflow-hidden rounded-full bg-zinc-200 group-hover:bg-zinc-300 dark:bg-zinc-800 dark:group-hover:bg-zinc-700"><span data-seg="${i}" class="block h-full w-0 rounded-full ${changed(proto, v.id, s) ? 'bg-amber-500' : 'bg-sky-500'}"></span></span></button>`).join('')}</div>
        </div>
        ${closeTool(proto, v, 'play', 'Stop autoplay')}
      </div></div>`
  }

  // A lobby keeps its scroll for when it is shown again (Back from a variant), as a page would:
  // each place gets a new layer, so without this it always came back at the top.
  const lobbyScroll = new Map<string, number>()
  let lobbyKey = ''
  const scrollerOf = (l: Layer) => l.el.firstElementChild as HTMLElement | null
  function show(fade: boolean) {
    if (layer && lobbyKey) lobbyScroll.set(lobbyKey, scrollerOf(layer)?.scrollTop ?? 0)
    const next = buildLayer(st.place)
    const prev = layer
    layer = next
    lobbyKey = st.place.view === 'variant' ? '' : hashOf(st.place) + (st.stack ? ':stack' : '')
    layers.prepend(next.el)
    next.refresh?.()
    fit()
    const at = lobbyKey ? lobbyScroll.get(lobbyKey) ?? 0 : 0
    const sc = at ? scrollerOf(next) : null
    if (sc) {
      // Again once the designs in it have mounted (they can make it taller), unless the user has
      // scrolled it since.
      let moved = false
      const mine = () => { moved = true }
      for (const t of ['wheel', 'touchstart', 'pointerdown', 'keydown']) sc.addEventListener(t, mine, { once: true, passive: true })
      const put = () => { if (!moved && layer === next) { sc.scrollTop = at; next.refresh?.() } }
      put()
      requestAnimationFrame(put)
      Promise.race([next.ready, wait(1500)]).then(put)
    }
    if (!prev) return
    // The new design reaches its state under the old one, which then fades out on top.
    prev.el.inert = true
    const drop = () => { prev.el.remove(); prev.dispose() }
    Promise.race([next.ready, wait(1500)]).then(() => (fade ? fadeOut(prev.el, drop) : drop()))
  }

  function fit() {
    // At Fit a phone card stays 16:10 with the phone as it would sit in a 1200px-wide frame. At a
    // set scale the card grows to the phone at that size, kept within the card's width.
    const scale = st.place.view === 'session' ? 0 : st.scale
    // A web design's card shows it at the width the page is seen at: desktop on a wide screen, the
    // phone layout on a phone (its breakpoints follow the window, so a 1200px canvas there drew the
    // phone layout stretched).
    const narrow = innerWidth < 640, w = narrow ? Math.max(320, Math.round(innerWidth)) : 1200, h = narrow ? Math.round(w * 1.4) : 750
    const thumbs = [...layers.querySelectorAll<HTMLElement>('[data-thumb]')]
    // Every size written first, then every width read once, so the page lays out once, not per card.
    for (const t of thumbs) {
      const inner = t.firstElementChild as HTMLElement
      if (!t.hasAttribute('data-pthumb')) {
        inner.style.width = `${w}px`
        inner.style.height = `${h}px`
        t.style.aspectRatio = narrow ? `${w} / ${h}` : ''
      } else {
        t.style.aspectRatio = scale ? 'auto' : ''
        t.style.paddingBlock = scale ? '20px' : ''
      }
    }
    for (const [t, cw] of thumbs.map(t => [t, t.clientWidth] as const)) {
      if (!cw) continue
      const inner = t.firstElementChild as HTMLElement
      inner.style.zoom = String(!t.hasAttribute('data-pthumb') ? cw / w : scale ? Math.min(scale / 100, (cw - 24) / parseFloat(inner.style.width)) : .78 * cw / 1200)
    }
    if (layer) fitBox(layer.el)
  }
  function phoneZoom(w: number, h: number, room: HTMLElement) {
    const auto = [100, 75, 50].find(s => h * s / 100 <= room.clientHeight - 48 && w * s / 100 <= room.clientWidth - 24) ?? 40
    return (st.scale || auto) / 100
  }
  function fitBox(box: HTMLElement) {
    box.style.setProperty('--stage-h', `${box.clientHeight}px`)
    for (const phone of box.querySelectorAll<HTMLElement>('[data-phone]')) {
      const room = phone.closest<HTMLElement>('[data-fit]') ?? box
      const w = parseFloat(phone.style.width), h = parseFloat(phone.style.height)
      phone.style.zoom = String(phoneZoom(w, h, room))
    }
  }
  // The stage changes size with the window, and when the motion dock under it grows or shrinks.
  const resized = new ResizeObserver(fit)
  resized.observe(zone)
  resized.observe(layers)

  // ---------- navigation ----------
  function go(p: Place) {
    if (!valid(p)) p = defaultPlace()
    if (location.hash !== hashOf(p)) location.hash = hashOf(p)
    else arrive(p, true)
  }
  // Choosing a variant something was built from, or a prototype, inside the switcher's columns
  // (or the phone's sheet) keeps them open on what comes next.
  let keepOpen = false, recenter = true
  function arrive(p: Place, fade: boolean) {
    recenter = true
    const moved = JSON.stringify(p) !== JSON.stringify(st.place) || !layer
    st.place = p
    if (!keepOpen) { st.open = null; st.menu = ''; st.drawer = false }
    keepOpen = false
    st.pairAt = null
    st.drill = null
    st.sheet = false
    trySheet = 'closed'
    tweaksOpen = false
    closeCard(true)
    if (p.view !== 'variant') st.focus = false
    remember(`proto-place-${session.id}`, hashOf(p))
    if (moved) show(fade && !!layer)
    render()
    if (moved) side.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest' })
  }
  addEventListener('hashchange', () => {
    // The page in a view goes where the page outside is. A place it doesn't know yet (a variant just
    // added, before its module reaches this page) it waits for (setProtos), instead of falling back
    // somewhere the page outside would then follow.
    if (framed && !parseHash()) return
    const p = parseHash() ?? defaultPlace()
    if (location.hash !== hashOf(p)) history.replaceState(null, '', hashOf(p))
    arrive(p, true)
  })

  function step(d: number) {
    const proto = cur()
    if (!proto || !proto.variants.length) return
    const ids = visible(proto).map(v => v.id)
    const i = st.place.view === 'variant' ? ids.indexOf(st.place.variant) : -1
    go(keepIn(proto, ids[(i + d + ids.length) % ids.length]))
  }
  const openProto = (id: string) => {
    const proto = byId(id)!
    const w = workOf()
    const v = w?.p === proto ? w.v.id : st.editing?.proto === id ? st.editing.variant : proto.variants[0]?.id
    go(v ? { view: 'variant', proto: id, variant: v } : { view: 'proto', proto: id })
  }

  // ---------- lobbies ----------
  function lifecycle() {
    const s = st.status
    if (st.stopped) return `Server stopped. Ask ${agentName(session.agent)} to start it again.`
    if (!s) return ''
    const until = new Date(s.lastEdit + s.deleteDays * 864e5).toLocaleDateString([], { month: 'short', day: 'numeric' })
    return `Idle stop ${s.idleHours}h · ${s.keep ? 'Kept' : `Deletes ${until}`}`
  }

  const newestFirst = () => active().slice().reverse()
  // The session lobby has a card per top-level prototype; what was built from it is listed in it.
  const lobbyRoots = () => newestFirst().filter(isRoot)
  const GRID = 'grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'
  const NEST = 'bg-sky-500/10 text-sky-700 hover:bg-sky-500/20 dark:text-sky-300'
  // Where it came from, a chip each: what it nests under, then the others it combines after a
  // plus ("B" alone when it is another variant of the same prototype).
  const fromChips = (p: Proto) => sources(p).map((s, i) => `<button data-act="${s.v && s.p.variants.some(x => x.id === s.v) ? `pv:${esc(s.p.id)}:${esc(s.v)}` : `lobby:proto:${esc(s.p.id)}`}" class="inline-flex h-7 max-w-full items-center gap-1.5 rounded-full px-2.5 text-xs font-medium ${NEST}">${ic(i ? 'plus' : 'from', 'size-3.5')}<span class="truncate">${i ? srcName(p, s, ' · ') : `Built from ${bd(s.p.title)}${s.v ? ` · ${esc(variantLabel(s.p, s.v))}` : ''}`}</span></button>`).join('')
  const kidChips = (p: Proto, v: string) => builtFrom(p, v).map(k => `<button data-act="lobby:proto:${esc(k.id)}" class="mt-1.5 flex h-8 w-full items-center gap-1.5 rounded-lg px-2 text-xs font-medium ${NEST}">${ic('branch', 'size-3.5')}<span dir="auto" class="truncate">${esc(k.title)}</span><span class="ml-auto tabular-nums opacity-70">${k.variants.length}</span></button>`).join('')

  // A card's rows say which variant each came from; one that combines others names them after a
  // plus. That part only takes the room the title leaves (flex-1 starts from nothing), so a title
  // that fits is never cut for it; the tooltip has all of it.
  function sessionLobby() {
    const list = lobbyRoots()
    if (!list.length) return `<div class="grid min-h-full place-items-center p-8 text-center"><div><div class="mx-auto mb-4 grid size-10 place-items-center">${pulse('size-2.5', st.live)}</div><h2 dir="auto" class="text-base font-semibold">${esc(session.name)}</h2><p class="mt-1 text-zinc-500">Waiting for the first prototype. This page updates by itself.</p></div></div>`
    const all = active().length
    const nested = all - list.length
    return `<div class="p-4 sm:p-6"><div class="mb-5 flex flex-wrap items-end justify-between gap-2"><div><h2 dir="auto" class="text-xl font-semibold tracking-tight">${esc(session.name)}</h2><p class="text-xs text-zinc-500">${all} prototype${all === 1 ? '' : 's'}${nested ? `, ${nested} built from others` : ''} · started ${clock(session.createdAt)}</p></div><p data-lifecycle class="text-xs text-zinc-400">${esc(lifecycle())}</p></div>
      <div class="${GRID}">${list.map(p => `<div class="min-w-0 rounded-xl p-2 ring-1 ring-black/[.07] has-[[data-card]:hover]:bg-zinc-50 has-[[data-card]:hover]:ring-black/20 dark:ring-white/10 dark:has-[[data-card]:hover]:bg-white/5"><button data-card data-act="lobby:proto:${esc(p.id)}" class="block w-full min-w-0 text-left">
        ${p.variants.length ? `<div class="overflow-hidden rounded-md ring-1 ring-black/5 dark:ring-white/10">${thumb(p, 'aspect-[16/10]')}</div>` : '<div class="aspect-[16/10] rounded-md bg-zinc-900/[.03] dark:bg-white/[.04]"></div>'}
        <div class="mt-3 flex items-center gap-2 px-1"><span dir="auto" class="truncate font-semibold">${esc(p.title)}</span>${editing(p.id) ? pulse('size-1.5') : ''}<span class="ml-auto shrink-0 text-xs text-zinc-400">${p.variants.length} variant${p.variants.length === 1 ? '' : 's'} · ${pickOf(p) ? `<span class="inline-flex items-center gap-0.5 align-top font-medium ${PICK}">${ic('check', 'size-3')}Picked ${esc(variantLabel(p, pickOf(p)))}</span>` : clock(p.created)}</span></div>
        <div dir="auto" class="truncate px-1 pb-1 text-xs text-zinc-500">${p.ask ? `“${esc(p.ask)}”` : ''}</div></button>
        ${family(p).map(({ p: k, depth }) => `<button data-act="lobby:proto:${esc(k.id)}" class="flex h-8 w-full min-w-0 items-center gap-1.5 rounded-lg pr-1 text-left text-xs text-zinc-600 hover:bg-zinc-900/[.04] dark:text-zinc-400 dark:hover:bg-white/[.06]" style="padding-left:${4 + nestIndent(depth) - nestIndent(1)}px">${ic('branch', 'size-3.5 text-sky-500')}<span dir="auto" class="truncate">${esc(k.title)}</span>${pickChip(k)}${editingUnder(k) ? pulse('size-1.5') : ''}${k.from!.variant ? `<span class="shrink-0 text-zinc-400">from ${esc(k.from!.variant)}</span>` : ''}${alsoOf(k).length ? (t => `<span title="${t.replace(/<\/?bdi>/g, '')}" class="min-w-8 flex-1 truncate text-zinc-400">${t}</span>`)(alsoOf(k).map(s => `+ ${srcName(k, s)}`).join(' ')) : ''}<span class="ml-auto shrink-0 tabular-nums text-zinc-400">${k.variants.length}</span></button>`).join('')}</div>`).join('')}</div></div>`
  }

  function protoLobby(p: Proto) {
    const tab = (on: boolean, act: string, icon: string, label: string) => `<button data-act="${act}" aria-pressed="${on}" title="${label}" class="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs ${on ? TAB_ON : TAB_OFF}">${ic(icon, 'size-3.5')}<span class="hidden sm:inline">${label}</span></button>`
    const layoutToggle = `<div class="flex gap-0.5 rounded-lg bg-zinc-900/[.04] p-0.5 dark:bg-white/[.06]">${tab(!st.stack, 'stack:0', 'grid', 'Grid')}${tab(st.stack, 'stack:1', 'rows', 'Full size')}</div>`
    return `<div class="flex flex-wrap items-end justify-between gap-2 px-4 pt-5 sm:px-6"><div class="min-w-0">${sources(p).length ? `<div class="mb-2 flex flex-wrap gap-1.5">${fromChips(p)}</div>` : ''}<h2 class="flex items-center gap-2 text-xl font-semibold tracking-tight">${bd(p.title)}${pickOf(p) ? `<span class="inline-flex h-6 items-center gap-1 rounded-full bg-emerald-500/10 px-2 text-xs font-semibold tracking-normal ${PICK}">${ic('check', 'size-3.5')}Picked ${esc(variantLabel(p, pickOf(p)))}</span>` : ''}</h2><p class="text-xs text-zinc-500">${p.ask ? `<bdi>“${esc(p.ask)}”</bdi> · ` : ''}${p.variants.length} variant${p.variants.length === 1 ? '' : 's'} · ${clock(p.created)}</p>${wholeKids(p).length ? `<div class="mt-2 flex flex-wrap gap-1.5">${wholeKids(p).map(k => `<button data-act="lobby:proto:${esc(k.id)}" class="inline-flex h-7 max-w-full items-center gap-1.5 rounded-full px-2.5 text-xs font-medium ${NEST}">${ic('branch', 'size-3.5')}<span dir="auto" class="truncate">${esc(k.title)}</span></button>`).join('')}</div>` : ''}</div>${p.variants.length ? layoutToggle : '<p class="text-xs text-zinc-400">No variants yet</p>'}</div>
      ${st.stack ? stack(p) : protoGrid(p)}`
  }

  function gridCard(p: Proto, v: Variant) {
    const k = pickOf(p)
    return `<div class="min-w-0 ${k && v.id !== k ? 'opacity-60 transition-opacity hover:opacity-100 focus-within:opacity-100' : ''}"><button data-act="pv:${esc(p.id)}:${v.id}" class="group block w-full min-w-0 text-left">
        <div class="overflow-hidden rounded-lg transition ${v.id === k ? 'ring-2 ring-emerald-500' : 'ring-1 ring-black/10 group-hover:ring-2 group-hover:ring-zinc-900 dark:ring-white/10 dark:group-hover:ring-white'}">${thumb(p, 'aspect-[16/10]')}</div>
        <div class="mt-2 flex items-center gap-2"><span class="font-semibold">${variantLabel(p, v.id)}</span><span class="truncate text-zinc-500">${esc(v.name)}</span>${v.id === k ? `<span class="inline-flex shrink-0 items-center gap-1 text-xs font-medium ${PICK}">${ic('check', 'size-3.5')}Picked</span>` : ''}${editing(p.id, v.id) ? `<span class="ml-auto inline-flex items-center gap-1.5 text-xs text-emerald-600">${pulse('size-1.5')}${building(p.id, v.id) ? 'building' : 'editing'}</span>` : ''}</div></button>${kidChips(p, v.id)}</div>`
  }
  function protoGrid(p: Proto) {
    return `<div ${p.variants.length > VIRTUAL_THRESHOLD ? 'data-virtual-preview' : ''} class="${GRID} p-4 sm:p-6">${p.variants.length > VIRTUAL_THRESHOLD ? '' : lobbyOrder(p).map(v => gridCard(p, v)).join('')}</div>`
  }

  // Every variant at full size, one after another, live. Each frame is at least as tall as the
  // stage (a grid, so a root with h-full fills it) and contains its own position:fixed.
  function stackCard(p: Proto, v: Variant) {
    const head = (v: Variant) => `<div class="mb-3 flex h-8 min-w-0 items-center gap-2 ${p.kind === 'phone' ? 'justify-center' : ''}"><button data-act="pv:${esc(p.id)}:${v.id}" title="Open ${variantLabel(p, v.id)}" class="flex min-w-0 cursor-pointer items-center gap-2 rounded-md hover:underline hover:decoration-zinc-400 hover:underline-offset-4"><span class="font-semibold">${variantLabel(p!, v.id)}</span><span dir="auto" class="truncate text-zinc-500">${esc(v.name)}</span></button>${v.id === pickOf(p) ? `<span class="inline-flex shrink-0 items-center gap-1 text-xs font-medium ${PICK}">${ic('check', 'size-3.5')}Picked</span>` : ''}${editing(p.id, v.id) ? pulse('size-1.5') : ''}${builtFrom(p, v.id).map(k => `<button data-act="lobby:proto:${esc(k.id)}" class="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium ${NEST}">${ic('branch', 'size-3.5')}${bd(k.title)}</button>`).join('')}</div>`
    return p.kind === 'phone' ? `<section data-stack-item class="min-w-0">${head(v)}<div data-phone class="${PHONE} [contain:layout_paint]" style="${phoneSize(p)}"><div data-mount class="h-full overflow-y-auto"></div></div></section>` : `<section data-stack-item><div class="px-4 sm:px-6">${head(v)}</div><div class="grid min-h-[var(--stage-h)] border-y border-black/[.07] bg-white [contain:layout_paint] dark:border-white/10 dark:bg-zinc-950"><div data-mount class="min-w-0"></div></div></section>`
  }
  function stack(p: Proto) {
    const large = p.variants.length > VIRTUAL_THRESHOLD
    const cls = p.kind === 'phone' ? 'flex flex-wrap justify-center gap-x-10 gap-y-8 p-4 sm:p-6' : 'space-y-8 py-4 sm:py-6'
    return `<div ${large ? 'data-virtual-preview' : ''} class="${cls}">${large ? '' : lobbyOrder(p).map(v => stackCard(p, v)).join('')}</div>`
  }

  // ---------- chrome ----------
  function render() {
    layers.querySelectorAll<HTMLElement>('[data-route]').forEach(markBuilding)
    // Scrolled lists in the chrome keep their place when it is redrawn (a status ping, an edit).
    const keepScroll = (host: HTMLElement, html: string) => {
      const was = new Map([...host.querySelectorAll<HTMLElement>('[data-k]')].map(el => [el.dataset.k!, [el.scrollTop, el.scrollLeft]]))
      // The button with the keyboard's focus is drawn again: it keeps the focus.
      const f = document.activeElement as HTMLElement | null, fAct = f && host.contains(f) ? f.dataset.act : undefined
      const fList = fAct ? f?.closest<HTMLElement>('[data-vlist]')?.dataset.k : undefined
      const fVariant = fAct ? f?.closest<HTMLElement>('[data-mv]')?.dataset.mv?.split(':').at(-1) : undefined
      const fAt = fAct ? [...host.querySelectorAll(`[data-act="${CSS.escape(fAct)}"]`)].indexOf(f!) : -1
      detachNav(host)
      host.innerHTML = html
      const windows = bindNav(host, host === side ? 'side' : host === drawer ? 'drawer' : 'bar')
      for (const el of host.querySelectorAll<HTMLElement>('[data-k]')) { const at = was.get(el.dataset.k!); if (at) [el.scrollTop, el.scrollLeft] = at }
      windows.forEach(window => window.refresh())
      if (fAct) {
        const selector = `[data-act="${CSS.escape(fAct)}"]`, all = host.querySelectorAll<HTMLElement>(selector)
        const to = all[fAt] ?? all[0]
        if (to) to.focus({ preventScroll: true })
        else if (fList && fVariant) {
          const list = host.querySelector<HTMLElement>(`[data-vlist][data-k="${CSS.escape(fList)}"]`)
          const window = list && navLists.get(list)
          const index = window?.items.findIndex(v => v.id === fVariant) ?? -1
          if (index >= 0) window?.focus(index, selector)
          const at = was.get(fList)
          if (list && at) [list.scrollTop, list.scrollLeft] = at
          window?.refresh()
        }
      }
    }
    const p = cur()
    const view = st.place.view
    const vid = st.place.view === 'variant' ? st.place.variant : ''
    const vs = p ? visible(p) : []
    const many = vs.length > 7
    const at = Math.max(0, vs.findIndex(v => v.id === vid))
    const from = many ? Math.min(Math.max(0, at - 2), vs.length - 5) : 0
    const shown = many ? vs.slice(from, from + 5) : vs
    const phones = p?.kind === 'phone' && view !== 'session'
    const scaleStep = (d: number, icon: string, label: string) => `<button data-act="scalestep:${d}" aria-label="${label}" title="${label}" class="grid size-10 shrink-0 place-items-center rounded-lg text-zinc-500 hover:bg-zinc-900/5 hover:text-zinc-900 dark:hover:bg-white/10 dark:hover:text-white">${ic(icon)}</button>`
    const sc = scaleNow(), [scLo, scHi] = scaleRange()
    const scaleMenu = `<div class="space-y-1.5 p-2"><div class="flex gap-0.5 rounded-lg bg-zinc-900/[.04] p-0.5 dark:bg-white/[.06]">${SCALES.map(s => `<button data-act="scale:${s}" data-scale-seg="${s}" aria-pressed="${sc === s}" class="${segCls(sc === s)}">${s ? s + '%' : 'Fit'}</button>`).join('')}</div>
      <div class="flex items-center">${scaleStep(-5, 'minus', 'Smaller')}<input data-scale-range type="range" min="${scLo}" max="${scHi}" step="1" value="${sc || 50}" aria-label="${frameOn() ? 'Zoom' : 'Phone scale'}" class="${RANGE} ${sc ? '' : 'opacity-40'}" style="--p:${rangeAt(sc || 50)}%">${scaleStep(5, 'plus', 'Bigger')}</div></div>`

    const row = (lead: string, body: string, end = '') => `<div class="flex min-h-10 items-center gap-3 rounded-lg px-2.5 py-2 text-[13px] text-zinc-700 dark:text-zinc-300">${lead}<div class="min-w-0 flex-1">${body}</div>${end}</div>`

    const keep = !!st.status?.keep
    const sessionHead = `<div class="px-4 pb-2.5 pt-4"><div dir="auto" class="text-[15px] font-semibold">${esc(session.name)}</div><div class="mt-0.5 truncate text-xs text-zinc-500">${esc(session.path)} · started ${clock(session.createdAt)}</div></div>`
    const sessionBody = `<div class="space-y-0.5 px-1.5 pb-1.5">
        ${row(`<span class="grid size-4 place-items-center">${pulse('size-2', st.live && !st.stopped)}</span>`, st.stopped ? 'Stopped' : st.live ? `Live <span class="ml-1 text-xs text-zinc-400">${st.lastEdit ? `edited <span data-ago="${st.lastEdit}">${ago(st.lastEdit)}</span>` : 'waiting for edits'}</span>` : 'Reconnecting…')}
        ${row(ic('link', 'size-4 text-zinc-400'), `<span class="block truncate">${esc((session.url || location.origin).replace(/^https?:\/\//, ''))}</span>`, `<button data-act="copy" class="h-7 shrink-0 rounded-md px-2 text-xs text-zinc-500 hover:bg-zinc-900/5 dark:hover:bg-white/10">${st.copied ? 'Copied' : 'Copy'}</button>`)}
        ${lifecycle() ? row(ic('clock', 'size-4 self-start mt-0.5 text-zinc-400'), esc(lifecycle()).replace(' · ', '<span class="block text-xs leading-5 text-zinc-400">') + '</span>') : ''}
      </div>${SEP}
      <div class="p-1.5"><button data-act="settings" aria-haspopup="dialog" class="flex h-11 w-full items-center gap-3 rounded-lg px-3 text-zinc-700 hover:bg-zinc-900/5 dark:text-zinc-300 dark:hover:bg-white/5">${ic('settings')}Settings<span class="ml-auto text-zinc-400">${ic('right', 'size-3.5')}</span></button></div>${SEP}
      <div class="flex gap-2 p-3"><button data-act="keep" ${st.stopped ? 'disabled' : ''} class="h-9 flex-1 rounded-lg border border-black/10 text-xs font-medium hover:bg-zinc-900/[.03] disabled:opacity-40 dark:border-white/10 dark:hover:bg-white/5">${keep ? 'Don’t keep' : 'Keep forever'}</button><button data-act="stop" ${st.stopped ? 'disabled' : ''} class="h-9 flex-1 rounded-lg text-xs text-zinc-500 hover:bg-zinc-900/5 disabled:opacity-40 dark:hover:bg-white/10">Stop server</button></div>${st.failed?.at === 'session' ? `<p role="alert" class="-mt-1 mx-3 mb-3 rounded-lg bg-rose-500/10 px-2.5 py-1.5 text-xs text-rose-700 dark:text-rose-300">${esc(st.failed.text)}</p>` : ''}`
    const sessionMenu = sessionHead + sessionBody

    const protoRow = ({ p: q, depth }: { p: Proto; depth: number }) => { const on = q.id === p?.id && view !== 'session'; return `<button data-act="proto:${esc(q.id)}" aria-current="${on}" class="flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left ${on ? 'bg-zinc-900/[.05] dark:bg-white/[.08]' : 'hover:bg-zinc-900/[.03] dark:hover:bg-white/5'}" style="padding-left:${10 + nestIndent(depth)}px">
        <span class="mt-[7px] flex size-1.5 shrink-0">${editing(q.id) ? pulse('size-1.5') : ''}</span>
        <span class="min-w-0 flex-1"><span class="flex items-center gap-1.5 ${on ? 'font-semibold text-zinc-900 dark:text-white' : 'font-medium text-zinc-800 dark:text-zinc-200'}">${depth ? ic('branch', 'size-3.5 shrink-0 text-sky-500') : ''}${bd(q.title)}${q.kind === 'phone' ? ic('phone', 'size-3.5 text-zinc-400') : ''}</span>${q.ask ? `<span dir="auto" class="block truncate text-xs leading-5 text-zinc-500">“${esc(q.ask)}”</span>` : ''}</span>
        <span class="shrink-0 pt-px text-right text-[11px] leading-5 tabular-nums text-zinc-400">${q.variants.length} variant${q.variants.length === 1 ? '' : 's'}<br>${editing(q.id) ? '<span class="text-emerald-600">editing now</span>' : pickOf(q) ? `<span class="${PICK}">picked ${esc(variantLabel(q, pickOf(q)))}</span>` : clock(q.created)}</span></button>` }
    const protoList = `<div class="max-h-[min(26rem,60vh)] space-y-px overflow-y-auto p-1">${treeOrder().map(protoRow).join('') || '<p class="px-3 py-4 text-xs text-zinc-400">None yet</p>'}</div>
      ${archived().length ? `${SEP}<div class="p-1.5"><button data-act="archived" class="flex h-10 w-full items-center gap-2 rounded-lg px-3 text-xs text-zinc-400 hover:bg-zinc-900/[.03] hover:text-zinc-600 dark:hover:bg-white/5 dark:hover:text-zinc-200">${ic(st.archived ? 'chev' : 'right', 'size-3')}Archived<span class="ml-auto tabular-nums">${archived().length}</span></button>${st.archived ? archived().map(q => `<button data-act="proto:${esc(q.id)}" class="flex h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-zinc-400 hover:bg-zinc-900/[.03] dark:hover:bg-white/5"><span class="size-1.5"></span><span dir="auto" class="line-through decoration-zinc-300">${esc(q.title)}</span><span class="ml-auto text-[11px] tabular-nums">${q.variants.length} variants</span></button>`).join('') : ''}</div>` : ''}`
    const protoMenu = `<div class="px-3.5 pb-0.5 pt-3 text-[11px] font-medium text-zinc-400">Prototypes in this session</div>${protoList}`

    const v = vs.find(v => v.id === vid)
    // Where in the variant: its state, and the tool it is shown through.
    const pv = st.place.view === 'variant' ? st.place : null
    const stateName = p && pv ? stateOf(p, pv.variant, pv.tool === 'play' ? st.playing : pv.state)?.name ?? '' : ''
    const toolName = pv?.tool ? pv.tool === 'compare' ? `vs ${otherOf(p!, pv.variant)}` : TOOLS[pv.tool].name : ''
    const where = pv ? [toolName, stateName].filter(Boolean).join(' · ') : ''
    // A state name alone takes its own direction; after the tool's name it is isolated in the line.
    const whereHtml = toolName ? `${esc(toolName)}${stateName ? ` · ${bd(stateName)}` : ''}` : esc(stateName)
    const initial = esc((session.name.trim()[0] || 'P').toUpperCase())
    // What this prototype was built from, oldest first.
    const line = p && view !== 'session' ? lineage(p) : []
    // On a phone the bar is back, title and session: back goes one level up (to the variant this
    // was built from, else the session), the title opens the prototypes, ⋯ the session. The
    // variants and the page's tools are in the pill.
    const up = view === 'session' ? null : line.length
      ? (a => ({ act: a.p.variants.some(x => x.id === a.v) ? `pv:${esc(a.p.id)}:${esc(a.v)}` : `lobby:proto:${esc(a.p.id)}`, label: a.p.title }))(line.at(-1)!)
      : { act: 'lobby:session', label: session.name }
    const phoneBar = `<div class="grid min-w-0 flex-1 grid-cols-[1fr_auto_1fr] items-center gap-1 sm:hidden">
        <div class="flex min-w-0">${up ? `<button data-act="${up.act}" class="flex h-9 min-w-0 items-center gap-0.5 rounded-lg pr-2 text-zinc-600 active:bg-zinc-900/5 dark:text-zinc-400 dark:active:bg-white/10">${ic('left', 'size-5')}<span dir="auto" class="truncate">${esc(up.label)}</span></button>` : ''}</div>
        <button data-act="menu:protos" aria-haspopup="dialog" class="flex h-10 min-w-0 max-w-[13rem] items-center gap-1 rounded-lg px-2 active:bg-zinc-900/5 dark:active:bg-white/10"><span class="min-w-0 leading-tight"><span dir="auto" class="block truncate font-semibold">${esc(view === 'session' ? session.name : p!.title)}</span>${where ? `<span dir="auto" class="block truncate text-[11px] font-medium text-sky-700 dark:text-sky-300">${whereHtml}</span>` : v ? `<span dir="auto" class="block truncate text-[11px] text-zinc-500">${variantLabel(p!, v.id)} · ${esc(v.name)}</span>` : ''}</span>${ic('chev', 'size-3.5 shrink-0 text-zinc-400')}</button>
        <div class="flex justify-end">${settingsBtn(true)}</div>
      </div>`
    // The switcher: where you are on two lines (the prototype and variant, then the session and
    // what it was built from), opening the whole session as columns.
    const sub = view === 'session' ? `${active().length} prototype${active().length === 1 ? '' : 's'}`
      : [session.name, ...line.map(a => `${a.p.title} ${a.v}`)].map(t => `<span dir="auto" class="min-w-0 max-w-[12rem] shrink truncate">${esc(t)}</span>`).join(ic('right', 'size-3 shrink-0 text-zinc-400'))
        // Then the others it combines, each after a plus.
        + alsoOf(p!).map(s => `${ic('plus', 'size-3 shrink-0 text-zinc-400')}<span class="min-w-0 max-w-[12rem] shrink truncate">${srcName(p!, s)}</span>`).join('')
    const switcher = `<div class="relative flex min-w-0">
        <button data-act="open:switch" data-shoot="switcher" aria-haspopup="dialog" aria-expanded="${st.open === 'switch'}" title="Every prototype and variant" class="flex h-10 min-w-0 items-center gap-2 rounded-lg px-2.5 text-left hover:bg-zinc-900/5 dark:hover:bg-white/10 ${st.open === 'switch' ? ON : ''}">
          <span class="min-w-0 leading-tight">
            <span class="flex min-w-0 items-center gap-1.5 font-semibold">${view === 'session' ? `<span dir="auto" class="truncate">${esc(session.name)}</span>` : `<span dir="auto" class="truncate">${esc(p!.title)}</span><span class="shrink-0 font-normal text-zinc-400">·</span>${v ? `<b class="shrink-0">${variantLabel(p!, v.id)}</b><span dir="auto" class="min-w-0 truncate">${esc(v.name)}</span>` : '<span class="shrink-0 font-normal text-zinc-500">All variants</span>'}`}${p && pickOf(p) && v?.id === pickOf(p) ? ic('check', `size-3.5 shrink-0 ${PICK}`) : ''}</span>
            <span class="flex min-w-0 items-center gap-1 text-[11px] text-zinc-500 dark:text-zinc-400">${sub}${where ? `<span class="shrink-0 text-zinc-300 dark:text-zinc-600">·</span><span dir="auto" class="min-w-0 truncate font-medium text-sky-700 dark:text-sky-300">${whereHtml}</span>` : ''}</span>
          </span>${ic('chev', `size-3.5 shrink-0 text-zinc-400 transition-transform ${st.open === 'switch' ? 'rotate-180' : ''}`)}</button>
        ${pop(st.open === 'switch', miller(), 'left-0 top-11')}</div>`
    const stepper = v && vs.length > 1 ? `<button data-act="step:-1" aria-label="Previous variant" title="Previous variant · ←" class="${IB} shrink-0">${ic('left')}</button><span class="w-9 shrink-0 text-center text-xs tabular-nums text-zinc-500">${at + 1}<span class="text-zinc-400 dark:text-zinc-600">/${vs.length}</span></span><button data-act="step:1" aria-label="Next variant" title="Next variant · →" class="${IB} shrink-0">${ic('right')}</button>` : ''
    keepScroll(bar, `${phoneBar}<div class="hidden min-w-0 flex-1 items-center gap-1 sm:flex"><button data-act="side:1" class="${IB} shrink-0 ${st.side ? 'lg:hidden' : ''}" title="Show sidebar · ⌘\\" aria-label="Show sidebar">${ic('sidebar')}</button>
      <div class="relative shrink-0"><button data-act="open:session" aria-label="Session" aria-expanded="${st.open === 'session'}" title="${esc(session.name)}" class="${IB} ${st.open === 'session' ? ON : ''}"><span class="relative grid size-5 shrink-0 place-items-center rounded bg-zinc-900 text-[10px] font-bold text-white dark:bg-white dark:text-zinc-900">${initial}<span class="absolute -right-1 -top-1 flex rounded-full ring-2 ring-white dark:ring-zinc-950">${pulse('size-2', st.live && !st.stopped)}</span></span></button>${pop(st.open === 'session', sessionMenu, 'left-0 top-11 w-[22rem] max-w-[calc(100vw-1rem)]')}</div>
      ${switcher}
      <div class="ml-auto flex shrink-0 items-center gap-1">
        ${stepper}${stepper && (view === 'variant' || viewOk() || commentHost() || copyCounts().lines || hasMotion() || decideOf()) ? '<span class="mx-1 h-5 w-px bg-black/10 dark:bg-white/10"></span>' : ''}
        ${sizeTabs()}${commentBtn()}${tweaksBtn()}${copyBtn()}${motionBtn()}${decideBtn()}${settingsBtn()}
        ${phones || frameOn() ? `<div class="relative"><button data-act="open:scale" aria-expanded="${st.open === 'scale'}" aria-label="${frameOn() ? 'Zoom' : 'Phone scale'}" class="${IB} text-xs tabular-nums ${st.open === 'scale' ? 'bg-zinc-900/5 text-zinc-900 dark:bg-white/10 dark:text-white' : ''}">${ic(viewOn() ? sizeIcon(st.view.size!, st.view.land) : frameOn() ? sizeIcon(shownSize() ?? 'desktop') : 'phone')}<span data-scale-label>${scaleLabel()}</span></button>${pop(st.open === 'scale', scaleMenu, 'right-0 top-11 w-72')}</div>`
          // On the stage the design is at its own size: the button stays, so choosing a layout doesn't move the bar.
          : viewOk() ? `<button type="button" aria-disabled="true" aria-label="Zoom" title="The design is at its full size here. Choose a layout to zoom it" class="${IB} cursor-default text-xs tabular-nums opacity-40 hover:bg-transparent">${ic(sizeIcon(shownSize() ?? nativeOf(innerWidth)))}<span>100%</span></button>` : ''}
        ${view === 'variant' ? `<button data-act="focus" aria-label="Focus mode" title="Focus mode · F" class="${IB.replace('inline-flex', 'hidden [@media(hover:hover)]:inline-flex')} shrink-0">${ic('grow')}</button>` : ''}
      </div></div>`)
    menus = { protos: drill(), session: sessionBody }

    // The switcher's dropdown: one column per level, scrolled to the last, and what is shown
    // described beside them.
    function miller() {
      const cols = columns()
      const q = p && pv ? p.variants.find(x => x.id === pv.variant) : undefined
      const kids = p && q ? kidsOf(p, q.id) : []
      const about = !p ? `<div dir="auto" class="font-semibold">${esc(session.name)}</div><p class="mt-1 text-xs text-zinc-500">${active().length} prototypes · started ${clock(session.createdAt)}</p>`
        : `<div class="shrink-0 text-[11px] text-zinc-500"><span dir="auto">${esc(p.title)}</span></div><div class="mt-0.5 flex shrink-0 items-center gap-1.5 font-semibold">${q ? `<b>${variantLabel(p, q.id)}</b><span dir="auto" class="truncate">${esc(q.name)}</span>` : 'All variants'}</div>
          ${q && p.about[q.id] ? `<p data-switch-description data-k="about:${esc(p.id)}:${q.id}" tabindex="0" aria-label="Description" dir="auto" class="mt-2 min-h-0 overflow-y-auto overscroll-contain text-xs leading-[18px] text-zinc-600 dark:text-zinc-400">${esc(p.about[q.id])}</p>` : !q && p.ask ? `<p data-switch-description data-k="about:${esc(p.id)}:" tabindex="0" aria-label="Description" dir="auto" class="mt-2 min-h-0 overflow-y-auto overscroll-contain text-xs leading-[18px] text-zinc-600 dark:text-zinc-400">“${esc(p.ask)}”</p>` : ''}
          <p class="mt-2 shrink-0 text-[11px] text-zinc-400">${[q && q.id === pickOf(p) ? 'Picked' : '', q && same(session.work, { proto: p.id, variant: q.id }) ? 'Your requests change it' : '', kids.length ? `${kids.length} built from it` : '', line.length ? `${line.length + 1} levels deep` : '', p.slot && parentOf(p) && p.from ? `Plugs into ${esc(parentOf(p)!.title)}${p.from.variant ? ` ${esc(variantLabel(parentOf(p)!, p.from.variant))}` : ''}` : ''].filter(Boolean).join(' · ')}</p>
          ${q ? `<button data-act="lobby:proto:${esc(p.id)}" class="mt-auto flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg text-xs font-medium ring-1 ring-inset ring-black/10 hover:bg-zinc-900/[.04] dark:ring-white/15 dark:hover:bg-white/[.06]">${ic('grid', 'size-3.5')}All ${p.variants.length} variants</button>` : ''}`
      return `<div data-fitw="${cols.length * 200 + 224}" class="flex h-[26rem] max-h-[calc(100dvh-5rem)]">
        <div data-mcols data-colnav data-k="mcols" class="flex min-w-0 flex-1 overflow-x-auto overscroll-contain">${cols.map(c => `<div class="flex w-[12.5rem] shrink-0 flex-col border-r border-black/[.06] pt-1 dark:border-white/10">${colHead(c)}<div data-vlist data-k="${esc(colKey(c))}" class="relative min-h-0 flex-1 space-y-px overflow-y-auto overscroll-contain px-1.5 pb-2">${colRows(c)}</div></div>`).join('')}</div>
        <div class="flex min-h-0 w-56 shrink-0 flex-col bg-zinc-900/[.02] p-4 dark:bg-white/[.02]">${about}</div></div>`
    }

    // The phone's sheet: the same columns, one at a time. It opens on the last; back steps left,
    // and the chips jump to any level on the way.
    function drill() {
      const cols = columns(), i = Math.min(st.drill ?? cols.length - 1, cols.length - 1), c = cols[i], back = i > 0 ? cols[i - 1] : null
      const chips = cols.map((x, j) => ({ x, j })).filter(({ x }) => x.kind === 'variants' && x.sel)
      return `<div class="pb-3">
        <div class="flex h-10 items-center px-1">${back ? `<button data-act="drill:${i - 1}" class="flex h-10 min-w-0 items-center gap-0.5 rounded-lg pr-2 text-zinc-600 active:bg-zinc-900/5 dark:text-zinc-400 dark:active:bg-white/10">${ic('left', 'size-5')}<span dir="auto" class="truncate">${esc(colName(back))}${back.kind === 'variants' && back.sel ? ` <b>${esc(back.sel)}</b>` : ''}</span></button>` : ''}</div>
        <div class="flex items-end gap-2 px-3 pb-2"><div class="min-w-0 flex-1"><div dir="auto" class="truncate text-xl font-semibold leading-tight">${esc(colName(c))}</div><div class="mt-0.5 text-xs text-zinc-500">${colCount(c)} ${c.kind === 'variants' ? 'variants' : 'prototypes'}</div></div>
          ${c.kind === 'variants' ? `<button data-act="lobby:proto:${esc(c.p.id)}" class="flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-medium ring-1 ring-inset ring-black/10 dark:ring-white/15">${ic('grid', 'size-3.5')}All</button>` : c.from ? '' : '<button data-act="lobby:session" class="flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-medium ring-1 ring-inset ring-black/10 dark:ring-white/15">Overview</button>'}</div>
        ${chips.length > 1 ? `<div data-mcols class="flex gap-1.5 overflow-x-auto px-3 pb-3 [scrollbar-width:none]">${chips.map(({ x, j }) => `<button data-act="drill:${j}" class="h-8 shrink-0 rounded-full px-3 text-xs ${j === i ? 'bg-sky-500/15 font-semibold text-sky-800 dark:text-sky-200' : 'bg-zinc-900/[.05] text-zinc-600 dark:bg-white/[.07] dark:text-zinc-300'}"><span dir="auto">${esc(colName(x))}</span> <b>${esc(x.sel)}</b></button>`).join('')}</div>` : ''}
        <div data-vlist data-k="${esc(colKey(c))}" class="space-y-px px-2">${colRows(c, true)}</div></div>`
    }
    side.className = st.side && !framed ? 'hidden shrink-0 flex-col border-r border-black/[.07] lg:flex dark:border-white/10' : 'hidden'
    side.style.width = `${st.sideW}px`
    grip.classList.toggle('lg:block', st.side)
    grip.setAttribute('aria-valuenow', String(st.sideW))
    keepScroll(side, st.side ? sideNav(false) : '')
    keepScroll(drawer, st.drawer ? `<div class="fixed inset-0 z-50 lg:hidden"><div data-act="drawer:0" class="absolute inset-0 bg-black/30"></div><div class="absolute inset-y-0 left-0 flex w-[19rem] max-w-[85%] flex-col bg-white shadow-2xl dark:bg-zinc-950">${sideNav(true)}</div></div>` : '')

    // Focus mode restyles the zone to cover the page; the mounted design stays put. On a phone
    // the variant pill takes a strip at the bottom of the stage, so it never covers the design.
    zone.className = st.focus ? 'fixed inset-0 z-[100] bg-white text-[13px] dark:bg-zinc-950' : `relative min-h-0 flex-1 ${pillOn() ? 'max-sm:[--pill-h:calc(4.25rem+env(safe-area-inset-bottom))]' : ''}`
    document.documentElement.style.overflow = st.focus ? 'hidden' : ''

    const edgeBtn = (side: 'prev' | 'next') => {
      const d = side === 'prev' ? -1 : 1, t = vs[(at + d + vs.length) % vs.length]
      const k = `${st.focus ? 'focus' : 'main'}-${side}`, e = smooth(edge.t[k] || 0), open = !!edge.hover[k]
      return `<button data-edge="${k}" data-act="step:${d}" aria-label="${d < 0 ? 'Previous' : 'Next'} variant: ${variantLabel(p!, t.id)} ${esc(t.name)}" class="absolute top-1/2 z-10 -mt-6 hidden h-12 items-center rounded-full bg-white/90 px-3 text-zinc-900 shadow-lg shadow-black/10 ring-1 ring-black/10 backdrop-blur [@media(hover:hover)]:flex dark:bg-zinc-900/90 dark:text-white dark:ring-white/15 ${d < 0 ? 'left-3' : 'right-[calc(var(--hw,0px)+0.75rem)] flex-row-reverse'}" style="opacity:${e};pointer-events:${e > 0.3 ? 'auto' : 'none'}">${ic(d < 0 ? 'left' : 'right', 'size-5')}<span data-edge-label class="overflow-hidden whitespace-nowrap text-[13px]" style="width:${open ? edge.w[k] || 0 : 0}px;opacity:${open ? 1 : 0};margin-${d < 0 ? 'left' : 'right'}:${open ? 8 : 0}px;transition:width .32s cubic-bezier(.22,1,.36,1),opacity .2s,margin .32s cubic-bezier(.22,1,.36,1)"><span class="inline-block"><b>${t.id}</b> · ${bd(t.name)}</span></span></button>`
    }
    const dockBtn = 'grid size-9 shrink-0 place-items-center rounded-full text-white/70 hover:bg-white/10 hover:text-white'
    const dockSep = '<span class="mx-1 h-5 w-px shrink-0 bg-white/15"></span>'
    overlay.innerHTML = framed || view !== 'variant' || !p ? '' : `
      ${building(p.id, vid) ? `<div data-building-chip title="${esc(agentName(session.agent))} is still building this one" class="pointer-events-none absolute left-3 top-3 z-10 inline-flex h-7 items-center gap-1.5 rounded-full bg-zinc-900/80 px-2.5 text-xs font-medium text-white shadow-lg backdrop-blur">${pulse('size-1.5')}Building</div>` : ''}
      ${vs.length > 1 ? edgeBtn('prev') + edgeBtn('next') : ''}
      ${st.focus ? `
      ${st.open === 'fproto' ? `<div data-pop class="fixed bottom-[76px] left-1/2 z-20 w-[min(24rem,calc(100vw-2rem))] -translate-x-1/2 overflow-hidden rounded-2xl border border-black/10 bg-white shadow-2xl dark:border-white/10 dark:bg-zinc-900">${protoMenu}</div>` : ''}
      <div class="pointer-events-none fixed inset-x-0 bottom-0 z-10 flex justify-center pb-[env(safe-area-inset-bottom)]" style="bottom:calc(var(--dock-h,0px) + var(--copy-h,0px))">
        <div data-dock data-locked="${st.open === 'fproto' ? 1 : 0}" class="pointer-events-auto relative overflow-hidden rounded-full shadow-xl shadow-black/20 ring-1 ring-white/10 backdrop-blur" style="width:72px;height:6px;margin-bottom:4px;background-color:rgb(24 24 27/.35)">
          <div data-dock-full class="absolute left-1/2 top-1/2 flex w-max items-center gap-0.5 px-1 text-white" style="opacity:0;transform:translate(-50%,-50%)">
            <button data-act="unfocus" class="${dockBtn}" aria-label="Exit focus (Esc)" title="Exit focus · Esc">${ic('shrink')}</button>${dockSep}
            <button data-act="open:fproto" aria-label="Prototypes" class="inline-flex h-9 min-w-9 items-center justify-center gap-1.5 rounded-full px-2 hover:bg-white/10 sm:px-3">${ic('menu', 'size-4 sm:hidden')}<span dir="auto" class="hidden max-w-48 truncate font-medium sm:inline">${esc(p.title)}</span>${ic('chev', 'hidden size-3.5 rotate-180 text-white/50 sm:block')}</button>${dockSep}
            ${many ? `<button data-act="step:-1" class="${dockBtn} w-7" aria-label="Previous">${ic('left', 'size-3.5')}</button>` : ''}
            ${shown.map(x => `<button data-act="variant:${x.id}" title="${esc(x.name)}" class="relative grid size-9 shrink-0 place-items-center rounded-full text-xs font-semibold ${vid === x.id ? 'bg-white text-zinc-900' : 'text-white/70 hover:bg-white/10'}">${variantLabel(p, x.id)}${editing(p.id, x.id) ? `<span class="absolute right-1 top-1">${pulse('size-1.5')}</span>` : ''}</button>`).join('')}
            ${many ? `<button data-act="step:1" class="${dockBtn} w-7" aria-label="Next">${ic('right', 'size-3.5')}</button><span class="px-1.5 text-xs tabular-nums text-white/60">${at + 1}/${vs.length}</span>` : ''}${dockSep}
            ${(c => c.lines ? `<button data-act="copymode" aria-pressed="${c.on}" aria-label="Copy options" title="${copySay(c)}" class="${dockBtn} relative ${c.on ? '!bg-proto-primary !text-proto-primary-fg' : ''}">${ic('text')}${copyCount(c, 'ring-zinc-900')}</button>` : '')(copyCounts())}
            ${phones ? `<button data-act="scale:${[0, 100, 75, 50][([0, 100, 75, 50].indexOf(st.scale) + 1) % 4]}" class="h-9 shrink-0 rounded-full px-2 text-xs tabular-nums text-white/70 hover:bg-white/10" title="Phone scale">${scaleLabel()}</button>` : ''}
            <button data-act="settings" class="${dockBtn}" aria-label="Settings" aria-haspopup="dialog">${ic('settings')}</button>
          </div>
        </div>
      </div>` : ''}`

    if (st.focus) requestAnimationFrame(runDock)
    restoreEdgeLabels()
    // The dropdown is as wide as its columns, up to the window's edge (the columns scroll).
    for (const el of bar.querySelectorAll<HTMLElement>('[data-fitw]')) el.style.width = `${Math.min(Number(el.dataset.fitw), innerWidth - el.getBoundingClientRect().left - 12)}px`
    // On arrival (or a menu or level opening) each column centers what is lit, and the
    // dropdown's columns scroll to the last one.
    if (recenter) requestAnimationFrame(() => {
      recenter = false
      for (const list of root.querySelectorAll<HTMLElement>('[data-vlist]')) {
        const window = navLists.get(list)
        if (window) { const selected = list.querySelector<HTMLElement>('[data-virtual-selected]')?.dataset.virtualSelected; const index = window.items.findIndex(v => v.id === selected); if (index >= 0) window.scrollToIndex(index, 'center'); continue }
        const on = list.querySelector<HTMLElement>('[aria-current="true"]')
        if (on) list.scrollTop = on.offsetTop - list.clientHeight / 2 + on.clientHeight / 2
      }
      for (const m of root.querySelectorAll<HTMLElement>('[data-mcols]')) m.scrollLeft = m.scrollWidth
    })
    document.title = [where, v && `${variantLabel(p!, v.id)} · ${v.name}`, p?.title, session.name].filter(Boolean).join(' – ')
    paintIcon()
    paintHints()
    paintPill()
    paintDecide()
    paintSettings()
    paintVmenu()
    paintCtx()
    paintView()
    // What the bar was drawn with, so a change is told from it (a view's frame can draw it before
    // its design has declared its copy lines or its motion), not from the last change heard.
    copyKey = copyKeyOf(); motionKey = String(hasMotion())
  }

  // ---------- the variant pill (phones) ----------
  // Below 640px the variants live in one floating pill at the bottom of the stage: it names
  // the variant, its arrows step, a tap opens the sheet of all of them, and a drag along it
  // moves through them, one variant per short stretch of finger. While the finger moves, the
  // stage slides with it: the design next in line comes in beside this one, one phone apart at
  // the phone scale (or one stage width for a web prototype), so at 50% the neighbour shows
  // early and at 100% it is a full page away. It is mounted only for the drag.
  const STEP = 34
  const pillOn = () => { const p = cur(); return !framed && !!p && st.place.view !== 'session' && !st.focus && visible(p).length > 0 }
  type Peek = { layer: Layer; place: Place }
  type PillDrag = {
    id: number; x0: number; lastX: number; lastT: number; v: number; moved: boolean
    proto: Proto; ids: string[]; base: number; pos: number
    real: Layer | null; peeks: Map<number, Peek>; pitch: number; raf: number; target: number
  }
  let pd: PillDrag | null = null
  let pillKey = ''
  const pillBtn = 'grid size-10 shrink-0 place-items-center rounded-full text-white/70 active:bg-white/10'

  function paintPill() {
    const p = cur()
    if (pd) return
    const vs = p ? visible(p) : []
    const vid = st.place.view === 'variant' ? st.place.variant : ''
    const at = vs.findIndex(v => v.id === vid)
    const tryN = pillOn() && phoneMq.matches ? tryCount(hintList()) : 0
    const key = pillOn() ? JSON.stringify([p!.id, vid, vs.map(v => [v.id, v.name]), editing(p!.id, vid), st.sheet, pillComments(), copyCounts().on, trySheet, tweakList().length, tweaksOpen, tweakList().filter(isChanged).length]) : ''
    if (key !== pillKey) {
      pillKey = key
      if (!key) { pill.innerHTML = ''; closeCard(true) }
      else {
        const v = vs[at]
        const sep = '<span class="mx-0.5 h-5 w-px shrink-0 bg-white/15"></span>'
        const prev = vs[at <= 0 ? vs.length - 1 : at - 1], next = vs[at < 0 || at === vs.length - 1 ? 0 : at + 1]
        const name = v ? `<b data-pill-id class="shrink-0 text-[15px]">${variantLabel(p!, v.id)}</b><span data-pill-name dir="auto" class="min-w-0 truncate text-white/70">${esc(v.name)}</span><span data-pill-n class="shrink-0 text-[11px] tabular-nums text-white/40">${at + 1}/${vs.length}</span>${editing(p!.id, v.id) ? pulse('size-1.5') : ''}`
          : `<span class="truncate font-medium">All variants</span><span class="shrink-0 text-[11px] tabular-nums text-white/40">${vs.length}</span>`
        // The pill holds the menu, the variants and Comment, never more: the page's other tools
        // (All variants, copy options, Try it, motion, the layout or the phone scale) are in the
        // menu, so the name keeps its room on a 360 px phone however many a design has. A tool
        // opened from the menu makes its button the way out (an X), or, for Try it put away while
        // a spot is lit, the key that brings it back.
        const mode = copyCounts().on ? { act: 'copymode', icon: 'x', label: 'Close copy options' }
          : trySheet === 'open' ? { act: 'try', icon: 'x', label: 'Close Try it' }
          : trySheet === 'away' ? { act: 'try', icon: 'key', label: 'Bring Try it back' } : null
        const menuBtn = mode
          ? `<button data-pill-menu="mode" data-act="${mode.act}" data-shoot="menu" aria-label="${mode.label}" aria-pressed="true" class="${pillBtn} !bg-proto-primary !text-proto-primary-fg">${ic(mode.icon, 'size-5')}</button>`
          : `<button data-pill-menu data-shoot="menu" aria-label="Menu" aria-haspopup="dialog" aria-expanded="false" class="${pillBtn} transition-colors ${cardBtnCls()}">${ic('menu', 'size-5')}</button>`
        pill.innerHTML = `<div class="absolute inset-x-0 bottom-0 z-10 flex h-[var(--pill-h,0px)] items-start justify-center pt-2 sm:hidden">
          <div data-pill-bar class="relative flex h-12 max-w-[calc(100%-1rem)] items-center gap-0.5 rounded-full bg-zinc-900/90 p-1 text-white shadow-xl shadow-black/20 ring-1 ring-white/10 backdrop-blur dark:bg-zinc-800/90">
            <div data-ruler hidden class="pointer-events-none absolute bottom-full left-1/2 mb-2 h-9 w-56 -translate-x-1/2 overflow-hidden rounded-full bg-zinc-900/90 shadow-lg ring-1 ring-white/10 [mask-image:linear-gradient(90deg,transparent,#000_25%,#000_75%,transparent)] dark:bg-zinc-800/90"></div>
            ${menuBtn}${sep}
            <button data-act="variant:${prev.id}" aria-label="Previous variant: ${variantLabel(p!, prev.id)} ${esc(prev.name)}" class="${pillBtn}">${ic('left')}</button>
            <div data-pill-handle role="button" tabindex="0" aria-label="${v ? `${variantLabel(p!, v.id)} ${esc(v.name)}, ${at + 1} of ${vs.length}. ` : ''}Show all variants" class="flex h-10 ${tweakList().length ? 'w-28' : 'w-40'} min-w-0 cursor-grab touch-none select-none items-center justify-center gap-1.5 rounded-full px-2 active:bg-white/10">
              ${name}
            </div>
            <button data-act="variant:${next.id}" aria-label="Next variant: ${variantLabel(p!, next.id)} ${esc(next.name)}" class="${pillBtn}">${ic('right')}</button>
            ${tweakList().length ? `${sep}<button data-act="tweaks" data-shoot="tweaks" aria-label="Tweaks" aria-haspopup="dialog" aria-expanded="${tweaksOpen}" class="${pillBtn} relative ${tweaksOpen ? '!bg-sky-700 !text-white' : ''}">${ic('tweaks', 'size-5')}${tweakList().some(isChanged) ? `<span class="absolute right-0 top-0 grid min-w-3.5 rounded-full bg-sky-500 px-1 text-[9px] font-semibold text-white">${tweakList().filter(isChanged).length}</span>` : ''}</button>` : ''}
            ${commentHost() ? (c => `${sep}<button data-act="comment:tap" data-shoot="comment" aria-label="Comments" aria-pressed="${c.picking}" class="${pillBtn} relative ${c.picking ? '!bg-proto-primary !text-proto-primary-fg' : ''}">${ic(c.picking ? 'x' : 'comment', 'size-5')}${c.drafts && !c.picking ? `<span class="absolute -right-0.5 -top-0.5 grid size-4 place-items-center rounded-full bg-proto-primary text-[10px] font-semibold text-proto-primary-fg ring-2 ring-zinc-900">${c.drafts}</span>` : ''}</button>`)(comments.counts()) : ''}
          </div>
        </div>`
        raisePill()
      }
    }
    if (card) markCardBtn()
    syncScale()
    paintMenu({
      open: !!st.menu,
      title: st.menu === 'session' ? session.name : 'Find a design',
      onContentReady: menuReady,
      html: st.menu ? menus[st.menu] : '',
      onClose: () => { st.menu = ''; render() },
    })
    paintSheet({
      open: st.sheet && !!key,
      title: p?.title ?? '',
      rows: vs.map(v => ({ id: v.id, label: variantLabel(p!, v.id), name: v.name, on: v.id === vid, picked: v.id === (p ? pickOf(p) : ''), editing: !!p && editing(p.id, v.id) })),
      lobby: st.place.view === 'proto',
      decide: (d => d && comments.decideIn(d))(decideOf()),
      onClose: () => { st.sheet = false; render() },
      onPick: id => { st.sheet = false; if (p) go(keepIn(p, id)); render() },
      onLobby: () => { st.sheet = false; if (p) go({ view: 'proto', proto: p.id }); render() },
    })
  }

  let menus = { protos: '', session: '' }

  // ---------- the pill's menu ----------
  // The pill's menu holds the page's tools for the design on the stage: All variants, copy options,
  // Try it, the motion dock, Focus mode, and the layout (a web prototype's device view) or the
  // phone scale. Each row is there only when the design has it, with what it holds (lines with
  // options, things to try). The card grows out of the button: it starts as the button, same place,
  // size and round corners, opens into the card, and its rows fade in once there is room; choosing
  // anything in it folds it back. Turning it around halfway plays the running animation back from where it is.
  const DARK_SEG = (on: boolean) => `h-9 min-w-0 flex-1 rounded-full text-xs font-medium tabular-nums ${on ? 'bg-white text-zinc-900' : 'text-white/70 hover:bg-white/10'}`
  const CARD_CLS = 'absolute z-30 w-[17.5rem] max-w-[calc(100vw-1rem)] space-y-1 rounded-3xl bg-zinc-900/95 p-1.5 text-[14px] text-white shadow-xl shadow-black/20 ring-1 ring-white/10 backdrop-blur dark:bg-zinc-800/95'
  const menuRow = (o: { act: string; shoot: string; icon: string; label: string; detail?: string; on?: boolean; tint?: string }) =>
    `<button data-act="${o.act}" data-shoot="${o.shoot}" aria-pressed="${!!o.on}" class="flex h-11 w-full items-center gap-3 rounded-[18px] px-3 text-start hover:bg-white/10 active:bg-white/10 ${o.on ? 'bg-white/[.08]' : ''}">
      <span class="grid size-7 shrink-0 place-items-center rounded-full ${o.on ? 'bg-proto-primary text-proto-primary-fg' : o.tint ?? 'text-white/70'}">${ic(o.icon, 'size-[18px]')}</span>
      <span class="min-w-0 flex-1 truncate font-medium">${o.label}</span>${o.detail ? `<span class="shrink-0 text-xs tabular-nums text-white/45">${o.detail}</span>` : ''}</button>`
  const menuSegs = (label: string, segs: string, after = '') =>
    `<div class="flex items-center gap-1 ps-3"><span class="w-14 shrink-0 text-xs text-white/50">${label}</span><div class="flex min-w-0 flex-1 gap-0.5 rounded-full bg-white/[.06] p-0.5">${segs}</div>${after}</div>`
  const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`
  function cardHtml() {
    const p = cur()!, c = copyCounts(), n = tryCount(hintList())
    const rows = [
      menuRow({ act: 'lobby:proto', shoot: 'all-variants', icon: 'grid', label: 'All variants', detail: String(visible(p).length), on: st.place.view === 'proto' }),
      !framed ? menuRow({ act: 'share', shoot: 'share', icon: 'share', label: 'Share screenshots' }) : '',
      c.lines ? menuRow({ act: 'copymode', shoot: 'copy-mode', icon: 'text', label: 'Copy options', detail: plural(c.lines, 'line') }) : '',
      n ? menuRow({ act: 'try', shoot: 'try-it', icon: 'key', tint: 'text-amber-300', label: 'Try it', detail: `${n} to try` }) : '',
      hasMotion() ? menuRow({ act: 'motion', shoot: 'motion', icon: 'curves', label: st.motion ? 'Hide motion' : 'Motion', detail: st.motion ? '' : 'Timeline', on: st.motion }) : '',
      st.place.view === 'variant' ? menuRow({ act: 'focus', shoot: 'focus', icon: 'grow', label: 'Focus mode' }) : '',
    ].join('')
    const layout = viewOk() ? menuSegs('Layout', ORDER.map(s => `<button data-act="size:${s}:card" data-shoot="size-${s}" aria-label="${SIZES[s].name}" aria-pressed="${shownSize() === s}" class="grid place-items-center ${DARK_SEG(shownSize() === s)}">${ic(sizeIcon(s, s === 'tablet' && st.view.land), 'size-[18px]')}</button>`).join(''),
      viewOn() && st.view.size === 'tablet' ? `<button data-act="turn" data-shoot="turn" aria-label="${st.view.land ? 'Turn upright' : 'Turn on its side'}" class="grid size-10 shrink-0 place-items-center rounded-full text-white/70 hover:bg-white/10 hover:text-white">${ic('rotate', 'size-5')}</button>` : '') : ''
    const scale = p.kind === 'phone' || frameOn() ? menuSegs(frameOn() ? 'Zoom' : 'Scale', SCALES.map(s => `<button data-act="scale:${s}" data-scale-seg="${s}" data-dark aria-pressed="${scaleNow() === s}" class="${DARK_SEG(scaleNow() === s)}">${s ? s + '%' : 'Fit'}</button>`).join('')) : ''
    return `<div data-scale-backdrop class="fixed inset-0 z-20"></div>
      <div data-card data-menu-card role="dialog" aria-label="Menu" class="${CARD_CLS}" style="transform-origin:0 0"><div class="space-y-px">${rows}</div>${layout}${scale}</div>`
  }
  let card: { el: HTMLElement; phase: 'enter' | 'open' | 'exit'; anims: Animation[] } | null = null
  /** The menu's button: white while its card is open. */
  const cardBtnCls = () => card && card.phase !== 'exit' ? '!bg-white !text-zinc-900' : ''
  // The menu's button, or the X a tool opened from the menu made of it (which the card folds back into).
  const menuBtn = () => pill.querySelector<HTMLElement>('[data-pill-menu]')
  function markCardBtn() {
    const b = menuBtn()
    if (!b || b.dataset.pillMenu === 'mode') return
    b.classList.remove('!bg-white', '!text-zinc-900')
    const c = cardBtnCls()
    if (c) b.classList.add(...c.split(' '))
    b.setAttribute('aria-expanded', String(!!card && card.phase !== 'exit'))
  }
  const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches
  const CARD_EASE_OUT = 'cubic-bezier(0.32, 0.72, 0, 1)', CARD_EASE_IN = 'cubic-bezier(0.4, 0, 1, 1)'

  // Everything that shows the scale, updated in place so an open menu or a drag isn't rebuilt.
  function syncScale(except?: HTMLInputElement) {
    for (const l of root.querySelectorAll('[data-scale-label]')) l.textContent = scaleLabel()
    const sc = scaleNow()
    for (const b of root.querySelectorAll<HTMLElement>('[data-scale-seg]')) { const on = Number(b.dataset.scaleSeg) === sc; b.setAttribute('aria-pressed', String(on)); b.className = b.hasAttribute('data-dark') ? DARK_SEG(on) : segCls(on) }
    for (const r of root.querySelectorAll<HTMLInputElement>('[data-scale-range]')) {
      if (r === except) continue
      r.value = String(sc || 50)
      r.style.setProperty('--p', `${rangeAt(sc || 50)}%`)
      r.classList.toggle('opacity-40', !sc)
    }
  }
  // Where the button sits, as the transform that turns the card into it.
  function asButton(el: HTMLElement, btn: HTMLElement) {
    const c = el.getBoundingClientRect(), b = btn.getBoundingClientRect()
    const sx = b.width / c.width, sy = b.height / c.height, r = b.height / 2
    return { transform: `translate(${b.left - c.left}px, ${b.top - c.top}px) scale(${sx}, ${sy})`, borderRadius: `${r / sx}px / ${r / sy}px` }
  }
  function settleCard(c: NonNullable<typeof card>, phase: 'enter' | 'exit', done: () => void) {
    const anims = c.anims
    Promise.all(anims.map(a => a.finished)).then(() => { if (card === c && c.anims === anims && c.phase === phase) done() }, () => {})
  }
  function openCard() {
    const btn = menuBtn(), bar = btn?.closest<HTMLElement>('[data-pill-bar]')
    if (!btn || !bar) return
    if (card?.phase === 'exit') { card.el.style.pointerEvents = ''; cardHost.querySelector<HTMLElement>('[data-scale-backdrop]')!.style.pointerEvents = ''; card.anims.forEach(a => a.reverse()); card.phase = 'enter'; const c = card; settleCard(c, 'enter', () => { c.phase = 'open'; c.anims.forEach(a => a.cancel()); c.anims = [] }); return markCardBtn() }
    if (card) return
    cardHost.innerHTML = cardHtml()
    const el = cardHost.querySelector<HTMLElement>('[data-card]')!
    // Over the pill, from its start, where the button is.
    const z = zone.getBoundingClientRect(), b = bar.getBoundingClientRect()
    el.style.left = `${b.left - z.left}px`
    el.style.bottom = `${z.bottom - b.top + 8}px`
    card = { el, phase: 'open', anims: [] }
    markCardBtn()
    if (reduceMotion()) return
    const from = asButton(el, btn)
    card.phase = 'enter'
    card.anims = [
      el.animate([{ ...from, opacity: 0.6 }, { transform: 'none', borderRadius: '24px', opacity: 1 }], { duration: 340, easing: CARD_EASE_OUT }),
      ...[...el.children].map(r => r.animate([{ opacity: 0 }, { opacity: 0, offset: 0.4 }, { opacity: 1 }], { duration: 340 })),
    ]
    const c = card
    settleCard(c, 'enter', () => { c.phase = 'open'; c.anims = [] })
  }
  function closeCard(now = false) {
    if (!card) return
    const btn = menuBtn()
    const drop = () => { cardHost.innerHTML = ''; card = null; markCardBtn() }
    if (now || reduceMotion() || !btn) { card.anims.forEach(a => a.cancel()); return drop() }
    const c = card
    if (c.phase === 'exit') return
    if (c.phase === 'enter') {
      // Held at its start once played back, so the card doesn't flash open before it goes.
      c.anims.forEach(a => { a.effect?.updateTiming({ fill: 'both' }); a.reverse() })
    } else {
      const to = asButton(c.el, btn)
      c.anims = [
        c.el.animate([{ transform: 'none', borderRadius: '24px', opacity: 1 }, { ...to, opacity: 0 }], { duration: 240, easing: CARD_EASE_IN, fill: 'forwards' }),
        ...[...c.el.children].map(r => r.animate([{ opacity: 1 }, { opacity: 0, offset: 0.4 }, { opacity: 0 }], { duration: 240, fill: 'forwards' })),
      ]
    }
    c.phase = 'exit'
    markCardBtn()
    // While it folds away, a tap goes through to the pill, so the button can open it again.
    c.el.style.pointerEvents = 'none'
    cardHost.querySelector<HTMLElement>('[data-scale-backdrop]')!.style.pointerEvents = 'none'
    settleCard(c, 'exit', drop)
  }
  pill.addEventListener('click', e => {
    const b = (e.target as Element).closest<HTMLElement>('[data-pill-menu]')
    if (!b || b.dataset.pillMenu === 'mode') return
    card && card.phase !== 'exit' ? closeCard() : openCard()
  })
  // Anything chosen in the card folds it back, once the page has acted on it (the root's handler,
  // after this one): a tool turned on makes the button its X first, and the card folds into that.
  cardHost.addEventListener('click', e => {
    const t = e.target as Element
    if (t.closest('[data-scale-backdrop]')) closeCard()
    else if (t.closest('[data-card] [data-act]')) queueMicrotask(() => closeCard())
  })
  // The phone's sheets and the menu belong to the phone layout; widening past it closes them.
  matchMedia('(min-width: 640px)').addEventListener('change', e => {
    if (!e.matches || !(st.menu || st.sheet || card || trySheet !== 'closed')) return
    st.menu = ''; st.sheet = false; trySheet = 'closed'; closeCard(true); render()
  })

  // The variant labels around the finger, above the pill, while it drags.
  function paintRuler(d: PillDrag) {
    const r = pill.querySelector<HTMLElement>('[data-ruler]')
    if (!r) return
    r.hidden = false
    r.innerHTML = d.ids.map((id, i) => ({ id, off: i - d.pos })).filter(x => Math.abs(x.off) < 4).map(({ id, off }) =>
      `<span class="absolute top-0 grid h-9 w-8 place-items-center text-[13px] font-semibold text-white" style="left:${112 - 16 + off * 32}px;opacity:${1 - Math.min(1, Math.abs(off)) * 0.55}">${variantLabel(d.proto, id)}</span>`).join('')
      + '<span class="absolute left-1/2 top-1 h-7 w-8 -translate-x-1/2 rounded-full ring-1 ring-white/40"></span>'
    const i = Math.min(d.ids.length - 1, Math.max(0, Math.round(d.pos))), v = d.proto.variants.find(x => x.id === d.ids[i])!
    const set = (sel: string, text: string) => { const el = pill.querySelector(sel); if (el) el.textContent = text }
    set('[data-pill-id]', variantLabel(d.proto, v.id)); set('[data-pill-name]', v.name); set('[data-pill-n]', `${i + 1}/${d.ids.length}`)
  }

  // The stage follows pos: this design moves off by its distance from pos, and the variants on
  // either side of pos are mounted beside it (inert) while they are in reach.
  function slide(d: PillDrag) {
    if (!d.real || d.real !== layer || !d.pitch) return
    d.real.el.style.transform = `translate3d(${(d.base - d.pos) * d.pitch}px,0,0)`
    const want = new Set([Math.floor(d.pos), Math.ceil(d.pos)].filter(i => i >= 0 && i < d.ids.length && i !== d.base))
    for (const [i, k] of d.peeks) if (!want.has(i)) { k.layer.el.remove(); k.layer.dispose(); d.peeks.delete(i) }
    for (const i of want) {
      if (!d.peeks.has(i)) {
        const place = keepIn(d.proto, d.ids[i]), l = buildLayer(place)
        l.el.inert = true
        l.el.style.pointerEvents = 'none'
        layers.append(l.el)
        fitBox(l.el)
        d.peeks.set(i, { layer: l, place })
      }
      d.peeks.get(i)!.layer.el.style.transform = `translate3d(${(i - d.pos) * d.pitch}px,0,0)`
    }
  }
  function endSlide(d: PillDrag, keep?: number) {
    if (d.real) d.real.el.style.transform = ''
    for (const [i, k] of d.peeks) if (i !== keep) { k.layer.el.remove(); k.layer.dispose() }
  }

  // Past either end it gives a little, then stops.
  const rubber = (x: number, n: number) => { const give = (o: number) => 0.35 * (1 - 1 / (o * 1.2 + 1)); return x < 0 ? -give(-x) : x > n - 1 ? n - 1 + give(x - n + 1) : x }

  function land(d: PillDrag, target: number) {
    const k = d.peeks.get(target)
    const place = k?.place ?? keepIn(d.proto, d.ids[target])
    pd = null
    pill.querySelector<HTMLElement>('[data-ruler]')?.setAttribute('hidden', '')
    if (target === d.base) { endSlide(d); pillKey = ''; return render() }
    // The design that slid in becomes the page's layer as it is, so nothing remounts or fades;
    // the place is set first, so the hash change that follows only redraws the chrome.
    if (k && d.real && d.real === layer) {
      endSlide(d, target)
      k.layer.el.style.transform = ''
      k.layer.el.style.pointerEvents = ''
      k.layer.el.inert = false
      layer = k.layer
      d.real.el.remove(); d.real.dispose()
      st.place = place
      fit()
    } else endSlide(d)
    go(place)
  }

  pill.addEventListener('pointerdown', e => {
    let h = (e.target as Element).closest<HTMLElement>('[data-pill-handle]')
    if (!h || e.button !== 0) return
    // A second finger mid-drag is ignored; a touch while the last drag settles lands it now
    // (which may redraw the pill, so the handle is looked up again).
    if (pd) { if (!pd.raf) return; cancelAnimationFrame(pd.raf); land(pd, pd.target); h = pill.querySelector<HTMLElement>('[data-pill-handle]') }
    const p = cur()
    if (!h || !p) return
    const ids = visible(p).map(v => v.id)
    const vid = st.place.view === 'variant' ? st.place.variant : ''
    const base = ids.indexOf(vid)
    const real = base >= 0 && st.place.view === 'variant' && !st.place.tool ? layer : null
    const phone = real?.el.querySelector<HTMLElement>('[data-phone]')
    const pitch = real ? (phone ? phone.getBoundingClientRect().width : real.el.clientWidth) + 24 : 0
    h.setPointerCapture(e.pointerId)
    pd = { id: e.pointerId, x0: e.clientX, lastX: e.clientX, lastT: e.timeStamp, v: 0, moved: false, proto: p, ids, base, pos: Math.max(0, base), real, peeks: new Map(), pitch, raf: 0, target: base }
  })
  pill.addEventListener('pointermove', e => {
    const d = pd
    if (!d || e.pointerId !== d.id) return
    const dx = e.clientX - d.x0
    if (!d.moved && Math.abs(dx) < 6) return
    d.moved = true
    const dt = Math.max(1, e.timeStamp - d.lastT)
    d.v = 0.7 * d.v + 0.3 * ((e.clientX - d.lastX) / dt)
    d.lastX = e.clientX; d.lastT = e.timeStamp
    d.pos = rubber(Math.max(0, d.base) - dx / STEP, d.ids.length)
    paintRuler(d)
    slide(d)
  })
  const pillUp = (e: PointerEvent) => {
    const d = pd
    if (!d || e.pointerId !== d.id || d.raf) return
    if (!d.moved) { pd = null; if (e.type === 'pointerup') { st.sheet = true; render() } return }
    // A flick carries on past the finger; a deliberate drag lands where it was let go.
    const v = e.timeStamp - d.lastT > 80 ? 0 : d.v
    const target = Math.min(d.ids.length - 1, Math.max(0, Math.round(d.pos - (Math.abs(v) > 0.45 ? v * 100 : 0) / STEP)))
    d.target = target
    const from = d.pos, t0 = performance.now(), dur = Math.min(420, 220 + 50 * Math.abs(target - from))
    if (!d.real || matchMedia('(prefers-reduced-motion: reduce)').matches) return land(d, target)
    const tick = (now: number) => {
      const k = Math.min(1, (now - t0) / dur)
      d.pos = from + (target - from) * (1 - Math.pow(1 - k, 3))
      paintRuler(d)
      slide(d)
      if (k < 1) d.raf = requestAnimationFrame(tick)
      else land(d, target)
    }
    d.raf = requestAnimationFrame(tick)
  }
  pill.addEventListener('pointerup', pillUp)
  pill.addEventListener('pointercancel', pillUp)
  pill.addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ' ') && (e.target as Element).closest('[data-pill-handle]')) { e.preventDefault(); st.sheet = true; render() }
  })

  // ---------- sidebar ----------
  // The switcher's columns, stacked: every level of the path is one line saying what is chosen
  // there, and one level opens as two columns side by side (the last two, unless a line was
  // clicked). Under them, the states and tools of the variant shown. On top, the variant your
  // requests change, said in words.
  function sideNav(inDrawer: boolean) {
    const cols = columns(), last = Math.max(0, cols.length - 2)
    const at = Math.min(st.pairAt ?? last, last)
    const pair = cols.slice(at, at + 2)
    const lineOf = (c: Col, i: number) => {
      const v = c.kind === 'variants' ? c.p.variants.find(x => x.id === c.sel) : undefined
      const k = c.kind === 'protos' ? c.list.find(x => x.id === c.sel) : undefined
      return `<div class="relative flex min-w-0 items-center"><button data-act="line:${i}" title="Open this level" class="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-lg px-1.5 text-left hover:bg-zinc-900/[.04] dark:hover:bg-white/[.06]">
        <span class="grid size-7 shrink-0 place-items-center rounded-md bg-zinc-900/[.05] text-[11px] font-semibold text-zinc-600 dark:bg-white/[.07] dark:text-zinc-300">${v && c.kind === 'variants' ? variantLabel(c.p, v.id) : ic('layers', 'size-3.5 text-zinc-400')}</span>
        <span class="min-w-0 flex-1 leading-tight ${v ? 'pe-9' : ''}"><span dir="auto" class="block truncate text-[10px] text-zinc-500">${esc(colName(c))}</span><span class="flex min-w-0 items-center gap-1 font-medium">${v ? `<span dir="auto" class="truncate">${esc(v.name)}</span>${c.kind === 'variants' && v.id === pickOf(c.p) ? ic('check', `size-3 shrink-0 ${PICK}`) : ''}` : k ? `<span dir="auto" class="truncate">${esc(k.title)}</span>` : '<span class="font-normal text-zinc-400">Choose one</span>'}</span></span>
        <span class="shrink-0 text-[10px] tabular-nums text-zinc-400">${colCount(c)}</span>${ic('chev', 'size-3 shrink-0 text-zinc-400')}</button>${v && c.kind === 'variants' ? `<button data-act="pv:${esc(c.p.id)}:${v.id}" aria-label="View ${variantLabel(c.p, v.id)}: ${esc(v.name)}" title="View this variant" class="absolute right-10 top-1 grid size-8 place-items-center rounded-md text-zinc-500 hover:bg-zinc-900/[.04] hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/[.06] dark:hover:text-white">${ic('eye', 'size-4')}</button>` : ''}</div>`
    }
    // Two columns meet at a separator that can be dragged (see "resizing the columns"); the first takes
    // its share from --split, the second the rest, and neither goes under 6rem.
    const two = pair.length > 1
    const split = `<div data-split role="separator" aria-orientation="vertical" aria-label="Resize columns" aria-valuemin="${SPLIT_LO * 100}" aria-valuemax="${SPLIT_HI * 100}" aria-valuenow="${Math.round(st.split * 100)}" tabindex="0" title="Drag to resize · double-click to reset" class="group/s relative z-10 -mx-[3px] w-1.5 shrink-0 cursor-col-resize touch-none outline-none"><span class="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-black/[.06] transition-colors group-hover/s:w-0.5 group-hover/s:bg-sky-500/50 group-focus-visible/s:w-0.5 group-focus-visible/s:bg-sky-500 [[data-splitting]_&]:w-0.5 [[data-splitting]_&]:bg-sky-500 dark:bg-white/[.07]"></span></div>`
    const box = `<div data-colnav="side" class="my-1 flex max-h-[26rem] overflow-hidden rounded-xl ring-1 ring-black/[.08] dark:ring-white/10">${pair.map((c, k) => `${k ? split : ''}<div ${two && !k ? 'style="flex:0 1 calc(var(--split) * 100%)"' : ''} class="flex min-w-24 flex-col pt-0.5 ${two && !k ? 'bg-zinc-900/[.02] dark:bg-white/[.02]' : 'flex-1'}">${colHead(c)}<div data-vlist data-k="${esc(colKey(c))}" class="relative min-h-0 flex-1 space-y-px overflow-y-auto overscroll-contain px-1 pb-1.5">${colRows(c)}</div></div>`).join('')}</div>`

    // The variant shown: its states (each opens it in that state) and its tools.
    const p = cur(), pv = st.place.view === 'variant' ? st.place : null
    const v = p && pv ? p.variants.find(x => x.id === pv.variant) : undefined
    let here = ''
    if (p && pv && v) {
      const sts = statesOf(p, v.id), tool = pv.tool
      const lit = tool === 'all' ? null : tool === 'play' ? st.playing : pv.state ?? ''
      const tools = (['play', 'all', 'compare'] as Tool[]).filter(t => toolOk(p, v.id, t))
      const leaf = (x?: State) => {
        const id = x?.id ?? '', on = lit === id, note = x?.about?.[v.id]
        return `<button data-act="pvs:${esc(p.id)}:${v.id}:${esc(id)}" aria-current="${on}" class="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left ${on ? ON : ROWC}">${dot(p, v.id, x, on)}<span class="min-w-0 flex-1"><span class="flex items-center gap-1.5 leading-4 ${on ? 'font-medium text-zinc-900 dark:text-white' : ''}"><span dir="auto" class="truncate">${esc(x?.name ?? 'At rest')}</span>${on && tool === 'play' ? ic('play', 'size-3 text-sky-500') : ''}</span>${note && x ? `<span dir="auto" class="mt-0.5 block text-[10px] leading-[14px] ${noteCls(p, v.id, x)}">${esc(note)}</span>` : ''}</span></button>`
      }
      if (sts.length || tools.length) here = `<div class="mt-3 border-t border-black/[.06] pt-2 dark:border-white/[.07]">
          <div class="flex items-center gap-1 px-1.5 pb-1 text-[10px] font-medium text-zinc-400"><b class="text-zinc-500">${variantLabel(p!, v.id)}</b><span dir="auto" class="truncate">${esc(v.name)}</span><span class="ml-auto">${sts.length ? `${sts.length} state${sts.length === 1 ? '' : 's'}` : ''}</span></div>
          ${sts.length ? `<div>${leaf()}${sts.map(leaf).join('')}</div>` : ''}
          ${tools.length ? `<div class="flex flex-wrap gap-1 px-1 pt-1.5">${tools.map(t => `<button data-act="tool:${esc(p.id)}:${v.id}:${t}" aria-pressed="${tool === t}" title="${TOOLS[t].hint}${tool === t ? ' · click to stop' : ''}" class="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] ${tool === t ? 'bg-sky-500/15 font-medium text-sky-800 dark:text-sky-200' : 'bg-zinc-900/[.04] text-zinc-600 hover:bg-zinc-900/[.08] dark:bg-white/[.06] dark:text-zinc-300 dark:hover:bg-white/10'}">${ic(TOOLS[t].icon, 'size-3')}${TOOLS[t].name}${t === 'compare' ? `<span class="text-zinc-400">${variantLabel(p, otherOf(p, v.id))}</span>` : ''}</button>`).join('')}</div>` : ''}
        </div>`
    }

    const initial = esc((session.name.trim()[0] || 'P').toUpperCase())
    return `<div class="flex h-12 shrink-0 items-center gap-2 pl-3 pr-1.5">
        <button data-act="lobby:session" title="Overview of the session" class="flex min-w-0 items-center gap-2"><span class="grid size-5 shrink-0 place-items-center rounded bg-zinc-900 text-[10px] font-bold text-white dark:bg-white dark:text-zinc-900">${initial}</span><span dir="auto" class="truncate font-semibold">${esc(session.name)}</span></button>
        <button data-act="${inDrawer ? 'drawer:0' : 'side:0'}" class="${IB} ml-auto shrink-0" title="${inDrawer ? 'Close' : 'Hide sidebar · ⌘\\'}" aria-label="${inDrawer ? 'Close' : 'Hide sidebar'}">${ic(inDrawer ? 'x' : 'sidebar')}</button>
      </div>
      ${workStrip()}
      <nav data-tree data-k="tree" class="min-h-0 flex-1 overflow-y-auto overscroll-contain border-t border-black/[.06] px-2 py-1.5 text-[12px] dark:border-white/[.07]" aria-label="Prototypes">
        ${cols.slice(0, at).map(lineOf).join('')}${box}${cols.slice(at + 2).map((c, j) => lineOf(c, at + 2 + j)).join('')}
        ${here}
      </nav>
      <div class="flex h-11 shrink-0 items-center gap-1 border-t border-black/[.07] pl-3 pr-1.5 dark:border-white/10">
        <span class="flex min-w-0 items-center gap-2 truncate text-[11px] text-zinc-500">${pulse('size-1.5', st.live && !st.stopped)}${st.stopped ? 'Stopped' : !st.live ? 'Reconnecting…' : st.lastEdit ? `Live · edited <span data-ago="${st.lastEdit}">${ago(st.lastEdit)}</span>` : 'Live'}</span>
        <button data-act="theme:${st.dark ? 'light' : 'dark'}" class="${IB} ml-auto shrink-0" aria-label="Switch to ${st.dark ? 'light' : 'dark'}">${ic(st.dark ? 'sun' : 'moon')}</button>
      </div>`
  }

  // The variant your requests change, in words. On it, it folds out what you asked for; anywhere
  // else, it says so and offers the way back. When Claude just moved it, it says from where.
  function workStrip() {
    const w = workOf()
    if (!w) return ''
    const here = atWork()
    const asks = asksOf(session.work!).slice().reverse()
    const mv = st.moved && refOk(st.moved)
    const picked = (t: string) => /^Picked [A-Z]{1,2}$/.test(t.trim())
    // What a plug-in leaves on both variants (app/server.mjs plugLines): status lines like a pick, not requests.
    const plugged = (t: string) => /^(Plugged in(to)?|Original back( in|, took out)) .+ [A-Z]{1,2}$/.test(t.trim())
    const n = asks.filter(a => !picked(a.text) && !plugged(a.text)).length
    return `<div class="mx-2 mb-2 rounded-xl bg-zinc-900/[.04] p-2 text-[12px] dark:bg-white/[.05]">
        <button data-act="work:go" ${here ? 'aria-current="true"' : 'title="Go to it · W"'} class="flex w-full min-w-0 items-center gap-2.5 text-left">
          <span class="grid size-8 shrink-0 place-items-center rounded-lg bg-emerald-500/15 text-[12px] font-semibold text-emerald-700 dark:text-emerald-300">${variantLabel(w.p, w.v.id)}</span>
          <span class="min-w-0 flex-1 leading-tight"><span class="flex items-center gap-1.5 text-[10px] text-zinc-500">${here ? 'Your requests change this design' : 'Your requests change'}${editing(w.p.id, w.v.id) ? `<span class="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">${pulse('size-1.5')}editing</span>` : ''}</span>
            <span class="mt-0.5 flex min-w-0 items-center gap-1 font-semibold"><span dir="auto" class="min-w-0 truncate">${esc(w.p.title)}</span><span class="shrink-0 font-normal text-zinc-400">·</span><span class="shrink-0">${variantLabel(w.p, w.v.id)}</span><span dir="auto" class="min-w-0 truncate">${esc(w.v.name)}</span></span></span>
        </button>
        ${here ? '' : `<button data-act="work:go" class="mt-2 flex h-8 w-full items-center justify-center gap-1.5 rounded-lg bg-white text-[11px] font-medium shadow-sm ring-1 ring-black/10 hover:bg-zinc-50 dark:bg-zinc-800 dark:ring-white/10 dark:hover:bg-zinc-700">Go to it<span class="font-normal text-zinc-400">· or keep looking here</span><kbd class="ml-1 hidden rounded px-1 font-sans text-[10px] font-normal text-zinc-400 ring-1 ring-inset ring-black/10 [@media(hover:hover)]:inline dark:ring-white/15">W</kbd></button>`}
        ${st.failed?.at === 'work' ? `<p role="alert" class="mt-2 rounded-lg bg-rose-500/10 px-2.5 py-1.5 text-[11px] text-rose-700 dark:text-rose-300">${esc(st.failed.text)}</p>` : ''}
        ${mv ? `<div class="mt-2 flex items-center gap-1.5 rounded-lg bg-amber-500/[.08] px-2 py-1 text-[11px]"><span class="text-amber-600">${ic('from', 'size-3.5')}</span><span class="min-w-0 flex-1 truncate text-zinc-600 dark:text-zinc-300">Moved here from <b class="font-semibold">${variantLabel(mv.p, mv.v.id)}</b> · ${bd(mv.v.name)}${mv.p !== w.p ? ` <span class="text-zinc-400">in ${bd(mv.p.title)}</span>` : ''}</span><button data-act="work:undo" class="h-6 shrink-0 rounded-md px-1.5 font-medium text-zinc-900 hover:bg-zinc-900/[.06] dark:text-white dark:hover:bg-white/10">Undo</button></div>` : ''}
        ${asks.length ? `<button data-act="asks" aria-expanded="${st.asks}" class="mt-1.5 flex h-7 w-full items-center gap-1.5 rounded-md px-1 text-[11px] text-zinc-500 hover:text-zinc-900 dark:hover:text-white">${ic('clock', 'size-3.5')}${n} change${n === 1 ? '' : 's'} you asked for${ic('chev', `ml-auto size-3.5 transition-transform ${st.asks ? 'rotate-180' : ''}`)}</button>
          ${st.asks ? `<ol class="max-h-48 space-y-1.5 overflow-y-auto overscroll-contain px-1 pb-1 pt-1">${asks.map(a => { const pk = picked(a.text), ok = pk || plugged(a.text), t = Date.parse(a.at); return `<li class="flex gap-2 text-[11px] leading-[15px]"><span class="mt-px grid size-3.5 shrink-0 place-items-center rounded-full ${ok ? 'bg-emerald-500 text-white' : 'bg-zinc-900/[.08] text-zinc-500 dark:bg-white/10 dark:text-zinc-400'}">${ic('check', 'size-2.5')}</span><span dir="auto" class="min-w-0 flex-1 ${ok ? 'text-emerald-700 dark:text-emerald-300' : 'text-zinc-700 dark:text-zinc-300'}">${pk ? `You picked ${esc(a.text.trim().slice(7))}` : esc(a.text)}</span>${t ? `<span class="shrink-0 text-[10px] text-zinc-400" data-ago="${t}">${ago(t)}</span>` : ''}</li>` }).join('')}</ol>` : ''}` : ''}
      </div>`
  }

  // ---------- tab icon ----------
  // The skill's icon with the session's initial in a badge that is also the live light (gray once
  // the server is gone).
  let iconKey = ''
  function paintIcon() {
    const initial = esc((session.name.trim()[0] || 'P').toUpperCase())
    const live = st.live && !st.stopped
    if (iconKey === initial + live) return
    iconKey = initial + live
    const svg = tabIcon(initial, live)
    let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
    if (!link) { link = document.createElement('link'); link.rel = 'icon'; document.head.append(link) }
    link.type = 'image/svg+xml'
    link.href = `data:image/svg+xml,${encodeURIComponent(svg)}`
  }

  // ---------- actions ----------
  /** The same variant without its tool (compare keeps its state; the others go back to rest). */
  const untool = (pl: Place): Place => pl.view === 'variant' ? { view: 'variant', proto: pl.proto, variant: pl.variant, ...(pl.tool === 'compare' && pl.state ? { state: pl.state } : {}) } : pl
  function act(name: string, arg: string, arg2: string, arg3 = '') {
    const p = cur()
    const here = st.place.view === 'variant' ? st.place : null
    switch (name) {
      case 'share': {
        const p = arg ? byId(arg) : cur()
        if (framed || !p) return
        const selected = arg2 || (here?.proto === p.id ? here.variant : null)
        shareOpen = true
        st.open = null; st.menu = ''; closeCard(true); render()
        const host = here?.proto === p.id ? toolHost() : null, r = host?.getBoundingClientRect()
        const w = host?.clientWidth || Math.round(r?.width || p.screen[0] || 1440)
        const h = host?.clientHeight || Math.round(r?.height || p.screen[1] || 900)
        drawShare({ title: p.title, slug: p.id, current: selected, dark: st.dark, size: { w, h },
          variants: p.variants.map(v => ({ id: v.id, name: v.name, ...(host && v.id === here?.variant ? { tweaks: Object.fromEntries(tweaks.of(host).map(t => [t.id, t.value])) } : {}), hash: hashOf({ view: 'variant', proto: p.id, variant: v.id, ...(here?.proto === p.id && here.state && stateOf(p, v.id, here.state) ? { state: here.state } : {}) }) })),
          onClose: () => { shareOpen = false; drawShare(null) }, returnFocus: () => phoneMq.matches ? menuBtn() : [...root.querySelectorAll<HTMLElement>('[data-act]')].find(el => el.dataset.act === `vm:${p.id}:${selected}` && el.getClientRects().length > 0) ?? bar.querySelector<HTMLElement>('[data-shoot=switcher]'),
        })
        return
      }
      case 'settings': settingsOpen = true; st.open = null; st.menu = ''; st.drawer = false; render(); void refreshStatus(); return
      case 'tweaks': {
        if (!tweakList().length) return
        if (phoneMq.matches) { tweaksOpen = !tweaksOpen; trySheet = 'closed'; if (tweaksOpen) comments.escape(); closeCard(true) }
        else { selectPanelTab('tweaks'); hintsOpen = true; if (wideMq.matches) remember('proto-hints', '1') }
        return render()
      }
      case 'comment': if (arg === 'tap') { comments.copy.off(); return comments.tap() } return toggleComment()
      // The phone's Try it key: the sheet up, or down. Brought back from away, the spot goes out.
      case 'try': { const to = trySheet === 'open' ? 'closed' : 'open'; trySheet = to; setTry(null); return setTrySheet(to) }
      case 'copymode': return comments.copy.toggle()
      case 'motion': st.motion = !st.motion; return render()
      // A state leaf: that variant in that state. Comparing keeps comparing.
      case 'pvs': {
        const keep = here?.tool === 'compare' && here.proto === arg && here.variant === arg2
        return go({ view: 'variant', proto: arg, variant: arg2, ...(arg3 ? { state: arg3 } : {}), ...(keep ? { tool: 'compare' as Tool } : {}) })
      }
      // A tool from a variant's ⋯ menu; choosing the one that is on turns it off.
      case 'tool': {
        st.open = null
        const t = arg3 as Tool
        if (here && here.proto === arg && here.variant === arg2 && here.tool === t) return go(untool(here))
        const state = t === 'compare' && here?.proto === arg && here.variant === arg2 ? here.state : undefined
        return go({ view: 'variant', proto: arg, variant: arg2, tool: t, ...(state ? { state } : {}) })
      }
      case 'vs': if (p) { st.vs.set(p.id, arg); show(false); render() } return
      case 'nextdiff': {
        if (!p || !here) return
        const v = here.variant, o = otherOf(p, v)
        const list = statesOf(p, v).filter(x => changed(p, v, x) || changed(p, o, x))
        if (!list.length) return
        const i = list.findIndex(x => x.id === here.state)
        return go({ ...here, state: list[(i + 1) % list.length].id })
      }
      case 'play': return arg === 'jump' ? layer?.player?.jump(Number(arg2)) : layer?.player?.toggle()
      case 'lobby': return arg === 'session' ? go({ view: 'session' }) : go({ view: 'proto', proto: arg2 || p!.id })
      case 'proto': return openProto(arg)
      case 'pv': return go({ view: 'variant', proto: arg, variant: arg2 })
      // In the columns: a variant (kept open when something was built from it) or a prototype.
      case 'mv': { const q = byId(arg); keepOpen = !!q && kidsOf(q, arg2).length > 0; return go(q ? keepIn(q, arg2) : { view: 'variant', proto: arg, variant: arg2 }) }
      case 'mp': keepOpen = true; return go({ view: 'proto', proto: arg })
      case 'line': st.pairAt = Number(arg); recenter = true; return render()
      case 'drill': st.drill = Number(arg); recenter = true; return render()
      case 'asks': st.asks = !st.asks; return render()
      case 'variant': return go(keepIn(p!, arg))
      case 'step': return step(Number(arg))
      case 'open': st.open = st.open === arg ? null : arg; st.copied = false; st.failed = null; recenter = true; if (arg === 'session' || arg === 'decide') refreshStatus(); return render()
      case 'archived': st.archived = !st.archived; return render()
      case 'work': {
        const w = workOf()
        if (arg === 'go') return w && go({ view: 'variant', proto: w.p.id, variant: w.v.id })
        // The page's own moves come back through session.json; they aren't Claude's to undo.
        if (arg === 'undo') {
          const m = st.moved
          st.moved = null; clearTimeout(movedTimer); render()
          if (m) { expected = m; post('work', { ...m, undo: true }, 'work').then(got => { expected = got && same(got.work, m) && !same(session.work, m) ? m : null }) }
          return
        }
        return
      }
      // Wide windows dock the sidebar (remembered); narrower ones open it as a drawer.
      case 'side': recenter = true; if (!wide()) { st.drawer = arg === '1'; return render() } st.side = arg === '1'; remember('proto-side', st.side ? '1' : '0'); return render()
      case 'drawer': st.drawer = arg === '1'; return render()
      case 'menu': st.menu = arg as typeof st.menu; recenter = true; return render()
      case 'stack': {
        const on = arg === '1'
        if (st.stack === on) return
        st.stack = on; remember('proto-lobby', on ? 'stack' : 'grid')
        return st.place.view === 'variant' ? render() : show(true)
      }
      case 'scale': return setScale(Number(arg))
      // The device view: a size, the tablet turned (its zoom is the scale control's, above).
      case 'size': return pickSize(arg as Size)
      case 'turn': return patchView({ land: !st.view.land, zoom: 0 })
      case 'scalestep': { const [lo, hi] = scaleRange(); return setScale(Math.min(hi, Math.max(lo, Math.round(((scaleNow() || 50) + Number(arg)) / 5) * 5))) }
      case 'theme': return setTheme(arg === 'dark')
      case 'focus': if (st.place.view !== 'variant') return; st.focus = true; st.open = null; dock.hold = performance.now() + 1600; edge.hover = {}; render(); return fit()
      case 'unfocus': st.focus = false; st.open = null; edge.hover = {}; render(); return fit()
      case 'copy': navigator.clipboard?.writeText(session.url || location.href); st.copied = true; return render()
      case 'keep': return post('keep', { keep: !st.status?.keep }, 'session')
      case 'stop': return post('stop', {}, 'session').then(got => { if (got) { st.stopped = true; render() } })
    }
  }

  root.addEventListener('click', e => {
    // Clicks the shell replays inside a design (to reach a state) are the design's business; in
    // a lobby card they would otherwise bubble up to the card and open it.
    if (!e.isTrusted && (e.target as Element).closest('[data-mount]')) return
    const el = (e.target as Element).closest<HTMLElement>('[data-act]')
    if (!el) {
      if (st.open && !(e.target as Element).closest('[data-pop]')) { st.open = null; render() }
      return
    }
    const [name, arg = '', arg2 = '', arg3 = ''] = el.dataset.act!.split(':')
    if (name === 'settings') settingsOrigin = el.closest('[data-overlay]') ? 'dock' : 'bar'
    // A row's own options (its ⋯): the same menu as right-click, beside the button.
    if (name === 'vm') {
      const r = el.getBoundingClientRect()
      return openVmenu(arg, arg2, r.right + 6, r.top)
    }
    act(name, arg, arg2, arg3)
    // Opened from the keyboard, the switcher's columns take the focus, on the row lit last.
    if (el.dataset.act === 'open:switch' && e.detail === 0 && st.open === 'switch') focusCol([...bar.querySelectorAll('[data-colnav] [data-vlist]')].at(-1))
  })

  // ---------- the columns, by keyboard ----------
  // A focused row moves up and down its column, Home and End to its ends, and a letter to the
  // next row starting with it. Left and right go to the next column's lit row; right on a row
  // that opens a column opens it first. In the sidebar the pair of columns slides along the path.
  // Enter chooses, as a click does. A row is a prototype's button, a variant's (not its ⋯), or the
  // archived fold.
  const ROW = '[data-vlist] > button, [data-vlist] [data-mv] > [data-act^="mv:"]'
  const rowsOf = (list: Element) => [...list.querySelectorAll<HTMLElement>(':scope > button, [data-mv] > [data-act^="mv:"]')]
  function focusCol(list: Element | undefined) {
    const window = list && navLists.get(list)
    if (window) { const selected = list!.querySelector<HTMLElement>('[data-virtual-selected]')?.dataset.virtualSelected; window.focus(Math.max(0, window.items.findIndex(v => v.id === selected)), '[data-act^="mv:"]'); return }
    const rows = list ? rowsOf(list) : [], to = rows.find(b => b.getAttribute('aria-current') === 'true') ?? rows[0]
    to?.focus()
    to?.scrollIntoView({ block: 'nearest' })
  }
  // The column `d` from the focused one, after the page has drawn what it opens.
  function stepCol(d: number) {
    const list = document.activeElement?.closest('[data-vlist]'), nav = list?.closest<HTMLElement>('[data-colnav]')
    if (!list || !nav) return
    const lists = [...nav.querySelectorAll('[data-vlist]')], i = lists.indexOf(list)
    if (lists[i + d]) return focusCol(lists[i + d])
    if (nav.dataset.colnav !== 'side') return
    const last = Math.max(0, columns().length - 2), at = Math.min(st.pairAt ?? last, last)
    if (at + d < 0 || at + d > last) return
    // The docked sidebar keeps its markup while hidden, so the focus goes back where it was.
    const host = side.contains(nav) ? side : drawer
    st.pairAt = at + d
    render()
    const now = [...host.querySelectorAll('[data-colnav] [data-vlist]')]
    focusCol(d < 0 ? now[0] : now.at(-1))
  }
  root.addEventListener('keydown', e => {
    const row = (e.target as Element).closest?.<HTMLElement>(ROW)
    if (!row || e.metaKey || e.ctrlKey || e.altKey) return
    const list = row.closest('[data-vlist]')!, window = navLists.get(list)
    const rows = rowsOf(list), i = window ? Number(row.closest<HTMLElement>('[data-virtual-index]')!.dataset.virtualIndex) : rows.indexOf(row)
    const toIndex = (index: number) => { e.preventDefault(); window!.focus(Math.max(0, Math.min(window!.items.length - 1, index)), '[data-act^="mv:"]') }
    if (window) {
      if (e.key === 'ArrowDown') return toIndex(i + 1)
      if (e.key === 'ArrowUp') return toIndex(i - 1)
      if (e.key === 'Home') return toIndex(0)
      if (e.key === 'End') return toIndex(window.items.length - 1)
      if (e.key.length === 1 && e.key.trim()) {
        const p = byId(list.querySelector<HTMLElement>('[data-virtual-list]')!.dataset.virtualList!)!
        for (let offset = 1; offset <= window.items.length; offset++) { const index = (i + offset) % window.items.length, v = window.items[index]; if (`${variantLabel(p, v.id)} ${v.name}`.toLowerCase().startsWith(e.key.toLowerCase())) return toIndex(index) }
        return
      }
    }
    const to = (b?: HTMLElement) => { e.preventDefault(); b?.focus(); b?.scrollIntoView({ block: 'nearest' }) }
    if (e.key === 'ArrowDown') return to(rows[Math.min(i + 1, rows.length - 1)])
    if (e.key === 'ArrowUp') return to(rows[Math.max(i - 1, 0)])
    if (e.key === 'Home') return to(rows[0])
    if (e.key === 'End') return to(rows.at(-1))
    // The context menu key (or Shift F10) opens a variant's options, as its ⋯ button does.
    if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
      const opts = row.parentElement!.querySelector<HTMLElement>(':scope > [data-act^="vm:"]')
      if (opts) { e.preventDefault(); opts.click() }
      return
    }
    if (e.key === 'ArrowLeft') { e.preventDefault(); return stepCol(-1) }
    if (e.key === 'ArrowRight') {
      e.preventDefault()
      if (!row.hasAttribute('data-opens') || row.getAttribute('aria-current') === 'true') return stepCol(1)
      // Choosing it may wait for the hash to change before the next column is drawn.
      const hash = location.hash
      row.click()
      if (location.hash === hash) return stepCol(1)
      return addEventListener('hashchange', () => stepCol(1), { once: true })
    }
    if (e.key.length === 1 && e.key.trim()) {
      const k = e.key.toLowerCase(), order = [...rows.slice(i + 1), ...rows.slice(0, i + 1)]
      const hit = order.find(b => b.textContent!.trim().toLowerCase().startsWith(k))
      if (hit) to(hit)
    }
  })
  // Right-click: every surface with something to do has a menu at the pointer (see "right-click
  // menus" below). Shift + right-click is never taken, so the browser's own menu (Inspect, Save
  // image) is always one modifier away; so are fields, selected text, and a design that made its
  // own menu. A touch screen's long press keeps its own gestures.
  root.addEventListener('contextmenu', e => {
    if (framed || e.shiftKey || e.defaultPrevented) return
    const on = ctxOf(e.target as Element)
    if (!on) return
    // The columns' variant rows open before the touch check: a long press there always did.
    if (on.kind !== 'variant' && (e as PointerEvent).pointerType === 'touch') return
    e.preventDefault()
    openCtx(on, e.clientX, e.clientY)
  })
  // Right-click inside the artboard's frame: its document keeps its events, so the view hands them out here.
  frameMenus.add((e, x, y) => {
    if (e.shiftKey || e.defaultPrevented || (e as PointerEvent).pointerType === 'touch' || comments.busy()) return
    const el = e.target as Element
    if (el.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]') || (el.ownerDocument.getSelection()?.toString() ?? '')) return
    if (st.place.view !== 'variant' || !commentHost()) return
    e.preventDefault()
    openCtx({ kind: 'art', el: htmlOf(el) }, x, y)
  })
  // A click in the artboard's frame is outside the menu too.
  frameClicks.add(() => { if (st.open === 'ctx' || st.open === 'vmenu') { st.open = null; render() } })

  root.addEventListener('input', e => {
    const input = e.target as HTMLInputElement
    // The slider repaints only what shows its value: rebuilding the bar would end the drag.
    if (input.matches('[data-scale-range]')) {
      const v = Number(input.value), at = SCALES.find(s => s && Math.abs(s - v) <= 2) ?? v
      input.value = String(at)
      input.style.setProperty('--p', `${rangeAt(at)}%`)
      input.classList.remove('opacity-40')
      if (frameOn()) { st.view = { ...st.view, zoom: at }; paintView(); return syncScale(input) }
      st.scale = at
      syncScale(input)
      return fit()
    }
  })

  listen(window, 'keydown', e => {
    const t = e.target as Element
    if (settingsOpen || shareOpen) return
    if ((e.metaKey || e.ctrlKey) && e.key === '\\') { e.preventDefault(); return act('side', (wide() ? st.side : st.drawer) ? '0' : '1', '') }
    // Cmd or Ctrl Enter sends what's ready to Claude, from anywhere but a field of the design's own.
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && !e.defaultPrevented && comments.counts().drafts && !t.closest?.('input, textarea, select, [contenteditable]')) { e.preventDefault(); void comments.act.send(); return }
    if (e.key === 'Escape') {
      if (tweaksOpen) { e.preventDefault(); tweaksOpen = false; render(); return }
      if (tryEsc()) return
      if (trySheet === 'open') return setTrySheet('closed')
      if (comments.copy.escape()) return
      if (comments.escape()) return
      if (card && card.phase !== 'exit') return closeCard()
      // A menu closed from inside gives the focus back to its button.
      if (st.open) { const was = st.open, inside = !!t.closest?.('[data-pop]'); st.open = null; render(); if (inside) bar.querySelector<HTMLElement>(`[data-act="open:${was}"]`)?.focus(); return }
      if (st.drawer) { st.drawer = false; return render() }
      if (viewOn()) return patchView({ size: null, zoom: 0 })
      if (st.focus) return act('unfocus', '', '')
      if (st.place.view === 'variant' && st.place.tool) return go(untool(st.place))
    }
    if (e.metaKey || e.ctrlKey || e.altKey || st.sheet || trySheet === 'open' || t.closest?.(INTERACTIVE) || t.closest?.('[data-vlist]')) return
    // Esc on a variant goes up to its prototype's variants, unless the design used it first (a
    // design closing its own menu calls preventDefault). Its handlers may run after this one,
    // so the check waits a tick.
    if (e.key === 'Escape' && st.place.view === 'variant') {
      const from = hashOf(st.place)
      setTimeout(() => { if (!e.defaultPrevented && st.place.view === 'variant' && hashOf(st.place) === from) go({ view: 'proto', proto: st.place.proto }) })
      return
    }
    if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && st.place.view === 'variant') { e.preventDefault(); step(e.key === 'ArrowRight' ? 1 : -1) }
    else if (e.key === 'c' && commentHost()) { e.preventDefault(); toggleComment() }
    else if (e.key === 'C' && commentHost() && st.place.view === 'variant') { e.preventDefault(); commentWhole() }
    // Focus mode and the design's actions are the page outside's, when this page is in its view (viewKey).
    else if (e.key === 'f' && st.place.view === 'variant' && !framed) act(st.focus ? 'unfocus' : 'focus', '', '')
    else if (e.key === 'w' && workOf()) act('work', 'go', '')
    else if (e.key === 'p' && decideOf() && !st.focus && !phoneMq.matches && !framed) act('open', 'decide', '')
  })

  // ---------- resizing the sidebar ----------
  // The grip sits on the sidebar's edge and is never re-rendered, so a drag survives the
  // chrome re-rendering under it (status pings, edits).
  const setSideW = (w: number, save = true) => {
    st.sideW = Math.round(Math.min(SIDE_MAX, Math.max(SIDE_MIN, w)))
    side.style.width = `${st.sideW}px`
    grip.setAttribute('aria-valuenow', String(st.sideW))
    if (save) remember('proto-side-w', String(st.sideW))
  }
  grip.setAttribute('aria-valuemin', String(SIDE_MIN))
  grip.setAttribute('aria-valuemax', String(SIDE_MAX))
  grip.addEventListener('pointerdown', e => {
    if (e.button !== 0) return
    e.preventDefault()
    grip.setPointerCapture(e.pointerId)
    grip.dataset.dragging = ''
    document.documentElement.style.cursor = 'col-resize'
    const left = side.getBoundingClientRect().left
    const move = (m: PointerEvent) => setSideW(m.clientX - left, false)
    const end = () => {
      grip.removeEventListener('pointermove', move)
      delete grip.dataset.dragging
      document.documentElement.style.cursor = ''
      setSideW(st.sideW)
    }
    grip.addEventListener('pointermove', move)
    grip.addEventListener('lostpointercapture', end, { once: true })
  })
  grip.addEventListener('dblclick', () => setSideW(SIDE_W))
  grip.addEventListener('keydown', e => {
    const d = e.key === 'ArrowLeft' ? -16 : e.key === 'ArrowRight' ? 16 : 0
    if (d) { e.preventDefault(); setSideW(st.sideW + d) }
  })

  // ---------- resizing the columns ----------
  // The separator is in markup the chrome redraws, so a drag is held by the sidebar and the drawer,
  // which it never redraws, and the split is one variable on the shell's root: nothing redraws.
  const setSplit = (f: number, save = true) => {
    st.split = Math.round(Math.min(SPLIT_HI, Math.max(SPLIT_LO, f)) * 1000) / 1000
    root.style.setProperty('--split', String(st.split))
    root.querySelectorAll('[data-split]').forEach(el => el.setAttribute('aria-valuenow', String(Math.round(st.split * 100))))
    if (save) remember('proto-split', String(st.split))
  }
  setSplit(st.split, false)
  for (const host of [side, drawer]) {
    const onSplit = (e: Event) => (e.target as HTMLElement).closest<HTMLElement>('[data-split]')
    host.addEventListener('pointerdown', e => {
      const h = onSplit(e)
      if (!h || e.button !== 0) return
      e.preventDefault()
      host.setPointerCapture(e.pointerId)
      host.dataset.splitting = ''
      document.documentElement.style.cursor = 'col-resize'
      const box = h.parentElement!.getBoundingClientRect()
      const move = (m: PointerEvent) => setSplit((m.clientX - box.left) / box.width, false)
      const end = () => {
        host.removeEventListener('pointermove', move)
        delete host.dataset.splitting
        document.documentElement.style.cursor = ''
        setSplit(st.split)
      }
      host.addEventListener('pointermove', move)
      host.addEventListener('lostpointercapture', end, { once: true })
    })
    host.addEventListener('dblclick', e => { if (onSplit(e)) setSplit(SPLIT_W) })
    host.addEventListener('keydown', e => {
      const h = onSplit(e), d = e.key === 'ArrowLeft' ? -0.04 : e.key === 'ArrowRight' ? 0.04 : 0
      if (h && d) { e.preventDefault(); setSplit(st.split + d) }
    })
  }

  // ---------- Try it: what the design on the stage says a reviewer needs ----------
  // Docked at the stage's right edge on a wide screen, so the design narrows instead of being
  // covered; a sheet over the design on a narrow one; closed, a tab on the edge. Shown for one
  // variant on the stage (not lobbies or tools), and never in proto shoot (?hints=0), so shots
  // keep the design at its full width.
  const HINTS_W = 264
  const wideMq = matchMedia('(min-width: 1024px)')
  let hintsOpen = wideMq.matches && localStorage.getItem('proto-hints') !== '0'
  let hintSaid = '', hintCopied = -1, hintTimer = 0, hintsDocked = false
  const hintHost = () => st.place.view === 'variant' && !st.place.tool ? layer?.el.querySelector<HTMLElement>('[data-mount]') ?? null : null
  // The design the tools work on: the one in the device view while it is on (it reports here, see
  // shared.ts), else the one on the stage. The page inside a view has none: the page outside runs them.
  const toolHost = () => frameOn() ? deviceView.mount() : hintHost()
  // What the bar and the panel count while a view's frame is still loading: the same design on the
  // stage under it, so its buttons and tabs don't go and come back. Only what they show; what acts
  // on the design (a spot, Fill in, copy mode) waits for the frame's.
  // Also once the frame has its design but before it has declared anything (its hints, copy lines
  // and motion come in effects, a moment after it mounts): the stage's copy has declared the same.
  const countHost = () => { const t = toolHost(); return t && (hints.of(t).length || copy.of(t).length || motion.of(t) || tweaks.of(t).length) ? t : hintHost() ?? t }
  const hintList = () => framed || q.get('hints') === '0' ? [] : hints.of(countHost())
  const tweakList = () => framed || q.get('hints') === '0' || !hintHost() ? [] : tweaks.of(toolHost())
  let tweaksOpen = false, tweaksUp = false
  const tweaksBtn = () => !tweakList().length || st.focus ? '' : `<button data-act="tweaks" data-shoot="tweaks" aria-label="Tweaks" aria-expanded="${hintsOpen && tab === 'tweaks'}" class="${IB} hidden sm:inline-flex">${ic('tweaks')}<span class="hidden xl:inline">Tweaks</span></button>`
  const valueOf = (h: Extract<Hint, { kind: 'value' }>) => { try { return String(typeof h.value === 'function' ? h.value() : h.value) } catch { return '' } }
  const flash = () => { clearTimeout(hintTimer); hintTimer = window.setTimeout(() => { hintSaid = ''; hintCopied = -1; paintHints() }, 1400) }

  // ---------- comments ----------
  // Commenting lives in the stage's own layer (comments/), over a variant on the page and nowhere
  // else: not a lobby, not a tool (all states, compare, autoplay), not focus mode, not a shot.
  const phoneMq = matchMedia('(max-width: 639px)')
  const HANDLE = 'flex h-9 items-center gap-1.5 rounded-l-lg bg-white/95 pl-2.5 pr-3 text-xs font-medium text-zinc-900 shadow-lg shadow-black/10 ring-1 ring-black/10 backdrop-blur hover:bg-white dark:bg-zinc-900/95 dark:text-zinc-100 dark:ring-white/15 dark:hover:bg-zinc-900'
  // The page inside a device view has none of its own: the page outside comments on it.
  const commentHost = () => !framed && !st.focus && q.get('hints') !== '0' ? hintHost() : null
  // The side panel carries the list; a phone has it as a sheet from the pill.
  const railOn = () => !!commentHost() && !phoneMq.matches
  const comments = createComments({
    layer: zone.querySelector<HTMLElement>('[data-comments]')!,
    // While a device view is on, comments are on the design in its frame, about that layout.
    // The stage's own artboard is the stage's layout: what is written there carries no other.
    mount: () => !commentHost() ? null : frameOn() ? deviceView.mount() : commentHost(),
    view: () => frameOn() ? { ...(viewOn() ? viewSize() : {}), at: deviceView.at } : null,
    setView: v => {
      if (!v) { if (viewOn()) patchView({ size: null, zoom: 0 }); return }
      if (!viewOk()) return
      const land = v.size === 'tablet' && v.w > v.h
      if (!viewOn() || st.view.size !== v.size || st.view.land !== land) patchView({ size: v.size, land, zoom: 0 })
    },
    go: (proto, variant, state) => go(variant ? { view: 'variant', proto, variant, ...(state ? { state } : {}) } : { view: 'proto', proto }),
    send: sendBatch,
    withdraw: async (batch, n) => { await post('withdraw', { batch, n }) },
    agentName: () => agentName(session.agent),
    dark: () => st.dark,
  }, framed ? `${session.id}~view` : session.id)
  // A design's own page listeners don't hear commenting: anything while picking or writing, a press
  // on the comment chrome, or the C that starts it. So a menu open in the design stays open, and
  // what is in it can be commented on.
  const COMMENT_UI = '[data-comments], [data-cbody], [data-comments-sheet], [data-comment-ui], [data-composer], [data-tag-menu], [data-act^="comment:"]'
  quiet(e => {
    if (comments.busy()) return true
    const t = e.target instanceof Element ? e.target : null
    if (t?.closest(COMMENT_UI)) return true
    if (t?.closest('[data-settings-ui]')) {
      // Drawer release events finish its native swipe. Keys, presses and clicks still belong
      // to Settings, so a design's page shortcuts or outside-click handlers stay quiet.
      return !t.closest('[data-settings-drawer]') || (e.type !== 'pointerup' && e.type !== 'touchend')
    }
    const k = e as KeyboardEvent
    return (e.type === 'keydown' || e.type === 'keyup') && k.key === 'c' && !k.metaKey && !k.ctrlKey && !k.altKey && !st.sheet && !!commentHost() && !t?.closest(INTERACTIVE)
  })

  // ---------- the device view: this page at another layout's size, in the stage (view/) ----------
  // Three sizes in the bar on a wide screen, the Layout row of the pill's menu on a phone; the
  // layout this window already is (its own breakpoints) is the one selected at rest, and choosing it
  // leaves the view. Not in the page inside a view (no frames in frames), focus mode or a shot, and
  // not for a phone prototype: its design is the same phone screen at every window size. The window's
  // layout is native only while the stage is wide enough for it too: a desktop window with the side
  // panels open can leave the stage a tablet's width, where the design is cut off. Then none is, and
  // choosing the window's own layout shows it in the view, at its full size, to zoom and move.
  //
  // At rest, a web prototype's variant on a wide screen is in the view too, as the stage's own
  // artboard (fill): the stage's size at 100%, so it looks as it always did, with zoom and moving it
  // on hand, and the design laid out for the stage's width (its breakpoints see the frame, not the
  // window). Its layout is the one selected then. A lobby, a tool, focus mode, a shot and a phone
  // keep the stage as it is.
  // Focus mode leaves a chosen layout, as it always did, but keeps the stage's own artboard: the frame
  // and the design in it stay as they are (an open menu, what was typed), as on the stage.
  const frameable = () => !framed && q.get('hints') !== '0' && st.place.view !== 'session' && cur()?.kind !== 'phone'
  const viewOk = () => frameable() && !st.focus && (!phoneMq.matches || pillOn())
  const fillOk = () => frameable() && !phoneMq.matches && st.place.view === 'variant' && !st.place.tool
  const native = (): Size | null => {
    if (fillOk()) return nativeOf(layers.clientWidth || innerWidth)
    const s = nativeOf(innerWidth); return !layers.clientWidth || nativeOf(layers.clientWidth) === s ? s : null
  }
  /** A layout other than the stage's own is chosen. */
  const viewOn = () => !!st.view.size && viewOk()
  /** The design is shown in the view's frame: a chosen layout, or the stage's own artboard. */
  const frameOn = () => viewOn() || fillOk()
  const shownSize = (): Size | null => viewOn() ? st.view.size! : native()
  const viewSize = (): ViewSize => { const s = st.view.size!, d = dims(s, st.view.land); return { size: s, w: d.w, h: d.h } }
  const deviceView = createView(zone.querySelector<HTMLElement>('[data-view]')!, comments.wrap)
  // The size selected at rest is this window's own layout, which a resize of it or the stage can change.
  let nativeWas = native()
  new ResizeObserver(() => { if (native() !== nativeWas) { nativeWas = native(); render() } }).observe(layers)
  function pickSize(s: Size) {
    // The layout shown, chosen again, leaves the view: the way out when no layout is this window's own.
    if (s === native() || (viewOn() && s === st.view.size)) { if (viewOn()) patchView({ size: null, zoom: 0 }); return }
    patchView({ size: s, zoom: 0 })
  }
  /** Changes the view; what the chrome shows (its size, turned or not) redraws it, a zoom only the view. */
  function patchView(p: Partial<typeof st.view>) {
    const was = st.view
    st.view = { ...was, ...p }
    if (st.view.size !== was.size || st.view.land !== was.land) { render(); fit() }
    else { paintView(); syncScale() }
  }
  function paintView() {
    deviceView.paint({
      view: frameOn() ? { size: viewOn() ? st.view.size! : null, land: st.view.land, zoom: st.view.zoom, home: st.view.home } : null,
      hash: hashOf(st.place),
      dark: st.dark,
      set: patchView,
      // The page in the view moved (its own chrome): this page follows, unless it is there already.
      route: h => { if (h && h !== location.hash) location.hash = h },
      onKey: viewKey,
    })
  }
  /** Keys pressed in the page inside the view: C comments on it, F is focus mode and P the design's
   *  actions, as out here, and Esc stops. */
  function viewKey(e: KeyboardEvent) {
    if (settingsOpen || shareOpen) return
    const t = e.target as Element
    if (e.metaKey || e.ctrlKey || e.altKey || t.closest?.('input, textarea, select, [contenteditable]')) return
    if (e.key === 'c' && commentHost()) { e.preventDefault(); toggleComment() }
    else if (e.key === 'C' && commentHost() && st.place.view === 'variant') { e.preventDefault(); commentWhole() }
    else if (e.key === 'f' && st.place.view === 'variant') act(st.focus ? 'unfocus' : 'focus', '', '')
    else if (e.key === 'p' && decideOf() && !st.focus && !phoneMq.matches) act('open', 'decide', '')
    else if (e.key === 'Escape' && comments.counts().picking) { e.preventDefault(); comments.escape() }
    // Esc leaves the view from inside it too, as it does out here, unless the design used it first.
    else if (e.key === 'Escape' && !e.defaultPrevented && viewOn()) patchView({ size: null, zoom: 0 })
  }
  /** The bar's three sizes: icons, the name and size on hover. */
  const sizeTabs = () => !viewOk() ? '' : `<div role="radiogroup" aria-label="Layout" data-size-tabs class="me-1 flex shrink-0 gap-0.5 rounded-xl bg-zinc-900/[.05] p-0.5 dark:bg-white/[.07]">${ORDER.map(s => {
    const on = shownSize() === s, land = s === 'tablet' && st.view.land, d = dims(s, land)
    return `<button type="button" role="radio" aria-checked="${on}" data-act="size:${s}" data-shoot="size-${s}" aria-label="${SIZES[s].name}" title="${on && viewOn() ? `Leave the ${SIZES[s].name.toLowerCase()} view · Esc` : `${SIZES[s].name} · ${d.w} × ${d.h}`}" class="grid h-8 w-9 flex-none place-items-center rounded-[10px] transition-colors ${on ? 'bg-white text-zinc-900 shadow-sm ring-1 ring-black/[.04] dark:bg-zinc-700 dark:text-white dark:ring-0' : 'text-zinc-600 hover:text-zinc-900 active:bg-zinc-900/5 dark:text-zinc-400 dark:hover:text-white'}">${ic(sizeIcon(s, land))}</button>`
  }).join('')}</div>`
  const commentsKeyOf = () => { const c = comments.counts(); return JSON.stringify([c.drafts, c.total, c.picking, c.held, [...c.by]]) }
  let commentsKey = commentsKeyOf()
  const pillComments = () => commentHost() ? commentsKeyOf() : ''
  /** Open (not yet done) comments on a variant, as a count in the tree. */
  const openComments = (proto: string, variant: string) => {
    const n = comments.counts().by.get(`${proto}/${variant}`) ?? 0
    return n ? `<span title="${n} open comment${n === 1 ? '' : 's'}" class="inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-proto-primary-soft px-1 text-[10px] font-semibold tabular-nums text-proto-primary-soft-fg">${n}</span>` : ''
  }
  const mac = /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent)
  const commentBtn = () => {
    if (!commentHost()) return ''
    const on = comments.counts().picking
    // At rest an icon; while you are picking what to comment on, it says so, and how to stop.
    return `<button data-act="comment:toggle" data-shoot="comment" aria-pressed="${on}" aria-label="Comment" title="${on ? 'Stop commenting · Esc' : `Comment on the design · C (${mac ? '⌥' : 'Alt'}-click comments on one thing)`}" class="hidden h-9 min-w-9 items-center justify-center gap-1.5 rounded-lg text-xs font-medium sm:inline-flex ${on ? 'bg-proto-primary px-2.5 text-proto-primary-fg hover:bg-proto-primary-hover' : 'text-zinc-600 hover:bg-zinc-900/5 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-white'}">${ic('comment')}${on ? 'Click to comment<kbd class="rounded bg-white/20 px-1 font-sans text-[11px]">Esc</kbd>' : ''}</button>`
  }
  let seenInbox: Inbox | undefined
  /** Tells the comment layer where the page is and what the server says; repaints the chrome that shows counts. */
  function syncComments() {
    const host = commentHost(), pl = st.place, p = cur()
    comments.copy.setStage(copyHost(), copy.routeOf(copyHost()))
    comments.act.setScope(pl.view === 'session' ? null : pl.proto)
    comments.setPlace(host && pl.view === 'variant' && p ? { proto: pl.proto, variant: pl.variant, ...(pl.state ? { state: pl.state } : {}), phone: phoneMq.matches, title: p.title, ...(viewOn() ? { view: viewSize() } : {}) } : null)
    if (st.status?.inbox !== seenInbox) { seenInbox = st.status?.inbox; comments.setInbox(seenInbox) }
    zone.toggleAttribute('data-picking', !!host && comments.counts().picking)
  }
  comments.mountSheet(root.querySelector<HTMLElement>('[data-comments-sheet]')!)
  // ---------- the motion dock: under a design that declared its motion (useMotion) ----------
  // On the design the tools work on: in a device view, the frame's, which the page in the frame
  // mounts again when a take needs its entrance (its __protoRemount, below). The page in a view
  // records nothing itself: the page outside does.
  const motionDock = createMotion({
    el: zone.querySelector<HTMLElement>('[data-motion-dock]')!, zone, stage: () => framed ? null : toolHost(), show: () => !!commentHost(), on: () => st.motion, focused: () => st.focus,
    remount: () => {
      if (!frameOn()) return layer?.remount?.() ?? Promise.resolve()
      const w = deviceView.mount()?.ownerDocument.defaultView as unknown as { __protoRemount?: () => Promise<unknown> } | null
      return w?.__protoRemount?.() ?? Promise.resolve()
    },
    comments,
  })
  ;(window as unknown as { __protoRemount: () => Promise<unknown> }).__protoRemount = () => layer?.remount?.() ?? Promise.resolve()
  // For scripts (the smoke test, like __protoMotion): the design the tools work on, in the view's
  // frame or on the stage, so its own document is the one to read.
  ;(window as unknown as { __protoDesign: () => HTMLElement | null }).__protoDesign = () => toolHost() ?? hintHost()
  /** The design the tools work on declared its motion: the menu and the bar offer the dock. */
  const hasMotion = () => !!commentHost() && !!motion.of(countHost())
  // A design declares its motion as it renders, after the chrome was drawn for it: draw it again,
  // once that's done, so the menu and the bar learn of it.
  motion.subscribe(() => queueMicrotask(() => { const k = String(hasMotion()); if (k !== motionKey) { motionKey = k; render() } }))
  const motionBtn = () => !hasMotion() || st.focus ? ''
    : `<button data-act="motion" data-shoot="motion" aria-pressed="${st.motion}" aria-label="Motion" title="${st.motion ? 'Hide the motion timeline' : 'Show the motion timeline: scrub it, see its curves, comment on a moment'}" class="hidden h-9 min-w-9 items-center justify-center rounded-lg sm:inline-flex ${st.motion ? 'bg-proto-primary-soft text-proto-primary-soft-fg' : 'text-zinc-600 hover:bg-zinc-900/5 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-white'}">${ic('curves')}</button>`
  // The chrome shows counts (the bar's button, the pill, the tree): repaint it when they change.
  comments.store.subscribe(() => {
    const k = commentsKeyOf()
    if (k === commentsKey) return
    commentsKey = k
    render()
  })
  phoneMq.addEventListener('change', () => paintHints())

  // ---------- copy options: a T button wherever the design on the stage declares them ----------
  // Only a design that declares copy options (useCopy) has one: beside Comment in the bar, in the
  // pill's menu on a phone, in the dock in focus mode. Its count is how many lines have options; pressed,
  // copy mode is on (comments/copy.tsx). The picker works in focus mode and in shots too, so it
  // follows the stage, not commentHost.
  // The page inside a view has no copy mode of its own: the page outside runs it on its design.
  const copyHost = () => framed ? null : toolHost()
  // On while copy mode is on for this design, or for the same variant about to move here (the stage
  // and a device view hand it over as the page redraws, which the button is drawn before).
  const copyCounts = () => { const h = copyHost(), n = countHost(), c = comments.copy.store.get(); return { lines: copy.of(n).length, changed: copy.changed(n).length, on: !!h && c.on && (c.stage === h || c.route === copy.routeOf(h)) } }
  const copySay = (c: ReturnType<typeof copyCounts>) => c.on ? 'Close copy options · Esc' : `Copy options for ${c.lines} line${c.lines === 1 ? '' : 's'}${c.changed ? `, ${c.changed} changed` : ''}`
  const copyCount = (c: ReturnType<typeof copyCounts>, ring: string) => c.on ? '' : `<span aria-hidden="true" class="absolute -right-0.5 -top-0.5 grid size-4 place-items-center rounded-full bg-proto-primary text-[10px] font-semibold tabular-nums text-proto-primary-fg ring-2 ${ring}">${c.lines}</span>`
  const copyBtn = () => {
    const c = copyCounts()
    if (!c.lines || st.focus) return ''
    return `<button data-act="copymode" data-shoot="copy-mode" aria-pressed="${c.on}" aria-label="Copy options" title="${copySay(c)}" class="relative hidden h-9 min-w-9 items-center justify-center gap-1.5 rounded-lg text-xs font-medium sm:inline-flex ${c.on ? 'bg-proto-primary px-2.5 text-proto-primary-fg hover:bg-proto-primary-hover' : 'text-zinc-600 hover:bg-zinc-900/5 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-white'}">${ic('text')}${c.on ? '<kbd class="rounded bg-white/20 px-1 font-sans text-[11px]">Esc</kbd>' : ''}${copyCount(c, 'ring-white dark:ring-zinc-950')}</button>`
  }
  const copyKeyOf = () => JSON.stringify(copyCounts())
  // A preview changes the words on every pointer move; the chrome only shows the counts.
  const repaintCopy = () => { const k = copyKeyOf(); if (k !== copyKey) { copyKey = k; render() } }
  copy.subscribe(repaintCopy)
  comments.copy.store.subscribe(repaintCopy)
  // The bar under the stage takes its height from it, so the design is never under the bar.
  const copyBar = zone.querySelector<HTMLElement>('[data-copy-bar]')!
  comments.mountCopy(copyBar, zone.querySelector<HTMLElement>('[data-copy-sheet]')!)
  new ResizeObserver(() => { zone.style.setProperty('--copy-h', `${copyBar.offsetHeight}px`); fit() }).observe(copyBar)

  // ---------- deciding: Pick, More like this, Build it ----------
  // The variant on screen can be picked, or followed by more like it, or built, from the page
  // (comments/decide.tsx); each reaches Claude as a comment, and a pick is marked by the server at
  // once. A wide page has them behind the bar's check button (or P), next to Comment; a phone at the
  // top of the variant sheet, which its pill's name opens.
  function decideOf(): Subject | null {
    const p = cur(), pl = st.place
    const v = p && pl.view === 'variant' ? p.variants.find(x => x.id === pl.variant) : undefined
    return p && v ? { proto: p.id, variant: v.id, label: variantLabel(p, v.id), name: v.name, picked: pickOf(p) === v.id, hints: hints.of(toolHost()).length > 0, copy: copy.of(toolHost()).length > 0 } : null
  }
  function decideBtn() {
    const d = decideOf()
    if (!d) return ''
    const on = st.open === 'decide'
    const say = d.picked ? `Picked ${d.label} · design actions, Try it and copy options` : 'Design actions: pick, more like this, Try it and copy options'
    return `<button data-act="open:decide" data-decide-btn aria-haspopup="menu" aria-expanded="${on}" aria-label="${say}" title="${say} · P" class="${IB} ${on ? ON : ''} ${d.picked ? '!text-emerald-600 dark:!text-emerald-400' : ''}">${ic('check')}<span class="hidden px-1 text-xs sm:inline">Actions</span></button>`
  }
  const settingsBtn = (status = false) => `<button data-act="settings" aria-label="Settings" aria-haspopup="dialog" title="Settings" class="${IB}${status ? ' relative' : ''}">${ic('settings')}${status ? `<span class="absolute right-1 top-1 flex rounded-full ring-2 ring-white dark:ring-zinc-950">${pulse('size-1.5', st.live && !st.stopped)}</span>` : ''}</button>`
  const drawShare = createShare()
  const drawSettings = createSettings()
  function paintSettings() {
    drawSettings({
      open: settingsOpen, appearance, live: comments.store.get().live, sidebar: st.side,
      review: localStorage.getItem('proto-hints') !== '0', stack: st.stack,
      session: { host: agentName(session.agent), id: session.id, name: session.name, url: session.url || location.origin + '/', keep: !!st.status?.keep,
        server: st.stopped ? 'stopped' : st.live ? 'live' : 'reconnecting',
        listening: !!st.status?.inbox?.listening,
        error: st.failed?.at === 'session' ? st.failed.text : null },
      onKeep: async keep => { await post('keep', { keep }, 'session') },
      onStop: async () => { await act('stop', '', '') },
      onClose: () => { settingsOpen = false; render() },
      onAppearance: setAppearance,
      onLive: on => { comments.act.setLive(on); paintSettings() },
      onSidebar: on => { st.side = on; remember('proto-side', on ? '1' : '0'); render() },
      onReview: on => { remember('proto-hints', on ? '1' : '0'); hintsOpen = wideMq.matches && on; if (!on) setTry(null); render() },
      onLayout: on => { act('stack', on ? '1' : '0', ''); paintSettings() },
      onResetWidths: () => { setSideW(SIDE_W); setSplit(SPLIT_W); render() },
      returnFocus: () => [...(settingsOrigin === 'dock' ? overlay : bar).querySelectorAll<HTMLElement>('[data-act=settings]')].find(el => el.getClientRects().length > 0) ?? null,
    })
  }
  const drawDecide = comments.mountDecide(root.querySelector<HTMLElement>('[data-decide]')!)
  // The button is redrawn with the bar, so the menu finds it again each time it is drawn.
  const paintDecide = () => drawDecide({
    open: st.open === 'decide', subject: decideOf(),
    anchor: () => { const b = bar.querySelector<HTMLElement>('[data-decide-btn]'); return b?.offsetParent ? b : null },
    onClose: () => { if (st.open === 'decide') { st.open = null; render() } },
  })

  // ---------- a variant's options, from its row in the sidebar ----------
  // Right-click on a row (or its ⋯): Comment on this, Pick, More like this, Build, Try it and copy
  // options, for that variant whether or not it is the one on screen. Only the one on screen has
  // its Try it list and copy lines read, so another's extras always offer to add them.
  function openVmenu(proto: string, variant: string, x: number, y: number, more: { hint?: boolean; el?: HTMLElement; art?: boolean } = {}) {
    st.vmenu = { proto, variant, x, y, ...more }
    st.open = 'vmenu'
    refreshStatus()
    render()
  }
  function vmenuSubject(): Subject | null {
    const m = st.vmenu, q = m && byId(m.proto), v = q?.variants.find(x => x.id === m?.variant)
    if (!q || !v) return null
    const cur = decideOf(), same = !!cur && cur.proto === q.id && cur.variant === v.id
    return { proto: q.id, variant: v.id, label: variantLabel(q, v.id), name: v.name, picked: pickOf(q) === v.id, hints: same ? cur.hints : false, copy: same ? cur.copy : false }
  }
  const drawVmenu = comments.mountDecide(root.querySelector<HTMLElement>('[data-vmenu]')!)
  const paintVmenu = () => drawVmenu({
    open: st.open === 'vmenu', subject: vmenuSubject(), anchor: () => null,
    at: st.vmenu ? { x: st.vmenu.x, y: st.vmenu.y } : undefined,
    onClose: () => { if (st.open === 'vmenu') { st.open = null; render() } },
    onComment: () => { const m = st.vmenu; if (m) commentWhole(m.proto, m.variant) },
    hint: !!st.vmenu?.hint,
    commentLabel: st.vmenu?.art ? 'Comment on the whole variant' : undefined,
    ...vmenuRows(),
  })
  /**
   * Comment on the variant as a whole: opens where the box is (the docked panel's Comments tab, the
   * phone's list) and puts the cursor in it. From another variant's row it goes there first.
   */
  function commentWhole(proto?: string, variant?: string) {
    if (proto && variant && !(st.place.view === 'variant' && st.place.proto === proto && st.place.variant === variant)) go({ view: 'variant', proto, variant })
    if (phoneMq.matches) comments.act.openSheet(true)
    else if (railOn()) {
      selectPanelTab('comments')
      if (!hintsOpen) { hintsOpen = true; remember('proto-hints', '1') }
      paintHints()
    }
    comments.act.askWhole()
  }

  // ---------- right-click menus ----------
  // What a right-click is on is read off the markup it is in: a row or card carries the same
  // data-act its click does (a variant, a prototype, a state, the session), a comment its id, and
  // the design (in the stage, or in the artboard's frame) is the element itself. A variant's menu is
  // its decisions (comments/decide.tsx) with the page's own rows beside them; the others are rows
  // drawn by comments/menu.tsx. Which rows there are is decided here, where the places are known.
  type CtxOn =
    | { kind: 'variant'; proto: string; variant: string }
    | { kind: 'proto'; proto: string }
    | { kind: 'state'; proto: string; variant: string; state: string }
    | { kind: 'session' }
    | { kind: 'comment'; id: string }
    | { kind: 'art'; el: HTMLElement }
  /** An SVG part (an icon, a chart) stands for the HTML element around it. */
  const htmlOf = (el: Element): HTMLElement => { let e: Element | null = el; while (e && e.namespaceURI !== 'http://www.w3.org/1999/xhtml') e = e.parentElement; return (e ?? el) as HTMLElement }
  function ctxOf(t: Element): CtxOn | null {
    if (comments.busy()) return null
    // Fields and selected text keep the browser's menu (paste, spelling, Look Up).
    if (t.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"], [data-context-menu], [data-composer]')) return null
    if (getSelection()?.toString()) return null
    // The design on the stage, where there is no frame (a phone's screen, or the page too narrow for one).
    if (st.place.view === 'variant' && commentHost() && t.closest('[data-mount]') && !t.closest('[data-card]')) return { kind: 'art', el: htmlOf(t) }
    const row = t.closest<HTMLElement>('[data-mv]')
    if (row) { const [proto, variant] = row.dataset.mv!.split(':'); return { kind: 'variant', proto, variant } }
    const note = t.closest<HTMLElement>('[data-comment]')
    if (note) return { kind: 'comment', id: note.dataset.comment! }
    const el = t.closest<HTMLElement>('[data-act]')
    if (el) {
      const [name, a = '', b = '', c = ''] = el.dataset.act!.split(':')
      switch (name) {
        case 'pv': case 'mv': return byId(a)?.variants.some(v => v.id === b) ? { kind: 'variant', proto: a, variant: b } : null
        case 'pvs': return byId(a)?.variants.some(v => v.id === b) ? (c ? { kind: 'state', proto: a, variant: b, state: c } : { kind: 'variant', proto: a, variant: b }) : null
        case 'variant': { const p = cur(); return p?.variants.some(v => v.id === a) ? { kind: 'variant', proto: p.id, variant: a } : null }
        case 'mp': case 'proto': return byId(a) ? { kind: 'proto', proto: a } : null
        case 'lobby': { if (a === 'session') return { kind: 'session' }; const id = a === 'proto' ? b : cur()?.id; return id && byId(id) ? { kind: 'proto', proto: id } : null }
        case 'open': case 'menu': return a === 'session' ? { kind: 'session' } : null
      }
    }
    return null
  }
  function openCtx(on: CtxOn, x: number, y: number) {
    st.ctx = null
    if (on.kind === 'variant') return openVmenu(on.proto, on.variant, x, y, { hint: true })
    if (on.kind === 'art') {
      const pl = st.place
      if (pl.view !== 'variant') return
      return openVmenu(pl.proto, pl.variant, x, y, { hint: true, art: true, el: on.el })
    }
    st.vmenu = null
    st.ctx = { x, y, on }
    st.open = 'ctx'
    refreshStatus()
    render()
  }
  const linkOf = (hash: string) => `${session.url || location.origin + location.pathname}${hash}`
  const copyText = (text: string) => { void navigator.clipboard?.writeText(text) }
  /** The rows a variant's menu has beside its decisions, and on the artboard the ones about the element and the view. */
  function vmenuRows(): { rows?: MenuRow[]; lead?: MenuRow[] } {
    const m = st.vmenu, q = m && byId(m.proto), v = q?.variants.find(x => x.id === m?.variant)
    if (!m || !q || !v) return {}
    const here = st.place.view === 'variant' && st.place.proto === q.id && st.place.variant === v.id
    const rows: MenuRow[] = []
    if (m.art) {
      rows.push({ id: 'fit', label: frameOn() ? 'Zoom to fit' : 'Fit to the window', icon: 'grow', run: () => setScale(0) })
      if (st.place.view === 'variant') rows.push({ id: 'focus', label: 'Focus mode', icon: 'shrink', run: () => act('focus', '', '') })
      rows.push({ id: 'theme', label: st.dark ? 'Light theme' : 'Dark theme', icon: st.dark ? 'sun' : 'moon', run: () => setTheme(!st.dark) })
    } else {
      if (!here) rows.push({ id: 'open', label: `Open ${variantLabel(q, v.id)}`, icon: 'right', run: () => go(keepIn(q, v.id)) })
      for (const t of (['play', 'all', 'compare'] as Tool[]).filter(t => toolOk(q, v.id, t))) {
        rows.push({ id: `tool-${t}`, label: TOOLS[t].name, icon: TOOLS[t].icon, hint: t === 'compare' ? variantLabel(q, otherOf(q, v.id)) : undefined, on: here && st.place.view === 'variant' && st.place.tool === t, run: () => act('tool', q.id, v.id, t) })
      }
      rows.push({ id: 'share', label: 'Share screenshots', icon: 'share', run: () => act('share', q.id, v.id) })
      rows.push({ id: 'link', label: 'Copy link', icon: 'link', run: () => copyText(linkOf(hashOf({ view: 'variant', proto: q.id, variant: v.id }))) })
    }
    const el = m.el
    if (!m.art || !el) return { rows }
    const lead: MenuRow[] = []
    if (comments.inDesign(el)) {
      lead.push({ id: 'comment-el', label: 'Comment on this element', icon: 'comment', run: () => { commentElement(el) } })
      const up = comments.parentOf(el)
      if (up) lead.push({ id: 'comment-up', label: 'Comment on the parent', icon: 'up', run: () => commentElement(up) })
      const text = (el.innerText ?? el.textContent ?? '').trim()
      if (text) lead.push({ id: 'copy-text', label: 'Copy text', icon: 'copy', run: () => copyText(text) })
    }
    return { lead, rows }
  }
  /** Comment on an element picked by a right-click: the panel (or the phone's list) opens around the new comment. */
  function commentElement(el: HTMLElement) {
    comments.copy.off()
    comments.commentOn(el)
    if (phoneMq.matches) comments.act.openSheet(true)
    else if (railOn()) {
      selectPanelTab('comments')
      if (!hintsOpen) { hintsOpen = true; remember('proto-hints', '1') }
      paintHints()
    }
  }
  const drawCtx = comments.mountContext(root.querySelector<HTMLElement>('[data-ctx]')!)
  function ctxRows(on: CtxOn): { title?: string; sub?: string; rows: MenuRow[] } | null {
    switch (on.kind) {
      case 'proto': {
        const p = byId(on.proto)
        if (!p) return null
        const n = p.count ?? 5
        return { title: p.title, rows: [
          { id: 'open', label: 'Open', icon: 'grid', run: () => go({ view: 'proto', proto: p.id }) },
          { id: 'more-variants', label: `${n} more variant${n === 1 ? '' : 's'}…`, icon: 'more', ask: {
            title: 'More variants', hint: `Optional: a direction for the new ${p.title} variants, or what to avoid`, count: n,
            send: (note, count) => comments.act.moreVariants(p.id, count, note),
            done: count => `Asked for ${count} more variant${count === 1 ? '' : 's'}`,
          } },
          { id: 'link', label: 'Copy link', icon: 'link', run: () => copyText(linkOf(hashOf({ view: 'proto', proto: p.id }))) },
        ] }
      }
      case 'state': {
        const p = byId(on.proto), s = p && stateOf(p, on.variant, on.state)
        if (!p || !s) return null
        const place: Place = { view: 'variant', proto: p.id, variant: on.variant, state: s.id }
        return { title: on.variant, sub: s.name, rows: [
          { id: 'open', label: 'Open this state', icon: 'right', run: () => go(place) },
          { id: 'link', label: 'Copy link', icon: 'link', run: () => copyText(linkOf(hashOf(place))) },
        ] }
      }
      case 'session':
        return { title: session.name, rows: [
          { id: 'overview', label: 'Overview', icon: 'grid', run: () => go({ view: 'session' }) },
          { id: 'link', label: 'Copy link', icon: 'link', run: () => copyText(session.url || location.href) },
          { id: 'keep', label: 'Keep this session', icon: 'pin', on: !!st.status?.keep, run: () => act('keep', '', '') },
        ] }
      case 'comment': {
        const words = comments.wordsOf(on.id)
        return { title: 'Comment', rows: [
          { id: 'show', label: 'Show it', icon: 'target', run: () => comments.act.open(on.id) },
          ...(words ? [{ id: 'copy', label: 'Copy text', icon: 'copy', run: () => copyText(words) }] : []),
          { id: 'delete', label: 'Delete', icon: 'trash', danger: true, run: () => comments.act.remove(on.id) },
        ] }
      }
      default: return null
    }
  }
  function paintCtx() {
    const m = st.open === 'ctx' ? st.ctx : null, model = m && ctxRows(m.on)
    drawCtx({
      open: !!m && !!model, at: m ? { x: m.x, y: m.y } : null,
      title: model?.title, sub: model?.sub, rows: model?.rows ?? [],
      onClose: () => { if (st.open === 'ctx') { st.open = null; render() } },
    })
  }

  // ---------- the side panel: comments, and Try it ----------
  // One panel, two tabs. Docked it narrows the stage; narrower it is a sheet over the design;
  // closed, a handle per tab on the edge. The comments tab is a React root made once: the panel's
  // frame is made once too, and only the Try it body and the tab strip are repainted, so nothing
  // the comment list is showing is ever rebuilt under it. A phone has no panel: its comments are a
  // sheet from the pill's Comment, and its Try it a sheet from the pill's menu (paintTry).
  hintBox.innerHTML = `<div data-handles></div>
    <div data-panel role="complementary" class="absolute inset-y-0 right-0 z-20 hidden flex-col bg-white text-[13px] text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <div data-tabs class="flex h-11 shrink-0 items-center gap-0.5 border-b border-black/[.07] pl-1.5 pr-1 dark:border-white/10"></div>
      <div data-try class="min-h-0 flex-1 overflow-y-auto overscroll-contain" hidden></div>
      <div data-tweak-body class="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4" hidden></div>
      <div data-cbody class="min-h-0 flex-1" hidden></div>
      <div data-caveats></div>
    </div>
    <div data-try-sheet></div><div data-tweaks-sheet></div>`
  const handles = hintBox.querySelector<HTMLElement>('[data-handles]')!
  const panel = hintBox.querySelector<HTMLElement>('[data-panel]')!
  const tabsEl = hintBox.querySelector<HTMLElement>('[data-tabs]')!
  const tryEl = hintBox.querySelector<HTMLElement>('[data-try]')!
  const cbody = hintBox.querySelector<HTMLElement>('[data-cbody]')!
  const caveatEl = hintBox.querySelector<HTMLElement>('[data-caveats]')!
  let tab: 'comments' | 'try' | 'tweaks' = 'comments'
  const tweakBody = hintBox.querySelector<HTMLElement>('[data-tweak-body]')!
  const drawTweaks = createTweakControls(tweakBody)
  const drawTweaksDrawer = createTweaksDrawer(hintBox.querySelector<HTMLElement>('[data-tweaks-sheet]')!)
  let autoTweaksShown = false
  function selectPanelTab(next: typeof tab) { tab = next; autoTweaksShown = true }
  comments.mountRail(cbody)

  function paintHints() { syncComments(); motionDock.sync(); paintPanel(); paintTweaks(); syncSpot() }
  // Starting to comment opens the Comments tab beside the design, where the new one lands. Only
  // where the panel docks: narrower, it would cover what you're about to click on.
  function toggleComment() {
    comments.copy.off()
    comments.act.toggle()
    if (!comments.counts().picking || !railOn() || !wideMq.matches) return
    selectPanelTab('comments')
    if (!hintsOpen) { hintsOpen = true; remember('proto-hints', '1') }
    paintHints()
  }
  function paintPanel() {
    const list = hintList(), fields = tweakList()
    if (fields.length && !autoTweaksShown && wideMq.matches) { tab = 'tweaks'; autoTweaksShown = true }
    paintTry(list)
    const tabs: ('comments' | 'try' | 'tweaks')[] = [...(railOn() ? ['comments' as const] : []), ...(list.length && !phoneMq.matches ? ['try' as const] : []), ...(fields.length && !phoneMq.matches ? ['tweaks' as const] : [])]
    const shownTab = tabs.includes(tab) ? tab : tabs[0]
    const panelWidth = shownTab === 'tweaks' || tabs.length > 2 ? 320 : HINTS_W
    const docked = tabs.length > 0 && hintsOpen && wideMq.matches
    zone.style.setProperty('--hw', docked ? `${panelWidth}px` : '0px')
    if (docked !== hintsDocked) { hintsDocked = docked; requestAnimationFrame(fit) }
    if (!tabs.length) { panel.className = 'hidden'; handles.innerHTML = ''; tryEl.innerHTML = ''; caveatEl.innerHTML = ''; return }
    const count = tryCount(list)
    const c = comments.counts()
    if (!hintsOpen) {
      panel.className = 'hidden'
      handles.innerHTML = `<div class="absolute bottom-[calc(var(--pill-h,0px)+var(--dock-h,0px)+var(--copy-h,0px)+1rem)] right-0 z-20 flex flex-col items-end gap-2">
        ${tabs.includes('comments') ? `<button data-hint="open:comments" title="Comments on this design · C" class="${HANDLE}">${ic('comment', 'size-3.5 text-proto-primary-ring')}Comments${c.total ? `<span class="tabular-nums text-zinc-400">${c.total}</span>` : ''}</button>` : ''}
        ${tabs.includes('try') ? `<button data-hint="open:try" title="What to type and try in this design" class="${HANDLE}">${ic('key', 'size-3.5 text-amber-500')}Try it<span class="tabular-nums text-zinc-400">${count}</span></button>` : ''}
      </div>`
      tryEl.innerHTML = ''
      return
    }
    handles.innerHTML = ''
    const wide = wideMq.matches
    panel.className = `absolute inset-y-0 right-0 z-20 flex flex-col bg-white text-[13px] text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100 ${wide ? 'border-l border-black/[.07] dark:border-white/10' : 'w-[min(18rem,88%)] shadow-2xl shadow-black/30'}`
    panel.style.width = wide ? `${panelWidth}px` : ''
    // Never on two lines: docked, the panel is 264 px, which the two tabs and Fill in beside them
    // overran. Fill in is at the head of the values it types, To type.
    const tabBtn = (t: 'comments' | 'try' | 'tweaks') => {
      const on = shownTab === t, n = t === 'comments' ? c.total : t === 'tweaks' ? fields.filter(isChanged).length : count
      return `<button data-hint="tab:${t}" aria-pressed="${on}" class="inline-flex h-8 shrink-0 items-center ${tabs.length > 2 ? 'gap-1 px-1.5 text-[11px]' : 'gap-1.5 px-2.5 text-xs'} whitespace-nowrap rounded-md font-medium ${on ? 'bg-zinc-900/[.06] text-zinc-900 dark:bg-white/10 dark:text-white' : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-white'}">${ic(t === 'comments' ? 'comment' : t === 'tweaks' ? 'tweaks' : 'key', `size-3.5 ${t === 'try' ? 'text-amber-500' : on ? 'text-proto-primary-ring' : ''}`)}${t === 'comments' ? 'Comments' : t === 'tweaks' ? 'Tweaks' : 'Try it'}${n ? `<span class="tabular-nums text-zinc-400">${n}</span>` : ''}</button>`
    }
    tabsEl.innerHTML = `${tabs.map(tabBtn).join('')}<span class="ml-auto"></span>
      <button data-hint="close" class="${IB} h-7 min-w-7 shrink-0 px-1" aria-label="Close panel" title="Close">${ic(wide ? 'right' : 'x', 'size-3.5')}</button>`
    cbody.hidden = shownTab !== 'comments'
    tryEl.hidden = shownTab !== 'try'
    tweakBody.hidden = shownTab !== 'tweaks'
    if (shownTab !== 'try') { tryEl.innerHTML = ''; caveatEl.innerHTML = ''; return }
    const t = tryBody(list, false)
    tryEl.innerHTML = t.list
    caveatEl.innerHTML = t.foot
  }
  function paintTweaks() {
    const host = toolHost(), fields = tweakList()
    const props = {
      fields,
      onChange: (id: string, value: string | boolean) => { if (host && host === toolHost()) tweaks.change(host, id, value) },
      onReset: (id?: string) => { if (host && host === toolHost()) tweaks.reset(host, id) },
    }
    drawTweaks(props)
    const open = phoneMq.matches && tweaksOpen && fields.length > 0
    if (open) tweaksUp = true
    if (!phoneMq.matches || !fields.length) tweaksOpen = false
    const bottom = pill.firstElementChild?.getBoundingClientRect().height ?? 0
    drawTweaksDrawer({ ...props, open, bottom,
      onClose: (reason, event, cancel) => {
        if (reason === 'outside-press' && (event?.target as Element | null)?.closest?.('[data-act=tweaks]')) return cancel()
        if (reason === 'escape-key') event?.preventDefault()
        tweaksOpen = false; render()
      },
      onGone: () => { if (!tweaksOpen) { tweaksUp = false; raisePill() } },
      returnFocus: () => pill.querySelector<HTMLElement>('[data-act=tweaks]'),
    })
    for (const edge of overlay.querySelectorAll<HTMLElement>('[data-edge]')) edge.style.visibility = open ? 'hidden' : ''
    raisePill()
  }
  let tweakRenderQueued = false
  if (!framed) tweaks.subscribe(() => {
    if (tweakRenderQueued) return
    tweakRenderQueued = true
    queueMicrotask(() => { tweakRenderQueued = false; render() })
  })
  const tryCount = (list: Hint[]) => list.filter(h => h.kind !== 'caveat').length
  const fillable = (list: Hint[]) => list.some(h => h.kind === 'value' && h.fill)
  const fillLabel = () => `${ic(hintSaid === 'Filled' ? 'check' : 'fill', 'size-3.5')}${hintSaid || 'Fill in'}`
  /** What Try it lists, as the panel draws it: the values to type, the things to try, the switches and
   *  the events, then the caveats under them. Roomy is the phone's sheet: rows a finger can hit. */
  function tryBody(list: Hint[], roomy: boolean) {
    const all = list.map((h, i) => ({ h, i }))
    const pick = <K extends Hint['kind']>(k: K) => all.filter(x => x.h.kind === k) as { h: Extract<Hint, { kind: K }>; i: number }[]
    const values = pick('value'), tries = pick('try'), switches = pick('switch'), events = pick('event'), caveats = pick('caveat')
    const py = roomy ? 'py-2.5' : 'py-1.5'
    const sec = (name: string, body: string, meta = '') => `<section class="border-b border-black/[.05] last:border-b-0 dark:border-white/[.07] ${roomy ? '-mx-1 px-2 py-1' : 'p-1'}"><h3 class="flex items-center px-2 pb-0.5 pt-1 text-[11px] font-medium text-zinc-400">${bd(name)}<span class="ml-auto flex font-normal tabular-nums">${meta}</span></h3>${body}</section>`
    const value = ({ h, i }: { h: Extract<Hint, { kind: 'value' }>; i: number }) => `<button data-hint="copy:${i}" title="Copy ${esc(h.label.toLowerCase())}" class="group/h flex w-full min-w-0 items-start gap-2 rounded-md px-2 ${roomy ? 'py-2' : 'py-1.5'} text-left hover:bg-zinc-900/[.04] dark:hover:bg-white/[.06]">
        <span dir="auto" class="w-[4.5rem] shrink-0 pt-px text-[11px] leading-4 text-zinc-500">${esc(h.label)}</span>
        <span class="min-w-0 flex-1"><span ${typeof h.value === 'function' ? `data-live="${i}" ` : ''}dir="auto" class="block break-all font-mono text-[12px] leading-[18px] text-zinc-900 dark:text-zinc-100">${esc(valueOf(h))}</span>${h.note ? `<span dir="auto" class="block text-[11px] leading-4 text-zinc-400">${esc(h.note)}</span>` : ''}</span>
        <span class="grid size-5 shrink-0 place-items-center ${hintCopied === i ? 'text-emerald-500' : 'text-zinc-400 opacity-0 group-hover/h:opacity-100 [@media(hover:none)]:opacity-100'}">${ic(hintCopied === i ? 'check' : 'copy', 'size-3.5')}</span></button>`
    // A thing with a spot on the page answers pointing, focus and a tap (see the spotlight below).
    const tryRow = ({ h, i }: { h: Extract<Hint, { kind: 'try' }>; i: number }) => {
      const tick = `<span class="mt-px grid size-4 shrink-0 place-items-center rounded-full ${h.done ? 'bg-emerald-500 text-white' : 'ring-1 ring-inset ring-zinc-300 dark:ring-zinc-600'}">${h.done ? ic('check', 'size-3') : ''}</span>`
      const text = `<span dir="auto" class="${showable(h) ? 'block' : 'min-w-0 flex-1'} text-[12.5px] leading-[18px] ${h.done ? 'text-zinc-400 line-through decoration-zinc-300 dark:decoration-zinc-600' : ''}">${esc(h.text)}</span>`
      if (!showable(h)) return `<div class="flex items-start gap-2 px-2 ${py}">${tick}${text}</div>`
      return `<div data-try-row="${i}" tabindex="0" title="Show where on the page" class="group/t flex cursor-default items-start gap-2 rounded-md px-2 ${py} outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60 data-on:bg-amber-400/[.12] not-data-on:hover:bg-zinc-900/[.04] dark:not-data-on:hover:bg-white/[.06]">${tick}<span class="min-w-0 flex-1">${text}<span class="hidden text-[11px] leading-4 text-zinc-400 group-data-gone/t:block">Not on the page right now</span></span>${showIcon('mt-0.5 text-zinc-400 opacity-0 transition-opacity group-hover/t:opacity-100 group-data-on/t:text-amber-500 group-data-on/t:opacity-100')}</div>`
    }
    const switchRow = ({ h, i }: { h: Extract<Hint, { kind: 'switch' }>; i: number }) => `<div class="flex flex-wrap gap-1 px-2 py-1">${h.options.map((o, j) => `<button data-hint="switch:${i}:${j}" aria-pressed="${o === h.value}" class="${roomy ? 'h-9 px-3' : 'h-7 px-2.5'} rounded-md text-xs ${o === h.value ? 'bg-zinc-900 font-medium text-white dark:bg-white dark:text-zinc-900' : 'bg-zinc-900/[.04] text-zinc-600 hover:bg-zinc-900/[.08] dark:bg-white/[.06] dark:text-zinc-300 dark:hover:bg-white/10'}">${bd(o)}</button>`).join('')}</div>`
    const eventRow = ({ h, i }: { h: Extract<Hint, { kind: 'event' }>; i: number }) => `<button data-hint="event:${i}" class="flex w-full items-center gap-2 rounded-md px-2 ${py} text-left text-[12.5px] hover:bg-zinc-900/[.04] dark:hover:bg-white/[.06]">${ic('bolt', 'size-3.5 text-amber-500')}${bd(h.label)}</button>`
    // The panel has Fill in at the head of the values; the sheet has it in its own head, by its name.
    const fill = !roomy && fillable(list) ? `<button data-hint="fill" title="Type the values into this design's fields" class="-my-1 inline-flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-md bg-zinc-900 px-2 text-[11px] font-medium text-white hover:bg-zinc-700 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200">${fillLabel()}</button>` : ''
    return {
      list: `${values.length ? sec('To type', values.map(value).join(''), fill) : ''}
        ${tries.length ? sec('Things to try', tries.map(tryRow).join(''), `${tries.filter(x => x.h.done).length}/${tries.length}`) : ''}
        ${switches.map(x => sec(x.h.label, switchRow(x))).join('')}
        ${events.length ? sec('Make it happen', events.map(eventRow).join('')) : ''}`,
      foot: caveats.length ? `<div class="shrink-0 border-t border-black/[.06] px-3 py-2 text-[11px] leading-4 text-zinc-500 dark:border-white/10">${caveats.map(x => `<p dir="auto">${esc(x.h.text)}</p>`).join('')}</div>` : '',
    }
  }

  // ---------- Try it on a phone: a row in the pill's menu, and a sheet ----------
  // The row opens Try it as a sheet rising from behind the pill, which stays on top (over the sheet's
  // backdrop too, while the sheet is on screen). Tapping a thing to try puts the sheet away while its
  // spot is lit, and brings it back once the spot goes out, unless the design was pressed meanwhile:
  // then you are doing the thing, and Try it in the menu brings it back. A thing that isn't on the page right
  // now keeps the sheet up, and its row says so.
  const paintTrySheet = createTrySheet(hintBox.querySelector<HTMLElement>('[data-try-sheet]')!)
  let trySheet: 'closed' | 'open' | 'away' = 'closed', tryPressed = false, tryUp = false
  let tryIn: { list: HTMLElement | null; foot: HTMLElement | null } = { list: null, foot: null }
  let tryNow = { list: '', foot: '' }
  // Written in only when it changed, so a repaint keeps what the list shows (a lit row, its scroll).
  const written = new WeakMap<HTMLElement, string>()
  const fillTry = () => {
    for (const k of ['list', 'foot'] as const) { const el = tryIn[k]; if (el && written.get(el) !== tryNow[k]) { el.innerHTML = tryNow[k]; written.set(el, tryNow[k]) } }
  }
  const raisePill = () => { const box = pill.firstElementChild as HTMLElement | null; if (box) box.style.zIndex = tryUp || tweaksUp ? '210' : '' }
  function setTrySheet(to: typeof trySheet) {
    trySheet = to
    if (to === 'open') { tryUp = true; tryPressed = false }
    raisePill()
    render()
  }
  function paintTry(list: Hint[]) {
    const on = phoneMq.matches && list.length > 0
    if (!on) trySheet = 'closed'
    tryNow = on ? tryBody(list, true) : { list: '', foot: '' }
    paintTrySheet({
      open: on && trySheet === 'open',
      count: tryCount(list),
      fill: on && fillable(list) ? fillLabel() : null,
      body: (l, f) => { tryIn = { list: l, foot: f }; fillTry(); syncSpot() },
      onClose: (reason, event, cancel) => {
        // The pill's button closes the sheet itself; a press on it is no press outside.
        if (reason === 'outside-press' && (event?.target as Element | null)?.closest?.('[data-act="try"]')) return cancel()
        // Esc puts the sheet away and stays on the variant (the page would go up a level).
        if (reason === 'escape-key') event?.preventDefault()
        if (trySheet === 'open') setTrySheet('closed')
      },
      onGone: () => { if (trySheet !== 'open') { tryUp = false; raisePill() } },
    })
    fillTry()
  }
  // The pill's menu button is Try it's way out while its sheet is up or away.
  hints.subscribe(() => { paintHints(); paintPill(); paintDecide(); paintVmenu(); paintCtx() })
  wideMq.addEventListener('change', () => { hintsOpen = wideMq.matches && localStorage.getItem('proto-hints') !== '0'; paintHints() })
  // A live value (a code that changes every 30 seconds) is re-read every second, in place.
  setInterval(() => {
    const list = hintList()
    for (const el of hintBox.querySelectorAll<HTMLElement>('[data-live]')) { const h = list[Number(el.dataset.live)]; if (h?.kind === 'value') el.textContent = valueOf(h) }
  }, 1000)
  hintBox.addEventListener('click', e => {
    const row = (e.target as Element).closest<HTMLElement>('[data-try-row]')
    if (row) {
      const i = Number(row.dataset.tryRow)
      setTry(i, 'tap', 4000)
      // On a phone the sheet goes away while the spot is lit; between a phone and docked, the panel closes.
      if (phoneMq.matches) {
        const host = toolHost(), h = tryAt(i)
        if (tryOn && host && h && whereIs(host, h, zone) !== 'gone') { trySheet = 'away'; tryPressed = false; render() }
      } else if (!wideMq.matches) { hintsOpen = false; paintHints() }
      return
    }
    const b = (e.target as Element).closest<HTMLElement>('[data-hint]')
    if (!b) return
    const [what, a, c] = b.dataset.hint!.split(':'), list = hintList(), h = list[Number(a)]
    try {
      if (what === 'tab') selectPanelTab(a as typeof tab)
      else if (what === 'open' || what === 'close') { if (what === 'open' && (a === 'comments' || a === 'try' || a === 'tweaks')) selectPanelTab(a); hintsOpen = what === 'open'; if (!hintsOpen) setTry(null); if (wideMq.matches) remember('proto-hints', hintsOpen ? '1' : '0') }
      else if (what === 'copy' && h?.kind === 'value') { navigator.clipboard?.writeText(valueOf(h)); hintCopied = Number(a); flash() }
      else if (what === 'fill') {
        const host = toolHost()
        const filled = list.filter(x => {
          if (x.kind !== 'value' || !x.fill) return false
          let el: Element | null = null
          try { el = host?.querySelector(x.fill) ?? null } catch { /* a bad selector: nothing to fill */ }
          return !!el && fillField(el, valueOf(x))
        }).length
        hintSaid = filled ? 'Filled' : 'No field here'
        flash()
      }
      else if (what === 'switch' && h?.kind === 'switch') h.set(h.options[Number(c)])
      else if (what === 'event' && h?.kind === 'event') h.run()
    } catch (err) { console.error('[prototype] a hint failed:', err) }
    paintHints()
  })

  // Pointing at a thing to try lights where it happens on the design (spotlight.ts). Hovering
  // a row shows it after a short wait (so running down the list doesn't flash it), and it
  // stays 1.5 s after the pointer leaves, so it survives the trip to the spot. Focus shows it
  // too; a click or a tap keeps it 4 s (touch has no hover) and moves a sheet over the design
  // out of the way. Doing it, pressing on the design, Esc or another page puts it away; a thing
  // done in steps stays lit through them, for 8 s, so its light can move to the next step.
  const spot = createSpotlight(zone.querySelector<HTMLElement>('[data-spot]')!)
  let tryOn: { i: number; via: 'hover' | 'focus' | 'tap'; host: HTMLElement; done: boolean } | null = null
  let tryTimer = 0
  // A thing just done stays dark while the pointer is still on its row: the panel redraws
  // under the pointer, and the browser's hover on the new row would light it again.
  let tryQuiet = -1
  const tryAt = (i: number) => { const h = hintList()[i]; return h?.kind === 'try' && showable(h) ? h : null }
  function setTry(i: number | null, via: 'hover' | 'focus' | 'tap' = 'hover', ms = 0) {
    clearTimeout(tryTimer)
    const host = toolHost(), h = i === null ? null : tryAt(i)
    tryOn = i !== null && host && h ? { i, via, host, done: !!h.done } : null
    if (tryOn && ms) tryTimer = window.setTimeout(() => setTry(null), ms)
    syncSpot()
  }
  function syncSpot() {
    const host = toolHost(), h = tryOn ? tryAt(tryOn.i) : null
    if (tryOn && (!h || host !== tryOn.host || (h.done && !tryOn.done))) { clearTimeout(tryTimer); if (h?.done) tryQuiet = tryOn.i; tryOn = null }
    if (tryOn && host && h) spot.show(host, h, String(tryOn.i)); else spot.hide()
    for (const r of hintBox.querySelectorAll<HTMLElement>('[data-try-row]')) {
      const on = tryOn?.i === Number(r.dataset.tryRow)
      r.toggleAttribute('data-on', on)
      r.toggleAttribute('data-gone', on && !!host && !!h && whereIs(host, h, zone) === 'gone')
    }
    // The phone's sheet, away for a spot that is now out, comes back, unless the design was pressed.
    if (trySheet === 'away' && !tryOn) { const to = tryPressed ? 'closed' : 'open'; queueMicrotask(() => { if (trySheet === 'away') setTrySheet(to) }) }
  }
  function tryEsc() { if (!tryOn) return false; setTry(null); return true }
  hintBox.addEventListener('pointerover', e => {
    const r = e.pointerType === 'mouse' && (e.target as Element).closest<HTMLElement>('[data-try-row]')
    if (!r) return
    const i = Number(r.dataset.tryRow)
    if (tryOn?.i === i || tryQuiet === i) return
    clearTimeout(tryTimer)
    if (tryOn) setTry(i)
    else tryTimer = window.setTimeout(() => setTry(i), 120)
  })
  hintBox.addEventListener('pointerout', e => {
    const r = e.pointerType === 'mouse' && (e.target as Element).closest('[data-try-row]')
    if (!r || r.contains(e.relatedTarget as Node | null)) return
    tryQuiet = -1
    if (!tryOn) clearTimeout(tryTimer)
    else if (tryOn.via === 'hover') { clearTimeout(tryTimer); tryTimer = window.setTimeout(() => setTry(null), 1500) }
  })
  hintBox.addEventListener('focusin', e => {
    const r = (e.target as Element).closest<HTMLElement>('[data-try-row]')
    if (r && tryOn?.via !== 'tap') setTry(Number(r.dataset.tryRow), 'focus')
  })
  hintBox.addEventListener('focusout', e => {
    if ((e.target as Element).closest('[data-try-row]') && tryOn?.via === 'focus') setTry(null)
  })
  layers.addEventListener('pointerdown', () => {
    if (trySheet === 'away') tryPressed = true
    if (!tryOn) return
    if (tryAt(tryOn.i)?.steps?.length) { clearTimeout(tryTimer); tryOn.via = 'tap'; tryTimer = window.setTimeout(() => setTry(null), 8000) }
    else setTry(null)
  }, true)

  // ---------- theme, status, server ----------
  function setAppearance(next: Appearance) {
    appearance = next
    themeOverride = false
    remember('proto-theme', next)
    applyTheme(next === 'system' ? systemTheme.matches : next === 'dark')
  }
  function setTheme(dark: boolean) { setAppearance(dark ? 'dark' : 'light') }
  function applyTheme(dark: boolean) {
    st.dark = dark
    document.documentElement.classList.toggle('dark', dark)
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
    render()
  }
  systemTheme.addEventListener('change', e => { if (appearance === 'system' && !themeOverride) applyTheme(e.matches) })
  // The lobby is drawn once per visit, so its lifecycle line is updated in place.
  const paintLifecycle = () => layers.querySelectorAll('[data-lifecycle]').forEach(el => { el.textContent = lifecycle() })
  async function refreshStatus() {
    try {
      st.status = await (await fetch('/__proto/status')).json()
      if (st.status!.lastEdit > st.lastEdit) st.lastEdit = st.status!.lastEdit
      render()
      paintLifecycle()
    } catch { /* the server is gone; the live dot already says so */ }
  }
  /**
   * A change sent to the server. Resolves to its status, or null when it was turned down; the status
   * shown stays as it was then. Keep, Stop and Undo say why where they were asked for (at), the way
   * a send of comments does; the minute's ping fails quietly (the live dot says the server is gone).
   */
  async function post(path: string, body: unknown = {}, at?: 'session' | 'work'): Promise<Status | null> {
    try {
      const signal = at === 'session' ? AbortSignal.timeout(10_000) : undefined
      const res = await fetch(`/__proto/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal })
      const got = await res.json().catch(() => { if (signal?.aborted) throw signal.reason; return {} })
      if (!res.ok) throw new Error(got.error || `the server answered ${res.status}`)
      if (at) st.failed = null
      if (path !== 'stop') { st.status = got; paintLifecycle() }
      render()
      return got
    } catch (e) {
      if (at) { st.failed = { at, text: e instanceof Error && e.name === 'TimeoutError' ? 'The server took too long to respond. Try again.' : e instanceof TypeError ? 'The server didn’t answer. Is it still running?' : `Couldn’t do that: ${e instanceof Error ? e.message : e}` }; render() }
      return null
    }
  }
  /** Sends comments to the session's agent. Resolves to the batch's id and how each decision in it
   *  went; throws with the server's reason when the batch itself was turned down. */
  async function sendBatch(batch: CommentBatch): Promise<Sent> {
    // A pick made here moves the working variant. That move is the user's own, so the strip doesn't
    // offer it back as one Claude made: where it goes is known before sending, since session.json
    // can arrive before the answer does.
    const pick = batch.comments.filter(c => c.action === 'pick').at(-1)
    if (pick) { const [proto, variant] = pick.route.split('/'); expected = { proto, variant } }
    try {
      const res = await fetch('/__proto/comments', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ theme: st.dark ? 'dark' : 'light', ...batch }) })
      const body: { error?: string; sent: string; moved?: boolean; results?: Sent['results'] } & Status = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || `the server answered ${res.status}`)
      // The answer says where the working variant is now. A move session.json hasn't brought yet is
      // still expected; one it already brought (or none) is not.
      if (pick) expected = body.moved && body.work && !same(session.work, body.work) ? body.work : null
      st.status = body
      render()
      return { id: body.sent, results: body.results ?? [] }
    } catch (e) {
      if (pick) expected = null
      throw e
    }
  }
  // While the page is open and visible it counts as activity, so the server isn't stopped
  // as idle under someone who is looking at it.
  // The page inside a device view only asks: the page outside is the one being looked at.
  const ping = () => { if (document.visibilityState === 'visible' && !st.stopped) void (framed ? refreshStatus() : post('ping')) }
  setInterval(ping, 60_000)
  document.addEventListener('visibilitychange', ping)
  setInterval(() => document.querySelectorAll<HTMLElement>('[data-ago]').forEach(el => { el.textContent = ago(Number(el.dataset.ago)) }), 1000)
  // A Building mark that was never ended by `proto done` goes out a few minutes after the last edit.
  let expiry = 0
  const watchExpiry = () => {
    clearTimeout(expiry)
    const ends = Object.keys(session.building ?? {}).map(buildingUntil).filter(t => t > Date.now())
    if (ends.length) expiry = window.setTimeout(() => { builtFailed(); render(); watchExpiry() }, Math.min(...ends) - Date.now() + 50)
  }
  // A variant that ended building shows what went wrong while it was: a file that couldn't load
  // (shown again), and a compile error whose overlay was taken away (put back).
  const hidden = new Map<string, unknown>(), erred = new Set<string>()
  const builtFailed = () => {
    if ([...failed].some(f => { const r = refOfPath(f); return r && !building(r.proto, r.variant) })) show(false)
    for (const [key, err] of hidden) {
      const [p, v] = key.split('/')
      if (building(p, v)) continue
      hidden.delete(key)
      const Overlay = customElements.get('vite-error-overlay')
      if (Overlay && !document.querySelector('vite-error-overlay')) document.body.append(new (Overlay as unknown as new (err: unknown) => HTMLElement)(err))
    }
  }
  watchExpiry()

  // ---------- boot ----------
  installPointerTracking()
  if (framed) offerTheme(applyTheme)
  applyTheme(st.dark)
  // The link opens where it points; a bare link reopens where this browser last was.
  const start = parseHash() ?? parseHash(localStorage.getItem(`proto-place-${session.id}`) ?? '') ?? defaultPlace()
  if (location.hash !== hashOf(start)) history.replaceState(null, '', hashOf(start))
  arrive(start, false)
  if (q.has('focus')) act('focus', '', '')
  // ?copy=1 (proto shoot --copy): copy mode opens once the design on the stage declares its lines.
  if (q.has('copy')) comments.copy.want()
  refreshStatus()
  Promise.all([document.fonts.ready, q.has('shot') ? (layer as Layer | null)?.ready : Promise.race([(layer as Layer | null)?.ready, wait(5000)])]).then(() => requestAnimationFrame(() => requestAnimationFrame(() => { document.documentElement.dataset.ready = '1' })))

  // The working variant the page itself just moved to (a pick, Undo), until session.json brings it.
  let editTimer = 0, movedTimer = 0, expected: Ref | null = null
  return {
    // New prototypes and new variants are followed; edits to existing ones only light the
    // editing dot, so the view never jumps while someone is looking at something.
    setProtos(next: Proto[]) {
      const before = new Map(protos.map(p => [p.id, new Set(p.variants.map(v => v.id))]))
      protos = next
      if (framed) {
        // The page in a view follows nothing itself: the page outside does, and it goes along. A place
        // it was waiting for (see hashchange) is one it knows now.
        const p = parseHash()
        if (p && hashOf(p) !== hashOf(st.place)) return arrive(p, false)
      } else {
        const fresh = next.filter(p => !p.archived && !before.has(p.id))
        const grown = next.map(p => ({ p, added: before.has(p.id) ? p.variants.filter(v => !before.get(p.id)!.has(v.id)) : [] })).filter(x => x.added.length)
        if (fresh.length) return go({ view: 'proto', proto: fresh.at(-1)!.id })
        const here = st.place.view === 'proto' ? st.place.proto : null
        const g = grown.find(x => x.p.id !== here)
        if (g) return go(g.added.length === 1 ? { view: 'variant', proto: g.p.id, variant: g.added[0].id } : { view: 'proto', proto: g.p.id })
        if (!valid(st.place)) return go(defaultPlace())
      }
      // Same place, new modules (a meta edit or a re-evaluated file): swap without a fade. A
      // variant that failed to load gets another try with the fresh registry.
      const refs = refsFor(st.place)
      if (!layer || failed.size || refs.length !== layer.refs.length || refs.some((r, i) => r !== layer!.refs[i])) show(false)
      render()
    },
    /** Whether this file's module is in use on the page (loaded, or failed and waiting for a fix). */
    shows: (file: string) => loaded.has(file) || failed.has(file),
    replaceVariant(file: string, component: unknown) {
      const nameOf = (c: any) => c?.displayName || c?.__name || c?.name || ''
      const old = loaded.get(file)
      const broken = failed.delete(file)
      loaded.set(file, component)
      updates++
      if (broken || (old !== component && nameOf(old) !== nameOf(component))) show(false)
      reloadIfStale()
    },
    // A working variant Claude moved shows where it came from, with Undo, for a few seconds.
    setSession(next: Session) {
      const was = session.work
      const hostChanged = session.agent !== next.agent
      session = next
      if (hostChanged) comments.hostChanged()
      builtFailed()
      watchExpiry()
      if (!same(was, next.work)) {
        // Any move ends the wait: one that isn't the expected one is Claude's.
        const own = same(next.work, expected)
        expected = null
        // A move Claude made just before no longer says where this one came from.
        if (own && st.moved) { st.moved = null; clearTimeout(movedTimer) }
        if (was && next.work && !own && refOk(was)) {
          st.moved = { proto: was.proto, variant: was.variant }
          clearTimeout(movedTimer)
          movedTimer = window.setTimeout(() => { st.moved = null; render() }, 8000)
        }
      }
      render()
    },
    setLive(live: boolean) { st.live = live; render() },
    setInbox(inbox: Inbox) { if (st.status) { st.status = { ...st.status, inbox }; render() } },
    sendComments: sendBatch,
    /** A compile error from Vite: one in a variant (or a helper of its own) that is still building is
     *  expected mid-build, so its overlay is taken away and kept until the variant is built. */
    viteError(file: string, err: unknown) {
      const r = ownerOfPath(file)
      if (!r || !building(r.proto, r.variant)) return
      hidden.set(`${r.proto}/${r.variant}`, err)
      erred.add(`${r.proto}/${r.variant}`)
      setTimeout(() => document.querySelector('vite-error-overlay')?.remove())
    },
    /** A hot update starts: errors from here on belong to it. */
    updating() { erred.clear() },
    /** A hot update ended (Vite says so even when the file didn't compile): an error kept for a
     *  variant it touched is over, unless this update raised it. */
    compiled(path: string) {
      const r = ownerOfPath(path)
      if (r && !erred.has(`${r.proto}/${r.variant}`)) hidden.delete(`${r.proto}/${r.variant}`)
    },
    edited(paths: string[]) {
      let retrying = false
      for (const path of paths) {
        if (!path.includes('/src/protos/')) continue
        if (failed.has(path)) { failed.delete(path); retry.set(path, Date.now()); retrying = true }
        st.lastEdit = Date.now()
        const r = refOfPath(path), owner = ownerOfPath(path)
        if (r) st.editing = r
        if (owner) editedAt.set(`${owner.proto}/${owner.variant}`, Date.now())
      }
      if (retrying) show(false)
      motionDock.edited(paths, st.place.view === 'variant' ? st.place.proto : null)
      render()
      clearTimeout(editTimer)
      editTimer = window.setTimeout(() => { st.editing = null; render() }, 10_000)
    },
  }
}
