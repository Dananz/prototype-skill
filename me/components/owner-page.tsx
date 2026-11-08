'use client'
// The owner's links, as a mail client: the list on the left, the chosen link's room on the right (its
// address, big, with Copy, Open and Edit on your Mac; its card and numbers; the message for viewers;
// the comments; Turn off and Remove). On a phone the list alone, and a link opens full screen with a
// way back. The chosen link is in the address (?link=<id>), so a reload or a shared URL opens it.
import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { useAnimate, useReducedMotion } from 'motion/react'
import {
  ArrowBendUpLeftIcon, ArrowSquareOutIcon, CaretLeftIcon, CaretRightIcon, ChatCircleIcon, CheckIcon, CopyIcon,
  EyeIcon, EyeSlashIcon, PowerIcon,
} from '@phosphor-icons/react'
import { AnimatedIcon } from './animated-icon'
import { Avatar, nameOf } from './avatar'
import { EditOnMac } from './edit-on-mac'
import { Header } from './header'
import { Logo } from './logo'
import { RemoveLink } from './remove-link'
import { fetchShares } from '@/lib/api'
import { useCopied } from '@/lib/copy'
import { useDesktop } from '@/lib/media'
import { useRemove, useReply, useSaveMessage, useSetHidden, useSetOff } from '@/lib/mutations'
import { isNew, markRead, newOf, useReadMarks } from '@/lib/read-marks'
import { MESSAGE_MAX, REPLY_MAX, SHARES, type Link, type Me, type Note } from '@/lib/types'

