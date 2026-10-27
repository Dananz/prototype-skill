// The "From links" tray: what viewers wrote on this session's share links, at the top of the
// comments list (the island, its side panel and the phone's sheet all draw CommentList). The session
// server polls the host and sends the tray over the Vite websocket (`proto:shares`, app/share/routes.mjs);
// the page asks for it once as it opens and again whenever it gets the focus back.
//
// A viewer's words are untrusted: every field from the host (login, name, body, the element's path)
// is drawn as text, never as HTML. Nothing reaches Claude until the owner presses Send, and then
// it goes through /__proto/share/send, which fences it (the page can never post `from` itself).
import { useEffect, useRef, useState } from 'react'
import { Menu } from '@base-ui/react/menu'
import { uiBox } from '../portals'
import { post } from '../transport'
import { t, tn } from '../i18n'
import { ago } from '../ui'
import { variantLabel } from '../variants'
import { useAgentName, useCtx, type Host } from './ctx'
import { useStore, type Store } from './store'
import { Icon } from './ui'
import type { LinkComment, LinkTray } from './types'

type Result = { id: string; result: 'sent' | 'already_sent' | 'deleted' | 'unknown' | 'ambiguous' | 'error'; error?: string }
type Answer = { tray?: LinkTray; error?: string; results?: Result[]; batch?: string | null; pending?: boolean }

/** One of the tray's routes; the tray it answers with goes straight into the store. */
async function call(store: Store, name: string, body: Record<string, unknown>): Promise<Answer> {
  const res = await post(`share/${name}`, body)
  const data = await res.json().catch(() => ({})) as Answer & LinkTray
  if (!res.ok) throw new Error(data.error || t('The session server answered {status}.', { status: res.status }))
  const tray = name === 'comments' ? data as LinkTray : data.tray
  if (tray && Array.isArray(tray.comments)) store.set({ links: tray })
  return data
}

/** Asks for the tray now, and each time the page comes back into focus. Returns the stop. */
export function watchLinks(store: Store) {
  const ask = () => { void call(store, 'comments', {}).catch(() => { /* the server is away: the next focus asks again */ }) }
  ask()
  window.addEventListener('focus', ask)
  return () => window.removeEventListener('focus', ask)
}

/** What the island's count adds for the tray: comments that are new and not dismissed. */
export const linksNew = (tray?: LinkTray) => tray?.new ?? 0

const routeOf = (variant: string) => { const [slug, letter = ''] = variant.split('/'); return `${slug}/${variantLabel(null, letter)}` }
const STATUS: Record<LinkComment['status'], { label: () => string; cls: string }> = {
  new: { label: () => '', cls: '' },
  sent: { label: () => t('Sent'), cls: 'text-proto-primary-soft-fg' },
  working: { label: () => t('In progress'), cls: 'text-amber-700 dark:text-amber-300' },
  done: { label: () => t('Done'), cls: 'text-emerald-700 dark:text-emerald-400' },
}
const TEXT_BTN = 'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-zinc-600 hover:bg-zinc-900/5 hover:text-zinc-900 disabled:opacity-40 dark:text-zinc-300 dark:hover:bg-white/10 dark:hover:text-white'

/**
 * Opens the variant a comment is on and shows where it is: the element outlined while the viewer's
 * selector still finds it, else a pin where it was ("On v2. It has changed since." when the link
 * has moved on). Both fade after a moment; nothing stays on the design.
 */
