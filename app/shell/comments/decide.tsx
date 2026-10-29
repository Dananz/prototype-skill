// A variant's own decisions, made in the page instead of by pasting its link into chat: Pick
// (marked at once; on the picked variant it reads Picked and takes the pick back), More like this
// and Build it, each with an optional short note (Pick also as "Pick with a note…", so a choice can say why
// or what to change in it). All three reach Claude the way comments do, a
// batch of one comment with an action and no element, so the inbox, `proto reply` and the Comments
// list treat them like any other. A wide page opens them from the bar's check button as a menu; a
// phone has them at the top of the variant sheet.
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useAgentName, useCtx } from './ctx'
import { useStore } from './store'
import type { Action, Note } from './types'
import { PLACEHOLDER, useTagField } from './tag-field'
import { ACTION, Icon, MOD, PRIMARY, Pulse } from './ui'
import { BROWSER_HINT, MenuRows, type MenuRow } from './menu'
import { rtl, t } from '../i18n'

/** The variant on screen, and whether it is the prototype's pick. */
export type Subject = { proto: string; variant: string; label: string; name: string; picked: boolean; hints?: boolean; copy?: boolean }
type Ask = 'pick' | 'more' | 'build' | 'try-it' | 'copy-options'

const NOTE: Record<Ask, { title: (v: string) => string; hint: string; done: (v: string) => string }> = {
  pick: { title: v => t('Pick {v}', { v }), hint: t('Optional: why this one, or what to change in it'), done: v => t('Picked {v}', { v }) },
  'try-it': { title: v => t('Needs explanation: {v}', { v }), hint: t('What is hard to figure out? Optional.'), done: v => t('Asked for an explanation of {v}', { v }) },
  'copy-options': { title: v => t('Generate copy options for {v}', { v }), hint: t('Optional: which lines or what tone? Starts with the headline and primary text.'), done: v => t('Asked for copy options for {v}', { v }) },
  more: { title: v => t('More like {v}', { v }), hint: t('Optional: what to keep, what to push further'), done: v => t('Asked for more like {v}', { v }) },
  build: { title: v => t('Build {v}', { v }), hint: t('Optional: anything to know before building it'), done: v => t('Asked to build {v}', { v }) },
}

