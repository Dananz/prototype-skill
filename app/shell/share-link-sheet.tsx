// The Share link sheet (spec: Owner: the Share sheet). Two views: New link (what to share, where the
// link opens, a preview, then the link with Copy, Open and its QR code) and Your links (each link of
// this session: changed since shared, Update link, Remove). A dialog on a wide screen, Base UI's
// Drawer on a phone, like the shell's other sheets.
//
// Phase 1 has one open link per share, and commenting needs a GitHub sign-in on the link; passwords,
// people and expiry come in a later phase, as rows under "Who can open it".
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Dialog } from '@base-ui/react/dialog'
import { Drawer } from '@base-ui/react/drawer'
import { uiBox } from './portals'
import { post } from './transport'
import { rtl, t, tn } from './i18n'
import { ago } from './ui'
import { variantLabel } from './variants'
import { captureRoute } from './share-capture'
import { drawQr } from './share-link-qr'
import { VIRTUAL_THRESHOLD } from './virtual'
import { Icon } from './comments/ui'

type P = { id: string; title: string; archived: boolean; screen?: [number, number]; variants: { id: string; name: string }[] }
export type LinkProps = {
  protos: P[]
  /** The prototype and variant the sheet was opened on. */
  proto: string
  variant: string
  /** What is picked to start with: the variant (from its own menu) or its prototype. */
  what: 'variant' | 'proto'
  dark: boolean
  pathOf: (proto: string, variant: string) => string
  onClose: () => void
  returnFocus: () => HTMLElement | null
}
type What = 'variant' | 'proto' | 'all' | 'custom'
type Review = { sizeMiB: number; block: { message: string; where?: string }[]; notes: string[] }
type ShareRow = { id: string; title: string; scope: { protos: { id: string; variants: string[] }[]; start: string }; version: number; publishedAt: string; note?: string; host: string; link: string | null; changed: boolean; comments: { total: number; new: number }; live?: boolean | null }
type Listed = { host: { name: string; stage: string; owner: string } | null; hostError: string | null; shares: ShareRow[]; setup?: string }
type Answer = { status: number; body: Record<string, any> }
type Step = { phase: 'busy' | 'review' | 'blocked' | 'down' | 'error'; review?: Review; error?: string }

async function route(name: string, body: Record<string, unknown> = {}): Promise<Answer> {
  try {
    const res = await post(`share/${name}`, body)
    return { status: res.status, body: await res.json().catch(() => ({})) }
  } catch (e) { return { status: 0, body: { error: e instanceof Error ? e.message : String(e) } } }
}
function copyText(text: string) {
  try { void navigator.clipboard.writeText(text); return } catch { /* not a secure page: the old way */ }
  const el = document.createElement('textarea')
  el.value = text; el.style.position = 'fixed'; el.style.opacity = '0'
  document.body.appendChild(el); el.select()
  try { document.execCommand('copy') } finally { el.remove() }
}
const keyOf = (proto: string, variant: string) => `${proto}/${variant}`

const SMALL = 'text-xs text-zinc-500 dark:text-zinc-400'
const TEXT_BTN = 'inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg px-3 text-xs font-medium text-zinc-700 hover:bg-zinc-900/5 disabled:opacity-40 dark:text-zinc-200 dark:hover:bg-white/10'
const ICON_BTN = 'grid size-9 shrink-0 place-items-center rounded-lg text-zinc-600 hover:bg-zinc-900/5 hover:text-zinc-900 disabled:opacity-40 dark:text-zinc-300 dark:hover:bg-white/10 dark:hover:text-white'
const PRIMARY_BTN = 'inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-proto-primary px-3.5 text-[13px] font-medium text-proto-primary-fg hover:bg-proto-primary-hover disabled:opacity-40'
const SECTION = 'px-1 pb-2 text-[11px] font-medium text-zinc-500 dark:text-zinc-400'

/** A button that says Copied for a moment after it copies. */
function CopyButton({ text, label, icon = true, ...rest }: { text: string; label?: string; icon?: boolean } & Record<string, unknown>) {
  const [done, setDone] = useState(false)
  useEffect(() => { if (!done) return; const id = window.setTimeout(() => setDone(false), 1800); return () => clearTimeout(id) }, [done])
  return (
    <button type="button" {...rest} onClick={() => { copyText(text); setDone(true) }} aria-label={label ? undefined : done ? t('Copied') : t('Copy link')} title={label ? undefined : t('Copy link')}
      className={label ? TEXT_BTN : ICON_BTN}>
      {icon && <Icon name={done ? 'check-simple' : 'copy-simple'} className="size-4" />}{label && (done ? t('Copied') : label)}
    </button>
  )
}

