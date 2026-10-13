// Right-click menus. The shell decides what was clicked and builds its rows; this draws them at the
// pointer: one container for every subject (a prototype, a state, the session, the artboard, an
// element of the design, a comment), and the variant's own menu (decide.tsx) sits in the same
// container with its rows. A row either runs at once, or asks first (a count and a note), as More
// variants does. Shift + right-click is never taken: the shell leaves it to the browser, and the
// footer says so.
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useCtx } from './ctx'
import { useStore } from './store'
import { Icon, MOD, PRIMARY, Pulse } from './ui'

/** A row that asks first: a note (and a count, where there is one) before it sends. */
export type MenuAsk = {
  title: string
  hint: string
  /** The count to start from, with a stepper; none: just a note. */
  count?: number
  send: (note: string, count: number) => Promise<void>
  /** What is said once it went (a count is put in front of it: "5 more variants"). */
  done: (count: number) => string
}
export type MenuRow =
  | { id: string; label: string; icon?: string; hint?: string; kbd?: string; on?: boolean; danger?: boolean; disabled?: boolean; run?: () => void; ask?: MenuAsk }
  | { sep: true }
  | { head: string }

export const ROW = 'flex h-9 w-full items-center gap-2.5 rounded-lg px-2 text-start text-[13px] outline-none hover:bg-zinc-900/[.04] focus-visible:bg-zinc-900/[.06] disabled:opacity-50 dark:hover:bg-white/[.06] dark:focus-visible:bg-white/10'
export const BROWSER_HINT = 'Shift + right-click for the browser menu'

/** The rows as a menu's buttons. Choosing one that runs closes the menu (onDone); one that asks hands its ask up. */
export function MenuRows({ rows, onAsk, onDone }: { rows: MenuRow[]; onAsk: (a: MenuAsk) => void; onDone: () => void }) {
  return <>{rows.map((r, i) => {
    if ('sep' in r) return <div key={i} className="mx-2 my-1 border-t border-black/[.06] dark:border-white/10" />
    if ('head' in r) return <p key={i} className="px-2 pb-1 pt-1.5 text-[11px] text-zinc-500">{r.head}</p>
    return <button key={r.id} role="menuitem" data-shoot={`ctx-${r.id}`} disabled={r.disabled} aria-checked={r.on === undefined ? undefined : r.on}
      onClick={() => { if (r.ask) onAsk(r.ask); else { r.run?.(); onDone() } }}
      className={`${ROW} ${r.danger ? 'text-rose-600 dark:text-rose-400' : r.on ? 'font-medium text-zinc-900 dark:text-white' : 'text-zinc-700 dark:text-zinc-200'}`}>
      {r.icon ? <Icon name={r.icon} className="size-4" /> : <span className="size-4 shrink-0" />}
      <span className="min-w-0 flex-1 truncate">{r.label}</span>
      {r.kbd && <kbd className="shrink-0 font-sans text-xs text-zinc-400">{r.kbd}</kbd>}
      {r.hint && <span className="shrink-0 text-xs font-normal text-zinc-400">{r.hint}</span>}
      {r.on && <Icon name="check" className="size-3.5 shrink-0" />}
    </button>
  })}</>
}

