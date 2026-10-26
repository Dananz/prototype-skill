// The bar at the bottom of a wide screen: which design is selected, the way to the others (page
// dots, or past seven designs a counter with a list of all of them), and the zoom. Phase 1 adds
// a second row under it for comments. On a phone the same list is the switcher (named).
import { useEffect, useRef, useState, useSyncExternalStore, type MutableRefObject, type RefObject } from 'react'
import { Popover } from '@base-ui/react/popover'
import { rtl, t, tn } from '../i18n'
import { Icon, card, iconBtn, popup, type Api, type Screen, type Store } from './ui'

const dir = rtl ? 'rtl' : 'ltr'

/** full: a design is open full size; the bar then steps between designs in full view and leads back to the desk. */
export function Bar({ screens, i, go, step, store, api, root, full, back }: {
  screens: Screen[]; i: number; go: (key: string) => void; step: (d: number) => void; store: Store; api: MutableRefObject<Api | null>; root: RefObject<HTMLDivElement | null>
  full: boolean; back: () => void
}) {
  const cur = screens[i]
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 px-3 pt-2.5 pb-[max(12px,env(safe-area-inset-bottom))]">
      <div data-viewer-bar dir={dir} className={`${card} pointer-events-auto mx-auto flex max-w-[540px] flex-col rounded-[24px] p-1.5 shadow-[0_18px_40px_-12px_rgba(0,0,0,.5)]`}>
        <div className="flex h-9 shrink-0 items-center gap-1 ps-3 pe-1">
          <p className="min-w-0 flex-1 truncate text-[13px]">
            <span className="text-zinc-400 tabular-nums">#{cur.n}</span> <span className="font-semibold">{cur.name}</span>
          </p>
          {full
            ? <>
              <div className="flex shrink-0 items-center">
                <button data-prev onClick={() => step(-1)} disabled={i === 0} className={`${iconBtn} size-7 disabled:opacity-30`} aria-label={t('Previous design')}><Icon name="caret-left" className="size-4" /></button>
                <span className="px-1 text-[12px] text-zinc-500 tabular-nums dark:text-zinc-400">{t('{i} of {n}', { i: i + 1, n: screens.length })}</span>
                <button data-next onClick={() => step(1)} disabled={i === screens.length - 1} className={`${iconBtn} size-7 disabled:opacity-30`} aria-label={t('Next design')}><Icon name="caret-right" className="size-4" /></button>
              </div>
              <div className="ms-1 flex shrink-0 items-center border-s border-zinc-200 ps-1.5 dark:border-white/10">
                <button data-back onClick={back} title={t('All designs (Esc)')}
                  className="inline-flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-medium text-zinc-600 hover:bg-zinc-900/5 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-white/10 dark:hover:text-zinc-100">
                  <Icon name="grid" className="size-3.5" />{t('All designs')}
                </button>
              </div>
            </>
            : screens.length > 7
            ? <Jump screens={screens} i={i} go={go} step={step} root={root} />
            : <div className="flex items-center" role="tablist" aria-label={t('Designs')}>
              {screens.map((s, k) => (
                <button key={s.key} role="tab" aria-selected={k === i} aria-label={`#${s.n} ${s.name}`} onClick={() => go(s.key)} className="grid h-7 w-5 place-items-center">
                  <span className={`block h-1.5 rounded-full transition-all duration-300 motion-reduce:transition-none ${k === i ? 'w-4 bg-sky-500' : 'w-1.5 bg-zinc-300 dark:bg-zinc-600'}`} />
                </button>
              ))}
            </div>}
          {!full && <ZoomControls store={store} api={api} />}
        </div>
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- the zoom: the readout, Fit, 100% */

function ZoomControls({ store, api }: { store: Store; api: MutableRefObject<Api | null> }) {
  const { z, fit } = useSyncExternalStore(store.sub, store.get)
  const pct = Math.round(z * 100)
  const seg = 'inline-flex h-7 items-center rounded-lg px-2 text-[12px] font-medium transition-colors motion-reduce:transition-none'
  const off = 'text-zinc-500 hover:bg-zinc-900/5 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-zinc-100'
  const on = 'bg-sky-500/12 text-sky-600 dark:text-sky-400'
  return (
    <div className="ms-1 flex shrink-0 items-center gap-0.5 border-s border-zinc-200 ps-1.5 dark:border-white/10">
      <button onClick={() => api.current?.by?.(1 / 1.25)} className={`${iconBtn} size-7`} aria-label={t('Zoom out')} title={t('Zoom out (−)')}><Icon name="minus" className="size-3.5" /></button>
      <output data-zoom-readout aria-live="polite" aria-label={t('Zoom')} dir="ltr" className="w-10 text-center text-[12px] font-semibold tabular-nums">{pct}%</output>
      <button onClick={() => api.current?.by?.(1.25)} className={`${iconBtn} size-7`} aria-label={t('Zoom in')} title={t('Zoom in (+)')}><Icon name="plus" className="size-3.5" /></button>
      <button data-fit onClick={() => api.current?.fit?.()} aria-pressed={fit} className={`${seg} ${fit ? on : off}`} title={t('Fit every design (0)')}>{t('Fit')}</button>
      <button onClick={() => api.current?.actual?.()} aria-pressed={pct === 100} dir="ltr" className={`${seg} tabular-nums ${pct === 100 ? on : off}`} title={t('Actual size (1)')}>100%</button>
    </div>
  )
}

/* ---------------------------------------------------------------- many designs: counter, prev/next, the list */

/** ‹ n of N ⌄ › with the list of every design. named: the phone's switcher, `‹ #n Name · i/N ⌄ ›`. */
export function Jump({ screens, i, go, step, root, named }: {
  screens: Screen[]; i: number; go: (key: string) => void; step: (d: number) => void; root: RefObject<HTMLDivElement | null>; named?: boolean
}) {
  const [open, setOpen] = useState(false)
  const list = useRef<HTMLDivElement>(null)
  // Opening scrolls the list to the design in view.
  useEffect(() => { if (open) requestAnimationFrame(() => list.current?.querySelector('[aria-current]')?.scrollIntoView({ block: 'center' })) }, [open])
  return (
    <div className="flex shrink-0 items-center">
      <button data-prev onClick={() => step(-1)} disabled={i === 0} className={`${iconBtn} size-7 disabled:opacity-30`} aria-label={t('Previous design')}><Icon name="caret-left" className="size-4" /></button>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger data-switcher={named ? '' : undefined} aria-label={t('Design {i} of {n}. Jump to a design', { i: i + 1, n: screens.length })}
          className={`inline-flex h-7 items-center gap-1 rounded-lg px-1.5 ${named ? 'text-[13px]' : 'text-[12px]'} text-zinc-500 tabular-nums hover:bg-zinc-900/5 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-zinc-100`}>
          {named
            ? <><span className="text-zinc-400 tabular-nums">#{screens[i].n}</span><span className="max-w-[52vw] truncate font-semibold text-zinc-900 dark:text-zinc-100">{screens[i].name}</span><span className="text-zinc-400 tabular-nums">· {i + 1}/{screens.length}</span></>
            : <>{t('{i} of {n}', { i: i + 1, n: screens.length })}</>}<Icon name="caret-down" className="size-3" />
        </Popover.Trigger>
        <Popover.Portal container={root}>
          <Popover.Positioner side="top" align="center" sideOffset={14} className="z-50">
            <Popover.Popup dir={dir} className={`${popup} w-[min(300px,calc(100vw-32px))]`}>
              <Popover.Title className="px-2.5 pt-2 pb-1 text-[11px] font-medium text-zinc-500 dark:text-zinc-400">{tn(screens.length, '{n} design on this link', '{n} designs on this link')}</Popover.Title>
              <div ref={list} className="max-h-[min(420px,55vh)] overflow-y-auto overscroll-contain">
                {screens.map((s, k) => (
                  <button key={s.key} aria-current={k === i || undefined} onClick={() => { setOpen(false); go(s.key) }}
                    className={`flex h-9 w-full items-center gap-2 rounded-lg px-2.5 text-start text-[13px] ${k === i ? 'bg-sky-500/10' : 'hover:bg-zinc-900/[.04] dark:hover:bg-white/[.06]'}`}>
                    <span className={`w-7 shrink-0 tabular-nums ${k === i ? 'font-semibold text-sky-600 dark:text-sky-400' : 'text-zinc-400'}`}>#{s.n}</span>
                    <span className={`min-w-0 flex-1 truncate ${k === i ? 'font-semibold' : ''}`}>{s.name}</span>
                  </button>
                ))}
              </div>
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
      <button data-next onClick={() => step(1)} disabled={i === screens.length - 1} className={`${iconBtn} size-7 disabled:opacity-30`} aria-label={t('Next design')}><Icon name="caret-right" className="size-4" /></button>
    </div>
  )
}