function Spinner() { return <span className="inline-flex animate-spin motion-reduce:animate-none"><Icon name="spinner" className="size-4" /></span> }

/** The start variant as it looks, from the same capture the screenshots use; nothing when it can't be had. */
function Preview({ path, screen, dark }: { path: string; screen?: [number, number]; dark: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const [state, setState] = useState<'wait' | 'ok' | 'none'>('wait')
  const [w, hgt] = screen && screen[0] > 0 && screen[1] > 0 ? screen : [1280, 800]
  useEffect(() => {
    const controller = new AbortController()
    setState('wait')
    const id = window.setTimeout(() => {
      captureRoute(path, { id: 'stage', label: '', w, h: hgt }, dark, controller.signal).then(raw => {
        const out = ref.current
        if (controller.signal.aborted || !out) return
        const scale = Math.min(1, 480 / raw.width, 320 / raw.height)
        out.width = Math.round(raw.width * scale); out.height = Math.round(raw.height * scale)
        out.getContext('2d')!.drawImage(raw, 0, 0, out.width, out.height)
        setState('ok')
      }).catch(() => { if (!controller.signal.aborted) setState('none') })
    }, 250)
    return () => { clearTimeout(id); controller.abort() }
  }, [path, dark, w, hgt])
  if (state === 'none') return null
  return (
    <span data-link-preview className="relative block aspect-[16/10] w-28 shrink-0 overflow-hidden rounded-lg bg-zinc-100 ring-1 ring-black/[.08] dark:bg-zinc-800 dark:ring-white/10">
      <canvas ref={ref} aria-hidden className={`absolute inset-0 size-full object-cover object-top transition-opacity motion-reduce:transition-none ${state === 'ok' ? 'opacity-100' : 'opacity-0'}`} />
    </span>
  )
}

/** The three quick choices: a radio group of segments, with arrow keys that follow the line. */
function Quick({ value, onChange, options }: { value: What; onChange: (w: What) => void; options: { id: What; label: string }[] }) {
  const keys = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === 'ArrowDown' || e.key === (rtl ? 'ArrowLeft' : 'ArrowRight') ? 1 : e.key === 'ArrowUp' || e.key === (rtl ? 'ArrowRight' : 'ArrowLeft') ? -1 : 0
    if (!step) return
    e.preventDefault()
    const i = Math.max(0, options.findIndex(o => o.id === value))
    const next = options[(i + step + options.length) % options.length]
    onChange(next.id)
    e.currentTarget.querySelector<HTMLElement>(`[data-link-what="${next.id}"]`)?.focus()
  }
  return (
    <div role="radiogroup" aria-label={t('What to share')} onKeyDown={keys} className="flex gap-0.5 rounded-xl bg-zinc-900/[.05] p-0.5 dark:bg-white/[.07]">
      {options.map(o => (
        <button key={o.id} type="button" role="radio" aria-checked={value === o.id} tabIndex={value === o.id || (value === 'custom' && o.id === 'proto') ? 0 : -1} data-link-what={o.id} onClick={() => onChange(o.id)}
          className={`h-8 min-w-0 flex-1 truncate rounded-[10px] px-2 text-xs font-medium ${value === o.id ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-white' : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white'}`}>{o.label}</button>
      ))}
    </div>
  )
}

function ReviewBox({ review, blocked, children }: { review: Review; blocked: boolean; children?: ReactNode }) {
  return (
    <div data-link-review className={`space-y-2 rounded-xl p-3 text-xs ${blocked ? 'bg-rose-500/10 text-rose-800 dark:text-rose-200' : 'bg-amber-500/10 text-amber-900 dark:text-amber-100'}`}>
      <p className="flex items-center gap-2 font-medium"><Icon name="warning" className="size-4" />{blocked ? t('This can’t be shared yet') : t('Check before it goes out')}<span className="ms-auto font-normal tabular-nums opacity-70">{t('{size} MiB', { size: review.sizeMiB })}</span></p>
      <ul className="list-disc space-y-1 ps-5">
        {review.block.map((b, i) => <li key={`b${i}`}>{b.message}{b.where && <code dir="ltr" className="ms-1 break-all rounded bg-black/5 px-1 font-mono text-[11px] dark:bg-white/10">{b.where}</code>}</li>)}
        {review.notes.map((n, i) => <li key={`n${i}`}>{n}</li>)}
      </ul>
      {children}
    </div>
  )
}

function Again({ onRetry, busy }: { onRetry: () => void; busy: boolean }) {
  return <button type="button" data-link-retry disabled={busy} onClick={onRetry} className={TEXT_BTN}>{busy ? <Spinner /> : <Icon name="refresh" className="size-4" />}{t('Check again')}</button>
}

