// The comments as a list, the rail's body and the phone sheet's, grouped by what needs you:
// Ready to send (drafts, and the unfinished one), With Claude (sent, not done), and Done, which
// folds to one line each and opens to show what Claude said. The bottom bar is Add and Send.
// A comment and the follow-ups answering Claude about it are one row, a thread, in the section of
// its last turn: an answer to a done comment brings it back to With Claude.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { t, tn } from '../i18n'
import { useAgentName, useCtx } from './ctx'
import { isRoot, progress, threadOf, useStore, type Said } from './store'
import type { CState, Item } from './types'
import { inScope, shotsOf } from './types'
import { variantRef } from '../variants'
import { aboutOf, ACTION, Body, Icon, Listening, MOD, PinDot, PRIMARY, Reply, since, spanOf, SrcTag, ViewChip, Working, ImageChip, PictureStrip } from './ui'

export function useRows() {
  const { store, act } = useCtx()
  const s = useStore(store)
  // Nobody is listening and the agent that was is gone: what is sent is waiting for a session that ended.
  const gone = !s.inbox?.listening && s.inbox?.agent === 'gone'
  // The prototype the page is on: its comments only, across its variants (the lobbies, which have no list, see all).
  const items = s.items.filter(i => inScope(s.scope, i.proto))
  // One row per thread: the comment's own reply (what a pin's card and the motion dock show), the
  // state of its last turn, and its turns in order. A thread moves up when it is answered again.
  const rows = items.filter(i => isRoot(s.items, i)).map(item => {
    const turns = threadOf(s.items, item).map(t => ({ item: t, ...progress(t, s.inbox) })), last = turns[turns.length - 1]
    return { item, reply: turns[0].reply, state: last.state, ...(last.lost ? { lost: true } : {}), turns, stopped: !!last.lost || (gone && last.state === 'sent'), here: act.here(item), latest: last.item.at }
  })
  rows.sort((a, b) => b.latest - a.latest)
  const held = s.held && inScope(s.scope, s.held.proto) ? s.held : null
  return { s, rows, held, drafts: items.filter(i => !i.sent).length, stalled: rows.filter(r => r.stopped && (r.state === 'sent' || r.state === 'seen')).length }
}
type Row = ReturnType<typeof useRows>['rows'][number]

const Head = ({ title, n, tone = 'text-zinc-500', children }: { title: string; n: number; tone?: string; children?: ReactNode }) => (
  <h3 className={`flex items-center gap-2 px-1 pb-1.5 pt-4 text-xs font-semibold first:pt-1 ${tone}`}>{title}<span className="rounded-full bg-zinc-900/[.06] px-1.5 text-[11px] font-medium tabular-nums dark:bg-white/10">{n}</span>{children}</h3>
)
/**
 * Clears a whole section from the list. It asks once (the button turns into "Clear n?"), since
 * comments still with Claude are taken back from it, and it stops asking after a few seconds.
 */
function ClearAll({ ids, what }: { ids: string[]; what: string }) {
  const agent = useAgentName()
  const { act } = useCtx()
  const [sure, setSure] = useState(false)
  useEffect(() => { if (!sure) return; const tId = window.setTimeout(() => setSure(false), 4000); return () => clearTimeout(tId) }, [sure])
  return (
    <button data-shoot={`clear-${what}`} onClick={() => { if (!sure) return setSure(true); setSure(false); act.removeAll(ids) }}
      title={what === 'sent' ? t('Delete all of these, and take them back from {agent}', { agent }) : t('Delete all of these from the list')}
      className={`ms-auto inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[11px] font-medium ${sure ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400' : 'text-zinc-400 hover:bg-zinc-900/5 hover:text-zinc-700 dark:hover:bg-white/10 dark:hover:text-zinc-200'}`}>
      <Icon name="trash" className="size-3" />{sure ? t('Clear {n}?', { n: ids.length }) : t('Clear')}
    </button>
  )
}
/** Deletes one comment, whatever became of it; a sent one is taken back from Claude. */
const Remove = ({ item, className = '' }: { item: Item; className?: string }) => {
  const agent = useAgentName()
  const { act } = useCtx()
  const sent = !!item.sent
  return <button data-shoot="remove" onClick={e => { e.stopPropagation(); act.remove(item.id) }} aria-label={t('Delete this comment')} title={sent ? t('Delete this comment ({agent} is told to leave it)', { agent }) : t('Delete this comment')} className={`grid size-8 shrink-0 place-items-center rounded-full text-zinc-400 hover:text-rose-600 active:bg-zinc-900/5 dark:active:bg-white/10 ${className}`}><Icon name="trash" className="size-4" /></button>
}
const Where = ({ item, here }: { item: Item; here: boolean }) => { const { store } = useCtx(); return here && !store.get().place?.compare ? null : <span className="shrink-0 rounded bg-zinc-900/[.05] px-1 font-mono text-[10px] text-zinc-500 dark:bg-white/10">{variantRef(null, item.variant)}</span> }
/** What a row is about: the element a comment is on, or a decision with its icon (it is on no element). */
const About = ({ item }: { item: Item }) => item.action
  ? <span className="inline-flex min-w-0 items-center gap-1.5"><Icon name={ACTION[item.action].icon} className="size-3.5" /><span className="truncate">{aboutOf(item)}</span></span>
  : <span dir="auto">{aboutOf(item)}</span>
