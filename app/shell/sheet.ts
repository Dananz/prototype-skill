// The variant sheet on a phone: every variant of the prototype, opened from the bottom pill.
// It is Base UI's Drawer (swipe down to close, focus kept inside, the iOS 26 viewport handled),
// written with createElement so it runs in Vue sessions too, which have no JSX transform. The
// phone's menus and its Try it are sheets of the same kind.
import { createElement as h, useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { Drawer } from '@base-ui/react/drawer'
import { uiBox } from './portals'
import { VIRTUAL_THRESHOLD } from './virtual'
import { CachedList } from './virtual-react'
import { t } from './i18n'
import { ic } from './ui'

export type SheetRow = { id: string; label: string; name: string; on: boolean; picked: boolean; fav: boolean; editing: boolean }
export type SheetProps = {
  open: boolean
  title: string
  rows: SheetRow[]
  lobby: boolean
  /** On a variant, its Pick, More and Build (from the comment layer), above the list. */
  decide?: ReactNode
  onClose: () => void
  onPick: (id: string) => void
  onLobby: () => void
  /** Favorites only, offered when the prototype has favorites: whether it is on, and how many. */
  favs?: { on: boolean; count: number }
  onFavs?: () => void
}

const CHECK = h('svg', { className: 'size-4 shrink-0', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }, h('path', { d: 'M5 12l5 5 9-10' }))
const GRID = h('svg', { className: 'size-3.5 shrink-0', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }, h('path', { d: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z' }))
const X = h('svg', { className: 'size-4 shrink-0', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }, h('path', { d: 'M6 6l12 12M18 6 6 18' }))
const DOT = h('span', { className: 'relative inline-flex size-1.5' }, h('span', { className: 'absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-60' }), h('span', { className: 'relative inline-flex size-full rounded-full bg-emerald-500' }))

const star = (fill: boolean, cls: string) => h('span', { className: 'contents', dangerouslySetInnerHTML: { __html: ic(fill ? 'star-fill' : 'star', cls) } })

const ROW = 'flex h-11 w-full items-center gap-3 rounded-xl px-3 text-start text-[13px] outline-none focus-visible:bg-zinc-900/[.06] dark:focus-visible:bg-white/10'

function Sheet(p: SheetProps) {
  const row = (r: SheetRow): ReactNode => h('button', {
    key: r.id, type: 'button', 'aria-current': r.on, onClick: () => p.onPick(r.id),
    className: `${ROW} ${r.on ? 'bg-zinc-900/[.05] font-semibold text-zinc-900 dark:bg-white/[.08] dark:text-white' : 'text-zinc-700 active:bg-zinc-900/[.04] dark:text-zinc-300 dark:active:bg-white/5'}`,
  },
    h('span', { className: `w-6 shrink-0 text-center text-xs font-semibold tabular-nums ${r.on ? '' : 'text-zinc-400'}` }, r.label),
    h('span', { dir: 'auto', className: 'min-w-0 flex-1 truncate text-start' }, r.name),
    r.editing ? DOT : null,
    r.fav ? star(true, 'size-4 text-amber-500 dark:text-amber-400') : null,
    r.picked ? h('span', { className: 'shrink-0 text-xs font-medium text-emerald-700 dark:text-emerald-400' }, t('Picked')) : null,
    r.on ? CHECK : null)

  return h(Drawer.Root, { open: p.open, onOpenChange: (open: boolean) => { if (!open) p.onClose() } },
    h(Drawer.Portal, { container: uiBox() },
      // The Backdrop and Popup classes follow Base UI's bottom drawer example: the swipe
      // variables, the bleed below the screen and the iOS 26 backdrop fix are theirs.
      h(Drawer.Backdrop, { className: '[--backdrop-opacity:0.3] [--bleed:3rem] dark:[--backdrop-opacity:0.6] fixed inset-0 z-[200] min-h-dvh bg-black opacity-[calc(var(--backdrop-opacity)*(1-var(--drawer-swipe-progress)))] transition-opacity duration-[450ms] ease-[cubic-bezier(0.32,0.72,0,1)] data-swiping:duration-0 data-ending-style:opacity-0 data-starting-style:opacity-0 data-ending-style:duration-[calc(var(--drawer-swipe-strength)*400ms)] supports-[-webkit-touch-callout:none]:absolute' }),
      h(Drawer.Viewport, { className: 'fixed inset-0 z-[200] flex items-end justify-center' },
        h(Drawer.Popup, { className: '-mb-[3rem] w-full max-h-[calc(75vh+3rem)] overflow-y-auto overscroll-contain rounded-t-3xl bg-white pb-[calc(0.75rem+env(safe-area-inset-bottom,0px)+3rem)] pt-2 text-[13px] text-zinc-900 shadow-2xl shadow-black/20 outline-none touch-auto [transform:translateY(var(--drawer-swipe-movement-y))] transition-transform duration-[450ms] ease-[cubic-bezier(0.32,0.72,0,1)] data-swiping:select-none data-ending-style:[transform:translateY(calc(100%-3rem+2px))] data-starting-style:[transform:translateY(calc(100%-3rem+2px))] data-ending-style:duration-[calc(var(--drawer-swipe-strength)*400ms)] dark:bg-zinc-900 dark:text-zinc-100' },
          h('div', { className: 'mx-auto mb-1 h-1 w-10 rounded-full bg-zinc-300 dark:bg-zinc-700' }),
          h(Drawer.Content, { className: 'px-2' },
            h('div', { className: 'flex items-center justify-between pb-1 ps-3' },
              h(Drawer.Title, { dir: 'auto', className: 'min-w-0 truncate text-[15px] font-semibold' }, p.title),
              h(Drawer.Close, { 'aria-label': t('Close'), className: 'grid size-9 place-items-center rounded-full text-zinc-500 active:bg-zinc-900/5 dark:active:bg-white/10' }, X)),
            p.decide ? h('div', { className: 'mb-2 border-b border-black/[.06] pb-3 pt-1 dark:border-white/10' }, p.decide) : null,
            p.rows.length > VIRTUAL_THRESHOLD ? h(CachedList<SheetRow>, {
              items: p.rows, itemKey: r => r.id, render: row, estimate: () => 44,
              gap: 2, cacheSize: 32, focusSelector: 'button',
              initialIndex: Math.max(0, p.rows.findIndex(r => r.on)),
            }) : h('div', { className: 'space-y-0.5' }, p.rows.map(row)),
            h('div', { className: 'mt-1.5 border-t border-black/[.06] pt-1.5 dark:border-white/10' },
              h('button', { type: 'button', onClick: p.onLobby, 'aria-current': p.lobby, className: `${ROW} ${p.lobby ? 'font-medium text-zinc-900 dark:text-white' : 'text-zinc-700 dark:text-zinc-300'}` },
                h('span', { className: 'flex w-6 shrink-0 justify-center text-zinc-500 dark:text-zinc-400' }, GRID),
                h('span', { className: 'min-w-0 flex-1 truncate' }, t('All variants')),
                h('span', { className: 'shrink-0 text-xs tabular-nums text-zinc-400' }, String(p.rows.length))),
              p.favs ? h('button', { type: 'button', onClick: p.onFavs, 'aria-pressed': p.favs.on, 'data-fav-toggle': '', className: `${ROW} ${p.favs.on ? 'font-medium text-zinc-900 dark:text-white' : 'text-zinc-700 dark:text-zinc-300'}` },
                h('span', { className: 'flex w-6 shrink-0 justify-center' }, star(p.favs.on, `size-4 ${p.favs.on ? 'text-amber-500 dark:text-amber-400' : 'text-zinc-500 dark:text-zinc-400'}`)),
                h('span', { className: 'min-w-0 flex-1 truncate' }, t('Favorites only')),
                h('span', { className: 'shrink-0 text-xs tabular-nums text-zinc-400' }, String(p.favs.count))) : null))))))
}

export type MenuSheetProps = { open: boolean; title: string; html: string; onClose: () => void; onContentReady?: (root: HTMLElement) => void | (() => void) }

// The phone's menus (the prototypes, the session) in the same sheet. Their content is the
// shell's own menu HTML, and the sheet renders inside the shell's root, so its buttons reach
// the shell's click handling like any other.
function MenuSheet(p: MenuSheetProps & { container: HTMLElement }) {
  const [content, setContent] = useState<HTMLDivElement | null>(null)
  useLayoutEffect(() => {
    if (p.open && content) return p.onContentReady?.(content)
  }, [p.open, p.html, p.onContentReady, content])
  return h(Drawer.Root, { open: p.open, onOpenChange: (open: boolean) => { if (!open) p.onClose() } },
    h(Drawer.Portal, { container: p.container },
      h(Drawer.Backdrop, { className: '[--backdrop-opacity:0.3] [--bleed:3rem] dark:[--backdrop-opacity:0.6] fixed inset-0 z-[200] min-h-dvh bg-black opacity-[calc(var(--backdrop-opacity)*(1-var(--drawer-swipe-progress)))] transition-opacity duration-[450ms] ease-[cubic-bezier(0.32,0.72,0,1)] data-swiping:duration-0 data-ending-style:opacity-0 data-starting-style:opacity-0 data-ending-style:duration-[calc(var(--drawer-swipe-strength)*400ms)] supports-[-webkit-touch-callout:none]:absolute' }),
      h(Drawer.Viewport, { className: 'fixed inset-0 z-[200] flex items-end justify-center' },
        h(Drawer.Popup, { className: '-mb-[3rem] w-full max-h-[calc(80vh+3rem)] overflow-y-auto overscroll-contain rounded-t-3xl bg-white pb-[calc(0.5rem+env(safe-area-inset-bottom,0px)+3rem)] pt-2 text-[13px] text-zinc-900 shadow-2xl shadow-black/20 outline-none touch-auto [transform:translateY(var(--drawer-swipe-movement-y))] transition-transform duration-[450ms] ease-[cubic-bezier(0.32,0.72,0,1)] data-swiping:select-none data-ending-style:[transform:translateY(calc(100%-3rem+2px))] data-starting-style:[transform:translateY(calc(100%-3rem+2px))] data-ending-style:duration-[calc(var(--drawer-swipe-strength)*400ms)] dark:bg-zinc-900 dark:text-zinc-100' },
          h('div', { className: 'mx-auto mb-1 h-1 w-10 rounded-full bg-zinc-300 dark:bg-zinc-700' }),
          h(Drawer.Content, null,
            h('div', { className: 'flex items-center justify-between pb-1 ps-5 pe-2' },
              h(Drawer.Title, { dir: 'auto', className: 'min-w-0 truncate text-[15px] font-semibold' }, p.title),
              h(Drawer.Close, { 'aria-label': t('Close'), className: 'grid size-9 place-items-center rounded-full text-zinc-500 active:bg-zinc-900/5 dark:active:bg-white/10' }, X)),
            h('div', { ref: setContent, dangerouslySetInnerHTML: { __html: p.html } }))))))
}

export type TrySheetProps = {
  open: boolean
  /** How many things it lists (the values, things to try, switches and events). */
  count: number
  /** Fill in as the panel draws it (its icon and its word), or null when nothing here can be filled. */
  fill: string | null
  /** The sheet's list and its foot (the caveats) as they appear, for the shell to fill; nulls once it is gone. */
  body: (list: HTMLElement | null, foot: HTMLElement | null) => void
  /** Asked to close (a drag down, the backdrop, Esc, Close); cancel keeps it up. */
  onClose: (reason: string, event: Event | undefined, cancel: () => void) => void
  /** Down and out of sight. */
  onGone: () => void
}

const KEY = h('svg', { className: 'size-4 shrink-0 text-amber-500', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }, h('path', { d: 'M7.5 10a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11zM11.4 11.6 21 2M15.5 7.5l2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4' }))

// Try it on a phone, opened from the pill's menu: the comments sheet's drawer, except that it
// leaves the pill's height free at its foot, since it rises from behind the pill, which stays on top.
// Its list is the shell's own Try it HTML, written in by the shell (body), so the panel's handlers on
// [data-hints], where this sheet renders, work in it as they do in the panel. The popup itself takes
// the focus as it opens: focus on a thing to try would light its spot.
function TrySheet(p: TrySheetProps & { container: HTMLElement }) {
  const popup = useRef<HTMLDivElement>(null)
  const now = useRef(p)
  now.current = p
  const box = useCallback((el: HTMLElement | null) => { now.current.body(el?.querySelector<HTMLElement>('[data-try-list]') ?? null, el?.querySelector<HTMLElement>('[data-try-foot]') ?? null) }, [])
  return h(Drawer.Root, {
    open: p.open,
    onOpenChange: (open: boolean, d: { reason: string; event?: Event; cancel: () => void }) => { if (!open) p.onClose(d.reason, d.event, d.cancel) },
    onOpenChangeComplete: (open: boolean) => { if (!open) p.onGone() },
  },
    h(Drawer.Portal, { container: p.container },
      h(Drawer.Backdrop, { className: '[--backdrop-opacity:0.3] [--bleed:3rem] dark:[--backdrop-opacity:0.6] fixed inset-0 z-[200] min-h-dvh bg-black opacity-[calc(var(--backdrop-opacity)*(1-var(--drawer-swipe-progress)))] transition-opacity duration-[450ms] ease-[cubic-bezier(0.32,0.72,0,1)] data-swiping:duration-0 data-ending-style:opacity-0 data-starting-style:opacity-0 data-ending-style:duration-[calc(var(--drawer-swipe-strength)*400ms)] supports-[-webkit-touch-callout:none]:absolute' }),
      h(Drawer.Viewport, { className: 'fixed inset-0 z-[200] flex items-end justify-center' },
        h(Drawer.Popup, { ref: popup, initialFocus: popup, className: '-mb-[3rem] flex w-full max-h-[calc(82vh+3rem)] flex-col overflow-hidden rounded-t-3xl bg-white pb-[calc(var(--pill-h,0px)+0.5rem+3rem)] pt-2 text-[13px] text-zinc-900 shadow-2xl shadow-black/20 outline-none touch-auto [transform:translateY(var(--drawer-swipe-movement-y))] transition-transform duration-[450ms] ease-[cubic-bezier(0.32,0.72,0,1)] data-swiping:select-none data-ending-style:[transform:translateY(calc(100%-3rem+2px))] data-starting-style:[transform:translateY(calc(100%-3rem+2px))] data-ending-style:duration-[calc(var(--drawer-swipe-strength)*400ms)] dark:bg-zinc-900 dark:text-zinc-100' },
          h('div', { className: 'mx-auto mb-1 h-1 w-10 shrink-0 rounded-full bg-zinc-300 dark:bg-zinc-700' }),
          h(Drawer.Content, { ref: box, className: 'flex min-h-0 flex-1 flex-col px-3' },
            h('div', { className: 'flex shrink-0 items-center gap-2 pb-1 ps-1 pt-1' },
              h(Drawer.Title, { className: 'flex min-w-0 items-center gap-2 text-[17px] font-semibold' }, KEY, t('Try it'),
                p.count ? h('span', { className: 'text-[15px] font-normal tabular-nums text-zinc-400' }, String(p.count)) : null),
              h('span', { className: 'ms-auto' }),
              p.fill ? h('button', { type: 'button', 'data-hint': 'fill', title: t('Type the values into this design’s fields'), className: 'inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-zinc-900/[.05] px-3.5 text-[13px] font-medium text-zinc-700 active:bg-zinc-900/10 dark:bg-white/[.08] dark:text-zinc-200 dark:active:bg-white/15', dangerouslySetInnerHTML: { __html: p.fill } }) : null,
              h(Drawer.Close, { 'aria-label': t('Close'), className: 'grid size-9 shrink-0 place-items-center rounded-full text-zinc-500 active:bg-zinc-900/5 dark:active:bg-white/10' }, X)),
            h('div', { 'data-try-list': '', className: '-mx-3 min-h-0 flex-1 overflow-y-auto overscroll-contain px-1' }),
            h('div', { 'data-try-foot': '', className: '-mx-3 shrink-0' }))))))
}

/** Mounts Try it's phone sheet once; call the returned function with new props to open, close or refresh it. */
export function createTrySheet(host: HTMLElement) {
  const root = createRoot(host)
  return (props: TrySheetProps) => root.render(h(TrySheet, { ...props, container: host }))
}

export function createMenuSheet(host: HTMLElement) {
  const root = createRoot(host)
  return (props: MenuSheetProps) => root.render(h(MenuSheet, { ...props, container: host }))
}

/** Mounts the sheet once; call the returned function with new props to open, close or refresh it. */
export function createSheet(host: HTMLElement) {
  const root = createRoot(host)
  return (props: SheetProps) => root.render(h(Sheet, props))
}
