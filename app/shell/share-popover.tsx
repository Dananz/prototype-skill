// The bar's Share popover (spec: the share-popover plan, prototype share-sheet #2): anchored under
// the bar's Share button as Decide's menu is, closed by Esc and a press outside (the shell does both,
// through st.open and data-pop). Three views: signed out of the share host (Sign in with GitHub);
// home (this prototype's link, who is in it now, views and comments, and when it fell behind its
// edits, Update; then the session's other links); and New link (what to share, the message for
// viewers, Create link, then the link). Choose… opens the full Share link sheet.
//
// What the popover holds is kept outside it (held below), so a link being built or updated while it
// is closed carries on, and is there when it opens again. Closed, nothing of it is drawn.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'
import { rtl, t, tn } from './i18n'
import { ago } from './ui'
import { variantLabel } from './variants'
import { Icon } from './comments/ui'
import {
  Again, CopyButton, Gate, ICON_BTN, MESSAGE_MAX, Made, MessageField, NoHost, PRIMARY_BTN, Preview, Quick, ReviewBox, SECTION, SMALL, Spinner, TEXT_BTN,
  keyOf, type P, type Step,
} from './share-link-sheet'
import { isNow, loadList, loadOwner, mustSignIn, nowIn, route, shareState, signedOut, type LinkViewer, type Owner, type ShareRow } from './share-state'

type Pick3 = 'variant' | 'proto' | 'all'
export type PopProps = {
  open: boolean
  /** The bar's Share button, or null while it isn't drawn. */
  anchor: () => HTMLElement | null
  onClose: () => void
  protos: P[]
  /** The prototype on screen and its variant (the first one in its lobby). */
  proto: string
  variant: string
  dark: boolean
  pathOf: (proto: string, variant: string) => string
  /** Choose…: the full Share link sheet, with what is picked and the message so far. */
  onChoose: (what: Pick3, message: string) => void
}

const failed = (r: { status: number; body: Record<string, any> }): Step =>
  ({ phase: r.status === 503 ? 'down' : 'error', error: r.body.error || t('The session server answered {status}.', { status: r.status }) })

/** A GitHub picture, or the first letter of the login when there is none or it doesn't load. */
function Face({ who, size = 20, ring = false, now = false }: { who: { login: string; avatar: string | null }; size?: number; ring?: boolean; now?: boolean }) {
  const [broken, setBroken] = useState<string | null>(null)
  const cls = `inline-grid shrink-0 place-items-center overflow-hidden rounded-full bg-zinc-200 font-semibold text-zinc-600 dark:bg-zinc-700 dark:text-zinc-200 ${ring ? 'ring-2 ring-white dark:ring-zinc-900' : ''}`
  const style = { width: size, height: size, fontSize: Math.round(size * 0.42) }
  return (
    <span className="relative inline-flex shrink-0" title={who.login}>
      {who.avatar && broken !== who.avatar
        ? <img src={who.avatar} alt="" referrerPolicy="no-referrer" style={style} className={cls} onError={() => setBroken(who.avatar)} />
        : <span aria-hidden="true" style={style} className={cls}>{(who.login[0] ?? '?').toUpperCase()}</span>}
      {now && <span className="absolute -bottom-0.5 -end-0.5 size-2 rounded-full bg-emerald-500 ring-2 ring-white dark:ring-zinc-900" />}
    </span>
  )
}

function Faces({ viewers }: { viewers: LinkViewer[] }) {
  if (!viewers.length) return null
  return <span data-pop-faces className="flex -space-x-1.5">{viewers.slice(0, 3).map(v => <Face key={v.login} who={v} ring now={isNow(v)} />)}</span>
}

type Up = { step: Step | null; done: number; note: string }
type Held = { ups: Record<string, Up>; what: Pick3; step: Step | null; made: { link: string; title: string; message?: string } | null }
/** What the popover holds across closing: each link's update, and the New link under way. */
let held: Held = { ups: {}, what: 'proto', step: null, made: null }
const heldSubs = new Set<() => void>()
const hold = (next: Partial<Held>) => { held = { ...held, ...next }; heldSubs.forEach(f => f()) }
const useHeld = () => useSyncExternalStore(f => { heldSubs.add(f); return () => { heldSubs.delete(f) } }, () => held)
const NO_UP: Up = { step: null, done: 0, note: '' }

