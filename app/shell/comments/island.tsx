// The comments island: one small bar floating over the stage, collapsed most of the time. Select
// (pick an element to comment on), a box for a comment on the whole variant, and the count, which
// opens the list above the same bar. When the agent starts on a comment, finishes it or replies,
// the island grows for a moment to say so, like a system notification, and its edge takes the
// colour of the news. A wide screen keeps it on an edge of the stage (island-drag.ts): flat on the
// foot or the top, or upright on the side (the right, the left in Hebrew), where it rests as a small tab, widens into a rail under the
// pointer and opens as the full-height panel. A phone has it as the top row of one bar with the
// pill, flush with the screen's foot, and its count opens the list in it.
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import { rtl, t, tn } from '../i18n'
import { useAgentName, useCtx } from './ctx'
import { islandPrefs, useIslandPrefs, type IslandPrefs } from './island-prefs'
import { useEdgeDrag, type Side } from './island-drag'
import { CommentList, Notices, useRows } from './list'
import { linksNew } from './links'
import { Icon, Listening, MOD, plain } from './ui'
import { useKeyboard } from './keyboard'
import type { CState } from './types'
import { useTagField } from './tag-field'

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
function useNews(rows: ReturnType<typeof useRows>['rows'], agent: string, which: IslandPrefs['news'], ready: boolean) {
  const last = useRef<Map<string, { state: CState; reply: string }> | null>(null)
  const [news, setNews] = useState<News | null>(null)
  const [unread, setUnread] = useState(0)
  const n = useRef(0)
  const now = rows.map(r => [r.item.id, r.state, [...r.turns].reverse().find(x => x.reply)?.reply?.text ?? ''] as const)
  const sig = JSON.stringify(now)
  useEffect(() => {
    // Until the server's first word on them, sent comments read as just sent: comparing then would
    // announce, after a reload, what was finished long ago.
    if (!ready) return
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
  }, [sig, ready])
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
  const { act, copyStore, host } = useCtx()
  const copying = useSyncExternalStore(copyStore.subscribe, () => copyStore.get().on)
  const agent = useAgentName()
  const { s, rows, drafts, stalled } = useRows()
  const prefs = useIslandPrefs()
  const phone = usePhone()
  const { news, unread, read } = useNews(rows, agent, prefs.news, !!s.inbox)
  const { shown, leaving } = useShown(news)
  const [focus, setFocus] = useState(false)
  // The box: words, and chips where other variants (its @ menu) and elements picked on the design (the
  // menu's Tag an element) were tagged. A picked element comes back with the box (and on the right
  // edge, the panel it is in) open again and the cursor after it.
  const field = useTagField({
    owner: 'island',
    reopen: () => { if (!phone && side) act.openIsland(true); return side ? 160 : 0 },
    onKey: e => {
      // Mod Enter adds and sends, as in the element composer; with nothing typed it sends the drafts.
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); e.stopPropagation(); if (act1 === 'add') { add(); if (!s.live) void act.send() } else if (act1 === 'send' && !s.sending) void act.send() }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); field.el()?.blur() }
    },
  })
  const empty = field.empty
  const card = useRef<HTMLDivElement>(null)
  const lastPanel = useRef(0)
  const cap = useRef<HTMLDivElement>(null)
  const open = s.island
  // Typing on a phone, the bar rides the keyboard and the pill row under it steps aside (shell.ts).
  const kb = useKeyboard(phone && focus)
  useEffect(() => {
    const zone = cap.current?.closest('[data-zone]')
    zone?.toggleAttribute('data-typing', phone && focus)
    return () => zone?.removeAttribute('data-typing')
  }, [phone, focus])
  const picking = s.mode.kind === 'pick'
  // Selecting an element to comment on (the button or C), or to tag in the box: the open list folds
  // away, so the whole design is free to point at. A tag for a reply in the list keeps it open.
  useEffect(() => { if (picking && s.island && (!s.wholeTag || s.tagOwner === 'island')) act.openIsland(false) }, [picking])
  // ⇧C, or a sidebar row's Comment on this: the cursor goes in the box. A tick later, so the key
  // that asked (⇧C) has finished and its letter cannot land in the box.
  useEffect(() => {
    if (!s.focusAsk) return
    act.askDone()
    // Upright, the box is in the panel: it opens first, and the cursor goes in once it has grown.
    const upright = !phone && side && !s.island
    if (upright) act.openIsland(true)
    window.setTimeout(() => field.focus(), upright ? 140 : 0)
  }, [s.focusAsk, act])
  useEffect(() => () => act.wholeFocus(false), [act])
  // Opened, the list has been seen.
  useEffect(() => { if (s.island || s.sheet) read() }, [s.island, s.sheet])

  // On a wide screen it rests on an edge of the stage (island-drag.ts). `side` turns with the drag,
  // ahead of the preferences, so the card stands upright while it is still held.
  const sideOf = (place: IslandPrefs['place']): Side | null => place === 'right' ? 'right' : null
  const [side, setSide] = useState<Side | null>(sideOf(prefs.place))
  useEffect(() => setSide(sideOf(prefs.place)), [prefs.place])
  const [rail, setRail] = useState(false)
  // Folding the panel, its contents stay a moment, fading at full width while the card shrinks to
  // the tab, so nothing reflows on the way; opening or folding, the rail's hover starts over.
  const [closing, setClosing] = useState(false)
  // Sizes dragged by hand (the edges of the open list or panel), live while dragged, kept on release.
  const [size, setSize] = useState({ listH: prefs.listH, listW: prefs.listW, sideW: prefs.sideW })
  const [resizing, setResizing] = useState(false)
  const wasOpen = useRef(open)
  useEffect(() => {
    setRail(false)
    const was = wasOpen.current
    wasOpen.current = open
    if (!was || open || !side) return setClosing(false)
    setClosing(true)
    const id = window.setTimeout(() => setClosing(false), 300)
    return () => clearTimeout(id)
  }, [open])
  // From the very render that folds it, not one later: otherwise the tab's hover area fills the
  // still-large card for a frame and the pointer over it reads as a hover.
  const folding = closing || (wasOpen.current && !open && !!side)
  useEdgeDrag({
    card, on: !phone && !!s.place && !copying, place: prefs.place, along: prefs.along, full: !!side && open,
    onSide: next => { setSide(next); setRail(false) },
    // Picked up, the open list folds out of the way.
    onHold: on => { setRail(false); if (on && s.island) act.openIsland(false) },
    onDrop: (place, along) => islandPrefs.set({ place, along }),
  })

  // Copy mode is the other way of acting on the design, with a bar of its own: a wide screen puts
  // the island away while it is on, so the lines it marks are all free to press.
  // The long placeholder only where it fits on one line; a narrow phone gets the short one.
  const [fits, setFits] = useState(true)
  useLayoutEffect(() => {
    const el = field.el()
    const c = document.createElement('canvas').getContext('2d')
    if (!el || !c) return
    const f = () => {
      const cs = getComputedStyle(el)
      c.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`
      setFits(c.measureText(t('Comment on the entire variant')).width <= el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight))
    }
    f()
    const ro = new ResizeObserver(f)
    ro.observe(el)
    return () => ro.disconnect()
  }, [phone, !!s.place])
  // One button beside the box goes through every state, its width gliding between them: hidden, the
  // add arrow while there is text, the Send n pill while drafts wait, hidden again. Leaving, it keeps
  // what it showed until it has shrunk away; the pill's width is measured off a hidden copy.
  const act1: 'add' | 'send' | null = !empty ? 'add' : drafts > 0 && !s.live ? 'send' : null
  const lastAct = useRef(act1)
  if (act1) lastAct.current = act1
  const shownAct = act1 ?? lastAct.current
  const sendLabel = s.sending ? t('Sending…') : tn(drafts, 'Send {n}', 'Send {n}')
  const pillRef = useRef<HTMLSpanElement>(null)
  const [pillW, setPillW] = useState(0)
  useLayoutEffect(() => { if (pillRef.current) setPillW(pillRef.current.offsetWidth) }, [sendLabel, phone, !!s.place])
  if (!s.place || (copying && !phone)) return null

  const add = () => { const n = field.read(); if (act.commentWhole(n.body, n.tags, n.shots)) field.clear() }
  const typing = focus || !empty
  const working = rows.some(r => r.state === 'seen' && !r.stopped)
  const live = news && !open ? news : null
  const edge = live ? EDGE[live.kind] : working ? EDGE.working : ''
  const top = prefs.place === 'top' && !phone
  // Viewers' new comments from share links count too, in the colour of news that waits on you.
  const fromLinks = linksNew(s.links)
  const total = rows.length + fromLinks
  const dot = (unread || fromLinks) && !open ? EDGE.reply : working ? EDGE.working : total ? EDGE.done : ''
  const width = phone ? '100%' : open ? size.listW ?? 440 : typing ? 400 : shown && !open ? 360 : 300
  const showNews = !!shown && !open
  // Send n takes the field's room: then the short placeholder, so it stays on one line.
  const sendShown = empty && drafts > 0 && !s.live
  const openList = () => act.openIsland(!s.island)
  // The count: a comments icon carrying the number as a badge, in the colour of the news. A new reply
  // pops it once and leaves it blue until the list is opened; nothing keeps pulsing. The news colours
  // are light, so their number is near-black (white on them barely reads); the grey keeps white.
  const mark = (
    <span className="relative grid place-items-center">
      <Icon name="chats" className="size-[18px]" />
      {total > 0 && <span key={`u${unread}-${fromLinks}`} data-link-badge={fromLinks > 0 ? fromLinks : undefined} className={`absolute -end-2 -top-2 grid h-4 min-w-4 place-items-center rounded-full px-1 text-[10px] font-semibold tabular-nums transition-colors duration-500 ${(unread > 0 || fromLinks > 0) && !open ? 'animate-[proto-isl-pop_.5s_cubic-bezier(.3,1.6,.5,1)]' : ''}`} style={{ background: dot || '#71717a', color: dot ? '#18181b' : '#fff' }}>
        {total}
      </span>}
    </span>
  )

  const newsRow = (
    <div className="grid transition-[grid-template-rows] duration-500 ease-[cubic-bezier(.2,.9,.25,1)]" style={{ gridTemplateRows: showNews ? '1fr' : '0fr' }}>
      <div className="min-h-0 overflow-hidden">
        {shown && (
          <button type="button" data-shoot="island-news" data-news={shown.kind} onClick={() => { read(); openList() }} tabIndex={showNews ? 0 : -1}
            className="flex w-full items-center gap-2.5 px-3 pb-0.5 pt-2.5 text-start">
            <span key={`i${shown.key}`} className={`grid size-7 shrink-0 place-items-center rounded-full text-white ${leaving ? 'animate-[proto-isl-out_.3s_ease-in_forwards]' : 'animate-[proto-isl-pop_.5s_cubic-bezier(.3,1.6,.5,1)]'}`} style={{ background: EDGE[shown.kind] }}><Icon name={NEWS_ICON[shown.kind]} className={`size-3.5 ${shown.kind === 'working' ? 'animate-spin' : ''}`} /></span>
            <span key={`t${shown.key}`} className={`min-w-0 flex-1 ${leaving ? 'animate-[proto-isl-out_.3s_ease-in_forwards]' : 'animate-[proto-isl-rise_.45s_cubic-bezier(.2,.9,.3,1)_both]'}`}>
              <span className="block truncate text-[13px] font-medium">{shown.title}</span>
              <span dir="auto" className="block truncate text-xs text-zinc-500 dark:text-zinc-400">{shown.text}</span>
            </span>
          </button>
        )}
      </div>
    </div>
  )

  const listBody = (fold?: ReactNode) => (<>
    <div data-island-grip className="flex shrink-0 cursor-grab items-center gap-2 px-3.5 pb-1 pt-3">
      <h2 className="text-[13px] font-semibold">{t('Comments')}</h2>
      <Listening on={!!s.inbox?.listening} stalled={stalled > 0} className="ms-auto" />
      {fold}
    </div>
    {/* The list fades out at its own foot, so the fade never lies over what comes after it (a notice,
        the tags over the box). */}
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-4"><CommentList /></div>
      <span aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-5 bg-gradient-to-t from-white to-transparent dark:from-zinc-900" />
    </div>
    <div className="shrink-0 space-y-2 px-2 empty:hidden"><Notices /></div>
  </>)
  const list = (
    <div data-island-list className="grid transition-[grid-template-rows] duration-500 ease-[cubic-bezier(.2,.9,.25,1)]" style={{ gridTemplateRows: open ? '1fr' : '0fr' }} inert={!open}>
      <div className="min-h-0 overflow-hidden">
        <div data-shoot="comments" className="flex max-h-[min(30rem,calc(100dvh-12rem))] flex-col" style={size.listH ? { height: size.listH, maxHeight: 'calc(100dvh - 9rem)' } : undefined}>{listBody()}</div>
      </div>
    </div>
  )

  const placeholder = picking ? (s.wholeTag ? t('Click what to tag') : phone ? t('Tap an element') : t('Click what to comment on')) : (typing || phone) && !sendShown && fits ? t('Comment on the entire variant') : t('Comment…')
  const bar = (
    <div className={`relative flex shrink-0 items-end ${phone ? 'gap-2 p-2' : 'gap-1.5 p-1.5'}`}>
      <button type="button" data-act="comment:toggle" data-shoot="comment" aria-pressed={picking} aria-label={t('Select an element to comment on')}
        title={picking ? t('Stop selecting · Esc') : `${t('Select an element to comment on')} · C`}
        className={`grid shrink-0 place-items-center rounded-full transition-colors ${phone ? 'size-10' : 'size-8'} ${picking ? 'bg-proto-primary text-proto-primary-fg' : 'bg-zinc-900/[.05] text-zinc-600 hover:bg-zinc-900/10 hover:text-zinc-900 dark:bg-white/[.08] dark:text-zinc-300 dark:hover:bg-white/15 dark:hover:text-white'}`}>
        <Icon name={phone ? (picking ? 'tap-on' : 'tap') : picking ? 'select-on' : 'select'} className={phone ? 'size-5' : 'size-4'} />
      </button>
      <div className="relative min-w-0 flex-1">
        <div {...field.props} data-shoot="whole-input" enterKeyHint="enter"
          aria-label={t('Comment on the entire variant')} aria-placeholder={placeholder} title={`${t('Comment on the whole variant')} · ⇧C`}
          onFocus={() => { setFocus(true); act.wholeFocus(true) }} onBlur={() => { field.props.onBlur(); setFocus(false); act.wholeFocus(false) }}
          className={`max-h-[116px] w-full overflow-y-auto whitespace-pre-wrap break-words outline-none ${phone ? 'min-h-10 rounded-[20px] px-4 py-2 text-base leading-6' : 'min-h-8 rounded-2xl px-3 py-1.5 text-[13px] leading-5 [@media(pointer:coarse)]:text-base'} bg-zinc-900/[.05] dark:bg-white/[.08] ${phone ? '' : 'focus:ring-2 focus:ring-proto-primary-ring'}`} />
        {empty && <span aria-hidden className={`pointer-events-none absolute inset-x-0 top-0 truncate text-start text-zinc-400 ${phone ? 'px-4 py-2 text-base leading-6' : 'px-3 py-1.5 text-[13px] leading-5 [@media(pointer:coarse)]:text-base'}`}>{placeholder}</span>}
      </div>
      {field.attachButton}
      <div inert={!act1} className="relative shrink-0"
        style={{ width: act1 === 'send' ? pillW : act1 ? (phone ? 40 : 32) : 0, marginInlineStart: act1 ? 0 : phone ? -8 : -6, transition: `width .42s ${SOFT}, margin .42s ${SOFT}` }}>
        <span ref={pillRef} aria-hidden className={`invisible absolute flex items-center gap-1.5 whitespace-nowrap px-3 font-semibold ${phone ? 'text-sm' : 'text-xs'}`}><Icon name="send" className="size-3.5" />{sendLabel}</span>
        <button type="button" data-shoot={shownAct === 'send' ? 'send' : 'whole-add'} onClick={shownAct === 'send' ? act.send : add} disabled={shownAct === 'send' && s.sending}
          aria-label={shownAct === 'send' ? undefined : t('Add the comment')}
          title={shownAct === 'send' ? `${tn(drafts, 'Send {n} to {agent}', 'Send {n} to {agent}', { agent })} · ${MOD} Enter` : s.live ? `${t('Add the comment')} · ${MOD} Enter` : t('Add, to send with the rest · {mod} Enter adds and sends to {agent}', { mod: MOD, agent })}
          className={`flex w-full items-center justify-center gap-1.5 overflow-hidden whitespace-nowrap rounded-full bg-proto-primary font-semibold text-proto-primary-fg hover:bg-proto-primary-hover disabled:opacity-60 ${phone ? 'h-10 text-sm' : 'h-8 text-xs'}`}
          style={act1
            // In, it pops a little past its size as its room opens; out, it shrinks and fades a beat ahead of the room closing.
            ? { transform: 'none', opacity: 1, transition: `transform .5s cubic-bezier(.3,1.5,.5,1) 60ms, opacity .2s ease-out 60ms, background-color .15s` }
            : { transform: 'scale(.3)', opacity: 0, transition: `transform .24s cubic-bezier(.4,0,1,1), opacity .18s ease-in, background-color .15s` }}>
          <Icon name="send" className={`shrink-0 ${shownAct === 'send' ? 'size-3.5' : phone ? 'size-5' : 'size-4'}`} />
          {shownAct === 'send' && <span key="label" className="animate-[proto-isl-rise_.35s_cubic-bezier(.2,.9,.25,1)_both]">{sendLabel}</span>}
        </button>
      </div>
      {/* Upright, the panel has its own fold button and the count is its header's. */}
      {(phone || !side) && <button type="button" data-shoot="island-open" onClick={() => { read(); openList() }} aria-expanded={open} aria-label={open ? t('Collapse the comments') : tn(total, 'Open {n} comment', 'Open all {n} comments')}
        className={`flex shrink-0 items-center rounded-full ${phone ? 'size-10 justify-center gap-0.5 text-sm' : 'h-8 gap-1.5 px-2 text-xs'} text-zinc-600 hover:bg-zinc-900/5 dark:text-zinc-300 dark:hover:bg-white/10`}>
        {/* Wide, the count is the comments icon with its badge, as on the side tab. A phone has no room
            for it: the count itself takes the news colour, lined up over the pill's end button. */}
        {phone ? <span className="tabular-nums" data-link-badge={fromLinks > 0 ? fromLinks : undefined} style={dot ? { color: dot } : undefined}>{total}</span> : <span className="me-0.5">{mark}</span>}
        <span className={`transition-transform duration-300 ${open !== top ? 'rotate-180' : ''}`}><Icon name="caret-up" className="size-3 opacity-60" /></span>
      </button>}
    </div>
  )

  // A phone opens the list in the bar itself, above the same row, over a dimmed page; a tap on the
  // page folds it again. The bar is solid, in the page's light or dark, flush with the screen's
  // sides and foot: its padding is the pill row's room (the pill draws over it, shell.ts), only
  // the foot's while folded, and none while it rides the keyboard.
  if (phone) return (<>
    {open && <button type="button" aria-label={t('Collapse the comments')} onClick={() => act.openIsland(false)} className="pointer-events-auto absolute inset-0 bg-black/30" />}
    <div ref={cap} data-island data-comment-ui="" data-open={open || undefined}
      className="pointer-events-auto absolute inset-x-0 bottom-0 flex flex-col overflow-hidden rounded-t-[22px] border-t border-black/10 bg-white pb-[calc(var(--pill-h,0px)-var(--isl-h,0px))] text-zinc-900 shadow-[0_-10px_30px_-18px_rgb(0_0_0/.35)] transition-[padding-bottom,bottom] duration-300 ease-out dark:border-white/10 dark:bg-zinc-950 dark:text-zinc-100 [[data-fold]_&]:pb-[max(.5rem,env(safe-area-inset-bottom))]"
      style={{ ...(kb || focus ? { bottom: kb, paddingBottom: 4 } : {}), ...(edge ? { boxShadow: `inset 0 2px ${edge}, inset 2px 0 ${edge}, inset -2px 0 ${edge}` } : {}) }}>
      {list}
      {newsRow}
      {bar}
      {field.pictures}
    </div>
    {field.menu}
  </>)
  // An edge of the open list (its far edge for the height, its sides for the width, growing both ways
  // from its centre) or of the panel on the side (its inner edge): dragged, it resizes; double-clicked,
  // it goes back to its own size. It holds the pointer, so the drag goes on over the design's iframe.
  const edgeHandle = (k: 'listH' | 'listW' | 'sideW', at: 'top' | 'bottom' | 'start' | 'end') => {
    const across = at === 'top' || at === 'bottom'
    return (
      <div aria-hidden data-island-resize className={`group absolute z-10 ${across ? `inset-x-8 h-2 cursor-ns-resize ${at === 'top' ? 'top-0' : 'bottom-0'}` : `inset-y-8 w-2 cursor-ew-resize ${k === 'sideW' ? 'start-0' : at === 'start' ? 'left-0' : 'right-0'}`}`}
        onPointerDown={e => {
          const c = card.current, handle = e.currentTarget
          if (e.button !== 0 || !c) return
          e.stopPropagation()
          e.preventDefault()
          handle.setPointerCapture(e.pointerId)
          const x0 = e.clientX, y0 = e.clientY, stage = c.closest<HTMLElement>('[data-island-host]')
          const from = k === 'listH' ? c.querySelector<HTMLElement>('[data-shoot="comments"]')?.offsetHeight ?? 320 : c.offsetWidth
          const within = (v: number, lo: number, hi: number) => Math.round(Math.min(Math.max(v, lo), Math.max(lo, hi)))
          let last = from
          setResizing(true)
          const move = (ev: PointerEvent) => {
            const dx = ev.clientX - x0, dy = ev.clientY - y0, W = stage?.clientWidth ?? innerWidth, H = stage?.clientHeight ?? innerHeight
            last = k === 'listH' ? within(from + (at === 'top' ? -dy : dy), 160, H - 160)
              : k === 'listW' ? within(from + 2 * (at === 'start' ? -dx : dx), 320, W - 32)
              : within(from + (rtl ? dx : -dx), 280, Math.min(720, W - 120))
            setSize(z => ({ ...z, [k]: last }))
          }
          const end = () => {
            handle.removeEventListener('pointermove', move)
            handle.removeEventListener('lostpointercapture', end)
            setResizing(false)
            islandPrefs.set({ [k]: last })
          }
          handle.addEventListener('pointermove', move)
          handle.addEventListener('lostpointercapture', end)
        }}
        onDoubleClick={e => { e.stopPropagation(); setSize(z => ({ ...z, [k]: undefined })); islandPrefs.set({ [k]: undefined }) }}>
        <span className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-zinc-400/0 transition-colors duration-150 group-hover:bg-zinc-400/70 ${across ? 'h-1 w-10' : 'h-10 w-1'}`} />
      </div>
    )
  }
  const home = (e: ReactMouseEvent) => { if (!(e.target as Element).closest('button, [contenteditable="true"], [data-island-list]')) islandPrefs.set({ place: 'bottom', along: 0 }) }
  const ring = edge ? { boxShadow: `0 0 0 2px ${edge}, 0 18px 44px -14px rgb(0 0 0 / .35)` } : {}
  const surface = 'pointer-events-auto absolute start-0 top-0 data-[held]:!transition-none bg-white text-zinc-900 shadow-[0_18px_44px_-14px_rgb(0_0_0/.35)] ring-1 ring-black/[.08] will-change-transform dark:bg-zinc-900 dark:text-zinc-100 dark:ring-white/10 data-[held]:cursor-grabbing data-[held]:select-none'
  if (side) {
    const toPanel = () => { read(); act.openIsland(true) }
    const toWrite = () => { toPanel(); window.setTimeout(() => field.focus(), 140) }
    // No ring of the news colour on the side: the count's badge carries it.
    const shape = open ? 'panel' : rail ? 'rail' : 'tab'
    return (
      <div ref={card} data-island data-comment-ui="" data-open={open || undefined} data-edge-side={side} data-shape={shape} onDoubleClick={home}
        className={`${surface} cursor-grab ${resizing ? '' : 'transition-[width,height,border-radius] duration-[360ms] ease-[cubic-bezier(.32,.72,0,1)]'} rounded-s-[22px] ${folding ? 'overflow-hidden' : ''}`}
        style={{ width: open ? size.sideW ?? 340 : rail ? 48 : 40, height: open ? 'calc(100% - 32px - var(--pill-h, 0px) - var(--dock-h, 0px) - var(--copy-h, 0px))' : rail ? 153 : 56, visibility: 'hidden' }}>
        {open || folding
          // The panel: its header, the comments and the bar arrive one after another as it grows.
          ? <div data-island-list data-shoot="comments" inert={folding} style={folding ? { width: size.sideW ?? 340, height: lastPanel.current || undefined } : undefined}
              ref={el => { if (el && !folding) lastPanel.current = el.offsetHeight }}
              className={`flex flex-col overflow-hidden ${folding ? `absolute start-0 top-0 opacity-0 transition-opacity duration-[80ms] ease-linear` : 'size-full'} rounded-s-[22px] [&>*]:animate-[proto-isl-rise_.45s_cubic-bezier(.2,.9,.25,1)_both] [&>*:nth-child(2)]:[animation-delay:60ms] [&>*:nth-child(3)]:[animation-delay:100ms] [&>*:nth-child(4)]:[animation-delay:130ms] [&>*:nth-child(5)]:[animation-delay:160ms]`}>
              {listBody(<button type="button" data-shoot="island-fold" onClick={() => act.openIsland(false)} aria-label={t('Fold the comments')} title={t('Fold the comments')}
                className="-me-1.5 grid size-7 shrink-0 place-items-center rounded-full text-zinc-500 hover:bg-zinc-900/5 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-white"><Icon name="fold-right" className="size-3.5" /></button>)}
              {newsRow}
              <div className="border-t border-black/[.06] dark:border-white/[.06]">{bar}</div>
              {field.pictures}{field.menu}
              {open && !folding && edgeHandle('sideW', 'start')}
            </div>
          // The tab and the rail are one set of buttons, placed from the foot: under the pointer the
          // card grows upward, the count settles a little lower and the rest rise out from behind it,
          // nearest first; leaving, they sink back into it together.
          : <div className="relative size-full" onPointerEnter={e => { if (e.pointerType === 'mouse') setRail(true) }} onPointerLeave={() => setRail(false)}>
              <Rise open={rail} at={131} order={4}><span className="grid h-4 place-items-center text-zinc-300 dark:text-zinc-600"><Icon name="grip-v" className="size-3.5 rotate-90" /></span></Rise>
              <Rise open={rail} at={93} order={3}>
                <button type="button" data-act="comment:toggle" data-shoot="comment" aria-pressed={picking} aria-label={t('Select an element to comment on')} title={picking ? t('Stop selecting · Esc') : `${t('Select an element to comment on')} · C`}
                  className={`grid size-8 place-items-center rounded-full transition-colors ${picking ? 'bg-proto-primary text-proto-primary-fg' : 'bg-zinc-900/[.05] text-zinc-600 hover:bg-zinc-900/10 hover:text-zinc-900 dark:bg-white/[.08] dark:text-zinc-300 dark:hover:bg-white/15 dark:hover:text-white'}`}><Icon name={picking ? 'select-on' : 'select'} className="size-4" /></button>
              </Rise>
              <Rise open={rail} at={55} order={2}>
                <button type="button" data-shoot="island-write" onClick={toWrite} aria-label={t('Comment on the entire variant')} title={`${t('Comment on the whole variant')} · ⇧C`}
                  className="grid size-8 place-items-center rounded-full bg-zinc-900/[.05] text-zinc-600 hover:bg-zinc-900/10 hover:text-zinc-900 dark:bg-white/[.08] dark:text-zinc-300 dark:hover:bg-white/15 dark:hover:text-white"><Icon name="chat-text" className="size-4" /></button>
              </Rise>
              <Rise open={rail} at={46} order={1}><span className="block h-px w-5 bg-zinc-900/10 dark:bg-white/10" /></Rise>
              {/* The count pops in as the tab appears: docked, or folded back from the panel. */}
              <button type="button" data-shoot="island-open" onClick={toPanel} aria-expanded={false} aria-label={tn(total, 'Open {n} comment', 'Open all {n} comments')}
                className={`absolute left-1/2 grid size-8 -translate-x-1/2 place-items-center rounded-full text-zinc-600 [animation:proto-isl-pop_.45s_cubic-bezier(.3,1.6,.5,1)_both] dark:text-zinc-300 ${rail ? 'hover:bg-zinc-900/5 dark:hover:bg-white/10' : ''}`}
                style={{ bottom: rail ? 6 : 12, transition: `bottom .42s ${EASE}` }}>{mark}</button>
            </div>}
      </div>
    )
  }
  return (
    <div ref={card} data-island data-comment-ui="" data-open={open || undefined} data-edge-side="flat" onDoubleClick={home}
      className={`${surface} flex max-w-[calc(100%-32px)] cursor-grab flex-col overflow-hidden rounded-[22px] ${resizing ? '' : 'transition-[width,box-shadow] duration-500 ease-[cubic-bezier(.2,.9,.25,1.1)]'} ${top ? 'flex-col-reverse' : ''}`}
      style={{ width, visibility: 'hidden', ...ring }}>
      {open && <>{edgeHandle('listH', top ? 'bottom' : 'top')}{edgeHandle('listW', 'start')}{edgeHandle('listW', 'end')}</>}
      {list}
      {newsRow}
      {bar}
      {field.pictures}{field.menu}
    </div>
  )
}

const EASE = 'cubic-bezier(.2,.9,.25,1)'
const SOFT = 'cubic-bezier(.32,.72,0,1)'
/** One of the rail's buttons: placed from the foot when open, folded into the count when not. */
function Rise({ open, at, order, children }: { open: boolean; at: number; order: number; children: ReactNode }) {
  return (
    <div aria-hidden={!open} inert={!open} className="absolute left-1/2"
      style={{
        bottom: open ? at : 12,
        opacity: open ? 1 : 0,
        transform: `translateX(-50%) scale(${open ? 1 : 0.55})`,
        transition: open
          ? `bottom .42s ${EASE} ${order * 45}ms, transform .42s ${EASE} ${order * 45}ms, opacity .25s ease-out ${order * 45 + 40}ms`
          : `bottom .22s ${EASE}, transform .22s ${EASE}, opacity .12s ease-in`,
      }}>
      {children}
    </div>
  )
}
