// Pins: a comment on a spot of a design, numbered, drawn over the design wherever it shows (a
// preview on the desk, the full view's frame, a phone's one design), and pin mode, where the next
// click on the design places one and opens the composer at it (the design never gets that click).
//
// A pin is kept as the host keeps it (comments.tsx Target): the element's `data-proto-src` and
// `data-proto-component` stamps, its CSS path inside the design's mount, the point within it (% of
// its box) and the view it was made in. It is found again, on any device size and after a reload:
// by the path, when the element there still carries the same stamp; else by the first element that
// shows with that stamp. When neither is there the spot changed: the pin is drawn dimmed in the
// design's top corner, and its card says so.
//
// The layer is in the viewer's own page, over the design: in the full view inside the device's
// zoomed screen, next to the frame, so the frame's own px are the layer's (the zoom applies to
// both). Pin mode listens in the design's document (the frame's window, same origin; a phone's
// document) before the design does, on the design and on what it puts on the page's body (its menus
// and dialogs), and stops what a press, a tap or a key would do there. A frame that can't be reached (a
// share opened from disk) gets no pins and no pin mode.
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { Popover } from '@base-ui/react/popover'
import { t } from '../i18n'
import { drafts, ofDesign, useTalk, uuid, type Note, type Placing, type Target } from './comments'
import { Icon, card } from './ui'

/** From the mount down, one `tag:nth-child(n)` per level. */
export function pathOf(mount: Element, el: Element) {
  const parts: string[] = []
  for (let e: Element | null = el; e && e !== mount; e = e.parentElement) {
    const i = [...(e.parentElement?.children ?? [])].indexOf(e) + 1
    parts.unshift(`${e.tagName.toLowerCase()}:nth-child(${i})`)
  }
  return parts.length ? `:scope > ${parts.join(' > ')}` : ''
}
const shows = (el: Element | null): el is Element => { if (!el?.isConnected) return false; const r = el.getBoundingClientRect(); return r.width >= 1 && r.height >= 1 }
const stamp = (mount: Element, el: Element) => { const s = el.closest('[data-proto-src]'); return s && mount.contains(s) ? s : null }
/** The design's own root in its mount. */
const rootOf = (mount: Element) => mount.firstElementChild ?? mount

/** The element a pin is on now, or null when it is gone (the spot changed). */
export function anchorOf(mount: Element, t: Target): Element | null {
  if (t.path) {
    let el: Element | null = null
    try { el = mount.querySelector(t.path) } catch { /* not a selector any more */ }
    if (shows(el) && (!t.src || stamp(mount, el)?.getAttribute('data-proto-src') === t.src)) return el
  }
  if (t.src) {
    const same = [...mount.querySelectorAll('[data-proto-src]')].find(e => e.getAttribute('data-proto-src') === t.src && (!t.component || e.getAttribute('data-proto-component') === t.component) && shows(e))
    if (same) return same
  }
  return null
}

const round = (n: number) => Math.round(Math.min(100, Math.max(0, n)) * 10) / 10
/** A pin on el at the point (cx, cy) of its own document's view, made in `view`. */
export function targetOf(mount: Element, el: Element, cx: number, cy: number, view: Target['view']): Target {
  // Something the design put on the body (a menu, a dialog) has no path from the mount: its stamps find it.
  const r = el.getBoundingClientRect(), s = mount.contains(el) ? stamp(mount, el) : el.closest('[data-proto-src]'), path = mount.contains(el) ? pathOf(mount, el) : ''
  const src = s?.getAttribute('data-proto-src'), component = s?.getAttribute('data-proto-component')
  return {
    ...(src && src.length <= 300 ? { src } : {}),
    ...(component && component.length <= 100 ? { component } : {}),
    ...(path && path.length <= 1000 ? { path } : {}),
    x: round(((cx - r.left) / (r.width || 1)) * 100), y: round(((cy - r.top) / (r.height || 1)) * 100), view,
  }
}

/** A point of el (x, y in % of its box) in the layer's own px. An element in a frame is in the
 *  frame's own px, which are the layer's: it lies over the frame, at the same zoom. */
function placeIn(layer: HTMLElement, el: Element, x: number, y: number) {
  const r = el.getBoundingClientRect()
  const px = r.left + r.width * x / 100, py = r.top + r.height * y / 100
  if (el.ownerDocument !== layer.ownerDocument) return { left: px, top: py }
  const L = layer.getBoundingClientRect(), s = L.width / (layer.offsetWidth || 1) || 1
  return { left: (px - L.left) / s, top: (py - L.top) / s }
}
function boxIn(layer: HTMLElement, el: Element) {
  const a = placeIn(layer, el, 0, 0), b = placeIn(layer, el, 100, 100)
  return { left: a.left, top: a.top, width: b.left - a.left, height: b.top - a.top }
}

