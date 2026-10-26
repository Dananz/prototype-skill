// The viewer: what a share link opens (decision 19; the reference is viewer-board/C in session
// f64ced15). Not the owner's shell: no sidebar, decisions, stars, agent status, settings or device
// views, only the shared designs. A header with the share's prototypes and About; on a wide screen
// the desk of every design of the chosen prototype with the bar under it, on a phone one design and
// the switcher. Designs are mounted with the stack's own mount, so each runs exactly as in the
// session, tweaks at their defaults. Comments (the bar's second row, pins, counts) come in phase 1.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'
import type { Proto, Session, Variant } from '../shell'
import { shareInfo, shareScope } from '../mode'
import { t } from '../i18n'
import { numberOf } from '../variants'
import { Bar } from './bar'
import { Desk } from './desk'
import { Full } from './full'
import { Header, type Appearance } from './header'
import { Phone } from './phone'
import { Icon, MountsCtx, face, makeStore, surface, type Api, type Mounts, type Screen } from './ui'

type Mount = (el: HTMLElement, component: unknown) => () => void
const THEME_KEY = 'proto-theme'

function useWide() {
  const [w, setW] = useState(() => window.innerWidth)
  useEffect(() => {
    const on = () => setW(window.innerWidth)
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  return w >= 640
}

/** This viewer's theme: System, Light or Dark, kept in this browser. `?theme=` wins for the page (screenshots). */
function useAppearance() {
  const asked = new URLSearchParams(location.search).get('theme')
  const [appearance, set] = useState<Appearance>(() => {
    try { const v = localStorage.getItem(THEME_KEY); if (v === 'light' || v === 'dark') return v } catch { /* private mode */ }
    return 'system'
  })
  const system = matchMedia('(prefers-color-scheme: dark)')
  const [sysDark, setSysDark] = useState(system.matches)
  useEffect(() => {
    const on = (e: MediaQueryListEvent) => setSysDark(e.matches)
    system.addEventListener('change', on)
    return () => system.removeEventListener('change', on)
  }, [system])
  const dark = asked === 'dark' || asked === 'light' ? asked === 'dark' : appearance === 'system' ? sysDark : appearance === 'dark'
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
  }, [dark])
  const setAppearance = (a: Appearance) => {
    set(a)
    try { if (a === 'system') localStorage.removeItem(THEME_KEY); else localStorage.setItem(THEME_KEY, a) } catch { /* this load only */ }
  }
  return { appearance, setAppearance }
}

/** A flag outside React that main.ts raises when the host has a newer version. */
function makeFlag() {
  let on = false
  const subs = new Set<() => void>()
  return { get: () => on, raise: () => { if (!on) { on = true; subs.forEach(f => f()) } }, sub: (f: () => void) => { subs.add(f); return () => { subs.delete(f) } } }
}
type Flag = ReturnType<typeof makeFlag>

const screensOf = (p: Proto): Screen[] => p.variants.map((v, k) => ({ key: `${p.id}/${v.id}`, n: numberOf(v.id) || k + 1, name: v.name, v }))

