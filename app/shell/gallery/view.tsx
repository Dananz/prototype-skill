// The gallery: one card per exploration (its pick, else its first option), those waiting for a pick
// first, each section a panel on the desk. A card opens its options in a drawer under its row; an option
// opens it.
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Proto } from '../shell'
import { t, tn } from '../i18n'
import { numberOf } from '../variants'
import { Ph } from '../tree/row'
import { Near } from '../near'
import type { GalleryInput } from './index'

/** A still of a route, filling a box of its frame's shape. */
export type Pic = (p: Proto, letter: string, want: boolean) => ReactNode
const frameOf = (p: Proto): [number, number] => p.kind === 'phone' ? p.screen : [1200, 750]
const COLS_AT = [[1200, 4], [860, 3], [560, 2], [0, 1]] as const
/** A page with more cards than this draws only the rows near the view. */
const WINDOW_CARDS = 24
const galleryScroller = () => document.querySelector<HTMLElement>('[data-gallery]')
const EASE_OUT = 'cubic-bezier(.32,.72,0,1)', EASE_IN = 'cubic-bezier(.4,0,1,1)'
/** A card under the pointer rises on a soft shadow, and settles back while pressed. */
const LIFT = 'motion-safe:group-hover:-translate-y-1 group-hover:shadow-[0_8px_20px_-8px_rgb(0_0_0/.25)] motion-safe:group-active:translate-y-0 group-active:shadow-none dark:group-hover:shadow-[0_8px_20px_-8px_rgb(0_0_0/.7)]'

function Thumb({ p, letter, pic, want }: { p: Proto; letter: string; pic: Pic; want: boolean }) {
  const [w, h] = frameOf(p), phone = h > w
  return (
    <div className="grid aspect-[16/10] place-items-center overflow-hidden rounded-xl bg-zinc-200/60 ring-1 ring-black/[.06] transition-[background-color,box-shadow] duration-200 group-hover:bg-zinc-300/70 group-hover:ring-black/20 dark:bg-zinc-900 dark:ring-white/[.06] dark:group-hover:bg-zinc-800 dark:group-hover:ring-white/25">
      <div className={`relative overflow-hidden ${phone ? 'mt-6 h-[115%] rounded-t-xl shadow-lg' : 'w-full'}`} style={{ aspectRatio: `${w} / ${h}` }}>{pic(p, letter, want)}</div>
    </div>
  )
}

const REC = 'text-indigo-600 dark:text-indigo-300'
/** The agent's recommended option, while nothing is picked (meta.ts recommend, from proto recommend). */
const recOf = (p: Proto) => !p.picked && p.recommend ? p.recommend.pick : ''
const suggests = (agent: string | undefined, n: number | string) => t('{agent} suggests {v}', { agent: agent || t('The agent'), v: `#${n}` })

