// The map as a gallery: one card per exploration (its pick, else its first option), those waiting for a
// pick first, each section a panel on the desk. A card opens its options in a drawer under its row; an
// option opens it. The canvas map is a switch away (map/index.tsx MapRoot), and Focus still flies in there.
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Proto } from '../shell'
import { t, tn } from '../i18n'
import { numberOf } from '../variants'
import { Ph } from '../tree/row'
import type { MapInput } from './index'

/** A still of a route, filling a box of its frame's shape (the map's own Still, so they share one cache). */
export type Pic = (p: Proto, letter: string, want: boolean) => ReactNode
const frameOf = (p: Proto): [number, number] => p.kind === 'phone' ? p.screen : [1200, 750]
const COLS_AT = [[1200, 4], [860, 3], [560, 2], [0, 1]] as const
const EASE_OUT = 'cubic-bezier(.32,.72,0,1)', EASE_IN = 'cubic-bezier(.4,0,1,1)'

function Thumb({ p, letter, pic, want }: { p: Proto; letter: string; pic: Pic; want: boolean }) {
  const [w, h] = frameOf(p), phone = h > w
  return (
    <div className="grid aspect-[16/10] place-items-center overflow-hidden rounded-xl bg-zinc-200/60 ring-1 ring-black/[.06] dark:bg-zinc-900 dark:ring-white/[.06]">
      <div className={`relative overflow-hidden ${phone ? 'mt-6 h-[115%] rounded-t-xl shadow-lg' : 'w-full'}`} style={{ aspectRatio: `${w} / ${h}` }}>{pic(p, letter, want)}</div>
    </div>
  )
}

function Status({ p }: { p: Proto }) {
  return p.picked
    ? <span className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400"><Ph name="checkFill" className="size-3.5" />{t('Picked #{n}', { n: numberOf(p.picked) })}</span>
    : <span className="inline-flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400"><span className="size-1.5 rounded-full bg-current" />{tn(p.variants.length, '1 option', '{n} options')}</span>
}

const day = (iso: string) => new Date(iso).toLocaleDateString(document.documentElement.lang || undefined, { day: 'numeric', month: 'short' })

function useInView<T extends HTMLElement>() {
  const ref = useRef<T>(null), [seen, setSeen] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || seen) return
    const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { setSeen(true); io.disconnect() } }, { rootMargin: '400px' })
    io.observe(el)
    return () => io.disconnect()
  }, [seen])
  return [ref, seen] as const
}

function Card({ p, on, dim, pic, onClick }: { p: Proto; on: boolean; dim: boolean; pic: Pic; onClick: () => void }) {
  const [ref, seen] = useInView<HTMLButtonElement>()
  return (
    <button ref={ref} type="button" data-gallery-card={p.id} aria-expanded={on} onClick={onClick} className={`group min-w-0 pb-5 text-start sm:pb-7 transition-opacity duration-300 ${dim ? 'opacity-50 hover:opacity-80' : ''}`}>
      <div className={`rounded-xl ring-sky-500 ring-offset-[var(--desk-card)] transition-[box-shadow,transform] duration-300 ${on ? 'ring-2 ring-offset-4' : 'group-hover:-translate-y-0.5'}`} style={{ transitionTimingFunction: EASE_OUT }}>
        <Thumb p={p} letter={p.picked ?? p.variants[0]?.id ?? 'A'} pic={pic} want={seen} />
      </div>
      <div dir="auto" className="mt-2.5 truncate text-start text-[14px] font-medium">{p.title}</div>
      <div className="mt-0.5 flex items-center gap-2"><Status p={p} /><span className="text-xs text-zinc-400">· {day(p.created)}</span></div>
    </button>
  )
}

