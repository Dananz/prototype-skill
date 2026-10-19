// The same inspector controls in the desktop panel and the phone's dock drawer.
// React roots let the shell use them in React and Vue prototype sessions alike.
import { createElement as h, useId, useRef, type ChangeEvent, type KeyboardEvent } from 'react'
import { createRoot } from 'react-dom/client'
import { Drawer } from '@base-ui/react/drawer'
import { isChanged, type Tweak } from './tweaks'
import { ic, IB } from './ui'
import { uiBox } from './portals'

export type TweakControlsProps = {
  fields: Tweak[]
  onChange: (id: string, value: string | boolean) => void
  onReset: (id?: string) => void
}

export type TweaksDrawerProps = TweakControlsProps & {
  open: boolean
  bottom: number
  onClose: (reason: string, event: Event | undefined, cancel: () => void) => void
  onGone: () => void
  returnFocus: () => HTMLElement | null
}

const accents = [
  { name: 'Indigo', value: '#4f46e5' },
  { name: 'Ocean', value: '#0369a1' },
  { name: 'Forest', value: '#047857' },
  { name: 'Rose', value: '#be123c' },
  { name: 'Amber', value: '#b45309' },
]
const icon = (name: string, size = 'size-4') => h('span', { className: 'inline-flex shrink-0', dangerouslySetInnerHTML: { __html: ic(name, size) } })
const note = 'text-[11px] leading-5 text-zinc-500 dark:text-zinc-400'
const button = 'inline-flex min-h-9 items-center justify-center gap-2 rounded-lg px-3 text-xs font-medium hover:bg-zinc-100 disabled:cursor-default disabled:opacity-40 dark:hover:bg-zinc-800'

// Keep check marks readable on custom palettes, including pale and white swatches.
function foreground(color: string) {
  const rgb = color.slice(1).match(/../g)?.map(x => parseInt(x, 16) / 255).map(x => x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4)
  return rgb && rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722 > .179 ? '#000000' : '#ffffff'
}

function Field({ field, onChange, onReset }: { field: Tweak } & Pick<TweakControlsProps, 'onChange' | 'onReset'>) {
  const labelId = useId(), noteId = useId()
  const changed = isChanged(field)
  const control = field.kind === 'color' ? (() => {
    const presets = field.presets ?? accents
    return h('div', null,
      h('div', { role: 'group', 'aria-labelledby': labelId, className: 'flex flex-wrap items-center gap-2' },
        ...presets.map(preset => h('button', {
          key: preset.value, type: 'button', 'data-tweak-option': preset.value,
          'aria-label': `${preset.name} ${field.label}`, 'aria-pressed': field.value.toLowerCase() === preset.value.toLowerCase(), title: preset.name,
          onClick: () => onChange(field.id, preset.value),
          className: 'grid size-9 shrink-0 place-items-center rounded-full border-2 border-transparent aria-pressed:border-zinc-400',
          style: { backgroundColor: preset.value, color: foreground(preset.value) },
        }, field.value.toLowerCase() === preset.value.toLowerCase() ? icon('check') : null)),
        h('input', {
          type: 'color', 'data-tweak-input': field.id, value: field.value,
          'aria-label': `Custom ${field.label}`, title: `Custom ${field.label}`,
          onChange: (e: ChangeEvent<HTMLInputElement>) => onChange(field.id, e.target.value),
          className: 'size-9 shrink-0 cursor-pointer appearance-none overflow-hidden rounded-full border border-zinc-300 bg-transparent p-1 dark:border-zinc-600 [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded-full [&::-webkit-color-swatch]:border-0 [&::-moz-color-swatch]:rounded-full [&::-moz-color-swatch]:border-0',
        })),
      h('p', { className: `mt-2 ${note}` }, `${presets.find(preset => preset.value.toLowerCase() === field.value.toLowerCase())?.name ?? 'Custom'} · ${field.value.toUpperCase()}`))
  })() : field.kind === 'select' ? (
    field.options.length <= 4 && field.options.join('').length <= 56
      ? h('div', { role: 'group', 'aria-labelledby': labelId, className: 'flex rounded-lg bg-zinc-100 p-1 dark:bg-zinc-800' },
        ...field.options.map(option => h('button', {
          key: option, type: 'button', 'data-tweak-option': option, 'aria-pressed': field.value === option,
          onClick: () => onChange(field.id, option),
          className: `min-h-9 min-w-0 flex-1 break-words rounded-md px-1 py-1.5 text-[11px] leading-4 [overflow-wrap:anywhere] ${field.value === option ? 'bg-white font-medium text-zinc-900 shadow-sm dark:bg-zinc-600 dark:text-white' : 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white'}`,
        }, option)))
      : h('select', {
        'data-tweak-input': field.id, 'aria-labelledby': labelId, 'aria-describedby': field.note ? noteId : undefined,
        value: field.value, onChange: (e: ChangeEvent<HTMLSelectElement>) => onChange(field.id, e.target.value),
        className: 'min-h-9 w-full min-w-0 rounded-lg border border-zinc-200 bg-white px-2 text-xs dark:border-zinc-700 dark:bg-zinc-800',
      }, ...field.options.map(option => h('option', { key: option, value: option }, option)))
  ) : h('span', { className: 'relative flex shrink-0' },
    h('input', {
      type: 'checkbox', role: 'switch', 'data-tweak-input': field.id, 'aria-labelledby': labelId,
      'aria-describedby': field.note ? noteId : undefined, checked: field.value,
      onChange: (e: ChangeEvent<HTMLInputElement>) => onChange(field.id, e.target.checked),
      className: 'peer h-6 w-10 cursor-pointer appearance-none rounded-full bg-zinc-300 transition-colors checked:bg-proto-primary dark:bg-zinc-700 dark:checked:bg-proto-primary motion-reduce:transition-none',
    }),
    h('span', { 'aria-hidden': true, className: 'pointer-events-none absolute start-1 top-1 size-4 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-4 rtl:peer-checked:-translate-x-4 motion-reduce:transition-none' }))

  return h('section', { 'data-tweak': field.id, className: 'min-w-0' },
    h('div', { className: 'mb-2 flex min-h-7 items-center justify-between gap-2' },
      h('h3', { id: labelId, dir: 'auto', className: 'min-w-0 break-words text-xs font-medium' }, field.label,
        changed ? h('span', { 'aria-label': 'Changed', title: 'Changed', className: 'ms-1.5 inline-block size-1.5 rounded-full bg-sky-500' }) : null),
      h('div', { className: 'flex shrink-0 items-center gap-2' },
        field.kind === 'toggle' ? control : null,
        changed ? h('button', { type: 'button', 'data-tweak-reset': field.id, 'aria-label': `Reset ${field.label}`, title: `Reset ${field.label}`, onClick: () => onReset(field.id), className: 'grid size-7 place-items-center rounded hover:bg-zinc-100 dark:hover:bg-zinc-800' }, icon('replay', 'size-3')) : null)),
    field.kind !== 'toggle' ? control : null,
    field.note ? h('p', { id: noteId, dir: 'auto', className: `mt-1 ${note}` }, field.note) : null)
}

