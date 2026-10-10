// The copy picker: other words for a design's lines, tried in place. Only a design that declares
// copy options (useCopy, shell/copy.ts) gets any of it. At rest the design is clean, and one T
// button waits in the page's bar beside Comment (the pill on a phone, the dock in focus mode).
// Pressing it turns copy mode on: each line with options gets a dotted underline and a count after
// its words, and a slim bar slides in under the stage. Clicking a line lists its options under it
// (a sheet on a phone); pointing at one shows it in place, a click or a tap puts it there and
// closes the list, and one tap undoes it. The last row is the user's own words. Send posts every
// changed line to Claude as one batch through the comments inbox, each a comment with action copy
// on the line's element; Claude's reply shows in the bar. T or Esc closes copy mode, and the
// choices stay: they are the page's (shell/copy.ts), kept by their words across reloads.
import { Component, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent, type PointerEvent as RPointerEvent, type ReactNode } from 'react'
import { Drawer } from '@base-ui/react/drawer'
import { copy, type Choice, type CopyLine } from '../copy'
import { useCtx, type Host } from './ctx'
import { describe } from './dom'
import { useStore, type Store } from './store'
import { IB, Icon, Listening, PRIMARY, Reply } from './ui'

/** What was sent from one variant: its batch, and the words each line went with. */
type Sent = { batch: string; texts: Record<string, string> }
export type CopyState = {
  /** The design on the stage and its variant ("today/C"); null in a lobby or a tool. */
  stage: HTMLElement | null
  route: string
  on: boolean
  /** Turn copy mode on as soon as the design on the stage declares lines (?copy=1, for proto shoot). */
  wanted: boolean
  /** For a shot (?copy=1): a change shows at once, without its flash. */
  still: boolean
  /** The line whose options are listed. */
  open: string | null
  /** The phone sheet's line, kept while the sheet slides away. */
  sheet: string | null
  flash: { id: string; n: number } | null
  /** The last change, so one tap puts it back. */
  was: { id: string; choice: Choice | null } | null
  sent: Record<string, Sent>
  sending: boolean
  error: string
}

export function createCopyStore() {
  let state: CopyState = { stage: null, route: '', on: false, wanted: false, still: false, open: null, sheet: null, flash: null, was: null, sent: {}, sending: false, error: '' }
  const listeners = new Set<() => void>()
  return {
    get: () => state,
    set(patch: Partial<CopyState> | ((s: CopyState) => Partial<CopyState>)) {
      state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }
      listeners.forEach(l => l())
    },
    subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l) } },
  }
}
export type CopyStore = ReturnType<typeof createCopyStore>

