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
import chatCircle from '@phosphor-icons/core/assets/regular/chat-circle.svg?raw'
import eye from '@phosphor-icons/core/assets/regular/eye.svg?raw'
import eyeSlash from '@phosphor-icons/core/assets/regular/eye-slash.svg?raw'
import mapPin from '@phosphor-icons/core/assets/fill/map-pin-fill.svg?raw'
import gitBranch from '@phosphor-icons/core/assets/regular/git-branch.svg?raw'
import rows from '@phosphor-icons/core/assets/regular/rows.svg?raw'
import tray from '@phosphor-icons/core/assets/regular/tray.svg?raw'
import foldAll from '@phosphor-icons/core/assets/regular/arrows-in-line-vertical.svg?raw'
import openAll from '@phosphor-icons/core/assets/regular/arrows-out-line-vertical.svg?raw'
import linkSimple from '@phosphor-icons/core/assets/regular/link-simple.svg?raw'
import hash from '@phosphor-icons/core/assets/regular/hash.svg?raw'
import star from '@phosphor-icons/core/assets/regular/star.svg?raw'
import check from '@phosphor-icons/core/assets/bold/check-bold.svg?raw'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { t } from '../i18n'
import type { ExpState } from './model'
import { selection } from './selection'
import { armTagDrag } from '../tag-drag'

const ICONS = { browser, shuffle, caretDown, caretRight, checkFill, circleFill, hourglass, warning, sparkle, sidebar, archive, magnifyingGlass, squaresFour, path, circle, x, dots, starFill, plus, minus, foldIn, spreadOut, chatCircle, eye, eyeSlash, mapPin, gitBranch, rows, tray, foldAll, openAll, linkSimple, hash, star, check }
export type PhName = keyof typeof ICONS
/** A Phosphor icon, drawn from @phosphor-icons/core like the rest of the shell's (ui.ts ic()). */
export function Ph({ name, className = 'size-4' }: { name: PhName; className?: string }) {
  return <span aria-hidden="true" className={`inline-grid shrink-0 place-items-center [&>svg]:size-full ${className}`} dangerouslySetInnerHTML={{ __html: ICONS[name].replace(/<svg /, '<svg fill="currentColor" ') }} />
}

const MARK: Record<Exclude<ExpState, 'done'>, [label: () => string, body: () => string, icon: PhName, cls: string]> = {
  open: [() => t('Waiting for your pick'), () => t('Open it and pick the option you want to keep.'), 'circleFill', 'size-2 text-amber-500'],
  waits: [() => t('Waiting for the pick above it'), () => t('This round is built once you pick an option in the round it comes from.'), 'hourglass', 'size-3.5 text-zinc-400'],
  stale: [() => t('Built on an option you no longer picked'), () => t('You picked something else above it since, so this round may be out of date.'), 'warning', 'size-3.5 text-rose-500'],
  building: [() => t('The agent is building it'), () => t('Its options show up here as soon as they are ready.'), 'sparkle', 'size-3.5 animate-pulse text-sky-500'],
}
export function Mark({ state, picked }: { state: ExpState; picked?: number }) {
  if (state === 'done') return (
    <span title={t('Picked #{n}', { n: picked ?? 0 })} className="flex shrink-0 items-center gap-0.5 text-[11px] font-medium tabular-nums text-emerald-600 dark:text-emerald-400">
      <Ph name="checkFill" className="size-3.5" />{picked}
    </span>
  )
  const [say, explain, icon, cls] = MARK[state], label = say()
  return <span data-mark={state} title={label} data-tip-body={explain()} aria-label={label} className="grid size-4 shrink-0 place-items-center"><Ph name={icon} className={cls} /></span>
}