/** Updating a link: the review when there is something to say, then the new version. */
function useUpdate(s: ShareRow) {
  const up = useHeld().ups[s.id] ?? NO_UP
  const put = (next: Partial<Up>) => hold({ ups: { ...held.ups, [s.id]: { ...(held.ups[s.id] ?? NO_UP), ...next } } })
  const run = async (note: string, yes = false) => {
    put({ step: { phase: 'busy' } })
    const r = await route('update', { id: s.id, ...(note.trim() ? { note: note.trim() } : {}), ...(yes ? { yes: true } : {}) })
    if (r.status === 200 && r.body.ok) { put({ step: null, done: r.body.share?.version ?? s.version + 1, note: '' }); void loadList() }
    else if (r.status === 200 && r.body.needsYes) put({ step: { phase: 'review', review: r.body.review } })
    else if (r.status === 422) put({ step: { phase: 'blocked', review: r.body.review } })
    else put({ step: failed(r) })
  }
  return { step: up.step, setStep: (step: Step | null) => put({ step }), run, done: up.done, busy: up.step?.phase === 'busy', note: up.note, setNote: (note: string) => put({ note }) }
}

function UpdateTrouble({ u, note }: { u: ReturnType<typeof useUpdate>; note: string }) {
  const st = u.step
  if ((st?.phase === 'review' || st?.phase === 'blocked') && st.review) return (
    <ReviewBox review={st.review} blocked={st.phase === 'blocked'}>
      <div className="flex justify-end gap-1">
        <button type="button" onClick={() => u.setStep(null)} className={TEXT_BTN}>{t('Cancel')}</button>
        {st.phase === 'review' && <button type="button" data-link-anyway onClick={() => void u.run(note, true)} className={PRIMARY_BTN}>{t('Update anyway')}</button>}
      </div>
    </ReviewBox>
  )
  if (st?.phase === 'down' || st?.phase === 'error') return <p role="alert" className="text-xs text-rose-700 dark:text-rose-300">{st.phase === 'down' ? t('Can’t reach the share host. Ask Claude to share again (it starts the host), then retry.') : st.error}</p>
  return null
}