/** What the copy picker can do, for its own parts and for the shell (the T buttons, Esc, the stage). */
export function createCopyActions(cs: CopyStore, host: Host, comments: Store, stopPicking: () => void) {
  const get = cs.get, set = cs.set
  const lines = () => copy.of(get().stage)
  const unpeek = () => { const s = get().stage; if (s) copy.peek(s, '', null) }
  const act = {
    lines,
    /** The lines that read other than today. */
    changed: () => copy.changed(get().stage),
    /** What Send posts: each line whose words differ from those it was last sent with (from today's,
     *  if it was never sent). A line put back to today's words after a send goes too, with no choice. */
    pending: () => {
      const s = get(), went = s.sent[s.route]?.texts ?? {}
      return lines().flatMap(line => {
        const choice = copy.choiceOf(s.stage, line.id), text = choice?.text ?? line.options[0]
        return (went[line.id] ?? line.options[0]) === text ? [] : [{ line, choice, text }]
      })
    },
    /** The page moved, or redrew: the design on the stage now. Copy mode stays on through a remount of
     *  the same variant (a hot reload that renamed its component); anywhere else it starts closed. */
    setStage(stage: HTMLElement | null, route: string) {
      const s = get()
      if (stage !== s.stage) {
        unpeek()
        const same = !!stage && route === s.route
        set({ stage, route, open: null, ...(same ? {} : { on: false, was: null, error: '' }) })
      }
      if (get().wanted && stage && copy.of(stage).length) set({ on: true, wanted: false })
    },
    want() { set({ wanted: true, still: true }) },
    toggle() {
      const s = get()
      if (!s.on && !lines().length) return
      unpeek()
      // Closed once Claude is done with what was sent: the bar starts over the next time.
      const sent = s.sent[s.route], done = !!sent && comments.get().inbox?.batches.find(b => b.id === sent.batch)?.state === 'done'
      const { [s.route]: _, ...rest } = s.sent
      set({ on: !s.on, open: null, error: '', ...(s.on && done ? { sent: rest } : {}) })
      if (!s.on) stopPicking()
    },
    off() { if (get().on) act.toggle() },
    show(id: string) { unpeek(); set({ open: id, sheet: id }) },
    close() { unpeek(); set({ open: null }) },
    /** Esc: the list first, then copy mode. True when it put something away. */
    escape(): boolean {
      const s = get()
      if (s.open) { act.close(); document.querySelector<HTMLElement>(`[data-copy-mark="${CSS.escape(s.open)}"]`)?.focus({ preventScroll: true }); return true }
      if (s.on) { act.toggle(); return true }
      return false
    },
    choose(id: string, choice: Choice | null) {
      const s = get()
      if (!s.stage) return
      const before = copy.choiceOf(s.stage, id)
      if ((before?.text ?? null) === (choice?.text ?? null) && !!before?.own === !!choice?.own) return
      copy.choose(s.stage, id, choice)
      set(x => ({ was: { id, choice: before }, flash: { id, n: (x.flash?.n ?? 0) + 1 }, error: '' }))
    },
    undo() {
      const s = get()
      if (!s.stage || !s.was) return
      copy.choose(s.stage, s.was.id, s.was.choice)
      set(x => ({ was: null, flash: { id: s.was!.id, n: (x.flash?.n ?? 0) + 1 } }))
    },
    /** Every line changed since the last send, as one batch: a comment per line with action copy, on its element. */
    async send() {
      const s = get(), stage = s.stage
      const list = act.pending()
      if (!stage || !list.length || s.sending) return
      const comments = list.map(({ line, choice, text }) => {
        const el = stage.querySelector<HTMLElement>(`[data-copy="${CSS.escape(line.id)}"]`)
        const which = !choice ? `back to today's words (option 1 of ${line.options.length})` : choice.own ? 'my own words' : `option ${line.options.indexOf(text) + 1} of ${line.options.length}`
        return {
          route: s.route,
          text: `${line.label} (${line.id}): “${text}”, ${which}`,
          action: 'copy' as const,
          ...(el ? { target: describe(stage, el) } : {}),
        }
      })
      set({ sending: true, error: '' })
      try {
        const { id } = await host.send({ theme: host.dark() ? 'dark' : 'light', viewport: { w: innerWidth, h: innerHeight, phone: innerWidth < 640 }, comments })
        const texts = { ...get().sent[s.route]?.texts, ...Object.fromEntries(list.map(c => [c.line.id, c.text])) }
        set(x => ({ sending: false, was: null, sent: { ...x.sent, [s.route]: { batch: id, texts } } }))
      } catch (e) {
        set({ sending: false, error: e instanceof Error ? e.message : 'Could not send' })
      }
    },
    counts() { const s = get(); return { on: s.on, lines: lines().length, changed: act.changed().length } },
  }
  return act
}
export type CopyActions = ReturnType<typeof createCopyActions>

// ---------- reading the design ----------
type Box = { x: number; y: number; w: number; h: number }
type Mark = { key: string; id: string; box: Box & { r: number }; text: boolean; badge: { x: number; y: number; rtl: boolean }; light: boolean; ring: string }

// Colors read back through a canvas, so every CSS color the design uses (oklch, color-mix) is RGB.
let paint: CanvasRenderingContext2D | null = null
const rgba = new Map<string, number[]>()
function rgbaOf(color: string) {
  let c = rgba.get(color)
  if (c) return c
  paint ??= document.createElement('canvas').getContext('2d', { willReadFrequently: true })
  if (!paint) return [0, 0, 0, 1]
  paint.clearRect(0, 0, 1, 1)
  paint.fillStyle = '#000'
  paint.fillStyle = color
  paint.fillRect(0, 0, 1, 1)
  const [r, g, b, a] = paint.getImageData(0, 0, 1, 1).data
  c = [r, g, b, a / 255]
  rgba.set(color, c)
  return c
}
const lightText = (color: string) => { const [r, g, b] = rgbaOf(color); return 0.2126 * r + 0.7152 * g + 0.0722 * b > 150 }
const filled = (color: string) => color !== 'transparent' && rgbaOf(color)[3] > 0.05
/** What is behind an element: the nearest background that isn't see-through. */
function backdropOf(el: Element | null) {
  for (let e = el; e; e = e.parentElement) { const bg = getComputedStyle(e).backgroundColor; if (filled(bg)) return bg }
  return 'transparent'
}

/** The words inside an element: all of them, and the last line's piece (where the count goes). */
function wordsOf(el: HTMLElement) {
  const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, { acceptNode: n => n.textContent?.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT })
  const nodes: Text[] = []
  for (let n = walk.nextNode(); n; n = walk.nextNode()) nodes.push(n as Text)
  if (!nodes.length) return null
  const range = document.createRange()
  range.setStart(nodes[0], 0)
  range.setEnd(nodes.at(-1)!, nodes.at(-1)!.length)
  const all = range.getBoundingClientRect()
  range.selectNodeContents(nodes.at(-1)!)
  const last = [...range.getClientRects()].filter(r => r.width > 0).at(-1)
  return all.width && last ? { all, last } : null
}

