// A shell dialog in React in both React and Vue sessions, like sheet.ts.
import { createElement as h, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type ChangeEvent } from 'react'
import { createRoot } from 'react-dom/client'
import { Dialog } from '@base-ui/react/dialog'
import { Drawer } from '@base-ui/react/drawer'
import { ago, ic, IB } from './ui'
import { uiBox } from './portals'
import { islandPrefs, useIslandPrefs } from './comments/island-prefs'
import { LANG_NAMES, LANGS, langChoice, rtl, sessionLang, setLangChoice, t } from './i18n'

export type Appearance = 'system' | 'light' | 'dark'
export type Category = 'appearance' | 'feedback' | 'browsing' | 'session' | 'shortcuts'
type Props = {
  open: boolean
  appearance: Appearance
  live: boolean
  sidebar: boolean
  review: boolean
  stack: boolean
  /** Opens on this category (the sidebar's session name asks for session, the bar's menu for shortcuts). */
  category?: Category
  session: { host: string; id: string; name: string; url: string; keep: boolean; server: 'live' | 'reconnecting' | 'stopped'; listening: boolean; error: string | null
    /** What the session's popover used to say: where it lives, when it started, its last edit, and when it goes. */
    path: string; started: string; lastEdit: number | null; idleHours: number | null; deletes: string | null }
  onKeep: (value: boolean) => Promise<void>
  onStop: () => Promise<void>
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
const toggle = (key: string, title: string, detail: string, on: boolean, change: (on: boolean) => void, disabled = false) =>
  h('label', { 'data-setting': key, ...(key === 'live' ? { 'data-shoot': 'send-live' } : {}), className: 'flex cursor-pointer items-center gap-5' },
    h('span', { className: 'min-w-0 flex-1' }, h('span', { className: 'block text-[13px] font-medium' }, title), h('span', { className: `mt-0.5 block ${muted}` }, detail)),
    h('span', { className: 'relative flex shrink-0' },
      h('input', { type: 'checkbox', role: 'switch', checked: on, disabled, onChange: (e: ChangeEvent<HTMLInputElement>) => change(e.target.checked), className: 'peer disabled:cursor-default disabled:opacity-50 h-6 w-10 cursor-pointer appearance-none rounded-full bg-zinc-300 transition-colors checked:bg-proto-primary dark:bg-zinc-700 dark:checked:bg-proto-primary motion-reduce:transition-none' }),
      h('span', { 'aria-hidden': true, className: 'pointer-events-none absolute start-1 top-1 size-4 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-4 rtl:peer-checked:-translate-x-4 motion-reduce:transition-none' })))
const choices = (label: string, children: ReactNode[]) => h('div', { role: 'group', 'aria-label': label, className: 'flex shrink-0 gap-0.5 rounded-lg bg-zinc-900/[.05] p-1 dark:bg-white/[.06]' }, ...children)
const choice = (key: string, value: string, label: string, selected: boolean, run: () => void, symbol: string) =>
  h('button', { key: value, type: 'button', [`data-setting-${key}`]: value, 'aria-pressed': selected, onClick: run, className: `inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md px-2.5 text-xs ${selected ? 'bg-white font-medium text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-white' : 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white'}` }, icon(symbol), label)

const categories = [
  { id: 'appearance', label: t('Appearance'), symbol: 'sun', detail: t('Choose how the workspace looks.') },
  { id: 'feedback', label: t('Feedback'), symbol: 'comment', detail: t('Choose when your comments are sent.') },
  { id: 'browsing', label: t('Browsing'), symbol: 'grid', detail: t('Arrange your workspace.') },
  { id: 'session', label: t('Session'), symbol: 'link', detail: t('Manage this prototype session.') },
  { id: 'shortcuts', label: t('Shortcuts'), symbol: 'keyboard', detail: t('Use these while browsing, outside text fields.') },
] as const
const button = 'h-9 shrink-0 rounded-md border border-black/10 px-3 text-xs font-medium hover:bg-zinc-100 disabled:cursor-default disabled:opacity-50 dark:border-white/15 dark:hover:bg-zinc-800'

function Settings(p: Props) {
  const titleId = useId()
  const island = useIslandPrefs()
  const [category, setCategory] = useState<Category>('appearance')
  useEffect(() => { if (p.open && p.category) setCategory(p.category) }, [p.open, p.category])
  const [mobile, setMobile] = useState(() => matchMedia('(max-width:639px)').matches)
  const [pending, setPending] = useState<'keep' | 'stop' | null>(null)
  const [notice, setNotice] = useState('')
  const [manualCopy, setManualCopy] = useState('')
  const [copying, setCopying] = useState(false)
  const copyInFlight = useRef(false)
  const popup = useRef<HTMLDivElement>(null)
  const previousHeight = useRef(0), animation = useRef<Animation | null>(null)
  const timer = useRef(0)
  useEffect(() => {
    const mq = matchMedia('(max-width:639px)')
    const update = () => { previousHeight.current = 0; setMobile(mq.matches) }
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])
  useEffect(() => () => { animation.current?.cancel(); clearTimeout(timer.current) }, [])
  useLayoutEffect(() => {
    const el = popup.current
    if (!p.open || !el) { previousHeight.current = 0; animation.current?.cancel(); return }
    const from = animation.current?.playState === 'running' ? el.getBoundingClientRect().height : previousHeight.current
    animation.current?.cancel()
    const to = el.getBoundingClientRect().height
    previousHeight.current = to
    if (from && Math.abs(from - to) > 1 && !matchMedia('(prefers-reduced-motion:reduce)').matches) {
      animation.current = el.animate([{ height: `${from}px` }, { height: `${to}px` }], { duration: 260, easing: 'cubic-bezier(.22,1,.36,1)' })
    }
  })
  const choose = (next: Category) => { previousHeight.current = popup.current?.getBoundingClientRect().height ?? 0; setNotice(''); setManualCopy(''); setCategory(next) }
  const copy = async (text: string, message: string) => {
    if (copyInFlight.current) return
    copyInFlight.current = true; setCopying(true)
    try { await navigator.clipboard.writeText(text); setManualCopy(''); setNotice(message) }
    catch { setManualCopy(text); setNotice(t('Could not copy automatically. Select and copy the text below.')) }
    finally { copyInFlight.current = false; setCopying(false) }
    clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setNotice(''), 6000)
  }
  const changeSession = async (action: 'keep' | 'stop', run: () => Promise<void>) => {
    if (pending) return
    setPending(action)
    try { await run() } finally { setPending(null) }
  }
  const selected = categories.find(item => item.id === category)!
  const Surface = mobile ? Drawer : Dialog
  const Viewport = mobile ? Drawer.Viewport : 'div'
  const Content = mobile ? Drawer.Content : 'section'
  const mod = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl'
  const shortcuts = [
    [t('Previous / next variant'), '← / →'], [t('Comment on an element'), 'C'], [t('Comment on the whole variant'), 'Shift C'],
    [t('Send draft comments'), `${mod} Enter`], [t('Toggle sidebar'), `${mod} \\`], [t('Toggle focus mode'), 'F'], [t('Replay the variant'), 'R'],
    [t('Fit and center canvas'), `${mod} 0`],
    [t('Go to the working variant'), 'W'], [t('Design actions (desktop)'), 'P'], [t('Favorite or unfavorite the variant'), 'S'], [t('Close a tool or go back'), 'Esc'],
  ]
  const pane = category === 'appearance' ? h('div', { className: 'pb-6' },
    choices(t('Appearance'), (['system', 'light', 'dark'] as const).map(value => choice('theme', value, value === 'system' ? t('System') : value === 'light' ? t('Light') : t('Dark'), p.appearance === value, () => p.onAppearance(value), value === 'light' ? 'sun' : value === 'dark' ? 'moon' : 'desktop'))),
    h('p', { className: `mt-3 ${muted}` }, p.appearance === 'system' ? t('Follow the appearance of your device.') : p.appearance === 'light' ? t('Use light appearance for this workspace.') : t('Use dark appearance for this workspace.')),
    h('div', { 'data-setting-language': '', className: 'mt-6 space-y-3 border-t border-black/[.06] pt-5 dark:border-white/10' },
      h('div', null, h('p', { className: 'text-[13px] font-medium' }, t('Language')), h('p', { className: muted }, t('The words around your designs. The designs keep their own.'))),
      choices(t('Language'), (['auto', ...LANGS] as const).map(value => h('button', { key: value, type: 'button', 'data-setting-lang': value, lang: value === 'auto' ? undefined : value, 'aria-pressed': langChoice === value, onClick: () => setLangChoice(value),
        className: `inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md px-2.5 text-xs ${langChoice === value ? 'bg-white font-medium text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-white' : 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white'}` },
        value === 'auto' ? icon('translate') : null, value === 'auto' ? t('Conversation') : LANG_NAMES[value]))),
      h('p', { className: muted }, langChoice === 'auto' ? t('Follows the language you talk to the agent in, now {name}.', { name: LANG_NAMES[sessionLang()] }) : t('Always {name} in this browser.', { name: LANG_NAMES[langChoice] }))))
    : category === 'feedback' ? h('div', { className: 'space-y-5 pb-6' }, toggle('live', t('Send each comment as you add it'), t('Send new comments immediately. Turn off to collect drafts and send them together.'), p.live, p.onLive),
      // The comments island (comments/island.tsx): where it rests on a wide screen, and which news grows it.
      h('div', { 'data-setting-island': '', className: 'space-y-3 border-t border-black/[.06] pt-5 dark:border-white/10' },
        h('div', null, h('p', { className: 'text-[13px] font-medium' }, t('Comments island')), h('p', { className: muted }, t('Which edge of the stage it rests on, on a wide screen. Drag it to another edge to move it; on a side it stands upright. Double-click its edge to bring it back to the foot.'))),
        choices(t('Comments island'), (['bottom', 'top', 'right'] as const).map(value => choice('island', value, { bottom: t('Bottom'), top: t('Top'), right: rtl ? t('Left') : t('Right') }[value], island.place === value, () => islandPrefs.set({ place: value, along: 0 }), { bottom: 'chev', top: 'caret-up', right: 'right' }[value]))),
        h('div', { className: 'pt-2' }, h('p', { className: 'text-[13px] font-medium' }, t('Notifications')), h('p', { className: muted }, t('Which news from the agent grows the island for a moment.'))),
        choices(t('Notifications'), (['all', 'replies', 'off'] as const).map(value => choice('island-news', value, value === 'all' ? t('All') : value === 'replies' ? t('Replies') : t('Off'), island.news === value, () => islandPrefs.set({ news: value }), value === 'off' ? 'x' : value === 'replies' ? 'comment' : 'check')))))
    : category === 'browsing' ? h('div', { className: 'space-y-5' },
      h('div', { className: 'space-y-3' }, h('div', null, h('p', { className: 'text-[13px] font-medium' }, t('Overview layout')), h('p', { className: muted }, t('How variants appear in overviews.'))), choices(t('Overview layout'), [choice('layout', 'grid', t('Grid'), !p.stack, () => p.onLayout(false), 'grid'), choice('layout', 'stack', t('List'), p.stack, () => p.onLayout(true), 'rows')])),
      toggle('sidebar', t('Show sidebar'), t('Keep prototype navigation open on wide screens.'), p.sidebar, p.onSidebar),
      toggle('review', t('Show review panel'), t('Keep Try it open on wide screens when available.'), p.review, p.onReview),
      h('div', { className: 'flex flex-wrap items-center justify-between gap-3 border-t border-black/[.06] pt-4 dark:border-white/10' }, h('p', { className: muted }, t('Restore sidebar and column widths.')), h('button', { type: 'button', 'data-setting-reset': '', onClick: p.onResetWidths, className: button }, t('Reset widths'))))
    : category === 'session' ? h('div', { className: 'space-y-5' },
      h('div', null, h('p', { dir: 'auto', className: 'text-[13px] font-medium' }, p.session.name),
        h('p', { 'data-setting-path': '', className: `mt-0.5 flex min-w-0 items-center gap-1.5 ${muted}` }, icon('folder'), h('span', { className: 'truncate' }, `${p.session.path} · ${t('started {time}', { time: p.session.started })}`)),
        h('div', { className: 'mt-2 flex items-center gap-2 rounded-lg border border-black/10 px-3 py-2 dark:border-white/10' },
          h('input', { 'aria-label': t('Session URL'), readOnly: true, value: p.session.url, className: 'min-w-0 flex-1 bg-transparent text-xs text-zinc-500 dark:text-zinc-400' }),
          h('button', { type: 'button', 'data-setting-copy-url': '', disabled: copying, onClick: () => void copy(p.session.url, t('Session URL copied.')), className: 'h-8 shrink-0 rounded-md px-2 text-xs font-medium hover:bg-zinc-100 disabled:cursor-default disabled:opacity-50 dark:hover:bg-zinc-800' }, t('Copy URL')))),
      toggle('keep', t('Keep forever'), p.session.keep ? t('Kept: it is not removed automatically.') : p.session.idleHours ? (p.session.deletes ? t('Stops after {hours}h idle. Deletes {deletes} unless kept.', { hours: p.session.idleHours, deletes: p.session.deletes }) : t('Stops after {hours}h idle.', { hours: p.session.idleHours })) : t('Keep this session instead of removing it automatically.'), p.session.keep, on => void changeSession('keep', () => p.onKeep(on)), !!pending || p.session.server === 'stopped'),
      h('div', { className: 'flex items-center justify-between gap-4 border-t border-black/[.06] pt-4 dark:border-white/10' },
        h('div', null, h('p', { className: 'text-[13px] font-medium' }, t('Server')), h('p', { 'data-setting-server-status': '', className: muted }, p.session.server === 'live' ? (p.session.lastEdit ? `${t('Live')} · ${t('edited {time}', { time: ago(p.session.lastEdit) })}` : t('Live')) : p.session.server === 'stopped' ? t('Stopped. Run proto up to start it again.') : t('Reconnecting…'))),
        h('button', { type: 'button', 'data-setting-stop': '', disabled: !!pending || p.session.server === 'stopped', onClick: () => void changeSession('stop', p.onStop), className: `${button} text-rose-600 dark:text-rose-400` }, pending === 'stop' ? t('Stopping…') : p.session.server === 'stopped' ? t('Stopped') : t('Stop server'))),
      h('div', { className: 'flex flex-wrap items-center justify-between gap-3 border-t border-black/[.06] pt-4 dark:border-white/10' },
        h('div', null, h('p', { className: 'text-[13px] font-medium' }, t('{host} listener', { host: p.session.host })), h('p', { 'data-setting-listener-status': '', className: muted }, p.session.listening ? t('Connected') : t('Not listening')), h('p', { className: muted }, t('Paste the restart message in your agent thread.'))),
        h('button', { type: 'button', 'data-setting-reconnect': '', disabled: copying, onClick: () => void copy(`Listen for my prototype comments again: run proto inbox --wait --session ${JSON.stringify(p.session.id)}. Handle waiting and unanswered comments first.`, t('Restart message copied. Paste it in your agent thread.')), className: button }, t('Copy restart message'))),
      p.session.error ? h('p', { role: 'alert', className: 'text-xs text-rose-600 dark:text-rose-400' }, p.session.error) : null,
      notice ? h('p', { role: 'status', className: muted }, notice) : null,
      manualCopy ? h('textarea', { 'aria-label': t('Text to copy'), readOnly: true, value: manualCopy, rows: 3, className: 'block w-full resize-y rounded-lg border border-black/10 bg-transparent p-3 text-xs leading-5 dark:border-white/15' }) : null)
    : h('dl', { className: 'divide-y divide-black/[.06] dark:divide-white/10' }, ...shortcuts.map(([label, key]) => h('div', { key: label, className: 'flex items-center justify-between gap-3 py-3 text-[13px]' }, h('dt', null, label), h('dd', { className: 'shrink-0' }, h('kbd', { className: 'rounded-md border border-black/10 bg-zinc-50 px-2 py-1 font-sans text-[11px] text-zinc-500 dark:border-white/10 dark:bg-zinc-800 dark:text-zinc-300' }, key)))))

  return h(Surface.Root, { open: p.open, onOpenChange: (open: boolean) => { if (!open) p.onClose() } },
    h(Surface.Portal, { container: uiBox() },
      h(Surface.Backdrop, { 'data-settings-ui': '', onClick: p.onClose, className: 'fixed inset-0 z-[300] bg-black/25 dark:bg-black/60' }),
      h(Viewport, { className: 'pointer-events-none fixed inset-0 z-[301]' },
        // Like the other shell drawers, its swipe listeners must hear pointerup on the page.
        h(Surface.Popup, {
          ref: popup, 'data-settings-ui': '', ...(mobile ? { 'data-settings-drawer': '' } : {}), 'data-settings-dialog': '',
          initialFocus: () => popup.current?.querySelector<HTMLElement>('[data-settings-close]') ?? null,
          finalFocus: p.returnFocus,
          onKeyDownCapture: (e: { key: string; preventDefault: () => void; stopPropagation: () => void }) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); p.onClose() } },
          className: `pointer-events-auto fixed z-[301] flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden border border-black/10 bg-white text-zinc-900 shadow-2xl dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-100 ${mobile ? 'inset-x-0 bottom-0 w-full rounded-t-3xl [transform:translateY(var(--drawer-swipe-movement-y,0px))] transition-transform duration-300 ease-out data-starting-style:translate-y-full data-ending-style:translate-y-full data-swiping:duration-0 motion-reduce:transition-none' : 'left-1/2 top-1/2 w-[calc(100%-2rem)] max-w-[640px] -translate-x-1/2 -translate-y-1/2 rounded-2xl'}`,
        },
          mobile ? h('div', { 'data-settings-handle': '', 'aria-hidden': true, className: 'mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-zinc-300 dark:bg-zinc-700' }) : null,
          h('header', { className: 'flex shrink-0 items-start justify-between gap-3 border-b border-black/[.07] px-5 pb-4 pt-5 sm:px-6 dark:border-white/10' },
            h('div', null, h(Surface.Title, { className: 'text-lg font-semibold tracking-tight' }, t('Settings')), h(Surface.Description, { className: `mt-1 ${muted}` }, t('Make this workspace feel like yours.'))),
            h(Surface.Close, { 'data-settings-close': '', 'aria-label': t('Close settings'), className: `${IB} -me-2 -mt-1` }, icon('x'))),
          h('div', { className: 'flex min-h-0 flex-1 flex-col sm:flex-row' },
            h('nav', { 'aria-label': t('Settings categories'), className: 'flex shrink-0 gap-0.5 overflow-x-auto border-b border-black/[.07] p-2 sm:w-40 sm:flex-col sm:gap-1 sm:border-b-0 sm:border-e sm:p-3 dark:border-white/10' },
              ...categories.map(item => h('button', { key: item.id, type: 'button', 'data-settings-category': item.id, 'aria-current': item.id === category ? 'page' : undefined, onClick: () => choose(item.id), className: `flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg px-2 text-xs font-medium sm:justify-start sm:px-3 ${item.id === category ? 'bg-proto-primary/[.08] text-proto-primary dark:bg-proto-primary/20 dark:text-indigo-300' : 'text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/5 dark:hover:text-white'}` }, h('span', { className: 'hidden sm:inline-flex' }, icon(item.symbol)), item.label))),
            h(Content, { key: category, 'aria-labelledby': titleId, className: 'min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-6 pt-5 sm:min-h-52 sm:px-6 sm:pt-6' },
              h('h2', { id: titleId, className: 'text-[13px] font-semibold' }, selected.label), h('p', { className: `mb-5 mt-1 ${muted}` }, selected.detail), pane)),
          h('footer', { className: `shrink-0 border-t border-black/[.07] px-5 py-3 pb-[max(.75rem,env(safe-area-inset-bottom))] sm:px-6 dark:border-white/10 ${muted}` }, category === 'session' ? t('Changes apply to this session.') : t('Preferences save automatically in this browser.'))))))
}

export function createSettings() {
  const host = document.createElement('div')
  uiBox().append(host)
  const root = createRoot(host)
  return (props: Props) => root.render(h(Settings, props))
}