function Controls(p: TweakControlsProps) {
  const changed = p.fields.filter(isChanged).length
  return h('div', { 'data-tweaks-controls': '', className: 'space-y-5' },
    ...p.fields.map(field => h(Field, { key: field.id, field, onChange: p.onChange, onReset: p.onReset })),
    h('button', { type: 'button', 'data-tweak-reset': 'all', onClick: () => p.onReset(), disabled: !changed, className: `${button} w-full border border-zinc-200 dark:border-zinc-700` }, icon('replay', 'size-3.5'), 'Reset all tweaks'))
}

function TweaksDrawer(p: TweaksDrawerProps) {
  const popup = useRef<HTMLDivElement>(null)
  const changed = p.fields.filter(isChanged).length
  return h(Drawer.Root, {
    open: p.open, modal: false, swipeDirection: 'down',
    onOpenChange: (open: boolean, details: { reason: string; event?: Event; cancel: () => void }) => { if (!open) p.onClose(details.reason, details.event, details.cancel) },
    onOpenChangeComplete: (open: boolean) => { if (!open) p.onGone() },
  },
    h(Drawer.Portal, { container: uiBox() },
      h(Drawer.Viewport, { className: 'pointer-events-none fixed inset-0 z-[200] flex items-end', style: { paddingBottom: `${Math.max(0, p.bottom)}px` } },
        h(Drawer.Popup, {
          ref: popup, 'data-tweaks-drawer': '', finalFocus: p.returnFocus,
          initialFocus: () => popup.current?.querySelector<HTMLElement>('[data-tweaks-close]') ?? null,
          onKeyDownCapture: (e: KeyboardEvent) => {
            if (e.key !== 'Escape') return
            e.preventDefault(); e.stopPropagation()
            p.onClose('escape-key', e.nativeEvent, () => {})
          },
          className: 'pointer-events-auto flex max-h-[64vh] w-full flex-col overflow-hidden rounded-t-2xl border border-zinc-200 bg-white text-zinc-900 shadow-xl outline-none touch-auto [transform:translateY(var(--drawer-swipe-movement-y,0px))] transition-transform duration-200 ease-out data-swiping:transition-none data-starting-style:translate-y-full data-ending-style:translate-y-full motion-reduce:transition-none dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100',
        },
          h('div', { 'aria-hidden': true, className: 'flex h-5 shrink-0 touch-none items-center justify-center' }, h('div', { className: 'h-1 w-8 rounded-full bg-zinc-300 dark:bg-zinc-600' })),
          h('header', { className: 'flex shrink-0 items-center justify-between gap-2 border-b border-zinc-100 px-4 pb-3 pt-1 dark:border-zinc-800' },
            h('div', { className: 'min-w-0' },
              h(Drawer.Title, { className: 'flex items-center gap-2 text-sm font-semibold' }, icon('tweaks'), 'Tweaks'),
              h(Drawer.Description, { className: `mt-1 ${note}` }, changed ? `${changed} changed` : 'Change this preview')),
            h('div', { className: 'flex shrink-0 items-center gap-1' },
              h(Drawer.Close, { 'data-tweaks-close': '', className: `${button} text-sky-700 dark:text-sky-300` }, 'View preview'),
              h(Drawer.Close, { 'aria-label': 'Close tweaks', className: IB }, icon('x')))),
          h(Drawer.Content, { className: 'min-h-0 overflow-y-auto overscroll-contain p-4' }, h(Controls, p))))))
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