// What a comment carries besides its words: its screenshot, how many it tags, where in the code it is.
const Extras = ({ item }: { item: Item }) => (item.tags.length > 0 || shotsOf(item).length || item.target?.src) ? (
  <span className="mt-2 block min-w-0 text-[11px] text-zinc-400">
    {!!shotsOf(item).length && <PictureStrip>{shotsOf(item).map((p, k) => p.pasted ? <ImageChip key={k} src={p.src} size="sm" /> : <img key={k} src={p.src} alt="" className="h-9 w-14 rounded-md object-cover ring-1 ring-black/10" />)}</PictureStrip>}
    <span className="flex min-w-0 flex-wrap items-center gap-2">
      {item.tags.length > 0 && <span className="inline-flex h-6 shrink-0 items-center gap-1 rounded-md bg-proto-primary-soft px-1.5 text-proto-primary-soft-fg"><Icon name="at" className="size-3" />{t('{n} tagged', { n: item.tags.length })}</span>}
      <SrcTag t={item.target} className="min-w-0" />
    </span>
  </span>
) : null

/** A draft: a card you can open to edit, with a trash button. */
function Draft({ r, active, roomy, onOpen }: { r: Row; active: boolean; roomy: boolean; onOpen: () => void }) {
  const { act } = useCtx()
  const { item } = r
  return (
    <div data-comment={item.id} data-shoot="comment-row" className={`rounded-2xl border p-3 transition ${active ? 'border-proto-primary-ring bg-proto-primary-soft' : 'border-black/[.08] bg-white hover:border-black/20 dark:border-white/10 dark:bg-zinc-900 dark:hover:border-white/25'}`}>
      <div className="flex items-center gap-2">
        <PinDot n={item.n} whole={item.target?.whole} />
        <button onClick={onOpen} className="min-w-0 flex-1 truncate text-start text-xs font-medium text-zinc-500 dark:text-zinc-400"><span dir="auto">{aboutOf(item)}</span></button>
        <Where item={item} here={r.here} />
        <button onClick={() => act.remove(item.id)} aria-label={t('Remove this comment')} className="-me-1 grid size-8 shrink-0 place-items-center rounded-full text-zinc-400 hover:text-rose-600 active:bg-zinc-900/5 dark:active:bg-white/10"><Icon name="trash" className="size-4" /></button>
      </div>
      <button onClick={onOpen} className="mt-1 block w-full text-start"><Body c={item} className={`block ${roomy ? 'text-sm leading-5' : 'text-[12.5px] leading-[18px]'}`} /><ViewChip v={item.target?.view} className="mt-1.5" /><Extras item={item} /></button>
    </div>
  )
}

/**
 * The rest of a thread, under the comment and Claude's reply to it: each answer the user wrote back
 * (on the end side, as theirs) and Claude's reply to that, then Reply, which answers the last reply.
 */