const ICON = 'grid size-9 shrink-0 place-items-center rounded-[9px] text-ink2 hover:bg-tint hover:text-ink'
const ACT = 'grid size-8 place-items-center rounded-lg text-dim hover:bg-tint hover:text-ink'
const FIELD = 'block w-full resize-none rounded-xl border border-line bg-white px-3 py-2.5 text-[14px] leading-snug text-ink outline-none placeholder:text-faint focus-visible:border-ring focus-visible:ring-4 focus-visible:ring-ring/15'
const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`
const soonOf = (l: Link) => !l.off && l.daysLeft !== null && l.daysLeft <= 7

/** Puts the chosen link in the address without a trip to the server (Next.js syncs useSearchParams). */
function setLinkParam(id: string | null) {
  const q = new URLSearchParams(window.location.search)
  if (id) q.set('link', id)
  else q.delete('link')
  const s = q.toString()
  window.history.replaceState(null, '', s ? `?${s}` : window.location.pathname)
}

/* ------------------------------------------------------------------ the list */

function ListRow({ l, fresh, active, pick }: { l: Link; fresh: number; active: boolean; pick: () => void }) {
  return (
    <li>
      <button type="button" data-row={l.id} data-shoot={`row-${l.id}`} onClick={pick} aria-current={active ? 'true' : undefined}
        className={`flex w-full items-start gap-3 rounded-xl p-3 text-start hover:bg-soft/70 ${active ? 'md:bg-white md:shadow-[0_1px_2px_rgba(18,16,25,0.06),0_0_0_1px_var(--color-line)] md:hover:bg-white' : ''}`}>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-2">
            <span className={`truncate text-[14.5px] font-semibold ${l.off ? 'text-[#8a87a0]' : 'text-ink'}`}>{l.title}</span>
            {l.off && <span className="shrink-0 rounded-full bg-line px-1.5 py-px text-[10.5px] font-medium text-ink2">Off</span>}
          </span>
          <span className="mt-0.5 block truncate text-[12px] text-dim">{l.project || 'No project'}</span>
          <span className="mt-1.5 flex items-center gap-3 text-[12px] text-dim">
            <span className="inline-flex items-center gap-1"><EyeIcon size={13} aria-hidden="true" /><span className="sr-only">Views: </span>{l.views}</span>
            <span className="inline-flex items-center gap-1"><ChatCircleIcon size={13} aria-hidden="true" /><span className="sr-only">Comments: </span>{l.comments.total}</span>
            {l.off ? <span>Turned off</span>
              : l.now ? <span className="inline-flex items-center gap-1.5 text-green"><span className="size-1.5 rounded-full bg-live" />{nameOf(l.now)} is in it</span>
                : <span className={soonOf(l) ? 'text-amber' : ''}>{l.words.expiry}</span>}
          </span>
        </span>
        {fresh > 0 && <span aria-label={`${fresh} new comments`} className="mt-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-brand px-1.5 text-[11px] font-semibold text-white">{fresh}</span>}
        <CaretRightIcon size={16} aria-hidden="true" className="mt-0.5 shrink-0 self-center text-faint md:hidden" />
      </button>
    </li>
  )
}

/* ------------------------------------------------------------------ the room */

function Address({ l, me }: { l: Link; me: Me }) {
  const { done, copy } = useCopied()
  const link = `${me.origin}/${l.id}`
  return (
    <div data-shoot="address" className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
      <p className={`min-w-0 text-[22px] leading-tight min-[400px]:text-[26px] sm:text-[34px] ${l.off ? 'text-faint line-through decoration-[#c9c6f5] decoration-2' : 'text-ink'}`}>
        <span className="text-faint">{me.base}/</span><span className="break-all">{l.id}</span>
      </p>
      <span className="flex shrink-0 items-center gap-0.5 rounded-xl border border-line bg-white p-0.5">
        <button type="button" onClick={() => copy('link', link)} aria-label={done ? 'Copied' : 'Copy the link'} title={done ? 'Copied' : 'Copy the link'}
          className={`${ICON} ${done ? 'text-green! hover:text-green!' : ''}`}>
          <AnimatedIcon state={done ? 'done' : 'idle'} size={18}>{done ? <CheckIcon size={18} weight="bold" /> : <CopyIcon size={18} />}</AnimatedIcon>
        </button>
        <a href={link} target="_blank" rel="noreferrer" aria-label="Open the link" title="Open the link" className={ICON}><ArrowSquareOutIcon size={18} aria-hidden="true" /></a>
        <EditOnMac command={`/prototype edit ${link}`} buttonClass={ICON} />
      </span>
    </div>
  )
}

/** The card a chat shows when the link is pasted, drawn small. */
function Card({ l, me }: { l: Link; me: Me }) {
  const dim = l.off ? 'opacity-35 grayscale' : ''
  return (
    <figure aria-label="How the link looks when pasted" className="w-full overflow-hidden rounded-[14px] bg-white shadow-[0_1px_2px_rgba(18,16,25,.06),0_10px_28px_-14px_rgba(42,36,120,.3)] ring-1 ring-line">
      <div className="relative aspect-[1200/630] overflow-hidden bg-ink">
        {l.card
          // The card is behind the cookie, from the host: no optimizer can fetch it.
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={`/me/api/shares/${l.id}/card`} alt="" loading="lazy" className={`absolute inset-0 size-full object-cover ${dim}`} />
          : <>
            <div className={`absolute inset-0 bg-[radial-gradient(120%_80%_at_50%_120%,#4a42d4_0%,#1c1830_45%,#121019_75%)] ${dim}`} />
            <Logo className={`absolute top-1/2 left-1/2 h-[46%] -translate-x-1/2 -translate-y-1/2 ${dim}`} />
          </>}
        {l.off && <span className="absolute top-[80%] left-1/2 -translate-x-1/2 text-[11px] font-medium whitespace-nowrap text-white/70">Turned off</span>}
      </div>
      <figcaption className="flex gap-2.5 px-3 pt-2.5 pb-3">
        <span className="min-w-0 flex-1">
          <span className="block text-[10.5px] text-dim">{me.base}</span>
          <span className={`block truncate text-[13.5px] font-semibold ${l.off ? 'text-[#8d8aa3]' : 'text-ink'}`}>{l.title}</span>
          <span className="mt-0.5 line-clamp-2 block text-[11.5px] leading-snug text-ink2">{l.message || `A prototype shared by ${me.name || me.login}`}</span>
        </span>
        <Avatar who={{ avatar: me.avatar, name: me.name, login: me.login }} size={24} plain className="mt-0.5" />
      </figcaption>
    </figure>
  )
}

