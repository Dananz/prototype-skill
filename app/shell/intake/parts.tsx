import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Icon } from './icons'
import type { Answers, Attach, Files, IntakeOption, IntakeQuestion } from './types'
import { t, tn } from '../i18n'

/** What a question's controls read and write. */
export type Api = {
  answers: Answers
  files: Files
  toggle: (q: IntakeQuestion, id: string) => void
  add: (q: IntakeQuestion, text: string) => void
  setText: (q: IntakeQuestion, v: string) => void
  decide: (q: IntakeQuestion) => void
  decided: (q: IntakeQuestion) => boolean
  addFiles: (key: string, list: File[]) => void
  removeFile: (key: string, id: string) => void
}

const card = (on: boolean) =>
  `group relative flex flex-col justify-start rounded-2xl border bg-white p-1.5 text-start transition-[border-color,box-shadow] dark:bg-zinc-900 ${on ? 'border-proto-primary shadow-[0_0_0_3px_var(--proto-primary-soft)]' : 'border-black/10 hover:border-black/25 dark:border-white/10 dark:hover:border-white/25'}`
const chip = (on: boolean) =>
  `flex min-h-9 items-center gap-2 rounded-full border px-3.5 text-[13px] transition-colors ${on ? 'border-proto-primary bg-proto-primary-soft text-proto-primary-soft-fg' : 'border-black/10 bg-white text-zinc-700 hover:border-black/20 dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:border-white/25'}`
const checkDot = <span className="absolute -end-1.5 -top-1.5 grid size-5 place-items-center rounded-full bg-proto-primary text-white ring-2 ring-white dark:ring-zinc-950"><Icon name="check" size={11} /></span>

