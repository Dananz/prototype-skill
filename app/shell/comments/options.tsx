// Options in place: an element a variant offers a few values for (shell/options.ts) wears a quiet dot
// at its top end corner. Hovering the element outlines it and names it; clicking the dot opens a panel
// beside the element, never over it (a sheet on a phone), with a tile per option showing what the
// element looks like with it (pictures.ts). Pointing at a tile shows it on the design, a click keeps it
// and the panel stays open to compare; the panel and the dot stay where they opened while the element
// changes size. Shift-click on a dot (or the arrows on a focused dot) steps to the next option without
// opening anything. Tabs when the element has several facets (its words and its size). The footer asks
// the agent for more options, turns them into a prototype, or shows the original while held (\ too).
// The comments island lists what changed (OptionsTray) and sends it in one batch: one comment per
// changed facet on its element, for the agent to make it the element's value and take the control out.
// While sent, the dots of those elements wait; when the agent is done, the tray says it is set.
// An element with no options can ask for some (its right-click menu), and waits for them.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent as RKeyboardEvent, type ReactNode } from 'react'
import { Drawer } from '@base-ui/react/drawer'
import { rtl, t, tn } from '../i18n'
import { copy } from '../copy'
import { tweaks } from '../tweaks'
import { options, spotsOf, chosen, isChanged, nameOf, choiceOf, idsOf, MARKED, type Facet, type Spot } from '../options'
import { listen } from '../quiet'
import { useAgentName, useCtx, type Host } from './ctx'
import { describe, find, frameOf, scaleOf } from './dom'
import { drawFacet, keyOf, pictureOf, pictureStore, stillOf, stopDrawing, type Picture, type Still } from './pictures'
import type { Store } from './store'
import type { Target } from './types'
import { IB, Icon, PRIMARY } from './ui'

// ---------- the state: the panel, and what was sent (kept per variant for the tab) ----------
export type AskKind = 'more' | 'promote' | 'ask'
/** A request the agent has not finished: more options for a facet, a prototype of them, options for an element that has none. */
export type Ask = { kind: AskKind; key: string; label: string; batch: string; target?: Target; seen?: boolean; listed?: boolean }
export type SentItem = { key: string; facet: string; label: string; choice: string; from: string; target?: Target }
/** `listed`: the server has listed the batch (it lists the last 20), so one no longer listed is long done. */
type Rec = { sent?: { batch: string; items: SentItem[]; undo?: boolean; listed?: boolean }; dismissed?: string; asks: Ask[]; fresh: string[] }
export type OptState = {
  /** The design the dots are on; null where options are off (a share, a shot, a tool, side by side). */
  stage: HTMLElement | null
  route: string
  /** The open spot's key; ASK for the ask panel, on `askEl`. */
  open: string | null
  askEl: HTMLElement | null
  tab: number
  /** The open spot's tiles are being drawn: the element under a still copy of itself. */
  cover: { html: string; w: number; h: number; box: Box } | null
  sending: boolean
  error: string
  rec: Rec
}
export const ASK = '\u0000ask'
type Box = { x: number; y: number; w: number; h: number }

export function createOptionsStore(session: string) {
  const key = `proto-options-${session}`
  let all: Record<string, Rec> = {}
  try { const v = JSON.parse(sessionStorage.getItem(key) ?? '{}'); if (v && typeof v === 'object') all = v } catch { /* none kept */ }
  const recOf = (route: string): Rec => { const r = all[route]; return r && Array.isArray(r.asks) && Array.isArray(r.fresh) ? r : { asks: [], fresh: [] } }
  let state: OptState = { stage: null, route: '', open: null, askEl: null, tab: 0, cover: null, sending: false, error: '', rec: { asks: [], fresh: [] } }
  const subs = new Set<() => void>()
  const tell = () => { for (const f of [...subs]) f() }
  return {
    get: () => state,
    set(patch: Partial<OptState>) { state = { ...state, ...patch }; tell() },
    /** Change what is kept for the variant on the stage. */
    keep(f: (r: Rec) => Rec) {
      if (!state.route) return
      const next = f(state.rec)
      all[state.route] = next
      try { sessionStorage.setItem(key, JSON.stringify(all)) } catch { /* lasts until a reload */ }
      state = { ...state, rec: next }
      tell()
    },
    recOf,
    subscribe(f: () => void) { subs.add(f); return () => { subs.delete(f) } },
  }
}
export type OptStore = ReturnType<typeof createOptionsStore>

type Phase = 'idle' | 'sent' | 'applied'
const batchState = (store: Store, id: string) => store.get().inbox?.batches.find(b => b.id === id)?.state