/**
 * No host on this Mac (or no token for it): what a link needs, in two lines, and the command (the
 * server's: --local for the host on this Mac, else the online setup).
 */
function NoHost({ onRetry, busy, cmd }: { onRetry: () => void; busy: boolean; cmd: string }) {
  return (
    <div data-link-nohost className="space-y-3 px-1 py-2">
      <p className="text-[13px] font-medium">{t('No share host on this Mac yet')}</p>
      <p className={SMALL}>{t('A link is served by a share host. Ask Claude to set one up, or run this in a terminal:')}</p>
      <div className="flex items-center gap-1 rounded-xl bg-zinc-900/[.05] py-1 pe-1 ps-3 dark:bg-white/[.07]">
        <Icon name="terminal" className="size-4 text-zinc-400" />
        <code dir="ltr" className="min-w-0 flex-1 truncate font-mono text-xs">{cmd}</code>
        <CopyButton text={cmd} label={t('Copy')} icon={false} />
      </div>
      <Again busy={busy} onRetry={onRetry} />
    </div>
  )
}

/** The link once made: read-only with Copy, Open, and its QR code. */
function Made({ link, title }: { link: string; title: string }) {
  const qr = useRef<HTMLCanvasElement>(null)
  useLayoutEffect(() => { if (qr.current) drawQr(qr.current, link) }, [link])
  return (
    <div data-link-made className="space-y-3">
      <p className="flex items-center gap-2 text-[13px] font-medium"><span className="grid size-5 place-items-center rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"><Icon name="check-simple" className="size-3.5" /></span>{t('The link is ready')}</p>
      <div className="flex items-center gap-1 rounded-xl bg-zinc-900/[.05] py-0.5 pe-0.5 ps-1 dark:bg-white/[.07]">
        <input data-link-url readOnly value={link} dir="ltr" aria-label={t('Link to {title}', { title })} onFocus={e => e.currentTarget.select()}
          className="h-9 min-w-0 flex-1 bg-transparent px-2 font-mono text-xs outline-none focus:ring-2 focus:ring-proto-primary-ring rounded-lg" />
        <CopyButton text={link} data-link-copy="" />
        <a data-link-open href={link} target="_blank" rel="noopener noreferrer" aria-label={t('Open the link')} title={t('Open the link')} className={ICON_BTN}><Icon name="open-out" className="size-4" /></a>
      </div>
      <div className="flex items-center gap-4">
        <span className="rounded-xl bg-white p-1.5 ring-1 ring-black/[.08] dark:ring-white/10"><canvas ref={qr} data-link-qr aria-label={t('QR code of the link')} role="img" className="block" /></span>
        <p className={`${SMALL} max-w-56`}>{t('Anyone with the link can view it. To comment, they sign in with GitHub; their comments come back to this page.')}</p>
      </div>
    </div>
  )
}