function Viewer({ protos, newer }: { protos: Proto[]; newer: Flag }) {
  const wide = useWide()
  const root = useRef<HTMLDivElement>(null)
  const api = useRef<Api | null>(null)
  const [store] = useState(makeStore)
  const { appearance, setAppearance } = useAppearance()
  const [start] = useState(() => (shareScope?.start ?? '').split('/'))
  const [protoId, setProtoId] = useState(() => protos.some(p => p.id === start[0]) ? start[0] : protos[0].id)
  const proto = protos.find(p => p.id === protoId) ?? protos[0]
  const screens = screensOf(proto)
  const [sel, setSel] = useState(() => `${start[0]}/${start[1]}`)
  const i = Math.max(0, screens.findIndex(s => s.key === sel))
  const cur = screens[i]
  const size: [number, number] = proto.kind === 'phone' ? proto.screen : [1200, 750]
  // A prototype chosen in the header starts on its first design.
  useEffect(() => { if (!screens.some(s => s.key === sel)) setSel(screens[0].key) })
  const isNewer = useSyncExternalStore(newer.sub, newer.get)
  const facts = { owner: shareInfo?.owner ?? '', version: shareInfo?.version ?? 1, updatedAt: shareInfo?.updatedAt ?? new Date().toISOString() }

  // A design opened full size from the desk, and whether it is on its way back into its preview.
  const [open, setOpen] = useState<string | null>(null)
  const [closing, setClosing] = useState(false)
  const full = wide && open !== null
  const openDesign = (key: string) => { setSel(key); setOpen(key); setClosing(false) }
  const back = () => { if (open && !closing) setClosing(true) }
  const closed = () => {
    const key = open
    setOpen(null); setClosing(false)
    if (key) requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-board="${CSS.escape(key)}"] [data-frame]`)?.focus({ preventScroll: true }))
  }
  // Esc goes back to the desk, unless the design used it (a menu of its own closing).
  useEffect(() => {
    if (!full) return
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented) back() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  })
  // Another prototype chosen in the header goes back to its desk.
  useEffect(() => { setOpen(null); setClosing(false) }, [protoId])

  const go = (key: string) => { setSel(key); api.current?.show(key) }
  const step = (d: number) => {
    const n = i + d
    if (n < 0 || n >= screens.length) return
    if (full) { setSel(screens[n].key); setOpen(screens[n].key) } else go(screens[n].key)
  }

  return (
    <div ref={root} data-viewer dir="ltr" className={`${face} ${surface} relative flex h-full flex-col overflow-hidden text-zinc-900 antialiased dark:text-zinc-100`}>
      <Header protos={protos} cur={proto} choose={setProtoId} wide={wide} facts={facts} appearance={appearance} setAppearance={setAppearance} root={root} />
      {isNewer && (
        <div className={`pointer-events-none absolute inset-x-0 z-20 flex justify-center px-4 ${wide ? 'top-16' : 'top-14'} [&>*]:pointer-events-auto`}>
          <div role="status" data-newer dir={document.documentElement.dir} className="flex items-center gap-3 rounded-full border border-zinc-200 bg-white/95 py-1.5 ps-4 pe-1.5 text-[13px] shadow-lg backdrop-blur dark:border-white/10 dark:bg-zinc-900/95">
            <span className="text-zinc-700 dark:text-zinc-300">{t('There is a newer version')}</span>
            <button onClick={() => location.reload()} className="inline-flex h-7 items-center gap-1.5 rounded-full bg-sky-500 px-3 text-[12px] font-medium text-white"><Icon name="reload" className="size-3.5" />{t('Reload')}</button>
          </div>
        </div>
      )}
      <div className="relative min-h-0 flex-1">
        {wide
          ? <>
            <Desk key={proto.id} screens={screens} size={size} phone={proto.kind === 'phone'} sel={cur.key} store={store} api={api}
              onCentre={key => { if (!full && key !== cur.key) setSel(key) }} open={openDesign} hidden={full} />
            {full && <Full screen={cur} size={size} phone={proto.kind === 'phone'} closing={closing} onClosed={closed} />}
          </>
          : <Phone screens={screens} i={i} go={go} step={step} root={root} />}
      </div>
      {wide && <Bar screens={screens} i={i} go={go} step={step} store={store} api={api} root={root} full={full} back={back} />}
    </div>
  )
}

/**
 * Mounts the viewer into el. protos: the share's registry (only what was shared). Resolves the
 * page's ready mark (`data-ready`, which screenshots wait for) once the first designs are on it.
 * newer(): the host has a version above this page's; a quiet banner offers the reload.
 */
export function createViewer(el: HTMLElement, opts: { mount: Mount; protos: Proto[]; session: Session }) {
  const order = shareScope?.protos.map(s => s.id) ?? []
  const protos = [...opts.protos].filter(p => p.variants.length)
    .sort((a, b) => (order.indexOf(a.id) + 1 || Infinity) - (order.indexOf(b.id) + 1 || Infinity))
  document.title = shareInfo?.title || protos[0]?.title || opts.session.name
  const loaded = new Map<string, Promise<unknown>>()
  let first: () => void = () => {}
  const mountedOnce = new Promise<void>(ok => { first = ok })
  const mounts: Mounts = {
    mount: opts.mount,
    load: (v: Variant) => { if (!loaded.has(v.file)) loaded.set(v.file, v.load()); return loaded.get(v.file)! },
    mounted: () => first(),
  }
  const newer = makeFlag()
  const root = createRoot(el)
  root.render(protos.length
    ? <MountsCtx.Provider value={mounts}><Viewer protos={protos} newer={newer} /></MountsCtx.Provider>
    : <p className={`${face} p-8 text-sm text-zinc-500`}>{t('Nothing was shared here.')}</p>)
  const wait = (ms: number) => new Promise(r => setTimeout(r, ms))
  Promise.all([document.fonts.ready, Promise.race([mountedOnce, wait(5000)])])
    .then(() => requestAnimationFrame(() => requestAnimationFrame(() => { document.documentElement.dataset.ready = '1' })))
  return { newer: newer.raise }
}
