// A shell dialog in React in both React and Vue sessions, like sheet.ts.
import { createElement as h, type ReactNode, type ChangeEvent } from 'react'
import { createRoot } from 'react-dom/client'
import { Dialog } from '@base-ui/react/dialog'
import { Tabs } from '@base-ui/react/tabs'
import { ic, IB } from './ui'
import { uiBox } from './portals'

export type Appearance = 'system' | 'light' | 'dark'
type Props = {
  open: boolean
  appearance: Appearance
  live: boolean
  sidebar: boolean
  review: boolean
  stack: boolean
  onClose: () => void
  onAppearance: (value: Appearance) => void
  onLive: (value: boolean) => void
  onSidebar: (value: boolean) => void
  onReview: (value: boolean) => void
  onLayout: (stack: boolean) => void
  onResetWidths: () => void
  returnFocus: () => HTMLElement | null
}

const muted = 'text-xs leading-5 text-zinc-500 dark:text-zinc-400'
const icon = (name: string) => h('span', { dangerouslySetInnerHTML: { __html: ic(name) } })
const section = (title: string, ...children: ReactNode[]) => h('section', { className: 'space-y-4' }, h('h3', { className: 'text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500' }, title), ...children)
const toggle = (key: string, title: string, detail: string, on: boolean, change: (on: boolean) => void) =>
  h('label', { 'data-setting': key, ...(key === 'live' ? { 'data-shoot': 'send-live' } : {}), className: 'flex cursor-pointer items-center gap-5' },
    h('span', { className: 'min-w-0 flex-1' }, h('span', { className: 'block text-[13px] font-medium' }, title), h('span', { className: `mt-0.5 block ${muted}` }, detail)),
    h('span', { className: 'relative flex shrink-0' },
      h('input', { type: 'checkbox', role: 'switch', checked: on, onChange: (e: ChangeEvent<HTMLInputElement>) => change(e.target.checked), className: 'peer h-6 w-10 cursor-pointer appearance-none rounded-full bg-zinc-300 transition-colors checked:bg-proto-primary dark:bg-zinc-700 dark:checked:bg-proto-primary motion-reduce:transition-none' }),
      h('span', { 'aria-hidden': true, className: 'pointer-events-none absolute left-1 top-1 size-4 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-4 motion-reduce:transition-none' })))
const choices = (label: string, children: ReactNode[]) => h('div', { role: 'group', 'aria-label': label, className: 'flex shrink-0 gap-0.5 rounded-lg bg-zinc-900/[.05] p-1 dark:bg-white/[.06]' }, ...children)
const choice = (key: string, value: string, label: string, selected: boolean, run: () => void, symbol: string) =>
  h('button', { key: value, type: 'button', [`data-setting-${key}`]: value, 'aria-pressed': selected, onClick: run, className: `inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md px-2.5 text-xs ${selected ? 'bg-white font-medium text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-white' : 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white'}` }, icon(symbol), label)