function Row({ s, protos, hold, onChanged }: { s: ShareRow; protos: P[]; hold: (on: boolean) => void; onChanged: () => void }) {
  const [step, setStep] = useState<Step | null>(null)
  const [ask, setAsk] = useState(false)
  useEffect(() => { if (!ask) return; const id = window.setTimeout(() => setAsk(false), 4000); return () => clearTimeout(id) }, [ask])
  const n = s.scope.protos.reduce((a, x) => a + x.variants.length, 0)
  const names = s.scope.protos.map(x => protos.find(q => q.id === x.id)?.title ?? x.id).join(', ')
  const update = async (yes = false) => {
    setStep({ phase: 'busy' }); hold(true)
    const r = await route('update', { id: s.id, ...(yes ? { yes: true } : {}) }).finally(() => hold(false))
    if (r.status === 200 && r.body.ok) { setStep(null); onChanged() }
    else if (r.status === 200 && r.body.needsYes) setStep({ phase: 'review', review: r.body.review })
    else if (r.status === 422) setStep({ phase: 'blocked', review: r.body.review })
    else setStep({ phase: r.status === 503 ? 'down' : 'error', error: r.body.error || t('The session server answered {status}.', { status: r.status }) })
  }
  const remove = async () => {
    if (!ask) return setAsk(true)
    setAsk(false); setStep({ phase: 'busy' }); hold(true)
    const r = await route('remove', { id: s.id }).finally(() => hold(false))
    if (r.status === 200) onChanged()
    else setStep({ phase: r.status === 503 ? 'down' : 'error', error: r.body.error || t('The session server answered {status}.', { status: r.status }) })
  }
  const busy = step?.phase === 'busy'
  return (
    <li data-link-row={s.id} data-version={s.version} className="rounded-xl border border-black/[.08] p-3 dark:border-white/10">
      <div className="flex min-w-0 items-start gap-2">
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1.5">
            {s.live === true && <span title={t('On the host')} className="size-1.5 shrink-0 rounded-full bg-emerald-500" />}
            <span dir="auto" className="truncate text-[13px] font-medium">{s.title}</span>
          </span>
          <span className={`mt-0.5 block truncate ${SMALL}`}><bdi>{names}</bdi> · {tn(n, '{n} variant', '{n} variants')} · v{s.version} · {t('Updated {when}', { when: ago(Date.parse(s.publishedAt)) })}</span>
          {s.comments.total > 0 && <span className="mt-1 flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-300">{s.comments.new > 0 && <span className="size-1.5 rounded-full bg-sky-500" />}{s.comments.new > 0 ? tn(s.comments.new, '{n} new comment', '{n} new comments') : tn(s.comments.total, '{n} comment', '{n} comments')}</span>}
          {s.live === false && <span className="mt-1 block text-xs text-zinc-500">{t('Not on the host any more')}</span>}
        </span>
        {s.link && <><CopyButton text={s.link} data-link-row-copy="" /><a href={s.link} target="_blank" rel="noopener noreferrer" aria-label={t('Open the link')} title={t('Open the link')} className={ICON_BTN}><Icon name="open-out" className="size-4" /></a></>}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1">
        {s.changed && <span data-link-changed className="me-auto inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-300"><span className="size-1.5 rounded-full bg-amber-500" />{t('Changed since shared')}</span>}
        {!s.changed && <span className="me-auto" />}
        {busy && <span className={`inline-flex items-center gap-1.5 ${SMALL}`}><Spinner />{t('Building and uploading…')}</span>}
        <button type="button" data-link-remove disabled={busy} onClick={() => void remove()} className={`${TEXT_BTN} ${ask ? '!bg-rose-500/10 !text-rose-700 dark:!text-rose-300' : ''}`}>
          {!ask && <Icon name="trash-simple" className="size-4" />}{ask ? (s.comments.total ? tn(s.comments.total, 'Remove it and its {n} comment?', 'Remove it and its {n} comments?') : t('Remove it?')) : t('Remove')}
        </button>
        <button type="button" data-link-update disabled={busy} onClick={() => void update()} title={t('Publish what the variants look like now, at the same link')}
          className={s.changed ? `${TEXT_BTN} !text-proto-primary-soft-fg !font-semibold` : TEXT_BTN}><Icon name="refresh" className="size-4" />{t('Update link')}</button>
      </div>
      {(step?.phase === 'review' || step?.phase === 'blocked') && step.review && (
        <div className="mt-2"><ReviewBox review={step.review} blocked={step.phase === 'blocked'}>
          <div className="flex justify-end gap-1">
            <button type="button" onClick={() => setStep(null)} className={TEXT_BTN}>{t('Cancel')}</button>
            {step.phase === 'review' && <button type="button" data-link-anyway onClick={() => void update(true)} className={PRIMARY_BTN}>{t('Update anyway')}</button>}
          </div>
        </ReviewBox></div>
      )}
      {(step?.phase === 'error' || step?.phase === 'down') && <p role="alert" className="mt-2 text-xs text-rose-700 dark:text-rose-300">{step.phase === 'down' ? t('Can’t reach the share host. Ask Claude to share again (it starts the host), then retry.') : step.error}</p>}
    </li>
  )
}

