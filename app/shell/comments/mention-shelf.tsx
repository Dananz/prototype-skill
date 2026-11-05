// What @ opens in a comment box: every variant in the project as a picture, on a rail over the box.
// Nearby comes first (what this was made from, what sits beside it, what was made from it), Picked
// and All are a tap away, and what is typed after the @ searches every name. A tap tags and stays
// open, so several can be tagged; Enter tags the lit one and closes. The pictures are the variants
// themselves, mounted live while their card is in view, so nothing has to be shot first.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'
import { t } from '../i18n'
import { useCtx } from './ctx'
import { Icon } from './ui'
import type { Target } from './types'

const TABS = ['Nearby', 'Picked', 'All'] as const
type Tab = typeof TABS[number]
const HEAD = 52 // the top row, which follows the panel's width while the rail below swaps
const keyOf = (c: Target) => `${c.variantRef?.proto}/${c.variantRef?.variant}`

/** A number finds that # nearest first; words find the variant's name, then its prototype's. */
function search(all: Target[], query: string): Target[] {
  const q = query.toLocaleLowerCase().replace(/^#/, '')
  if (/^\d+$/.test(q) || /^[a-z]{1,2}$/.test(q)) {
    const exact = all.filter(c => c.variantRef!.label.toLocaleLowerCase() === q || c.variantRef!.variant.toLocaleLowerCase() === q)
    if (exact.length && /^\d+$/.test(q)) return exact
  }
  const rank = (c: Target) => {
    const n = c.variantRef!.name.toLocaleLowerCase(), p = (c.variantRef!.title ?? '').toLocaleLowerCase()
    return n.startsWith(q) ? 0 : n.includes(q) ? 1 : p.startsWith(q) ? 2 : p.includes(q) ? 3 : c.variantRef!.proto.includes(q) ? 4 : 9
  }
  return all.map((c, i) => [rank(c), i, c] as const).filter(x => x[0] < 9).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map(x => x[2])
}

/** A variant's picture: mounted while its card is in view, let go when it leaves. */
function Picture({ target, w, h }: { target: Target; w: number; h: number }) {
  const { host } = useCtx()
  const box = useRef<HTMLSpanElement>(null), [seen, setSeen] = useState(false)
  useEffect(() => {
    const el = box.current!, o = new IntersectionObserver(([e]) => setSeen(e.isIntersecting), { root: el.closest('[data-shelf-rail]'), rootMargin: '0px 120px' })
    o.observe(el)
    return () => o.disconnect()
  }, [])
  const { proto, variant } = target.variantRef!
  useEffect(() => { if (seen && host.mountThumb) return host.mountThumb(box.current!, proto, variant, w, h) }, [seen, proto, variant, w, h]) // eslint-disable-line react-hooks/exhaustive-deps
  return <span ref={box} className="absolute inset-0 block overflow-hidden" />
}

type Opts = {
  choices: Target[]
  /** What follows the @; null while it is closed. */
  query: string | null
  /** Tags it where the @ is. Stay open for a tap, close for Enter. */
  onPick: (c: Target, close: boolean) => void
  /** Takes the tag back out of the words. */
  onDrop: (c: Target) => void
  /** Variants already tagged, by proto/variant. */
  tagged: () => Set<string>
  onElement?: () => void
}

export function useMentionShelf({ choices, query, onPick, onDrop, tagged, onElement }: Opts) {
  const [picked, setTab] = useState<Tab | null>(null)
  // With nothing near (the project's first prototype) it opens on everything.
  const tab: Tab = picked ?? (choices.some(c => c.variantRef?.near) ? 'Nearby' : 'All')
  const searching = !!query
  const has = tagged()
  const cards = useMemo(() => {
    if (query === null) return []
    if (query) return search(choices, query)
    const list = tab === 'Nearby' ? choices.filter(c => c.variantRef?.near) : tab === 'Picked' ? choices.filter(c => c.variantRef?.picked) : choices
    return list.slice(0, 60)
  }, [choices, query, tab])
  const [at, setAt] = useState(0)
  // Lit starts on the first card not tagged yet, so Enter always adds one.
  useEffect(() => { const i = cards.findIndex(c => !has.has(keyOf(c))); setAt(Math.max(0, i)) }, [cards, has.size]) // eslint-disable-line react-hooks/exhaustive-deps
  const lit = Math.min(at, Math.max(0, cards.length - 1))
  const byKey = useRef(false), rail = useRef<HTMLDivElement | null>(null)
  useEffect(() => { if (byKey.current) rail.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); byKey.current = false }, [lit])

  /** The arrows walk the rail (mirrored right to left), Enter or Tab tags. True when it took the key. */
  const onKey = (e: KeyboardEvent<HTMLElement>) => {
    if (query === null || e.nativeEvent.isComposing) return false
    const back = getComputedStyle(e.currentTarget).direction === 'rtl' ? 'ArrowRight' : 'ArrowLeft'
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      if (!cards.length) return false
      const step = e.key === back || e.key === 'ArrowUp' ? -1 : 1
      byKey.current = true
      setAt(Math.max(0, Math.min(cards.length - 1, lit + step)))
      return true
    }
    if ((e.key === 'Enter' || e.key === 'Tab') && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
      const c = cards[lit]
      if (c) { if (!has.has(keyOf(c))) onPick(c, true) } else onElement?.()
      return true
    }
    return false
  }
  return { cards, lit, setAt, tab, setTab, searching, onKey, rail, has }
}
export type Shelf = ReturnType<typeof useMentionShelf>

