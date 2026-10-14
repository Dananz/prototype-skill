// Screenshot board: framework-neutral shell entry, React dialog in both React and Vue sessions.
import { createElement as h, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Dialog } from '@base-ui/react/dialog'
import { uiBox } from './portals'
import { ic, IB } from './ui'
import { captureRoute, compose, download, filePart, LOOKS, png, SIZES, type Look, type ShotSize, type Tone } from './share-capture'

type Subject = { id: string; name: string; hash: string; tweaks?: Record<string, string | boolean> }
type Props = { title: string; slug: string; variants: Subject[]; current: string | null; size: { w: number; h: number }; dark: boolean; onClose: () => void; returnFocus: () => HTMLElement | null }
const icon = (name: string) => h('span', { className: 'inline-flex', dangerouslySetInnerHTML: { __html: ic(name) } })
const small = 'text-xs text-zinc-500 dark:text-zinc-400'
const button = 'inline-flex min-h-9 items-center justify-center gap-2 rounded-lg px-3 text-xs font-medium hover:bg-zinc-900/5 disabled:opacity-40 dark:hover:bg-white/10'
type Style = Look | 'both'
const STYLES: { id: Style; label: string; looks: Look[] }[] = [
  { id: 'bare', label: 'No name', looks: ['bare'] },
  { id: 'named', label: 'With name', looks: ['named'] },
  { id: 'both', label: 'Both', looks: ['bare', 'named'] },
  { id: 'canvas', label: 'Canvas', looks: ['canvas'] },
]
const flip = <T,>(a: T[], id: T) => a.includes(id) ? a.filter(x => x !== id) : [...a, id]

function Preview({ canvas }: { canvas: HTMLCanvasElement }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useLayoutEffect(() => {
    const out = ref.current!
    const scale = Math.min(1, 900 / canvas.width, 900 / canvas.height)
    out.width = Math.round(canvas.width * scale); out.height = Math.round(canvas.height * scale)
    out.getContext('2d')!.drawImage(canvas, 0, 0, out.width, out.height)
  }, [canvas])
  return h('canvas', { ref, className: 'block size-full object-contain' })
}