function Sheet(p: LinkProps & { hold: (on: boolean) => void; phone: boolean; Title: (props: { className: string; children: ReactNode }) => ReactNode; Close: ReactNode }) {
  const live = p.protos.filter(x => !x.archived)
  const here = p.protos.find(x => x.id === p.proto) ?? live[0]
  const all = live.flatMap(x => x.variants.map(v => keyOf(x.id, v.id)))
  const pick = (w: What): string[] => w === 'variant' ? [keyOf(p.proto, p.variant)] : w === 'proto' ? (here?.variants.map(v => keyOf(here.id, v.id)) ?? []) : w === 'all' ? all : []
  const [tab, setTab] = useState<'new' | 'mine'>('new')
  const [listed, setListed] = useState<Listed | null>(null)
  const [listErr, setListErr] = useState('')
  const [loading, setLoading] = useState(false)
  const [what, setWhat] = useState<What>(p.what)
  const [picked, setPicked] = useState<string[]>(() => pick(p.what))
  const [start, setStart] = useState(keyOf(p.proto, p.variant))
  const [open, setOpen] = useState<string[]>(() => [p.proto])
  const [step, setStep] = useState<Step | null>(null)
  const [made, setMade] = useState<{ link: string; title: string } | null>(null)
  const uid = useId()
  const toTab = (id: 'new' | 'mine') => { setTab(id); if (id === 'mine') void load() }
  // Only the latest list answers: an older one arriving late can't put back what a newer one replaced.
  const asked = useRef(0)
  const load = async () => {
    const n = ++asked.current
    setLoading(true)
    const r = await route('list')
    if (n !== asked.current) return
    setLoading(false)
    if (r.status === 200 && Array.isArray(r.body.shares)) { setListed(r.body as Listed); setListErr('') }
    else setListErr(r.body.error || t('The session server answered {status}.', { status: r.status }))
  }
  useEffect(() => { void load() }, [])
  // A review is of the picks it was made for: any change to them asks again (a publish under way keeps them, its fieldset is disabled).
  const changed = () => setStep(s => s?.phase === 'busy' ? s : null)
  const choose = (w: What) => { changed(); setWhat(w); const next = pick(w); setPicked(next); if (w === 'all') setOpen(o => o.includes(p.proto) ? o : [...o, p.proto]) }
  const flip = (k: string) => { changed(); setWhat('custom'); setPicked(a => a.includes(k) ? a.filter(x => x !== k) : [...a, k]) }
  const flipProto = (x: P) => {
    const keys = x.variants.map(v => keyOf(x.id, v.id)), on = keys.every(k => picked.includes(k))
    changed(); setWhat('custom'); setPicked(a => on ? a.filter(k => !keys.includes(k)) : [...a, ...keys.filter(k => !a.includes(k))])
  }
  // The link opens on the variant the sheet was opened on while it is picked, else on the first picked.
  const order = all.filter(k => picked.includes(k))
  const startKey = picked.includes(start) ? start : order[0] ?? ''
  const [startProto, startVariant] = startKey.split('/')
  const startP = p.protos.find(x => x.id === startProto)
  const protosIn = new Set(order.map(k => k.split('/')[0])).size
  // The scope as the CLI takes it, the start first: a prototype picked whole by its slug, so a big session stays short.
  const words = () => {
    if (what === 'all') return { scope: [startKey], all: true }
    const out = [startKey]
    for (const x of live) {
      const keys = x.variants.map(v => keyOf(x.id, v.id)).filter(k => picked.includes(k))
      if (!keys.length) continue
      if (keys.length === x.variants.length) out.push(x.id)
      else out.push(...keys.filter(k => k !== startKey))
    }
    return { scope: out }
  }
  const create = async (yes = false) => {
    if (!startKey) return
    setStep({ phase: 'busy' }); setMade(null)
    p.hold(true)
    const r = await route('publish', { ...words(), ...(yes ? { yes: true } : {}) }).finally(() => p.hold(false))
    if (r.status === 200 && r.body.ok) { setStep(null); setMade({ link: r.body.link, title: r.body.share?.title ?? '' }); void load() }
    else if (r.status === 200 && r.body.needsYes) setStep({ phase: 'review', review: r.body.review })
    else if (r.status === 422) setStep({ phase: 'blocked', review: r.body.review })
    else if (r.status === 409 && (r.body.code === 'no_host' || r.body.code === 'no_token')) { setStep(null); setListed(l => ({ ...(l ?? { hostError: null, shares: [] }), host: null, setup: r.body.setup ?? l?.setup })) }
    else setStep({ phase: r.status === 503 ? 'down' : 'error', error: r.body.error || t('The session server answered {status}.', { status: r.status }) })
  }
  const noHost = !!listed && !listed.host
  const mine = listed?.shares ?? []
  const big = all.length > VIRTUAL_THRESHOLD
  const busy = step?.phase === 'busy'

  const tree = (
    <div role="group" aria-label={t('Prototypes and variants')} className="space-y-1">
      {live.map(x => {
        const keys = x.variants.map(v => keyOf(x.id, v.id)), count = keys.filter(k => picked.includes(k)).length
        // A big session lists the variants of the prototypes opened (or with something picked) only.
        const shown = !big || open.includes(x.id) || (count > 0 && count < keys.length)
        return (
          <div key={x.id} className="rounded-xl">
            <div className="flex h-9 items-center gap-2 rounded-lg px-2 hover:bg-zinc-900/[.03] dark:hover:bg-white/[.04]">
              <input type="checkbox" data-link-proto={x.id} checked={count === keys.length && count > 0} ref={el => { if (el) el.indeterminate = count > 0 && count < keys.length }} onChange={() => flipProto(x)}
                aria-label={t('All of {title}', { title: x.title })} className="size-4 shrink-0 accent-proto-primary" />
              <button type="button" onClick={() => setOpen(o => o.includes(x.id) ? o.filter(i => i !== x.id) : [...o, x.id])} aria-expanded={shown} className="flex min-w-0 flex-1 items-center gap-1.5 text-start">
                <span dir="auto" className="min-w-0 truncate text-[13px] font-medium">{x.title}</span>
                <span className="shrink-0 text-[11px] tabular-nums text-zinc-400">{count ? `${count}/${keys.length}` : keys.length}</span>
                {big && <Icon name={shown ? 'chev' : 'right'} className="ms-auto size-3.5 text-zinc-400" />}
              </button>
            </div>
            {shown && (
              <div className="ms-6 grid grid-cols-1 gap-px sm:grid-cols-2">
                {x.variants.map(v => {
                  const k = keyOf(x.id, v.id)
                  return (
                    <label key={k} className="flex h-9 min-w-0 cursor-pointer items-center gap-2 rounded-lg px-2 hover:bg-zinc-900/[.03] dark:hover:bg-white/[.04]">
                      <input type="checkbox" data-link-variant={k} checked={picked.includes(k)} onChange={() => flip(k)} className="size-4 shrink-0 accent-proto-primary" />
                      <span className="w-5 shrink-0 text-center text-[11px] font-semibold tabular-nums text-zinc-500">{variantLabel(x, v.id)}</span>
                      <span dir="auto" className="min-w-0 truncate text-[13px] text-zinc-700 dark:text-zinc-300">{v.name}</span>
                    </label>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )

  const newView = made ? <Made link={made.link} title={made.title} /> : (
    <fieldset disabled={busy} className="m-0 min-w-0 space-y-5 border-0 p-0">
      <section>
        <h3 className={SECTION}>{t('What to share')}</h3>
        <Quick value={what} onChange={choose} options={[{ id: 'variant', label: t('This variant') }, { id: 'proto', label: t('This prototype') }, { id: 'all', label: t('Everything') }]} />
        <div className="mt-2">{tree}</div>
      </section>
      {startKey && (
        <section>
          <h3 className={SECTION}>{t('Opens on')}</h3>
          <div className="flex items-center gap-3">
            <Preview path={p.pathOf(startProto, startVariant)} screen={startP?.screen} dark={p.dark} />
            <select data-link-start value={startKey} onChange={e => { changed(); setStart(e.target.value) }} aria-label={t('Opens on')}
              className="h-9 min-w-0 flex-1 rounded-lg bg-zinc-900/[.05] px-2 text-[13px] outline-none focus:ring-2 focus:ring-proto-primary-ring dark:bg-white/[.07]">
              {order.map(k => { const [a, b] = k.split('/'), x = p.protos.find(q => q.id === a); return <option key={k} value={k}>{`${x?.title ?? a} · ${variantLabel(x ?? null, b)} ${x?.variants.find(v => v.id === b)?.name ?? ''}`}</option> })}
            </select>
          </div>
        </section>
      )}
      <section>
        <h3 className={SECTION}>{t('Who can open it')}</h3>
        <div className="flex items-start gap-3 rounded-xl bg-zinc-900/[.03] px-3 py-2.5 dark:bg-white/[.04]">
          <Icon name="link-simple" className="mt-0.5 size-4 text-zinc-500" />
          <span className="min-w-0"><span className="block text-[13px] font-medium">{t('Anyone with the link')}</span><span className={`mt-0.5 block ${SMALL}`}>{t('They can view without signing in. To comment, they sign in with GitHub.')}</span></span>
        </div>
      </section>
      {(step?.phase === 'review' || step?.phase === 'blocked') && step.review && (
        <ReviewBox review={step.review} blocked={step.phase === 'blocked'}>
          <div className="flex justify-end gap-1">
            <button type="button" onClick={() => setStep(null)} className={TEXT_BTN}>{t('Back')}</button>
            {step.phase === 'review' && <button type="button" data-link-anyway onClick={() => void create(true)} className={PRIMARY_BTN}>{t('Create link anyway')}</button>}
          </div>
        </ReviewBox>
      )}
      {step?.phase === 'down' && (
        <p data-link-error role="alert" className="flex items-start gap-2 rounded-xl bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-100"><Icon name="warning" className="mt-0.5 size-4" /><span className="min-w-0 flex-1">{t('Can’t reach the share host. Ask Claude to share again (it starts the host), then retry.')}</span></p>
      )}
      {step?.phase === 'error' && <p data-link-error role="alert" className="rounded-xl bg-rose-500/10 px-3 py-2 text-xs text-rose-800 dark:text-rose-200">{step.error}</p>}
    </fieldset>
  )

  const mineView = (
    <div className="space-y-2">
      {listed?.hostError && <p className="flex items-start gap-2 rounded-xl bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-100"><Icon name="warning" className="mt-0.5 size-4" /><span>{t('Can’t reach the share host. What is listed here is this Mac’s copy.')}</span></p>}
      {mine.length ? <ul className="space-y-2">{mine.map(s => <Row key={s.id} s={s} protos={p.protos} hold={p.hold} onChanged={() => void load()} />)}</ul>
        : <p className="px-1 py-6 text-center text-xs text-zinc-400">{t('No links from this session yet.')}</p>}
    </div>
  )

  const tabs = (
    <div role="tablist" aria-label={t('Share link')} className="flex gap-0.5 rounded-xl bg-zinc-900/[.05] p-0.5 dark:bg-white/[.07]"
      onKeyDown={e => {
        const go = e.key === 'Home' ? 'new' : e.key === 'End' ? 'mine' : ['ArrowLeft', 'ArrowRight'].includes(e.key) ? (tab === 'new' ? 'mine' : 'new') : null
        if (!go) return
        e.preventDefault(); toTab(go)
        e.currentTarget.querySelector<HTMLElement>(`[data-link-tab="${go}"]`)?.focus()
      }}>
      {(['new', 'mine'] as const).map(id => (
        <button key={id} type="button" role="tab" id={`${uid}-tab-${id}`} aria-controls={`${uid}-panel`} aria-selected={tab === id} tabIndex={tab === id ? 0 : -1} data-link-tab={id} onClick={() => toTab(id)}
          className={`h-8 min-w-0 flex-1 truncate rounded-[10px] px-2 text-xs font-medium ${tab === id ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-white' : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white'}`}>
          {id === 'new' ? t('New link') : <>{t('Your links')}{mine.length > 0 && <span className="ms-1 tabular-nums opacity-60">{mine.length}</span>}</>}
        </button>
      ))}
    </div>
  )

  const body = !listed && !listErr ? <p className={`flex items-center gap-2 px-1 py-6 ${SMALL}`}><Spinner />{t('Looking for the share host…')}</p>
    : listErr ? <div className="space-y-3 px-1 py-2"><p data-link-error role="alert" className="rounded-xl bg-rose-500/10 px-3 py-2 text-xs text-rose-800 dark:text-rose-200">{listErr}</p><Again busy={loading} onRetry={() => void load()} /></div>
    : noHost ? <NoHost busy={loading} onRetry={() => void load()} cmd={listed?.setup || 'proto share setup'} />
    : tab === 'new' ? newView : mineView

  const footer = !listed || noHost ? null : tab === 'mine' ? null : made ? (
    <div className="flex items-center justify-end gap-1">
      <button type="button" onClick={() => setMade(null)} className={TEXT_BTN}>{t('Make another link')}</button>
      <button type="button" onClick={() => toTab('mine')} className={TEXT_BTN}>{t('Your links')}</button>
    </div>
  ) : (
    <div className="flex items-center gap-3">
      <p role="status" className={`min-w-0 flex-1 truncate ${SMALL}`}>{busy ? <span className="inline-flex items-center gap-1.5"><Spinner />{t('Building and uploading…')}</span> : order.length ? `${tn(order.length, '{n} variant', '{n} variants')} · ${tn(protosIn, '{n} prototype', '{n} prototypes')}` : t('Pick at least one variant')}</p>
      <button type="button" data-link-create disabled={!order.length || busy || step?.phase === 'blocked'} onClick={() => void create(false)} className={PRIMARY_BTN}><Icon name="link-simple" className="size-4" />{t('Create link')}</button>
    </div>
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className={`flex shrink-0 items-center gap-3 ${p.phone ? 'px-4 pb-2 pt-1' : 'px-5 pb-3 pt-4'}`}>
        <span className="min-w-0 flex-1">
          {p.Title({ className: 'block text-[15px] font-semibold', children: t('Share link') })}
          {listed && !noHost && tab === 'new' && !made && order.length > 0 && <span data-link-subtitle className={`mt-0.5 block truncate ${SMALL}`}>{protosIn === 1 ? <><bdi>{p.protos.find(x => x.id === order[0].split('/')[0])?.title}</bdi> · {tn(order.length, '{n} variant', '{n} variants')}</> : `${tn(protosIn, '{n} prototype', '{n} prototypes')} · ${tn(order.length, '{n} variant', '{n} variants')}`}</span>}
        </span>
        {p.Close}
      </header>
      {listed && !noHost && <div className={`shrink-0 ${p.phone ? 'px-4' : 'px-5'} pb-3`}>{tabs}</div>}
      <div data-link-scroll id={`${uid}-panel`} {...(listed && !noHost ? { role: 'tabpanel', 'aria-labelledby': `${uid}-tab-${tab}` } : {})} className={`min-h-0 flex-1 overflow-y-auto overscroll-contain ${p.phone ? 'px-4' : 'px-5'} pb-4`}>{body}</div>
      {footer && <footer className={`shrink-0 border-t border-black/[.07] dark:border-white/10 ${p.phone ? 'px-4 pt-3' : 'px-5 py-3'}`}>{footer}</footer>}
    </div>
  )
}

const BACKDROP = '[--backdrop-opacity:0.3] [--bleed:3rem] dark:[--backdrop-opacity:0.6] fixed inset-0 z-[300] min-h-dvh bg-black opacity-[calc(var(--backdrop-opacity)*(1-var(--drawer-swipe-progress)))] transition-opacity duration-[450ms] ease-[cubic-bezier(0.32,0.72,0,1)] data-swiping:duration-0 data-ending-style:opacity-0 data-starting-style:opacity-0 data-ending-style:duration-[calc(var(--drawer-swipe-strength)*400ms)] motion-reduce:transition-none supports-[-webkit-touch-callout:none]:absolute'
const POPUP = '-mb-[3rem] flex w-full max-h-[calc(88vh+3rem)] flex-col overflow-hidden rounded-t-3xl bg-white pb-[calc(0.75rem+env(safe-area-inset-bottom,0px)+3rem)] pt-2 text-[13px] text-zinc-900 shadow-2xl shadow-black/20 outline-none touch-auto [transform:translateY(var(--drawer-swipe-movement-y))] transition-transform duration-[450ms] ease-[cubic-bezier(0.32,0.72,0,1)] data-swiping:select-none data-ending-style:[transform:translateY(calc(100%-3rem+2px))] data-starting-style:[transform:translateY(calc(100%-3rem+2px))] data-ending-style:duration-[calc(var(--drawer-swipe-strength)*400ms)] motion-reduce:transition-none dark:bg-zinc-900 dark:text-zinc-100'

/** The sheet: a dialog on a wide screen, the phone's bottom drawer on a narrow one. */
export function LinkSheet(p: LinkProps) {
  const [phone] = useState(() => matchMedia('(max-width: 639px)').matches)
  const [open, setOpen] = useState(true)
  // While a link is being built, uploaded or removed, Esc, a press outside and Close leave the sheet up.
  const busy = useRef(0)
  const hold = (on: boolean) => { busy.current = Math.max(0, busy.current + (on ? 1 : -1)) }
  const ask = (o: boolean) => { if (!o && !busy.current) setOpen(false) }
  const done = (o: boolean) => { if (!o) p.onClose() }
  if (phone) return (
    <Drawer.Root open={open} onOpenChange={ask} onOpenChangeComplete={done}>
      <Drawer.Portal container={uiBox()}>
        <Drawer.Backdrop className={BACKDROP} />
        <Drawer.Viewport className="fixed inset-0 z-[300] flex items-end justify-center">
          <Drawer.Popup data-share-link="" data-phone="" finalFocus={p.returnFocus} className={POPUP}>
            <div className="mx-auto mb-1 h-1 w-10 shrink-0 rounded-full bg-zinc-300 dark:bg-zinc-700" />
            <Drawer.Content className="flex min-h-0 flex-1 flex-col">
              <Sheet {...p} hold={hold} phone Title={({ className, children }) => <Drawer.Title className={className}>{children}</Drawer.Title>}
                Close={<Drawer.Close aria-label={t('Close')} className="grid size-9 shrink-0 place-items-center rounded-full text-zinc-500 active:bg-zinc-900/5 dark:active:bg-white/10"><Icon name="x-simple" className="size-4" /></Drawer.Close>} />
            </Drawer.Content>
          </Drawer.Popup>
        </Drawer.Viewport>
      </Drawer.Portal>
    </Drawer.Root>
  )
  return (
    <Dialog.Root open={open} onOpenChange={ask} onOpenChangeComplete={done}>
      <Dialog.Portal container={uiBox()}>
        <Dialog.Backdrop className="fixed inset-0 z-[300] bg-black/30 transition-opacity duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0 motion-reduce:transition-none dark:bg-black/60" />
        <Dialog.Popup data-share-link="" finalFocus={p.returnFocus}
          className="fixed inset-x-0 top-[7vh] z-[301] mx-auto flex max-h-[86vh] w-[min(36rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-black/10 bg-white text-[13px] text-zinc-900 shadow-2xl shadow-black/20 transition-[opacity,scale] duration-200 ease-out data-ending-style:scale-[.98] data-ending-style:opacity-0 data-starting-style:scale-[.98] data-starting-style:opacity-0 motion-reduce:transition-none dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-100">
          <Sheet {...p} hold={hold} phone={false} Title={({ className, children }) => <Dialog.Title className={className}>{children}</Dialog.Title>}
            Close={<Dialog.Close aria-label={t('Close')} className={ICON_BTN}><Icon name="x-simple" className="size-4" /></Dialog.Close>} />
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
