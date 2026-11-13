// A round of decisions (options in place, #10 of its study): when the agent leaves several small
// decisions on a variant (elements marked data-tweak / data-copy, options.ts), a row on top of the
// comments island says how many and offers to walk them one by one. The round goes element by
// element, facet by facet: a spotlight on the element (lifted above the card when the card would
// cover it), "Step k of N", the question, big tiles in one row (pointing shows one, a click keeps it
// and moves on; 1 to 9 pick, Enter next, the arrows move), Keep as is, Skip, Original, and a progress
// bar of what each step came to. The end is a summary of every decision, each one opens its step
// again, with Send (the same batch the island's tray sends). See all collapses the card to a bar over
// the design (the design moves down under it) and brings back the dots and panels of options in
// place. Its X puts the card away; the tool strip's button (a phone's bar) brings it back.
//
// When: a variant with 3 or more elements with options the user has not looked at yet (opened their
// panel) gets the round offered; once offered there it stays offered. An element with
// data-round on the design offers it whatever the count; data-round="off" never. Never in a share,
// a framed view, a still (?hints=0) or comment mode, like the dots.
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { rtl, t, tn } from '../i18n'
import { options, spotsOf, chosen, isChanged, nameOf, choiceOf, type Facet, type Spot } from '../options'
import { useAgentName, useCtx } from './ctx'
import { keyOf, pictureOf } from './pictures'
import {
  CARD, HoldOriginal, Pic, SendButton, Strip, Tile, backdropOf, boxIn, fitOf, liftDesign, liftOf, still, useFacetPictures,
  useNarrow, useOptState, usePhase, useValues, type Decided, type OptActions, type OptStore, type RoundMode, type RoundRec,
} from './options'
import { IB, Icon, PRIMARY } from './ui'

export type Verdict = Decided
export type Step = { sp: Spot; f: Facet; k: number }
type Box = { x: number; y: number; w: number; h: number }

/** Every step of a round: each element's facets, in the order the elements come. */
export const stepsOf = (st: Element | null | undefined): Step[] => spotsOf(st).flatMap(sp => sp.facets.map((f, k) => ({ sp, f, k })))
/** What a step came to: a value other than today's is a change, whatever was said about it. */
export const verdictOf = (st: Element, decided: Record<string, Decided>, f: Facet): Decided | 'pending' =>
  isChanged(st, f) ? 'picked' : decided[f.key] === 'skipped' ? 'skipped' : decided[f.key] ? 'kept' : 'pending'

/** Whether the design offers a round: forced (data-round), by count (3 or more not looked at), off, or not (null). */
export function offerOf(st: HTMLElement, looked: string[]): 'forced' | 'auto' | 'off' | null {
  const mark = st.matches('[data-round]') ? st : st.querySelector<HTMLElement>('[data-round]')
  const v = mark?.getAttribute('data-round')
  if (v === 'off' || v === 'false') return 'off'
  const spots = spotsOf(st)
  if (!spots.length) return null
  if (mark) return 'forced'
  return spots.filter(sp => !looked.includes(sp.key)).length >= 3 ? 'auto' : null
}