function Thread({ r }: { r: Row }) {
  return (
    <>
      {r.turns.slice(1).map(t => (
        <span key={t.item.id} data-shoot="comment-turn" data-turn={t.item.sent ? `${t.item.sent.batch}/${t.item.sent.i}` : undefined} className="mt-2 block space-y-1.5">
          <span className="flex justify-end"><Body c={t.item} className="block max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-se-sm bg-proto-primary-soft px-2 py-1 text-[11px] leading-4 text-zinc-800 ring-1 ring-proto-primary-ring/40 dark:text-zinc-100" /></span>
          {t.reply && <span data-shoot="comment-reply" className="block"><Reply text={t.reply.text} by={t.reply.by} small /></span>}
        </span>
      ))}
      <Answer r={r} />
    </>
  )
}

/**
 * Reply to Claude: a small action under its last reply, opening a compact box in the row. What is
 * written goes at once as a follow-up (act.followUp), on what the comment is on; a send that fails
 * keeps the words and says why. Offered once the last turn has a reply or is done: before that
 * there is nothing to answer, and a second comment is the way to add to one still being worked on.
 */
function Answer({ r }: { r: Row }) {
  const agent = useAgentName()
  const { act, store } = useCtx()
  const empty = { open: false, text: '', busy: false, error: '' }
  const { open, text, busy, error } = useStore(store).replies[r.item.id] ?? empty
  const update = (patch: Partial<typeof empty>) => store.set(s => s.items.some(i => i.id === r.item.id)
    ? { replies: { ...s.replies, [r.item.id]: { ...(s.replies[r.item.id] ?? empty), ...patch } } }
    : {})
  const cancel = () => update({ open: false, text: '', error: '' })
  const last = r.turns[r.turns.length - 1]
  if (!last.item.sent || (!last.reply && last.state !== 'done')) return null
  if (!open) return <button data-shoot="comment-answer" onClick={() => update({ open: true })} title={t('Answer {agent}\'s reply', { agent })} className="mt-1.5 inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[11px] font-medium text-zinc-500 hover:bg-zinc-900/5 hover:text-zinc-800 dark:hover:bg-white/10 dark:hover:text-zinc-200"><Icon name="comment" className="size-3" />{t('Reply')}</button>
  const send = async () => {
    if (!text.trim() || store.get().replies[r.item.id]?.busy) return
    update({ busy: true, error: '' })
    try { await act.followUp(r.item.id, text); update(empty) }
    catch (e) { update({ error: e instanceof Error ? e.message : t('Could not send') }) }
    finally { update({ busy: false }) }
  }
  return (
    <span data-shoot="comment-answer-box" className="mt-2 block rounded-xl border border-black/10 bg-white p-1.5 dark:border-white/15 dark:bg-zinc-900">
      <textarea autoFocus rows={2} value={text} aria-label={t('Answer {agent}', { agent })} placeholder={t('Answer {agent}…', { agent })} dir="auto"
        onChange={e => update({ text: e.target.value })}
        onKeyDown={e => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send() }
          else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancel() }
        }}
        className="block max-h-32 w-full resize-none bg-transparent px-1.5 py-1 text-[12.5px] leading-[18px] text-zinc-900 outline-none placeholder:text-zinc-400 dark:text-zinc-100" />
      {error && <span role="alert" className="block px-1.5 pb-1 text-[11px] text-rose-600 dark:text-rose-400">{error}</span>}
      <span className="flex items-center justify-end gap-1">
        <button onClick={cancel} className="h-7 rounded-lg px-2 text-[11px] font-medium text-zinc-500 hover:bg-zinc-900/5 dark:hover:bg-white/10">{t('Cancel')}</button>
        <button data-shoot="comment-answer-send" onClick={() => void send()} disabled={!text.trim() || busy} title={`${t('Send to {agent}', { agent })} · ${MOD} Enter`} className={`inline-flex h-7 items-center gap-1 rounded-lg ps-2 pe-2.5 text-[11px] font-semibold disabled:opacity-40 ${PRIMARY}`}><Icon name="send" className="size-3" />{busy ? t('Sending…') : t('Send')}</button>
      </span>
    </span>
  )
}

