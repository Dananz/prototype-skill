// The questions an agent asks before it builds (proto intake set), as a screen of their own: one calm
// card in the app's colors with every question on one page, and a footer that stays at the bottom.
// While they wait for answers it covers the whole shell, so none of the variant chrome is around it.
import { useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Icon } from './icons'
import { Choices, DecideButton, type Api } from './parts'
import type { Answers, Attach, Files, Intake, IntakeQuestion } from './types'
import { t } from '../i18n'

/** A small copy of an image, so a strip of big files stays light. Empty when it can't be made. */
async function makeThumb(f: File) {
  try {
    const bmp = await createImageBitmap(f, { resizeWidth: 192, resizeQuality: 'medium' })
    const c = document.createElement('canvas')
    c.width = bmp.width; c.height = bmp.height
    c.getContext('2d')!.drawImage(bmp, 0, 0)
    bmp.close()
    const blob = await new Promise<Blob | null>(r => c.toBlob(r, 'image/jpeg', 0.82))
    return blob ? URL.createObjectURL(blob) : ''
  } catch { return '' }
}
const dataUrl = (f: File) => new Promise<string>((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = () => no(r.error); r.readAsDataURL(f) })
const MAX_FILE = 20 * 1024 * 1024

type Props = { intake: Intake; name: string; submitted: boolean; send: (body: unknown) => Promise<boolean>; close: () => void }

function useIntake() {
  const [answers, setAnswers] = useState<Answers>({})
  const [files, setFiles] = useState<Files>({})
  const live = (a: Answers, q: IntakeQuestion) => (a[q.id] ?? []).filter(x => x !== '*')
  const st: Api = {
    answers, files,
    toggle: (q, id) => setAnswers(a => {
      const cur = live(a, q)
      if (q.kind === 'one') return { ...a, [q.id]: cur[0] === id ? [] : [id] }
      return { ...a, [q.id]: cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id] }
    }),
    add: (q, text) => {
      const t = text.trim()
      if (!t) return
      const id = '+' + t
      setAnswers(a => q.kind === 'one' ? { ...a, [q.id]: [id] } : live(a, q).includes(id) ? a : { ...a, [q.id]: [...live(a, q), id] })
    },
    setText: (q, v) => setAnswers(a => ({ ...a, [q.id]: v ? [v] : [] })),
    decide: q => setAnswers(a => ({ ...a, [q.id]: a[q.id]?.[0] === '*' ? [] : ['*'] })),
    decided: q => answers[q.id]?.[0] === '*',
    addFiles: (key, list) => {
      const next = list.map(f => ({ id: crypto.randomUUID(), name: f.name || 'Pasted image', type: f.type, url: URL.createObjectURL(f), file: f }) as Attach)
      if (!next.length) return
      setFiles(m => ({ ...m, [key]: [...(m[key] ?? []), ...next] }))
      for (const n of next) {
        if (!n.type.startsWith('image/')) continue
        makeThumb(n.file).then(t => setFiles(m => ({ ...m, [key]: (m[key] ?? []).map(x => x.id === n.id ? { ...x, thumb: t || n.url } : x) })))
      }
    },
    removeFile: (key, id) => setFiles(m => ({ ...m, [key]: (m[key] ?? []).filter(f => f.id !== id) })),
  }
  const filesOf = (q: IntakeQuestion) => Object.entries(files).filter(([k]) => k === q.id || k.startsWith(q.id + ':')).flatMap(([, v]) => v)
  const answered = (q: IntakeQuestion) => (answers[q.id]?.length ?? 0) > 0 || filesOf(q).length > 0
  return { st, answered }
}

