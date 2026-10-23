// The comments island: one small bar floating over the stage, collapsed most of the time. Select
// (pick an element to comment on), a box for a comment on the whole variant, and the count, which
// opens the list above the same bar. When the agent starts on a comment, finishes it or replies,
// the island grows for a moment to say so, like a system notification, and its edge takes the
// colour of the news. A wide screen can drag it anywhere on the stage; a phone has it as the top
// row of the pill, and its count opens the list as a sheet (rail.tsx).
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from 'react'
import { t, tn } from '../i18n'
import { useAgentName, useCtx } from './ctx'
import { listen } from '../quiet'
import { islandPrefs, useIslandPrefs, type IslandPrefs } from './island-prefs'
import { CommentList, Notices, useRows } from './list'
import { Icon, Listening, MOD, plain } from './ui'
import type { CState } from './types'

type Kind = 'working' | 'done' | 'reply'
type News = { key: number; kind: Kind; title: string; text: string }
const EDGE: Record<Kind, string> = { working: '#f59e0b', done: '#10b981', reply: '#0ea5e9' }
const SHOWN_MS = 4500
const RANK: Record<Kind, number> = { working: 1, done: 2, reply: 3 }

const phoneMq = () => matchMedia('(max-width: 639px)')
const usePhone = () => useSyncExternalStore(l => { const mq = phoneMq(); mq.addEventListener('change', l); return () => mq.removeEventListener('change', l) }, () => phoneMq().matches)

/**
 * What changed since the last look at the list: a comment the agent took (sent → seen), finished
 * (→ done) or answered (a new reply). The most telling one is shown for a few seconds; a reply
 * also counts as unread until the list is opened.
 */
function useNews(rows: ReturnType<typeof useRows>['rows'], agent: string, which: IslandPrefs['news']) {
  const last = useRef<Map<string, { state: CState; reply: string }> | null>(null)
  const [news, setNews] = useState<News | null>(null)
  const [unread, setUnread] = useState(0)
  const n = useRef(0)
  const now = rows.map(r => [r.item.id, r.state, [...r.turns].reverse().find(x => x.reply)?.reply?.text ?? ''] as const)
  const sig = JSON.stringify(now)
  useEffect(() => {
    const before = last.current
    last.current = new Map(now.map(([id, state, reply]) => [id, { state, reply }]))
    // The first look, and a page that just opened, have nothing new: only what changes after.
    if (!before) return
    let next: News | null = null
    for (const [id, state, reply] of now) {
      const b = before.get(id), row = rows.find(r => r.item.id === id)
      if (!b || !row) continue
      const words = plain(row.item)
      const kind: Kind | null = reply && reply !== b.reply ? 'reply' : state === 'done' && b.state !== 'done' ? 'done' : state === 'seen' && b.state === 'sent' ? 'working' : null
      if (!kind || (next && RANK[next.kind] >= RANK[kind])) continue
      next = kind === 'reply' ? { key: 0, kind, title: t('{agent} replied', { agent }), text: reply }
        : kind === 'done' ? { key: 0, kind, title: t('Done'), text: words }
        : { key: 0, kind, title: t('{agent} is on it', { agent }), text: words }
    }
    if (!next) return
    if (next.kind === 'reply') setUnread(u => u + 1)
    if (which === 'off' || (which === 'replies' && next.kind !== 'reply')) return
    setNews({ ...next, key: ++n.current })
  }, [sig])
  useEffect(() => {
    if (!news) return
    const id = window.setTimeout(() => setNews(null), SHOWN_MS)
    return () => clearTimeout(id)
  }, [news])
  return { news, unread, read: () => { setUnread(0); setNews(null) } }
}

/** The news row keeps the last news a moment after it goes, so it fades out instead of vanishing. */
function useShown(news: News | null) {
  const [shown, setShown] = useState(news)
  const [leaving, setLeaving] = useState(false)
  useEffect(() => {
    if (news) { setShown(news); setLeaving(false); return }
    if (!shown) return
    setLeaving(true)
    const id = window.setTimeout(() => { setShown(null); setLeaving(false) }, 320)
    return () => clearTimeout(id)
  }, [news?.key])
  return { shown, leaving }
}

const NEWS_ICON: Record<Kind, string> = { working: 'spinner', done: 'check', reply: 'comment' }