export function createRoundActions(os: OptStore, act: OptActions) {
  const get = os.get
  const stage = () => get().stage
  const rec = (): RoundRec => get().rec.round ?? { decided: {} }
  const keep = (f: (r: RoundRec) => RoundRec) => os.keep(r => ({ ...r, round: f(r.round ?? { decided: {} }) }))
  const decide = (key: string, d: Decided) => keep(r => ({ ...r, decided: { ...r.decided, [key]: d } }))
  const steps = () => stepsOf(stage())
  let adv = 0
  const quiet = () => { clearTimeout(adv); const st = stage(); if (st) options.preview(st, null) }
  const ra = {
    steps,
    decided: () => rec().decided,
    /** What the chrome shows of the round: whether it is offered here, put away, its card, and how many decisions are open. */
    info() {
      const st = stage(), s = get()
      const list = st && s.roundOk ? steps() : []
      const offered = !!st && s.roundOk && !!rec().offered && list.length > 0 && offerOf(st, []) !== 'off'
      const open = offered ? list.filter(x => verdictOf(st!, rec().decided, x.f) === 'pending').length : 0
      return { offered, hidden: !!rec().hidden, mode: offered ? s.round : null, open, steps: list.length, spots: offered ? spotsOf(st).length : 0 }
    },
    /** The round's card on show over the design (at rest, a step or the summary): the dots wait. */
    up() { const i = ra.info(); return i.offered && !i.hidden && !!i.mode && i.mode !== 'browse' },
    /** The design's elements changed: offer the round when it should be. */
    offer() {
      const st = stage(), s = get()
      if (!st || !s.roundOk) return
      const o = offerOf(st, s.rec.looked ?? [])
      if (o === 'off' || (!o && !rec().offered)) { if (s.round) os.set({ round: null, cur: null }); return }
      if (!rec().offered) keep(r => ({ ...r, offered: true }))
      if (!get().round) os.set({ round: 'rest', cur: null, back: false })
      // The step on show went (the agent took its control out): back to rest.
      const cur = get().cur
      if (get().round === 'step' && cur && !steps().some(x => x.f.key === cur)) os.set({ round: 'rest', cur: null })
    },
    start() {
      const st = stage()
      if (!st) return
      const list = steps(), d = rec().decided
      const first = list.find(x => verdictOf(st, d, x.f) === 'pending') ?? list[0]
      if (first) ra.go(first.f.key)
    },
    /** Show a step; `back`: it returns to the summary once decided. */
    go(key: string, back = false) {
      const x = steps().find(y => y.f.key === key)
      if (!x) return
      quiet(); act.close()
      keep(r => ({ ...r, hidden: false }))
      os.set({ round: 'step', cur: key, back })
      act.look(x.sp.key)
    },
    advance() {
      quiet()
      const list = steps(), i = list.findIndex(x => x.f.key === get().cur)
      if (get().back || i < 0 || i === list.length - 1) { os.set({ round: 'summary', cur: null, back: false }); return }
      ra.go(list[i + 1].f.key)
    },
    prev() {
      const list = steps(), i = list.findIndex(x => x.f.key === get().cur)
      if (i > 0) ra.go(list[i - 1].f.key, get().back)
    },
    /** Pick an option of the step on show; `next`: move on a moment later (a click on a wide page,
     *  where pointing at it already showed it). */
    pick(i: number, next = false) {
      const st = stage(), x = steps().find(y => y.f.key === get().cur)
      if (!st || !x || !x.f.options[i]) return
      options.preview(st, null)
      options.choose(st, x.f, i)
      decide(x.f.key, i === x.f.today ? 'kept' : 'picked')
      clearTimeout(adv)
      if (next) { const at = x.f.key; adv = window.setTimeout(() => { if (get().round === 'step' && get().cur === at) ra.advance() }, 460) }
    },
    keepAsIs() {
      const st = stage(), x = steps().find(y => y.f.key === get().cur)
      if (!st || !x) return
      options.choose(st, x.f, x.f.today)
      decide(x.f.key, 'kept')
      ra.advance()
    },
    skip() {
      const x = steps().find(y => y.f.key === get().cur)
      if (!x) return
      if (!rec().decided[x.f.key]) decide(x.f.key, 'skipped')
      ra.advance()
    },
    /** Enter: what shows is the decision (today's, if nothing was picked), then the next step. */
    next() {
      const x = steps().find(y => y.f.key === get().cur)
      if (!x) return
      if (!rec().decided[x.f.key] || rec().decided[x.f.key] === 'skipped') decide(x.f.key, isChanged(stage()!, x.f) ? 'picked' : 'kept')
      ra.advance()
    },
    summary() { quiet(); act.close(); os.set({ round: 'summary', cur: null, back: false }) },
    seeAll() { quiet(); keep(r => ({ ...r, hidden: false })); os.set({ round: 'browse', cur: null, back: false }) },
    /** Out of a step, the summary or see-all, back to the row at rest; the progress stays. */
    leave() { quiet(); act.close(); os.set({ round: 'rest', cur: null, back: false }) },
    hide() { quiet(); act.close(); keep(r => ({ ...r, hidden: true })); os.set({ round: 'rest', cur: null, back: false }) },
    show() { keep(r => ({ ...r, hidden: false })); os.set({ round: 'rest', cur: null, back: false }) },
    /** The tool strip's button: brings the card back, or puts it away. */
    toggle() {
      const i = ra.info()
      if (!i.offered) return
      if (i.hidden) ra.show()
      else if (i.mode && i.mode !== 'rest') ra.leave()
      else ra.hide()
    },
    /** A click on an element with options (options.tsx): at rest it opens see-all with its panel; in a
     *  step or the summary it goes to that element's step. False: the click is the panel's. */
    clickSpot(key: string): boolean {
      const i = ra.info()
      if (!i.offered || i.hidden || !i.mode || i.mode === 'browse') return false
      if (i.mode === 'rest') { ra.seeAll(); act.open(key); return true }
      const x = steps().find(y => y.sp.key === key)
      if (x) ra.go(x.f.key, i.mode === 'summary')
      return true
    },
    escape(): boolean {
      const i = ra.info()
      if (!i.offered || i.hidden || !i.mode || i.mode === 'rest') return false
      ra.leave()
      return true
    },
  }
  return ra
}
export type RoundActions = ReturnType<typeof createRoundActions>

// ---------- the pieces ----------
const useRound = () => {
  const { optStore, roundAct } = useCtx()
  useOptState(optStore)
  useValues()
  return roundAct
}
/** Where the round may show: the design's own page, at rest (not commenting, not in copy mode). */
function useRoundOn() {
  const { store, copyStore, optStore } = useCtx()
  const s = useOptState(optStore)
  const mode = useSyncExternalStore(store.subscribe, () => store.get().mode.kind)
  const copying = useSyncExternalStore(copyStore.subscribe, () => copyStore.get().on)
  return !!s.stage && s.roundOk && mode === 'idle' && !copying
}

const VERDICT: Record<Decided, { bar: string; name: () => string }> = {
  picked: { bar: 'bg-proto-primary', name: () => t('Changed') },
  kept: { bar: 'bg-zinc-400 dark:bg-zinc-500', name: () => t('As it is') },
  skipped: { bar: 'bg-amber-400', name: () => t('Skipped') },
}
const facetName = (sp: Spot, f: Facet) => sp.facets.length > 1 ? `${sp.label} · ${f.kind === 'words' ? t('Words') : f.label}` : sp.label

/**
 * A segment per step, the steps of one element side by side; filled from the start. The step in
 * hand is tall and outlined; each decided one takes its verdict's color, named in a legend under the
 * bar (only the colors on it), and every segment says what it is on hover.
 */