export function createOptionsActions(os: OptStore, host: Host, comments: Store) {
  const get = os.get
  const stage = () => get().stage
  const send = (list: { text: string; action: 'copy' | 'option' | 'more-options' | 'to-prototype' | 'ask-options'; target?: Target }[]) =>
    host.send({ theme: host.dark() ? 'dark' : 'light', viewport: { w: innerWidth, h: innerHeight, phone: innerWidth < 640 }, comments: list.map(c => ({ route: get().route, ...c })) })
  const targetOf = (sp: Spot) => { const st = stage(), el = sp.els[0]; return st && el ? describe(st, el) : undefined }
  const act = {
    spots: () => spotsOf(stage()),
    /** The page moved or redrew: the design the dots are on now. */
    setStage(st: HTMLElement | null, route: string) {
      const s = get()
      if (st === s.stage && route === s.route) return
      if (s.stage && s.stage !== st) { stopDrawing(); options.release(s.stage) }
      const same = route === s.route
      os.set({ stage: st, route, ...(same ? {} : { open: null, askEl: null, tab: 0, error: '', rec: os.recOf(route) }), cover: null })
    },
    open(key: string, tab = 0) {
      const st = stage()
      if (!st) return
      if (get().open && get().open !== key) act.close()
      os.set({ open: key, askEl: null, tab })
      if (get().rec.fresh.includes(key)) os.keep(r => ({ ...r, fresh: r.fresh.filter(k => k !== key) }))
    },
    /** Options for any element of the design: its spot's panel, or asking for some when it has none. */
    openOn(el: HTMLElement) {
      const st = stage()
      if (!st || !st.contains(el)) return
      const m = el.closest<HTMLElement>(MARKED)
      const sp = m && spotsOf(st).find(s => s.els.includes(m))
      if (sp) return act.open(sp.key)
      os.set({ open: ASK, askEl: el, tab: 0 })
    },
    close() {
      const st = stage()
      stopDrawing()
      if (st) options.preview(st, null)
      os.set({ open: null, askEl: null, cover: null })
    },
    escape(): boolean { if (!get().open) return false; act.close(); return true },
    setTab(tab: number) { const st = stage(); if (st) options.preview(st, null); os.set({ tab }) },
    /** What Send posts: each changed facet whose choice differs from what was last sent for it. */
    pending() {
      const st = stage()
      if (!st) return []
      const sent = get().rec.sent, phase = act.phase()
      return spotsOf(st).flatMap(sp => sp.facets.filter(f => isChanged(st, f)).flatMap(f => {
        const was = phase !== 'idle' ? sent?.items.find(i => i.facet === f.key) : undefined
        return was && was.choice === nameOf(st, f) ? [] : [{ spot: sp, facet: f }]
      }))
    },
    phase(): Phase {
      const sent = get().rec.sent
      if (!sent || get().rec.dismissed === sent.batch) return 'idle'
      const b = batchState(comments, sent.batch)
      return b === 'done' || (b === undefined && sent.listed) ? 'applied' : 'sent'
    },
    async send() {
      const st = stage(), s = get()
      const list = act.pending()
      if (!st || !list.length || s.sending) return
      const items: SentItem[] = []
      const words: Record<string, string> = {}
      const comments = list.map(({ spot, facet: f }) => {
        const i = chosen(st, f), n = f.options.length, name = nameOf(st, f), target = targetOf(spot)
        items.push({ key: spot.key, facet: f.key, label: spot.facets.length < 2 || f.label.toLowerCase().startsWith(spot.label.toLowerCase()) ? (spot.facets.length < 2 ? spot.label : f.label) : `${spot.label}, ${f.kind === 'words' ? 'words' : f.label}`, choice: name, from: f.options[f.today]?.name ?? '', target })
        if (f.from === 'copy') {
          words[f.id] = name
          const which = i === 0 ? `back to today's words (option 1 of ${n})` : `option ${i + 1} of ${n}`
          return { text: `${f.label} (${f.id}): “${name}”, ${which}`, action: 'copy' as const, ...(target ? { target } : {}) }
        }
        const v = choiceOf(st, f)
        const shown = f.kind === 'color' ? `${name} (${v})` : f.kind === 'toggle' ? `${name} (${v})` : name
        return {
          text: `${f.label} (useTweaks ${f.id}): “${shown}”, option ${i + 1} of ${n}; today “${f.options[f.today]?.name}”. Options: ${f.options.map(o => o.name).join(', ')}`,
          action: 'option' as const, ...(target ? { target } : {}),
        }
      })
      os.set({ sending: true, error: '' })
      try {
        const { id } = await send(comments)
        if (Object.keys(words).length) copy.sent(s.route, id, words)
        os.keep(r => ({ ...r, sent: { batch: id, items }, dismissed: undefined }))
        os.set({ sending: false })
        act.close()
      } catch (e) {
        os.set({ sending: false, error: e instanceof Error ? e.message : t('Could not send') })
      }
    },
    /** Applied by the agent, then taken back: asks it to put each value back as it was. */
    async undo() {
      const sent = get().rec.sent
      if (!sent || get().sending) return
      os.set({ sending: true, error: '' })
      try {
        const { id } = await send(sent.items.map(i => ({
          text: `${i.label}: undo the choice “${i.choice}”, put back “${i.from}” as it was before`, action: 'option' as const, ...(i.target ? { target: i.target } : {}),
        })))
        os.keep(r => ({ ...r, sent: { batch: id, items: sent.items.map(i => ({ ...i, choice: i.from, from: i.choice })), undo: true }, dismissed: undefined }))
        os.set({ sending: false })
      } catch (e) { os.set({ sending: false, error: e instanceof Error ? e.message : t('Could not send') }) }
    },
    dismiss() { const b = get().rec.sent?.batch; if (b) os.keep(r => ({ ...r, dismissed: b })) },
    /** A request about one facet, or one element: sent at once, waited for on the element. */
    async ask(kind: AskKind, about: { spot?: Spot; facet?: Facet; el?: HTMLElement; kinds?: string[] }) {
      const st = stage()
      if (!st || get().sending) return
      const { spot, facet: f, el, kinds } = about
      const target = spot ? targetOf(spot) : el ? describe(st, el) : undefined
      const label = spot ? spot.label : (el?.innerText?.trim().split('\n')[0].slice(0, 40) || el?.tagName.toLowerCase() || '')
      const names = f ? f.options.map(o => o.name).join(', ') : ''
      const text = kind === 'more' && f
        ? `${f.label} (${f.from === 'copy' ? `useCopy ${f.id}` : `useTweaks ${f.id}`}): add 3 more options, different from these: ${names}`
        : kind === 'promote' && f
          ? `${f.label} (${f.from === 'copy' ? `useCopy ${f.id}` : `useTweaks ${f.id}`}): make its options a prototype, one variant per option, Current first: ${names}`
          : `Options for this element: ${(kinds ?? []).join(', ') || 'color'}`
      os.set({ sending: true, error: '' })
      try {
        const { id } = await send([{ text, action: kind === 'more' ? 'more-options' : kind === 'promote' ? 'to-prototype' : 'ask-options', ...(target ? { target } : {}) }])
        os.keep(r => ({ ...r, asks: [...r.asks.filter(a => !(a.kind === kind && a.key === (spot?.key ?? ''))), { kind, key: spot?.key ?? '', label, batch: id, target }] }))
        os.set({ sending: false })
      } catch (e) { os.set({ sending: false, error: e instanceof Error ? e.message : t('Could not send') }) }
    },
    /** Requests the agent finished: their element's dot pulses until it is opened. */
    settle() {
      const st = stage(), r = get().rec
      if (!st || !comments.get().inbox) return
      const listed = (id: string) => batchState(comments, id) !== undefined
      if ((r.sent && !r.sent.listed && listed(r.sent.batch)) || r.asks.some(a => !a.listed && listed(a.batch))) {
        os.keep(x => ({ ...x, ...(x.sent ? { sent: { ...x.sent, listed: x.sent.listed || listed(x.sent.batch) } } : {}), asks: x.asks.map(a => a.listed || !listed(a.batch) ? a : { ...a, listed: true }) }))
      }
      const done = get().rec.asks.filter(a => !a.seen && (batchState(comments, a.batch) === 'done' || (batchState(comments, a.batch) === undefined && a.listed)))
      if (!done.length) return
      const fresh = done.flatMap(a => {
        if (a.kind === 'promote') return []
        if (a.key) return [a.key]
        const el = a.target ? find(st, a.target) : null
        const sp = el ? spotsOf(st).find(s => s.els.some(x => x === el || x.contains(el) || el.contains(x))) : null
        return sp ? [sp.key] : []
      })
      os.keep(x => ({ ...x, asks: x.asks.filter(a => !done.includes(a) || (a.kind === 'promote' && !a.seen)).map(a => done.includes(a) && a.kind === 'promote' ? { ...a, seen: true } : a), fresh: [...new Set([...x.fresh, ...fresh])] }))
    },
    asking: (kind: AskKind, key: string) => get().rec.asks.find(a => a.kind === kind && a.key === key && !a.seen) ?? null,
    promoted: (key: string) => get().rec.asks.find(a => a.kind === 'promote' && a.key === key && a.seen) ?? null,
  }
  return act
}
export type OptActions = ReturnType<typeof createOptionsActions>

// ---------- measuring ----------
const styleOf = (el: Element) => (el.ownerDocument.defaultView ?? window).getComputedStyle(el)
function drawn(el: Element, r: DOMRect) {
  const f = frameOf(el)
  if (!f) return r
  const o = f.getBoundingClientRect(), s = scaleOf(el)
  return new DOMRect(o.left + r.left * s, o.top + r.top * s, r.width * s, r.height * s)
}
/** An element's box over the layer, in the layer's px. */
export function boxIn(el: Element, layer: HTMLElement): Box {
  const r = drawn(el, el.getBoundingClientRect()), o = layer.getBoundingClientRect()
  return { x: r.left - o.left, y: r.top - o.top, w: r.width, h: r.height }
}
const filled = (c: string) => c !== 'transparent' && !/rgba\([^)]*,\s*0\)$/.test(c)
/** Where an element shows: a line of text (no background or border of its own) by its words, so its dot
 *  sits at the end of the words rather than at the far end of a wide block; anything else by its box. */
function shapeIn(el: HTMLElement, layer: HTMLElement): Box {
  const box = boxIn(el, layer), cs = styleOf(el)
  if (filled(cs.backgroundColor) || parseFloat(cs.borderTopWidth) > 0 || parseFloat(cs.borderBottomWidth) > 0 || !el.textContent?.trim() || el.querySelector('svg, img, video, canvas')) return box
  const range = el.ownerDocument.createRange()
  range.selectNodeContents(el)
  const r = drawn(el, range.getBoundingClientRect()), o = layer.getBoundingClientRect()
  return r.width ? { x: r.left - o.left, y: box.y, w: r.width, h: box.h } : box
}
type Mark = { key: string; n: number; box: Box; rtl: boolean }
const shownOn = (b: Box, W: number, H: number) => b.x + b.w > -4 && b.y + b.h > -4 && b.x < W + 4 && b.y < H + 4
/** Where a spot's dot sits: its top end corner; a hairline's on the line's end; a small element's just past its end. */
function dotAt(m: Mark) {
  const { x, y, w, h } = m.box
  const end = m.rtl ? x : x + w
  if (h <= 4 || w <= 4) return { x: m.rtl ? x + 1 : x + w - 1, y: y + h / 2 }
  if (h < 16 || w < 16) return { x: m.rtl ? end - 9 : end + 9, y: y + h / 2 }
  return { x: m.rtl ? end + 1 : end - 1, y: y + 1 }
}

// ---------- shared hooks ----------
const useNarrow = () => useSyncExternalStore(f => { const m = matchMedia('(max-width: 639px)'); m.addEventListener('change', f); return () => m.removeEventListener('change', f) }, () => matchMedia('(max-width: 639px)').matches)
export const useOptState = (os: OptStore) => useSyncExternalStore(os.subscribe, os.get)
/** Re-renders on any change to the design's values (tweaks, copy, what shows for now) or its pictures. */
function useValues() {
  const [, set] = useState(0)
  useEffect(() => {
    const bump = () => set(n => n + 1)
    const offs = [tweaks.subscribe(bump), copy.subscribe(bump), options.subscribe(bump), pictureStore.subscribe(bump)]
    return () => offs.forEach(f => f())
  }, [])
}
function usePhase() {
  const { store, optAct } = useCtx()
  return useSyncExternalStore(store.subscribe, () => optAct.phase())
}

// ---------- a tile ----------
const still = (p: Picture | undefined): p is Still => !!p && typeof p === 'object'
/** One scale for all of a facet's pictures, so a size reads as bigger or smaller: as big as the biggest
 *  fits its tile (a small element up to 2.2 times). Words are fitted by their height and cut at the
 *  tile's edge, so their size still shows. */