/* ---- the small demonstration on an option: the agent's html (160 by 120) or an image ---- */
function Demo({ demo }: { demo: NonNullable<IntakeOption['demo']> }) {
  const ref = useRef<HTMLDivElement>(null)
  const [k, setK] = useState(1)
  useLayoutEffect(() => {
    const el = ref.current!
    const ro = new ResizeObserver(() => setK(el.clientWidth / 160 || 1))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return (
    <div ref={ref} className="relative aspect-[4/3] w-full overflow-hidden rounded-lg border border-black/10 bg-zinc-50 dark:border-white/10">
      {demo.image
        ? <img src={`/${demo.image}`} alt="" className="size-full object-cover" />
        : <div className="absolute start-0 top-0 h-[120px] w-[160px] origin-top-left overflow-hidden" style={{ transform: `scale(${k})` }} dangerouslySetInnerHTML={{ __html: demo.html ?? '' }} />}
    </div>
  )
}

/* ---- "Let Claude decide": a ghost link that shows its state once used ---- */
export function DecideButton({ q, st }: { q: IntakeQuestion; st: Api }) {
  const on = st.decided(q)
  return (
    <button type="button" aria-pressed={on} onClick={() => st.decide(q)}
      className={`flex h-9 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[13px] font-medium transition-colors hover:underline hover:underline-offset-4 ${on ? 'text-proto-primary-soft-fg' : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100'}`}>
      <Icon name={on ? 'sparkleFill' : 'sparkle'} size={14} />{on ? t('Claude will decide') : t('Let Claude decide')}
    </button>
  )
}

/* ---- the user's own answer ---- */
function OwnChips({ q, st }: { q: IntakeQuestion; st: Api }) {
  const [open, setOpen] = useState(false)
  const [v, setV] = useState('')
  const mine = (st.answers[q.id] ?? []).filter(x => x.startsWith('+'))
  const submit = () => { st.add(q, v); setV(''); if (q.kind === 'one') setOpen(false) }
  return (
    <>
      {mine.map(id => <button key={id} type="button" aria-pressed onClick={() => st.toggle(q, id)} className={chip(true)} title={t('Remove')}>{id.slice(1)}<Icon name="x" size={12} /></button>)}
      {open ? (
        <form onSubmit={e => { e.preventDefault(); submit() }} className="flex h-9 items-center rounded-full border border-proto-primary bg-white ps-3.5 pe-1 dark:bg-zinc-900">
          <input autoFocus value={v} onChange={e => setV(e.target.value)} onBlur={() => !v && setOpen(false)} maxLength={80} placeholder={q.kind === 'one' ? t('Your own answer') : t('Type one, press Enter')}
            className="w-44 bg-transparent text-[13px] text-zinc-900 placeholder:text-zinc-400 focus-visible:outline-none dark:text-zinc-100" />
          <button type="submit" disabled={!v.trim()} aria-label={t('Add')} className="grid size-7 place-items-center rounded-full bg-proto-primary text-white disabled:opacity-30"><Icon name="check" size={13} /></button>
        </form>
      ) : (
        <button type="button" onClick={() => setOpen(true)} className="flex min-h-9 items-center gap-1.5 rounded-full border border-dashed border-black/20 px-3.5 text-[13px] text-zinc-500 hover:border-black/40 hover:text-zinc-800 dark:border-white/25 dark:hover:border-white/50 dark:hover:text-zinc-200">
          <Icon name="plus" size={13} />{mine.length || q.kind === 'one' ? t('Something else') : t('Add your own')}
        </button>
      )}
    </>
  )
}

function OwnCard({ q, st }: { q: IntakeQuestion; st: Api }) {
  const [editing, setEditing] = useState(false)
  const [v, setV] = useState('')
  const mine = (st.answers[q.id] ?? []).find(x => x.startsWith('+'))
  const on = !!mine
  const submit = () => { st.add(q, v); setV(''); setEditing(false) }
  return (
    <div role="button" tabIndex={0} aria-pressed={on}
      onClick={() => { if (editing) return; if (mine) st.toggle(q, mine); else setEditing(true) }}
      onKeyDown={e => { if (!editing && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); if (mine) st.toggle(q, mine); else setEditing(true) } }}
      className={`${card(on)} cursor-pointer`}>
      <div className={`relative grid aspect-[4/3] w-full place-items-center overflow-hidden rounded-lg border ${on ? 'border-transparent bg-proto-primary-soft' : 'border-dashed border-black/20 bg-zinc-50 dark:border-white/20 dark:bg-zinc-800/50'}`}>
        {editing ? (
          <>
            <textarea autoFocus value={v} onChange={e => setV(e.target.value)} maxLength={120} placeholder={t('Your own answer')} onBlur={() => !v.trim() && setEditing(false)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() } if (e.key === 'Escape') { e.stopPropagation(); setEditing(false) } }}
              className="size-full resize-none bg-transparent p-2.5 text-[13px] leading-snug text-zinc-900 placeholder:text-zinc-400 focus-visible:outline-none dark:text-zinc-100" />
            <button type="button" disabled={!v.trim()} aria-label={t('Use this answer')} onMouseDown={e => e.preventDefault()} onClick={e => { e.stopPropagation(); submit() }}
              className="absolute bottom-1.5 end-1.5 grid size-6 place-items-center rounded-full bg-proto-primary text-white disabled:opacity-30"><Icon name="check" size={12} /></button>
          </>
        ) : on ? <span className="line-clamp-4 px-3 text-center text-[13px] font-medium leading-snug text-proto-primary-soft-fg">{mine!.slice(1)}</span>
          : <Icon name="plus" size={20} className="text-zinc-400 transition-colors group-hover:text-zinc-600" />}
      </div>
      <div className="px-1 pb-0.5 pt-1.5 text-xs font-medium leading-snug">{t('Something else')}</div>
      {on && checkDot}
    </div>
  )
}