function Numbers({ l, fresh }: { l: Link; fresh: number }) {
  const soon = soonOf(l)
  const d = l.daysLeft
  return (
    <div className="min-w-0 flex-1 space-y-2.5 text-[14px] leading-snug text-ink2">
      <p><b className="font-semibold text-ink tabular-nums">{l.views}</b> views, <b className="font-semibold text-ink tabular-nums">{l.comments.total}</b> comments{fresh > 0 && <span className="text-brand">, {fresh} new</span>}.</p>
      <p className="flex items-center gap-2">
        {l.now ? <><Avatar who={l.now} size={20} />{l.off ? <span>{nameOf(l.now)} looked last, just now.</span> : <span className="text-green">{nameOf(l.now)} is in it now.</span>}</>
          : l.last ? <><Avatar who={l.last} size={20} /><span>{nameOf(l.last)} looked last, {l.words.last}.</span></>
            : <span>Nobody has opened it yet.</span>}
      </p>
      {d === null ? <p className="mt-1.5 text-[12.5px] text-dim">No expiry. An update from the Mac gives it 30 days.</p> : (
        <div className="pt-1">
          <div data-shoot="track" className="flex max-w-[320px] items-center gap-2.5" title={l.words.exact}>
            {/* An SVG width, not a style: the CSP refuses inline styles. */}
            <svg aria-hidden="true" className="h-[3px] flex-1 overflow-hidden rounded-full bg-soft" preserveAspectRatio="none">
              <rect height="100%" rx="1.5" width={`${Math.max(3, Math.min(100, (Math.max(0, d) / 30) * 100)).toFixed(1)}%`} className={soon ? 'fill-amber2' : 'fill-[#bdbacd]'} />
            </svg>
            <span className={`shrink-0 text-[12px] tabular-nums ${soon ? 'font-medium text-amber' : 'text-dim'}`}>{d <= 0 ? 'Expired' : d === 1 ? '1 day' : `${d} days`}</span>
          </div>
          <p className="mt-1.5 text-[12.5px] text-dim">
            {l.off ? 'Turned off. The page and its comments are kept.' : soon ? `${l.words.expiry}. An update from the Mac gives it 30 more.` : 'An update from the Mac gives it 30 more days.'}
          </p>
        </div>
      )}
    </div>
  )
}

function Message({ l }: { l: Link }) {
  const save = useSaveMessage()
  const saved = l.message ?? ''
  const [text, setText] = useState(saved)
  const [done, setDone] = useState(false)
  const changed = text.trim() !== saved
  return (
    <section aria-labelledby={`msg-${l.id}`}>
      <h2 id={`msg-${l.id}`} className="text-[15px] font-semibold">Message for viewers</h2>
      <p className="mt-0.5 text-[12.5px] text-dim">Shown above the designs when someone opens the link.</p>
      <textarea data-shoot="message" value={text} rows={2} maxLength={MESSAGE_MAX} placeholder="What should viewers look at first?" aria-labelledby={`msg-${l.id}`}
        onChange={e => { setText(e.target.value.slice(0, MESSAGE_MAX)); setDone(false) }} className={`mt-2.5 ${FIELD}`} />
      <div className="mt-1.5 flex h-8 items-center gap-3 text-[12px] text-dim">
        <span className={`tabular-nums ${text.length > MESSAGE_MAX - 20 ? 'text-amber' : ''}`}>{text.length}/{MESSAGE_MAX}</span>
        <span aria-live="polite" className="inline-flex">{done && !changed && <span className="inline-flex items-center gap-1 text-green"><CheckIcon size={14} aria-hidden="true" />Saved</span>}</span>
        <span className="ms-auto flex gap-1.5">
          {changed && <button type="button" onClick={() => setText(saved)} className="h-8 rounded-lg px-2.5 text-[13px] font-medium text-ink2 hover:bg-tint">Cancel</button>}
          <button type="button" data-shoot="save" disabled={!changed}
            onClick={() => { setDone(true); save.mutate({ id: l.id, message: text }, { onError: () => setDone(false) }) }}
            className="h-8 rounded-lg bg-brand px-3 text-[13px] font-medium text-white hover:bg-brand-deep disabled:bg-line disabled:text-[#8a87a0]">Save</button>
        </span>
      </div>
    </section>
  )
}