/** The one fold control of the tree: it turns instead of swapping, and the arrow keys work it. */
export function Caret({ open, onFlip, label }: { open: boolean; onFlip(): void; label?: string }) {
  const keys = (e: React.KeyboardEvent) => {
    const rtlNow = getComputedStyle(e.currentTarget).direction === 'rtl'
    if (e.key === (rtlNow ? 'ArrowLeft' : 'ArrowRight') && !open) { e.preventDefault(); onFlip() }
    if (e.key === (rtlNow ? 'ArrowRight' : 'ArrowLeft') && open) { e.preventDefault(); onFlip() }
  }
  return (
    <button type="button" aria-label={label ?? (open ? t('Collapse') : t('Expand'))} aria-expanded={open} onClick={onFlip} onKeyDown={keys}
      className="grid h-7 w-5 shrink-0 place-items-center rounded-md text-zinc-400 hover:bg-zinc-900/[.06] hover:text-zinc-700 dark:text-zinc-500 dark:hover:bg-white/10 dark:hover:text-zinc-200 [@media(pointer:coarse)]:h-9 [@media(pointer:coarse)]:w-7">
      <span className={'grid place-items-center transition-transform duration-200 ease-out motion-reduce:transition-none ' + (open ? '' : 'ltr:-rotate-90 rtl:rotate-90')}><Ph name="caretDown" className="size-2.5" /></span>
    </button>
  )
}