/* ---- files: each option is its own drop target, and "Anything else" catches the rest ---- */
const PREVIEW_H = 300
/** Opens below when there is no room above, inside the tightest clipping ancestor of the host. */
function opensBelow(el: HTMLElement, host: HTMLElement) {
  const r = el.getBoundingClientRect()
  let top = 0, bottom = window.innerHeight
  for (let p = host.parentElement; p; p = p.parentElement) {
    if (getComputedStyle(p).overflowY === 'visible') continue
    const b = p.getBoundingClientRect()
    top = Math.max(top, b.top); bottom = Math.min(bottom, b.bottom)
  }
  const above = r.top - top, below = bottom - r.bottom
  return above < PREVIEW_H && below > above
}

function Tile({ f, size }: { f: Attach; size: number }) {
  return (
    <div style={{ width: size, height: size }} className="grid shrink-0 place-items-center overflow-hidden rounded-xl border border-black/10 bg-zinc-100 dark:border-white/10 dark:bg-zinc-800">
      {!f.type.startsWith('image/') ? <Icon name="fileText" size={size * 0.4} className="text-zinc-400" />
        : f.thumb ? <img src={f.thumb} alt={f.name} className="size-full object-cover" />
        : <div className="size-full animate-pulse bg-zinc-200 dark:bg-zinc-700" />}
    </div>
  )
}

type Peek = { show: (f: Attach, el: HTMLElement) => void; hide: () => void }