/** The note (and count) a row asked for, then Send. Esc or Back goes back to the rows. */
export function AskForm({ ask, onBack, onDone }: { ask: MenuAsk; onBack: () => void; onDone: () => void }) {
  const { store } = useCtx()
  const listening = !!useStore(store).inbox?.listening
  const [note, setNote] = useState('')
  const [count, setCount] = useState(ask.count ?? 0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [said, setSaid] = useState(false)
  const sending = useRef(false)
  useEffect(() => {
    if (!said) return
    const t = window.setTimeout(onDone, 1800)
    return () => clearTimeout(t)
  }, [said]) // eslint-disable-line react-hooks/exhaustive-deps
  const send = async () => {
    if (sending.current) return
    sending.current = true; setBusy(true); setError('')
    try { await ask.send(note, count); setSaid(true) }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not send') }
    finally { sending.current = false; setBusy(false) }
  }
  const status = <span className="inline-flex min-w-0 items-center gap-1.5 text-xs text-zinc-500"><Pulse on={listening} className="size-1.5" /><span className="truncate">{listening ? 'Claude is listening' : 'Claude sees this on its next turn'}</span></span>
  if (said) return (
    <div role="status" className="p-3">
      <p className="flex items-center gap-2 text-[13px] font-medium"><span className="grid size-5 shrink-0 place-items-center rounded-full bg-proto-primary-soft text-proto-primary-soft-fg"><Icon name="check" className="size-3" /></span>{ask.done(count)}</p>
      <p className="mt-1.5 ps-7 text-xs text-zinc-500">{listening ? 'Sent to Claude.' : 'It waits until Claude listens, on its next turn.'}</p>
    </div>
  )
  const step = 'grid size-8 place-items-center rounded-lg text-zinc-600 hover:bg-zinc-900/5 disabled:opacity-40 dark:text-zinc-300 dark:hover:bg-white/10'
  return (
    <div className="p-2" onKeyDown={(e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (!sending.current) onBack() }
      else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send() }
    }}>
      <div className="flex items-center gap-1 pb-1.5">
        <button onClick={() => { if (!sending.current) onBack() }} aria-label="Back" className="grid size-8 shrink-0 place-items-center rounded-lg text-zinc-500 hover:bg-zinc-900/5 hover:text-zinc-900 dark:hover:bg-white/10 dark:hover:text-white"><Icon name="left" /></button>
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{ask.title}</span>
        {ask.count !== undefined && <span data-shoot="ctx-count" className="flex shrink-0 items-center rounded-xl bg-zinc-900/[.04] dark:bg-white/[.06]">
          <button onClick={() => setCount(c => Math.max(1, c - 1))} disabled={count <= 1} aria-label="One fewer" className={step}><Icon name="minus" className="size-3.5" /></button>
          <output aria-live="polite" className="min-w-5 text-center text-[13px] font-semibold tabular-nums">{count}</output>
          <button onClick={() => setCount(c => Math.min(9, c + 1))} disabled={count >= 9} aria-label="One more" className={step}><Icon name="plus" className="size-3.5" /></button>
        </span>}
      </div>
      <textarea autoFocus value={note} onChange={e => setNote(e.target.value)} rows={3} maxLength={600} dir="auto" placeholder={ask.hint} aria-label={ask.title}
        className="block w-full resize-none rounded-xl bg-zinc-900/[.04] px-3 py-2 text-[13px] leading-5 outline-none ring-1 ring-inset ring-transparent placeholder:text-zinc-400 focus:ring-proto-primary-ring dark:bg-white/[.06] [@media(pointer:coarse)]:text-base" />
      {error && <p role="alert" className="mt-2 rounded-lg bg-rose-500/10 px-2.5 py-1.5 text-xs text-rose-700 dark:text-rose-300">{error}</p>}
      <div className="mt-2 flex items-center justify-end gap-1.5">
        <button onClick={() => { if (!sending.current) onBack() }} className="h-8 shrink-0 rounded-lg px-2.5 text-xs font-medium text-zinc-500 hover:bg-zinc-900/5 dark:hover:bg-white/10">Cancel</button>
        <button onClick={send} disabled={busy} title={`${MOD} Enter`} data-shoot="ctx-send" className={`inline-flex h-8 shrink-0 items-center gap-1 rounded-lg ps-2 pe-3 text-xs font-semibold disabled:opacity-50 ${PRIMARY}`}><Icon name="send" className="size-3.5" />{busy ? 'Sending…' : 'Send'}</button>
      </div>
      <div className="mx-1 mt-2 border-t border-black/[.06] pt-2 dark:border-white/10">{status}</div>
    </div>
  )
}

export type ContextPopProps = {
  open: boolean
  /** Where the pointer was, in this page's px. */
  at: { x: number; y: number } | null
  title?: string
  sub?: string
  rows: MenuRow[]
  onClose: () => void
}

/** The menu at the pointer, kept inside the window, with the line that says how to reach the browser's own. */
export function ContextPop({ open, at, title, sub, rows, onClose }: ContextPopProps) {
  const [ask, setAsk] = useState<MenuAsk | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: 0, top: 0 })
  // A menu opened somewhere else starts from its rows again.
  const key = `${at?.x},${at?.y}`
  useEffect(() => { setAsk(null) }, [key, open])
  useLayoutEffect(() => {
    if (!open || !at || !box.current) return
    const r = box.current.getBoundingClientRect()
    setPos({ left: Math.max(8, Math.min(at.x, innerWidth - r.width - 8)), top: Math.max(8, Math.min(at.y, innerHeight - r.height - 8)) })
  }, [open, at?.x, at?.y, ask, rows.length]) // eslint-disable-line react-hooks/exhaustive-deps
  // The first row takes the focus, so the arrows work at once; they wrap, Home and End jump.
  useLayoutEffect(() => { if (open && !ask) box.current?.querySelector<HTMLElement>('[role=menuitem]:not([disabled])')?.focus({ preventScroll: true }) }, [open, ask, key])
  if (!open || !at) return null
  const arrows = (e: KeyboardEvent) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return
    e.preventDefault()
    const items = [...box.current!.querySelectorAll<HTMLElement>('[role=menuitem]:not([disabled])')], i = items.indexOf(document.activeElement as HTMLElement)
    const to = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
    items[to]?.focus()
  }
  // The shell closes it on Esc and on a click outside; a click inside goes no further, since a
  // choice redraws the menu under it and a click on a removed button reads as one outside.
  return (
    <div ref={box} data-pop data-context-menu onClick={e => e.stopPropagation()} onContextMenu={e => { if (!e.shiftKey) e.preventDefault() }}
      className="fixed z-40 w-72 overflow-hidden rounded-2xl border border-black/10 bg-white text-[13px] text-zinc-900 shadow-xl shadow-black/10 dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-100" style={pos}>
      {ask
        ? <AskForm ask={ask} onBack={() => setAsk(null)} onDone={onClose} />
        : <div role="menu" aria-label={title ?? 'Options'} onKeyDown={arrows} className="p-1.5">
            {title && <div className="flex min-w-0 items-center gap-1.5 px-2 pb-1 pt-1 text-[11px] text-zinc-500"><b className="font-semibold text-zinc-700 dark:text-zinc-200">{title}</b>{sub && <span dir="auto" className="truncate">{sub}</span>}</div>}
            <MenuRows rows={rows} onAsk={setAsk} onDone={onClose} />
            <p className="mx-2 mt-1.5 border-t border-black/[.06] pb-1 pt-2 text-xs text-zinc-400 dark:border-white/10">{BROWSER_HINT}</p>
          </div>}
    </div>
  )
}