/** Height and fade together. What is folded leaves the page once it has closed, so a long tree stays light. */
export function Collapse({ open, children }: { open: boolean; children: ReactNode }) {
  const [held, setHeld] = useState(open), [full, setFull] = useState(open)
  useEffect(() => {
    if (open) {
      setHeld(true)
      let second = 0
      const first = requestAnimationFrame(() => { second = requestAnimationFrame(() => setFull(true)) })
      return () => { cancelAnimationFrame(first); cancelAnimationFrame(second) }
    }
    setFull(false)
    const out = setTimeout(() => setHeld(false), 220)
    return () => clearTimeout(out)
  }, [open])
  if (!held && !open) return null
  return (
    <div inert={!open} className={'grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none ' + (full ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0')}>
      {/* clip, not hidden: hidden makes a scroll box, and the rows that stick would stick to it. */}
      <div className="min-h-0 min-w-0 overflow-clip">{children}</div>
    </div>
  )
}

/** What hangs under a row: one short step and a thin line, so a level reads at a glance and a deep
 *  chain keeps its names. The numbers of its options line up under the row's icon (Row's spacer). */
export function Inside({ children }: { children: ReactNode }) {
  return <div className="ms-2 border-s border-black/[.06] dark:border-white/[.08]">{children}</div>
}

/** The rows that can be chosen, top to bottom. An open exploration's own row leaves that to its options. */
const rowsIn = (el: Element) => [...(el.closest('[data-tree-root]')?.querySelectorAll<HTMLElement>('[data-mv]') ?? [])]
  .filter(r => !r.querySelector(':scope > button[aria-expanded="true"]')).map(r => r.dataset.mv!.replace(':', '/'))

/** The option on screen. An exploration's own row can be lit on its page, with no variant open. */
const hereIn = (el: Element) => el.closest('[data-tree-root]')?.querySelector<HTMLElement>('[data-tree-row^="opt:"][data-on="true"], [data-tree-on-pick]')?.dataset.mv?.replace(':', '/') ?? ''

export function Row({ id, depth, label, icon, end, count, on, open, onCaret, onClick, strong, medium, mv, flat, slim, stands, onPick, drag }: {
  id: string; depth: number; label: ReactNode; icon?: ReactNode; end?: ReactNode; count?: number; on?: boolean
  /** Part of a block that wears the colour and the hover itself. */
  flat?: boolean
  /** The second line of a decided row. */
  slim?: boolean
  /** A variant's route (slug/letter): the row has its options, on right-click (data-mv) and a ⋯ (the shell's vm). */
  mv?: string
  /** The variant this row chooses when it has no options of its own: a decided row's winner. */
  stands?: string
  /** A decided row whose pick (its mv) is on screen. */
  onPick?: boolean
  /** What dragging it onto a comment box tags (tag-drag.ts): routes, `slug/A` or `slug`. Chosen, it
   *  drags everything chosen. */
  drag?: string[]
  /** undefined: no caret (a leaf). */
  open?: boolean; onCaret?: () => void; onClick: () => void; strong?: boolean; medium?: boolean
}) {
  const chosen = useSyncExternalStore(selection.subscribe, () => !!mv && (!open || stands === mv) && selection.has(mv))
  const route = mv ?? stands
  // Cmd or Ctrl adds a row, Shift a run of them; once choosing, a finger has only the tap to add with.
  const click = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey) {
      const here = hereIn(e.currentTarget)
      if (route) { if (e.shiftKey) selection.extend(route, rowsIn(e.currentTarget), here); else selection.toggle(route, here) }
      return
    }
    if (route && selection.get().length && matchMedia('(pointer: coarse)').matches) return selection.toggle(route)
    selection.clear()
    onClick()
  }
  // A chosen row drags the whole selection, each chosen row as what it stands for (a prototype's
  // row the whole prototype); a chosen variant whose row is folded away, as that variant.
  const dragStart = (e: React.PointerEvent<HTMLDivElement>) => { const el = e.currentTarget; armTagDrag(e, () => {
    const all = selection.get(), own = drag ?? []
    let routes = own
    if (chosen && all.length > 1) {
      const rows = [...el.closest('[data-tree-root]')?.querySelectorAll<HTMLElement>('[data-tree-chosen="true"][data-drag]') ?? []]
      const by = new Map<string, string[]>()
      for (const r of rows) { const k = r.dataset.mv!.replace(':', '/'); if (!by.has(k)) by.set(k, JSON.parse(r.dataset.drag!)) }
      if (route) by.set(route, own)
      routes = [...new Set(all.flatMap(r => by.get(r) ?? [r]))]
    }
    return routes
  }) }
  return (
    <div data-tree-row={id} data-drag={drag?.length ? JSON.stringify(drag) : undefined} onPointerDown={drag?.length ? dragStart : undefined} data-on={on ? 'true' : undefined} data-mv={mv ? mv.replace('/', ':') : undefined} data-tree-chosen={chosen ? 'true' : undefined} data-tree-on-pick={onPick ? 'true' : undefined}
      className={'group flex items-center gap-1.5 rounded-lg pe-1.5 ' + (slim ? 'h-6! [@media(pointer:coarse)]:h-8! ' : 'h-8 [@media(pointer:coarse)]:h-10 ') + (flat ? '' : 'mx-1.5 ') + (chosen ? 'bg-sky-500/15 ' + (on ? 'text-sky-900 dark:text-sky-100' : '') : flat ? '' : on ? 'bg-sky-50 text-sky-900 dark:bg-sky-950/60 dark:text-sky-100' : 'hover:bg-zinc-900/[.04] dark:hover:bg-white/[.06]')}
      style={{ paddingInlineStart: 2 + depth * 8 }}>
      {open != null && onCaret
        ? <Caret open={open} onFlip={onCaret} />
        : <span className="w-2.5 shrink-0 [@media(pointer:coarse)]:w-[18px]" />}
      <button type="button" onClick={click} onMouseDown={e => { if (e.shiftKey) e.preventDefault() }} aria-pressed={mv ? chosen : undefined} className={'flex h-full min-w-0 flex-1 items-center gap-1.5 text-start ' + (strong ? 'font-semibold' : medium ? 'font-medium' : '')}>
        {icon}<span data-row-label className="truncate">{label}</span>{count != null && <span className="text-xs font-normal text-zinc-400 tabular-nums">{count}</span>}
      </button>
      {end}
      {mv && <button type="button" data-act={`vm:${mv.replace('/', ':')}`} aria-label={t('Options')} title={t('Options')}
        className="proto-tree-more grid h-6 shrink-0 place-items-center rounded-md text-zinc-400 hover:bg-zinc-900/[.06] hover:text-zinc-700 dark:hover:bg-white/10 dark:hover:text-zinc-200">
        <Ph name="dots" className="size-3.5" /></button>}
    </div>
  )
}