export function Island() {
  const { act, copyStore } = useCtx()
  const copying = useSyncExternalStore(copyStore.subscribe, () => copyStore.get().on)
  const agent = useAgentName()
  const { s, rows, drafts, stalled } = useRows()
  const prefs = useIslandPrefs()
  const phone = usePhone()
  const { news, unread, read } = useNews(rows, agent, prefs.news)
  const { shown, leaving } = useShown(news)
  const [text, setText] = useState('')
  const [focus, setFocus] = useState(false)
  const input = useRef<HTMLTextAreaElement>(null)
  const card = useRef<HTMLDivElement>(null)
  const open = s.island && !phone
  const picking = s.mode.kind === 'pick'

  useLayoutEffect(() => {
    const el = input.current
    if (!el) return
    // Empty, it stays one line: a placeholder that wraps would otherwise count as its height.
    el.style.height = 'auto'
    if (text) el.style.height = `${el.scrollHeight}px`
  }, [text, phone])
  // ⇧C, or a sidebar row's Comment on this: the cursor goes in the box. A tick later, so the key
  // that asked (⇧C) has finished and its letter cannot land in the box.
  useEffect(() => {
    if (!s.focusAsk) return
    act.askDone()
    window.setTimeout(() => input.current?.focus({ preventScroll: true }), 0)
  }, [s.focusAsk, act])
  useEffect(() => () => act.wholeFocus(false), [act])
  // Opened, the list has been seen.
  useEffect(() => { if (s.island || s.sheet) read() }, [s.island, s.sheet])

  // Dragged anywhere on the stage (a wide screen): kept per browser, and kept on the stage when the
  // window or the stage narrows. A double-click on its edge brings it home.
  const [at, setAt] = useState(prefs.at)
  useEffect(() => setAt(prefs.at), [prefs.at.x, prefs.at.y])
  const [dragging, setDragging] = useState(false)
  // Its place is an offset from home; `now` is the offset it is drawn at, to find home from its box.
  const clamp = (p: { x: number; y: number }, now = at) => {
    const el = card.current, box = el?.closest('[data-island-host]')?.getBoundingClientRect()
    if (!el || !box) return p
    const r = el.getBoundingClientRect(), x0 = r.left - now.x, y0 = r.top - now.y
    return { x: Math.round(Math.min(Math.max(p.x, box.left + 8 - x0), box.right - 8 - r.width - x0)), y: Math.round(Math.min(Math.max(p.y, box.top + 8 - y0), box.bottom - 8 - r.height - y0)) }
  }
  const fit = () => setAt(a => { const c = clamp(a, a); return c.x === a.x && c.y === a.y ? a : c })
  useEffect(() => {
    if (phone) return
    const ro = new ResizeObserver(fit)
    const host = card.current?.closest('[data-island-host]')
    if (host) ro.observe(host)
    return () => ro.disconnect()
  }, [phone])
  // Opened near an edge, the list would leave the stage: once it has grown, it moves back on.
  useEffect(() => { if (phone) return; const id = window.setTimeout(fit, 520); return () => clearTimeout(id) }, [s.island, phone])
  // Anywhere on the bar but the box: a press that moves is a drag, one that does not is a click.
  // The move and the release are heard on the window (with the shell's own listener, which the
  // comment chrome's quiet never skips), so the drag goes on outside the island.
  const grab = (e: ReactPointerEvent) => {
    if (phone || e.button !== 0 || (e.target as Element).closest('textarea, input, [data-island-list]')) return
    const d = { x: e.clientX, y: e.clientY, from: at, to: at, moved: false }
    const move = (ev: PointerEvent) => {
      if (!d.moved && Math.hypot(ev.clientX - d.x, ev.clientY - d.y) < 4) return
      d.moved = true
      setDragging(true)
      d.to = clamp({ x: d.from.x + ev.clientX - d.x, y: d.from.y + ev.clientY - d.y }, d.to)
      setAt(d.to)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      if (!d.moved) return
      setDragging(false)
      islandPrefs.set({ at: d.to })
      // The release ends a drag, not a press on the button it started on.
      const eat = (ev: Event) => { ev.stopPropagation(); ev.preventDefault() }
      card.current?.addEventListener('click', eat, { capture: true, once: true })
      window.setTimeout(() => card.current?.removeEventListener('click', eat, { capture: true }), 0)
    }
    listen(window, 'pointermove', move)
    listen(window, 'pointerup', up)
    listen(window, 'pointercancel', up)
  }

  // Copy mode is the other way of acting on the design, with a bar of its own: a wide screen puts
  // the island away while it is on, so the lines it marks are all free to press.
  if (!s.place || (copying && !phone)) return null

  const add = () => { if (act.commentWhole(text)) setText('') }
  const typing = focus || !!text.trim()
  const working = rows.some(r => r.state === 'seen' && !r.stopped)
  const live = news && !open ? news : null
  const edge = live ? EDGE[live.kind] : working ? EDGE.working : ''
  const top = prefs.place === 'top' && !phone
  const total = rows.length
  const dot = unread && !open ? EDGE.reply : working ? EDGE.working : total ? EDGE.done : ''
  const width = phone ? '100%' : open ? 440 : typing ? 400 : shown && !open ? 360 : 300
  const showNews = !!shown && !open
  const openList = () => { if (phone) act.openSheet(true); else act.openIsland(!s.island) }

  const newsRow = (
    <div className="grid transition-[grid-template-rows] duration-500 ease-[cubic-bezier(.2,.9,.25,1)]" style={{ gridTemplateRows: showNews ? '1fr' : '0fr' }}>
      <div className="min-h-0 overflow-hidden">
        {shown && (
          <button type="button" data-shoot="island-news" data-news={shown.kind} onClick={() => { read(); openList() }} tabIndex={showNews ? 0 : -1}
            className="flex w-full items-center gap-2.5 px-3 pb-0.5 pt-2.5 text-start">
            <span key={`i${shown.key}`} className={`grid size-7 shrink-0 place-items-center rounded-full text-white ${leaving ? 'animate-[proto-isl-out_.3s_ease-in_forwards]' : 'animate-[proto-isl-pop_.5s_cubic-bezier(.3,1.6,.5,1)]'}`} style={{ background: EDGE[shown.kind] }}><Icon name={NEWS_ICON[shown.kind]} className={`size-3.5 ${shown.kind === 'working' ? 'animate-spin' : ''}`} /></span>
            <span key={`t${shown.key}`} className={`min-w-0 flex-1 ${leaving ? 'animate-[proto-isl-out_.3s_ease-in_forwards]' : 'animate-[proto-isl-rise_.45s_cubic-bezier(.2,.9,.3,1)_both]'}`}>
              <span className="block truncate text-[13px] font-medium">{shown.title}</span>
              <span dir="auto" className={`block truncate text-xs ${phone ? 'text-white/60' : 'text-zinc-500 dark:text-zinc-400'}`}>{shown.text}</span>
            </span>
          </button>
        )}
      </div>
    </div>
  )

  const list = !phone && (
    <div data-island-list className="grid transition-[grid-template-rows] duration-500 ease-[cubic-bezier(.2,.9,.25,1)]" style={{ gridTemplateRows: open ? '1fr' : '0fr' }} inert={!open}>
      <div className="min-h-0 overflow-hidden">
        <div data-shoot="comments" className="flex max-h-[min(30rem,calc(100dvh-12rem))] flex-col">
          <div className="flex shrink-0 items-center gap-2 px-3.5 pb-1 pt-3">
            <h2 className="text-[13px] font-semibold">{t('Comments')}</h2>
            {total > 0 && <span className="rounded-full bg-zinc-900/[.06] px-1.5 text-[11px] font-medium tabular-nums text-zinc-500 dark:bg-white/10">{total}</span>}
            <Listening on={!!s.inbox?.listening} stalled={stalled > 0} className="ms-auto" />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-4"><CommentList /></div>
          <div className="shrink-0 space-y-2 px-2 empty:hidden"><Notices /></div>
        </div>
      </div>
    </div>
  )

  const bar = (
    <div className={`relative flex shrink-0 items-end gap-1.5 p-1.5 ${phone ? 'border-b border-white/[.06]' : ''}`}>
      {open && <span aria-hidden className={`pointer-events-none absolute inset-x-0 h-5 ${top ? 'top-full bg-gradient-to-b' : 'bottom-full bg-gradient-to-t'} from-white to-transparent dark:from-zinc-900`} />}
      <button type="button" data-act="comment:toggle" data-shoot="comment" aria-pressed={picking} aria-label={t('Select an element to comment on')}
        title={picking ? t('Stop selecting · Esc') : `${t('Select an element to comment on')} · C`}
        className={`grid size-8 shrink-0 place-items-center rounded-full transition-colors ${picking ? 'bg-proto-primary text-proto-primary-fg' : phone ? 'bg-white/10 text-white/80' : 'bg-zinc-900/[.05] text-zinc-600 hover:bg-zinc-900/10 hover:text-zinc-900 dark:bg-white/[.08] dark:text-zinc-300 dark:hover:bg-white/15 dark:hover:text-white'}`}>
        <Icon name={picking ? 'select-on' : 'select'} className="size-4" />
      </button>
      <textarea ref={input} data-shoot="whole-input" rows={1} value={text} onChange={e => setText(e.target.value)} dir="auto" autoComplete="off" enterKeyHint="enter"
        aria-label={t('Comment on the entire variant')} placeholder={picking ? t('Click what to comment on') : typing || phone ? t('Comment on the entire variant') : t('Comment…')} title={`${t('Comment on the whole variant')} · ⇧C`}
        onFocus={() => { setFocus(true); act.wholeFocus(true) }} onBlur={() => { setFocus(false); act.wholeFocus(false) }}
        onKeyDown={e => {
          if (e.nativeEvent.isComposing) return
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); e.stopPropagation(); add() }
          else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); input.current?.blur() }
        }}
        className={`max-h-[116px] min-h-8 min-w-0 flex-1 resize-none overflow-y-auto rounded-2xl px-3 py-1.5 text-[13px] leading-5 outline-none [@media(pointer:coarse)]:text-base ${phone ? 'bg-white/10 text-white placeholder:text-white/45' : 'bg-zinc-900/[.05] placeholder:text-zinc-400 focus:ring-2 focus:ring-proto-primary-ring dark:bg-white/[.08]'}`} />
      {text.trim()
        ? <button type="button" data-shoot="whole-add" onClick={add} aria-label={t('Add the comment')} title={`${t('Add the comment')} · ${MOD} Enter`}
            className="grid size-8 shrink-0 place-items-center rounded-full bg-proto-primary text-proto-primary-fg hover:bg-proto-primary-hover"><Icon name="send" className="size-4" /></button>
        : drafts > 0 && !s.live && <button type="button" data-shoot="send" onClick={act.send} disabled={s.sending} title={`${tn(drafts, 'Send {n} to {agent}', 'Send {n} to {agent}', { agent })} · ${MOD} Enter`}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-proto-primary px-3 text-xs font-semibold text-proto-primary-fg hover:bg-proto-primary-hover disabled:opacity-60">
            <Icon name="send" className="size-3.5" />{s.sending ? t('Sending…') : tn(drafts, 'Send {n}', 'Send {n}')}
          </button>}
      <button type="button" data-shoot="island-open" onClick={() => { read(); openList() }} aria-expanded={phone ? s.sheet : open} aria-label={open ? t('Collapse the comments') : tn(total, 'Open {n} comment', 'Open all {n} comments')}
        className={`flex h-8 shrink-0 items-center gap-1.5 rounded-full px-2 text-xs ${phone ? 'text-white/80' : 'text-zinc-600 hover:bg-zinc-900/5 dark:text-zinc-300 dark:hover:bg-white/10'}`}>
        <span className="relative grid size-2 place-items-center">
          {unread > 0 && !open && <span className="absolute size-2 animate-ping rounded-full" style={{ background: EDGE.reply }} />}
          <span className={`size-2 rounded-full transition-colors duration-500 ${dot ? '' : 'bg-zinc-300 dark:bg-zinc-600'}`} style={dot ? { background: dot } : undefined} />
        </span>
        <span className="tabular-nums">{total}</span>
        <span className={`transition-transform duration-300 ${open !== top ? 'rotate-180' : ''}`}><Icon name="caret-up" className="size-3 opacity-60" /></span>
      </button>
    </div>
  )

  if (phone) return (
    <div data-island data-comment-ui="" className="pointer-events-auto absolute inset-x-2 flex flex-col overflow-hidden rounded-t-3xl bg-zinc-900/90 text-white backdrop-blur dark:bg-zinc-800/90"
      style={{ bottom: 'calc(var(--pill-h, 0px) - .5rem - var(--isl-h, 0px))', boxShadow: edge ? `inset 0 2px ${edge}, inset 2px 0 ${edge}, inset -2px 0 ${edge}` : undefined }}>
      {newsRow}
      {bar}
    </div>
  )
  return (
    <div className={`pointer-events-none absolute inset-x-0 flex justify-center px-4 ${top ? 'top-4' : ''}`} style={top ? undefined : { bottom: 'calc(var(--pill-h, 0px) + var(--dock-h, 0px) + var(--copy-h, 0px) + 1rem)' }}>
      <div ref={card} data-island data-comment-ui="" data-open={open || undefined} onPointerDown={grab}
        onDoubleClick={e => { if (!(e.target as Element).closest('button, textarea, [data-island-list]')) islandPrefs.set({ at: { x: 0, y: 0 } }) }}
        className={`pointer-events-auto flex max-w-full flex-col rounded-[22px] shadow-[0_18px_44px_-14px_rgb(0_0_0/.35)] ring-1 ring-black/[.08] dark:ring-white/10 overflow-hidden bg-white text-zinc-900 transition-[width,box-shadow] duration-500 ease-[cubic-bezier(.2,.9,.25,1.1)] dark:bg-zinc-900 dark:text-zinc-100 ${top ? 'flex-col-reverse' : ''} ${dragging ? 'cursor-grabbing select-none' : 'cursor-grab'}`}
        style={{
          width, translate: `${at.x}px ${at.y}px`,
          ...(edge ? { boxShadow: `0 0 0 2px ${edge}, 0 18px 44px -14px rgb(0 0 0 / .35)` } : {}),
        }}>
        {list}
        {newsRow}
        {bar}
      </div>
    </div>
  )
}