export function Decide({ subject, sheet = false, onDone, onComment, rows, lead, commentLabel }: { subject: Subject; sheet?: boolean; onDone?: () => void; onComment?: () => void; rows?: MenuRow[]; lead?: MenuRow[]; commentLabel?: string }) {
  const labelComment = commentLabel ?? t('Comment on this')
  const agent = useAgentName()
  const { store, act } = useCtx()
  const state = useStore(store)
  const listening = !!state.inbox?.listening
  const pending = (a: Ask) => state.inbox?.batches.some(b => b.comments.some(c => c.route === `${subject.proto}/${subject.variant}` && c.action === a && !c.scoped && !c.done && !c.withdrawn))
  const sending = useRef(false)
  const [ask, setAsk] = useState<Ask | null>(null)
  // The card's choice (the menu on a wide page): picked, it starts with nothing chosen.
  const [choice, setChoice] = useState<'pick' | 'more' | 'build' | null>(subject.picked ? null : 'pick')
  // The note (its words, and chips where variants and elements were tagged); one box at a time is shown,
  // the asked one's or the card's.
  const field = useTagField({ noElements: sheet, about: subject })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [said, setSaid] = useState<Ask | null>(null)
  // A pick shows at once; the page's copy of meta.ts catches up a moment later.
  const [want, setWant] = useState<boolean | null>(null)
  useEffect(() => { if (want !== null && subject.picked === want) setWant(null) }, [subject.picked, want])
  const picked = want ?? subject.picked
  const v = subject.label
  const menu = useRef<HTMLDivElement>(null)

  const send = async (a: Action, words: Note = { body: [], tags: [] }) => {
    if (sending.current || field.adding) return
    sending.current = true
    const flip = a === 'pick' || a === 'unpick'
    setBusy(true); setError('')
    // A pick shows at once, and goes back with the reason when the server couldn't make it.
    if (flip) setWant(a === 'pick')
    try {
      await act.decide(subject, a, words)
      if (flip) { setAsk(null); field.clear(); onDone?.() }
      else { setAsk(null); field.clear(); setSaid(a as Ask) }
    } catch (e) {
      if (flip) setWant(null)
      setError(e instanceof Error ? e.message : t('Could not send'))
    } finally { sending.current = false; setBusy(false) }
  }
  // What was asked is said for a moment, then the menu goes away (the sheet goes back to its choices).
  useEffect(() => {
    if (!said) return
    const tId = window.setTimeout(() => { setSaid(null); onDone?.() }, 1800)
    return () => clearTimeout(tId)
  }, [said]) // eslint-disable-line react-hooks/exhaustive-deps
  // As a card, the note takes the focus (a pick is chosen already), so P then ⌘↩ picks; the arrows move between the rows.
  useLayoutEffect(() => { if (!sheet && !ask && !said) menu.current?.querySelector<HTMLElement>('[contenteditable=true], [role=menuitem]')?.focus({ preventScroll: true }) }, [sheet, ask, said])
  // Asked for a note, the cursor goes in its box.
  useLayoutEffect(() => { if (ask) field.focus() }, [ask]) // eslint-disable-line react-hooks/exhaustive-deps
  const arrows = (e: KeyboardEvent) => {
    if ((e.key === 'Enter' && (e.metaKey || e.ctrlKey)) && choice && !(e.target as HTMLElement).closest('[data-shoot=vm-comment]')) { e.preventDefault(); void send(choice, field.read()); return }
    if ((e.target as HTMLElement).isContentEditable) return
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const items = [...menu.current!.querySelectorAll<HTMLElement>('[role=menuitem]:not([disabled]), [role=menuitemradio]:not([disabled])')], i = items.indexOf(document.activeElement as HTMLElement)
    items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus()
  }
  // In the note, Esc goes back to the choices instead of closing everything, and ⌘↩ sends.
  const keys = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (!sending.current) { setAsk(null); field.clear(); setError('') } }
    else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && ask) { e.preventDefault(); void send(ask, field.read()) }
  }
  const status = <span className="inline-flex min-w-0 items-center gap-1.5 text-xs text-zinc-500"><Pulse on={listening} className="size-1.5" /><span className="truncate">{listening ? t('{agent} is listening', { agent }) : t('{agent} sees this on its next turn', { agent })}</span></span>
  const oops = error && <p role="alert" className="mt-2 rounded-lg bg-rose-500/10 px-2.5 py-1.5 text-xs text-rose-700 dark:text-rose-300">{error}</p>

  if (said) return (
    <div role="status" className={sheet ? 'px-1 py-1.5' : 'p-3'}>
      <p className="flex items-center gap-2 text-[13px] font-medium"><span className="grid size-5 shrink-0 place-items-center rounded-full bg-proto-primary-soft text-proto-primary-soft-fg"><Icon name="check" className="size-3" /></span>{NOTE[said].done(v)}</p>
      <p className="mt-1.5 ps-7 text-xs text-zinc-500">{listening ? t('Sent to {agent}.', { agent }) : t('It waits until {agent} listens, on its next turn.', { agent })}</p>
    </div>
  )

  if (ask) return (
    <div className={sheet ? 'px-1' : 'p-2'} onKeyDown={keys}>
      <div className="flex items-center gap-1 pb-1.5">
        <button onClick={() => { if (!sending.current) { setAsk(null); field.clear(); setError('') } }} aria-label={t('Back')} className="grid size-8 shrink-0 place-items-center rounded-lg text-zinc-500 hover:bg-zinc-900/5 hover:text-zinc-900 dark:hover:bg-white/10 dark:hover:text-white"><Icon name="left" /></button>
        <Icon name={ACTION[ask].icon} className="size-3.5 text-zinc-400" />
        <span className="text-[13px] font-semibold">{NOTE[ask].title(v)}</span>
      </div>
      <div {...field.props} data-placeholder={NOTE[ask].hint} aria-label={t('Note for {action}', { action: NOTE[ask].title(v) })}
        className={`block max-h-40 min-h-[76px] w-full overflow-y-auto whitespace-pre-wrap break-words rounded-xl bg-zinc-900/[.04] px-3 py-2 text-[13px] leading-5 outline-none ring-1 ring-inset ring-transparent focus:ring-proto-primary-ring dark:bg-white/[.06] [@media(pointer:coarse)]:text-base ${PLACEHOLDER}`} />
      {field.attachments}{field.menu}
      {oops}
      <div className="mt-2 flex items-center justify-end gap-1.5">
        <button onClick={() => { if (!sending.current) { setAsk(null); field.clear(); setError('') } }} className="h-8 shrink-0 rounded-lg px-2.5 text-xs font-medium text-zinc-500 hover:bg-zinc-900/5 dark:hover:bg-white/10">{t('Cancel')}</button>
        <button onClick={() => send(ask, field.read())} disabled={busy || field.adding} title={`${MOD} Enter`} className={`inline-flex h-8 shrink-0 items-center gap-1 rounded-lg ps-2 pe-3 text-xs font-semibold disabled:opacity-50 ${PRIMARY}`}><Icon name={ask === 'pick' ? 'check' : 'send'} className="size-3.5" />{busy ? t('Sending…') : ask === 'pick' ? t('Pick {v}', { v }) : t('Send')}</button>
      </div>
      <div className={sheet ? 'mt-1 px-1' : 'mx-1 mt-2 border-t border-black/[.06] pt-2 dark:border-white/10'}>{status}</div>
    </div>
  )

  const extras = <div className="mt-2 border-t border-black/[.06] pt-1.5 dark:border-white/10">
    {(['try-it', 'copy-options'] as const).map(a => {
      const ready = a === 'try-it' ? subject.hints : subject.copy
      const waiting = pending(a)
      // Ready, a row is the thing itself; before, it asks for it.
      const label = ready ? (a === 'try-it' ? t('Try it') : t('Copy options')) : a === 'try-it' ? t('Needs explanation') : t('Generate copy options')
      return <button key={a} role={sheet ? undefined : 'menuitem'} data-request-extra={a} disabled={busy || waiting || ready}
        onClick={() => { field.clear(); setError(''); setAsk(a) }}
        className="flex min-h-11 w-full items-center gap-2 rounded-lg px-2 text-start text-[13px] hover:bg-zinc-900/[.04] disabled:text-zinc-400 dark:hover:bg-white/[.06]">
        <Icon name={ready && a === 'try-it' ? 'key' : ACTION[a].icon} className="size-4" /><span className="flex-1">{label}</span>
        {(ready || waiting) && <span className="text-xs text-zinc-500">{ready ? t('Ready') : t('Requested')}</span>}
      </button>
    })}
    {(['try-it', 'copy-options'] as const).some(pending) && <p className="px-2 pb-1 text-xs text-zinc-500">{t('Requests wait in Comments. Delete one there to cancel it.')}</p>}
  </div>

  // The choices: a menu down the side of a wide page, three quiet buttons across a phone's sheet.
  const pickLabel = picked ? `Picked ${v}` : `Pick ${v}`
  const pickTitle = picked ? t('Picked. Choose it again to take the pick back') : t('Mark this design as the one, now')
  if (sheet) {
    // Labels stay whole (a word cut short reads as broken) and the buttons stay 44 px tall for a thumb.
    const btn = 'inline-flex h-11 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl text-[13px] font-medium ring-1 ring-inset disabled:opacity-50'
    const quiet = `${btn} bg-white text-zinc-700 ring-black/[.08] active:bg-zinc-50 dark:bg-zinc-800 dark:text-zinc-200 dark:ring-white/10 dark:active:bg-zinc-700`
    return (
      <div className="px-1">
        <p className="flex min-w-0 items-center gap-1.5 px-1 pb-2 text-xs text-zinc-500"><b className="font-semibold text-zinc-700 dark:text-zinc-200">{v}</b><span dir="auto" className="truncate">{subject.name}</span></p>
        <div className="flex gap-1.5">
          <button onClick={() => send(picked ? 'unpick' : 'pick')} disabled={busy || field.adding} aria-pressed={picked} aria-label={pickTitle} className={`shrink-0 px-3 ${picked ? `${btn} bg-emerald-500/10 text-emerald-700 ring-emerald-500/30 dark:text-emerald-300` : quiet}`}><Icon name={picked ? 'picked' : 'pick'} className="size-4" />{picked ? t('Picked') : t('Pick')}</button>
          <button onClick={() => setAsk('more')} className={`flex-1 px-2 ${quiet}`}><Icon name="more" className="size-4" />{t('More like this')}</button>
          <button onClick={() => setAsk('build')} className={`shrink-0 px-3 ${quiet}`}><Icon name="code" className="size-4" />{t('Build it')}</button>
        </div>
        {!picked && <button data-pick-note onClick={() => { field.clear(); setError(''); setAsk('pick') }} disabled={busy || field.adding}
          className="mt-1.5 flex min-h-11 w-full items-center gap-2 rounded-lg px-2 text-start text-[13px] text-zinc-700 hover:bg-zinc-900/[.04] disabled:opacity-50 dark:text-zinc-200 dark:hover:bg-white/[.06]"><Icon name="check" className="size-4" /><span className="flex-1">{t('Pick with a note…')}</span></button>}
        {extras}
        {oops}
        <p className="mt-2 flex items-center px-1">{status}</p>
      </div>
    )
  }
  const row = 'flex h-9 w-full items-center gap-2.5 rounded-lg px-2 text-start text-[13px] outline-none hover:bg-zinc-900/[.04] focus-visible:bg-zinc-900/[.06] disabled:opacity-50 dark:hover:bg-white/[.06] dark:focus-visible:bg-white/10'
  const tile = 'flex flex-col items-center gap-1.5 rounded-xl px-1 py-3 text-xs font-medium outline-none ring-1 ring-inset focus-visible:ring-2 disabled:opacity-50'
  const tileOff = 'text-zinc-600 ring-black/10 hover:bg-zinc-900/[.03] dark:text-zinc-300 dark:ring-white/10 dark:hover:bg-white/5'
  const tileOn = 'bg-proto-primary-soft text-proto-primary-soft-fg ring-proto-primary-ring'
  const choices = [
    { id: 'more' as const, icon: 'more', label: t('More like this') },
    { id: 'build' as const, icon: 'code', label: t('Build it') },
  ]
  const sendLabel = busy ? t('Sending…') : choice === 'pick' ? t('Pick {v}', { v }) : choice === 'more' ? t('Ask for more') : t('Build {v}', { v })
  return (
    <div ref={menu} role="menu" aria-label={`${v} · ${subject.name}`} onKeyDown={arrows} className="p-1.5">
      <div className="flex min-w-0 items-center gap-1.5 px-2 pb-1 pt-1 text-[11px] text-zinc-500"><b className="font-semibold text-zinc-700 dark:text-zinc-200">{v}</b><span dir="auto" className="truncate">{subject.name}</span></div>
      {lead && lead.length > 0 && <div className="mb-1 border-b border-black/[.06] pb-1 dark:border-white/10"><MenuRows rows={lead} onAsk={() => {}} onDone={() => onDone?.()} /></div>}
      {onComment && <button role="menuitem" data-shoot="vm-comment" onClick={() => { onComment(); onDone?.() }} className={`${row} text-zinc-700 dark:text-zinc-200`}>
        <Icon name="frame" className="size-4" /><span className="flex-1">{labelComment}</span><kbd className="shrink-0 font-sans text-xs text-zinc-400">⇧C</kbd>
      </button>}
      <div className="px-0.5 pt-1">
        <div className="grid grid-cols-3 gap-1.5">
          {picked
            ? <button role="menuitem" onClick={() => send('unpick')} disabled={busy || field.adding} aria-pressed title={pickTitle} className={`${tile} bg-emerald-500/10 text-emerald-700 ring-emerald-500/30 dark:text-emerald-300`}><Icon name="picked" className="size-5" />{t('Picked')}<span className="-mt-1 text-[10px] font-normal opacity-70">{t('Undo')}</span></button>
            : <button role="menuitemradio" data-pick-note aria-checked={choice === 'pick'} onClick={() => setChoice('pick')} disabled={busy || field.adding} title={pickTitle} className={`${tile} ${choice === 'pick' ? tileOn : tileOff}`}><Icon name="pick" className="size-5" />{t('Pick')}</button>}
          {choices.map(c => <button key={c.id} role="menuitemradio" aria-checked={choice === c.id} onClick={() => setChoice(c.id)} disabled={busy || field.adding} className={`${tile} ${choice === c.id ? tileOn : tileOff}`}><Icon name={c.icon} className="size-5" />{c.label}</button>)}
        </div>
        <div className="mt-2 rounded-lg ring-1 ring-inset ring-black/10 focus-within:ring-2 focus-within:ring-proto-primary-ring dark:ring-white/15">
          <div {...field.props} contentEditable={!!choice && !busy} aria-disabled={!choice || busy || undefined}
            aria-label={choice ? t('Note for {action}', { action: NOTE[choice].title(v) }) : t('Note')} data-placeholder={choice ? NOTE[choice].hint : t('Choose what to do first')}
            className={`block max-h-32 min-h-[56px] w-full overflow-y-auto whitespace-pre-wrap break-words rounded-t-lg bg-transparent px-2.5 pb-1 pt-2.5 text-[13px] leading-5 outline-none aria-disabled:opacity-50 [@media(pointer:coarse)]:text-base ${PLACEHOLDER}`} />
          {field.attachments}{field.menu}
          <div className="flex items-center justify-between gap-2 py-1.5 pe-1.5 ps-2.5">
            <span className="flex items-center gap-1 text-[11px] text-zinc-500">{[MOD, 'Enter'].map(k => <kbd key={k} className="rounded border border-black/15 bg-zinc-900/[.04] px-1.5 py-px font-sans text-[10px] font-medium leading-4 text-zinc-600 dark:border-white/15 dark:bg-white/[.07] dark:text-zinc-300">{k}</kbd>)}{t('sends')}</span>
            <button data-send onClick={() => choice && send(choice, field.read())} disabled={!choice || busy || field.adding} className={`inline-flex h-8 shrink-0 items-center rounded-md px-3 text-xs font-semibold disabled:opacity-40 ${PRIMARY}`}>{sendLabel}</button>
          </div>
        </div>
      </div>
      {rows && rows.length > 0 && <div className="mt-1 border-t border-black/[.06] pt-1 dark:border-white/10">{<MenuRows rows={rows} onAsk={() => {}} onDone={() => onDone?.()} />}</div>}
      {extras}
      {oops}
      <div className="mx-2 mt-1.5 border-t border-black/[.06] pb-1 pt-2 dark:border-white/10">{status}</div>
    </div>
  )
}

