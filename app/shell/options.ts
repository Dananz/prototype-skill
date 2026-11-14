// Options on the design: the elements a variant offers a few values for, right where they are. An
// element is marked `data-tweak="<id>"` (a useTweaks select, a color with presets, or a toggle read as
// shown or hidden) and/or `data-copy="<id>"` (a useCopy line: its words). Several ids on one element
// (space-separated in data-tweak, or both attributes) are its facets, shown as tabs; several elements
// with the same ids are one spot that repeats (a label in every row), changed together.
//
// The values stay the design's own (shell/tweaks.ts, shell/copy.ts): choosing sets them. Everything
// shown "for now" (pointing at an option, holding to see the original, drawing a tile's picture) goes
// through this one owner, in that order of precedence: drawing, then the original, then the pointed
// option, then the choice. While anything is shown for now, a tweak's choice is kept here and put back
// after, so nothing reads a value shown for now as the choice.
import { copy } from './copy'
import { notify, shared } from './shared'
import { t } from './i18n'
import { tweaks, type Tweak } from './tweaks'

export type Value = string | boolean
export type Option = { name: string; value: Value }
export type Facet = {
  /** `tweak:<id>` or `copy:<id>`. */
  key: string
  id: string
  from: 'tweak' | 'copy'
  kind: 'words' | 'select' | 'color' | 'toggle'
  label: string
  options: Option[]
  /** The option the design has as written: a tweak's default, a line's first words. */
  today: number
}
/** One element with options (or several alike). `key` is its facets' keys, in order. */
export type Spot = { key: string; label: string; facets: Facet[]; els: HTMLElement[] }

export const MARKED = '[data-tweak], [data-copy]'
const HEX = /^#[0-9a-f]{6}$/i
export const same = (a: Value | undefined, b: Value | undefined) => typeof a === 'string' && typeof b === 'string' ? a.toLowerCase() === b.toLowerCase() : a === b

function tweakFacet(tw: Tweak): Facet | null {
  let options: Option[]
  if (tw.kind === 'select') options = tw.options.map(o => ({ name: o, value: o }))
  else if (tw.kind === 'color') options = (tw.presets ?? []).filter(p => HEX.test(p.value)).map(p => ({ name: p.name, value: p.value }))
  else options = [{ name: t('Shown'), value: true }, { name: t('Hidden'), value: false }]
  if (tw.kind !== 'toggle' && options.length && !options.some(o => same(o.value, tw.defaultValue))) options = [{ name: String(tw.defaultValue), value: tw.defaultValue }, ...options]
  if (options.length < 2) return null
  return { key: `tweak:${tw.id}`, id: tw.id, from: 'tweak', kind: tw.kind, label: tw.label, options, today: options.findIndex(o => same(o.value, tw.defaultValue)) }
}

/** The ids an element carries: its line of copy, then its tweaks. */
export function idsOf(el: HTMLElement) {
  return [...(el.dataset.copy ? [`copy:${el.dataset.copy}`] : []), ...(el.dataset.tweak ?? '').split(/\s+/).filter(Boolean).map(id => `tweak:${id}`)]
}