export function fitOf(pics: (Picture | undefined)[], w: number, h: number) {
  const ps = pics.filter(still)
  if (!ps.length) return 1
  if (ps.every(p => p.text)) return Math.min(1.1, ...ps.map(p => (h - 14) / p.h))
  return Math.min(2.2, ...ps.map(p => Math.min((w - 12) / p.w, (h - 10) / p.h)))
}
/** The picture of an option, at the facet's scale. */
function Pic({ pic, w, k }: { pic: Picture | undefined; w: number; k: number }) {
  if (!pic || pic === 'failed') return null
  if (pic === 'empty') return <span className="size-6 rounded-md border border-dashed border-zinc-400/70" />
  const cut = pic.w * k > w - 8
  return (
    <span aria-hidden className={`pointer-events-none relative block shrink-0 overflow-hidden ${cut ? '[mask-image:linear-gradient(to_right,#000_80%,transparent)] rtl:[mask-image:linear-gradient(to_left,#000_80%,transparent)]' : ''}`} style={{ width: Math.min(pic.w * k, w - 8), height: pic.h * k }}>
      <span className="absolute start-0 top-0 block origin-top-left rtl:origin-top-right" style={{ width: pic.w, height: pic.h, transform: `scale(${k})` }} dangerouslySetInnerHTML={{ __html: pic.html }} />
    </span>
  )
}

function Tile({ f, i, pic, k, bg, big, drawing, chosenNow, previewed, onPick, onPreview }: {
  f: Facet; i: number; pic: Picture | undefined; k: number; bg: string; big?: boolean; drawing: boolean; chosenNow: boolean; previewed: boolean; onPick(): void; onPreview(on: boolean): void
}) {
  const o = f.options[i], today = f.today === i
  const ring = chosenNow ? 'ring-2 ring-proto-primary' : previewed ? 'ring-[1.5px] ring-zinc-400/80' : 'ring-1 ring-black/[.08] dark:ring-white/10'
  // On every move, not only on entering: a tile entered while the pictures were still being drawn shows once they are.
  const enter = (e: React.PointerEvent) => { if (e.pointerType === 'mouse' && !previewed && !chosenNow) onPreview(true) }
  if (f.kind === 'words') return (
    <button type="button" data-option-tile={i} aria-pressed={chosenNow}
      onPointerMove={enter} onFocus={() => onPreview(true)} onBlur={() => onPreview(false)} onClick={onPick}
      className={`flex w-full items-center gap-2.5 rounded-xl px-1.5 py-1 text-start ${previewed ? 'bg-zinc-900/[.05] dark:bg-white/[.07]' : 'hover:bg-zinc-900/[.04] dark:hover:bg-white/[.05]'}`}>
      <span className={`flex min-w-0 flex-1 items-center rounded-lg px-3 ${ring} ${big ? 'min-h-12 py-2 text-[16px]' : 'min-h-11 py-1.5 text-[15px]'}`} style={{ background: bg }}>
        <span dir="auto" className="line-clamp-2 font-semibold leading-snug text-zinc-900 dark:text-zinc-100">{o.name}</span>
      </span>
      <span className="w-12 shrink-0 text-[11px] text-zinc-400">{today ? t('Now') : ''}</span>
    </button>
  )
  const swatch = f.kind === 'color' && (!pic || pic === 'failed') && typeof o.value === 'string'
  return (
    <button type="button" data-option-tile={i} aria-pressed={chosenNow} aria-label={o.name}
      onPointerMove={enter} onFocus={() => onPreview(true)} onBlur={() => onPreview(false)} onClick={onPick}
      className={`group flex shrink-0 flex-col items-center gap-1 rounded-2xl p-1 pb-1.5 ${big ? 'w-full' : 'w-[78px]'} ${previewed ? 'bg-zinc-900/[.05] dark:bg-white/[.07]' : 'hover:bg-zinc-900/[.04] dark:hover:bg-white/[.05]'}`}>
      <span data-option-picture={pic && typeof pic === 'object' ? '' : undefined} className={`relative grid w-full place-items-center overflow-hidden rounded-xl ${ring} ${big ? 'h-[68px]' : 'h-[58px]'}`} style={{ background: bg }}>
        {drawing && !pic ? <span className="size-full animate-pulse bg-zinc-900/[.04] dark:bg-white/[.05]" />
          : swatch ? <span className="size-7 rounded-full ring-1 ring-black/10" style={{ background: o.value as string }} />
          : pic && pic !== 'failed' ? <Pic pic={pic} w={big ? 84 : 70} k={k} />
          : <span dir="auto" className="line-clamp-2 px-1 text-center text-[11px] font-medium text-zinc-700 dark:text-zinc-200">{o.name}</span>}
        {chosenNow && <span className="absolute end-1 top-1 grid size-4 place-items-center rounded-full bg-proto-primary text-white shadow-[0_0_0_2px_white] dark:shadow-[0_0_0_2px_#18181b]"><Icon name="check" className="size-2.5" /></span>}
      </span>
      <span dir="auto" className={`max-w-full truncate text-[12px] leading-4 ${chosenNow ? 'font-semibold text-zinc-900 dark:text-white' : 'text-zinc-600 dark:text-zinc-300'}`}>{o.name}</span>
      <span className="h-3 text-[10px] leading-3 text-zinc-400">{today ? t('Now') : previewed && !chosenNow ? t('Showing') : ''}</span>
    </button>
  )
}

/** Tiles in one row that scrolls sideways once they no longer fit, with a fade and an arrow on the side that has more. */
function Strip({ children, pick, big }: { children: ReactNode; pick: number; big?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const [edge, setEdge] = useState({ start: true, end: true })
  const read = useCallback(() => {
    const el = ref.current
    if (!el) return
    const x = Math.abs(el.scrollLeft)
    setEdge({ start: x < 2, end: x + el.clientWidth >= el.scrollWidth - 2 })
  }, [])
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const tile = el.querySelectorAll<HTMLElement>('[data-option-tile]')[pick]
    // Centred on the chosen one: in a right-to-left row, scrollLeft runs from 0 (its start) down.
    if (tile) el.scrollLeft = tile.offsetLeft - (el.clientWidth - tile.offsetWidth) / 2 - (rtl ? el.scrollWidth - el.clientWidth : 0)
    read()
    const wheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return
      const max = el.scrollWidth - el.clientWidth, x = Math.abs(el.scrollLeft)
      if ((e.deltaY > 0 && x >= max - 1) || (e.deltaY < 0 && x <= 1)) return
      e.preventDefault()
      el.scrollBy({ left: rtl ? -e.deltaY : e.deltaY })
    }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => el.removeEventListener('wheel', wheel)
  }, [read]) // eslint-disable-line react-hooks/exhaustive-deps
  const step = (dir: 1 | -1) => { const el = ref.current; if (el) el.scrollBy({ left: (rtl ? -dir : dir) * el.clientWidth * 0.8, behavior: 'smooth' }) }
  const ARROW = 'absolute top-[20px] grid size-7 place-items-center rounded-full bg-white text-zinc-700 shadow-md ring-1 ring-black/10 hover:bg-zinc-100 hover:text-zinc-900 dark:bg-zinc-700 dark:text-zinc-100 dark:ring-white/15 dark:hover:bg-zinc-600'
  return (
    <div className="relative" data-base-ui-swipe-ignore="">
      <div ref={ref} data-option-strip="" onScroll={read} className={`relative flex snap-x snap-mandatory gap-1 overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${big ? 'gap-1.5' : ''}`}>
        {children}
      </div>
      <span aria-hidden className={`pointer-events-none absolute inset-y-0 end-0 w-10 bg-gradient-to-l from-white to-transparent transition-opacity rtl:bg-gradient-to-r dark:from-zinc-900 ${edge.end ? 'opacity-0' : 'opacity-100'}`} />
      <span aria-hidden className={`pointer-events-none absolute inset-y-0 start-0 w-10 bg-gradient-to-r from-white to-transparent transition-opacity rtl:bg-gradient-to-l dark:from-zinc-900 ${edge.start ? 'opacity-0' : 'opacity-100'}`} />
      {!big && !edge.end && <button type="button" data-option-next="" aria-label={t('More options')} onClick={() => step(1)} className={`${ARROW} end-0`}><Icon name="right" className="size-3.5" /></button>}
      {!big && !edge.start && <button type="button" data-option-prev="" aria-label={t('Earlier options')} onClick={() => step(-1)} className={`${ARROW} start-0`}><Icon name="left" className="size-3.5" /></button>}
    </div>
  )
}