// Opens by growing (grid rows 0fr → 1fr) and fading in, the options rising one after another; shuts back,
// keeping what it showed until it has. 340 ms in, 240 ms out, as the shell's menu card.
function Drawer({ p, pic, open }: { p: Proto | null; pic: Pic; open: (route: string) => void }) {
  const [shown, setShown] = useState(p)
  if (p && p !== shown) setShown(p)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!p) return
    const id = setTimeout(() => box.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 200)
    return () => clearTimeout(id)
  }, [p])
  return (
    <div ref={box} className={`col-span-full grid transition-[grid-template-rows,opacity] motion-reduce:transition-none ${p ? 'grid-rows-[1fr] opacity-100 duration-[340ms]' : 'grid-rows-[0fr] opacity-0 duration-[240ms]'}`} style={{ transitionTimingFunction: p ? EASE_OUT : EASE_IN }}
      onTransitionEnd={e => { if (!p && e.target === e.currentTarget && e.propertyName === 'grid-template-rows') setShown(null) }}>
      <div className="min-h-0 overflow-hidden">{shown && (
        <div className="pb-5 sm:pb-7">
          <div data-gallery-options={shown.id} className="-mx-1 rounded-2xl bg-zinc-900/[.03] p-3 sm:-mx-2 sm:p-4 ring-1 ring-black/[.06] dark:bg-white/[.03] dark:ring-white/[.06]">
            <div className="mb-3 flex items-center gap-3 text-sm"><b dir="auto" className="font-semibold">{shown.title}</b><Status p={shown} /></div>
            <div className="-m-1.5 flex gap-4 overflow-x-auto p-1.5 pb-2.5 [scrollbar-width:thin]">
              {shown.variants.map((v, i) => (
                <button key={v.id} type="button" data-gallery-option={`${shown.id}/${v.id}`} onClick={() => open(`${shown.id}/${v.id}`)} title={t('Open')}
                  className="group w-40 shrink-0 text-start sm:w-52 motion-safe:animate-[proto-gallery-rise_.4s_cubic-bezier(.32,.72,0,1)_both]" style={{ animationDelay: `${60 + i * 35}ms` }}>
                  <div className={`rounded-xl transition-transform duration-200 group-hover:-translate-y-0.5 ${shown.picked === v.id ? 'ring-2 ring-emerald-500 ring-offset-2 ring-offset-[var(--desk-card)]' : ''}`}><Thumb p={shown} letter={v.id} pic={pic} want /></div>
                  <div className="mt-2 flex items-center gap-1.5 text-[13px]"><span className="tabular-nums text-zinc-400">{numberOf(v.id)}</span><span dir="auto" className="truncate">{v.name}</span>{shown.picked === v.id && <Ph name="checkFill" className="size-3.5 text-emerald-500" />}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}</div>
    </div>
  )
}

function Section({ id, title, hint, list, cols, pic, open, openId, setOpenId }: { id: string; title: string; hint: string; list: Proto[]; cols: number; pic: Pic; open: (route: string) => void; openId: string; setOpenId: (id: string) => void }) {
  if (!list.length) return null
  const rows = Array.from({ length: Math.ceil(list.length / cols) }, (_, r) => list.slice(r * cols, r * cols + cols))
  const here = list.some(p => p.id === openId)
  return (
    <section data-gallery-section={id} className="mb-3 rounded-[20px] bg-[var(--desk-card)] p-3.5 pt-3 ring-1 ring-[var(--desk-line)] sm:mb-6 sm:rounded-3xl sm:p-6 sm:pt-5">
      <header className="mb-3 flex flex-wrap items-baseline gap-x-2 gap-y-1 border-b border-[var(--desk-line)] pb-3 sm:mb-5 sm:pb-4">
        <h2 dir="auto" className="whitespace-nowrap text-[15px] font-semibold">{title}</h2>
        <span className="rounded-full bg-zinc-900/5 px-2 py-0.5 text-xs tabular-nums text-zinc-500 dark:bg-white/10 dark:text-zinc-400">{list.length}</span>
        <span className="w-full text-xs text-zinc-400 sm:ms-auto sm:w-auto">{hint}</span>
      </header>
      <div className="grid gap-x-3 sm:gap-x-5" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {rows.map((row, r) => (
          <Fragment key={r}>
            {row.map(p => <Card key={p.id} p={p} on={openId === p.id} dim={here && openId !== p.id} pic={pic} onClick={() => setOpenId(openId === p.id ? '' : p.id)} />)}
            <Drawer p={row.find(p => p.id === openId) ?? null} pic={pic} open={open} />
          </Fragment>
        ))}
      </div>
    </section>
  )
}

type Conv = { sid: string; name: string; at: string; n: number; picked: number }

/** The other conversations, one line each: opening one scopes the page (and the tree) to it. */
function Past({ convs, setScope }: { convs: Conv[]; setScope: (scope: string) => void }) {
  return (
    <section data-gallery-section="past" className="mb-3 rounded-[20px] bg-[var(--desk-card)] p-3.5 pt-3 ring-1 ring-[var(--desk-line)] sm:mb-6 sm:rounded-3xl sm:p-6 sm:pt-5">
      <header className="mb-3 flex flex-wrap items-baseline gap-x-2 gap-y-1 border-b border-[var(--desk-line)] pb-3 sm:pb-4">
        <h2 className="whitespace-nowrap text-[15px] font-semibold">{t('Past conversations')}</h2>
        <span className="rounded-full bg-zinc-900/5 px-2 py-0.5 text-xs tabular-nums text-zinc-500 dark:bg-white/10 dark:text-zinc-400">{convs.length}</span>
        <span className="w-full text-xs text-zinc-400 sm:ms-auto sm:w-auto">{t('Open one to see its explorations')}</span>
      </header>
      <div className="-mx-3">
        {convs.map(c => (
          <button key={c.sid} type="button" data-gallery-conv={c.sid} onClick={() => setScope(`conv:${c.sid}`)} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-start hover:bg-zinc-900/5 dark:hover:bg-white/5">
            <Ph name="chatCircle" className="size-4 text-zinc-400" />
            <span dir="auto" className="min-w-0 flex-1 truncate text-start text-[14px] font-medium">{c.name || t('A past conversation')}</span>
            <span className="shrink-0 text-xs tabular-nums text-zinc-400">{tn(c.n, '1 exploration', '{n} explorations')} · {t('{n} picked', { n: c.picked })} · {day(c.at)}</span>
            <Ph name="caretRight" className="size-3 text-zinc-400 rtl:-scale-x-100" />
          </button>
        ))}
      </div>
    </section>
  )
}
const Empty = ({ text }: { text: string }) => <p className="rounded-3xl bg-[var(--desk-card)] px-6 py-10 text-center text-sm text-zinc-400 ring-1 ring-[var(--desk-line)]">{text}</p>

export function Gallery({ input, pic, open, safe, head, setScope }: { input: MapInput; pic: Pic; open: (route: string) => void; safe: { l: number; t: number; r: number; b: number }; head?: ReactNode; setScope: (scope: string) => void }) {
  const scroller = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = scroller.current!
    const ro = new ResizeObserver(() => setWidth(el.clientWidth - safe.l - safe.r))
    ro.observe(el)
    return () => ro.disconnect()
  }, [safe.l, safe.r])
  const cols = COLS_AT.find(([at]) => width >= at)?.[1] ?? 1
  // A phone keeps its width for the cards: a thin margin instead of the desk's.
  const pad = width > 0 && width < 560 ? 10 : 24
  const live = useMemo(() => input.protos.filter(p => !p.archived).sort((a, b) => b.created.localeCompare(a.created)), [input.protos])
  const [openId, setOpenId] = useState('')
  const scope = input.scope ?? 'all', sid = scope.startsWith('conv:') ? scope.slice('conv:'.length) : ''
  const convs: Conv[] = useMemo(() => { try { return JSON.parse(input.convs || '[]') as Conv[] } catch { return [] } }, [input.convs])
  const same = { cols, pic, open, openId, setOpenId }
  // A new scope starts at the top.
  useEffect(() => { scroller.current?.scrollTo({ top: 0 }) }, [scope])
  // The tree (or an exploration's own page) asked for one: its card opens, and the drawer scrolls it in.
  useEffect(() => {
    const key = (input.frame ?? '').split('#')[0]
    if (key.startsWith('round:')) setOpenId(key.slice('round:'.length))
  }, [input.frame])
  return (
    <div ref={scroller} data-gallery className={'absolute inset-0 overflow-y-auto overscroll-contain ' + (input.hidden ? 'hidden' : '')}
      style={{ paddingLeft: safe.l + pad, paddingRight: safe.r + pad, paddingTop: safe.t + 14, paddingBottom: safe.b + 120 }}>
      <style>{'@keyframes proto-gallery-rise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}'}</style>
      <div className="mx-auto max-w-[1600px]">
        {head && <div className="mb-4 flex justify-center">{head}</div>}
        {scope === 'favs' ? (live.length ? <Section id="favs" title={t('Favorites')} hint={t('From the whole project')} list={live} {...same} /> : <Empty text={t('No favorites yet')} />)
          : scope === 'all' ? convs.map(c => <Section key={c.sid} id={`conv:${c.sid}`} title={c.name || t('A past conversation')} hint={c.sid === input.me ? t('This conversation') : day(c.at)} list={live.filter(p => (p.session ?? '') === c.sid)} {...same} />)
          : <>
            {sid !== input.me && <div className="mb-4 flex items-center gap-3">
              {input.me && <button type="button" data-gallery-back onClick={() => setScope(`conv:${input.me}`)} className="flex items-center gap-1.5 text-sm font-medium text-sky-600 hover:text-sky-700 dark:text-sky-400"><Ph name="caretRight" className="size-3 -scale-x-100 rtl:scale-x-100" />{t('Back to this conversation')}</button>}
              <span dir="auto" className="ms-auto text-sm text-zinc-500">{convs.find(c => c.sid === sid)?.name || t('A past conversation')}</span>
            </div>}
            {live.length ? <>
              <Section id="open" title={t('Waiting for a pick')} hint={t('Open a card to see its options')} list={live.filter(p => !p.picked)} {...same} />
              <Section id="picked" title={t('Picked')} hint={t('Each card shows its pick')} list={live.filter(p => p.picked)} {...same} />
            </> : <Empty text={t('Nothing from this conversation yet')} />}
            {sid === input.me && convs.some(c => c.sid !== sid) && <Past convs={convs.filter(c => c.sid !== sid)} setScope={setScope} />}
          </>}
      </div>
    </div>
  )
}