function Progress({ steps, cur, onJump }: { steps: Step[]; cur: string | null; onJump?(key: string): void }) {
  const { optStore, roundAct } = useCtx()
  const st = optStore.get().stage!
  const decided = roundAct.decided()
  const groups: Step[][] = []
  for (const x of steps) { const g = groups.at(-1); if (g && g[0].sp.key === x.sp.key) g.push(x); else groups.push([x]) }
  const seen = new Set(steps.map(x => verdictOf(st, decided, x.f)).filter(v => v !== 'pending')) as Set<Decided>
  return (
    <div data-round-progress="">
      <div className="flex items-center gap-1" role="list" aria-label={t('Progress of the round')}>
        {groups.map(g => (
          <div key={g[0].sp.key} role="listitem" className="flex min-w-0 flex-1 gap-[2px]">
            {g.map(x => {
              const v = verdictOf(st, decided, x.f), now = x.f.key === cur
              const state = now ? t('Now') : v === 'pending' ? t('Not yet') : VERDICT[v].name()
              const name = `${facetName(x.sp, x.f)}: ${state}`
              return (
                <button key={x.f.key} type="button" data-round-segment={now ? 'now' : v} tabIndex={onJump ? 0 : -1} disabled={!onJump} onClick={() => onJump?.(x.f.key)}
                  aria-label={name} title={name} aria-current={now ? 'step' : undefined}
                  className="group grid min-w-0 flex-1 place-items-center py-1.5 disabled:cursor-default">
                  <span className={`block w-full rounded-full transition-[background-color,height] duration-200 ${now ? 'h-2.5 bg-white ring-2 ring-inset ring-proto-primary dark:bg-zinc-900' : `h-1.5 ${v === 'pending' ? 'bg-zinc-900/10 dark:bg-white/[.12]' : VERDICT[v].bar}`} ${onJump ? 'group-hover:brightness-90' : ''}`} />
                </button>
              )
            })}
          </div>
        ))}
      </div>
      {(seen.size > 0 || cur) && (
        <div data-round-legend="" className="flex flex-wrap items-center gap-x-3 gap-y-0.5 pb-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
          {cur && <span className="flex items-center gap-1"><span className="h-2 w-3 rounded-full ring-2 ring-inset ring-proto-primary" />{t('Now')}</span>}
          {(['picked', 'kept', 'skipped'] as Decided[]).filter(v => seen.has(v)).map(v => (
            <span key={v} data-round-legend-item={v} className="flex items-center gap-1"><span className={`h-1.5 w-3 rounded-full ${VERDICT[v].bar}`} />{VERDICT[v].name()}</span>
          ))}
        </div>
      )}
    </div>
  )
}

/** "Which row icon?": the facet's label as the step's question. */
const question = (f: Facet) => {
  const l = f.kind === 'words' ? t('Words') : f.label
  // "Row icon" reads as "row icon" in the middle of a sentence; "CTA" stays as it is.
  return t('Which {label}?', { label: /^[A-Z][a-z]/.test(l) ? l[0].toLowerCase() + l.slice(1) : l })
}