/** Press and hold to see the design as it was (every changed element at today's value). */
export function HoldOriginal({ compact = false, big = false }: { compact?: boolean; big?: boolean }) {
  const { optStore } = useCtx()
  const st = useOptState(optStore).stage
  useValues()
  const on = !!st && options.comparing() === st
  const hold = (v: boolean) => { if (st) options.compare(st, v) }
  return (
    <button type="button" data-option-original="" data-base-ui-swipe-ignore="" aria-pressed={on} title={`${t('Hold to see the original')} · \\`}
      onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); hold(true) }}
      onPointerUp={() => hold(false)} onPointerCancel={() => hold(false)} onLostPointerCapture={() => hold(false)}
      onKeyDown={e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); hold(true) } }} onKeyUp={() => hold(false)} onBlur={() => hold(false)}
      onContextMenu={e => e.preventDefault()}
      className={`flex shrink-0 touch-none select-none items-center gap-1.5 rounded-full font-medium ${big ? 'h-10 px-3 text-[14px]' : 'h-8 px-2.5 text-[12px]'} ${on ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900' : 'text-zinc-600 hover:bg-zinc-900/5 dark:text-zinc-300 dark:hover:bg-white/10'}`}>
      <Icon name="original" className="size-3.5" />{!compact && (on ? t('This is the original') : t('Original'))}
    </button>
  )
}

/** The panel's body, for the popover and the sheet: tabs, the tiles, and the footer. */
export function OptionsBody({ spot, big }: { spot: Spot; big?: boolean }) {
  const { host, optStore, optAct } = useCtx()
  const s = useOptState(optStore)
  useValues()
  const phase = usePhase()
  const st = s.stage!
  const tab = Math.min(s.tab, spot.facets.length - 1)
  const f = spot.facets[tab]
  const el = spot.els[0]
  const n = f.options.length
  const words = f.kind === 'words'
  const pv = options.previewed()
  const now = chosen(st, f)
  const key = el ? keyOf(st, spot, f, el) : ''
  const bg = el ? backdropOf(el) : 'transparent'
  const narrow = useNarrow()
  // Draw the tiles of the facet on show: once per option, kept until the design changes around them.
  const drawing = !!s.cover
  useEffect(() => {
    if (words || !el) return
    let alive = true
    const tm = setTimeout(() => {
      if (!alive) return
      const find = () => spotsOf(st).find(x => x.key === spot.key)?.els[0] ?? null
      void drawFacet(st, spot, f, find, on => {
        const e = find()
        if (on && e) { const still = stillOf(e); optStore.set({ cover: still ? { ...still, box: boxIn(e, host.layer) } : null }) }
        else optStore.set({ cover: null })
      })
    }, 30)
    return () => { alive = false; clearTimeout(tm) }
  }, [key, f.key]) // eslint-disable-line react-hooks/exhaustive-deps
  const preview = (i: number) => (on: boolean) => {
    if (phase === 'sent' || narrow || drawing) return
    if (on) options.preview(st, f, i)
    else { const now = options.previewed(); if (now?.key === f.key && now.index === i) options.preview(st, null) }
  }
  const pick = (i: number) => () => { options.choose(st, f, i); options.preview(st, null) }
  const pics = f.options.map((_, i) => pictureOf(key, i))
  const k = fitOf(pics, big ? 84 : 70, big ? 68 : 58)
  const tiles = f.options.map((_, i) => (
    <Tile key={`${f.key}-${i}`} f={f} i={i} pic={pics[i]} k={k} bg={bg} big={big} drawing={drawing}
      chosenNow={now === i} previewed={pv?.key === f.key && pv.index === i && now !== i}
      onPreview={preview(i)} onPick={pick(i)} />
  ))
  const more = optAct.asking('more', spot.key), promoting = optAct.asking('promote', spot.key), promoted = optAct.promoted(spot.key)
  const h = big ? 'h-10 text-[14px]' : 'h-8 text-[12px]'
  return (
    <div className="flex flex-col gap-2">
      {spot.facets.length > 1 && (
        <div role="tablist" className="flex rounded-xl bg-zinc-900/[.05] p-0.5 dark:bg-white/[.07]">
          {spot.facets.map((x, i) => (
            <button key={x.key} type="button" role="tab" aria-selected={tab === i} data-option-tab={i} onClick={() => optAct.setTab(i)}
              className={`relative flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-[10px] px-2 font-medium ${big ? 'h-9 text-[14px]' : 'h-7 text-[12px]'} ${tab === i ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-white' : 'text-zinc-500'}`}>
              <span className="shrink-0">{x.kind === 'words' ? t('Words') : x.label}</span>
              <span dir="auto" className="min-w-0 truncate text-zinc-400">· {nameOf(st, x)}</span>
              {isChanged(st, x) && <span className="size-1.5 shrink-0 rounded-full bg-proto-primary" />}
            </button>
          ))}
        </div>
      )}
      <div onPointerLeave={() => { if (pv?.key === f.key) options.preview(st, null) }}>
        {words
          ? <div className="flex flex-col gap-0.5">{tiles}</div>
          : n > 4 && !big
            ? <div className="max-w-[332px]"><Strip pick={Math.max(0, now)}>{tiles}</Strip></div>
            : big && n > 4
              ? <Strip pick={Math.max(0, now)} big>{f.options.map((_, i) => <div key={i} className="w-[88px] shrink-0 snap-start">{tiles[i]}</div>)}</Strip>
              : <div className={big ? 'grid gap-1.5' : 'flex gap-1'} style={big ? { gridTemplateColumns: `repeat(${Math.max(3, n)}, minmax(0,1fr))` } : undefined}>{tiles}</div>}
      </div>
      {spot.els.length > 1 && <p className="px-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">{tn(spot.els.length, 'Changes all {n} of them together', 'Changes all {n} of them together')}</p>}
      <div className={`flex items-center gap-1 border-t border-black/[.06] pt-1.5 dark:border-white/[.08] ${big ? '-mx-1' : '-mx-0.5'}`}>
        {more
          ? <span data-option-asking="more" className={`flex min-w-0 flex-1 items-center gap-1.5 px-2 text-zinc-500 ${h}`}><Icon name="spinner" className="size-3.5 shrink-0 animate-spin text-proto-primary" /><span className="truncate"><AgentSays say={a => t('{agent} is adding options', { agent: a })} /></span></span>
          : <button type="button" data-option-more="" disabled={phase === 'sent' || s.sending} onClick={() => void optAct.ask('more', { spot, facet: f })}
              className={`flex items-center gap-1.5 rounded-full px-2.5 font-medium text-zinc-600 hover:bg-zinc-900/5 disabled:opacity-40 dark:text-zinc-300 dark:hover:bg-white/10 ${h}`}>
              <Icon name="sparkle" className="size-3.5 text-proto-primary" />{t('More options')}
            </button>}
        {!more && <span className="flex-1" />}
        {promoting
          ? <span className={`flex shrink-0 items-center gap-1.5 px-2 text-amber-700 dark:text-amber-300 ${h}`}><Icon name="spinner" className="size-3.5 animate-spin" />{t('Building')}</span>
          : promoted
            ? <span data-option-promoted="" className={`flex shrink-0 items-center gap-1.5 px-2 font-medium text-emerald-700 dark:text-emerald-300 ${h}`}><Icon name="check" className="size-3.5" />{t('In the tree')}</span>
            : <button type="button" data-option-promote="" disabled={phase === 'sent' || s.sending} onClick={() => void optAct.ask('promote', { spot, facet: f })} title={t('A full variant for each option, in a prototype inside this variant')}
                className={`flex shrink-0 items-center gap-1.5 rounded-full px-2.5 font-medium text-zinc-600 hover:bg-zinc-900/5 disabled:opacity-40 dark:text-zinc-300 dark:hover:bg-white/10 ${h}`}>
                <Icon name="stack" className="size-3.5" />{t('To prototype')}
              </button>}
        <HoldOriginal big={big} />
      </div>
    </div>
  )
}
function AgentSays({ say }: { say: (agent: string) => string }) {
  const agent = useAgentName()
  return <>{say(agent)}</>
}

const KINDS = ['Color', 'Size', 'Weight', 'Words'] as const
/** For an element with no options yet: which kinds to try, then wait for the agent's. */
export function AskBody({ el, big }: { el: HTMLElement; big?: boolean }) {
  const { optAct, optStore } = useCtx()
  const s = useOptState(optStore)
  const [kinds, setKinds] = useState<string[]>(['Color'])
  const name = (k: string) => k === 'Color' ? t('Color') : k === 'Size' ? t('Size') : k === 'Weight' ? t('Weight') : t('Words')
  return (
    <div className="flex flex-col gap-2">
      <p className={`text-zinc-500 dark:text-zinc-400 ${big ? 'text-[14px]' : 'text-[12px]'}`}>{t('This element has no options yet. What should change?')}</p>
      <div className="flex flex-wrap gap-1">
        {KINDS.map(k => (
          <button key={k} type="button" data-option-kind={k} aria-pressed={kinds.includes(k)} onClick={() => setKinds(x => x.includes(k) ? x.filter(y => y !== k) : [...x, k])}
            className={`rounded-full px-3 font-medium ${big ? 'h-10 text-[14px]' : 'h-7 text-[12px]'} ${kinds.includes(k) ? 'bg-proto-primary-soft text-proto-primary-soft-fg ring-1 ring-proto-primary/40' : 'bg-zinc-900/[.05] text-zinc-600 dark:bg-white/[.07] dark:text-zinc-300'}`}>{name(k)}</button>
        ))}
      </div>
      <button type="button" data-option-ask="" disabled={!kinds.length || s.sending} onClick={() => { void optAct.ask('ask', { el, kinds: kinds.map(k => k.toLowerCase()) }).then(() => optAct.close()) }}
        className={`flex items-center justify-center gap-1.5 rounded-xl font-semibold disabled:opacity-40 ${PRIMARY} ${big ? 'h-11 text-[15px]' : 'h-9 text-[13px]'}`}>
        <Icon name="sparkle" className="size-3.5" /><AgentSays say={a => t('Ask {agent} for options', { agent: a })} />
      </button>
    </div>
  )
}