/** A line as it sits on the stage: a button-like element (its own background or border) is marked
 *  around its box, a line of text around its words; its count goes 6 px after its last letter. */
function measure(el: HTMLElement, o: DOMRect, key: string): Mark | null {
  const r = el.getBoundingClientRect()
  if (!r.width || !r.height) return null
  const cs = getComputedStyle(el)
  const words = wordsOf(el)
  const boxed = filled(cs.backgroundColor) || parseFloat(cs.borderTopWidth) > 0 || parseFloat(cs.borderBottomWidth) > 0
  const text = !boxed && !!words
  const box = text
    ? { x: words!.all.left - o.left - 8, y: r.top - o.top, w: words!.all.width + 16, h: r.height, r: 8 }
    : { x: r.left - o.left - 4, y: r.top - o.top - 4, w: r.width + 8, h: r.height + 8, r: (parseFloat(cs.borderTopLeftRadius) || 0) + 4 }
  const rtl = cs.direction === 'rtl', end = words?.last ?? r
  const badge = { x: (rtl ? end.left - 6 : end.right + 6) - o.left, y: (end.top + end.bottom) / 2 - o.top, rtl }
  const round = (n: number) => Math.round(n * 2) / 2
  return {
    key, id: el.dataset.copy!, text, light: lightText(cs.color), ring: backdropOf(el),
    box: { x: round(box.x), y: round(box.y), w: round(box.w), h: round(box.h), r: box.r }, badge: { x: round(badge.x), y: round(badge.y), rtl },
  }
}

/** The element that scrolls an element of the design, inside the stage's layer. */
function scrollerOf(el: HTMLElement, stop: Element | null) {
  for (let e = el.parentElement; e && e !== stop; e = e.parentElement) {
    const y = getComputedStyle(e).overflowY
    if ((y === 'auto' || y === 'scroll') && e.scrollHeight > e.clientHeight) return e
  }
  return null
}

const useNarrow = () => useSyncExternalStore(f => { const m = matchMedia('(max-width: 639px)'); m.addEventListener('change', f); return () => m.removeEventListener('change', f) }, () => matchMedia('(max-width: 639px)').matches)
const useCopyState = (cs: CopyStore) => useSyncExternalStore(cs.subscribe, cs.get)
const useLines = (stage: HTMLElement | null) => { useSyncExternalStore(copy.subscribe, copy.version); return copy.of(stage) }

// ---------- the list of a line's options ----------
const LIT = 'bg-zinc-900/[.05] dark:bg-white/[.08]'