/** Sent, and not done: what Claude has, and what it said so far ("building now…"), and the thread under it. */
function WithAgent({ r, active, roomy, onOpen }: { r: Row; active: boolean; roomy: boolean; onOpen: () => void }) {
  const agent = useAgentName()
  const { item, reply } = r
  // Whether Claude said anything in the thread's last turn: a stopped one says so differently.
  const said = !!r.turns[r.turns.length - 1].reply
  return (
    <div data-comment={item.id} data-shoot="comment-row" className={`rounded-2xl transition ${active ? 'bg-proto-primary-soft ring-1 ring-proto-primary-ring' : 'bg-proto-primary-soft/60 hover:bg-proto-primary-soft'}`}>
      <div className="flex w-full items-start gap-1">
      <button onClick={onOpen} className="flex min-w-0 flex-1 items-start gap-3 p-3 pe-0 text-start">
        <span className="mt-1">{r.stopped ? <span data-shoot="comment-stopped" className="mt-0.5 block size-2 rounded-full border border-amber-500" /> : <Working />}</span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 text-xs"><span className="min-w-0 flex-1 truncate font-medium text-zinc-500 dark:text-zinc-400"><About item={item} /></span><Where item={item} here={r.here} />{r.stopped ? <span className="shrink-0 text-amber-600 dark:text-amber-300">{said ? t('Stopped') : t('Not picked up')}</span> : <span className="shrink-0 text-proto-primary-soft-fg">{r.state === 'seen' ? t('{agent} is on it', { agent }) : t('Sent')}</span>}</span>
          <Body c={item} className={`mt-0.5 block ${roomy ? 'text-sm leading-5' : 'text-[12.5px] leading-[18px]'}`} />
          <ViewChip v={item.target?.view} className="mt-1.5" />
          {shotsOf(item).some(p => p.pasted) && <PictureStrip className="mt-2">{shotsOf(item).filter(p => p.pasted).map((p, k) => <ImageChip key={k} src={p.src} size="sm" />)}</PictureStrip>}
          {reply && <span data-shoot="comment-reply" className="mt-2 block"><Reply text={reply.text} by={reply.by} small /></span>}
        </span>
      </button>
      <Remove item={item} className="me-1 mt-1.5" />
      </div>
      <div className="-mt-1 pb-3 pe-3 ps-8 empty:hidden"><Thread r={r} /></div>
    </div>
  )
}

/** Done: one line, opening to Claude's reply and the thread after it, and a way to see it on the design. */
function DoneRow({ r, active, roomy, onShow }: { r: Row; active: boolean; roomy: boolean; onShow: () => void }) {
  const [open, setOpen] = useState(false)
  const { item, reply } = r
  const when = since(reply?.at)
  return (
    <div data-comment={item.id} data-shoot="comment-row">
      {/* Under the pointer the line lights up and its words come forward, so it reads as one to open. */}
      <div className={`group flex items-center rounded-xl transition-colors duration-150 ${active ? 'bg-emerald-500/10' : 'hover:bg-zinc-900/[.04] dark:hover:bg-white/[.05]'}`}>
        <button onClick={() => setOpen(!open)} aria-expanded={open} className={`flex min-w-0 flex-1 items-center gap-2.5 rounded-xl px-1 text-start active:bg-zinc-900/[.04] dark:active:bg-white/5 ${roomy ? 'h-11' : 'h-9'}`}>
          <PinDot n={item.n} done whole={item.target?.whole} />
          <span className={`min-w-0 flex-1 truncate text-zinc-500 transition-colors duration-150 group-hover:text-zinc-800 dark:group-hover:text-zinc-200 ${roomy ? 'text-[13.5px]' : 'text-[12.5px]'}`}>{item.action ? <span dir="auto">{aboutOf(item)}{item.body.length ? `: ${item.body.join('')}` : ''}</span> : <Body c={item} />}</span>
          <Where item={item} here={r.here} />
          <Icon name="right" className={`size-4 text-zinc-400 transition-[transform,color] group-hover:text-zinc-600 dark:group-hover:text-zinc-300 ${open ? 'rotate-90' : ''}`} />
        </button>
        <Remove item={item} />
      </div>
      {open && (
        <div className="space-y-2 pb-2 pe-1 ps-8">
          <p className="flex items-center gap-2 text-xs text-zinc-400"><span className="min-w-0 truncate"><About item={item} /></span>{when && <span className="shrink-0">· {when}</span>}<button onClick={onShow} className="ms-auto shrink-0 font-medium text-proto-primary-soft-fg hover:underline">{item.time ? t('Show {span}', { span: spanOf(item.time) }) : item.target ? t('Show on design') : t('Go to {target}', { target: item.variant || t('the prototype') })}</button></p>
          <ViewChip v={item.target?.view} />
          {reply ? <Reply text={reply.text} by={reply.by} small /> : <p className="text-xs text-zinc-400">{t('Marked done, no note.')}</p>}
          <Thread r={r} />
        </div>
      )}
    </div>
  )
}