// ---------- colors read off the design ----------
let paint: CanvasRenderingContext2D | null = null
const alphaOf = (color: string) => {
  paint ??= document.createElement('canvas').getContext('2d', { willReadFrequently: true })
  if (!paint) return 1
  paint.clearRect(0, 0, 1, 1); paint.fillStyle = '#000'; paint.fillStyle = color; paint.fillRect(0, 0, 1, 1)
  return paint.getImageData(0, 0, 1, 1).data[3] / 255
}
/** What is behind an element on the design: the nearest background that isn't see-through. */
export function backdropOf(el: Element | null) {
  for (let e = el?.parentElement ?? null; e; e = e.parentElement) { const bg = styleOf(e).backgroundColor; if (bg !== 'transparent' && alphaOf(bg) > 0.05) return bg }
  return el && (el.ownerDocument.documentElement.classList.contains('dark')) ? '#09090b' : '#ffffff'
}

// ---------- over the stage: the dots, the outline of what is pointed at, the panel ----------
const CARD = 'bg-white text-zinc-900 ring-1 ring-black/[.08] shadow-[0_18px_44px_-14px_rgb(0_0_0/.35)] dark:bg-zinc-900 dark:text-zinc-100 dark:ring-white/10'

export function OptionsLayer() {
  const { host, store, copyStore, optStore, optAct } = useCtx()
  const s = useOptState(optStore)
  const mode = useSyncExternalStore(store.subscribe, () => store.get().mode.kind)
  const copying = useSyncExternalStore(copyStore.subscribe, () => copyStore.get().on)
  const inbox = useSyncExternalStore(store.subscribe, () => store.get().inbox)
  const phase = usePhase()
  const narrow = useNarrow()
  useValues()
  const st = s.stage
  const on = !!st && (mode === 'idle' || mode === 'time') && !copying
  const [marks, setMarks] = useState<Mark[]>([])
  const [hover, setHover] = useState<{ key: string; n: number } | null>(null)
  // The box the open panel and its dot stay on: where the element was when it opened, moved only by a
  // scroll or a resize, never by an option that changes the element's size.
  const pin = useRef<{ key: string; box: Box } | null>(null)
  const moved = useRef(true)

  useEffect(() => { optAct.settle() }, [inbox, optAct])
  useEffect(() => { if (!on && s.open) optAct.close() }, [on]) // eslint-disable-line react-hooks/exhaustive-deps

  // Measured on what can move an element (its design changing, a scroll, a resize), not every frame:
  // the dots are always there.
  useEffect(() => {
    if (!st || !on) { setMarks([]); return }
    const layer = host.layer
    let raf = 0, last = ''
    const measure = () => {
      raf = 0
      const W = layer.clientWidth, H = layer.clientHeight
      const next: Mark[] = []
      for (const sp of spotsOf(st)) sp.els.forEach((el, n) => {
        const box = shapeIn(el, layer)
        if (!el.isConnected || (!box.w && !box.h && !el.dataset.tweak) || !shownOn(box, W, H)) return
        const r = (n2: number) => Math.round(n2 * 2) / 2
        next.push({ key: sp.key, n, box: { x: r(box.x), y: r(box.y), w: r(box.w), h: r(box.h) }, rtl: styleOf(el).direction === 'rtl' })
      })
      const sig = JSON.stringify(next)
      if (sig !== last) { last = sig; setMarks(next) }
    }
    const soon = () => { if (!raf) raf = requestAnimationFrame(measure) }
    const scrolled = () => { moved.current = true; soon() }
    measure()
    const doc = st.ownerDocument, win = doc.defaultView ?? window
    const mo = new MutationObserver(soon)
    mo.observe(st, { subtree: true, childList: true, attributes: true, characterData: true })
    const ro = new ResizeObserver(scrolled)
    ro.observe(st); ro.observe(layer)
    const f = frameOf(st)
    if (f) ro.observe(f)
    doc.addEventListener('scroll', scrolled, true)
    if (doc !== document) document.addEventListener('scroll', scrolled, true)
    win.addEventListener('resize', scrolled)
    if (win !== window) addEventListener('resize', scrolled)
    const offs = [tweaks.subscribe(soon), copy.subscribe(soon)]
    return () => {
      cancelAnimationFrame(raf); mo.disconnect(); ro.disconnect(); offs.forEach(o => o())
      doc.removeEventListener('scroll', scrolled, true); document.removeEventListener('scroll', scrolled, true)
      win.removeEventListener('resize', scrolled); removeEventListener('resize', scrolled)
    }
  }, [st, on, host])

  // Pointing at an element with options outlines it and names it.
  useEffect(() => {
    if (!st || !on || narrow) { setHover(null); return }
    const over = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return
      const m = (e.target as Element | null)?.closest?.<HTMLElement>(MARKED)
      const sp = m && st.contains(m) ? spotsOf(st).find(x => x.els.includes(m)) : null
      setHover(h => sp ? (h?.key === sp.key && h.n === sp.els.indexOf(m!) ? h : { key: sp.key, n: sp.els.indexOf(m!) }) : null)
    }
    const out = () => setHover(null)
    st.addEventListener('pointerover', over)
    st.addEventListener('pointerleave', out)
    return () => { st.removeEventListener('pointerover', over); st.removeEventListener('pointerleave', out) }
  }, [st, on, narrow])

  // Keys while a panel is open or something changed, in the page and in a device view's frame: Esc
  // closes the panel, and \ held shows the original.
  useEffect(() => {
    if (!st || !on) return
    const docs = [...new Set([document, st.ownerDocument])]
    const typing = (e: KeyboardEvent) => !!(e.target as HTMLElement | null)?.closest?.('input, textarea, [contenteditable="true"], [contenteditable=""]')
    const down = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && optStore.get().open) { e.preventDefault(); e.stopImmediatePropagation(); optAct.close(); return }
      if (e.key === '\\' && !e.metaKey && !e.ctrlKey && !e.altKey && !typing(e) && spotsOf(st).some(sp => sp.facets.some(f => isChanged(st, f)))) { e.preventDefault(); options.compare(st, true) }
    }
    const up = (e: KeyboardEvent) => { if (e.key === '\\' && options.comparing() === st) options.compare(st, false) }
    const blur = () => { if (options.comparing() === st) options.compare(st, false) }
    for (const d of docs) { listen(d, 'keydown', down, true); d.addEventListener('keyup', up, true) }
    addEventListener('blur', blur)
    return () => { for (const d of docs) { d.removeEventListener('keydown', down, true); d.removeEventListener('keyup', up, true) }; removeEventListener('blur', blur) }
  }, [st, on, optStore, optAct])

  // A click outside the panel, its dot and its element closes it, in a device view's frame too.
  useEffect(() => {
    if (!s.open || narrow || !st) return
    const out = (e: MouseEvent) => {
      const el = e.target as Element
      if (el.closest?.('[data-options-pop], [data-option-dot], [data-ctx], [data-island]')) return
      const m = el.closest?.<HTMLElement>(MARKED)
      if (m && st.contains(m) && spotsOf(st).some(x => x.key === s.open && x.els.includes(m))) return
      optAct.close()
    }
    const inner = st.ownerDocument !== document ? st.ownerDocument : null
    listen(document, 'pointerdown', out, true)
    inner?.addEventListener('pointerdown', out, true)
    return () => { document.removeEventListener('pointerdown', out, true); inner?.removeEventListener('pointerdown', out, true) }
  }, [s.open, narrow, st, optAct])

  // A panel whose element went away (Claude took the control out, the tab inside the design closed) closes.
  const spots = st && on ? spotsOf(st) : []
  const openSpot = s.open && s.open !== ASK ? spots.find(x => x.key === s.open) ?? null : null
  useEffect(() => { if (s.open && s.open !== ASK && !openSpot && marks.length) optAct.close() }, [s.open, !!openSpot, marks.length]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!st || !on) return null
  const markOf = (key: string, n = 0) => marks.find(m => m.key === key && m.n === n) ?? marks.find(m => m.key === key)
  // Pinned while open.
  const openMark = openSpot ? markOf(openSpot.key) : undefined
  if (!s.open) pin.current = null
  else if (openMark && (!pin.current || pin.current.key !== s.open || moved.current)) { pin.current = { key: s.open, box: openMark.box }; moved.current = false }
  const pinned = s.open && pin.current?.key === s.open ? pin.current.box : undefined
  const askBox = s.open === ASK && s.askEl ? boxIn(s.askEl, host.layer) : undefined
  const sent = phase === 'sent' ? s.rec.sent : undefined
  const sentKeys = new Set(sent?.items.map(i => i.key) ?? [])
  const applied = phase === 'applied' ? s.rec.sent : undefined
  const hoverSpot = hover && hover.key !== s.open ? spots.find(x => x.key === hover.key) : undefined
  const hoverMark = hover && hoverSpot ? markOf(hover.key, hover.n) : undefined
  const optionCount = (sp: Spot) => sp.facets.reduce((n, f) => n + f.options.length, 0)
  const asking = s.rec.asks.filter(a => a.kind === 'ask' && !a.seen)
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" data-options-layer="">
      {hoverSpot && hoverMark && (
        <div className="absolute" style={{ left: hoverMark.box.x - 4, top: hoverMark.box.y - 4, width: hoverMark.box.w + 8, height: hoverMark.box.h + 8 }}>
          <div className="absolute inset-0 rounded-[8px] border border-dashed border-proto-primary/50" />
          <span data-option-name="" className={`absolute -top-6 whitespace-nowrap rounded-full bg-zinc-900 px-2 py-0.5 text-[11px] font-medium text-white shadow dark:bg-white dark:text-zinc-900 ${hoverMark.rtl ? 'start-0' : 'end-0'}`} dir="auto">
            {hoverSpot.label} · {tn(optionCount(hoverSpot), '{n} option', '{n} options')}
          </span>
        </div>
      )}
      {openSpot && pinned && (
        <div aria-hidden className="absolute rounded-[8px] ring-[1.5px] ring-proto-primary" style={{ left: pinned.x - 4, top: pinned.y - 4, width: pinned.w + 8, height: pinned.h + 8 }} />
      )}
      {askBox && <div aria-hidden className="absolute rounded-[8px] border-[1.5px] border-dashed border-proto-primary" style={{ left: askBox.x - 4, top: askBox.y - 4, width: askBox.w + 8, height: askBox.h + 8 }} />}
      {s.cover && (() => {
        const k = s.cover.box.w / (s.cover.w || 1)
        return <div aria-hidden data-option-cover="" className="absolute overflow-hidden" style={{ left: s.cover.box.x, top: s.cover.box.y, width: s.cover.box.w, height: s.cover.box.h }}>
          <div className="origin-top-left" style={{ width: s.cover.w, height: s.cover.h, transform: `scale(${k})` }} dangerouslySetInnerHTML={{ __html: s.cover.html }} />
        </div>
      })()}
      {spots.map(sp => {
        const m = sp.key === s.open && pinned ? { ...markOf(sp.key)!, box: pinned } : markOf(sp.key)
        if (!m) return null
        const at = dotAt(m)
        if (sentKeys.has(sp.key)) return <span key={sp.key} data-option-waiting={sp.key} className="absolute grid size-4 place-items-center rounded-full bg-amber-500 text-white shadow-[0_0_0_2px_white] dark:shadow-[0_0_0_2px_#18181b]" style={{ left: at.x - 8, top: at.y - 8 }}><Icon name="spinner" className="size-2.5 animate-spin" /></span>
        return <Dot key={sp.key} spot={sp} at={at} open={s.open === sp.key} hover={hover?.key === sp.key} fresh={s.rec.fresh.includes(sp.key)} phone={narrow}
          onHover={v => setHover(v ? { key: sp.key, n: 0 } : null)} />
      })}
      {/* Sent items whose element no longer has options (the agent is writing them in): found by where they were. */}
      {sent?.items.filter(i => !spots.some(sp => sp.key === i.key) && i.target).map(i => {
        const el = find(st, i.target!)
        if (!el) return null
        const b = boxIn(el, host.layer), at = dotAt({ key: i.key, n: 0, box: b, rtl: styleOf(el).direction === 'rtl' })
        return <span key={`w-${i.facet}`} className="absolute grid size-4 place-items-center rounded-full bg-amber-500 text-white shadow-[0_0_0_2px_white] dark:shadow-[0_0_0_2px_#18181b]" style={{ left: at.x - 8, top: at.y - 8 }}><Icon name="spinner" className="size-2.5 animate-spin" /></span>
      })}
      {applied && applied.items.map(i => {
        const el = i.target ? find(st, i.target) : null
        if (!el) return null
        const b = boxIn(el, host.layer), at = dotAt({ key: i.key, n: 0, box: b, rtl: styleOf(el).direction === 'rtl' })
        return <span key={`a-${i.facet}`} data-option-applied="" className="absolute grid size-4 place-items-center rounded-full bg-emerald-500 text-white shadow-[0_0_0_2px_white] dark:shadow-[0_0_0_2px_#18181b]" style={{ left: at.x - 8, top: at.y - 8 }}><Icon name="check" className="size-2.5" /></span>
      })}
      {asking.map(a => {
        const el = a.target ? find(st, a.target) : null
        if (!el) return null
        const b = boxIn(el, host.layer)
        return <div key={a.batch} data-option-asking="ask" className="absolute" style={{ left: b.x - 4, top: b.y - 4, width: b.w + 8, height: b.h + 8 }}>
          <div className="absolute inset-0 animate-pulse rounded-[8px] border-[1.5px] border-dashed border-proto-primary/70" />
          <span className="absolute -top-6 start-0 flex items-center gap-1 whitespace-nowrap rounded-full bg-proto-primary px-2 py-0.5 text-[11px] font-medium text-white shadow"><Icon name="spinner" className="size-2.5 animate-spin" /><AgentSays say={a => t('{agent} is preparing options', { agent: a })} /></span>
        </div>
      })}
      {!narrow && openSpot && pinned && <Popover spot={openSpot} box={pinned} />}
      {!narrow && s.open === ASK && s.askEl && askBox && <Popover el={s.askEl} box={askBox} />}
    </div>
  )
}