/** A step: the question, the progress, the tiles, and what moves on. */
function StepCard({ x, phone }: { x: Step; phone: boolean }) {
  const { optStore, roundAct } = useCtx()
  const s = useOptState(optStore)
  const phase = usePhase()
  const st = s.stage!
  const list = roundAct.steps()
  const i = list.findIndex(y => y.f.key === x.f.key)
  const spotsN = new Set(list.map(y => y.sp.key)).size
  const spotNo = [...new Set(list.slice(0, i + 1).map(y => y.sp.key))].length
  const decided = roundAct.decided()
  const settled = !!decided[x.f.key] && decided[x.f.key] !== 'skipped'
  const f = x.f, n = f.options.length, now = chosen(st, f)
  const el = x.sp.els[0]
  const bg = el ? backdropOf(el) : 'transparent'
  // Drawn once the design has moved into the spotlight (its still is laid over the element meanwhile).
  const { pics, drawing } = useFacetPictures(x.sp, f, { delay: 480 })
  const pv = options.previewed()
  const k = fitOf(pics, phone ? 84 : 92, phone ? 68 : 72)
  const sent = phase === 'sent'
  const preview = (j: number) => (on: boolean) => {
    if (sent || phone || drawing) return
    if (on) options.preview(st, f, j)
    else { const p = options.previewed(); if (p?.key === f.key && p.index === j) options.preview(st, null) }
  }
  const tiles = f.options.map((_, j) => (
    <Tile key={`${f.key}-${j}`} f={f} i={j} pic={pics[j]} k={k} bg={bg} big drawing={drawing} disabled={sent}
      chosenNow={now === j && (settled || isChanged(st, f))} previewed={pv?.key === f.key && pv.index === j && now !== j}
      num={phone || j > 8 ? undefined : j + 1}
      onPreview={preview(j)} onPick={() => roundAct.pick(j, !phone)} />
  ))
  const h = phone ? 'h-10 text-[14px]' : 'h-8 text-[13px]'
  return (
    <div data-round-step={f.key}>
      <div className="flex items-start gap-2 pe-2 ps-4 pt-2.5">
        <div className="min-w-0 flex-1 pt-1">
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[12px] text-zinc-500">
            <span data-round-count="">{t('Step {k} of {n}', { k: spotNo, n: spotsN })}</span>
            <span aria-hidden className="size-[3px] rounded-full bg-zinc-300 dark:bg-zinc-600" />
            <span dir="auto" className="font-medium text-zinc-700 dark:text-zinc-300">{x.sp.label}</span>
            {x.sp.facets.length > 1 && (
              <span className="flex gap-1">
                {x.sp.facets.map(y => <span key={y.key} className={`rounded-full px-1.5 py-px text-[11px] ${y.key === f.key ? 'bg-zinc-900 font-medium text-white dark:bg-white dark:text-zinc-900' : 'bg-zinc-900/[.06] text-zinc-500 dark:bg-white/10'}`}>{y.kind === 'words' ? t('Words') : y.label}</span>)}
              </span>
            )}
          </div>
          <div data-round-question="" dir="auto" className="mt-0.5 text-[16px] font-semibold leading-snug">{question(f)}</div>
        </div>
        <button type="button" data-round-close="" onClick={roundAct.leave} aria-label={t('Stop here, the progress is kept')} title={`${t('Stop here, the progress is kept')} · Esc`} className={`${IB} ${phone ? '!size-10' : ''} rounded-full`}><Icon name="x" className="size-4" /></button>
      </div>
      <div className="px-4"><Progress steps={list} cur={f.key} onJump={sent ? undefined : key => roundAct.go(key, s.back)} /></div>
      {x.sp.els.length > 1 && <p className="px-4 pb-0.5 text-[12px] text-zinc-500">{tn(x.sp.els.length, 'Changes all {n} of them together', 'Changes all {n} of them together')}</p>}
      <div className="px-3 pt-2" onPointerLeave={() => { if (options.previewed()?.key === f.key) options.preview(st, null) }}>
        {f.kind === 'words'
          ? <div className="flex flex-col gap-0.5">{tiles}</div>
          : n > 4
            ? <Strip pick={Math.max(0, now)} big>{tiles.map((tile, j) => <div key={j} className={`${phone ? 'w-[92px]' : 'w-[100px]'} shrink-0 snap-start`}>{tile}</div>)}</Strip>
            : <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${n}, minmax(0,1fr))` }}>{tiles}</div>}
      </div>
      <div className={`flex items-center gap-0.5 px-2 pt-1.5 ${phone ? 'pb-1' : 'pb-2'}`}>
        <button type="button" data-round-prev="" onClick={roundAct.prev} disabled={i <= 0} aria-label={t('The step before')} title={t('The step before')} className={`${IB} rounded-full disabled:opacity-30 ${phone ? '!size-10' : ''}`}><Icon name={rtl ? 'right' : 'left'} className="size-3.5 rtl:-scale-x-100" /></button>
        <button type="button" data-round-keep="" onClick={roundAct.keepAsIs} disabled={sent}
          className={`rounded-full px-3 font-medium text-zinc-700 hover:bg-zinc-900/5 disabled:opacity-40 dark:text-zinc-200 dark:hover:bg-white/10 ${h}`}>{t('Keep as is')}</button>
        {phone && settled
          ? <button type="button" data-round-next="" onClick={roundAct.next} className={`flex h-11 items-center gap-1 rounded-full px-4 text-[14px] font-semibold ${PRIMARY}`}>{i === list.length - 1 || s.back ? t('To the summary') : t('Next')}<Icon name="right" className="size-3.5" /></button>
          : <button type="button" data-round-skip="" onClick={roundAct.skip} className={`rounded-full px-3 font-medium text-zinc-500 hover:bg-zinc-900/5 dark:hover:bg-white/10 ${h}`}>{t('Skip')}</button>}
        {!phone && <span className="ms-auto whitespace-nowrap pe-1 text-[11px] text-zinc-400">{t('{range} to pick · Enter next', { range: `1–${Math.min(9, n)}` })}</span>}
        <span className={phone ? 'ms-auto' : ''}><HoldOriginal compact={phone} big={phone} /></span>
      </div>
    </div>
  )
}

/** The small picture of what a step shows now: its chosen option's picture, a swatch, or its words. */
function Now({ x }: { x: Step }) {
  const { optStore } = useCtx()
  const st = optStore.get().stage!
  const f = x.f, i = chosen(st, f), el = x.sp.els[0]
  const v = choiceOf(st, f)
  if (f.kind === 'color' && typeof v === 'string') return <span className="size-5 rounded-full ring-1 ring-black/10 dark:ring-white/15" style={{ background: v }} />
  if (f.kind === 'words') return <span dir="auto" className="max-w-full truncate px-1 text-[10px] font-bold leading-none">{nameOf(st, f)}</span>
  const pic = el && i >= 0 ? pictureOf(keyOf(st, x.sp, f), i) : undefined
  return still(pic) ? <Pic pic={pic} w={56} k={fitOf([pic], 56, 30)} /> : f.kind === 'toggle' && v === false ? <Pic pic="empty" w={0} k={1} /> : <span className="size-1.5 rounded-full bg-proto-primary" />
}

/** The end: every decision as a tile (numbered when it changed), each opening its step again, and Send. */
function SummaryCard({ phone }: { phone: boolean }) {
  const { optStore, optAct, roundAct } = useCtx()
  const s = useOptState(optStore)
  const phase = usePhase()
  const st = s.stage!
  const list = roundAct.steps(), decided = roundAct.decided()
  const [hot, setHot] = useState<string | null>(null)
  const pending = optAct.pending()
  const count = (v: Decided | 'pending') => list.filter(x => verdictOf(st, decided, x.f) === v).length
  const changed = list.filter(x => verdictOf(st, decided, x.f) === 'picked')
  const hx = hot ? list.find(x => x.f.key === hot) : undefined
  const sent = phase === 'sent'
  // Two rows of six show whole; past twelve the grid scrolls inside, with a fade where it continues.
  const scrolls = list.length > 12
  const line = [count('picked') && tn(count('picked'), '{n} change', '{n} changes'), count('kept') && tn(count('kept'), '{n} as it was', '{n} as they were'), count('skipped') && tn(count('skipped'), '{n} skipped', '{n} skipped'), count('pending') && tn(count('pending'), '{n} not yet', '{n} not yet')].filter(Boolean).join(' · ')
  return (
    <div data-round-summary="" className="flex max-h-full min-h-0 flex-col">
      <div className="flex items-start gap-2 pe-2 ps-4 pt-2.5">
        <div className="min-w-0 flex-1 pt-1">
          <div className="text-[16px] font-semibold leading-snug">{t('Summary of the round')}</div>
          <div data-round-summary-line="" className="mt-0.5 flex min-w-0 items-center gap-1 text-[12px] text-zinc-500">
            {hx
              ? isChanged(st, hx.f)
                ? <><span dir="auto" className="font-medium text-zinc-700 dark:text-zinc-300">{facetName(hx.sp, hx.f)}:</span><span dir="auto" className="line-through decoration-zinc-400">{hx.f.options[hx.f.today]?.name}</span><Icon name="right" className="size-2.5 shrink-0" /><span dir="auto" className="font-medium text-zinc-800 dark:text-zinc-200">{nameOf(st, hx.f)}</span></>
                : <><span dir="auto" className="font-medium text-zinc-700 dark:text-zinc-300">{facetName(hx.sp, hx.f)}:</span><span dir="auto">{nameOf(st, hx.f)}, {decided[hx.f.key] === 'skipped' ? t('Skipped').toLowerCase() : decided[hx.f.key] ? t('As it is').toLowerCase() : t('Not yet').toLowerCase()}</span></>
              : <span className="truncate">{line}</span>}
          </div>
        </div>
        <button type="button" data-round-close="" onClick={roundAct.leave} aria-label={t('Close')} title={`${t('Close')} · Esc`} className={`${IB} ${phone ? '!size-10' : ''} rounded-full`}><Icon name="x" className="size-4" /></button>
      </div>
      <div className="relative min-h-0">
        <div data-round-grid="" className={`grid min-h-0 gap-1.5 overflow-y-auto overscroll-contain px-3 pb-1 pt-2 ${phone ? 'grid-cols-4' : 'grid-cols-6'} ${scrolls ? (phone ? 'max-h-[160px] pb-4' : 'max-h-[178px] pb-4') : ''}`}>
          {list.map((x, n) => {
            const v = verdictOf(st, decided, x.f), no = v === 'picked' ? changed.indexOf(x) + 1 : 0
            return (
              <button key={x.f.key} type="button" data-round-tile={x.f.key} data-verdict={v} disabled={sent}
                style={{ animationDelay: `${60 + Math.min(n, 14) * 22}ms` }}
                onPointerEnter={e => { if (e.pointerType === 'mouse') setHot(x.f.key) }} onPointerLeave={() => setHot(null)} onFocus={() => setHot(x.f.key)} onBlur={() => setHot(null)}
                onClick={() => roundAct.go(x.f.key, true)} aria-label={`${facetName(x.sp, x.f)}: ${nameOf(st, x.f)}`}
                className={`relative flex h-[66px] min-w-0 animate-[proto-isl-rise_.3s_ease-out_both] flex-col items-center justify-center gap-1 rounded-xl px-1 transition-colors ${v === 'picked' ? 'bg-proto-primary-soft ring-[1.5px] ring-inset ring-proto-primary/45' : v === 'pending' ? 'border border-dashed border-zinc-300 dark:border-zinc-600' : 'bg-zinc-900/[.04] dark:bg-white/[.06]'} ${sent ? '' : 'hover:brightness-95 dark:hover:brightness-125'}`}>
                <span className="grid h-7 max-w-full place-items-center overflow-hidden"><Now x={x} /></span>
                <span dir="auto" className={`max-w-full truncate text-[11px] leading-none ${v === 'picked' ? 'font-semibold text-proto-primary-soft-fg' : v === 'skipped' ? 'text-amber-700 dark:text-amber-400' : 'text-zinc-600 dark:text-zinc-400'}`}>{x.sp.facets.length > 1 ? (x.f.kind === 'words' ? t('Words') : x.f.label) : x.sp.label}</span>
                {no > 0 ? <span className="absolute start-1 top-1 grid size-4 place-items-center rounded-full bg-proto-primary text-[9px] font-bold tabular-nums text-white">{no}</span>
                  : v === 'skipped' ? <span className="absolute start-1.5 top-1.5 size-1.5 rounded-full bg-amber-400" /> : null}
              </button>
            )
          })}
        </div>
        {scrolls && <span aria-hidden data-round-fade="" className="pointer-events-none absolute inset-x-3 bottom-0 h-6 bg-gradient-to-t from-white to-transparent dark:from-zinc-900" />}
      </div>
      <div className="flex items-center gap-1 border-t border-black/[.06] px-2 py-2 dark:border-white/[.08]">
        <span className="ms-auto flex items-center gap-1">
          {pending.length > 0 && !sent && <HoldOriginal big={phone} />}
          {pending.length > 0
            ? <SendButton n={pending.length} sending={s.sending} phone={phone} onSend={() => void optAct.send().then(() => { if (!optStore.get().error) roundAct.leave() })} />
            : <button type="button" data-round-done="" onClick={roundAct.leave} className={`rounded-full bg-zinc-900/[.05] px-4 font-medium dark:bg-white/[.07] ${phone ? 'h-10 text-[14px]' : 'h-8 text-[12px]'}`}>{t('Done')}</button>}
        </span>
      </div>
      {s.error && <p role="alert" className="mx-3 mb-2 rounded-lg bg-rose-500/10 px-2.5 py-1.5 text-xs text-rose-700 dark:text-rose-300">{s.error}</p>}
    </div>
  )
}

/** See all: the card as a bar; every element has its dot and panel again. */
function BrowseBar({ phone }: { phone: boolean }) {
  const { optStore, optAct, roundAct } = useCtx()
  const s = useOptState(optStore)
  const phase = usePhase()
  const pending = optAct.pending()
  return (
    <div data-round-browse="" className={`flex items-center gap-1.5 ${phone ? 'px-3 pb-1 pt-2' : 'p-1.5 ps-3'}`}>
      <span className="grid size-7 shrink-0 place-items-center rounded-full bg-proto-primary-soft text-proto-primary"><Icon name="map" className="size-4" /></span>
      <div className="min-w-0 flex-1 leading-tight">
        <div className="truncate text-[13px] font-semibold">{t('Every decision on the design')}</div>
        <div className="truncate text-[11px] text-zinc-500">{pending.length ? tn(pending.length, '{n} change', '{n} changes') : phone ? t('Tap an element to open it') : t('Click an element to open it')}</div>
      </div>
      {pending.length > 0 && phase !== 'sent' && <HoldOriginal compact big={phone} />}
      {pending.length > 0
        ? <SendButton n={pending.length} sending={s.sending} phone={phone} onSend={() => void optAct.send()} />
        : <button type="button" data-round-start="" onClick={roundAct.start} className={`flex shrink-0 items-center gap-1 rounded-full px-3 font-semibold ${PRIMARY} ${phone ? 'h-10 text-[14px]' : 'h-8 text-[12px]'}`}>{t('To the round')}<Icon name="right" className="size-3" /></button>}
      <button type="button" data-round-close="" onClick={roundAct.leave} aria-label={t('Close')} title={`${t('Close')} · Esc`} className={`${IB} rounded-full ${phone ? '!size-10' : ''}`}><Icon name="x" className="size-4" /></button>
    </div>
  )
}

// ---------- at rest: a row on top of the comments island ----------
/** Whether the island shows the round's row (for its width). */
export function useRoundTray() {
  const ra = useRound()
  const on = useRoundOn()
  const i = ra.info()
  return on && i.offered && !i.hidden && i.mode === 'rest'
}

export function RoundTray({ phone = false }: { phone?: boolean }) {
  const { optStore, roundAct } = useCtx()
  const s = useOptState(optStore)
  useValues()
  const on = useRoundOn()
  const agent = useAgentName()
  const phase = usePhase()
  const i = roundAct.info()
  if (!on || !i.offered || i.hidden || i.mode !== 'rest') return null
  const st = s.stage!
  const list = roundAct.steps(), decided = roundAct.decided()
  const doneN = list.filter(x => verdictOf(st, decided, x.f) !== 'pending').length
  const first = list.find(x => verdictOf(st, decided, x.f) === 'pending')
  const spotsN = new Set(list.map(x => x.sp.key)).size
  const at = first ? [...new Set(list.slice(0, list.indexOf(first) + 1).map(x => x.sp.key))].length : spotsN
  const changedN = list.filter(x => isChanged(st, x.f)).length
  const title = doneN === 0 ? tn(spotsN, '{agent} left {n} small decision', '{agent} left {n} small decisions', { agent }) : doneN >= list.length ? t('The round is done') : t('Stopped at step {k} of {n}', { k: at, n: spotsN })
  const sub = doneN === 0 ? t('One after another, about a minute') : changedN ? tn(changedN, '{n} change so far', '{n} changes so far') : t('No changes so far')
  const btn = phone ? 'h-10 text-[14px]' : 'h-8 text-[12px]'
  return (
    <div data-round-rest="" className={`animate-[proto-isl-rise_.3s_ease-out] border-b border-black/[.06] dark:border-white/[.08] ${phone ? 'px-3 pb-2 pt-2.5' : 'p-1.5 pb-2'}`}>
      <div className="flex items-center gap-2 ps-1.5">
        <span className={`grid shrink-0 place-items-center rounded-full bg-proto-primary-soft text-proto-primary ${phone ? 'size-9' : 'size-8'}`}><Icon name="list-checks" className="size-4" /></span>
        <div className="min-w-0 flex-1">
          <div data-round-title="" className={`truncate font-semibold leading-tight ${phone ? 'text-[14px]' : 'text-[13px]'}`}>{title}</div>
          <div className="truncate text-[11px] text-zinc-500">{sub}</div>
        </div>
        {!phone && (doneN === 0
          ? <button type="button" data-round-see-all="" onClick={roundAct.seeAll} className={`shrink-0 rounded-full px-2.5 font-medium text-zinc-600 hover:bg-zinc-900/5 dark:text-zinc-300 dark:hover:bg-white/10 ${btn}`}>{t('See all')}</button>
          : <button type="button" data-round-to-summary="" onClick={roundAct.summary} className={`shrink-0 rounded-full px-2.5 font-medium text-zinc-600 hover:bg-zinc-900/5 dark:text-zinc-300 dark:hover:bg-white/10 ${btn}`}>{t('To the summary')}</button>)}
        {!phone && doneN < list.length && <button type="button" data-round-start="" onClick={roundAct.start} disabled={phase === 'sent'} className={`flex shrink-0 items-center gap-1 rounded-full px-3 font-semibold disabled:opacity-40 ${PRIMARY} ${btn}`}>{doneN === 0 ? t('Start') : t('Continue')}<Icon name="right" className="size-3" /></button>}
        <button type="button" data-round-hide="" onClick={roundAct.hide} aria-label={t('Put the round away')} title={t('Put the round away · the tool strip brings it back')} className={`${IB} shrink-0 rounded-full ${phone ? '!size-10' : ''}`}><Icon name="x" className="size-3.5" /></button>
      </div>
      {doneN > 0 && <div className="px-1.5 pt-1"><Progress steps={list} cur={null} /></div>}
      {phone && (
        <div className="flex items-center gap-1.5 pt-2">
          {doneN < list.length && <button type="button" data-round-start="" onClick={roundAct.start} disabled={phase === 'sent'} className={`flex h-11 flex-1 items-center justify-center gap-1.5 rounded-full text-[15px] font-semibold disabled:opacity-40 ${PRIMARY}`}>{doneN === 0 ? t('Start') : t('Continue')}<Icon name="right" className="size-3.5" /></button>}
          <button type="button" data-round-see-all="" onClick={doneN === 0 ? roundAct.seeAll : roundAct.summary} className={`h-11 rounded-full px-3 text-[14px] font-medium text-zinc-600 dark:text-zinc-300 ${doneN >= list.length ? 'flex-1 bg-zinc-900/[.05] dark:bg-white/[.07]' : ''}`}>{doneN === 0 ? t('See all') : t('To the summary')}</button>
        </div>
      )}
    </div>
  )
}

// ---------- over the stage: the spotlight, the step and summary cards, the see-all bar ----------
/** The island's top over the layer when it sits along the bottom (the cards stay above it), else null. */
function islandTop(layer: HTMLElement) {
  const isl = document.querySelector<HTMLElement>('[data-island]')?.getBoundingClientRect(), r = layer.getBoundingClientRect()
  if (!isl || !isl.height || isl.top - r.top < r.height / 2) return null
  return isl.top - r.top
}

export function RoundLayer() {
  const { host, optStore, roundAct } = useCtx()
  const s = useOptState(optStore)
  useValues()
  const on = useRoundOn()
  const phone = useNarrow()
  const st = s.stage
  const i = roundAct.info()
  const spotKeys = st && on ? spotsOf(st).map(x => x.key).join('\n') : ''
  // Offered once the design's elements are known (and again when they change).
  useEffect(() => { if (on) roundAct.offer() }, [on, spotKeys, st, roundAct])
  const visible = on && i.offered && !i.hidden && (i.mode === 'step' || i.mode === 'summary' || i.mode === 'browse')
  const mode = visible ? i.mode : null
  const step = mode === 'step' ? roundAct.steps().find(x => x.f.key === s.cur) ?? null : null
  const card = useRef<HTMLDivElement>(null)
  const [geo, setGeo] = useState<{ foot: number; focus: Box | null; design: Box | null; W: number; H: number }>({ foot: 16, focus: null, design: null, W: 0, H: 0 })

  // Measured every frame while a card shows: the island's place, the element in hand, the design.
  useEffect(() => {
    if (!mode || !st) return
    let raf = 0, last = ''
    const tick = () => {
      const layer = host.layer, top = islandTop(layer)
      const el = step?.sp.els[0]
      const focus = el?.isConnected ? boxIn(el, layer) : null
      const r = (n: number) => Math.round(n)
      const next = { foot: top === null ? 16 : Math.max(16, layer.clientHeight - top + 12), focus: focus && { x: r(focus.x), y: r(focus.y), w: r(focus.w), h: r(focus.h) }, design: (b => ({ x: r(b.x), y: r(b.y), w: r(b.w), h: r(b.h) }))(boxIn(st, layer)), W: layer.clientWidth, H: layer.clientHeight }
      const sig = JSON.stringify(next)
      if (sig !== last) { last = sig; setGeo(next) }
      raf = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [mode, st, step?.sp.key, host]) // eslint-disable-line react-hooks/exhaustive-deps

  // The design moves out of the way, from where it would be without the round: the element in hand
  // above the step card, the design under see-all's bar. Back when the card goes.
  useLayoutEffect(() => {
    if (!st) return
    if (!mode || mode === 'summary') { liftDesign(st, 'round', 0); return }
    const f = requestAnimationFrame(() => {
      const layer = host.layer, was = liftOf('round'), c = card.current?.getBoundingClientRect(), lr = layer.getBoundingClientRect()
      if (!c) return
      if (mode === 'browse') {
        if (phone) { liftDesign(st, 'round', 0); return }
        const d = boxIn(st, layer), top = d.y - was
        liftDesign(st, 'round', Math.max(0, c.bottom - lr.top + 12 - top))
        return
      }
      const el = step?.sp.els[0]
      if (!el) return
      // Off the screen altogether: scrolled to first.
      const b0 = boxIn(el, layer)
      if (b0.y + b0.h < 0 || b0.y > layer.clientHeight) el.scrollIntoView({ block: 'center' })
      const b = boxIn(el, layer), y = b.y - was, room = c.top - lr.top - 20
      let by = 0
      if (y + b.h > room) by = room - (y + b.h)
      if (y + by < 12) by = 12 - y
      liftDesign(st, 'round', Math.min(0, by))
    })
    return () => cancelAnimationFrame(f)
  }, [mode, st, step?.f.key, phone, host, s.tab, geo.foot]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { if (st) liftDesign(st, 'round', 0) }, [st])
  useEffect(() => { if (!on && st) liftDesign(st, 'round', 0) }, [on, st])

  // The step's keys, in the page and in a device view's frame: 1 to 9 pick, Enter decides and moves
  // on, the arrows move (forward skips a step not decided), never the variants.
  useEffect(() => {
    if (mode !== 'step' || !st) return
    const docs = [...new Set([document, st.ownerDocument])]
    const down = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return
      const tg = e.target as HTMLElement | null
      if (tg?.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"], [data-options-pop], [data-composer]')) return
      const x = roundAct.steps().find(y => y.f.key === optStore.get().cur)
      if (!x) return
      const FWD = rtl ? 'ArrowLeft' : 'ArrowRight', BACK = rtl ? 'ArrowRight' : 'ArrowLeft'
      const d = /^[1-9]$/.test(e.key) ? Number(e.key) : /^Digit[1-9]$/.test(e.code) ? Number(e.code.slice(5)) : 0
      if (d && d <= x.f.options.length) roundAct.pick(d - 1, !phone)
      else if (e.key === 'Enter') roundAct.next()
      else if (e.key === FWD) roundAct.skip()
      else if (e.key === BACK) roundAct.prev()
      else return
      e.preventDefault(); e.stopImmediatePropagation()
    }
    for (const d of docs) d.addEventListener('keydown', down, true)
    return () => { for (const d of docs) d.removeEventListener('keydown', down, true) }
  }, [mode, st, phone, roundAct, optStore])

  // A card on its way out plays its exit first.
  const [gone, setGone] = useState<{ mode: RoundMode; key: string | null } | null>(null)
  const was = useRef<{ mode: RoundMode | null; key: string | null }>({ mode: null, key: null })
  useEffect(() => {
    const prev = was.current
    was.current = { mode, key: s.cur }
    if (prev.mode && prev.mode !== mode && (prev.mode === 'summary' || !mode)) {
      setGone({ mode: prev.mode, key: prev.key })
      const tm = setTimeout(() => setGone(null), 190)
      return () => clearTimeout(tm)
    }
  }, [mode]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!st || !on) return null
  const out = !mode && gone ? gone.mode : null
  const shown = mode ?? out
  if (!shown) return null
  const g = geo, pad = 6
  const width = phone ? g.W : Math.min(480, g.W - 32)
  const enter = out ? 'animate-[proto-isl-out_.19s_ease-in_forwards]' : 'animate-[proto-isl-rise_.3s_cubic-bezier(.2,.9,.25,1)]'
  const body: ReactNode = shown === 'step' && step ? <StepCard x={step} phone={phone} /> : shown === 'summary' ? <SummaryCard phone={phone} /> : shown === 'browse' ? <BrowseBar phone={phone} /> : null
  if (!body) return null
  // See all: a bar at the top of the stage as wide as the design (the design moved down under it); on a phone above the island.
  if (shown === 'browse' && !phone) {
    const d = g.design, w = Math.max(340, Math.min(d ? d.w : 480, g.W - 16, 560)), left = d ? Math.max(8, Math.min(g.W - w - 8, d.x + d.w / 2 - w / 2)) : (g.W - w) / 2
    return (
      <div className="pointer-events-none absolute inset-0 z-30" data-round-layer="">
        <div ref={card} key="browse" className={`pointer-events-auto absolute top-3 overflow-hidden rounded-[22px] ${enter} ${CARD}`} style={{ left, width: w }}>{body}</div>
      </div>
    )
  }
  const f = shown === 'step' && g.focus
  return (
    <div className="pointer-events-none absolute inset-0 z-30 overflow-hidden" data-round-layer="">
      {f && (
        <div aria-hidden data-round-spotlight="" className="absolute rounded-[14px] transition-[left,top,width,height] duration-300 ease-[cubic-bezier(.2,.9,.25,1)] [--dim:rgb(24_24_27/.38)] dark:[--dim:rgb(0_0_0/.62)]"
          style={{ left: f.x - pad, top: f.y - pad, width: f.w + pad * 2, height: f.h + pad * 2, boxShadow: '0 0 0 1.5px var(--color-proto-primary, #4f46e5), 0 0 0 6px rgb(99 102 241 / .2), 0 0 0 200vmax var(--dim)' }} />
      )}
      <div className={`absolute flex justify-center ${phone ? 'inset-x-0' : 'inset-x-4'}`} style={{ bottom: phone ? g.foot - 12 : g.foot, top: 64 }}>
        <div className="flex h-full w-full flex-col items-center justify-end">
          <div ref={card} key={shown === 'step' ? 'step' : shown} data-round-card={shown}
            className={`pointer-events-auto flex max-h-full min-h-0 flex-col overflow-hidden ${phone ? 'rounded-t-[22px] bg-white pb-3 text-zinc-900 shadow-[0_-12px_30px_-16px_rgb(0_0_0/.35)] ring-1 ring-black/[.06] dark:bg-zinc-900 dark:text-zinc-100 dark:ring-white/10' : `rounded-[22px] ${CARD}`} ${enter}`}
            style={{ width }}>
            {phone && <div className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-zinc-300 dark:bg-zinc-700" />}
            {body}
          </div>
        </div>
      </div>
    </div>
  )
}