/** Scrolls the nearest scroller around el (in its own document) so el is in the middle of it. */
function bringIn(el: Element) {
  const win = el.ownerDocument.defaultView
  for (let p = el.parentElement; p && win; p = p.parentElement) {
    const cs = win.getComputedStyle(p)
    if (!/(auto|scroll)/.test(cs.overflowY + cs.overflowX) || (p.scrollHeight <= p.clientHeight && p.scrollWidth <= p.clientWidth)) continue
    const a = el.getBoundingClientRect(), b = p.getBoundingClientRect()
    p.scrollTo({ top: p.scrollTop + a.top - b.top - (p.clientHeight - a.height) / 2, left: p.scrollLeft + a.left - b.left - (p.clientWidth - a.width) / 2, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
    return
  }
}

// The design's own cursor gives way to a crosshair while pin mode is on.
const CURSOR = '[data-pinning] * { cursor: crosshair !important; }'
function cursorSheet(doc: Document) {
  if (doc.querySelector('style[data-proto-pinning]')) return
  const s = doc.createElement('style')
  s.setAttribute('data-proto-pinning', '')
  s.textContent = CURSOR
  doc.head.append(s)
}

type Pos = { left: number; top: number; lost?: boolean }
type Box = Pos & { width: number; height: number }

/**
 * The pins of one design, over it. mount: its `[data-mount]` (in this page or the frame's).
 * kind: desk (a preview: pins keep their size on screen at any zoom), full or phone.
 * pick: pin mode's wiring where pins are placed: where it listens (the frame's window, the
 * phone's scroller) and the view a new pin is made in.
 */
export function Pins({ variant, mount, kind, pick, ready = true, scale }: {
  variant: string; mount: () => HTMLElement | null; kind: 'desk' | 'full' | 'phone'; ready?: boolean
  /** The full view's zoom undone for the pins, so they keep their size on screen (the desk sets its own --pin). */
  scale?: number
  pick?: { on: boolean; at: () => EventTarget | null; view: () => Target['view'] }
}) {
  const talk = useTalk()
  const layer = useRef<HTMLDivElement>(null)
  const { here, num } = ofDesign(talk.notes, variant)
  const pinned = here.filter(n => n.target)
  const placing = talk.placing?.variant === variant && talk.placing.where === kind ? talk.placing : null
  const [pos, setPos] = useState<Record<string, Pos | null>>({})
  const layerKey = `${kind}:${variant}`
  const [hover, setHover] = useState<Box | null>(null)
  const hovered = useRef<Element | null>(null)
  const now = useRef({ pinned, placing })
  now.current = { pinned, placing }
  const talkNow = useRef(talk)
  talkNow.current = talk

  // Where each pin is now: measured on scroll, resize and layout changes in the design's document,
  // and, while there are pins, twice a second besides (a design settles in its own time: fonts,
  // pictures, its first render). A pin whose element is gone sits dimmed in the design's top corner.
  useLayoutEffect(() => {
    if (!ready) return
    let frame = 0
    const measure = () => {
      frame = 0
      const l = layer.current, m = mount()
      if (!l) return
      const next: Record<string, Pos | null> = {}
      const all: [string, Target][] = now.current.pinned.map(n => [n.id, n.target!])
      if (now.current.placing) all.push(['placing', now.current.placing.target])
      let k = 0
      for (const [id, tg] of all) {
        if (!m) { next[id] = null; continue }
        const el = anchorOf(m, tg)
        if (el) { next[id] = placeIn(l, el, tg.x, tg.y); continue }
        const corner = placeIn(l, rootOf(m), 0, 0)
        next[id] = { left: Math.max(0, corner.left) + 20 + 34 * k++, top: Math.max(0, corner.top) + 8, lost: true }
      }
      setPos(was => (JSON.stringify(was) === JSON.stringify(next) ? was : next))
      const lost = Object.entries(next).filter(([id, p]) => p?.lost && id !== 'placing').map(([id]) => id)
      talkNow.current.setLost(layerKey, lost)
      const h = hovered.current
      setHover(h && h.isConnected ? boxIn(l, h) : null)
    }
    const soon = () => { if (!frame) frame = requestAnimationFrame(measure) }
    measure()
    const every = now.current.pinned.length || now.current.placing ? setInterval(soon, 500) : 0
    let off = () => {}
    const bind = () => {
      const m = mount()
      if (!m) return false
      const doc = m.ownerDocument, win = doc.defaultView
      const ro = new ResizeObserver(soon)
      ro.observe(m)
      doc.addEventListener('scroll', soon, true)
      win?.addEventListener('resize', soon)
      off = () => { ro.disconnect(); doc.removeEventListener('scroll', soon, true); win?.removeEventListener('resize', soon) }
      return true
    }
    // The design mounts after this layer: bind once its mount is there.
    const waiting = bind() ? 0 : setInterval(() => { if (bind()) clearInterval(waiting) }, 200)
    window.addEventListener('resize', soon)
    return () => { cancelAnimationFrame(frame); clearInterval(every); clearInterval(waiting); off(); window.removeEventListener('resize', soon) }
  }, [ready, mount, pinned.length, placing, talk.notes, layerKey])
  // Gone, this layer's pins are lost to no one.
  useEffect(() => () => talkNow.current.setLost(layerKey, []), [layerKey])

  // Pin mode: the element under the pointer is outlined; a click or a tap places a pin there and
  // opens the composer. The design gets none of it: no press, tap, click or key (Esc still leaves),
  // and a tap doesn't put the focus in its fields. A click the keyboard made places nothing.
  const composing = useRef(false)
  composing.current = !!placing
  const pickNow = useRef(pick)
  pickNow.current = pick
  useEffect(() => {
    if (!pick?.on || !ready) { hovered.current = null; setHover(null); return }
    const at = pick.at(), m = mount()
    if (!at || !m) return
    const doc = m.ownerDocument
    cursorSheet(doc)
    // The crosshair: on the whole frame (all of it is the design), on a phone only over the design.
    const marked = kind === 'full' ? doc.body : m
    marked.setAttribute('data-pinning', '')
    // The design: its mount, and what it puts on the body. In a frame the whole body is the design's;
    // on a phone the viewer's own parts are not.
    const inside = (e: Event) => {
      const el = e.target as Element | null
      if (!el || typeof el.closest !== 'function' || el === m) return null
      if (m.contains(el)) return el
      if (el === doc.body || !doc.body.contains(el)) return null
      return kind === 'full' || !el.closest('[data-viewer]') ? el : null
    }
    const move = (e: Event) => { const el = inside(e); if (el !== hovered.current) { hovered.current = el; const l = layer.current; setHover(el && l ? boxIn(l, el) : null) } }
    const leave = () => { hovered.current = null; setHover(null) }
    let wasComposing = false
    const place = (el: Element, x: number, y: number) => {
      if (wasComposing) { wasComposing = false; talk.setPlacing(null); return }
      talk.setPlacing({ id: uuid(), variant, target: targetOf(m, el, x, y, pickNow.current!.view()), where: kind })
    }
    const stop = (e: Event) => {
      if (!inside(e)) return
      e.stopPropagation()
      if ((e as PointerEvent).pointerType !== 'touch') e.preventDefault()
      if (e.type === 'pointerdown' || e.type === 'mousedown') wasComposing = composing.current
    }
    const click = (e: Event) => {
      const el = inside(e)
      if (!el) return
      e.stopPropagation(); e.preventDefault()
      const p = e as MouseEvent
      if (p.detail === 0) return
      place(el, p.clientX, p.clientY)
    }
    // A tap: the scroll it may be stays the design's; a tap that didn't move pins, and its click and
    // focus never happen (the touchend is cancelled).
    let touch: { x: number; y: number; el: Element; moved: boolean } | null = null
    const tStart = (e: TouchEvent) => {
      const el = inside(e)
      if (!el) return
      e.stopPropagation()
      wasComposing = composing.current
      touch = { x: e.touches[0].clientX, y: e.touches[0].clientY, el, moved: false }
    }
    const tMove = (e: TouchEvent) => {
      if (!touch) return
      e.stopPropagation()
      if (Math.hypot(e.touches[0].clientX - touch.x, e.touches[0].clientY - touch.y) > 10) touch.moved = true
    }
    const tEnd = (e: TouchEvent) => {
      if (!touch) return
      e.stopPropagation()
      const t0 = touch
      touch = null
      if (t0.moved) return
      e.preventDefault()
      const c = e.changedTouches[0]
      place(t0.el, c?.clientX ?? t0.x, c?.clientY ?? t0.y)
    }
    // Keys in the design are not the design's while pins are placed; Esc goes on (it leaves pin mode),
    // Tab still moves, and C leaves too.
    const key = (e: KeyboardEvent) => {
      if (!inside(e) || e.key === 'Escape' || e.key === 'Tab') return
      e.stopPropagation(); e.preventDefault()
      if (e.type === 'keydown' && (e.key === 'c' || e.key === 'C') && !e.metaKey && !e.ctrlKey && !e.altKey) talk.setPinMode(false)
    }
    const kinds = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'dblclick', 'contextmenu'] as const
    const keys = ['keydown', 'keyup', 'keypress'] as const
    const opts = { capture: true, passive: false }
    at.addEventListener('pointermove', move, true)
    at.addEventListener('pointerleave', leave, true)
    for (const k of kinds) at.addEventListener(k, stop, true)
    for (const k of keys) at.addEventListener(k, key as EventListener, true)
    at.addEventListener('click', click, true)
    at.addEventListener('touchstart', tStart as EventListener, { capture: true, passive: true })
    at.addEventListener('touchmove', tMove as EventListener, { capture: true, passive: true })
    at.addEventListener('touchend', tEnd as EventListener, opts)
    const tCancel = () => { touch = null }
    at.addEventListener('touchcancel', tCancel, true)
    return () => {
      marked.removeAttribute('data-pinning')
      at.removeEventListener('pointermove', move, true)
      at.removeEventListener('pointerleave', leave, true)
      for (const k of kinds) at.removeEventListener(k, stop, true)
      for (const k of keys) at.removeEventListener(k, key as EventListener, true)
      at.removeEventListener('click', click, true)
      at.removeEventListener('touchstart', tStart as EventListener, true)
      at.removeEventListener('touchmove', tMove as EventListener, true)
      at.removeEventListener('touchend', tEnd as EventListener, true)
      at.removeEventListener('touchcancel', tCancel, true)
      hovered.current = null; setHover(null)
    }
  }, [pick?.on, ready, mount, variant, kind])

  // A comment asked for from the list: its element is scrolled into the middle of the design.
  useEffect(() => {
    const s = talk.seek, m = mount()
    if (!s || kind === 'desk' || !m) return
    const n = pinned.find(x => x.id === s.id)
    const el = n && anchorOf(m, n.target!)
    if (el) bringIn(el)
  }, [talk.seek])

  const pinRef = useRef<HTMLSpanElement>(null)
  const desk = kind === 'desk'
  // Pins on the desk and in the full view are drawn at a zoom; --pin keeps them their size on screen.
  const sized = kind !== 'phone'
  return (
    <div ref={layer} data-pins={kind} data-pin-mode={pick?.on ? '' : undefined}
      style={scale ? { ['--pin' as string]: String(Math.max(1, scale)) } : undefined}
      className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
      {hover && <div data-pin-outline className="absolute rounded-[3px] ring-2 ring-sky-500" style={hover} />}
      {pinned.map(n => {
        const p = pos[n.id]
        if (!p) return null
        return <PinButton key={n.id} n={n} num={num.get(n.id)!} at={p} desk={desk} sized={sized} active={talk.active === n.id} onClick={() => talk.onPin(n)} />
      })}
      {placing && pos.placing && (
        <span ref={pinRef} data-pin-new className={`absolute grid size-7 -translate-x-1/2 -translate-y-full place-items-center rounded-full rounded-bl-none bg-sky-500 text-white shadow-lg ring-2 ring-white ${sized ? 'origin-bottom [scale:var(--pin,1)]' : ''}`} style={pos.placing}>
          <Icon name="plus" className="size-3.5" />
        </span>
      )}
      {placing && pos.placing && <Composer placing={placing} anchor={pinRef} />}
    </div>
  )
}

function PinButton({ n, num, at, desk, sized, active, onClick }: { n: Note; num: number; at: Pos; desk: boolean; sized: boolean; active: boolean; onClick: () => void }) {
  // No room above the point (the top of the design): the pin hangs below it instead.
  const below = at.lost || at.top < (desk ? 28 * deskPin() : 42)
  return (
    <button data-pin={n.id} data-pin-lost={at.lost ? '' : undefined} onClick={e => { e.stopPropagation(); onClick() }} onPointerDown={e => e.stopPropagation()}
      aria-label={at.lost ? `${t('Comment {n}', { n: num })}. ${t('The spot changed')}` : t('Comment {n}', { n: num })}
      title={at.lost ? `${t('The spot changed')} · ${n.body.slice(0, 80)}` : n.body.slice(0, 80)} style={{ left: at.left, top: at.top }}
      className={`pointer-events-auto absolute ${at.lost ? 'opacity-55 outline-dashed outline-1 outline-offset-2 outline-zinc-400' : ''} grid size-7 -translate-x-1/2 place-items-center rounded-full text-[11px] font-bold text-white shadow-lg ring-2 ring-white transition-[background-color] motion-reduce:transition-none dark:ring-zinc-900 ${below ? 'rounded-tl-none' : '-translate-y-full rounded-bl-none'} ${active ? 'z-10 bg-sky-500' : 'bg-zinc-900 hover:bg-zinc-700 dark:bg-zinc-700 dark:hover:bg-zinc-600'} ${sized ? `${below ? 'origin-top' : 'origin-bottom'} [scale:var(--pin,1)]` : active ? `scale-125 ${below ? 'origin-top' : 'origin-bottom'}` : ''}`}>
      {num}
    </button>
  )
}
/** How much a desk pin is scaled up to keep its size on screen (the desk's --pin). */
const deskPin = () => Number(getComputedStyle(document.querySelector('[data-world]') ?? document.body).getPropertyValue('--pin')) || 1

/** Writing the comment of a pin just placed: at the pin, Enter sends, Shift+Enter is a new line, Esc lets it go. */
/** One placement is one comment: its id goes with every send of it (Send again after no answer is the same comment to the host). */
function Composer({ placing, anchor }: { placing: Placing; anchor: RefObject<HTMLSpanElement | null> }) {
  const talk = useTalk()
  const key = drafts.key(placing.variant, true)
  const [text, setText] = useState(() => drafts.get(key))
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const area = useRef<HTMLTextAreaElement>(null)
  // The id a send went out under, with its text: Send again with that text reuses it (the host stores it
  // once); edited text is another comment, under a new id, and the unsent card it replaces leaves.
  const tried = useRef<{ id: string; body: string } | null>(null)
  const change = (v: string) => { setText(v); drafts.set(key, v); if (error) setError('') }
  const send = async () => {
    const body = text.trim()
    if (!body || busy) return
    setBusy(true)
    const was = tried.current
    const id = !was ? placing.id : was.body === body ? was.id : uuid()
    if (was && id !== was.id && talk.notes.some(n => n.id === was.id && n.failed)) void talk.remove(was.id)
    tried.current = { id, body }
    const r = await talk.add(id, placing.variant, body, placing.target)
    setBusy(false)
    if (!r.ok) { if (r.refused) tried.current = { id: uuid(), body }; setError(r.why); return }
    drafts.set(key, '')
    talk.setPlacing(null)
  }
  const owner = talk.owner || t('the owner')
  const root = document.querySelector<HTMLElement>('[data-viewer]')
  return (
    <Popover.Root open onOpenChange={o => { if (!o) talk.setPlacing(null) }}>
      <Popover.Portal container={root}>
        <Popover.Positioner anchor={anchor} side="bottom" align="start" sideOffset={8} collisionPadding={12} className="z-50">
          <Popover.Popup data-pin-composer initialFocus={area} dir={document.documentElement.dir}
            className={`${card} w-[min(320px,calc(100vw-24px))] origin-[var(--transform-origin)] p-2 shadow-2xl outline-none transition-[opacity,scale] duration-150 data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0 motion-reduce:transition-none`}>
            <Popover.Title className="sr-only">{t('Comment on this spot')}</Popover.Title>
            <textarea ref={area} value={text} rows={3} dir="auto" onChange={e => change(e.target.value)} placeholder={t('Say what you think…')}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send() } }}
              className="block w-full resize-none rounded-xl bg-zinc-900/[.05] px-3 py-2 text-[14px] text-zinc-900 outline-none placeholder:text-zinc-500 focus-visible:ring-1 focus-visible:ring-sky-500 dark:bg-white/[.07] dark:text-zinc-100 dark:placeholder:text-zinc-400" />
            {error && <p data-comment-error role="alert" className="mt-1.5 px-1 text-[12px] text-red-600 dark:text-red-400">{error}</p>}
            {!talk.told && <p data-told className="mt-1.5 px-1 text-[12px] leading-snug text-zinc-500 dark:text-zinc-400">{t('Everyone with this link sees your name and comments.')}</p>}
            <div className="mt-2 flex items-center justify-end gap-1.5">
              <Popover.Close className="h-8 rounded-lg px-3 text-[13px] font-medium text-zinc-600 hover:bg-zinc-900/5 dark:text-zinc-300 dark:hover:bg-white/10">{t('Cancel')}</Popover.Close>
              <button onClick={() => void send()} disabled={!text.trim() || busy} title={t('Send to {owner}', { owner })}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-sky-500 px-3 text-[13px] font-medium text-white disabled:opacity-40">
                <Icon name="send" className="size-3.5" />{t('Send to {owner}', { owner })}
              </button>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}