function Comment({ n, l, origin, fresh }: { n: Note; l: Link; origin: string; fresh: boolean }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const reply = useReply()
  const hide = useSetHidden()
  const name = nameOf(n.author)
  if (n.hidden) return (
    <li data-comment={n.id} data-hidden="" className="flex items-center gap-2 py-3 text-[13px] text-dim">
      <EyeSlashIcon size={16} aria-hidden="true" />Hidden from viewers: {name}
      <button type="button" onClick={() => hide.mutate({ share: l.id, id: n.id, hidden: false })} className="ms-auto h-8 rounded-lg px-2.5 font-medium text-brand hover:bg-tint">Show again</button>
    </li>
  )
  return (
    <li data-comment={n.id} className="flex gap-3 py-4">
      <Avatar who={n.author} size={30} />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-baseline gap-x-2 text-[12.5px] text-dim">
          <span className="text-[14px] font-semibold text-ink">{name}</span>
          <span>{n.ago}</span>
          {fresh && <span className="rounded-full bg-tint px-1.5 text-[11px] font-medium text-brand">New</span>}
        </p>
        <p className="mt-1 text-[14.5px] leading-snug wrap-anywhere whitespace-pre-wrap text-ink">{n.body}</p>
        {n.owner_reply && <p data-reply="" className="mt-2.5 flex gap-2 border-s-2 border-line ps-3 text-[13.5px] leading-snug wrap-anywhere whitespace-pre-wrap text-ink2"><span className="font-semibold text-ink">You</span><span>{n.owner_reply}</span></p>}
        {open ? (
          <form className="mt-3" onSubmit={e => {
            e.preventDefault()
            if (!text.trim()) return
            reply.mutate({ share: l.id, id: n.id, reply: text.trim() })
            setText('')
            setOpen(false)
          }}>
            <textarea autoFocus value={text} rows={2} maxLength={REPLY_MAX} onChange={e => setText(e.target.value)} placeholder={`Reply to ${name}`} aria-label={`Reply to ${name}`} className={FIELD} />
            <div className="mt-2 flex justify-end gap-1.5">
              <button type="button" onClick={() => { setOpen(false); setText('') }} className="h-8 rounded-lg px-2.5 text-[13px] font-medium text-ink2 hover:bg-tint">Cancel</button>
              <button type="submit" disabled={!text.trim()} className="h-8 rounded-lg bg-brand px-3 text-[13px] font-medium text-white hover:bg-brand-deep disabled:opacity-40">Reply</button>
            </div>
          </form>
        ) : (
          <div className="-ms-2 mt-1 flex gap-0.5">
            {!n.owner_reply && <button type="button" onClick={() => setOpen(true)} aria-label={`Reply to ${name}`} title="Reply" className={ACT}><ArrowBendUpLeftIcon size={17} aria-hidden="true" /></button>}
            <button type="button" onClick={() => hide.mutate({ share: l.id, id: n.id, hidden: true })} aria-label="Hide from viewers" title="Hide from viewers" className={ACT}><EyeSlashIcon size={17} aria-hidden="true" /></button>
            <a href={`${origin}/${l.id}${n.variant ? `#/${n.variant}` : ''}`} target="_blank" rel="noreferrer" data-shoot="see-in-design" aria-label="See it in the design" title="See it in the design" className={ACT}><ArrowSquareOutIcon size={17} aria-hidden="true" /></a>
          </div>
        )}
      </div>
    </li>
  )
}

function Comments({ l, origin, fresh, marks }: { l: Link; origin: string; fresh: number; marks: Record<string, number> }) {
  return (
    <section aria-labelledby={`com-${l.id}`}>
      <h2 id={`com-${l.id}`} className="text-[15px] font-semibold">
        Comments <span className="font-normal text-dim">{l.comments.total}{fresh > 0 && `, ${fresh} new`}</span>
      </h2>
      {l.notes.length === 0
        ? <p className="mt-2 text-[13.5px] text-ink2">No comments yet. Viewers can leave one on any design.</p>
        : <ul className="mt-1 divide-y divide-soft">{l.notes.map(n => <Comment key={n.id} n={n} l={l} origin={origin} fresh={isNew(n, l.id, marks)} />)}</ul>}
      {l.comments.total > l.notes.length && <p className="mt-1 text-[12.5px] text-dim">The latest {l.notes.length}. Open the link to see all {l.comments.total} on their designs.</p>}
    </section>
  )
}

function Foot({ l, remove }: { l: Link; remove: () => void }) {
  const setOff = useSetOff()
  return (
    <footer className="flex flex-wrap items-center gap-x-2 gap-y-3 border-t border-soft pt-5">
      <button type="button" data-shoot="off" onClick={() => setOff.mutate({ id: l.id, off: !l.off })} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-white px-3 text-[13px] font-medium hover:bg-side">
        <PowerIcon size={16} aria-hidden="true" />{l.off ? 'Turn on' : 'Turn off'}
      </button>
      <RemoveLink comments={l.comments.total} onRemove={remove} />
      <p className="basis-full text-[12.5px] text-dim">{l.off ? 'Viewers see “This link is turned off”. Turn it on and it is back as it was.' : 'Turn off stops viewers and keeps everything. Remove deletes the page and its comments.'}</p>
    </footer>
  )
}

function Room({ l, me, fresh, marks, enter, back, remove }: {
  l: Link; me: Me; fresh: number; marks: Record<string, number>; enter: boolean; back: () => void; remove: () => void
}) {
  const [scope, animate] = useAnimate<HTMLElement>()
  const reduce = useReducedMotion()
  const title = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    // Only a link picked here fades in; the server's first paint is already in place.
    if (!enter) return
    if (!reduce) animate(scope.current, { opacity: [0, 1] }, { duration: 0.16, ease: 'easeOut' })
    if (!window.matchMedia('(min-width: 768px)').matches) title.current?.focus({ preventScroll: true })
  }, [enter, reduce, animate, scope])
  return (
    <article ref={scope} data-room={l.id} data-off={l.off ? '' : undefined} className="mx-auto max-w-3xl px-5 pt-4 pb-16 sm:px-10 sm:pt-10">
      <button type="button" data-shoot="back" onClick={back} className="-ms-2 mb-3 inline-flex h-9 items-center gap-1 rounded-lg px-2 text-[13px] font-medium text-ink2 hover:bg-tint md:hidden">
        <CaretLeftIcon size={16} aria-hidden="true" />Your links
      </button>
      <p className="text-[12.5px] text-dim">{l.project || 'No project'} · v{l.version}{l.designs ? ` · ${plural(l.designs, 'design')}` : ''} · updated {l.words.updated}</p>
      <h1 ref={title} tabIndex={-1} className="mt-1 text-[22px] font-semibold outline-none">{l.title}</h1>
      <div className="mt-4"><Address l={l} me={me} /></div>
      <div className="mt-7 flex flex-col gap-5"><Card l={l} me={me} /><Numbers l={l} fresh={fresh} /></div>
      <div className="mt-10 space-y-10">
        <Message l={l} />
        <Comments l={l} origin={me.origin} fresh={fresh} marks={marks} />
        <Foot l={l} remove={remove} />
      </div>
    </article>
  )
}