function showOn(host: Host, c: LinkComment) {
  const [proto, letter] = c.variant.split('/')
  if (!proto || !letter) return
  host.go(proto, letter)
  const target = c.target
  if (!target) return
  let tries = 0
  const look = () => {
    const mount = host.mount()
    if ((!mount || mount.dataset.route !== `${proto}/${letter}`) && tries++ < 40) return void window.setTimeout(look, 50)
    if (!mount || mount.ownerDocument !== host.layer.ownerDocument) return
    let el: Element | null = null
    // The path is a viewer's: a selector that doesn't parse finds nothing.
    try { el = target.path ? mount.querySelector(target.path) : null } catch { el = null }
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    const L = host.layer.getBoundingClientRect(), M = mount.getBoundingClientRect()
    const mark = document.createElement('div')
    mark.setAttribute('data-link-mark', '')
    mark.style.cssText = 'position:absolute;pointer-events:none;z-index:40;transition:opacity .4s'
    if (el) {
      const r = el.getBoundingClientRect()
      Object.assign(mark.style, { left: `${r.left - L.left - 3}px`, top: `${r.top - L.top - 3}px`, width: `${r.width + 6}px`, height: `${r.height + 6}px`, borderRadius: '8px', boxShadow: '0 0 0 2px #0ea5e9, 0 0 0 6px rgb(14 165 233 / .2)' })
    } else {
      const k = mount.offsetWidth ? M.width / mount.offsetWidth : 1
      Object.assign(mark.style, { left: `${M.left - L.left + target.x * k - 7}px`, top: `${M.top - L.top + target.y * k - 7}px` })
      const dot = document.createElement('span')
      dot.style.cssText = 'display:block;width:14px;height:14px;border-radius:9999px;background:#0ea5e9;box-shadow:0 0 0 3px #fff,0 2px 8px rgb(0 0 0/.3)'
      mark.append(dot)
      if (c.changed) {
        const label = document.createElement('span')
        label.textContent = t('On v{version}. It has changed since.', { version: c.version })
        label.style.cssText = 'position:absolute;top:20px;inset-inline-start:0;white-space:nowrap;border-radius:8px;background:#18181b;color:#fff;padding:3px 8px;font:500 11px/16px system-ui,sans-serif'
        mark.append(label)
      }
    }
    host.layer.append(mark)
    window.setTimeout(() => { mark.style.opacity = '0' }, 2400)
    window.setTimeout(() => mark.remove(), 2900)
  }
  window.setTimeout(look, 60)
}

function Avatar({ c }: { c: LinkComment }) {
  const [broken, setBroken] = useState(false)
  const login = c.author.login
  // The host keeps only avatars from GitHub's own domain (viewer-text.mjs trayRow); anything else is a letter.
  if (c.author.avatar && !broken && c.author.avatar.startsWith('https://avatars.githubusercontent.com/'))
    return <img data-link-avatar src={c.author.avatar} alt="" referrerPolicy="no-referrer" loading="lazy" onError={() => setBroken(true)} className="size-6 shrink-0 rounded-full bg-zinc-200 ring-1 ring-black/10 dark:bg-zinc-700 dark:ring-white/10" />
  return <span data-link-avatar aria-hidden className="grid size-6 shrink-0 place-items-center rounded-full bg-zinc-900/[.06] text-[11px] font-semibold uppercase text-zinc-600 dark:bg-white/10 dark:text-zinc-300">{login.slice(0, 1)}</span>
}