function Status({ p, agent }: { p: Proto; agent?: string }) {
  const rec = recOf(p)
  if (!p.picked && rec) return <span className="inline-flex items-center gap-2"><span className="inline-flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400"><span className="size-1.5 rounded-full bg-current" />{tn(p.variants.length, '1 option', '{n} options')}</span><span data-rec-pill title={suggests(agent, numberOf(rec))} className={'inline-flex items-center gap-1 text-xs font-medium ' + REC}><Ph name="sparkle" className="size-3" />{suggests(agent, numberOf(rec))}</span></span>
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

function Card({ p, on, dim, pic, onClick, agent }: { p: Proto; on: boolean; dim: boolean; pic: Pic; onClick: () => void; agent?: string }) {
  const [ref, seen] = useInView<HTMLButtonElement>()
  return (
    <button ref={ref} type="button" data-gallery-card={p.id} aria-expanded={on} onClick={onClick} className={`group min-w-0 cursor-pointer pb-5 text-start sm:pb-7 transition-opacity duration-300 ${dim ? 'opacity-50 hover:opacity-100' : ''}`}>
      <div className={`rounded-xl ring-sky-500 ring-offset-[var(--gallery-bg,var(--desk-card))] transition-[box-shadow,translate] duration-300 ${on ? 'ring-2 ring-offset-4' : LIFT}`} style={{ transitionTimingFunction: EASE_OUT }}>
        <Thumb p={p} letter={p.picked ?? p.variants[0]?.id ?? 'A'} pic={pic} want={seen} />
      </div>
      <div dir="auto" className="mt-2.5 truncate text-start text-[14px] font-medium">{p.title}</div>
      <div className="mt-0.5 flex items-center gap-2"><Status p={p} agent={agent} /><span className="text-xs text-zinc-400">· {day(p.created)}</span></div>
    </button>
  )
}

/** A card's exact height, with nothing in it: a row far from the view keeps its place with this. */
const CardSpace = () => <div aria-hidden="true" className="pb-5 sm:pb-7" style={{ paddingTop: 'calc(62.5% + 49px)' }} />

// Opens by growing (grid rows 0fr → 1fr) and fading in, the options rising one after another; shuts back,
// keeping what it showed until it has. 340 ms in, 240 ms out, as the shell's menu card.
function Drawer({ p, pic, open, pick, agent }: { p: Proto | null; pic: Pic; open: (route: string) => void; pick: (route: string) => Promise<void>; agent?: string }) {
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
      {shown && <div className="min-h-0 overflow-hidden">{(
        <div className="pb-5 sm:pb-7">
          <div data-gallery-options={shown.id} className="-mx-1 rounded-2xl bg-zinc-900/[.03] p-3 sm:-mx-2 sm:p-4 ring-1 ring-black/[.06] dark:bg-white/[.03] dark:ring-white/[.06]">
            <div className="mb-3 flex items-center gap-3 text-sm"><b dir="auto" className="font-semibold">{shown.title}</b><Status p={shown} agent={agent} /></div>
            {recOf(shown) && shown.recommend!.why && <p data-rec-why dir="auto" title={shown.recommend!.why} className="-mt-1 mb-3 line-clamp-2 max-w-[72ch] text-[13px] leading-relaxed text-zinc-600 dark:text-zinc-300"><span className={'font-semibold ' + REC}>{t('Why {v}:', { v: `#${numberOf(recOf(shown))}` })}</span> {shown.recommend!.why}</p>}
            <div className="-mx-3 -mt-3 -mb-1.5 flex gap-4 overflow-x-auto p-3 [scrollbar-width:thin]">
              {(rec => rec ? [...shown.variants.filter(v => v.id === rec), ...shown.variants.filter(v => v.id !== rec)] : shown.variants)(recOf(shown)).map((v, i) => {
                const route = `${shown.id}/${v.id}`, rec = recOf(shown) === v.id, take = shown.recommend?.takes[v.id]
                // The recommended option: first, in a soft indigo panel, its take in indigo and Pick across its width.
                return (
                  <div key={v.id} data-rec-card={rec || undefined} className={'w-40 shrink-0 sm:w-52 motion-safe:animate-[proto-gallery-rise_.4s_cubic-bezier(.32,.72,0,1)_both] ' + (rec ? 'rounded-[18px] bg-indigo-500/[.07] p-2.5 shadow-[0_8px_30px_-8px_rgb(99_102_241/.35)] ring-1 ring-indigo-500/25 dark:bg-indigo-400/[.09] dark:ring-indigo-400/30 sm:w-56' : '')} style={{ animationDelay: `${60 + i * 35}ms` }}>
                    <button type="button" data-gallery-option={route} onClick={() => open(route)} title={t('Open')} className="group block w-full cursor-pointer text-start">
                      <div className={`rounded-xl transition-[box-shadow,translate] duration-200 ${LIFT} ${shown.picked === v.id ? 'ring-2 ring-emerald-500 ring-offset-2 ring-offset-[var(--gallery-bg,var(--desk-card))]' : rec ? 'ring-2 ring-indigo-500 dark:ring-indigo-400' : ''}`}><Thumb p={shown} letter={v.id} pic={pic} want /></div>
                      <div className="mt-2 flex items-center gap-1.5 text-[13px]"><span className="tabular-nums text-zinc-400">{numberOf(v.id)}</span><span dir="auto" className="truncate">{v.name}</span>{shown.picked === v.id && <Ph name="checkFill" className="size-3.5 text-emerald-500" />}
                        {rec && <span className={'ms-auto flex shrink-0 items-center gap-1 text-xs font-medium ' + REC}><Ph name="sparkle" className="size-3" />{t('{agent}’s pick', { agent: agent || t('The agent') })}</span>}</div>
                      {take && <p data-rec-take dir="auto" className={'mt-0.5 text-xs leading-snug ' + (rec ? REC : 'text-zinc-500 dark:text-zinc-400')}>{take}</p>}
                    </button>
                    {rec && <PickRec route={route} label={`#${numberOf(v.id)}`} pick={pick} />}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}</div>}
    </div>
  )
}

/** Pick on the recommended option: a pick from the page, as Decide sends it; the reason shows when it fails. */
function PickRec({ route, label, pick }: { route: string; label: string; pick: (route: string) => Promise<void> }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  return <>
    <button type="button" data-rec-pick disabled={busy} onClick={() => { setBusy(true); setError(''); pick(route).catch(e => setError(e instanceof Error ? e.message : t('Could not send'))).finally(() => setBusy(false)) }}
      className="mt-2 flex h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-indigo-600 text-[13px] font-medium text-white hover:bg-indigo-500 disabled:opacity-60"><Ph name="checkFill" className="size-4" />{busy ? t('Sending…') : t('Pick {v}', { v: label })}</button>
    {error && <p role="alert" className="mt-1.5 text-xs text-rose-600 dark:text-rose-400">{error}</p>}
  </>
}

/** bare: the page's only section, drawn on the desk without its panel. */
function Section({ id, title, hint, list, cols, pic, open, pick, agent, openId, setOpenId, bare, windowed, firstRows }: { id: string; title: string; hint: string; list: Proto[]; cols: number; pic: Pic; open: (route: string) => void; pick: (route: string) => Promise<void>; agent?: string; openId: string; setOpenId: (id: string) => void; bare?: boolean; windowed: boolean; firstRows: { left: number } }) {
  if (!list.length) return null
  const rows = Array.from({ length: Math.ceil(list.length / cols) }, (_, r) => list.slice(r * cols, r * cols + cols))
  const here = list.some(p => p.id === openId)
  const grid = { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }
  return (
    <section data-gallery-section={id} data-bare={bare || undefined} style={bare ? { ['--gallery-bg' as string]: 'var(--desk)' } : undefined} className={bare ? 'mb-3 px-1 sm:mb-6' : 'mb-3 rounded-[20px] bg-[var(--desk-card)] p-3.5 pt-3 ring-1 ring-[var(--desk-line)] sm:mb-6 sm:rounded-3xl sm:p-6 sm:pt-5'}>
      <header className="mb-3 flex flex-wrap items-baseline gap-x-2 gap-y-1 border-b border-[var(--desk-line)] pb-3 sm:mb-5 sm:pb-4">
        <h2 dir="auto" className="whitespace-nowrap text-[15px] font-semibold">{title}</h2>
        <span className="rounded-full bg-zinc-900/5 px-2 py-0.5 text-xs tabular-nums text-zinc-500 dark:bg-white/10 dark:text-zinc-400">{list.length}</span>
        <span className="w-full text-xs text-zinc-400 sm:ms-auto sm:w-auto">{hint}</span>
      </header>
      <div className="grid gap-x-3 sm:gap-x-5" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {rows.map((row, r) => (
          <Fragment key={r}>
            {(() => {
              const cards = () => row.map(p => <Card key={p.id} p={p} on={openId === p.id} dim={here && openId !== p.id} pic={pic} agent={agent} onClick={() => setOpenId(openId === p.id ? '' : p.id)} />)
              return windowed
                ? <Near placeholder={<CardSpace />} scroller={galleryScroller} force={row.some(p => p.id === openId)} start={firstRows.left-- > 0} className="col-span-full grid gap-x-3 sm:gap-x-5" style={grid}>{cards}</Near>
                : cards()
            })()}
            <Drawer p={row.find(p => p.id === openId) ?? null} pic={pic} open={open} pick={pick} agent={agent} />
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

export function Gallery({ input, pic, open, pick, card, safe, setScope }: { input: GalleryInput; pic: Pic; open: (route: string) => void; pick: (route: string) => Promise<void>; card: (proto: string) => void; safe: { l: number; t: number; r: number; b: number }; setScope: (scope: string) => void }) {
  const scroller = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(() => { const w = document.querySelector('[data-gallery-host]')?.clientWidth ?? 0; return w ? w - safe.l - safe.r : 0 })
  // Measured before the first paint, and only drawn once known: the page never lays out one column first. Hidden
  // (a width of 0) it keeps its columns, so coming back draws nothing again.
  useLayoutEffect(() => {
    const el = scroller.current!
    const measure = () => { if (el.clientWidth) setWidth(el.clientWidth - safe.l - safe.r) }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [safe.l, safe.r])
  const cols = COLS_AT.find(([at]) => width >= at)?.[1] ?? 1
  // A phone keeps its width for the cards: a thin margin instead of the desk's.
  const pad = width > 0 && width < 560 ? 10 : 24
  const live = useMemo(() => input.protos.filter(p => !p.archived).sort((a, b) => b.created.localeCompare(a.created)), [input.protos])
  // The open card is the address's (/slug): choosing one moves there, and Back shuts it.
  const openId = input.open ?? ''
  const scope = input.scope ?? 'all', sid = scope.startsWith('conv:') ? scope.slice('conv:'.length) : ''
  const convs: Conv[] = useMemo(() => { try { return JSON.parse(input.convs || '[]') as Conv[] } catch { return [] } }, [input.convs])
  // The rows of the first screenful, counted across the sections, are drawn straight away.
  const same = { cols, pic, open, pick, agent: input.agent, openId, setOpenId: card, windowed: live.length > WINDOW_CARDS, firstRows: { left: 8 } }
  // One section on the page (only waiting, or only picked, and no past conversations under it) needs no panel.
  const past = sid === input.me && convs.some(c => c.sid !== sid)
  const alone = [live.some(p => !p.picked), live.some(p => !!p.picked), past].filter(Boolean).length === 1
  // A new scope starts at the top.
  useEffect(() => { scroller.current?.scrollTo({ top: 0 }) }, [scope])
  return (
    <div ref={scroller} data-gallery className={'absolute inset-0 overflow-y-auto overscroll-contain ' + (input.hidden ? 'hidden' : '')}
      style={{ paddingLeft: safe.l + pad, paddingRight: safe.r + pad, paddingTop: safe.t + 14, paddingBottom: safe.b + 120 }}>
      <style>{'@keyframes proto-gallery-rise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}'}</style>
      <div className="mx-auto max-w-[1600px]">
        {!width ? null : scope === 'favs' ? (live.length ? <Section id="favs" title={t('Favorites')} hint={t('From the whole project')} list={live} bare {...same} /> : <Empty text={t('No favorites yet')} />)
          : scope === 'all' ? convs.map(c => <Section key={c.sid} id={`conv:${c.sid}`} title={c.name || t('A past conversation')} hint={c.sid === input.me ? t('This conversation') : day(c.at)} list={live.filter(p => (p.session ?? '') === c.sid)} bare={convs.length === 1} {...same} />)
          : <>
            {sid !== input.me && <div className="mb-4 flex items-center gap-3">
              {input.me && <button type="button" data-gallery-back onClick={() => setScope(`conv:${input.me}`)} className="flex items-center gap-1.5 text-sm font-medium text-sky-600 hover:text-sky-700 dark:text-sky-400"><Ph name="caretRight" className="size-3 -scale-x-100 rtl:scale-x-100" />{t('Back to this conversation')}</button>}
              <span dir="auto" className="ms-auto text-sm text-zinc-500">{convs.find(c => c.sid === sid)?.name || t('A past conversation')}</span>
            </div>}
            {live.length ? <>
              <Section id="open" title={t('Waiting for a pick')} hint={t('Open a card to see its options')} list={live.filter(p => !p.picked)} bare={alone} {...same} />
              <Section id="picked" title={t('Picked')} hint={t('Each card shows its pick')} list={live.filter(p => p.picked)} bare={alone} {...same} />
            </> : <Empty text={t('Nothing from this conversation yet')} />}
            {past && <Past convs={convs.filter(c => c.sid !== sid)} setScope={setScope} />}
          </>}
      </div>
    </div>
  )
}