/* ------------------------------------------------------------------ the page */

export function OwnerPage({ me }: { me: Me }) {
  const { data: links = [] } = useQuery({ queryKey: SHARES, queryFn: fetchShares })
  const remove = useRemove()
  const marks = useReadMarks()
  const desktop = useDesktop()
  const wanted = useSearchParams().get('link')
  const [chosen, setChosen] = useState<string | null>(wanted)
  const [entered, setEntered] = useState<string | null>(null)
  const open = !!wanted && links.some(l => l.id === wanted)
  const current = links.find(l => l.id === (open ? wanted : chosen)) ?? links[0]

  // Reading a link's room marks its comments read here, a moment after it opens (as opening a mail).
  const readId = open ? current?.id : undefined
  const readAt = open ? current?.latest : undefined
  useEffect(() => {
    if (!readId || !readAt) return
    const t = setTimeout(() => markRead(readId, readAt), 1200)
    return () => clearTimeout(t)
  }, [readId, readAt])

  const pick = (id: string) => {
    setChosen(id)
    setEntered(id)
    setLinkParam(id)
    if (!desktop) window.scrollTo(0, 0)
  }
  const back = () => {
    const id = current?.id
    setLinkParam(null)
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-row="${id}"]`)?.focus())
  }
  const removeOf = (id: string) => () => {
    const i = links.findIndex(l => l.id === id), rest = links.filter(l => l.id !== id)
    setChosen(rest[Math.min(i, rest.length - 1)]?.id ?? null)
    setLinkParam(null)
    remove.mutate({ id })
  }

  const fresh = links.reduce((n, l) => n + newOf(l, marks), 0)
  const soon = links.filter(l => soonOf(l) && (l.daysLeft ?? 0) > 0).length
  return (
    <div className="flex min-h-dvh flex-col">
      <Header me={me} />
      <div className="flex min-h-0 flex-1">
        <aside aria-label="Your links" className={`w-full shrink-0 border-soft bg-side md:block md:w-[320px] md:border-e ${open ? 'max-md:hidden' : ''}`}>
          <div className="px-5 pt-5 pb-3">
            <h2 className="text-[22px] font-bold">Your links</h2>
            <p className="mt-0.5 text-[12.5px] text-dim">
              {plural(links.length, 'link')} from every project and Mac{fresh > 0 && <>, <span className="text-brand">{fresh} new comments</span></>}{soon > 0 && <>, {soon} expire this week</>}
            </p>
          </div>
          <ul className="space-y-1 px-2 pb-6">
            {links.map(l => <ListRow key={l.id} l={l} fresh={newOf(l, marks)} active={l.id === current?.id} pick={() => pick(l.id)} />)}
          </ul>
          {!links.length && <p className="px-5 pb-8 text-[14px] text-ink2 md:hidden">No live links. Share a prototype from the Share button on its page, and it shows up here.</p>}
        </aside>
        <main className={`min-w-0 flex-1 ${open ? '' : 'max-md:hidden'}`}>
          {current
            ? <Room key={current.id} l={current} me={me} fresh={newOf(current, marks)} marks={marks} enter={entered === current.id} back={back} remove={removeOf(current.id)} />
            : <div className="grid h-full place-items-center p-10 text-center text-[14px] text-ink2">No live links. Share a prototype from the Share button on its page, and it shows up here.</div>}
        </main>
      </div>
    </div>
  )
}