function Settings(p: Props) {
  const mod = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl'
  const shortcuts = [
    ['Previous / next variant', '← / →'], ['Comment on an element', 'C'], ['Comment on the whole variant', 'Shift C'],
    ['Send draft comments', `${mod} Enter`], ['Toggle sidebar', `${mod} \\`], ['Toggle focus mode', 'F'],
    ['Go to the working variant', 'W'], ['Design actions (desktop)', 'P'], ['Close a tool or go back', 'Esc'],
  ]
  return h(Dialog.Root, { open: p.open, onOpenChange: (open: boolean) => { if (!open) p.onClose() } },
    h(Dialog.Portal, { container: uiBox() },
      h(Dialog.Backdrop, { 'data-settings-ui': '', onClick: p.onClose, className: 'fixed inset-0 z-[300] bg-black/25 dark:bg-black/60' }),
      h(Dialog.Popup, {
        'data-settings-ui': '', 'data-settings-dialog': '',
        finalFocus: p.returnFocus,
        className: 'fixed left-1/2 top-1/2 z-[301] flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-[480px] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-black/10 bg-white text-zinc-900 shadow-2xl dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-100',
      },
        h('div', { className: 'flex shrink-0 items-start gap-3 px-6 pb-4 pt-5' },
          h('div', { className: 'min-w-0 flex-1' }, h(Dialog.Title, { className: 'text-lg font-semibold tracking-tight' }, 'Settings'), h(Dialog.Description, { className: `mt-1 ${muted}` }, 'Make this workspace feel like yours.')),
          h(Dialog.Close, { 'data-settings-close': '', 'aria-label': 'Close settings', className: `${IB} -mr-2 -mt-1` }, icon('x'))),
        h(Tabs.Root, { defaultValue: 'preferences', className: 'flex min-h-0 flex-1 flex-col' },
          h(Tabs.List, { className: 'mx-6 flex shrink-0 gap-5 border-b border-black/[.07] dark:border-white/10' },
            ...['preferences', 'shortcuts'].map(tab => h(Tabs.Tab, { key: tab, value: tab, 'data-settings-tab': tab, className: '-mb-px border-b-2 border-transparent py-2.5 text-[13px] font-medium text-zinc-500 data-active:border-proto-primary data-active:text-zinc-900 dark:text-zinc-400 dark:data-active:text-white' }, tab === 'preferences' ? 'Preferences' : 'Shortcuts'))),
          h(Tabs.Panel, { value: 'preferences', className: 'min-h-0 overflow-y-auto overscroll-contain px-6 py-5' },
            h('div', { className: 'space-y-6' },
              section('Appearance',
                choices('Appearance', (['system', 'light', 'dark'] as const).map(value => choice('theme', value, value === 'system' ? 'System' : value === 'light' ? 'Light' : 'Dark', p.appearance === value, () => p.onAppearance(value), value === 'light' ? 'sun' : value === 'dark' ? 'moon' : 'desktop')))),
              section('Feedback', toggle('live', 'Send each comment as you add it', 'Send new comments immediately. Turn off to collect drafts and send them together.', p.live, p.onLive)),
              section('Browsing',
                h('div', { className: 'flex flex-wrap items-center justify-between gap-3' }, h('div', null, h('p', { className: 'text-[13px] font-medium' }, 'Overview layout'), h('p', { className: muted }, 'How variants appear in overviews.')), choices('Overview layout', [choice('layout', 'grid', 'Grid', !p.stack, () => p.onLayout(false), 'grid'), choice('layout', 'stack', 'List', p.stack, () => p.onLayout(true), 'rows')])),
                toggle('sidebar', 'Show sidebar', 'Keep prototype navigation open on wide screens.', p.sidebar, p.onSidebar),
                toggle('review', 'Show review panel', 'Keep Comments and Try it open on wide screens when available.', p.review, p.onReview),
                h('div', { className: 'flex flex-wrap items-center justify-between gap-3 border-t border-black/[.06] pt-4 dark:border-white/10' }, h('p', { className: muted }, 'Restore sidebar and column widths.'), h('button', { type: 'button', 'data-setting-reset': '', onClick: p.onResetWidths, className: 'h-8 rounded-md border border-black/10 px-3 text-xs font-medium hover:bg-zinc-900/5 dark:border-white/15 dark:hover:bg-white/5' }, 'Reset widths'))))),
          h(Tabs.Panel, { value: 'shortcuts', className: 'min-h-0 overflow-y-auto overscroll-contain px-6 py-4' },
            h('p', { className: `mb-3 ${muted}` }, 'Use these while browsing, outside text fields.'),
            h('dl', { className: 'divide-y divide-black/[.06] dark:divide-white/10' }, ...shortcuts.map(([label, key]) => h('div', { key: label, className: 'flex items-center justify-between gap-3 py-3 text-[13px]' }, h('dt', null, label), h('dd', { className: 'shrink-0' }, h('kbd', { className: 'rounded-md border border-black/10 bg-zinc-50 px-2 py-1 font-sans text-[11px] text-zinc-500 dark:border-white/10 dark:bg-zinc-800 dark:text-zinc-300' }, key))))))),
        h('div', { className: `shrink-0 border-t border-black/[.07] px-6 py-3 dark:border-white/10 ${muted}` }, 'Preferences save automatically in this browser.'))))
}

export function createSettings() {
  const host = document.createElement('div')
  uiBox().append(host)
  const root = createRoot(host)
  return (props: Props) => root.render(h(Settings, props))
}