export function CommentList({ roomy, onOpen }: { roomy?: boolean; onOpen?: (id: string) => void }) {
  const agent = useAgentName()
  const { act } = useCtx()
  const { s, rows, held: kept } = useRows()
  const held = kept && s.mode.kind !== 'compose' && s.mode.kind !== 'tag' && s.mode.kind !== 'time' ? kept : null
  const on = (id: string) => s.active === id || (s.mode.kind === 'compose' && s.mode.id === id)
  const open = (id: string) => { onOpen?.(id); act.open(id) }
  const by = (st: CState[]) => rows.filter(r => st.includes(r.state))
  const drafts = by(['draft']), wait = by(['sent', 'seen']), done = by(['done'])
  if (!rows.length && !held) return <p className="px-3 py-6 text-center text-xs text-zinc-400">{matchMedia('(pointer: coarse), (max-width: 639px)').matches ? t('Nothing yet. Tap the hand, then anything in the design.') : t('Nothing yet. Press C, then click anything in the design.')}</p>
  return (
    <div>
      {(drafts.length > 0 || held) && (
        <section aria-label={t('Ready to send')}>
          <Head title={t('Ready to send')} n={drafts.length + (held ? 1 : 0)} />
          <div className="space-y-2">
            {held && (
              <div className="rounded-2xl border border-dashed border-proto-primary-ring/60 bg-proto-primary-soft/50 p-3">
                <div className="flex items-center gap-2 text-xs"><span className="size-1.5 rounded-full bg-proto-primary" /><span className="font-medium text-proto-primary-soft-fg">{t('Unfinished comment')}</span><span dir="auto" className="min-w-0 flex-1 truncate text-end text-zinc-500">{held.time ? spanOf(held.time) : held.target?.label}</span></div>
                <Body c={held} className={`mt-1 line-clamp-2 block ${roomy ? 'text-sm leading-5' : 'text-[12.5px] leading-[18px]'}`} />
                <div className="mt-2 flex gap-1.5"><button onClick={() => { onOpen?.(''); act.resume() }} className="h-8 rounded-full bg-proto-primary px-3 text-xs font-semibold text-proto-primary-fg hover:bg-proto-primary-hover">{t('Continue')}</button><button onClick={act.discardHeld} className="h-8 rounded-full px-3 text-xs font-medium text-zinc-500 hover:bg-zinc-900/5 dark:hover:bg-white/10">{t('Discard')}</button></div>
              </div>
            )}
            {drafts.map(r => <Draft key={r.item.id} r={r} roomy={!!roomy} active={on(r.item.id)} onOpen={() => open(r.item.id)} />)}
          </div>
        </section>
      )}
      {wait.length > 0 && (
        <section aria-label={t('With {agent}', { agent })}>
          <Head title={t('With {agent}', { agent })} n={wait.length} tone="text-proto-primary-soft-fg"><ClearAll what="sent" ids={wait.map(r => r.item.id)} /></Head>
          <div className="space-y-2">{wait.map(r => <WithAgent key={r.item.id} r={r} roomy={!!roomy} active={on(r.item.id)} onOpen={() => open(r.item.id)} />)}</div>
        </section>
      )}
      {done.length > 0 && (
        <section aria-label={t('Done')}>
          <Head title={t('Done')} n={done.length} tone="text-emerald-700 dark:text-emerald-400"><ClearAll what="done" ids={done.map(r => r.item.id)} /></Head>
          <div className="divide-y divide-black/[.05] dark:divide-white/[.07]">{done.map(r => <DoneRow key={r.item.id} r={r} roomy={!!roomy} active={on(r.item.id)} onShow={() => open(r.item.id)} />)}</div>
        </section>
      )}
    </div>
  )
}

