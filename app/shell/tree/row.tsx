// One row of the project tree, and the small mark that says an exploration's state (its words in
// the tooltip): open an amber dot, waiting an hourglass, a base that moved a rose warning, building
// a pulsing sparkle; done shows its pick.
import type { ReactNode } from 'react'
import browser from '@phosphor-icons/core/assets/regular/browser.svg?raw'
import shuffle from '@phosphor-icons/core/assets/regular/shuffle.svg?raw'
import caretDown from '@phosphor-icons/core/assets/bold/caret-down-bold.svg?raw'
import caretRight from '@phosphor-icons/core/assets/bold/caret-right-bold.svg?raw'
import checkFill from '@phosphor-icons/core/assets/fill/check-circle-fill.svg?raw'
import circleFill from '@phosphor-icons/core/assets/fill/circle-fill.svg?raw'
import hourglass from '@phosphor-icons/core/assets/fill/hourglass-fill.svg?raw'
import warning from '@phosphor-icons/core/assets/fill/warning-fill.svg?raw'
import sparkle from '@phosphor-icons/core/assets/fill/sparkle-fill.svg?raw'
import sidebar from '@phosphor-icons/core/assets/regular/sidebar-simple.svg?raw'
import archive from '@phosphor-icons/core/assets/regular/archive.svg?raw'
import magnifyingGlass from '@phosphor-icons/core/assets/regular/magnifying-glass.svg?raw'
import squaresFour from '@phosphor-icons/core/assets/regular/squares-four.svg?raw'
import path from '@phosphor-icons/core/assets/regular/path.svg?raw'
import circle from '@phosphor-icons/core/assets/regular/circle.svg?raw'
import x from '@phosphor-icons/core/assets/regular/x.svg?raw'
import dots from '@phosphor-icons/core/assets/bold/dots-three-bold.svg?raw'
import starFill from '@phosphor-icons/core/assets/fill/star-fill.svg?raw'
import foldIn from '@phosphor-icons/core/assets/regular/arrows-in-line-horizontal.svg?raw'
import spreadOut from '@phosphor-icons/core/assets/regular/arrows-out-line-horizontal.svg?raw'
import plus from '@phosphor-icons/core/assets/bold/plus-bold.svg?raw'
import minus from '@phosphor-icons/core/assets/bold/minus-bold.svg?raw'
import { rtl, t } from '../i18n'
import type { ExpState } from './model'

const ICONS = { browser, shuffle, caretDown, caretRight, checkFill, circleFill, hourglass, warning, sparkle, sidebar, archive, magnifyingGlass, squaresFour, path, circle, x, dots, starFill, plus, minus, foldIn, spreadOut }
export type PhName = keyof typeof ICONS
/** A Phosphor icon, drawn from @phosphor-icons/core like the rest of the shell's (ui.ts ic()). */
export function Ph({ name, className = 'size-4' }: { name: PhName; className?: string }) {
  return <span aria-hidden="true" className={`inline-grid shrink-0 place-items-center [&>svg]:size-full ${className}`} dangerouslySetInnerHTML={{ __html: ICONS[name].replace(/<svg /, '<svg fill="currentColor" ') }} />
}

const MARK: Record<Exclude<ExpState, 'done'>, [label: () => string, icon: PhName, cls: string]> = {
  open: [() => t('Waiting for your pick'), 'circleFill', 'size-2 text-amber-500'],
  waits: [() => t('Waiting for the pick above it'), 'hourglass', 'size-3.5 text-zinc-400'],
  stale: [() => t('Built on an option you no longer picked'), 'warning', 'size-3.5 text-rose-500'],
  building: [() => t('The agent is building it'), 'sparkle', 'size-3.5 animate-pulse text-sky-500'],
}
export function Mark({ state, picked }: { state: ExpState; picked?: number }) {
  if (state === 'done') return (
    <span title={t('Picked #{n}', { n: picked ?? 0 })} className="flex shrink-0 items-center gap-0.5 text-[11px] font-medium tabular-nums text-emerald-600 dark:text-emerald-400">
      <Ph name="checkFill" className="size-3.5" />{picked}
    </span>
  )
  const [say, icon, cls] = MARK[state], label = say()
  return <span data-mark={state} title={label} aria-label={label} className="grid size-4 shrink-0 place-items-center"><Ph name={icon} className={cls} /></span>
}

export function Row({ id, depth, label, icon, end, count, on, open, onCaret, onClick, strong, medium, mv }: {
  id: string; depth: number; label: ReactNode; icon?: ReactNode; end?: ReactNode; count?: number; on?: boolean
  /** A variant's route (slug/letter): the row has its options, on right-click (data-mv) and a ⋯ (the shell's vm). */
  mv?: string
  /** undefined: no caret (a leaf). */
  open?: boolean; onCaret?: () => void; onClick: () => void; strong?: boolean; medium?: boolean
}) {
  return (
    <div data-tree-row={id} data-on={on ? 'true' : undefined} data-mv={mv ? mv.replace('/', ':') : undefined}
      className={'group mx-1.5 flex h-8 items-center gap-1.5 rounded-lg pe-1.5 ' + (on ? 'bg-sky-50 text-sky-900 dark:bg-sky-950/60 dark:text-sky-100' : 'hover:bg-zinc-900/[.04] dark:hover:bg-white/[.06]')}
      style={{ paddingInlineStart: 2 + depth * 8 }}>
      {open != null
        ? <button type="button" aria-label={open ? t('Collapse') : t('Expand')} aria-expanded={open} onClick={onCaret}
            className="grid size-5 shrink-0 place-items-center rounded text-zinc-400 hover:bg-zinc-900/[.06] dark:hover:bg-white/10">
            <Ph name={open ? 'caretDown' : 'caretRight'} className={'size-2.5 ' + (!open && rtl ? '-scale-x-100' : '')} />
          </button>
        : <span className="w-5 shrink-0" />}
      <button type="button" onClick={onClick} className={'flex h-full min-w-0 flex-1 items-center gap-1.5 text-start ' + (strong ? 'font-semibold' : medium ? 'font-medium' : '')}>
        {icon}<span className="truncate">{label}</span>{count != null && <span className="text-xs font-normal text-zinc-400 tabular-nums">{count}</span>}
      </button>
      {end}
      {mv && <button type="button" data-act={`vm:${mv.replace('/', ':')}`} aria-label={t('Options')} title={t('Options')}
        className="grid size-6 shrink-0 place-items-center rounded-md text-zinc-400 opacity-0 hover:bg-zinc-900/[.06] hover:text-zinc-700 focus-visible:opacity-100 group-hover:opacity-100 aria-expanded:opacity-100 dark:hover:bg-white/10 dark:hover:text-zinc-200 [@media(pointer:coarse)]:opacity-100">
        <Ph name="dots" className="size-3.5" /></button>}
    </div>
  )
}