/** Every spot of the design in host, in the order its elements come. */
export function spotsOf(host: Element | null | undefined): Spot[] {
  if (!host) return []
  const tw = new Map(tweaks.of(host).map(x => [x.id, x]))
  const lines = new Map(copy.of(host).map(l => [l.id, l]))
  const facets = new Map<string, Facet | null>()
  const facet = (k: string) => {
    if (facets.has(k)) return facets.get(k)!
    const id = k.slice(k.indexOf(':') + 1)
    let f: Facet | null = null
    if (k.startsWith('copy:')) { const l = lines.get(id); f = l && l.options.length > 1 ? { key: k, id, from: 'copy', kind: 'words', label: l.label, options: l.options.map(o => ({ name: o, value: o })), today: 0 } : null }
    else { const x = tw.get(id); f = x ? tweakFacet(x) : null }
    facets.set(k, f)
    return f
  }
  const out = new Map<string, Spot>()
  for (const el of host.querySelectorAll<HTMLElement>(MARKED)) {
    if (el.closest('[aria-hidden="true"]')) continue
    const fs = idsOf(el).map(facet).filter((f): f is Facet => !!f)
    if (!fs.length) continue
    const key = fs.map(f => f.key).join(' ')
    const s = out.get(key)
    if (s) { s.els.push(el); continue }
    const words = fs.find(f => f.from === 'copy')
    out.set(key, { key, label: fs.length > 1 && words ? words.label : fs[0].label, facets: fs, els: [el] })
  }
  return [...out.values()]
}
export const spotOf = (host: Element | null | undefined, key: string) => spotsOf(host).find(s => s.key === key) ?? null
/** The spot an element of the design belongs to: its own, or the nearest marked one around it. */
export function spotAt(host: Element | null | undefined, el: Element | null): Spot | null {
  const m = el?.closest<HTMLElement>(MARKED)
  if (!host || !m || !host.contains(m)) return null
  return spotsOf(host).find(s => s.els.includes(m)) ?? null
}

// ---------- what each facet shows ----------
// A choice put back after something showed for now reaches the control's value only once the
// design renders again: until then the control still reports what showed, so it is read from here.
// (For a second at most: a value set elsewhere after that is the design's own.)
const settling = new WeakMap<Element, Map<string, { v: Value; at: number }>>()
function live(host: Element, f: Facet): Value | undefined {
  if (f.from === 'copy') return copy.choiceOf(host, f.id)?.text ?? String(f.options[0].value)
  const v = tweaks.of(host).find(x => x.id === f.id)?.value, s = settling.get(host)
  const w = s?.get(f.key)
  if (w) { if (same(v, w.v) || performance.now() - w.at > 1000) s!.delete(f.key); else return w.v }
  return v
}
const settle = (host: Element, key: string, v: Value) => { let s = settling.get(host); if (!s) settling.set(host, s = new Map()); s.set(key, { v, at: performance.now() }) }

type Over = { host: Element; key: string; index: number }
const state = shared('options', () => ({
  previewed: null as Over | null,
  drawing: null as Over | null,
  comparing: null as Element | null,
  /** A tweak's choice while another value shows for now. */
  kept: new WeakMap<Element, Map<string, Value>>(),
  subs: new Set<() => void>(),
}))

/** The value chosen for a facet: never one shown for now. */
export function choiceOf(host: Element, f: Facet): Value | undefined {
  if (f.from === 'tweak') { const k = state.kept.get(host); if (k?.has(f.key)) return k.get(f.key) }
  return live(host, f)
}
export const indexOf = (f: Facet, v: Value | undefined) => f.options.findIndex(o => same(o.value, v))
/** The chosen option's number (-1 when the value is none of them, set elsewhere). */
export const chosen = (host: Element, f: Facet) => indexOf(f, choiceOf(host, f))
export const isChanged = (host: Element, f: Facet) => !same(choiceOf(host, f), f.options[f.today]?.value)
/** The name of what a facet reads now. */
export const nameOf = (host: Element, f: Facet) => { const i = chosen(host, f); return i >= 0 ? f.options[i].name : String(choiceOf(host, f) ?? '') }

function wanted(host: Element, f: Facet): Value | null {
  const { drawing, comparing, previewed } = state
  if (drawing && drawing.host === host && drawing.key === f.key) return f.options[drawing.index]?.value ?? null
  if (comparing === host && isChanged(host, f)) return f.options[f.today].value
  if (previewed && previewed.host === host && previewed.key === f.key) return f.options[previewed.index]?.value ?? null
  return null
}
// The last value this module set per facet: pointing at an option and away before the design has
// rendered leaves the control still reporting the old value, so a put that only compared with it would
// skip putting the choice back.
const lastPut = new WeakMap<Element, Map<string, Value>>()
const put = (host: Element, id: string, v: Value) => {
  const x = tweaks.of(host).find(y => y.id === id)
  if (!x) return
  let m = lastPut.get(host)
  if (!m) lastPut.set(host, m = new Map())
  const was = m.get(id)
  m.set(id, v)
  if (!same(x.value, v) || (was !== undefined && !same(was, v))) (x.set as (v: Value) => void)(v)
}

