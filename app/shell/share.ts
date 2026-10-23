// Screenshot board: framework-neutral shell entry, React dialog in both React and Vue sessions.
import { createElement as h, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Dialog } from '@base-ui/react/dialog'
import { uiBox } from './portals'
import { VIRTUAL_THRESHOLD } from './virtual'
import { CachedList } from './virtual-react'
import { ic, IB } from './ui'
import { variantLabel, variantRef } from './variants'
import { captureRoute, compose, download, filePart, LOOKS, png, SIZES, type Look, type ShotSize, type Tone } from './share-capture'
import { t, tn } from './i18n'

type Subject = { id: string; name: string; path: string; tweaks?: Record<string, string | boolean> }
type Props = { title: string; slug: string; variants: Subject[]; current: string | null; size: { w: number; h: number }; dark: boolean; onClose: () => void; returnFocus: () => HTMLElement | null }
const icon = (name: string) => h('span', { className: 'inline-flex', dangerouslySetInnerHTML: { __html: ic(name) } })
const small = 'text-xs text-zinc-500 dark:text-zinc-400'
const button = 'inline-flex min-h-9 items-center justify-center gap-2 rounded-lg px-3 text-xs font-medium hover:bg-zinc-900/5 disabled:opacity-40 dark:hover:bg-white/10'
type Style = Look | 'both'
const STYLES: { id: Style; label: string; looks: Look[] }[] = [
  { id: 'bare', label: t('No name'), looks: ['bare'] },
  { id: 'named', label: t('With name'), looks: ['named'] },
  { id: 'both', label: t('Both'), looks: ['bare', 'named'] },
  { id: 'canvas', label: t('Canvas'), looks: ['canvas'] },
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
  const large = p.variants.length > VIRTUAL_THRESHOLD
  const [visible, setVisible] = useState<string[]>(() => [p.current ?? p.variants[0]?.id].filter((id): id is string => !!id))
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
  const exportController = useRef<AbortController | null>(null), previewController = useRef<AbortController | null>(null)
  const stop = useRef(false), busy = useRef(false), live = useRef(true)
  const cache = useRef<Record<string, HTMLCanvasElement>>({})
  const composed = useRef(new Map<string, { raw: HTMLCanvasElement; style: string; canvas: HTMLCanvasElement }>())
  const [files, setFiles] = useState<File[]>([])
  const popup = useRef<HTMLDivElement>(null)
  const variants = p.variants
  const options: ShotSize[] = [{ id: 'stage', label: t('As shown'), ...p.size }, ...SIZES]
  const chosen = options.filter(s => sizes.includes(s.id))
  const labelOf = (v: Subject) => variantRef(p, v.id)
  const nameOf = (v: Subject) => names[v.id] ?? `${labelOf(v)} · ${v.name}`
  const keyOf = (v: Subject, s: ShotSize) => `${v.id}|${s.id}`
  const captureKey = `${variants.map(v => v.path).join()}|${chosen.map(s => `${s.id}:${s.w}x${s.h}`).join()}|${p.dark}|${retry}`
  const visibleKey = large ? visible.join('|') : ''
  const prunePreviewCache = (active: Set<string>) => {
    const keys = Object.keys(cache.current), limit = Math.max(8, active.size)
    let count = keys.length
    for (const key of keys) if (count > limit && !active.has(key)) { delete cache.current[key]; count-- }
    return new Set(Object.values(cache.current))
  }
  useEffect(() => {
    const controller = new AbortController(); previewController.current = controller
    const subjects = large ? variants.filter(v => visible.includes(v.id)) : variants
    const allowed = new Set(subjects.flatMap(v => chosen.map(s => keyOf(v, s))))
    const captureKeys = new Set(subjects.flatMap(v => chosen.map(s => `${v.path}|${s.w}x${s.h}|${p.dark}|${retry}`)))
    if (large) {
      // Drop every owning reference, including React state, when a preview leaves the window.
      const retained = prunePreviewCache(captureKeys)
      setRaws(previous => Object.fromEntries(Object.entries(previous).filter(([, canvas]) => retained.has(canvas))))
      setErrors(previous => Object.fromEntries(Object.entries(previous).filter(([key]) => allowed.has(key))))
    } else { setRaws({}); setErrors({}) }
    if (large && progress !== null) return () => controller.abort()
    void (async () => {
      // Make the context-menu target ready before preparing the other preview rows.
      const order = [...subjects].sort((a, b) => Number(b.id === p.current) - Number(a.id === p.current))
      for (const v of order) for (const s of chosen) {
        if (controller.signal.aborted) return
        const k = keyOf(v, s), ck = `${v.path}|${s.w}x${s.h}|${p.dark}|${retry}`
        try {
          const raw = cache.current[ck] ?? await captureRoute(v.path, s, p.dark, controller.signal, v.tweaks)
          if (controller.signal.aborted) return
          delete cache.current[ck]; cache.current[ck] = raw
          const retained = large ? prunePreviewCache(captureKeys) : new Set(Object.values(cache.current))
          setRaws(a => ({ ...(large ? Object.fromEntries(Object.entries(a).filter(([, canvas]) => retained.has(canvas))) : a), [k]: raw }))
        } catch (e) {
          if (controller.signal.aborted) return
          setErrors(a => ({ ...a, [k]: e instanceof Error ? e.message : String(e) }))
        }
      }
    })()
    return () => controller.abort()
  }, [captureKey, visibleKey, large ? progress !== null : false])
  useEffect(() => { live.current = true; return () => { live.current = false; stop.current = true; exportController.current?.abort(); previewController.current?.abort(); cache.current = {}; composed.current.clear() } }, [])
  const tiles = useMemo(() => {
    if (large) {
      const keys = new Set(variants.flatMap(v => chosen.flatMap(s => raws[keyOf(v, s)] ? looks.map(look => `${keyOf(v, s)}|${look}`) : [])))
      for (const key of composed.current.keys()) if (!keys.has(key)) composed.current.delete(key)
    }
    return variants.flatMap(v => chosen.flatMap(s => looks.map(look => {
    const raw = raws[keyOf(v, s)], key = `${keyOf(v, s)}|${look}`
    const style = JSON.stringify([nameOf(v), p.title, p.dark, tone])
    const previous = composed.current.get(key)
    const canvas = raw ? previous?.raw === raw && previous.style === style ? previous.canvas : compose(raw, look, { name: nameOf(v), title: p.title, dark: p.dark, tone }) : null
    if (raw && canvas) composed.current.set(key, { raw, style, canvas })
    return { v, s, look, key, canvas }
  })))
  }, [captureKey, raws, looks, tone, names])
  const selected = (t: typeof tiles[number]) => !out.includes(t.v.id) && !skipped.includes(t.key)
  const jobs = tiles.filter(selected), prepared = jobs.length > 0 && jobs.every(t => t.canvas)
  const ready = jobs.length > 0 && (large || prepared)
  const filename = (t: typeof tiles[number]) => `${filePart(p.slug)}-${filePart(t.v.id)}-${filePart(nameOf(t.v))}-${t.s.id}-${t.look}.png`
  // Configuration changes invalidate prepared files; scrolling between preview windows does not.
  useEffect(() => { setFiles([]); setNotice('') }, [captureKey, style, tone, names, out, skipped])
  // Prepare before the press: Web Share needs a fresh user gesture, including on Safari.
  useEffect(() => {
    let alive = true, timer = 0
    if (!large) { setFiles([]); setNotice('') }
    if (prepared && navigator.canShare && matchMedia('(max-width:639px)').matches) {
      timer = window.setTimeout(() => {
        void Promise.all(jobs.map(async t => new File([await png(t.canvas!)], filename(t), { type: 'image/png' }))).then(next => { if (alive) setFiles(next) }).catch(() => {})
      }, 200)
    }
    return () => { alive = false; clearTimeout(timer) }
  }, [large ? captureKey : tiles, large ? style : '', large ? tone : '', large ? names : null, large ? prepared : false, out, skipped])
  const cancel = () => { stop.current = true; exportController.current?.abort(); if (large) previewController.current?.abort() }
  const close = () => { cancel(); p.onClose() }
  // Only one raw capture and one composition are needed for an offscreen export. Never add
  // export-only canvases to preview state or to the persistent preview cache.
  const fileFor = async (t: typeof tiles[number], signal: AbortSignal, last: { key: string; raw: HTMLCanvasElement | null }) => {
    signal.throwIfAborted()
    const key = `${t.v.path}|${t.s.w}x${t.s.h}|${p.dark}|${retry}`
    const raw = t.canvas ? null : (last.key === key ? last.raw : null) ?? cache.current[key]
      ?? await captureRoute(t.v.path, t.s, p.dark, signal, t.v.tweaks)
    if (raw) { last.key = key; last.raw = raw }
    signal.throwIfAborted()
    const canvas = t.canvas ?? compose(raw!, t.look, { name: nameOf(t.v), title: p.title, dark: p.dark, tone })
    const blob = await png(canvas)
    signal.throwIfAborted()
    return new File([blob], filename(t), { type: 'image/png' })
  }
  const save = async (prepareShare = false) => {
    if (!ready || busy.current) return
    busy.current = true; stop.current = false; setProgress(0); setNotice('')
    if (large) previewController.current?.abort()
    const controller = new AbortController(); exportController.current = controller
    const preparedFiles: File[] = [], last = { key: '', raw: null as HTMLCanvasElement | null }
    let done = 0
    const failures: string[] = []
    try {
      for (const t of jobs) {
        if (stop.current) break
        try {
          const file = await fileFor(t, controller.signal, last)
          if (stop.current) break
          if (prepareShare) preparedFiles.push(file)
          else download(file, filename(t))
          done++
        } catch (error) {
          if (controller.signal.aborted || prepareShare) throw error
          failures.push(`${nameOf(t.v)} (${t.s.label}, ${t.look})`)
        }
        if (live.current) setProgress(done)
        if (!prepareShare) await new Promise(r => setTimeout(r, 350))
      }
      if (live.current) {
        if (prepareShare && !stop.current) setFiles(preparedFiles)
        setNotice(stop.current ? t('Stopped after {done} of {total} PNGs.', { done, total: jobs.length }) : prepareShare ? tn(done, '{n} PNG ready to share.', '{n} PNGs ready to share.') : `${tn(done, '{n} PNG sent to downloads.', '{n} PNGs sent to downloads.')}${failures.length ? ` ${tn(failures.length, '{n} failed: {list}.', '{n} failed: {list}.', { list: failures.join('; ') })}` : ''}`)
      }
    } catch (e) { if (live.current) setNotice(stop.current ? t('Stopped after {done} of {total} PNGs.', { done, total: jobs.length }) : t('Download failed: {error}', { error: e instanceof Error ? e.message : String(e) })) }
    finally { busy.current = false; exportController.current = null; if (live.current) setProgress(null) }
  }
  const shareFiles = () => {
    if (busy.current || !files.length) return
    busy.current = true; setProgress(0)
    void navigator.share({ files, title: p.title }).catch(e => { if (live.current && e.name !== 'AbortError') setNotice(t('Could not share: {error}. Use Download PNGs.', { error: e.message })) }).finally(() => { busy.current = false; if (live.current) setProgress(null) })
  }
  const section = (v: Subject) => h('section', { key: v.id, 'data-share-variant': v.id },
            h('div', { className: 'mb-2 flex items-center gap-2' }, h('span', { className: 'grid size-8 shrink-0 place-items-center rounded-lg bg-zinc-900 text-xs font-semibold text-white dark:bg-white dark:text-zinc-900' }, variantLabel(p, v.id)),
              h('label', { className: 'relative block min-w-0 max-w-sm flex-1' },
                h('input', { 'aria-label': t('Screenshot name for {variant}', { variant: labelOf(v) }), value: names[v.id] ?? '', placeholder: `${labelOf(v)} · ${v.name}`, dir: 'auto', onChange: (e: { target: { value: string } }) => setNames(a => ({ ...a, [v.id]: e.target.value })), className: 'h-10 w-full rounded-lg bg-zinc-900/[.04] ps-3 pe-9 text-[13px] text-zinc-900 outline-none ring-1 ring-inset ring-transparent placeholder:text-zinc-700 focus:bg-white focus:ring-proto-primary-ring dark:bg-white/[.06] dark:text-white dark:placeholder:text-zinc-300 dark:focus:bg-zinc-800' }),
                h('span', { className: 'pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-zinc-400' }, icon('share-pencil'))),
              h('button', { type: 'button', 'aria-label': out.includes(v.id) ? t('Include variant {variant}', { variant: labelOf(v) }) : t('Leave out variant {variant}', { variant: labelOf(v) }), 'aria-pressed': !out.includes(v.id), onClick: () => setOut(a => flip(a, v.id)), className: IB }, icon(out.includes(v.id) ? 'eyeoff' : 'eye'))),
            h('div', { className: 'grid grid-cols-2 gap-3 sm:grid-cols-3' }, ...tiles.filter(tile => tile.v.id === v.id).map(tile => h('button', { key: tile.key, type: 'button', 'data-share-tile': tile.key, disabled: out.includes(v.id), 'aria-pressed': selected(tile), 'aria-label': `${labelOf(v)}, ${tile.s.label}, ${LOOKS.find(l => l.id === tile.look)!.label}`, onClick: () => setSkipped(a => flip(a, tile.key)), className: `overflow-hidden rounded-xl border border-black/10 bg-white text-start dark:border-white/10 dark:bg-zinc-900 ${selected(tile) ? '' : 'opacity-40 grayscale'}` },
              h('span', { className: 'flex aspect-[4/3] items-center justify-center bg-zinc-200/70 p-2 dark:bg-zinc-800' }, tile.canvas ? h(Preview, { canvas: tile.canvas }) : h('span', { className: 'px-2 text-center text-xs text-zinc-500' }, errors[keyOf(v, tile.s)] ?? t('Preparing screenshot…'))),
              h('span', { className: 'flex min-h-10 items-center justify-between gap-2 px-2.5 text-[11px]' }, h('span', null, `${LOOKS.find(l => l.id === tile.look)!.label} · ${tile.s.label}`), selected(tile) ? icon('picked') : null)))))
  return h(Dialog.Root, { open: true, onOpenChange: (open: boolean) => { if (!open) close() } },
    h(Dialog.Portal, { container: uiBox() },
      h(Dialog.Backdrop, { className: 'fixed inset-0 z-[300] bg-black/30 dark:bg-black/60' }),
      h(Dialog.Popup, { ref: popup, 'data-share-board': '', initialFocus: () => popup.current?.querySelector<HTMLElement>('[data-share-close]') ?? null, finalFocus: p.returnFocus,
        onKeyDownCapture: (e: { key: string; preventDefault: () => void; stopPropagation: () => void }) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close() } },
        className: 'fixed inset-0 z-[301] flex flex-col overflow-hidden bg-zinc-100 text-zinc-900 shadow-2xl sm:inset-6 sm:mx-auto sm:max-w-6xl sm:rounded-2xl sm:border sm:border-black/10 dark:bg-zinc-950 dark:text-zinc-100 dark:sm:border-white/10' },
        h('header', { className: 'flex shrink-0 items-center justify-between gap-3 border-b border-black/[.07] bg-white px-4 py-3 sm:px-6 dark:border-white/10 dark:bg-zinc-900' },
          h('div', { className: 'min-w-0' }, h(Dialog.Title, { className: 'font-semibold' }, t('Share screenshots')), h(Dialog.Description, { className: `mt-0.5 truncate ${small}` }, p.title)),
          h('button', { type: 'button', 'data-share-close': '', 'aria-label': t('Close screenshots'), className: IB, onClick: close }, icon('x'))),
        h('fieldset', { disabled: progress !== null, className: 'm-0 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-0 p-0' },
          h('div', { className: 'flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-black/[.06] px-4 py-2 sm:px-6 dark:border-white/10' },
            h('div', { role: 'radiogroup', 'aria-label': t('Screenshot styles'), className: 'flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1' }, ...STYLES.map(s =>
              h('label', { key: s.id, className: 'flex h-9 cursor-pointer items-center gap-2 text-[13px] font-medium' },
                h('input', { type: 'radio', name: 'screenshot-style', value: s.id, 'data-share-look': s.id, checked: style === s.id, onChange: () => setStyle(s.id), className: 'size-[18px] accent-proto-primary' }), s.label))),
            style === 'canvas' ? h('div', { role: 'group', 'aria-label': t('Canvas background'), className: 'flex w-44 gap-0.5 rounded-xl bg-zinc-900/[.05] p-0.5 dark:bg-white/[.07]' },
              ...(['soft', 'dark', 'brand'] as Tone[]).map(tTone => h('button', { key: tTone, type: 'button', 'data-share-tone': tTone, 'aria-pressed': tone === tTone, onClick: () => setTone(tTone), className: `h-8 min-w-0 flex-1 truncate rounded-[10px] px-2 text-xs font-medium ${tone === tTone ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-white' : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white'}` }, tTone === 'brand' ? t('Indigo') : tTone === 'soft' ? t('Soft') : t('Dark')))) : null,
            h('div', { role: 'group', 'aria-label': t('Screenshot sizes'), className: 'flex flex-wrap gap-1.5' }, ...options.map(s => h('button', { key: s.id, type: 'button', 'data-share-size': s.id, 'aria-pressed': sizes.includes(s.id), onClick: () => setSizes(a => a.length === 1 && a.includes(s.id) ? a : flip(a, s.id)), className: `flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs font-medium ring-1 ring-inset ${sizes.includes(s.id) ? 'bg-proto-primary-soft text-proto-primary-soft-fg ring-proto-primary-ring/40' : 'text-zinc-600 ring-black/10 dark:text-zinc-300 dark:ring-white/15'}` },
              icon(`share-${s.id}`), s.label, s.id !== 'stage' ? h('span', { className: 'hidden tabular-nums opacity-60 sm:inline' }, s.w) : null)))),
          h('div', { 'data-share-scroll': '', className: 'min-h-0 flex-1 space-y-6 overflow-y-auto px-4 py-4 sm:px-6' },
            large ? h(CachedList<Subject>, {
              items: variants, itemKey: v => v.id, render: section, cacheSize: 6, overscan: 1, gap: 24,
              version: `${chosen.length}|${looks.length}`,
              estimate: (_v, width) => { const columns = matchMedia('(min-width:640px)').matches ? 3 : 2; const count = chosen.length * looks.length; return 48 + Math.ceil(count / columns) * (((width - (columns - 1) * 12) / columns) * .75 + 42) + Math.max(0, Math.ceil(count / columns) - 1) * 12 },
              initialIndex: Math.max(0, variants.findIndex(v => v.id === p.current)),
              onVisible: subjects => { const next = subjects.map(v => v.id); setVisible(was => was.length === next.length && was.every((id, i) => id === next[i]) ? was : next) },
            }) : variants.map(section))),
        h('footer', { className: 'shrink-0 space-y-2 border-t border-black/[.07] bg-white px-4 py-3 pb-[max(.75rem,env(safe-area-inset-bottom))] sm:px-6 dark:border-white/10 dark:bg-zinc-900' },
          h('div', { className: 'flex flex-wrap items-center justify-between gap-2' },
            h('p', { className: small, role: 'status' }, progress !== null ? t('{progress} of {total} PNGs', { progress, total: jobs.length }) : notice || tn(jobs.length, '{n} PNG · saved one by one', '{n} PNGs · saved one by one')),
            h('div', { className: 'flex gap-2' }, Object.keys(errors).length ? h('button', { type: 'button', disabled: progress !== null, className: button, onClick: () => { cache.current = {}; setRetry(n => n + 1) } }, t('Retry captures')) : null,
              progress !== null ? h('button', { type: 'button', className: button, onClick: cancel }, t('Stop')) : null,
              large && !files.length && navigator.canShare && matchMedia('(max-width:639px)').matches ? h('button', { type: 'button', disabled: !ready || progress !== null, className: button, onClick: () => void save(true) }, icon('share'), t('Prepare share')) : null,
              files.length && navigator.canShare?.({ files }) ? h('button', { type: 'button', disabled: progress !== null, className: button, onClick: shareFiles }, icon('share'), t('Share files')) : null,
              h('button', { type: 'button', 'data-share-download': '', disabled: !ready || progress !== null, onClick: () => void save(), className: 'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-proto-primary px-4 text-sm font-medium text-proto-primary-fg hover:bg-proto-primary-hover disabled:opacity-40' }, icon('download'), tn(jobs.length, 'Download {n} PNG', 'Download {n} PNGs')))),
          progress !== null ? h('progress', { value: progress, max: jobs.length, 'aria-label': t('Download progress'), className: 'block h-1 w-full accent-proto-primary' }) : null))))
}

export function createShare() {
  const host = document.createElement('div'); uiBox().append(host)
  const root = createRoot(host)
  let id = 0
  return (props: Props | null) => root.render(props ? h(Board, { ...props, key: ++id }) : null)
}