function Dot({ spot, at, open, hover, fresh, phone, onHover }: { spot: Spot; at: { x: number; y: number }; open: boolean; hover: boolean; fresh: boolean; phone: boolean; onHover(on: boolean): void }) {
  const { optStore, optAct } = useCtx()
  const st = optStore.get().stage!
  const changed = spot.facets.some(f => isChanged(st, f))
  const comparing = options.comparing() === st
  const hit = phone ? 34 : 22
  const big = open || hover
  const step = (by: number) => { const f = spot.facets.find(x => x.kind !== 'words') ?? spot.facets[0]; options.step(st, f, by) }
  return (
    <button type="button" data-option-dot={spot.key} aria-expanded={open} aria-haspopup="dialog"
      aria-label={changed ? tn(spot.facets.reduce((n, f) => n + f.options.length, 0), '{label}: {n} option, changed', '{label}: {n} options, changed', { label: spot.label }) : tn(spot.facets.reduce((n, f) => n + f.options.length, 0), '{label}: {n} option', '{label}: {n} options', { label: spot.label })}
      title={`${spot.label} · ${t('Shift-click for the next option')}`}
      onPointerEnter={e => { if (e.pointerType === 'mouse') onHover(true) }} onPointerLeave={e => { if (e.pointerType === 'mouse') onHover(false) }}
      onClick={e => { if (e.shiftKey) { step(1); return } if (open) optAct.close(); else optAct.open(spot.key) }}
      onKeyDown={e => {
        const fwd = rtl ? 'ArrowLeft' : 'ArrowRight', back = rtl ? 'ArrowRight' : 'ArrowLeft'
        if (e.key === fwd || e.key === back) { e.preventDefault(); step(e.key === fwd ? 1 : -1) }
      }}
      className="pointer-events-auto absolute z-10 grid place-items-center rounded-full"
      style={{ left: at.x - hit / 2, top: at.y - hit / 2, width: hit, height: hit }}>
      <span className={`block rounded-full transition-[width,height,background-color,box-shadow,opacity] duration-150 ${fresh ? 'animate-[proto-option-pulse_1.6s_ease-in-out_infinite]' : ''} ${comparing
        ? 'size-1.5 bg-transparent opacity-70 shadow-[inset_0_0_0_1.5px_var(--color-proto-primary,#4f46e5)]'
        : changed
          ? `bg-proto-primary shadow-[0_0_0_2px_white,0_0_0_4px_var(--color-proto-primary,#4f46e5)] dark:shadow-[0_0_0_2px_#18181b,0_0_0_4px_var(--color-proto-primary,#6366f1)] ${big ? 'size-3' : 'size-2.5'}`
          : `bg-proto-primary shadow-[0_0_0_2px_white,0_0_0_4px_rgb(99_102_241/.25)] dark:shadow-[0_0_0_2px_#18181b,0_0_0_4px_rgb(129_140_248/.35)] ${big ? 'size-3' : 'size-2'}`}`} />
    </button>
  )
}

/** The panel on a wide page: beside the element, never over it. Below it when there is room above the
 *  island, else above it, else beside it; inside the stage, never hanging past its edge. Where it goes
 *  is decided when it opens, so trying an option that resizes the element never moves it. */
function Popover({ spot, el, box }: { spot?: Spot; el?: HTMLElement; box: Box }) {
  const { host, optAct, optStore } = useCtx()
  const s = useOptState(optStore)
  const ref = useRef<HTMLDivElement>(null)
  const side = useRef<{ key: string; where: 'below' | 'above' | 'end' | 'start' } | null>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const id = spot?.key ?? ASK
  useLayoutEffect(() => {
    const p = ref.current
    if (!p) return
    const W = host.layer.clientWidth, H = host.layer.clientHeight
    const pw = p.offsetWidth, ph = p.offsetHeight, gap = 12, foot = 76
    if (!side.current || side.current.key !== id) {
      const below = box.y + box.h + gap + ph <= H - foot, above = box.y - gap - ph >= 8
      const endRoom = rtl ? box.x - gap - pw >= 8 : box.x + box.w + gap + pw <= W - 8
      const startRoom = rtl ? box.x + box.w + gap + pw <= W - 8 : box.x - gap - pw >= 8
      const tall = box.h > 160
      side.current = { key: id, where: tall && endRoom ? 'end' : tall && startRoom ? 'start' : below ? 'below' : above ? 'above' : endRoom ? 'end' : startRoom ? 'start' : box.y + box.h / 2 < H / 2 ? 'below' : 'above' }
    }
    const w = side.current.where
    const clampX = (x: number) => Math.max(8, Math.min(W - pw - 8, x))
    const clampY = (y: number) => Math.max(8, Math.min(H - ph - 8, y))
    const right = (w === 'end') !== rtl
    const next = w === 'below' ? { left: clampX(box.x + box.w / 2 - pw / 2), top: clampY(box.y + box.h + gap) }
      : w === 'above' ? { left: clampX(box.x + box.w / 2 - pw / 2), top: clampY(box.y - gap - ph) }
      : { left: clampX(right ? box.x + box.w + gap : box.x - gap - pw), top: clampY(box.y) }
    setPos(was => was && Math.abs(was.left - next.left) < 0.5 && Math.abs(was.top - next.top) < 0.5 ? was : next)
  })
  useEffect(() => { ref.current?.focus({ preventScroll: true }) }, [id])
  const st = s.stage!
  const f = spot ? spot.facets[Math.min(s.tab, spot.facets.length - 1)] : undefined
  const onKey = (e: RKeyboardEvent) => {
    const tiles = [...ref.current?.querySelectorAll<HTMLButtonElement>('[data-option-tile]') ?? []]
    if (!tiles.length || !f) return
    const vertical = f.kind === 'words'
    const fwd = vertical ? 'ArrowDown' : rtl ? 'ArrowLeft' : 'ArrowRight', back = vertical ? 'ArrowUp' : rtl ? 'ArrowRight' : 'ArrowLeft'
    if (e.key !== fwd && e.key !== back) return
    e.preventDefault()
    const cur = tiles.indexOf(document.activeElement as HTMLButtonElement)
    const from = cur >= 0 ? cur : Math.max(0, chosen(st, f))
    const next = tiles[(from + (e.key === fwd ? 1 : -1) + tiles.length) % tiles.length]
    next.focus()
    next.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }
  const nOpts = f ? f.options.length : 0
  return (
    <div ref={ref} data-options-pop="" tabIndex={-1} role="dialog" aria-label={spot ? spot.label : t('Ask for options')} onKeyDown={onKey}
      style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, minWidth: 248, ...(pos ? {} : { opacity: 0 }) } as CSSProperties}
      className={`pointer-events-auto absolute z-20 max-w-[calc(100%-1rem)] rounded-[20px] p-2 text-[13px] outline-none transition-opacity duration-150 starting:opacity-0 ${CARD}`}>
      <div className="flex items-center gap-1.5 pb-2 ps-1.5">
        <span dir="auto" className="min-w-0 truncate font-semibold">{spot ? spot.label : t('Options for this element')}</span>
        {spot && <span className="shrink-0 text-[12px] text-zinc-400">· {spot.facets.length > 1 ? tn(spot.facets.length, '{n} property', '{n} properties') : tn(nOpts, '{n} option', '{n} options')}</span>}
        <button type="button" aria-label={t('Close')} title={`${t('Close')} · Esc`} onClick={() => optAct.close()} className={`${IB} -my-1 ms-auto !h-8 !min-w-8 rounded-full`}><Icon name="x" className="size-3.5" /></button>
      </div>
      {spot ? <OptionsBody spot={spot} /> : el ? <AskBody el={el} /> : null}
      {spot && <div className="px-1.5 pt-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">{t('Arrows to move · Enter to keep · Esc to close')}</div>}
      {s.error && <p role="alert" className="mt-1.5 rounded-lg bg-rose-500/10 px-2.5 py-1.5 text-xs text-rose-700 dark:text-rose-300">{s.error}</p>}
    </div>
  )
}

// ---------- the panel on a phone: a sheet over the stage ----------
const DRAWER = 'pointer-events-auto w-full rounded-t-3xl bg-white pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] pt-2 text-[13px] text-zinc-900 shadow-2xl shadow-black/20 outline-none ring-1 ring-black/[.06] [transform:translateY(var(--drawer-swipe-movement-y))] transition-transform duration-[450ms] ease-[cubic-bezier(0.32,0.72,0,1)] data-swiping:select-none data-ending-style:[transform:translateY(100%)] data-starting-style:[transform:translateY(100%)] data-ending-style:duration-[calc(var(--drawer-swipe-strength)*400ms)] dark:bg-zinc-900 dark:text-zinc-100 dark:ring-white/10'

export function OptionsSheet({ container }: { container: HTMLElement }) {
  const { optStore, optAct } = useCtx()
  const s = useOptState(optStore)
  const narrow = useNarrow()
  useValues()
  const sheet = useRef<HTMLDivElement>(null)
  // Kept while the sheet slides away.
  const [shown, setShown] = useState<{ key: string; el: HTMLElement | null } | null>(null)
  const spot = s.stage && s.open && s.open !== ASK ? spotsOf(s.stage).find(x => x.key === s.open) ?? null : null
  const open = narrow && !!s.stage && (!!spot || (s.open === ASK && !!s.askEl))
  useEffect(() => { if (open) setShown({ key: s.open!, el: s.askEl }) }, [open, s.open, s.askEl])
  const el = spot?.els[0] ?? (s.open === ASK ? s.askEl : null)
  // The design moves up with the sheet until the element sits above it, and back down when it closes.
  useEffect(() => {
    const layer = s.stage?.closest<HTMLElement>('[data-layers] > *')
    if (!layer) return
    if (!open || !el) { layer.style.transform = ''; return }
    const f = requestAnimationFrame(() => {
      const top = container.getBoundingClientRect().bottom - (sheet.current?.offsetHeight ?? 0)
      const r = drawn(el, el.getBoundingClientRect())
      const by = Math.max(0, r.bottom + 24 - top)
      layer.style.transition = 'transform 450ms cubic-bezier(0.32, 0.72, 0, 1)'
      layer.style.transform = by ? `translateY(${-Math.round(by)}px)` : ''
    })
    return () => cancelAnimationFrame(f)
  }, [open, el, s.stage, container, s.tab])
  useEffect(() => () => { const layer = s.stage?.closest<HTMLElement>('[data-layers] > *'); if (layer) layer.style.transform = '' }, [s.stage])
  const keep = spot ?? (shown && s.stage ? spotsOf(s.stage).find(x => x.key === shown.key) ?? null : null)
  const askEl = s.open === ASK ? s.askEl : shown?.key === ASK ? shown.el : null
  if (!keep && !askEl) return null
  const n = keep ? keep.facets[Math.min(s.tab, keep.facets.length - 1)].options.length : 0
  return (
    <Drawer.Root open={open} onOpenChange={o => { if (!o) optAct.close() }} modal={false} disablePointerDismissal>
      <Drawer.Portal container={container}>
        <Drawer.Viewport className="pointer-events-none absolute inset-0 flex items-end">
          <Drawer.Popup ref={sheet} data-options-sheet="" initialFocus={false} finalFocus={false} className={DRAWER}>
            <div className="mx-auto mb-1 h-1 w-10 rounded-full bg-zinc-300 dark:bg-zinc-700" />
            <Drawer.Content className="px-3">
              <div className="flex items-center gap-1.5 pb-2 ps-1.5">
                <Drawer.Title className="min-w-0 truncate text-[15px] font-semibold">{keep ? keep.label : t('Options for this element')}</Drawer.Title>
                {keep && <span className="shrink-0 text-xs text-zinc-400 dark:text-zinc-500">{keep.facets.length > 1 ? tn(keep.facets.length, '{n} property', '{n} properties') : tn(n, '{n} option', '{n} options')}</span>}
                <Drawer.Close aria-label={t('Close')} className="ms-auto grid size-9 place-items-center rounded-full text-zinc-500 active:bg-zinc-900/5 dark:active:bg-white/10"><Icon name="x" /></Drawer.Close>
              </div>
              {keep ? <OptionsBody spot={keep} big /> : askEl ? <AskBody el={askEl} big /> : null}
            </Drawer.Content>
          </Drawer.Popup>
        </Drawer.Viewport>
      </Drawer.Portal>
    </Drawer.Root>
  )
}

// ---------- the changes, in the comments island ----------
/** The small picture of what a changed element now shows: its chosen option, or a dot for words. */
function ChipPic({ spot, big }: { spot: Spot; big?: boolean }) {
  const { optStore } = useCtx()
  const st = optStore.get().stage!
  const f = spot.facets.find(x => isChanged(st, x) && x.kind !== 'words')
  const el = spot.els[0]
  const pic = f && el ? pictureOf(keyOf(st, spot, f, el), chosen(st, f)) : undefined
  const sz = big ? 28 : 20
  return (
    <span className={`grid shrink-0 place-items-center overflow-hidden rounded-full ring-1 ring-black/[.08] dark:ring-white/10 ${big ? 'size-7' : 'size-5'}`} style={{ background: el ? backdropOf(el) : undefined }}>
      {f?.kind === 'color' && typeof choiceOf(st, f) === 'string'
        ? <span className="size-3 rounded-full" style={{ background: choiceOf(st, f) as string }} />
        : still(pic) && !pic.text ? <Pic pic={pic} w={sz + 6} k={fitOf([pic], sz + 6, sz + 4)} />
        : <span className="size-1.5 rounded-full bg-proto-primary" />}
    </span>
  )
}

/** Whether the tray has anything to show, for the island's width. */
export function useOptionsTray() {
  const { optStore, optAct } = useCtx()
  useOptState(optStore)
  useValues()
  const phase = usePhase()
  return !!optStore.get().stage && (optAct.pending().length > 0 || phase !== 'idle' || optStore.get().rec.asks.some(a => !a.seen))
}

export function OptionsTray({ phone = false }: { phone?: boolean }) {
  const { optStore, optAct } = useCtx()
  const s = useOptState(optStore)
  useValues()
  const agent = useAgentName()
  const phase = usePhase()
  const st = s.stage
  if (!st) return null
  const pending = optAct.pending()
  const asks = s.rec.asks.filter(a => !a.seen)
  if (!pending.length && phase === 'idle' && !asks.length) return null
  const spots = spotsOf(st)
  const changedSpots = spots.filter(sp => pending.some(p => p.spot.key === sp.key))
  const h = phone ? 'h-9 text-[13px]' : 'h-7 text-[12px]'
  const row = `flex items-center gap-1 px-2 ${phone ? 'overflow-x-auto py-2 [scrollbar-width:none]' : 'flex-wrap py-1.5'}`
  return (
    <div data-options-tray="" className="border-b border-black/[.06] dark:border-white/[.08]">
      {phase === 'sent' && s.rec.sent && (
        <div className={row}>
          <span className={`shrink-0 px-1 font-medium text-zinc-500 ${phone ? 'text-[13px]' : 'text-[11px]'}`}>{t('Sent:')}</span>
          {s.rec.sent.items.map(i => (
            <span key={i.facet} className={`flex shrink-0 items-center gap-1.5 rounded-full bg-zinc-900/[.05] pe-2.5 ps-1 opacity-80 dark:bg-white/[.07] ${h}`}>
              <span className={`grid shrink-0 place-items-center rounded-full ring-1 ring-black/[.08] dark:ring-white/10 ${phone ? 'size-7' : 'size-5'}`}><Icon name="spinner" className="size-3 animate-spin text-amber-600" /></span>
              <span dir="auto" className="text-zinc-500">{i.label}</span><span dir="auto" className="font-medium">{i.choice}</span>
            </span>
          ))}
          <span data-options-sending="" className={`ms-auto flex shrink-0 items-center gap-1.5 rounded-full bg-amber-500/10 px-3 font-medium text-amber-700 dark:text-amber-300 ${h}`}>
            <Icon name="spinner" className="size-3.5 animate-spin" />{s.rec.sent.undo ? t('{agent} is putting them back', { agent }) : t('{agent} is setting your choices', { agent })}
          </span>
        </div>
      )}
      {phase === 'applied' && !pending.length && s.rec.sent && (
        <div className={`flex items-center gap-1.5 px-3 text-emerald-700 dark:text-emerald-300 ${phone ? 'py-2 text-[13px]' : 'py-1.5 text-[12px]'}`}>
          <Icon name="check" className="size-3.5 shrink-0" />
          <span className="shrink-0 font-medium">{s.rec.sent.undo ? t('Put back:') : t('Set in the design:')}</span>
          <span dir="auto" className="min-w-0 flex-1 truncate text-zinc-600 dark:text-zinc-300">{[...new Set(s.rec.sent.items.map(i => i.label))].join(' · ')}</span>
          {!s.rec.sent.undo && <button type="button" data-options-undo="" disabled={s.sending} onClick={() => void optAct.undo()} title={t('Ask {agent} to put them back', { agent })} className="shrink-0 rounded-full px-2 py-1 font-medium text-zinc-600 hover:bg-black/5 dark:text-zinc-300 dark:hover:bg-white/10">{t('Undo')}</button>}
          <button type="button" data-options-dismiss="" aria-label={t('Close')} onClick={optAct.dismiss} className="grid size-6 shrink-0 place-items-center rounded-full text-zinc-500 hover:bg-black/5 dark:hover:bg-white/10"><Icon name="x" className="size-3" /></button>
        </div>
      )}
      {asks.length > 0 && (
        <div className={`flex items-center gap-1.5 px-3 text-zinc-500 dark:text-zinc-400 ${phone ? 'py-2 text-[13px]' : 'py-1.5 text-[12px]'}`}>
          <Icon name="spinner" className="size-3.5 shrink-0 animate-spin text-proto-primary" />
          <span dir="auto" className="min-w-0 truncate">{asks.map(a => a.kind === 'more' ? t('More options for {label}', { label: a.label }) : a.kind === 'promote' ? t('A prototype of {label}', { label: a.label }) : t('Options for {label}', { label: a.label })).join(' · ')}</span>
        </div>
      )}
      {pending.length > 0 && (
        <div className={row}>
          <span className={`shrink-0 px-1 font-medium text-zinc-500 ${phone ? 'text-[13px]' : 'text-[11px]'}`}>{tn(changedSpots.length, '{n} change:', '{n} changes:')}</span>
          {changedSpots.map(sp => (
            <button key={sp.key} type="button" data-options-chip={sp.key} onClick={() => optAct.open(sp.key, Math.max(0, sp.facets.findIndex(f => isChanged(st, f))))}
              className={`flex shrink-0 items-center gap-1.5 rounded-full bg-zinc-900/[.05] pe-2.5 ps-1 hover:bg-zinc-900/[.09] dark:bg-white/[.07] dark:hover:bg-white/[.12] ${h}`}>
              <ChipPic spot={sp} big={phone} />
              <span dir="auto" className="text-zinc-500 dark:text-zinc-400">{sp.label}</span>
              <span dir="auto" className="font-medium">{sp.facets.filter(f => isChanged(st, f)).map(f => nameOf(st, f)).join(' · ')}</span>
            </button>
          ))}
          <span className="ms-auto flex shrink-0 items-center gap-1">
            <HoldOriginal compact={!phone} big={phone} />
            <button type="button" data-options-send="" disabled={s.sending} onClick={() => void optAct.send()}
              className={`flex items-center gap-1.5 rounded-full px-3 font-semibold disabled:opacity-60 ${PRIMARY} ${phone ? 'h-10 text-[14px]' : 'h-8 text-[12px]'}`}>
              <Icon name="send" className="size-3.5" />{s.sending ? t('Sending…') : tn(pending.length, 'Send {n} choice', 'Send {n} choices')}
            </button>
          </span>
        </div>
      )}
      {s.error && !s.open && <p role="alert" className="mx-2 mb-1.5 rounded-lg bg-rose-500/10 px-2.5 py-1.5 text-xs text-rose-700 dark:text-rose-300">{s.error}</p>}
    </div>
  )
}

/** For the shell: ids an element carries, to tell whether a right-clicked element already has options. */
export const markedIds = idsOf