const phoneNow = () => typeof matchMedia === 'function' && matchMedia('(max-width: 639px), (pointer: coarse)').matches

/** The panel. `place` puts it over the page beside the box; without it, it sits where it is written (a phone's sheet). */
export function MentionShelf({ shelf, open, opts, place, count }: { shelf: Shelf; open: boolean; opts: Opts; place?: { center: number; above: boolean; edge: number }; count: number }) {
  const { cards, lit, setAt, tab, setTab, searching, rail, has } = shelf
  const phone = phoneNow()
  const W = phone ? 112 : 152, H = phone ? 112 : 95, GAP = phone ? 8 : 10
  const q = opts.query ?? ''
  // The panel takes its size from what it holds, measured, so a change of size can be a transition.
  const [inner, setInner] = useState<HTMLDivElement | null>(null), [size, setSize] = useState<{ w: number; h: number } | null>(null), [settled, setSettled] = useState(false)
  useLayoutEffect(() => {
    if (!inner) { setSize(null); setSettled(false); return }
    const read = () => setSize({ w: inner.offsetWidth + 2, h: inner.offsetHeight + HEAD + 2 })
    read(); const o = new ResizeObserver(read); o.observe(inner)
    const id = requestAnimationFrame(() => setSettled(true)) // the first size is not a change
    return () => { o.disconnect(); cancelAnimationFrame(id) }
  }, [inner])
  // A new tab crossfades: a picture of the old rail stays where it is and fades over the new one.
  const ghostHost = useRef<HTMLDivElement>(null), [swapped, setSwapped] = useState(false)
  const switchTab = (next: Tab) => {
    if (next === tab) return
    const old = rail.current, host = ghostHost.current
    if (old && host) {
      const ghost = old.cloneNode(true) as HTMLElement, scroll = old.scrollLeft
      ghost.removeAttribute('data-shelf-rail'); ghost.setAttribute('aria-hidden', 'true'); ghost.inert = true
      ghost.querySelectorAll('[role=option]').forEach(n => { n.removeAttribute('role'); n.removeAttribute('data-shelf-card') })
      ghost.style.width = `${old.offsetWidth}px`
      ghost.classList.remove('proto-shelf-rail-in'); ghost.classList.add('proto-shelf-rail-out')
      host.replaceChildren(ghost)
      ghost.scrollLeft = scroll
      window.setTimeout(() => ghost.remove(), 200)
    }
    setSwapped(true); setTab(next)
  }
  const scroll = (onward: number) => { const el = rail.current; if (el) el.scrollBy({ left: (getComputedStyle(el).direction === 'rtl' ? -1 : 1) * onward, behavior: 'smooth' }) }
  const full = !place || phone
  const room = typeof innerWidth === 'number' ? innerWidth - 16 : 900
  const width = size?.w ?? Math.min(560, room)
  const style: CSSProperties = place
    ? { position: 'fixed', zIndex: 250, left: phone ? 8 : Math.max(8, Math.min(place.center - width / 2, innerWidth - width - 8)), ...(place.above ? { bottom: place.edge } : { top: place.edge }), ...(phone ? { width: room } : size ? { width: size.w } : {}), ...(size ? { height: size.h } : {}) }
    : size ? { height: size.h } : {}
  const keep = (e: { preventDefault: () => void }) => e.preventDefault() // the box keeps the caret
  const Back = <button type="button" aria-label={t('Earlier')} onMouseDown={keep} onClick={() => scroll(-((W + GAP) * 3))} className="grid size-8 shrink-0 place-items-center rounded-full text-zinc-500 hover:bg-zinc-900/5 dark:text-zinc-300 dark:hover:bg-white/5"><Icon name="left" className="size-4 rtl:-scale-x-100" /></button>
  const On = <button type="button" aria-label={t('Later')} onMouseDown={keep} onClick={() => scroll((W + GAP) * 3)} className="grid size-8 shrink-0 place-items-center rounded-full text-zinc-500 hover:bg-zinc-900/5 dark:text-zinc-300 dark:hover:bg-white/5"><Icon name="right" className="size-4 rtl:-scale-x-100" /></button>
  const body: ReactNode = <>
    <div className="absolute inset-x-0 top-0 z-10 flex items-center gap-1 px-3 pt-3 pb-2" style={{ height: HEAD }}>
      {searching
        ? <span className="h-8 px-1 text-[13px] leading-8 text-zinc-500 dark:text-zinc-400">{cards.length ? t('{n} in this project', { n: cards.length }) : t('Nothing called “{q}”', { q })}</span>
        : TABS.map(x => <button key={x} type="button" data-shelf-tab={x} aria-pressed={x === tab} onMouseDown={keep} onClick={() => switchTab(x)} className={`h-8 rounded-full px-3 text-[13px] ${x === tab ? 'bg-zinc-900/10 font-medium text-zinc-900 dark:bg-white/15 dark:text-white' : 'text-zinc-500 hover:bg-zinc-900/5 dark:text-zinc-400 dark:hover:bg-white/5'}`}>{t(x === 'Picked' ? 'Picks' : x)}</button>)}
      {opts.onElement && <button type="button" data-tag-pick onMouseDown={keep} onClick={opts.onElement} className="ms-auto flex h-8 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[13px] text-zinc-600 hover:bg-zinc-900/5 dark:text-zinc-300 dark:hover:bg-white/5"><Icon name="target" className="size-3.5" />{t('Tag an element')}</button>}
      {!phone && <span className={`flex shrink-0 ${opts.onElement ? '' : 'ms-auto'}`}>{Back}{On}</span>}
    </div>
    <div ref={setInner} className={`absolute bottom-0 pb-3 ${full ? 'inset-x-0' : 'start-1/2 w-max max-w-[900px] min-w-[560px] -translate-x-1/2 rtl:translate-x-1/2'}`} style={full ? undefined : { maxWidth: Math.min(900, room - 2), minWidth: Math.min(560, room - 2) }}>
      <div ref={ghostHost} className={`pointer-events-none absolute top-0 z-[1] ${full ? 'inset-x-0' : 'start-1/2 -translate-x-1/2 rtl:translate-x-1/2'}`} />
      {!count
        ? <p className="px-4 py-7 text-center text-[13px] text-zinc-500 dark:text-zinc-400">{t('Nothing else in this project yet.')}</p>
        : <div key={searching ? 'search' : tab} ref={rail} data-shelf-rail className={`${swapped ? 'proto-shelf-rail-in' : ''} flex snap-x scroll-px-3 overflow-x-auto overscroll-contain px-3 [scrollbar-width:none]`} style={{ gap: GAP }}>
          {cards.map((c, i) => {
            const r = c.variantRef!, on = has.has(keyOf(c))
            return <button key={keyOf(c)} type="button" role="option" aria-selected={i === lit} data-shelf-card={keyOf(c)} onMouseDown={keep} onMouseEnter={() => setAt(i)} onClick={() => on ? opts.onDrop(c) : opts.onPick(c, false)}
              className="proto-shelf-card shrink-0 snap-start text-start" style={{ width: W, animationDelay: `${70 + Math.min(i, 5) * 30}ms` }}>
              <span className={`relative block overflow-hidden rounded-[10px] border bg-zinc-100 dark:bg-zinc-900 ${on || i === lit ? 'border-proto-primary-ring ring-1 ring-proto-primary-ring' : 'border-black/10 dark:border-white/10'}`} style={{ height: H }}>
                <span dir="auto" className="absolute inset-0 grid place-items-center px-2 text-center text-[11px] leading-[14px] text-zinc-400 dark:text-zinc-600">{r.title}</span>
                <Picture target={c} w={W - 2} h={H - 2} />
                <span className="absolute start-1.5 top-1.5 grid h-6 min-w-6 place-items-center rounded-md bg-white/75 px-1.5 text-[14px] leading-none font-bold text-black tabular-nums shadow-[0_0_0_1px_rgb(0_0_0/.5),0_2px_6px_rgb(0_0_0/.5)] backdrop-blur-sm"><bdi dir="ltr">#{r.label}</bdi></span>
                {on && <span className="absolute end-1.5 top-1.5 grid size-6 place-items-center rounded-full bg-proto-primary text-proto-primary-fg"><Icon name="check" className="size-3.5" /></span>}
              </span>
              <span dir="auto" className="mt-1.5 block truncate text-start text-[12.5px] font-medium">{r.name}</span>
              <span dir="auto" className="block truncate text-start text-[11px] text-zinc-500">{r.title}</span>
            </button>
          })}
          {!cards.length && !searching && <p className="py-7 text-[13px] text-zinc-500 dark:text-zinc-400">{t('Nothing here. Try All.')}</p>}
        </div>}
    </div>
  </>
  return <div data-tag-menu role="listbox" aria-label={t('Mention a variant')} data-comment-ui="" style={style}
    className={`proto-shelf ${open ? 'proto-shelf-in pointer-events-auto' : 'proto-shelf-out pointer-events-none'} ${settled ? 'proto-shelf-sized' : ''} ${place?.above === false ? 'origin-top' : 'origin-bottom'} ${place ? '' : 'relative my-2'} box-border overflow-hidden rounded-2xl border border-black/10 bg-white text-zinc-900 shadow-2xl dark:border-white/10 dark:bg-zinc-950 dark:text-zinc-100`}>
    {body}
  </div>
}