function Card({ intake, name, submitted, send, close }: Props) {
  const { st, answered } = useIntake()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const total = intake.questions.length
  const count = intake.questions.filter(answered).length

  const submit = async () => {
    setBusy(true); setError('')
    try {
      const files: { question: string; name: string; dataUrl: string }[] = []
      for (const [key, list] of Object.entries(st.files)) for (const f of list) {
        if (f.file.size > MAX_FILE) throw new Error(t('{name} is over 20 MB: remove it or send a smaller one', { name: f.name }))
        files.push({ question: key, name: f.name, dataUrl: await dataUrl(f.file) })
      }
      const answers: Answers = {}, decided: string[] = []
      for (const q of intake.questions) {
        const a = st.answers[q.id] ?? []
        if (a[0] === '*') decided.push(q.id)
        else if (a.length) answers[q.id] = a
      }
      const ok = await send({ id: intake.id, answers, decided, files, viewport: { w: innerWidth, h: innerHeight, phone: matchMedia('(max-width:639px)').matches }, theme: document.documentElement.classList.contains('dark') ? 'dark' : 'light' })
      if (!ok) setError(t('The server didn’t take the answers. Is it still running? Nothing was lost: try again.'))
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    setBusy(false)
  }

  return (
    <div className="flex h-full flex-col bg-zinc-100 text-[13px] text-zinc-900 antialiased dark:bg-zinc-950 dark:text-zinc-100">
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-6 sm:py-8">
        <div className="mx-auto flex max-w-3xl flex-col rounded-[28px] border border-black/5 bg-white shadow-[0_1px_0_rgb(0_0_0/.03),0_24px_60px_-32px_rgb(0_0_0/.25)] dark:border-white/10 dark:bg-zinc-900 dark:shadow-none">
          <header className="px-5 pb-5 pt-6 sm:px-9 sm:pt-8">
            <div className="flex items-center gap-2 text-xs text-zinc-500">
              <span className="relative inline-flex size-2"><span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-60" /><span className="relative inline-flex size-full rounded-full bg-emerald-500" /></span>
              <span dir="auto">{name}</span><span className="text-zinc-300 dark:text-zinc-600">·</span>{t('Before I build')}
            </div>
            {submitted ? (
              <>
                <h1 className="mt-4 text-2xl font-semibold tracking-tight">{t('Thank you')}</h1>
                <p className="mt-1.5 text-zinc-500">{t('I’m planning the directions from your answers. They appear on this page in a moment.')}</p>
                <button type="button" onClick={close} className="mt-5 h-9 rounded-full border border-black/10 px-4 text-xs font-medium hover:bg-zinc-100 dark:border-white/15 dark:hover:bg-zinc-800">{t('Show the page')}</button>
              </>
            ) : (
              <>
                <h1 dir="auto" className="mt-4 text-2xl font-semibold tracking-tight">{intake.title || t('A few things that change what I build')}</h1>
                <p dir="auto" className="mt-1.5 text-zinc-500">{intake.ask ? t('You asked: “{ask}”. ', { ask: intake.ask }) : null}{t('Answer what you know, skip the rest.')}</p>
              </>
            )}
          </header>
          {!submitted && (
            <div className="divide-y divide-black/5 border-t border-black/5 dark:divide-white/5 dark:border-white/5">
              {intake.questions.map((q, i) => (
                <section key={q.id} className="px-5 py-6 sm:px-9">
                  <div className="flex items-center justify-between gap-4">
                    <h2 dir="auto" className="text-[15px] font-semibold"><span className="me-2 text-zinc-400">{i + 1}</span>{q.title}</h2>
                    {q.kind !== 'text' && <DecideButton q={q} st={st} />}
                  </div>
                  {q.why && <p dir="auto" className="mb-4 mt-0.5 text-zinc-500">{q.why}</p>}
                  {!q.why && <div className="h-3" />}
                  <Choices q={q} st={st} />
                </section>
              ))}
            </div>
          )}
        </div>
      </div>
      {!submitted && (
        <footer className="shrink-0 border-t border-black/5 bg-white/90 backdrop-blur dark:border-white/10 dark:bg-zinc-900/90">
          <div className="mx-auto flex max-w-3xl items-center gap-4 px-5 py-3.5 sm:px-9">
            <div className="min-w-0 flex-1">
              <div className="text-xs text-zinc-500">{error ? <span role="alert" className="text-rose-600 dark:text-rose-400">{error}</span> : t('{count} of {total} answered', { count, total })}</div>
              <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-black/5 dark:bg-white/10"><div className="h-full rounded-full bg-proto-primary transition-[width] duration-300" style={{ width: `${(count / total) * 100}%` }} /></div>
            </div>
            <button type="button" disabled={busy} onClick={submit} data-shoot="intake-start"
              className="flex h-10 shrink-0 items-center gap-1.5 rounded-full bg-proto-primary px-5 text-[13px] font-medium text-white hover:bg-proto-primary-hover disabled:opacity-60">
              <Icon name="sparkleFill" size={14} />{busy ? t('Sending…') : count ? t('Start building') : t('Let Claude decide everything')}
            </button>
          </div>
        </footer>
      )}
    </div>
  )
}

/**
 * The intake screen: covers the shell while the questions wait for answers (and for a moment after,
 * with a thank-you). `show` says whether it is up; `send` posts the answers and resolves to whether
 * the server took them.
 */
export function createIntake(host: HTMLElement, o: { name: () => string; send: (body: unknown) => Promise<boolean> }) {
  const root = createRoot(host)
  let shown: { id: string; submitted: boolean } | null = null
  let dismissed = ''
  let last: Intake | null = null
  // The host is only touched when it opens or closes: the shell calls set() on every status ping, and
  // a write of the same value is still a mutation the page's observers would answer.
  let isOpen = false
  const paint = () => {
    const open = !!last && !!shown && dismissed !== last.id
    if (open) {
      const it = last!
      root.render(<Card key={it.id} intake={it} name={o.name()} submitted={shown!.submitted} close={() => { dismissed = it.id; paint() }}
        send={async body => { const ok = await o.send(body); if (ok) { shown = { id: it.id, submitted: true }; paint() } return ok }} />)
    } else if (isOpen) root.render(<></>)
    if (open !== isOpen) { host.hidden = !open; host.toggleAttribute('inert', !open); isOpen = open }
  }
  return {
    /** The server's view of the intake, and whether prototypes exist yet (the thank-you gives way to them). */
    set(intake: Intake | null | undefined, hasPrototypes: boolean) {
      last = intake ?? null
      if (!intake) shown = null
      else if (intake.status === 'open') { if (shown?.id !== intake.id) shown = { id: intake.id, submitted: false } }
      else if (!(shown?.id === intake.id && shown.submitted && !hasPrototypes)) shown = null
      paint()
    },
  }
}