function Board(p: Props) {
  const [style, setStyle] = useState<Style>('both')
  const looks = STYLES.find(s => s.id === style)!.looks
  const [sizes, setSizes] = useState(['stage'])
  const [tone, setTone] = useState<Tone>('soft')
  const [names, setNames] = useState<Record<string, string>>({})
  const [out, setOut] = useState(() => p.current ? p.variants.filter(v => v.id !== p.current).map(v => v.id) : []), [skipped, setSkipped] = useState<string[]>([])
  const [raws, setRaws] = useState<Record<string, HTMLCanvasElement>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [retry, setRetry] = useState(0)
  const [progress, setProgress] = useState<number | null>(null), [notice, setNotice] = useState('')
  const stop = useRef(false), busy = useRef(false), live = useRef(true)
  const cache = useRef<Record<string, HTMLCanvasElement>>({})
  const composed = useRef(new Map<string, { raw: HTMLCanvasElement; style: string; canvas: HTMLCanvasElement }>())
  const [files, setFiles] = useState<File[]>([])
  const popup = useRef<HTMLDivElement>(null)
  const variants = p.variants
  const options: ShotSize[] = [{ id: 'stage', label: 'As shown', ...p.size }, ...SIZES]
  const chosen = options.filter(s => sizes.includes(s.id))
  const nameOf = (v: Subject) => names[v.id] ?? `${v.id} · ${v.name}`
  const keyOf = (v: Subject, s: ShotSize) => `${v.id}|${s.id}`
  const captureKey = `${variants.map(v => v.hash).join()}|${chosen.map(s => `${s.id}:${s.w}x${s.h}`).join()}|${p.dark}|${retry}`
  useEffect(() => {
    const controller = new AbortController()
    setRaws({}); setErrors({})
    void (async () => {
      // Make the context-menu target ready before preparing the other preview rows.
      const order = [...variants].sort((a, b) => Number(b.id === p.current) - Number(a.id === p.current))
      for (const v of order) for (const s of chosen) {
        if (controller.signal.aborted) return
        const k = keyOf(v, s), ck = `${v.hash}|${s.w}x${s.h}|${p.dark}|${retry}`
        try {
          const raw = cache.current[ck] ?? await captureRoute(v.hash, s, p.dark, controller.signal, v.tweaks)
          if (controller.signal.aborted) return
          cache.current[ck] = raw
          setRaws(a => ({ ...a, [k]: raw }))
        } catch (e) {
          if (controller.signal.aborted) return
          setErrors(a => ({ ...a, [k]: e instanceof Error ? e.message : String(e) }))
        }
      }
    })()
    return () => controller.abort()
  }, [captureKey])
  useEffect(() => { live.current = true; return () => { live.current = false; stop.current = true } }, [])
  const tiles = useMemo(() => variants.flatMap(v => chosen.flatMap(s => looks.map(look => {
    const raw = raws[keyOf(v, s)], key = `${keyOf(v, s)}|${look}`
    const style = JSON.stringify([nameOf(v), p.title, p.dark, tone])
    const previous = composed.current.get(key)
    const canvas = raw ? previous?.raw === raw && previous.style === style ? previous.canvas : compose(raw, look, { name: nameOf(v), title: p.title, dark: p.dark, tone }) : null
    if (raw && canvas) composed.current.set(key, { raw, style, canvas })
    return { v, s, look, key, canvas }
  }))), [captureKey, raws, looks, tone, names])
  const selected = (t: typeof tiles[number]) => !out.includes(t.v.id) && !skipped.includes(t.key)
  const jobs = tiles.filter(selected), ready = jobs.length > 0 && jobs.every(t => t.canvas)
  const filename = (t: typeof tiles[number]) => `${filePart(p.slug)}-${filePart(t.v.id)}-${filePart(nameOf(t.v))}-${t.s.id}-${t.look}.png`
  // Prepare before the press: Web Share needs a fresh user gesture, including on Safari.
  useEffect(() => {
    let alive = true, timer = 0
    setFiles([]); setNotice('')
    if (ready && navigator.canShare && matchMedia('(max-width:639px)').matches) {
      timer = window.setTimeout(() => {
        void Promise.all(jobs.map(async t => new File([await png(t.canvas!)], filename(t), { type: 'image/png' }))).then(next => { if (alive) setFiles(next) }).catch(() => {})
      }, 200)
    }
    return () => { alive = false; clearTimeout(timer) }
  }, [tiles, out, skipped])
  const close = () => { stop.current = true; p.onClose() }
  const save = async () => {
    if (!ready || busy.current) return
    busy.current = true; stop.current = false; setProgress(0); setNotice('')
    let done = 0
    try {
      for (const t of jobs) {
        if (stop.current) break
        const blob = await png(t.canvas!)
        if (stop.current) break
        download(blob, filename(t)); done++
        if (live.current) setProgress(done)
        await new Promise(r => setTimeout(r, 350))
      }
      if (live.current) setNotice(stop.current ? `Stopped after ${done} of ${jobs.length} PNGs.` : `${done} PNG${done === 1 ? '' : 's'} sent to downloads.`)
    } catch (e) { if (live.current) setNotice(`Download failed: ${e instanceof Error ? e.message : String(e)}`) }
    finally { busy.current = false; if (live.current) setProgress(null) }
  }
  const shareFiles = () => {
    if (busy.current || !files.length) return
    busy.current = true; setProgress(0)
    void navigator.share({ files, title: p.title }).catch(e => { if (live.current && e.name !== 'AbortError') setNotice(`Could not share: ${e.message}. Use Download PNGs.`) }).finally(() => { busy.current = false; if (live.current) setProgress(null) })
  }
  return h(Dialog.Root, { open: true, onOpenChange: (open: boolean) => { if (!open) close() } },
    h(Dialog.Portal, { container: uiBox() },
      h(Dialog.Backdrop, { className: 'fixed inset-0 z-[300] bg-black/30 dark:bg-black/60' }),
      h(Dialog.Popup, { ref: popup, 'data-share-board': '', initialFocus: () => popup.current?.querySelector<HTMLElement>('[data-share-close]') ?? null, finalFocus: p.returnFocus,
        onKeyDownCapture: (e: { key: string; preventDefault: () => void; stopPropagation: () => void }) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close() } },
        className: 'fixed inset-0 z-[301] flex flex-col overflow-hidden bg-zinc-100 text-zinc-900 shadow-2xl sm:inset-6 sm:mx-auto sm:max-w-6xl sm:rounded-2xl sm:border sm:border-black/10 dark:bg-zinc-950 dark:text-zinc-100 dark:sm:border-white/10' },
        h('header', { className: 'flex shrink-0 items-center justify-between gap-3 border-b border-black/[.07] bg-white px-4 py-3 sm:px-6 dark:border-white/10 dark:bg-zinc-900' },
          h('div', { className: 'min-w-0' }, h(Dialog.Title, { className: 'font-semibold' }, 'Share screenshots'), h(Dialog.Description, { className: `mt-0.5 truncate ${small}` }, p.title)),
          h('button', { type: 'button', 'data-share-close': '', 'aria-label': 'Close screenshots', className: IB, onClick: close }, icon('x'))),
        h('fieldset', { disabled: progress !== null, className: 'm-0 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-0 p-0' },
          h('div', { className: 'flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-black/[.06] px-4 py-2 sm:px-6 dark:border-white/10' },
            h('div', { role: 'radiogroup', 'aria-label': 'Screenshot styles', className: 'flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1' }, ...STYLES.map(s =>
              h('label', { key: s.id, className: 'flex h-9 cursor-pointer items-center gap-2 text-[13px] font-medium' },
                h('input', { type: 'radio', name: 'screenshot-style', value: s.id, 'data-share-look': s.id, checked: style === s.id, onChange: () => setStyle(s.id), className: 'size-[18px] accent-proto-primary' }), s.label))),
            style === 'canvas' ? h('div', { role: 'group', 'aria-label': 'Canvas background', className: 'flex w-44 gap-0.5 rounded-xl bg-zinc-900/[.05] p-0.5 dark:bg-white/[.07]' },
              ...(['soft', 'dark', 'brand'] as Tone[]).map(t => h('button', { key: t, type: 'button', 'data-share-tone': t, 'aria-pressed': tone === t, onClick: () => setTone(t), className: `h-8 min-w-0 flex-1 truncate rounded-[10px] px-2 text-xs font-medium ${tone === t ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-white' : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white'}` }, t === 'brand' ? 'Indigo' : t === 'soft' ? 'Soft' : 'Dark'))) : null,
            h('div', { role: 'group', 'aria-label': 'Screenshot sizes', className: 'flex flex-wrap gap-1.5' }, ...options.map(s => h('button', { key: s.id, type: 'button', 'data-share-size': s.id, 'aria-pressed': sizes.includes(s.id), onClick: () => setSizes(a => a.length === 1 && a.includes(s.id) ? a : flip(a, s.id)), className: `flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs font-medium ring-1 ring-inset ${sizes.includes(s.id) ? 'bg-proto-primary-soft text-proto-primary-soft-fg ring-proto-primary-ring/40' : 'text-zinc-600 ring-black/10 dark:text-zinc-300 dark:ring-white/15'}` },
              icon(`share-${s.id}`), s.label, s.id !== 'stage' ? h('span', { className: 'hidden tabular-nums opacity-60 sm:inline' }, s.w) : null)))),
          h('div', { className: 'min-h-0 flex-1 space-y-6 overflow-y-auto px-4 py-4 sm:px-6' }, ...variants.map(v => h('section', { key: v.id, 'data-share-variant': v.id },
            h('div', { className: 'mb-2 flex items-center gap-2' }, h('span', { className: 'grid size-8 shrink-0 place-items-center rounded-lg bg-zinc-900 text-xs font-semibold text-white dark:bg-white dark:text-zinc-900' }, v.id),
              h('label', { className: 'relative block min-w-0 max-w-sm flex-1' },
                h('input', { 'aria-label': `Screenshot name for ${v.id}`, value: names[v.id] ?? '', placeholder: `${v.id} · ${v.name}`, dir: 'auto', onChange: (e: { target: { value: string } }) => setNames(a => ({ ...a, [v.id]: e.target.value })), className: 'h-10 w-full rounded-lg bg-zinc-900/[.04] ps-3 pe-9 text-[13px] text-zinc-900 outline-none ring-1 ring-inset ring-transparent placeholder:text-zinc-700 focus:bg-white focus:ring-proto-primary-ring dark:bg-white/[.06] dark:text-white dark:placeholder:text-zinc-300 dark:focus:bg-zinc-800' }),
                h('span', { className: 'pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-zinc-400' }, icon('share-pencil'))),
              h('button', { type: 'button', 'aria-label': `${out.includes(v.id) ? 'Include' : 'Leave out'} variant ${v.id}`, 'aria-pressed': !out.includes(v.id), onClick: () => setOut(a => flip(a, v.id)), className: IB }, icon(out.includes(v.id) ? 'eyeoff' : 'eye'))),
            h('div', { className: 'grid grid-cols-2 gap-3 sm:grid-cols-3' }, ...tiles.filter(t => t.v.id === v.id).map(t => h('button', { key: t.key, type: 'button', 'data-share-tile': t.key, disabled: out.includes(v.id), 'aria-pressed': selected(t), 'aria-label': `${v.id}, ${t.s.label}, ${LOOKS.find(l => l.id === t.look)!.label}`, onClick: () => setSkipped(a => flip(a, t.key)), className: `overflow-hidden rounded-xl border border-black/10 bg-white text-start dark:border-white/10 dark:bg-zinc-900 ${selected(t) ? '' : 'opacity-40 grayscale'}` },
              h('span', { className: 'flex aspect-[4/3] items-center justify-center bg-zinc-200/70 p-2 dark:bg-zinc-800' }, t.canvas ? h(Preview, { canvas: t.canvas }) : h('span', { className: 'px-2 text-center text-xs text-zinc-500' }, errors[keyOf(v, t.s)] ?? 'Preparing screenshot…')),
              h('span', { className: 'flex min-h-10 items-center justify-between gap-2 px-2.5 text-[11px]' }, h('span', null, `${LOOKS.find(l => l.id === t.look)!.label} · ${t.s.label}`), selected(t) ? icon('picked') : null)))))))),
        h('footer', { className: 'shrink-0 space-y-2 border-t border-black/[.07] bg-white px-4 py-3 pb-[max(.75rem,env(safe-area-inset-bottom))] sm:px-6 dark:border-white/10 dark:bg-zinc-900' },
          h('div', { className: 'flex flex-wrap items-center justify-between gap-2' },
            h('p', { className: small, role: 'status' }, progress !== null ? `${progress} of ${jobs.length} PNGs` : notice || `${jobs.length} PNG${jobs.length === 1 ? '' : 's'} · saved one by one`),
            h('div', { className: 'flex gap-2' }, Object.keys(errors).length ? h('button', { type: 'button', disabled: progress !== null, className: button, onClick: () => { cache.current = {}; setRetry(n => n + 1) } }, 'Retry captures') : null,
              progress !== null ? h('button', { type: 'button', className: button, onClick: () => { stop.current = true } }, 'Stop') : null,
              files.length && navigator.canShare?.({ files }) ? h('button', { type: 'button', disabled: progress !== null, className: button, onClick: shareFiles }, icon('share'), 'Share files') : null,
              h('button', { type: 'button', 'data-share-download': '', disabled: !ready || progress !== null, onClick: () => void save(), className: 'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-proto-primary px-4 text-sm font-medium text-proto-primary-fg hover:bg-proto-primary-hover disabled:opacity-40' }, icon('download'), `Download ${jobs.length} PNG${jobs.length === 1 ? '' : 's'}`))),
          progress !== null ? h('progress', { value: progress, max: jobs.length, 'aria-label': 'Download progress', className: 'block h-1 w-full accent-proto-primary' }) : null))))
}

export function createShare() {
  const host = document.createElement('div'); uiBox().append(host)
  const root = createRoot(host)
  let id = 0
  return (props: Props | null) => root.render(props ? h(Board, { ...props, key: ++id }) : null)
}
