// Jump (⌘K, or the bar's search): one field over every design, flow, screen, exploration and
// option (where.ts), the arrows and Enter to go. A dialog over the page, centred near its top.
import { useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { t } from './i18n'
import { uiBox } from './portals'
import { Ph, type PhName } from './tree/row'
import { jumpMatch, type JumpItem } from './where'

export type JumpProps = { items: JumpItem[]; here: string; onGo: (route: string) => void; onClose: () => void }

const ICON: Record<JumpItem['kind'], PhName> = { design: 'squaresFour', flow: 'path', screen: 'browser', exploration: 'shuffle', option: 'circle' }
const KIND: Record<JumpItem['kind'], () => string> = { design: () => t('Design'), flow: () => t('Flow'), screen: () => t('Screen'), exploration: () => t('Exploration'), option: () => t('Option') }

function Jump({ items, here, onGo, onClose }: JumpProps) {
  const [q, setQ] = useState(''), [at, setAt] = useState(0)
  const field = useRef<HTMLInputElement>(null), list = useRef<HTMLDivElement>(null)
  const found = useMemo(() => jumpMatch(items, q), [items, q])
  useEffect(() => { field.current?.focus() }, [])
  useEffect(() => { setAt(0) }, [q])
  useEffect(() => { list.current?.querySelector<HTMLElement>(`[data-jump-at="${at}"]`)?.scrollIntoView({ block: 'nearest' }) }, [at])
  const go = (i: JumpItem | undefined) => { if (i) { onClose(); onGo(i.route) } }
  return (
    <div data-jump className="fixed inset-0 z-[120] flex justify-center bg-black/20 px-4 pt-[12vh]" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div role="dialog" aria-label={t('Jump to')} className="flex h-fit max-h-[70vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white text-[13px] text-zinc-900 shadow-2xl ring-1 ring-black/10 dark:bg-zinc-900 dark:text-zinc-100 dark:ring-white/10">
        <div className="flex h-12 shrink-0 items-center gap-2 border-b border-black/[.06] px-4 dark:border-white/10">
          <Ph name="magnifyingGlass" className="size-4 text-zinc-400" />
          <input ref={field} data-jump-field value={q} onChange={e => setQ(e.target.value)} dir="auto" placeholder={t('Jump to a design, flow, screen or option')}
            aria-controls="proto-jump-list" aria-activedescendant={found[at] ? `proto-jump-${at}` : undefined}
            onKeyDown={e => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setAt(a => Math.min(a + 1, found.length - 1)) }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setAt(a => Math.max(a - 1, 0)) }
              else if (e.key === 'Enter') { e.preventDefault(); go(found[at]) }
              else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose() }
            }}
            className="h-full min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-zinc-400" />
          <kbd className="font-sans text-[11px] text-zinc-400">Esc</kbd>
        </div>
        <div ref={list} id="proto-jump-list" role="listbox" className="min-h-0 overflow-y-auto overscroll-contain p-1.5">
          {found.map((i, n) => (
            <button key={i.key} id={`proto-jump-${n}`} data-jump-at={n} data-jump-item={i.key} role="option" aria-selected={n === at} type="button"
              onMouseMove={() => setAt(n)} onClick={() => go(i)}
              className={'flex h-10 w-full items-center gap-3 rounded-lg px-3 text-start ' + (n === at ? 'bg-zinc-900/[.05] dark:bg-white/[.08]' : '')}>
              <Ph name={ICON[i.kind]} className="size-4 text-zinc-400" />
              <span dir="auto" className="min-w-0 truncate font-medium">{i.label}</span>
              {i.sub && <span dir="auto" className="min-w-0 truncate text-zinc-400">{i.sub}</span>}
              <span className="ms-auto shrink-0 text-[11px] text-zinc-400">{i.route === here ? t('Here') : KIND[i.kind]()}</span>
            </button>
          ))}
          {!found.length && <p className="px-3 py-4 text-zinc-400">{t('Nothing matches')}</p>}
        </div>
      </div>
    </div>
  )
}

export function createJump() {
  const host = document.createElement('div'); uiBox().append(host)
  const root = createRoot(host)
  let id = 0
  return (props: JumpProps | null) => root.render(props ? <Jump key={++id} {...props} /> : null)
}