/** Shows on the design what should show now for every facet of host. */
function sync(host: Element) {
  const all = new Map<string, Facet>()
  for (const s of spotsOf(host)) for (const f of s.facets) all.set(f.key, f)
  const kept = state.kept.get(host)
  // A facet shown for now whose element went (a hot reload): its choice goes back all the same.
  for (const [key, v] of kept ?? []) if (!all.has(key)) { kept!.delete(key); settle(host, key, v); put(host, key.slice(6), v) }
  for (const f of all.values()) {
    const w = wanted(host, f)
    if (f.from === 'copy') { copy.hold(host, f.id, w === null ? null : String(w)); continue }
    if (w === null) {
      if (kept?.has(f.key)) { const v = kept.get(f.key)!; kept.delete(f.key); settle(host, f.key, v); put(host, f.id, v) }
      continue
    }
    let k = state.kept.get(host)
    if (!k) state.kept.set(host, k = new Map())
    if (!k.has(f.key)) { const v = live(host, f); if (v !== undefined) k.set(f.key, v) }
    put(host, f.id, w)
  }
  notify(state.subs)
}

export const options = {
  subscribe(f: () => void) { state.subs.add(f); return () => { state.subs.delete(f) } },
  /** Point at an option (it shows on the design), or stop (null). */
  preview(host: Element, f: Facet | null, index = 0) {
    const was = state.previewed
    if (f ? was?.host === host && was.key === f.key && was.index === index : !was) return
    state.previewed = f ? { host, key: f.key, index } : null
    if (was && was.host !== host) sync(was.host)
    sync(host)
  },
  previewed: () => state.previewed,
  /** Hold to see the original: every changed facet shows today's value until let go. */
  compare(host: Element | null, on: boolean) {
    const was = state.comparing
    state.comparing = on ? host : null
    if (was && was !== state.comparing) sync(was)
    if (state.comparing) sync(state.comparing)
    if (!on && !was) notify(state.subs)
  },
  comparing: () => state.comparing,
  /** Show one option for a moment, to draw its picture (null: done). */
  draw(host: Element, f: Facet | null, index = 0) {
    state.drawing = f ? { host, key: f.key, index } : null
    sync(host)
  },
  /** Whether the design has caught up with what draw asked for (a tweak's control reports it). */
  shows(host: Element, f: Facet, index: number) {
    if (f.from === 'copy') return true
    return same(tweaks.of(host).find(x => x.id === f.id)?.value, f.options[index]?.value)
  },
  /** Choose an option for a facet (today's to put it back). */
  choose(host: Element, f: Facet, index: number) {
    const o = f.options[index]
    if (!o) return
    if (f.from === 'copy') copy.choose(host, f.id, index === 0 ? null : { text: String(o.value) })
    else {
      const k = state.kept.get(host)
      if (k?.has(f.key)) k.set(f.key, o.value)
      else { settle(host, f.key, o.value); put(host, f.id, o.value) }
    }
    sync(host)
  },
  /** The next (or previous) option of a facet, wrapping. */
  step(host: Element, f: Facet, by: number) {
    const n = f.options.length, i = chosen(host, f)
    options.choose(host, f, ((i < 0 ? f.today : i) + by + n) % n)
  },
  /** Stop showing anything for now on host (the panel closed, the page moved). */
  release(host: Element | null) {
    if (!host) return
    if (state.previewed?.host === host) state.previewed = null
    if (state.drawing?.host === host) state.drawing = null
    if (state.comparing === host) state.comparing = null
    sync(host)
  },
}