/** Every option of one line as its real words, then the user's own. Shared by the popover and the sheet. */
function OptionList({ line, el, touch, onDone }: { line: CopyLine; el: HTMLElement | null; touch: boolean; onDone: (refocus: boolean) => void }) {
  const { copyAct, copyStore } = useCtx()
  const { stage } = useCopyState(copyStore)
  const choice = copy.choiceOf(stage, line.id)
  const id = line.id, n = line.options.length
  const mine = choice?.own ? choice.text : ''
  const cur = mine ? n : choice ? line.options.indexOf(choice.text) : 0
  const [draft, setDraft] = useState(mine)
  const [active, setActive] = useState(cur)
  const [hover, setHover] = useState<number | null>(null)
  const rows = useRef<(HTMLButtonElement | null)[]>([])
  const input = useRef<HTMLInputElement>(null)
  // The rows read the way the line does.
  const dir = el ? getComputedStyle(el).direction : 'ltr'
  const lang = el?.closest('[lang]')?.getAttribute('lang') ?? undefined
  const shown = hover ?? active
  const preview = touch ? null : shown < n ? line.options[shown] : draft.trim() || null
  useEffect(() => { if (stage) copy.peek(stage, id, preview) }, [preview, stage, id])

  const go = (i: number) => {
    setActive(i)
    setHover(null)
    if (i === n) input.current?.focus({ preventScroll: true })
    else rows.current[i]?.focus({ preventScroll: true })
  }
  useEffect(() => { if (!touch) go(cur) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // A click, a tap or Enter puts the option on the design and closes the list: on a phone the
  // design is the preview, and the line flashes where it changed.
  const pick = (i: number, keyboard = false) => { copyAct.choose(id, i ? { text: line.options[i] } : null); onDone(keyboard) }
  const takeOwn = (keyboard: boolean) => {
    const t = draft.trim()
    if (!t && !mine) return
    copyAct.choose(id, t ? { text: t, own: true } : null)
    input.current?.blur()
    onDone(keyboard)
  }
  const onKey = (e: KeyboardEvent) => {
    const k = e.key
    if (k === 'ArrowDown' || k === 'ArrowUp') { e.preventDefault(); go((active + (k === 'ArrowDown' ? 1 : n)) % (n + 1)) }
    else if ((k === 'Home' || k === 'End') && active < n) { e.preventDefault(); go(k === 'Home' ? 0 : n) }
    else if (k === 'Enter') { e.preventDefault(); if (active === n) takeOwn(true); else pick(active, true) }
    else if (k === ' ' && active < n) { e.preventDefault(); pick(active, true) }
  }
  const point = (i: number) => (e: RPointerEvent) => { if (e.pointerType === 'mouse' && hover !== i) setHover(i) }
  const size = touch ? 'min-h-11 text-[15px]' : 'min-h-9 py-1.5 text-[14px]'

  return (
    <div onKeyDown={onKey} onPointerLeave={() => setHover(null)}>
      <div role="listbox" aria-label={`${line.label} options`} className="space-y-px">
        {line.options.map((o, i) => (
          <button key={i} ref={b => { rows.current[i] = b }} type="button" role="option" aria-selected={i === cur}
            data-copy-option={i} tabIndex={i === active ? 0 : -1} dir={dir}
            onPointerMove={point(i)} onFocus={() => setActive(i)} onClick={() => pick(i)}
            className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 text-start text-zinc-900 outline-none active:bg-zinc-900/[.06] dark:text-zinc-100 dark:active:bg-white/10 ${size} ${!touch && i === shown ? LIT : ''}`}>
            <span className="grid size-4 shrink-0 place-items-center text-proto-primary-soft-fg">{i === cur && <Icon name="check" className="size-4" />}</span>
            <span lang={lang} className="min-w-0 flex-1 leading-5">{o}</span>
            {i === 0 && <span dir="ltr" className="shrink-0 text-[11px] font-medium text-zinc-400 dark:text-zinc-500">Now</span>}
          </button>
        ))}
      </div>
      <div className="mx-2.5 my-1 border-t border-black/[.06] dark:border-white/10" />
      <div dir={dir} onPointerMove={point(n)}
        className={`flex items-center gap-2.5 rounded-lg ps-2.5 pe-1 ${touch ? 'min-h-11' : 'min-h-9'} ${!touch && shown === n ? LIT : ''}`}>
        <span className="grid size-4 shrink-0 place-items-center">
          {mine && draft.trim() === mine ? <Icon name="check" className="size-4 text-proto-primary-soft-fg" /> : <Icon name="pen" className="size-3.5 text-zinc-400" />}
        </span>
        <input ref={input} data-copy-own="" value={draft} dir={draft ? 'auto' : dir} lang={lang}
          placeholder={'Write my own…‎'} aria-label={`Write my own ${line.label.toLowerCase()}`}
          onChange={e => setDraft(e.target.value)} onFocus={() => setActive(n)} onClick={() => go(n)}
          className={`h-9 min-w-0 flex-1 bg-transparent text-zinc-900 outline-none placeholder:text-zinc-400 dark:text-zinc-100 dark:placeholder:text-zinc-500 ${touch ? 'text-base' : 'text-[14px]'}`} />
        {draft.trim() && draft.trim() !== mine && (
          <button type="button" aria-label="Use this line" title="Use this line · Enter" onClick={() => takeOwn(false)}
            className={`${IB} text-proto-primary-soft-fg! hover:bg-proto-primary-soft!`}><Icon name="check" className="size-4" /></button>
        )}
      </div>
    </div>
  )
}

/** The marker after a line's words: how many options it has, filled once the line was changed. */
function Badge({ m, n, changed }: { m: Mark; n: number; changed: boolean }) {
  return (
    <span aria-hidden="true" style={{ left: m.badge.x, top: m.badge.y, transform: `translate(${m.badge.rtl ? '-100%' : '0'}, -50%)`, '--tw-ring-color': m.ring } as CSSProperties}
      className={`pointer-events-none absolute z-10 grid h-[18px] min-w-[18px] place-items-center rounded-full px-1 font-sans text-[10px] font-semibold leading-none tabular-nums ring-2 transition-colors ${changed ? 'bg-proto-primary text-white' : 'bg-white text-proto-primary shadow-[inset_0_0_0_1px_rgb(79_70_229/.45)]'}`}>{n}</span>
  )
}

// ---------- over the stage: the marks, and the list on a wide page ----------
/** The marks share a root with the comment layer: a fault in them must not take commenting down
 *  with them. They start over the next time copy mode opens. */
class Contained extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(e: unknown) { console.error('copy picker:', e) }
  render() { return this.state.failed ? null : this.props.children }
}
export function CopyMarks() {
  const { copyStore } = useCtx()
  const s = useCopyState(copyStore)
  return <Contained key={`${s.route}:${s.on}`}><CopyLayer /></Contained>
}

function CopyLayer() {
  const { host, copyStore, copyAct } = useCtx()
  const s = useCopyState(copyStore)
  const { stage, on, open } = s
  const lines = useLines(stage)
  const narrow = useNarrow()
  const [marks, setMarks] = useState<Mark[]>([])
  const els = useRef(new Map<string, HTMLElement>())
  const btns = useRef(new Map<string, HTMLButtonElement>())
  const ids = lines.map(l => l.id).join('\n')
  // Where the bar lifted the design to, so closing puts it back.
  const lifted = useRef<{ el: Element; top: number } | null>(null)

  // Copy mode marks the stage, which underlines its lines (shell.css). Closing it puts the design
  // back where the bar found it.
  useEffect(() => {
    if (!stage || !on) return
    stage.setAttribute('data-copy-on', '')
    return () => {
      stage.removeAttribute('data-copy-on')
      const l = lifted.current
      lifted.current = null
      if (l && l.el.isConnected) l.el.scrollTo({ top: l.top, behavior: 'smooth' })
    }
  }, [stage, on])

  // Every frame while copy mode is on, the lines are measured where they are now (a scroll, a
  // resize, a new choice changing their width), and drawn only when something moved.
  useEffect(() => {
    if (!stage || !on) { setMarks([]); return }
    const want = new Set(ids.split('\n'))
    const stop = stage.closest('[data-layers] > *')
    let raf = 0, last = '', bottom = -1
    const tick = () => {
      const o = host.layer.getBoundingClientRect()
      const next: Mark[] = []
      els.current.clear()
      const seen = new Map<string, number>()
      for (const el of stage.querySelectorAll<HTMLElement>('[data-copy]')) {
        const id = el.dataset.copy!
        if (!want.has(id) || el.closest('[aria-hidden="true"]')) continue
        const k = seen.get(id) ?? 0
        seen.set(id, k + 1)
        const key = k ? `${id}\n${k}` : id
        const m = measure(el, o, key)
        if (m) { next.push(m); els.current.set(key, el) }
      }
      // The bar coming in (or growing) takes room from the stage: a line it now covers moves up with
      // its design, just enough for its mark to stay whole above it.
      if (bottom >= 0 && o.bottom < bottom - 0.5 && !copyStore.get().open) {
        for (const m of next) {
          const el = els.current.get(m.key)!, by = m.box.y + m.box.h + 10 - o.height
          if (m.box.y >= o.height || by <= 0) continue
          const sc = scrollerOf(el, stop)
          if (!sc) continue
          if (!lifted.current || lifted.current.el !== sc) lifted.current = { el: sc, top: sc.scrollTop }
          sc.scrollTop += by
        }
      }
      bottom = o.bottom
      const sig = JSON.stringify(next)
      if (sig !== last) { last = sig; setMarks(next) }
      raf = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [stage, on, ids, host, copyStore])

  // A programmatic click on a line (proto shoot's --click, a script) opens its list the way a click
  // on its mark does; a real click never gets there, the mark is on top.
  useEffect(() => {
    if (!stage || !on) return
    const click = (e: MouseEvent) => {
      const el = (e.target as Element).closest?.<HTMLElement>('[data-copy]')
      if (!el || !stage.contains(el) || !copy.of(stage).some(l => l.id === el.dataset.copy)) return
      e.preventDefault(); e.stopPropagation()
      copyAct.show(el.dataset.copy!)
    }
    stage.addEventListener('click', click, true)
    return () => stage.removeEventListener('click', click, true)
  }, [stage, on, copyAct])

  // A click anywhere but a line or the list closes the list (a click, not a press, so the design
  // still scrolls under an open sheet).
  useEffect(() => {
    if (!open) return
    const out = (e: MouseEvent) => { if (!(e.target as Element).closest?.('[data-copy-list], [data-copy-mark]')) copyAct.close() }
    document.addEventListener('click', out, true)
    return () => document.removeEventListener('click', out, true)
  }, [open, copyAct])

  // A list whose line went away (its component unmounted) closes.
  useEffect(() => {
    if (open && !ids.split('\n').includes(open)) copyAct.close()
  }, [open, ids, copyAct])

  // A new choice flashes its line (not in a shot, which would catch it halfway).
  useEffect(() => {
    if (!s.flash || s.still) return
    for (const [k, b] of btns.current) if (k.split('\n')[0] === s.flash.id) b.animate([{ backgroundColor: 'rgb(99 102 241 / .2)' }, { backgroundColor: 'rgb(99 102 241 / 0)' }], { duration: 1400, easing: 'ease-out' })
  }, [s.flash])

  if (!stage || !on) return null
  const byId = new Map(lines.map(l => [l.id, l]))
  const changed = new Set(copy.changed(stage).map(c => c.line.id))
  // A light line (white words on a dark button) gets a light underline.
  const light = marks.filter(m => m.light).map(m => `[data-copy-on] [data-copy="${CSS.escape(m.id)}"]`)
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {light.length > 0 && <style>{`${[...new Set(light)].join(', ')} { text-decoration-color: rgb(255 255 255 / .45) }`}</style>}
      {marks.map(m => {
        // A component that declared lines can unmount (a tab inside the design, a line Claude took
        // out) a frame before the marks are measured again: its marks wait for that frame.
        const line = byId.get(m.id)
        if (!line) return null
        const isOpen = open === m.id && !m.key.includes('\n'), ch = changed.has(m.id)
        return (
          <div key={m.key}>
            <button ref={b => { if (b) btns.current.set(m.key, b); else btns.current.delete(m.key) }} type="button" data-copy-mark={m.key}
              aria-haspopup="listbox" aria-expanded={isOpen} aria-label={`${line.label}: ${line.options.length} options${ch ? ', changed' : ''}`}
              onClick={() => (isOpen ? copyAct.close() : copyAct.show(m.id))}
              onKeyDown={e => { if (e.key === 'ArrowDown') { e.preventDefault(); copyAct.show(m.id) } }}
              style={{ left: m.box.x, top: m.box.y, width: m.box.w, height: m.box.h, borderRadius: m.box.r }}
              className={`pointer-events-auto absolute cursor-pointer outline-none transition-[background-color,box-shadow] ${isOpen ? 'ring-[1.5px] ring-proto-primary' : 'hover:bg-proto-primary/[.07] focus-visible:ring-[1.5px] focus-visible:ring-proto-primary/60'} ${m.text ? "before:absolute before:inset-x-0 before:-inset-y-[7px] before:content-['']" : ''}`} />
            <Badge m={m} n={line.options.length} changed={ch} />
          </div>
        )
      })}
      {open && !narrow && byId.get(open) && <Popover line={byId.get(open)!} mark={marks.find(m => m.key === open) ?? null} el={els.current.get(open) ?? null} />}
    </div>
  )
}

/** The list on a wide page: under its line (above it when there is no room below), as tall as the
 *  line's tallest option allows, so a longer preview never moves it under the pointer. */
function Popover({ line, mark, el }: { line: CopyLine; mark: Mark | null; el: HTMLElement | null }) {
  const { host, copyAct } = useCtx()
  const pop = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number; above: boolean } | null>(null)
  const side = useRef<boolean | null>(null)
  const reach = useRef(0)
  // The tallest the line gets with any of its options, measured once on a hidden copy of it next
  // to it (added and removed in one go, so nothing paints and nothing on the page sees it).
  const tallest = useRef(0)
  useLayoutEffect(() => {
    if (!el || !el.parentElement) return
    const twin = el.cloneNode(true) as HTMLElement
    twin.removeAttribute('data-copy')
    twin.setAttribute('aria-hidden', 'true')
    twin.style.visibility = 'hidden'
    el.after(twin)
    tallest.current = Math.max(...line.options.map(o => { twin.textContent = o; return twin.getBoundingClientRect().height }))
    twin.remove()
  }, [el, line])
  useLayoutEffect(() => {
    const p = pop.current
    if (!mark || !p) return
    const W = host.layer.clientWidth, H = host.layer.clientHeight
    const grow = mark.text ? 0 : 8
    reach.current = Math.max(reach.current, tallest.current + grow, mark.box.h)
    const bottom = mark.box.y + reach.current
    const ph = p.offsetHeight, pw = p.offsetWidth, gap = 10
    const above = side.current ??= H - bottom - gap - 8 < ph && mark.box.y > H - bottom
    const top = above ? mark.box.y - gap - ph : bottom + gap
    const left = Math.min(Math.max(mark.box.x + mark.box.w / 2 - pw / 2, 8), W - pw - 8)
    setPos(was => was && was.top === top && was.left === left && was.above === above ? was : { top, left, above })
  })
  if (!mark) return null
  return (
    <div ref={pop} data-copy-list role="dialog" aria-label={`${line.label} options`}
      // Unplaced for its first frame: see-through, not hidden, so its first option can take the focus.
      style={{ top: pos?.top ?? 0, left: pos?.left ?? 0, ...(pos ? {} : { opacity: 0, pointerEvents: 'none' }) }}
      className={`pointer-events-auto absolute z-20 w-[328px] max-w-[calc(100%-1rem)] rounded-xl bg-white p-1 text-zinc-900 shadow-[0_16px_40px_-12px_rgb(0_0_0/.28)] ring-1 ring-black/[.08] transition-[opacity,translate] duration-150 ease-out starting:opacity-0 dark:bg-zinc-900 dark:text-zinc-100 dark:ring-white/10 ${pos?.above ? 'starting:translate-y-1' : 'starting:-translate-y-1'}`}>
      <div className="flex h-9 items-center gap-1.5 ps-2.5 text-xs">
        <span className="font-medium text-zinc-900 dark:text-zinc-100">{line.label}</span>
        <span className="text-zinc-400 dark:text-zinc-500">{line.options.length} options</span>
        <button type="button" aria-label="Close" title="Close · Esc" onClick={() => copyAct.escape()} className={`${IB} ms-auto`}><Icon name="x" className="size-3.5" /></button>
      </div>
      <OptionList key={line.id} line={line} el={el} touch={false} onDone={refocus => { copyAct.close(); if (refocus) document.querySelector<HTMLElement>(`[data-copy-mark="${CSS.escape(line.id)}"]`)?.focus({ preventScroll: true }) }} />
    </div>
  )
}

// ---------- the list on a phone: a sheet over the stage and its bar ----------
const DRAWER = 'pointer-events-auto w-full rounded-t-3xl bg-white pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] pt-2 text-[13px] text-zinc-900 shadow-2xl shadow-black/20 outline-none ring-1 ring-black/[.06] [transform:translateY(var(--drawer-swipe-movement-y))] transition-transform duration-[450ms] ease-[cubic-bezier(0.32,0.72,0,1)] data-swiping:select-none data-ending-style:[transform:translateY(100%)] data-starting-style:[transform:translateY(100%)] data-ending-style:duration-[calc(var(--drawer-swipe-strength)*400ms)] dark:bg-zinc-900 dark:text-zinc-100 dark:ring-white/10'

export function CopySheet({ container }: { container: HTMLElement }) {
  const { copyStore, copyAct } = useCtx()
  const s = useCopyState(copyStore)
  const lines = useLines(s.stage)
  const narrow = useNarrow()
  const sheet = useRef<HTMLDivElement>(null)
  const open = s.on && narrow && !!s.open
  const line = lines.find(l => l.id === s.sheet)
  const el = s.stage && line ? s.stage.querySelector<HTMLElement>(`[data-copy="${CSS.escape(line.id)}"]`) : null

  // The sheet covers the lower half: the design moves up with it until the line being chosen sits
  // above it, and back down when it closes.
  useEffect(() => {
    const layer = s.stage?.closest<HTMLElement>('[data-layers] > *')
    if (!layer) return
    if (!open || !el) { layer.style.transform = ''; return }
    const f = requestAnimationFrame(() => {
      const top = container.getBoundingClientRect().bottom - (sheet.current?.offsetHeight ?? 0)
      const by = Math.max(0, el.getBoundingClientRect().bottom + 20 - top)
      layer.style.transition = 'transform 450ms cubic-bezier(0.32, 0.72, 0, 1)'
      layer.style.transform = by ? `translateY(${-Math.round(by)}px)` : ''
    })
    return () => cancelAnimationFrame(f)
  }, [open, el, s.stage, container])
  useEffect(() => () => { const layer = s.stage?.closest<HTMLElement>('[data-layers] > *'); if (layer) layer.style.transform = '' }, [s.stage])

  if (!line) return null
  return (
    <Drawer.Root open={open} onOpenChange={o => { if (!o) copyAct.close() }} modal={false} disablePointerDismissal>
      <Drawer.Portal container={container}>
        <Drawer.Viewport className="pointer-events-none absolute inset-0 flex items-end">
          <Drawer.Popup ref={sheet} data-copy-list="" initialFocus={false} finalFocus={false} className={DRAWER}>
            <div className="mx-auto mb-1 h-1 w-10 rounded-full bg-zinc-300 dark:bg-zinc-700" />
            <Drawer.Content className="px-2">
              <div className="flex items-center gap-1.5 pb-1 ps-2.5">
                <Drawer.Title className="text-[15px] font-semibold">{line.label}</Drawer.Title>
                <span className="text-xs text-zinc-400 dark:text-zinc-500">{line.options.length} options</span>
                <Drawer.Close aria-label="Close" className="ms-auto grid size-9 place-items-center rounded-full text-zinc-500 active:bg-zinc-900/5 dark:active:bg-white/10"><Icon name="x" /></Drawer.Close>
              </div>
              <OptionList key={line.id} line={line} el={el} touch onDone={() => copyAct.close()} />
            </Drawer.Content>
          </Drawer.Popup>
        </Drawer.Viewport>
      </Drawer.Portal>
    </Drawer.Root>
  )
}

// ---------- the bar under the stage ----------
/** Claude's answer to a send: the batch's reply, else its comments' replies. */
function replyTo(batch: string, store: Store) {
  const b = store.get().inbox?.batches.find(x => x.id === batch)
  if (!b) return null
  const said = b.reply ? [b.reply] : b.comments.flatMap(c => (c.reply ? [c.reply] : []))
  return said.length ? { text: said.map(r => r.text).join(' · '), by: said[0].by ?? 'claude' } : null
}

/** Sending the choices, as the comment panel sends: the primary button, then Claude's answer. */
function SendChoices({ n, sending, sent, reply, listening, onSend, className = '' }: { n: number; sending: boolean; sent: boolean; reply: ReturnType<typeof replyTo>; listening: boolean; onSend: () => void; className?: string }) {
  const waiting = !n && sent
  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      {waiting && reply ? <Reply text={reply.text} by={reply.by} /> : (
        <button type="button" data-shoot="send-copy" disabled={!n || sending} onClick={onSend}
          className={`inline-flex h-11 items-center justify-center gap-2 rounded-full px-5 text-sm font-semibold transition-colors disabled:cursor-default ${n && !sending ? PRIMARY : 'bg-zinc-900/[.06] text-zinc-400 dark:bg-white/10 dark:text-zinc-500'}`}>
          <Icon name="send" className="size-4" />
          {sending ? 'Sending…' : waiting ? 'Sent to Claude' : n ? `Send ${n} choice${n === 1 ? '' : 's'} to Claude` : 'Nothing changed yet'}
        </button>
      )}
      <Listening on={listening} className="shrink-0 justify-center whitespace-nowrap" />
    </div>
  )
}

export function CopyBar() {
  const { store, copyStore, copyAct } = useCtx()
  const s = useCopyState(copyStore)
  const inbox = useStore(store).inbox
  const lines = useLines(s.stage)
  const narrow = useNarrow()
  const on = s.on && lines.length > 0
  const pending = copyAct.pending()
  const sent = s.sent[s.route]
  const reply = sent ? replyTo(sent.batch, store) : null
  const listening = !!inbox?.listening
  const quiet = !pending.length && !sent
  const label = (id: string) => lines.find(l => l.id === id)?.label ?? id
  const undoable = s.was && pending.length ? label(s.was.id) : null

  const undo = undoable && (
    <button type="button" data-shoot="undo-copy" onClick={copyAct.undo} aria-label={`Undo the ${undoable.toLowerCase()} change`} title={`Undo the ${undoable.toLowerCase()} change`}
      className={narrow
        ? '-ms-3.5 grid size-11 shrink-0 place-items-center rounded-full text-zinc-600 active:bg-zinc-900/[.06] dark:text-zinc-300 dark:active:bg-white/10'
        : `${IB} shrink-0 text-xs font-medium`}>
      <Icon name="undo" className="size-4" />{!narrow && 'Undo'}
    </button>
  )
  const send = (cls: string) => <SendChoices n={pending.length} sending={s.sending} sent={!!sent} reply={reply} listening={listening} onSend={copyAct.send} className={cls} />
  // What Send would post, in the page's order; sent and nothing new since: what went, until the next change.
  const shown = pending.length ? pending.map(c => c.line.label) : Object.keys(sent?.texts ?? {}).map(label)
  const oops = s.error && <p role="alert" className="mb-2 rounded-lg bg-rose-500/10 px-3 py-1.5 text-xs text-rose-700 dark:text-rose-300">{s.error}</p>

  return (
    <div className={`grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none ${on ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
      <div className="min-h-0 overflow-hidden" inert={!on}>
        <div data-shoot="copy-bar" className="border-t border-black/[.06] bg-white/85 backdrop-blur dark:border-white/[.08] dark:bg-zinc-950/80">
          {quiet ? (
            <div className={`mx-auto flex max-w-[760px] items-center gap-3 ${narrow ? 'h-11 px-4' : 'h-12 px-5'}`}>
              <p className={`min-w-0 flex-1 text-[13px] text-zinc-600 dark:text-zinc-300 ${narrow ? 'line-clamp-2 leading-4' : 'truncate'}`}>
                {narrow ? 'Tap a marked line for options' : 'Click a marked line to try its options in place'}
              </p>
              <Listening on={listening} className="shrink-0" />
            </div>
          ) : narrow ? (
            <div className="px-4 py-2">
              {oops}
              <div className="flex items-center gap-1">
                {undo}
                {send('min-w-0 flex-1 [&_[dir=auto]]:line-clamp-2 [&>button]:w-full [&>span:last-child]:hidden')}
              </div>
            </div>
          ) : (
            <div className="mx-auto max-w-[760px] px-5 py-2.5">
              {oops}
              <div className="flex items-center gap-4">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-zinc-900 dark:text-zinc-100">{shown.length} of {lines.length} line{lines.length === 1 ? '' : 's'} {pending.length ? 'changed' : 'sent'}</p>
                  <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">{shown.join(', ')}</p>
                </div>
                {undo}
                {send(`shrink-0 flex-row-reverse items-center gap-4 ${reply && !pending.length ? 'max-w-[60%]' : ''}`)}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