/** The link of the prototype on screen: who is in it now, views and comments, and Update when it fell behind. */
function HereCard({ s, protos, routeName, open, dark, pathOf }: { s: ShareRow; protos: P[]; routeName: (r: string | null) => string; open: boolean; dark: boolean; pathOf: PopProps['pathOf'] }) {
  const u = useUpdate(s)
  const note = u.note, setNote = u.setNote
  const now = nowIn(s)
  const viewers = s.viewers ?? []
  const changed = s.changedVariants ?? []
  const counted = changed.filter(c => !c.key.endsWith('/*')).length
  const [startProto, startVariant] = s.scope.start.split('/')
  const startP = protos.find(x => x.id === startProto)
  const nameOf = (key: string, name: string) => {
    const [proto, letter] = key.split('/')
    if (letter === '*') return t('Shared parts')
    return `#${variantLabel(protos.find(x => x.id === proto) ?? null, letter)} ${name}`
  }
  return (
    <section data-pop-here={s.id} data-version={s.version} className="overflow-hidden rounded-xl border border-black/[.08] bg-zinc-900/[.015] dark:border-white/10 dark:bg-white/[.03]">
      <div className="flex items-center gap-3 p-3">
        {open && startVariant && <Preview path={pathOf(startProto, startVariant)} screen={startP?.screen} dark={dark} className="w-[72px]" />}
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1.5 text-[13px] font-semibold"><span dir="auto" className="truncate">{s.title}</span><span className="shrink-0 font-normal text-zinc-500">v{s.version}</span></span>
          {s.link && <span dir="ltr" className="mt-0.5 block truncate text-start font-mono text-[11px] text-zinc-500 dark:text-zinc-400">{s.link.replace(/^https?:\/\//, '')}</span>}
          <span className="mt-1.5 flex min-w-0 items-center gap-2">
            <Faces viewers={viewers} />
            <span data-pop-looking className="min-w-0 truncate text-xs text-zinc-600 dark:text-zinc-300">
              {now.length
                ? <span className="text-emerald-700 dark:text-emerald-300">{t('{name} is looking at {route}', { name: now[0].name || now[0].login, route: routeName(now[0].route) })}</span>
                : viewers[0] ? t('{name} · {when}', { name: viewers[0].name || viewers[0].login, when: ago(viewers[0].at) }) : t('Not opened lately')}
            </span>
          </span>
        </span>
        {s.link && <><CopyButton text={s.link} data-pop-copy="" /><a href={s.link} target="_blank" rel="noopener noreferrer" aria-label={t('Open the link')} title={t('Open the link')} className={ICON_BTN}><Icon name="open-out" className="size-4" /></a></>}
      </div>
      <div className="flex items-center gap-3 border-t border-black/[.06] px-3 py-2 text-xs text-zinc-500 dark:border-white/[.06] dark:text-zinc-400">
        {s.views != null && <span data-pop-views className="inline-flex items-center gap-1"><Icon name="eye" className="size-3.5" />{tn(s.views, '{n} view', '{n} views')}</span>}
        <span className="inline-flex items-center gap-1"><Icon name="chat-circle" className="size-3.5" />{tn(s.comments.total, '{n} comment', '{n} comments')}
          {s.comments.new > 0 && <span data-pop-new className="ms-1 rounded-full bg-sky-500/15 px-1.5 text-[10px] font-semibold text-sky-700 dark:text-sky-300">{tn(s.comments.new, '{n} new', '{n} new')}</span>}
        </span>
      </div>
      {s.changed && !u.done && (
        <div data-pop-behind className="space-y-2.5 border-t border-amber-500/20 bg-amber-500/[.07] p-3">
          <p className="flex items-center gap-2 text-xs font-semibold text-amber-800 dark:text-amber-200"><span className="size-1.5 rounded-full bg-amber-500" />
            {counted ? tn(counted, 'You changed {n} variant since v{v}', 'You changed {n} variants since v{v}', { v: s.version }) : t('You changed it since v{v}', { v: s.version })}
          </p>
          {changed.length > 0 && <ul data-pop-changed className="space-y-0.5 ps-3.5 text-xs text-amber-900/80 dark:text-amber-100/80">{changed.map(c => <li key={c.key} dir="auto">{nameOf(c.key, c.name)}</li>)}</ul>}
          <input data-pop-note value={note} disabled={u.busy} onChange={e => setNote(e.target.value.slice(0, MESSAGE_MAX))} dir="auto" aria-label={t('Tell viewers what changed (optional)')} placeholder={t('Tell viewers what changed (optional)')}
            className="h-9 w-full rounded-lg bg-white/70 px-3 text-xs outline-none placeholder:text-zinc-500 focus:ring-2 focus:ring-amber-500/50 dark:bg-black/25 dark:text-zinc-100" />
          <UpdateTrouble u={u} note={note} />
          <div className="flex items-center justify-end gap-1">
            <span className="me-auto text-[11px] text-amber-900/60 dark:text-amber-100/60">{t('Same link, comments kept')}</span>
            <button type="button" data-pop-update disabled={u.busy} onClick={() => void u.run(note)}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-amber-400 px-3 text-xs font-semibold text-zinc-900 hover:bg-amber-300 disabled:opacity-60">
              {u.busy ? <Spinner /> : <Icon name="refresh" className="size-3.5" />}{u.busy ? t('Updating…') : t('Update to v{n}', { n: s.version + 1 })}
            </button>
          </div>
        </div>
      )}
      {u.done > 0 && <p data-pop-updated role="status" className="border-t border-black/[.06] px-3 py-2 text-xs text-emerald-700 dark:border-white/[.06] dark:text-emerald-300">{t('Updated to v{n}. Viewers are offered the new version.', { n: u.done })}</p>}
    </section>
  )
}

/** One of the session's other links: views, comments, who was in it last, Update when behind, Copy. */
function OtherRow({ s }: { s: ShareRow }) {
  const u = useUpdate(s)
  const last = (s.viewers ?? [])[0]
  const now = nowIn(s)
  return (
    <li data-pop-row={s.id} className="rounded-xl px-2 py-1.5 hover:bg-zinc-900/[.03] dark:hover:bg-white/[.04]">
      <div className="flex min-h-9 items-center gap-2.5">
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1.5"><span dir="auto" className="truncate text-[13px] font-medium">{s.title}</span><span className="shrink-0 text-[11px] text-zinc-500">v{u.done || s.version}</span></span>
          <span className={`flex min-w-0 items-center gap-2 ${SMALL}`}>
            {s.views != null && <span className="inline-flex shrink-0 items-center gap-1"><Icon name="eye" className="size-3" />{s.views}</span>}
            <span className="inline-flex shrink-0 items-center gap-1"><Icon name="chat-circle" className="size-3" />{s.comments.total}</span>
            <span className="min-w-0 truncate">{now.length ? <span className="text-emerald-700 dark:text-emerald-300">{tn(now.length, '{n} looking now', '{n} looking now')}</span> : last ? t('{name} · {when}', { name: last.name || last.login, when: ago(last.at) }) : t('Not opened lately')}</span>
          </span>
        </span>
        {s.changed && !u.done && !u.busy && <button type="button" data-pop-row-update onClick={() => void u.run('')} className="inline-flex h-7 shrink-0 items-center gap-1 rounded-full bg-amber-400/15 px-2.5 text-[11px] font-semibold text-amber-800 hover:bg-amber-400/25 dark:text-amber-200"><Icon name="refresh" className="size-3" />{t('Update')}</button>}
        {u.busy && <Spinner />}
        {s.link && <CopyButton text={s.link} />}
      </div>
      {u.step && u.step.phase !== 'busy' && <div className="mt-1.5"><UpdateTrouble u={u} note="" /></div>}
    </li>
  )
}

function Home({ p, owner, onNew }: { p: PopProps; owner: Owner | undefined; onNew: () => void }) {
  const { listed } = useSyncExternalStore(shareState.subscribe, shareState.get)
  const shares = [...(listed?.shares ?? [])].sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
  const here = shares.find(s => s.scope.protos.some(x => x.id === p.proto))
  const others = shares.filter(s => s !== here)
  const routeName = (r: string | null) => {
    if (!r) return t('the link')
    const [proto, v] = r.split('/'), x = p.protos.find(q => q.id === proto)
    const name = x?.variants.find(q => q.id === v)?.name
    return name ? `#${variantLabel(x!, v)} ${name}` : r
  }
  return (
    <>
      <header className="flex shrink-0 items-center gap-2.5 px-4 pb-2 pt-3.5">
        {owner?.login && <Face who={{ login: owner.login, avatar: owner.avatar }} size={22} />}
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{t('Share')}{owner?.login && <span className="ms-1.5 font-normal text-zinc-500">{t('as {login}', { login: owner.login })}</span>}</span>
        <button type="button" data-pop-new-link onClick={onNew} className={`${TEXT_BTN} !px-2.5`}><Icon name="plus" className="size-3.5" />{t('New link')}</button>
      </header>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-3 pb-3">
        {listed?.hostError && <p className="flex items-start gap-2 rounded-xl bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-100"><Icon name="warning" className="mt-0.5 size-4" /><span>{t('Can’t reach the share host. What is listed here is this Mac’s copy.')}</span></p>}
        {here
          ? <HereCard key={here.id} s={here} protos={p.protos} routeName={routeName} open={p.open} dark={p.dark} pathOf={p.pathOf} />
          : (
            <div data-pop-none className="flex items-center gap-3 rounded-xl border border-dashed border-black/10 px-3 py-3 dark:border-white/15">
              <Icon name="link-simple" className="size-4 text-zinc-400" />
              <span className={`min-w-0 flex-1 ${SMALL}`}>{t('This prototype has no link yet.')}</span>
              <button type="button" onClick={onNew} className={`${TEXT_BTN} !h-8`}>{t('Make one')}</button>
            </div>
          )}
        {others.length > 0 && (
          <section>
            <h3 className={`${SECTION} px-2 pt-1`}>{here ? t('Your other links') : t('Your links')}</h3>
            <ul>{others.map(s => <OtherRow key={s.id} s={s} />)}</ul>
          </section>
        )}
      </div>
    </>
  )
}

function NewLink({ p, onBack, message, setMessage }: { p: PopProps; onBack: () => void; message: string; setMessage: (m: string) => void }) {
  const { what, step, made } = useHeld()
  const setWhat = (w: Pick3) => hold({ what: w }), setStep = (st: Step | null) => hold({ step: st }), setMade = (m: Held['made']) => hold({ made: m })
  const here = p.protos.find(x => x.id === p.proto)
  const live = p.protos.filter(x => !x.archived)
  const start = keyOf(p.proto, p.variant)
  const v = here?.variants.find(x => x.id === p.variant)
  const n = what === 'variant' ? 1 : what === 'proto' ? here?.variants.length ?? 0 : live.reduce((a, x) => a + x.variants.length, 0)
  const busy = step?.phase === 'busy'
  const choose = (w: Pick3) => { if (!busy) { setWhat(w); setStep(null) } }
  const create = async (yes = false) => {
    setStep({ phase: 'busy' })
    const said = message.trim().slice(0, MESSAGE_MAX)
    const scope = what === 'all' ? { scope: [start], all: true } : what === 'proto' ? { scope: [start, p.proto] } : { scope: [start] }
    const r = await route('publish', { ...scope, ...(said ? { message: said } : {}), ...(yes ? { yes: true } : {}) })
    if (r.status === 200 && r.body.ok) { setStep(null); setMade({ link: r.body.link, title: r.body.share?.title ?? '', message: said || undefined }); setMessage(''); void loadList() }
    else if (r.status === 200 && r.body.needsYes) setStep({ phase: 'review', review: r.body.review })
    else if (r.status === 422) setStep({ phase: 'blocked', review: r.body.review })
    else if (r.status === 409 && r.body.code === 'sign_in') { setStep(null); signedOut() }
    else if (r.status === 409 && (r.body.code === 'no_host' || r.body.code === 'no_token')) { setStep(null); void loadList() }
    else setStep(failed(r))
  }
  return (
    <>
      <header className="flex shrink-0 items-center gap-1 px-2 pb-2 pt-2.5">
        <button type="button" data-pop-back onClick={onBack} aria-label={t('Back')} title={t('Back')} className={ICON_BTN}><Icon name="left" className="size-4" /></button>
        <span className="text-[13px] font-semibold">{t('New link')}</span>
      </header>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 pb-3">
        {made ? <Made link={made.link} title={made.title} message={made.message} /> : (
          <fieldset disabled={busy} className="m-0 min-w-0 space-y-4 border-0 p-0">
            <section>
              <h3 className={SECTION}>{t('What to share')}</h3>
              <Quick value={what} onChange={w => choose(w as Pick3)} options={[{ id: 'variant', label: t('This variant') }, { id: 'proto', label: t('This prototype') }, { id: 'all', label: t('Everything') }]} />
              <p className={`mt-2 flex items-center gap-2 px-1 ${SMALL}`}>
                <span data-pop-opens className="min-w-0 flex-1 truncate">{t('Opens on {label}', { label: `${here?.title ?? p.proto} · ${variantLabel(here ?? null, p.variant)} ${v?.name ?? ''}`.trim() })}</span>
                <button type="button" data-pop-choose onClick={() => p.onChoose(what, message)} className="shrink-0 text-zinc-700 underline-offset-2 hover:underline dark:text-zinc-300">{t('Choose…')}</button>
              </p>
            </section>
            <section>
              <h3 className={SECTION}>{t('Message for viewers')}</h3>
              <MessageField value={message} onChange={setMessage} />
            </section>
            {(step?.phase === 'review' || step?.phase === 'blocked') && step.review && (
              <ReviewBox review={step.review} blocked={step.phase === 'blocked'}>
                <div className="flex justify-end gap-1">
                  <button type="button" onClick={() => setStep(null)} className={TEXT_BTN}>{t('Back')}</button>
                  {step.phase === 'review' && <button type="button" data-link-anyway onClick={() => void create(true)} className={PRIMARY_BTN}>{t('Create link anyway')}</button>}
                </div>
              </ReviewBox>
            )}
            {(step?.phase === 'down' || step?.phase === 'error') && <p data-link-error role="alert" className="rounded-xl bg-rose-500/10 px-3 py-2 text-xs text-rose-800 dark:text-rose-200">{step.phase === 'down' ? t('Can’t reach the share host. Ask Claude to share again (it starts the host), then retry.') : step.error}</p>}
          </fieldset>
        )}
      </div>
      {made ? (
        <footer className="flex shrink-0 items-center justify-end gap-1 border-t border-black/[.07] px-4 py-3 dark:border-white/10">
          <button type="button" onClick={() => setMade(null)} className={TEXT_BTN}>{t('Make another link')}</button>
          <button type="button" onClick={onBack} className={TEXT_BTN}>{t('Your links')}</button>
        </footer>
      ) : (
        <footer className="flex shrink-0 items-center gap-3 border-t border-black/[.07] px-4 py-3 dark:border-white/10">
          <p role="status" className={`min-w-0 flex-1 truncate ${SMALL}`}>{busy ? <span className="inline-flex items-center gap-1.5"><Spinner />{t('Building and uploading…')}</span> : `${tn(n, '{n} variant', '{n} variants')} · ${t('anyone with the link')}`}</p>
          <button type="button" data-link-create disabled={!n || busy || step?.phase === 'blocked' || step?.phase === 'review'} onClick={() => void create(false)} className={PRIMARY_BTN}><Icon name="link-simple" className="size-4" />{t('Create link')}</button>
        </footer>
      )}
    </>
  )
}

function SharePop(p: PopProps) {
  const s = useSyncExternalStore(shareState.subscribe, shareState.get)
  const [view, setView] = useState<'home' | 'new'>('home')
  const [message, setMessage] = useState('')
  const [, redraw] = useState(0)
  const box = useRef<HTMLDivElement>(null)
  // Opening asks who the owner is and the links now; it also brings the focus in, for the keyboard.
  useEffect(() => {
    if (!p.open) return
    void loadOwner(); void loadList()
    requestAnimationFrame(() => { if (!box.current?.contains(document.activeElement)) box.current?.focus({ preventScroll: true }) })
    const f = () => redraw(n => n + 1)
    addEventListener('resize', f)
    return () => removeEventListener('resize', f)
  }, [p.open])
  // Closed with the focus in it, or lost with a view that went (a link made), the focus goes back to Share.
  const was = useRef(false)
  useEffect(() => {
    if (was.current && !p.open) {
      const a = document.activeElement
      if (!a || a === document.body || box.current?.contains(a)) p.anchor()?.focus({ preventScroll: true })
      // It opens on home again, unless a link is being made (then it opens on it, made or not).
      if (held.step?.phase !== 'busy') { setView('home'); hold({ made: null, step: null }) }
    }
    was.current = p.open
  }, [p.open])
  const at = p.open ? p.anchor()?.getBoundingClientRect() : null
  const shown = !!at
  const place = at ? (rtl ? { top: at.bottom + 6, left: Math.max(8, at.left) } : { top: at.bottom + 6, right: Math.max(8, innerWidth - at.right) }) : undefined
  const listed = s.listed
  const body = listed?.host && mustSignIn(s.owner) ? <div className="p-4"><Gate signin={s.owner?.signin !== false} /></div>
    : !listed && !s.listErr ? <p className={`flex items-center gap-2 px-4 py-6 ${SMALL}`}><Spinner />{t('Looking for the share host…')}</p>
    : !listed ? <div className="space-y-3 p-4"><p data-link-error role="alert" className="rounded-xl bg-rose-500/10 px-3 py-2 text-xs text-rose-800 dark:text-rose-200">{s.listErr}</p><Again busy={s.loading} onRetry={() => void loadList()} /></div>
    : !listed.host ? <div className="p-3"><NoHost busy={s.loading} onRetry={() => void loadList()} cmd={listed.setup || 'proto share setup'} /></div>
    : view === 'new' ? <NewLink p={p} onBack={() => setView('home')} message={message} setMessage={setMessage} />
    : <Home p={p} owner={s.owner} onNew={() => setView('new')} />
  // Closed, it is an empty hidden box (what it holds is kept above for the next open).
  return (
    <div ref={box} {...(shown ? { 'data-pop': '' } : {})} data-share-pop={shown ? 'open' : 'closed'} role="dialog" aria-label={t('Share')} tabIndex={-1} hidden={!shown}
      onClick={e => e.stopPropagation()}
      className="fixed z-40 flex max-h-[min(48rem,calc(100dvh-5rem))] w-[min(26rem,calc(100vw-1rem))] flex-col overflow-hidden rounded-2xl border border-black/10 bg-white text-[13px] text-zinc-900 shadow-xl shadow-black/10 outline-none dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-100"
      style={place}>
      {shown && body}
    </div>
  )
}

/** Mounts the popover into el; each call draws it with new props (open or closed). */
export function mountSharePop(el: HTMLElement) {
  const root = createRoot(el)
  return (props: PopProps) => root.render(<SharePop {...props} />)
}
