// The viewer's header: whose link this is and which prototype of it is shown (its title opens the
// list of the share's prototypes), a quiet hint on a wide screen, and About. Nothing to do up here,
// so it stays small: 56 px, 48 px on a phone.
import { useState, type RefObject } from 'react'
import { Popover } from '@base-ui/react/popover'
import { rtl, t, tn } from '../i18n'
import { ago } from '../ui'
import type { Proto } from '../shell'
import { Icon, card, iconBtn, popup } from './ui'

export type Appearance = 'system' | 'light' | 'dark'
type Facts = { owner: string; version: number; updatedAt: string }
const dir = rtl ? 'rtl' : 'ltr'
const TINTS = ['bg-zinc-900 text-white dark:bg-white dark:text-zinc-900', 'bg-amber-500 text-white', 'bg-violet-500 text-white', 'bg-teal-500 text-white', 'bg-sky-500 text-white', 'bg-rose-500 text-white']
const isMac = /Mac|iPhone|iPad/.test(navigator.platform)

export function Header({ protos, cur, choose, wide, facts, appearance, setAppearance, root }: {
  protos: Proto[]; cur: Proto; choose: (id: string) => void; wide: boolean; facts: Facts
  appearance: Appearance; setAppearance: (a: Appearance) => void; root: RefObject<HTMLDivElement | null>
}) {
  return (
    <header data-viewer-header dir={dir} className={`relative z-30 flex shrink-0 items-center gap-2.5 px-4 ${wide ? 'h-14' : 'h-12'}`}>
      <Protos protos={protos} cur={cur} choose={choose} compact={!wide} owner={facts.owner} updated={facts.updatedAt} root={root} />
      <div className="flex-1" />
      {wide && <p className="hidden text-[12px] text-zinc-500 md:block dark:text-zinc-400">{t('Drag to move · pinch or {key} scroll to zoom', { key: isMac ? '⌘' : 'Ctrl' })}</p>}
      <About facts={facts} appearance={appearance} setAppearance={setAppearance} root={root} />
    </header>
  )
}

const markOf = (protos: Proto[], p: Proto) => ({ letter: (p.title.trim()[0] ?? '?').toUpperCase(), tint: TINTS[Math.max(0, protos.indexOf(p)) % TINTS.length] })
function Mark({ protos, p, small }: { protos: Proto[]; p: Proto; small?: boolean }) {
  const { letter, tint } = markOf(protos, p)
  return <span aria-hidden="true" className={`grid shrink-0 place-items-center font-semibold ${tint} ${small ? 'size-7 rounded-lg text-[12px]' : 'size-8 rounded-[10px] text-[13px]'}`}>{letter}</span>
}