function Card({ c, parent, picked, onPick, busy, run }: { c: LinkComment; parent?: LinkComment; picked: boolean; onPick: (on: boolean) => void; busy: boolean; run: (name: string, body: Record<string, unknown>) => Promise<Answer | null> }) {
  const agent = useAgentName()
  const { host } = useCtx()
  const [replying, setReplying] = useState(false)
  const [text, setText] = useState('')
  const box = useRef<HTMLTextAreaElement>(null)
  useEffect(() => { if (replying) box.current?.focus({ preventScroll: true }) }, [replying])
  const login = c.author.login
  const fresh = c.status === 'new'
  const status = STATUS[c.status]
  const reply = async () => {
    const r = await run('reply', { id: c.id, share: c.share.id, text })
    if (r) { setReplying(false); setText('') }
  }
  return (
    <div data-link-card={c.id} data-shoot="link-card" className={`rounded-2xl border p-3 transition-colors ${picked ? 'border-proto-primary-ring bg-proto-primary-soft/60' : 'border-black/[.08] bg-white dark:border-white/10 dark:bg-zinc-900'} ${c.dismissed ? 'opacity-60' : ''}`}>
      <div className="flex min-w-0 items-center gap-2">
        {fresh && !c.dismissed && <input type="checkbox" data-link-select checked={picked} onChange={e => onPick(e.target.checked)} aria-label={t('Pick the comment from {login}', { login })} className="size-4 shrink-0 accent-proto-primary" />}
        <Avatar c={c} />
        <span dir="auto" className="min-w-0 truncate text-[13px] font-semibold" title={c.author.name ? `${c.author.name} (${login})` : login}>{login}</span>
        <button type="button" data-link-where onClick={() => showOn(host, c)} title={t('Show it on the design')}
          className="inline-flex shrink-0 items-center gap-1 rounded bg-zinc-900/[.05] px-1.5 py-0.5 font-mono text-[10px] text-zinc-600 hover:bg-zinc-900/10 dark:bg-white/10 dark:text-zinc-300 dark:hover:bg-white/15">
          <span dir="ltr">{routeOf(c.variant)}</span><span className="opacity-60">·</span><span>v{c.version}</span>
        </button>
        <span className="ms-auto shrink-0 text-[11px] tabular-nums text-zinc-400">{ago(c.created_at)}</span>
      </div>
      {c.changed && <p data-link-changed className="mt-1.5 text-[11px] text-amber-700 dark:text-amber-300">{t('On v{version}. It has changed since.', { version: c.version })}</p>}
      {c.gone && <p className="mt-1.5 text-[11px] text-zinc-500">{t('No longer in this session')}</p>}
      {c.re && (
        <p data-link-reply-to className="mt-1.5 truncate border-s-2 border-zinc-300 ps-2 text-[11px] text-zinc-500 dark:border-white/15 dark:text-zinc-400">
          {parent ? <>{t('Replying to')} <span dir="auto" data-own-side>{parent.owner_reply ? t('your reply: {text}', { text: parent.owner_reply }) : parent.body}</span></> : t('A reply on the link')}
        </p>
      )}
      <p dir="auto" data-own-side data-link-body className="mt-1.5 whitespace-pre-wrap break-words text-[12.5px] leading-[18px] text-zinc-800 dark:text-zinc-100">{c.body}</p>
      {c.owner_reply && (
        <div className="mt-2 flex justify-end">
          <p className="max-w-[85%] rounded-2xl rounded-se-sm bg-proto-primary-soft px-2.5 py-1.5 text-[11.5px] leading-4 text-zinc-800 ring-1 ring-proto-primary-ring/40 dark:text-zinc-100">
            <span className="mb-0.5 block text-[10px] font-medium text-proto-primary-soft-fg">{t('Your reply, seen on the link')}</span>
            <span dir="auto" data-own-side className="block whitespace-pre-wrap break-words">{c.owner_reply}</span>
          </p>
        </div>
      )}
      {(status.label() || c.hidden) && (
        <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-medium">
          {status.label() && <span className={status.cls}>{status.label()}</span>}
          {c.hidden && <span className="inline-flex items-center gap-1 text-zinc-500"><Icon name="eyeoff" className="size-3.5" />{t('Hidden from the link')}</span>}
        </p>
      )}
      {replying && (
        <div className="mt-2 space-y-1.5">
          <textarea ref={box} data-link-reply-box rows={2} value={text} onChange={e => setText(e.target.value)} dir="auto" maxLength={4000}
            aria-label={t('Reply to {login}', { login })} placeholder={t('Everyone on the link sees this')}
            onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setReplying(false) } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void reply() } }}
            className="block w-full resize-none rounded-xl bg-zinc-900/[.05] px-3 py-2 text-[12.5px] leading-[18px] outline-none placeholder:text-zinc-400 focus:ring-2 focus:ring-proto-primary-ring dark:bg-white/[.08]" />
          <div className="flex justify-end gap-1">
            <button type="button" onClick={() => setReplying(false)} className={TEXT_BTN}>{t('Cancel')}</button>
            <button type="button" data-link-reply-send disabled={busy || (!text.trim() && !c.owner_reply)} onClick={() => void reply()} className={`${TEXT_BTN} !text-proto-primary-soft-fg`}><Icon name="reply-back" className="size-3.5" />{!text.trim() && c.owner_reply ? t('Remove reply') : t('Reply')}</button>
          </div>
        </div>
      )}
      <div className="-mb-1 -me-1 mt-1.5 flex flex-wrap items-center justify-end gap-x-0.5">
        <button type="button" data-link-dismiss disabled={busy} onClick={() => void run('dismiss', { id: c.id, share: c.share.id, ...(c.dismissed ? { off: true } : {}) })} className={TEXT_BTN}>{c.dismissed ? t('Undo dismiss') : t('Dismiss')}</button>
        <button type="button" data-link-hide disabled={busy} onClick={() => void run('hide', { id: c.id, share: c.share.id, ...(c.hidden ? { off: true } : {}) })} title={c.hidden ? t('Show it to everyone on the link again') : t('Take it off the link for viewers; it stays here')} className={TEXT_BTN}>{c.hidden ? t('Unhide') : t('Hide')}</button>
        {!replying && <button type="button" data-link-reply onClick={() => { setText(c.owner_reply ?? ''); setReplying(true) }} className={TEXT_BTN}><span dir="auto" className="max-w-36 truncate">{c.owner_reply ? t('Edit reply') : t('Reply to {login}', { login })}</span></button>}
        {fresh && <button type="button" data-link-send disabled={busy} onClick={() => void run('send', { ids: [c.id], share: c.share.id })} className={`${TEXT_BTN} !font-semibold !text-proto-primary-soft-fg`}><Icon name="send-plane" className="size-3.5" />{t('Send to {agent}', { agent })}</button>}
      </div>
    </div>
  )
}