function Target({ q, o, st, peek }: { q: IntakeQuestion; o: IntakeOption; st: Api; peek: Peek }) {
  const key = `${q.id}:${o.id}`
  const files = st.files[key] ?? []
  const on = (st.answers[q.id] ?? []).includes(o.id)
  const canTake = o.files !== false
  const [over, setOver] = useState(false)
  const pick = useRef<HTMLInputElement>(null)
  const take = (list: File[]) => { if (!list.length) return; st.addFiles(key, list); if (!on) st.toggle(q, o.id) }
  return (
    <div onClick={e => { if (!(e.target as HTMLElement).closest('button, input, ul')) st.toggle(q, o.id) }}
      onDragOver={canTake ? e => { e.preventDefault(); setOver(true) } : undefined} onDragLeave={() => setOver(false)}
      onDrop={canTake ? e => { e.preventDefault(); setOver(false); take([...e.dataTransfer.files]) } : undefined}
      className={`relative cursor-pointer rounded-2xl border p-3 transition-[border-color,box-shadow,background-color] ${over ? 'border-proto-primary bg-proto-primary-soft shadow-[0_0_0_3px_var(--proto-primary-soft)]' : on ? 'border-proto-primary bg-white shadow-[0_0_0_3px_var(--proto-primary-soft)] dark:bg-zinc-900' : 'border-black/10 bg-white dark:border-white/10 dark:bg-zinc-900'}`}>
      <div className="flex items-center gap-3">
        <button type="button" aria-pressed={on} aria-label={t('Tick {label}', { label: o.label })} onClick={() => st.toggle(q, o.id)}
          className={`grid size-9 shrink-0 place-items-center rounded-xl transition-colors ${on ? 'bg-proto-primary text-white' : 'bg-black/5 text-zinc-500 hover:bg-black/10 dark:bg-white/10'}`}>
          {on ? <Icon name="check" size={18} /> : <Icon name="plus" size={18} />}
        </button>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium">{o.label}</div>
          <div className="truncate text-xs text-zinc-500">
            {over ? t('Drop to add') : files.length ? tn(files.length, '{n} file', '{n} files') : on ? (canTake ? t('Ticked, no file yet') : t('Ticked')) : canTake ? t('Drop a file here') : t('Tap to tick')}
          </div>
        </div>
        {canTake && (
          <>
            <button type="button" aria-label={t('Add a file for {label}', { label: o.label })} onClick={() => pick.current?.click()} className="grid size-8 shrink-0 place-items-center rounded-full text-zinc-500 hover:bg-black/5 dark:hover:bg-white/10"><Icon name="upload" size={16} /></button>
            <input ref={pick} type="file" multiple hidden onChange={e => { take([...(e.target.files ?? [])]); e.target.value = '' }} />
          </>
        )}
      </div>
      {files.length > 0 && (
        <ul className="mt-3 flex gap-2 overflow-x-auto px-0.5 pb-1 pt-1.5 [scrollbar-width:thin]" aria-label={t('{label} files', { label: o.label })}>
          {files.map(f => (
            <li key={f.id} tabIndex={f.thumb ? 0 : undefined} className="relative shrink-0 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-proto-primary-ring"
              onMouseEnter={e => f.thumb && peek.show(f, e.currentTarget)} onMouseLeave={peek.hide} onFocus={e => f.thumb && peek.show(f, e.currentTarget)} onBlur={peek.hide}>
              <Tile f={f} size={52} />
              <button type="button" aria-label={t('Remove {name}', { name: f.name })} onClick={() => st.removeFile(key, f.id)}
                className="absolute -end-1.5 -top-1.5 grid size-5 place-items-center rounded-full bg-zinc-900 text-white ring-2 ring-white dark:bg-white dark:text-zinc-900 dark:ring-zinc-950"><Icon name="x" size={10} /></button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Targets({ q, st }: { q: IntakeQuestion; st: Api }) {
  const key = `${q.id}:other`
  const other = st.files[key] ?? []
  const [over, setOver] = useState(false)
  const pick = useRef<HTMLInputElement>(null)
  const root = useRef<HTMLDivElement>(null)
  const [look, setLook] = useState<{ f: Attach; x: number; y: number; h: number; below: boolean } | null>(null)
  const peek: Peek = {
    show: (f, el) => {
      const r = el.getBoundingClientRect(), o = root.current!.getBoundingClientRect()
      const k = o.width / root.current!.offsetWidth || 1
      setLook({ f, x: (r.left - o.left + r.width / 2) / k, y: (r.top - o.top) / k, h: r.height / k, below: opensBelow(el, root.current!) })
    },
    hide: () => setLook(null),
  }
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) return
      const f = [...(e.clipboardData?.files ?? [])]
      if (f.length) { e.preventDefault(); st.addFiles(key, f) }
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  })
  const on = other.length > 0
  return (
    <div ref={root} className="relative @container">
      <div className="grid grid-cols-1 gap-2.5 @md:grid-cols-2">{q.options!.map(o => <Target key={o.id} q={q} o={o} st={st} peek={peek} />)}</div>
      <div role="button" tabIndex={0} onClick={() => pick.current?.click()} onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), pick.current?.click())}
        onDragOver={e => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)} onDrop={e => { e.preventDefault(); setOver(false); st.addFiles(key, [...e.dataTransfer.files]) }}
        className={`mt-2.5 flex cursor-pointer items-center gap-3 rounded-2xl border-2 px-4 py-3 transition-[border-color,box-shadow,background-color] ${over ? 'border-dashed border-proto-primary bg-proto-primary-soft' : on ? 'border-solid border-proto-primary bg-white shadow-[0_0_0_3px_var(--proto-primary-soft)] dark:bg-zinc-900' : 'border-dashed border-black/15 hover:border-black/30 dark:border-white/15 dark:hover:border-white/30'}`}>
        <span className={`grid size-9 shrink-0 place-items-center rounded-xl transition-colors ${on ? 'bg-proto-primary text-white' : 'bg-black/5 text-zinc-500 dark:bg-white/10'}`}>{on ? <Icon name="check" size={18} /> : <Icon name="plus" size={18} />}</span>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium">{t('Anything else')}</div>
          <div className="truncate text-xs text-zinc-500">{on ? tn(other.length, '{n} file. Drop or paste more.', '{n} files. Drop or paste more.') : t('A site they like, a menu, a sketch. Drop or paste it here.')}</div>
        </div>
        <ul className="flex -space-x-2" aria-label={t('Other files')}>
          {other.slice(0, 4).map(f => (
            <li key={f.id} tabIndex={f.thumb ? 0 : undefined} onClick={e => e.stopPropagation()}
              onMouseEnter={e => f.thumb && peek.show(f, e.currentTarget)} onMouseLeave={peek.hide} onFocus={e => f.thumb && peek.show(f, e.currentTarget)} onBlur={peek.hide}
              className="rounded-xl ring-2 ring-white focus-visible:outline-none focus-visible:ring-proto-primary-ring dark:ring-zinc-950"><Tile f={f} size={32} /></li>
          ))}
        </ul>
        <input ref={pick} type="file" multiple hidden onChange={e => { st.addFiles(key, [...(e.target.files ?? [])]); e.target.value = '' }} />
      </div>
      {look && (() => {
        const w = root.current?.offsetWidth ?? 0
        const left = Math.min(Math.max(look.x - 130, 0), Math.max(w - 260, 0))
        return (
          <div className="pointer-events-none absolute z-20 w-[260px] rounded-2xl border border-black/10 bg-white p-1.5 shadow-xl shadow-black/15 dark:border-white/10 dark:bg-zinc-900"
            style={look.below ? { left, top: look.y + look.h + 8 } : { left, bottom: `calc(100% - ${look.y}px + 8px)` }}>
            <img src={look.f.url} alt="" className="max-h-64 w-full rounded-xl object-contain" />
            <div className="truncate px-1 pb-0.5 pt-1.5 text-[11px] text-zinc-500">{look.f.name}</div>
          </div>
        )
      })()}
    </div>
  )
}