/** The prototype shown, and with more than one in the share, the list of them all. */
function Protos({ protos, cur, choose, compact, owner, updated, root }: {
  protos: Proto[]; cur: Proto; choose: (id: string) => void; compact: boolean; owner: string; updated: string; root: RefObject<HTMLDivElement | null>
}) {
  const [open, setOpen] = useState(false)
  const many = protos.length > 1
  const line = `${t('by {owner} · read-only', { owner })} · ${many ? tn(protos.length, '{n} prototype', '{n} prototypes') : tn(cur.variants.length, '{n} design', '{n} designs')}`
  const title = (
    <>
      <Mark protos={protos} p={cur} small={compact} />
      <span className="min-w-0 leading-tight">
        <span className="flex items-center gap-1 text-[14px] font-semibold">
          <span className="truncate">{cur.title}</span>
          {many && <span data-caret className={`inline-grid text-zinc-400 transition-transform duration-200 motion-reduce:transition-none ${open ? 'rotate-180' : ''}`}><Icon name="caret-down" className="size-3" /></span>}
        </span>
        {!compact && <span className="flex items-center gap-1 truncate text-[12px] text-zinc-500 dark:text-zinc-400"><Icon name="eye" className="size-3" />{line}</span>}
      </span>
    </>
  )
  if (!many) return <div className="flex min-w-0 items-center gap-2.5 py-1">{title}</div>
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger data-proto-switch aria-label={t('{title}, {n} prototypes on this link. Switch prototype', { title: cur.title, n: protos.length })}
        className="-ms-1.5 flex min-w-0 items-center gap-2.5 rounded-xl py-1 ps-1.5 pe-2 text-start transition-colors hover:bg-zinc-900/5 data-[popup-open]:bg-zinc-900/5 motion-reduce:transition-none dark:hover:bg-white/[.07] dark:data-[popup-open]:bg-white/[.07]">
        {title}
      </Popover.Trigger>
      <Popover.Portal container={root}>
        <Popover.Positioner side="bottom" align={rtl ? 'end' : 'start'} sideOffset={6} className="z-50">
          <Popover.Popup dir={dir} className={`${popup} w-[min(320px,calc(100vw-24px))]`}>
            <Popover.Title className="px-2.5 pt-2 pb-1 text-[11px] font-medium text-zinc-500 dark:text-zinc-400">{t('Shared with you by {owner}', { owner })}</Popover.Title>
            {protos.map(p => {
              const on = p.id === cur.id
              return (
                <button key={p.id} data-proto-row={p.id} aria-current={on || undefined} onClick={() => { setOpen(false); if (!on) choose(p.id) }}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-start ${on ? 'bg-sky-500/10' : 'hover:bg-zinc-900/[.04] dark:hover:bg-white/[.06]'}`}>
                  <Mark protos={protos} p={p} small />
                  <span className="min-w-0 flex-1 leading-tight">
                    <span className={`block truncate text-[13px] ${on ? 'font-semibold' : ''}`}>{p.title}</span>
                    <span className="block truncate text-[11.5px] text-zinc-500 dark:text-zinc-400">{tn(p.variants.length, '{n} design', '{n} designs')} · {t('updated {when}', { when: ago(Date.parse(updated)) })}</span>
                  </span>
                  {on && <Icon name="check" className="size-3.5 text-sky-500" />}
                </button>
              )
            })}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}

/** About this link: who shared it, when, which version, that it is read-only, and this viewer's theme. */
function About({ facts, appearance, setAppearance, root }: { facts: Facts; appearance: Appearance; setAppearance: (a: Appearance) => void; root: RefObject<HTMLDivElement | null> }) {
  const [open, setOpen] = useState(false)
  const rows: [string, string][] = [
    [t('Shared by'), facts.owner],
    [t('Updated'), `${ago(Date.parse(facts.updatedAt))} · ${t('version {n}', { n: facts.version })}`],
  ]
  const themes: [Appearance, string][] = [['system', t('System')], ['light', t('Light')], ['dark', t('Dark')]]
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger className={iconBtn} aria-label={t('About this link')} title={t('About this link')}><Icon name="info" /></Popover.Trigger>
      <Popover.Portal container={root}>
        <Popover.Positioner side="bottom" align={rtl ? 'start' : 'end'} sideOffset={4} className="z-50">
          <Popover.Popup dir={dir} className={`${card} w-[min(340px,calc(100vw-32px))] origin-[var(--transform-origin)] p-4 shadow-2xl outline-none transition-[opacity,scale] duration-150 data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0 motion-reduce:transition-none`}>
            <div className="flex items-start justify-between">
              <Popover.Title className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{t('About this link')}</Popover.Title>
              <Popover.Close className={iconBtn} aria-label={t('Close')}><Icon name="x" /></Popover.Close>
            </div>
            <dl className="mt-2 space-y-2 text-[13px]">
              {rows.map(([k, val]) => (
                <div key={k} className="flex justify-between gap-4"><dt className="text-zinc-500">{k}</dt><dd className="text-end text-zinc-900 dark:text-zinc-100">{val}</dd></div>
              ))}
            </dl>
            <p className="mt-3 rounded-lg bg-zinc-900/[.04] p-2.5 text-[12px] leading-snug text-zinc-600 dark:bg-white/[.05] dark:text-zinc-400">
              {t('This is a read-only copy that {owner} shared. Nothing you do here changes it.', { owner: facts.owner })}
            </p>
            <div className="mt-3 flex items-center justify-between gap-3 text-[13px]">
              <span className="text-zinc-500">{t('Theme')}</span>
              <div role="radiogroup" aria-label={t('Theme')} className="flex rounded-lg bg-zinc-900/5 p-0.5 dark:bg-white/10">
                {themes.map(([id, name]) => (
                  <button key={id} role="radio" aria-checked={appearance === id} onClick={() => setAppearance(id)}
                    className={`h-7 rounded-md px-2.5 text-[12px] font-medium ${appearance === id ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-100' : 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100'}`}>{name}</button>
                ))}
              </div>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}