/** The tray: its header (how many are new, its ⋯), the cards, and Send n once several are picked. */
export function LinksTray() {
  const agent = useAgentName()
  const { store } = useCtx()
  const tray = useStore(store).links
  const [picked, setPicked] = useState<string[]>([])
  const [showDismissed, setShowDismissed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const comments = (tray?.comments ?? []).filter(c => !c.withdrawn && (showDismissed || !c.dismissed))
  // A pick whose comment was sent or went away is no pick.
  useEffect(() => { setPicked(p => p.filter(id => tray?.comments.some(c => c.id === id && c.status === 'new' && !c.dismissed))) }, [tray])
  useEffect(() => { if (!note) return; const id = window.setTimeout(() => setNote(''), 6000); return () => clearTimeout(id) }, [note])
  if (!tray || (!tray.comments.length && !tray.error)) return null
  const run = async (name: string, body: Record<string, unknown>): Promise<Answer | null> => {
    setBusy(true); setNote('')
    try {
      const r = await call(store, name, body)
      if (name === 'send') {
        const late = (r.results ?? []).filter(x => x.result === 'already_sent').length, bad = (r.results ?? []).filter(x => x.result !== 'sent' && x.result !== 'already_sent')
        if (late) setNote(tn(late, 'Already sent from another session.', '{n} were already sent from another session.'))
        else if (bad.length) setNote(bad[0].error || t('Could not send it: {why}.', { why: bad[0].result }))
        const ids = body.ids as string[]
        setPicked(p => p.filter(id => !ids.includes(id)))
      }
      if (r.pending) setNote(t('The share host is away: it goes as soon as it answers.'))
      return r
    } catch (e) { setNote(e instanceof Error ? e.message : String(e)); return null }
    finally { setBusy(false) }
  }
  const share = (ids: string[]) => { const shares = new Set(tray.comments.filter(c => ids.includes(c.id)).map(c => c.share.id)); return shares.size === 1 ? { share: [...shares][0] } : {} }
  return (
    <section data-link-tray aria-label={t('From links')} className="mb-1">
      <h3 className="flex items-center gap-2 px-1 pb-1.5 pt-1 text-xs font-semibold text-sky-700 dark:text-sky-400">
        <Icon name="link-simple" className="size-3.5" />{t('From links')}
        {tray.new > 0 && <span className="rounded-full bg-sky-500/15 px-1.5 text-[11px] font-medium tabular-nums">{t('{n} new', { n: tray.new })}</span>}
        <Menu.Root modal={false}>
          <Menu.Trigger data-link-tray-menu aria-label={t('From links options')} className="ms-auto grid size-7 place-items-center rounded-md text-zinc-500 hover:bg-zinc-900/5 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-white"><Icon name="dots" className="size-4" /></Menu.Trigger>
          <Menu.Portal container={uiBox()}>
            <Menu.Positioner side="bottom" align="end" sideOffset={6} collisionPadding={8} className="z-[260] outline-none">
              <Menu.Popup data-comment-ui="" className="min-w-52 rounded-xl border border-black/10 bg-white p-1 text-[13px] text-zinc-800 shadow-lg outline-none dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-100">
                <Menu.CheckboxItem checked={showDismissed} onCheckedChange={v => setShowDismissed(v)} data-link-show-dismissed className="flex h-9 items-center gap-2.5 rounded-lg px-2 outline-none data-[highlighted]:bg-zinc-900/[.05] dark:data-[highlighted]:bg-white/[.07]">
                  <span className="min-w-0 flex-1">{t('Dismissed')}</span><span className="text-xs tabular-nums text-zinc-400">{tray.dismissed}</span>
                  <span className="w-4">{showDismissed && <Icon name="check-simple" className="size-4" />}</span>
                </Menu.CheckboxItem>
                <Menu.Item onClick={() => void run('comments', { refresh: true })} className="flex h-9 items-center gap-2.5 rounded-lg px-2 outline-none data-[highlighted]:bg-zinc-900/[.05] dark:data-[highlighted]:bg-white/[.07]">
                  <span className="min-w-0 flex-1">{t('Check for new comments')}</span><Icon name="refresh" className="size-4 text-zinc-400" />
                </Menu.Item>
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>
      </h3>
      {tray.error && (
        <p className="mb-2 flex items-start gap-2 rounded-xl bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
          <Icon name="warning" className="mt-0.5 size-3.5" /><span className="min-w-0 flex-1">{t('Can’t reach the share host. Comments arrive once it answers.')}</span>
          <button type="button" onClick={() => void run('comments', { refresh: true })} className="shrink-0 font-medium underline-offset-2 hover:underline">{t('Check again')}</button>
        </p>
      )}
      <div className="space-y-2">
        {comments.map(c => <Card key={`${c.share.id}/${c.id}`} c={c} parent={c.re ? comments.find(p => p.id === c.re && p.share.id === c.share.id) : undefined} busy={busy} run={run} picked={picked.includes(c.id)} onPick={on => setPicked(p => on ? [...p, c.id] : p.filter(x => x !== c.id))} />)}
      </div>
      {note && <p role="status" className="mt-2 px-1 text-xs text-zinc-500">{note}</p>}
      {picked.length > 1 && (
        <div className="sticky bottom-0 z-10 mt-2 flex items-center gap-2 rounded-xl bg-white/95 p-1.5 shadow-[0_-6px_16px_-10px_rgb(0_0_0/.3)] ring-1 ring-black/[.06] backdrop-blur dark:bg-zinc-900/95 dark:ring-white/10">
          <button type="button" onClick={() => setPicked([])} className={TEXT_BTN}>{t('Clear')}</button>
          <button type="button" data-link-send-many disabled={busy} onClick={() => void run('send', { ids: picked, ...share(picked) })}
            className="ms-auto inline-flex h-8 items-center gap-1.5 rounded-md bg-proto-primary px-3 text-xs font-semibold text-proto-primary-fg hover:bg-proto-primary-hover disabled:opacity-60">
            <Icon name="send-plane" className="size-3.5" />{tn(picked.length, 'Send {n} to {agent}', 'Send {n} to {agent}', { agent })}
          </button>
        </div>
      )}
      <div className="mx-1 mt-3 border-t border-black/[.06] dark:border-white/10" />
    </section>
  )
}