/* ---- one question's choices ---- */
export function Choices({ q, st }: { q: IntakeQuestion; st: Api }) {
  const cur = st.answers[q.id] ?? []
  if (q.kind === 'text') return (
    <textarea value={cur[0] === '*' ? '' : cur[0] ?? ''} onChange={e => st.setText(q, e.target.value)} placeholder={q.placeholder} rows={3}
      className="w-full resize-none rounded-xl border border-black/10 bg-white px-3 py-2.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-proto-primary-ring dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-100" />
  )
  const options = q.options ?? []
  const pictures = options.some(o => o.demo)
  if (q.files) return <div className="min-w-0 max-w-full"><Targets q={q} st={st} /><div className="mt-2.5 flex flex-wrap gap-2"><OwnChips q={q} st={st} /></div></div>
  if (pictures) return (
    <div className={`grid min-w-0 grid-cols-2 gap-2.5 ${options.length === 4 ? 'sm:grid-cols-5' : options.length === 2 ? 'sm:grid-cols-3' : 'sm:grid-cols-4'}`}>
      {options.map(o => {
        const on = cur.includes(o.id)
        return (
          <button key={o.id} type="button" aria-pressed={on} onClick={() => st.toggle(q, o.id)} className={card(on)}>
            {o.demo ? <Demo demo={o.demo} /> : <div className="aspect-[4/3] w-full rounded-lg bg-zinc-50 dark:bg-zinc-800/50" />}
            <div className="px-1 pb-0.5 pt-1.5">
              <div className="text-xs font-medium leading-snug">{o.label}</div>
              {o.sub && <div className="mt-0.5 text-[11px] leading-snug text-zinc-500">{o.sub}</div>}
            </div>
            {on && checkDot}
          </button>
        )
      })}
      <OwnCard q={q} st={st} />
    </div>
  )
  return (
    <div className="flex flex-wrap gap-2">
      {options.map(o => { const on = cur.includes(o.id); return <button key={o.id} type="button" aria-pressed={on} onClick={() => st.toggle(q, o.id)} className={chip(on)}>{o.label}{on && <Icon name="check" size={13} />}</button> })}
      <OwnChips q={q} st={st} />
    </div>
  )
}

