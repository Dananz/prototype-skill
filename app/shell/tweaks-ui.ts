// The same inspector controls in the desktop panel and the phone's dock drawer.
// React roots let the shell use them in React and Vue prototype sessions alike.
import { createElement as h, useId, useLayoutEffect, useRef, useState, type ChangeEvent, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react'
import { createRoot } from 'react-dom/client'
import { Drawer } from '@base-ui/react/drawer'
import { Select } from '@base-ui/react/select'
import { isChanged, type Tweak } from './tweaks'
import { ic, IB } from './ui'
import { uiBox } from './portals'
import { t, tn } from './i18n'

export type TweakControlsProps = {
  fields: Tweak[]
  onChange: (id: string, value: string | boolean) => void
  onReset: (id?: string) => void
  /** The select the arrow keys step: the one used last. */
  onActive?: (id: string) => void
}

export type TweaksDrawerProps = TweakControlsProps & {
  open: boolean
  /** Where it ends when the bar is not there to grow out of. */
  bottom: number
  /** The bar it grows out of: the comments island, whose top it sits on. */
  anchor: () => HTMLElement | null
  onClose: (reason: string, event: Event | undefined, cancel: () => void) => void
  onGone: () => void
  returnFocus: () => HTMLElement | null
}

const accents = [
  { name: t('Indigo'), value: '#4f46e5' },
  { name: t('Ocean'), value: '#0369a1' },
  { name: t('Forest'), value: '#047857' },
  { name: t('Rose'), value: '#be123c' },
  { name: t('Amber'), value: '#b45309' },
]
const icon = (name: string, size = 'size-4') => h('span', { className: 'inline-flex shrink-0', dangerouslySetInnerHTML: { __html: ic(name, size) } })
const note = 'text-[11px] leading-5 text-zinc-500 dark:text-zinc-400'
const button = 'inline-flex min-h-9 items-center justify-center gap-2 rounded-lg px-3 text-xs font-medium hover:bg-zinc-100 disabled:cursor-default disabled:opacity-40 dark:hover:bg-zinc-800'

// Keep check marks readable on custom palettes, including pale and white swatches.
function foreground(color: string) {
  const rgb = color.slice(1).match(/../g)?.map(x => parseInt(x, 16) / 255).map(x => x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4)
  return rgb && rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722 > .179 ? '#000000' : '#ffffff'
}

// A select too long for a segmented row: previous and next around a list of its own, a track
// of dots for where it is, and the arrow keys step it while the panel is open (shell.ts).
export const stepped = (field: Tweak): field is Extract<Tweak, { kind: 'select' }> =>
  field.kind === 'select' && !(field.options.length <= 4 && field.options.join('').length <= 56)

/** The option `by` steps from the current one, wrapping at the ends. */
export const stepOption = (field: Extract<Tweak, { kind: 'select' }>, by: number) => {
  const n = field.options.length, i = Math.max(0, field.options.indexOf(field.value))
  return field.options[(i + by + n) % n]
}

const stepBtn = 'grid w-9 shrink-0 place-items-center text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 active:bg-zinc-200 disabled:opacity-40 dark:text-zinc-300 dark:hover:bg-zinc-700/60 dark:hover:text-white dark:active:bg-zinc-700'

function Stepper({ field, labelId, onChange }: { field: Extract<Tweak, { kind: 'select' }>; labelId: string; onChange: TweakControlsProps['onChange'] }) {
  const i = field.options.indexOf(field.value), one = field.options.length < 2
  const go = (by: number) => onChange(field.id, stepOption(field, by))
  return h('div', null,
    h(Select.Root, { value: field.value, onValueChange: (v: unknown) => { if (typeof v === 'string') onChange(field.id, v) } },
      h('div', { className: 'flex h-10 items-stretch rounded-lg border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-800' },
        h('button', { type: 'button', 'data-tweak-step': 'prev', disabled: one, 'aria-label': t('Previous {name}', { name: field.label }), title: t('Previous {name}', { name: field.label }), onClick: () => go(-1), className: `${stepBtn} rounded-s-lg` }, icon('left')),
        h(Select.Trigger, { 'data-tweak-input': field.id, 'aria-labelledby': labelId, className: 'flex min-w-0 flex-1 items-center justify-center gap-1.5 px-1 text-xs hover:bg-zinc-50 data-popup-open:bg-zinc-100 dark:hover:bg-zinc-700/40 dark:data-popup-open:bg-zinc-700/60' },
          h(Select.Value, { dir: 'auto', className: 'truncate' }),
          h(Select.Icon, { className: 'flex shrink-0 text-zinc-400' }, icon('chev', 'size-3'))),
        h('button', { type: 'button', 'data-tweak-step': 'next', disabled: one, 'aria-label': t('Next {name}', { name: field.label }), title: t('Next {name}', { name: field.label }), onClick: () => go(1), className: `${stepBtn} rounded-e-lg` }, icon('right'))),
      h(Select.Portal, { container: uiBox() },
        h(Select.Positioner, { alignItemWithTrigger: false, sideOffset: 4, className: 'z-[210] outline-none' },
          h(Select.Popup, { 'data-tweak-list': field.id, className: 'min-w-[var(--anchor-width)] origin-[var(--transform-origin)] rounded-xl border border-black/10 bg-white p-1 text-[13px] text-zinc-900 shadow-xl shadow-black/15 outline-none transition-[scale,opacity] duration-100 ease-out data-starting-style:scale-[.98] data-starting-style:opacity-0 data-ending-style:scale-[.98] data-ending-style:opacity-0 motion-reduce:transition-none dark:border-white/10 dark:bg-zinc-800 dark:text-zinc-100 dark:shadow-black/50' },
            h(Select.List, { 'data-tweak-scroll': '', className: 'max-h-[min(18rem,calc(var(--available-height)-.5rem))] overflow-y-auto overscroll-contain [scrollbar-width:thin]' },
              ...field.options.map((option, n) => h(Select.Item, { key: option, value: option, 'data-tweak-option': option, className: 'flex min-h-9 cursor-default items-center gap-2 rounded-lg px-2.5 text-xs outline-none select-none data-highlighted:bg-zinc-100 dark:data-highlighted:bg-white/5' },
                h('span', { 'aria-hidden': true, className: 'w-4 shrink-0 text-[11px] tabular-nums text-zinc-400 dark:text-zinc-500' }, n + 1),
                h(Select.ItemText, { dir: 'auto', className: 'min-w-0 flex-1 break-words' }, option),
                h(Select.ItemIndicator, { className: 'flex shrink-0 text-sky-500 dark:text-sky-400' }, icon('check', 'size-3.5'))))))))),
    field.options.length <= 12 && !one ? h('div', { 'aria-hidden': true, className: 'mt-2 flex justify-center gap-1' },
      ...field.options.map((option, n) => h('button', { key: option, type: 'button', tabIndex: -1, title: option, onClick: () => onChange(field.id, option), className: `h-1 rounded-full transition-[width,background-color] duration-150 motion-reduce:transition-none ${n === i ? 'w-4 bg-sky-500 dark:bg-sky-400' : 'w-1.5 bg-zinc-200 hover:bg-zinc-400 dark:bg-zinc-700 dark:hover:bg-zinc-500'}` }))) : null)
}

function Field({ field, onChange, onReset, onActive }: { field: Tweak } & Pick<TweakControlsProps, 'onChange' | 'onReset' | 'onActive'>) {
  const labelId = useId(), noteId = useId()
  const changed = isChanged(field)
  const control = field.kind === 'color' ? (() => {
    const presets = field.presets ?? accents
    return h('div', null,
      h('div', { role: 'group', 'aria-labelledby': labelId, className: 'flex flex-wrap items-center gap-2' },
        ...presets.map(preset => h('button', {
          key: preset.value, type: 'button', 'data-tweak-option': preset.value,
          'aria-label': t('{preset} {name}', { preset: preset.name, name: field.label }), 'aria-pressed': field.value.toLowerCase() === preset.value.toLowerCase(), title: preset.name,
          onClick: () => onChange(field.id, preset.value),
          className: 'grid size-9 shrink-0 place-items-center rounded-full border-2 border-transparent aria-pressed:border-zinc-400',
          style: { backgroundColor: preset.value, color: foreground(preset.value) },
        }, field.value.toLowerCase() === preset.value.toLowerCase() ? icon('check') : null)),
        h('input', {
          type: 'color', 'data-tweak-input': field.id, value: field.value,
          'aria-label': t('Custom {name}', { name: field.label }), title: t('Custom {name}', { name: field.label }),
          onChange: (e: ChangeEvent<HTMLInputElement>) => onChange(field.id, e.target.value),
          className: 'size-9 shrink-0 cursor-pointer appearance-none overflow-hidden rounded-full border border-zinc-300 bg-transparent p-1 dark:border-zinc-600 [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded-full [&::-webkit-color-swatch]:border-0 [&::-moz-color-swatch]:rounded-full [&::-moz-color-swatch]:border-0',
        })),
      h('p', { className: `mt-2 ${note}` }, `${presets.find(preset => preset.value.toLowerCase() === field.value.toLowerCase())?.name ?? t('Custom')} · ${field.value.toUpperCase()}`))
  })() : field.kind === 'select' ? (
    field.options.length <= 4 && field.options.join('').length <= 56
      ? h('div', { role: 'group', 'aria-labelledby': labelId, className: 'flex rounded-lg bg-zinc-100 p-1 dark:bg-zinc-800' },
        ...field.options.map(option => h('button', {
          key: option, type: 'button', 'data-tweak-option': option, 'aria-pressed': field.value === option,
          onClick: () => onChange(field.id, option),
          className: `min-h-9 min-w-0 flex-1 break-words rounded-md px-1 py-1.5 text-[11px] leading-4 [overflow-wrap:anywhere] ${field.value === option ? 'bg-white font-medium text-zinc-900 shadow-sm dark:bg-zinc-600 dark:text-white' : 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white'}`,
        }, option)))
      : h(Stepper, { field, labelId, onChange })
  ) : h('span', { className: 'relative flex shrink-0' },
    h('input', {
      type: 'checkbox', role: 'switch', 'data-tweak-input': field.id, 'aria-labelledby': labelId,
      'aria-describedby': field.note ? noteId : undefined, checked: field.value,
      onChange: (e: ChangeEvent<HTMLInputElement>) => onChange(field.id, e.target.checked),
      className: 'peer h-6 w-10 cursor-pointer appearance-none rounded-full bg-zinc-300 transition-colors checked:bg-proto-primary dark:bg-zinc-700 dark:checked:bg-proto-primary motion-reduce:transition-none',
    }),
    h('span', { 'aria-hidden': true, className: 'pointer-events-none absolute start-1 top-1 size-4 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-4 rtl:peer-checked:-translate-x-4 motion-reduce:transition-none' }))

  return h('section', { 'data-tweak': field.id, className: 'min-w-0', onFocusCapture: field.kind === 'select' ? () => onActive?.(field.id) : undefined, onPointerDownCapture: field.kind === 'select' ? () => onActive?.(field.id) : undefined, onClickCapture: field.kind === 'select' ? () => onActive?.(field.id) : undefined },
    h('div', { className: 'mb-2 flex min-h-7 items-center justify-between gap-2' },
      h('h3', { id: labelId, dir: 'auto', className: 'min-w-0 break-words text-xs font-medium' }, field.label,
        changed ? h('span', { 'aria-label': t('Changed'), title: t('Changed'), className: 'ms-1.5 inline-block size-1.5 rounded-full bg-sky-500' }) : null),
      h('div', { className: 'flex shrink-0 items-center gap-2' },
        stepped(field) ? h('span', { dir: 'ltr', 'data-tweak-count': field.id, className: 'text-[11px] tabular-nums text-zinc-400 dark:text-zinc-500' }, `${field.options.indexOf(field.value) + 1}/${field.options.length}`) : null,
        field.kind === 'toggle' ? control : null,
        changed ? h('button', { type: 'button', 'data-tweak-reset': field.id, 'aria-label': t('Reset {name}', { name: field.label }), title: t('Reset {name}', { name: field.label }), onClick: () => onReset(field.id), className: 'grid size-7 place-items-center rounded hover:bg-zinc-100 dark:hover:bg-zinc-800' }, icon('replay', 'size-3')) : null)),
    field.kind !== 'toggle' ? control : null,
    field.note ? h('p', { id: noteId, dir: 'auto', className: `mt-1 ${note}` }, field.note) : null)
}

function Controls(p: TweakControlsProps) {
  const changed = p.fields.filter(isChanged).length
  return h('div', { 'data-tweaks-controls': '', className: 'space-y-5' },
    ...p.fields.map(field => h(Field, { key: field.id, field, onChange: p.onChange, onReset: p.onReset, onActive: p.onActive })),
    h('button', { type: 'button', 'data-tweak-reset': 'all', onClick: () => p.onReset(), disabled: !changed, className: `${button} w-full border border-zinc-200 dark:border-zinc-700` }, icon('replay', 'size-3.5'), t('Reset all tweaks')))
}

// A phone has the tweaks grow out of the bottom bar, as its comments list does: one surface with the
// bar, only the height moving, a grip that snaps to half or full and drags it shut. Base UI keeps the
// dialog's focus, Escape and outside press; its own swipe is off, the grip here does that.
function useGrowth(p: TweaksDrawerProps, popup: { current: HTMLDivElement | null }) {
  const [bottom, setBottom] = useState(p.bottom)
  const [limits, setLimits] = useState({ half: 280, full: 560, natural: 0 })
  const [snap, setSnap] = useState<'half' | 'full'>('half')
  const [drag, setDrag] = useState<number | null>(null)
  const gesture = useRef<{ id: number; y: number; from: number; moved: boolean } | null>(null)
  const suppressClick = useRef(false)
  useLayoutEffect(() => { if (p.open) setSnap('half') }, [p.open])
  useLayoutEffect(() => {
    if (!p.open) return
    const bar = p.anchor(), host = bar?.closest<HTMLElement>('[data-island-host]')
    const measure = () => {
      const top = bar?.isConnected ? bar.getBoundingClientRect().top : innerHeight - p.bottom
      const hostTop = host?.getBoundingClientRect().top ?? 0, hostH = host?.clientHeight ?? innerHeight
      const el = popup.current
      // Head, controls and the controls' own padding: shorter than half, it stops at its contents.
      const natural = el ? (el.querySelector<HTMLElement>('[data-tweaks-head]')?.offsetHeight ?? 0) + (el.querySelector<HTMLElement>('[data-tweaks-controls]')?.offsetHeight ?? 0) + 24 : 0
      // Full stops short of the stage's top; half reaches its middle, as the comments list does.
      const full = Math.max(0, top - hostTop - 16)
      const half = Math.min(full, Math.max(160, top - hostTop - hostH / 2))
      setBottom(Math.max(0, innerHeight - top))
      setLimits(was => was.full === full && was.half === half && was.natural === natural ? was : { half, full, natural })
    }
    measure()
    const ro = new ResizeObserver(measure)
    if (bar) ro.observe(bar, { box: 'border-box' })
    if (host) ro.observe(host)
    const controls = popup.current?.querySelector<HTMLElement>('[data-tweaks-controls]')
    if (controls) ro.observe(controls)
    addEventListener('resize', measure)
    return () => { ro.disconnect(); removeEventListener('resize', measure) }
  }, [p.open, p.bottom, p.fields.length])
  const settled = Math.min(limits.natural || limits[snap], limits[snap])
  const cancel = () => { gesture.current = null; setDrag(null) }
  const finish = (e: PointerEvent) => {
    const g = gesture.current
    if (!g || e.pointerId !== g.id) return
    gesture.current = null
    setDrag(null)
    if (!g.moved) return
    const last = Math.max(0, Math.min(limits.full, g.from + g.y - e.clientY))
    if (last < Math.min(settled, limits.half) / 2) p.onClose('swipe', e.nativeEvent, () => {})
    else setSnap(last > (limits.half + limits.full) / 2 && limits.natural > limits.half ? 'full' : 'half')
  }
  return {
    bottom,
    height: Math.min(limits.full, drag ?? settled),
    dragging: drag !== null,
    full: snap === 'full',
    toggle: (e: MouseEvent) => {
      if (suppressClick.current && e.detail > 0) { suppressClick.current = false; return }
      setSnap(s => s === 'half' ? 'full' : 'half')
    },
    grip: {
      onPointerDown: (e: PointerEvent<HTMLElement>) => {
        if (!p.open || !e.isPrimary || e.button !== 0) return
        const b = (e.target as Element).closest('button')
        if (b && !b.hasAttribute('data-tweaks-handle')) return
        suppressClick.current = false
        gesture.current = { id: e.pointerId, y: e.clientY, from: popup.current?.offsetHeight ?? settled, moved: false }
      },
      onPointerMove: (e: PointerEvent<HTMLElement>) => {
        const g = gesture.current
        if (!g || e.pointerId !== g.id || (!g.moved && Math.abs(e.clientY - g.y) < 4)) return
        g.moved = true
        suppressClick.current = true
        e.currentTarget.setPointerCapture(e.pointerId)
        e.preventDefault()
        setDrag(Math.max(0, Math.min(limits.full, g.from + g.y - e.clientY)))
      },
      onPointerUp: finish,
      onPointerCancel: cancel,
      onLostPointerCapture: (e: PointerEvent<HTMLElement>) => { if (e.target === e.currentTarget) cancel() },
      onKeyDown: (e: KeyboardEvent) => {
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
        e.preventDefault(); e.stopPropagation()
        setSnap(e.key === 'ArrowUp' ? 'full' : 'half')
      },
    },
  }
}

function TweaksDrawer(p: TweaksDrawerProps) {
  const popup = useRef<HTMLDivElement>(null)
  const changed = p.fields.filter(isChanged).length
  const grow = useGrowth(p, popup)
  return h(Drawer.Root, {
    open: p.open, modal: false,
    onOpenChange: (open: boolean, details: { reason: string; event?: Event; cancel: () => void }) => { if (!open) p.onClose(details.reason, details.event, details.cancel) },
    onOpenChangeComplete: (open: boolean) => { if (!open) p.onGone() },
  },
    h(Drawer.Portal, { container: uiBox() },
      h(Drawer.Viewport, { className: 'pointer-events-none fixed inset-0 z-[200] flex items-end', style: { paddingBottom: `${grow.bottom}px` } },
        h(Drawer.Popup, {
          ref: popup, 'data-tweaks-drawer': '', 'data-base-ui-swipe-ignore': '', finalFocus: p.returnFocus,
          initialFocus: () => popup.current?.querySelector<HTMLElement>('[data-tweaks-close]') ?? null,
          onKeyDownCapture: (e: KeyboardEvent) => {
            if (e.key !== 'Escape') return
            e.preventDefault(); e.stopPropagation()
            p.onClose('escape-key', e.nativeEvent, () => {})
          },
          style: { height: grow.height },
          className: `pointer-events-auto flex w-full flex-col overflow-hidden rounded-t-[22px] border-t border-black/10 bg-white text-zinc-900 shadow-[0_-10px_30px_-18px_rgb(0_0_0/.35)] outline-none touch-auto data-starting-style:!h-0 data-ending-style:!h-0 dark:border-white/10 dark:bg-zinc-950 dark:text-zinc-100 ${grow.dragging ? '' : 'transition-[height] duration-300 ease-out motion-reduce:transition-none'}`,
        },
          h('div', { 'data-tweaks-head': '', ...grow.grip, className: 'relative flex shrink-0 touch-none select-none items-center gap-2 px-3.5 pb-1 pt-6' },
            h('button', { type: 'button', 'data-tweaks-handle': '', 'aria-label': grow.full ? t('Half the screen') : t('Full screen'), onClick: grow.toggle, className: 'absolute inset-x-12 top-0 flex h-6 items-center justify-center rounded-full' },
              h('span', { 'aria-hidden': true, className: 'h-1 w-10 rounded-full bg-zinc-300 dark:bg-zinc-600' })),
            h('div', { className: 'flex min-w-0 flex-1 items-baseline gap-2' },
              h(Drawer.Title, { className: 'shrink-0 text-[13px] font-semibold' }, t('Tweaks')),
              h(Drawer.Description, { className: 'min-w-0 truncate text-[11px] text-zinc-400 dark:text-zinc-500' }, changed ? tn(changed, '{n} change', '{n} changes') : t('Change this preview'))),
            h(Drawer.Close, { 'data-tweaks-close': '', 'aria-label': t('Close tweaks'), title: t('Close tweaks'), className: 'grid size-8 shrink-0 place-items-center rounded-full text-zinc-500 hover:bg-zinc-900/5 active:bg-zinc-900/10 dark:text-zinc-400 dark:hover:bg-white/10 dark:active:bg-white/15' }, icon('chev'))),
          h('div', { className: 'relative flex min-h-0 flex-1 flex-col' },
            h(Drawer.Content, { className: 'min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4 pt-2' }, h(Controls, p)),
            h('span', { 'aria-hidden': true, className: 'pointer-events-none absolute inset-x-0 bottom-0 h-5 bg-gradient-to-t from-white to-transparent dark:from-zinc-950' }))))))
}

/** Call the returned render function with new props, keeping native inputs mounted. */
export function createTweakControls(host: HTMLElement) {
  const root = createRoot(host)
  return (props: TweakControlsProps) => root.render(h(Controls, props))
}

/** The popup lives with the shell's own portaled UI, outside mounted designs. */
export function createTweaksDrawer(host: HTMLElement) {
  const root = createRoot(host)
  return (props: TweaksDrawerProps) => root.render(h(TweaksDrawer, props))
}