/** Send, as the round button that ends the list. */
export function SendButton({ className = '' }: { className?: string }) {
  const agent = useAgentName()
  const { act } = useCtx()
  const { s, drafts } = useRows()
  return (
    <button data-shoot="send" onClick={act.send} title={`${MOD} Enter`} disabled={!drafts || s.sending} className={`inline-flex h-12 items-center justify-center gap-2 rounded-full px-4 text-sm font-semibold disabled:cursor-not-allowed disabled:bg-zinc-900/[.06] disabled:text-zinc-400 dark:disabled:bg-white/[.08] dark:disabled:text-zinc-500 ${drafts && !s.sending ? 'bg-proto-primary text-proto-primary-fg hover:bg-proto-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-proto-primary-ring' : ''} ${className}`}>
      <Icon name="send" className="size-4" />{s.sending ? t('Sending…') : drafts ? tn(drafts, 'Send {n} to {agent}', 'Send {n} to {agent}', { agent }) : t('Nothing to send')}
    </button>
  )
}

/** What to paste in the agent's thread when its session has ended: the page can't wake it, one message does. */
const restartMessage = (n: number) => `Listen for my prototype comments again: run proto inbox. ${n} comment${n === 1 ? ' is' : 's are'} waiting, and some were taken before the last session stopped and never answered. Handle them first.`
function copyText(text: string) {
  try { void navigator.clipboard.writeText(text); return } catch { /* not a secure page: the old way */ }
  const el = document.createElement('textarea')
  el.value = text; el.style.position = 'fixed'; el.style.opacity = '0'
  document.body.appendChild(el); el.select()
  try { document.execCommand('copy') } finally { el.remove() }
}

/** The send error, and a word when the agent is not listening, with the message that restarts it. */
export function Notices({ restart = true }: { restart?: boolean }) {
  const agent = useAgentName()
  const { act } = useCtx()
  const { s, drafts, stalled } = useRows()
  const [copied, setCopied] = useState(false)
  const timer = useRef(0)
  useEffect(() => { if (!stalled) setCopied(false) }, [stalled])
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const copy = () => { copyText(restartMessage(stalled)); setCopied(true); window.clearTimeout(timer.current); timer.current = window.setTimeout(() => setCopied(false), 6000) }
  return <>
    {s.error && <p role="alert" className="flex items-start gap-2 rounded-xl bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-300"><span className="min-w-0 flex-1">{s.error}</span><button onClick={act.clearError} aria-label={t('Dismiss')} className="shrink-0 opacity-70 hover:opacity-100"><Icon name="x" className="size-3.5" /></button></p>}
    {stalled > 0 && (
      <p data-shoot="stalled" className="flex items-start gap-2 px-1 text-xs leading-4 text-amber-700 dark:text-amber-300">
        <Icon name="warn" className="mt-0.5 size-3.5" />
        <span>{copied ? t('Paste it in your agent conversation. {agent} picks them up when it listens.', { agent }) : tn(stalled, '{agent} is not listening. {n} comment waits. Copy the message, paste it in your agent conversation.', '{agent} is not listening. {n} comments wait. Copy the message, paste it in your agent conversation.', { agent })}</span>
      </p>
    )}
    {/* With nothing of its own to send, the send row gives way to the one action that helps. */}
    {restart && stalled > 0 && !drafts && <button data-shoot="restart" onClick={copy} className="inline-flex h-10 w-full min-w-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full bg-amber-400 px-3 text-[12.5px] font-semibold text-amber-950 hover:bg-amber-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500"><Icon name={copied ? 'check' : 'more'} className="size-4" />{copied ? t('Copied') : t('Copy restart message')}</button>}
  </>
}

/** Add (a round button, picking on the design) and Send, with the send error and who is listening.
 *  The words on the whole variant are written in the island, which a phone has over its pill. */
export function SendBar({ className = '', onAdd }: { className?: string; onAdd?: () => void }) {
  const { store, act } = useCtx()
  const { drafts, stalled } = useRows()
  return (
    <div className={`space-y-2 ${className}`}>
      <Notices />
      {!(stalled > 0 && !drafts) && (
        <div className="flex gap-2">
          <button data-shoot="add" onClick={onAdd ?? act.toggle} aria-label={t('Add a comment')} title={`${t('Comment on the design')} · C`} className="grid size-12 shrink-0 place-items-center rounded-full ring-1 ring-inset ring-black/10 hover:bg-zinc-900/5 dark:ring-white/15 dark:hover:bg-white/10"><Icon name="plus" className="size-5" /></button>
          <SendButton className="flex-1" />
        </div>
      )}
      <Listening on={!!store.get().inbox?.listening} stalled={stalled > 0} className="justify-center" />
    </div>
  )
}
export type { Said }