/** Where the menu opens on a wide page: under the bar's check button, its right edge on the button's. */
export type DecidePopProps = { open: boolean; anchor: () => HTMLElement | null; subject: Subject | null; onClose: () => void; at?: { x: number; y: number }; onComment?: () => void; rows?: MenuRow[]; lead?: MenuRow[]; commentLabel?: string
  /** Opened by right-click: says how to reach the browser's own menu. */
  hint?: boolean }
export function DecidePop({ open, anchor, subject, onClose, at: pointer, onComment, rows, lead, commentLabel, hint }: DecidePopProps) {
  const [, redraw] = useState(0)
  useEffect(() => {
    if (!open) return
    const f = () => redraw(n => n + 1)
    addEventListener('resize', f)
    return () => removeEventListener('resize', f)
  }, [open])
  const at = open && !pointer ? anchor()?.getBoundingClientRect() : null
  if (!open || !subject || (!at && !pointer)) return null
  // A row's menu opens where it was asked for (its ⋯, or the pointer), kept inside the window; the bar's under its button.
  const place = pointer
    ? { top: Math.max(8, Math.min(pointer.y, innerHeight - 420)), left: Math.max(8, Math.min(pointer.x, innerWidth - 328)) }
    : rtl ? { top: at!.bottom + 6, left: Math.max(8, at!.left) } : { top: at!.bottom + 6, right: Math.max(8, innerWidth - at!.right) }
  // The shell closes it on Esc and on a click outside. A click inside goes no further: a choice
  // redraws the menu under it, and the shell would take a click on a removed button for one outside.
  return (
    <div data-pop data-context-menu={pointer ? '' : undefined} onClick={e => e.stopPropagation()} onContextMenu={e => { if (pointer && !e.shiftKey) e.preventDefault() }} className="fixed z-40 w-80 overflow-hidden rounded-2xl transition-opacity has-[[data-tag-picking]]:pointer-events-none has-[[data-tag-picking]]:opacity-40 border border-black/10 bg-white text-[13px] text-zinc-900 shadow-xl shadow-black/10 dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-100" style={place}>
      <Decide key={`${subject.proto}/${subject.variant}`} subject={subject} onDone={onClose} onComment={onComment} rows={rows} lead={lead} commentLabel={commentLabel} />
      {hint && <p className="border-t border-black/[.06] px-3.5 py-2 text-xs text-zinc-400 dark:border-white/10">{BROWSER_HINT}</p>}
    </div>
  )
}
