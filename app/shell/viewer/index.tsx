// The viewer: what a share link opens (decision 19; the reference is viewer-board/C in session
// f64ced15). Not the owner's shell: no sidebar, decisions, stars, agent status, settings or device
// views, only the shared designs. A header with the share's prototypes and About; on a wide screen
// the desk of every design of the chosen prototype with the bar under it, on a phone one design and
// the switcher. Designs are mounted with the stack's own mount, so each runs exactly as in the
// session, tweaks at their defaults. A design open full size runs in a frame of this same page at a
// device's size (full.tsx); that frame is this page too, opened with ?frame=, and draws only the
// design (framed.tsx). Who is looking comes from the host (api/config, api/me): Sign in with GitHub,
// or the signed-in viewer at the top right. Comments (the bar's second row, pins, counts) come next.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'
import type { Proto, Session, Variant } from '../shell'
import { shareInfo, shareScope } from '../mode'
import { t } from '../i18n'
import { numberOf } from '../variants'
import { Bar } from './bar'
import { Desk } from './desk'
import { Full } from './full'
import { Header, type Account, type Appearance, type Me } from './header'
import { Phone } from './phone'
import { clampZoom, loadDevice, saveDevice, type Device } from './device'
import { createFramed, frameKey, frameMsg, holdZoom, zoomKey } from './framed'
import { Icon, MountsCtx, closePopups, face, makeStore, surface, type Api, type Mounts, type Screen } from './ui'

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
  return { appearance, setAppearance, dark }
}

/** Where Sign in with GitHub starts: the share's own `_in/start` (at /s/<id>/ in path mode, else at
 *  the root), which sends the viewer on to the apex and brings them back to `back`. None from disk. */
function signInUrl(): string | null {
  if (!/^https?:$/.test(location.protocol)) return null
  const base = location.pathname.match(/^\/s\/[a-z0-9]+\//)?.[0] ?? '/'
  return `${location.origin}${base}_in/start?back=${encodeURIComponent(location.pathname + location.hash)}`
}

const ask = (path: string, init?: RequestInit) => fetch(path, { ...init, headers: { 'X-Proto': '1' }, cache: 'no-store' })
  .then(r => (r.ok ? r.json() : Promise.reject(r.status)))

/** Whether comments are on for this link, and who is signed in: asked of the host once, at start. */
function useAccount(): Account {
  const [comments, setComments] = useState(false)
  const [me, setMe] = useState<Me | null | undefined>(undefined)
  const [signIn] = useState(signInUrl)
  useEffect(() => {
    if (!/^https?:$/.test(location.protocol)) return setMe(null)
    ask('api/config').then(c => setComments(c?.comments === true), () => {})
    ask('api/me').then(m => setMe(m && typeof m.login === 'string' ? m : null), () => setMe(null))
  }, [])
  const signOut = () => { void ask('api/signout', { method: 'POST' }).catch(() => {}).finally(() => setMe(null)) }
  return { me, comments, signIn, signOut }
}

/** Whether a popup of the viewer's own is open (Base UI marks its trigger). */
const popupOpen = (root: HTMLElement | null) => !!root?.querySelector('[data-popup-open]')

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
  const { appearance, setAppearance, dark } = useAppearance()
  const account = useAccount()
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
  // The device and zoom of the design open full size, this viewer's own (kept in this browser), and
  // the zoom it is drawn at now (Fit's own while zoom is 0).
  const [device, setDevice] = useState<Device>(loadDevice)
  const [shown, setShown] = useState({ z: 1, fit: 1 })
  const [menu, setMenu] = useState(false)
  const patch = (d: Partial<Device>) => setDevice(was => { const n = { ...was, ...d }; saveDevice(n); return n })
  // The zoom last asked for, ahead of the render that draws it: a fast wheel or pinch sends several
  // steps between two renders, and each builds on the one before.
  const at = useRef(shown)
  useEffect(() => { at.current = shown }, [shown])
  const zoomBy = (f: number) => {
    const zoom = clampZoom(at.current.z * 100 * f, at.current.fit * 100)
    at.current = { ...at.current, z: zoom ? zoom / 100 : at.current.fit }
    patch({ zoom })
  }
  const zoomKeyed = (k: '0' | '1' | '+' | '-') => {
    if (k === '+' || k === '-') return zoomBy(k === '+' ? 1.25 : 1 / 1.25)
    at.current = { ...at.current, z: k === '1' ? 1 : at.current.fit }
    patch({ zoom: k === '1' ? 100 : 0 })
  }
  const now = useRef({ full, back, zoomBy, zoomKeyed })
  now.current = { full, back, zoomBy, zoomKeyed }
  useEffect(() => { if (!full) setMenu(false) }, [full])
  // Esc always goes back to the desk, a popup of the viewer's own closing first (Base UI closes it).
  // Heard before anything else, so the popup is still open when it is asked. The zoom keys, ⌘/Ctrl+
  // wheel and a pinch zoom the device, never the page. The design's own frame tells the same (framed.tsx).
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const n = now.current
      if (!n.full) return
      if (e.key === 'Escape') { if (!popupOpen(root.current)) n.back(); return }
      const k = !e.defaultPrevented && zoomKey(e)
      if (k) { e.preventDefault(); n.zoomKeyed(k) }
    }
    const message = (e: MessageEvent) => {
      const m = frameMsg(e.data), n = now.current
      const f = document.querySelector<HTMLIFrameElement>('[data-full] iframe')
      if (!m || !n.full || !f || e.source !== f.contentWindow) return
      // Esc from the design closes an open popup of the viewer first, as Esc out here does; a press in it closes them.
      if (m.protoViewer === 'esc') { if (!closePopups() && !popupOpen(root.current)) n.back() }
      else if (m.protoViewer === 'press') closePopups()
      else if (m.protoViewer === 'key') n.zoomKeyed(m.key)
      else if (m.protoViewer === 'zoom') n.zoomBy(m.by)
    }
    window.addEventListener('keydown', key, true)
    window.addEventListener('message', message)
    const off = holdZoom(window, by => now.current.zoomBy(by), () => now.current.full)
    return () => { window.removeEventListener('keydown', key, true); window.removeEventListener('message', message); off() }
  }, [])
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
      <Header protos={protos} cur={proto} choose={setProtoId} wide={wide} facts={facts} appearance={appearance} setAppearance={setAppearance} account={account} root={root} />
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
            {full && <Full screen={cur} phone={proto.kind === 'phone' ? proto.screen : null} device={device} dark={dark} closing={closing} onClosed={closed}
              report={(z, fit) => setShown(s => (s.z === z && s.fit === fit ? s : { z, fit }))} />}
          </>
          : <Phone screens={screens} i={i} go={go} step={step} root={root} />}
      </div>
      {wide && <Bar screens={screens} i={i} go={go} step={step} store={store} api={api} root={root} back={back}
        full={full ? { device, set: patch, shown: shown.z, phone: proto.kind === 'phone', menu, setMenu } : null} />}
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
  // In a frame of the full view: the one design, nothing else.
  if (frameKey) {
    const screen = protos.flatMap(screensOf).find(s => s.key === frameKey)
    createFramed(el, screen, mounts)
    return { newer: () => {}, framed: true }
  }
  const newer = makeFlag()
  const root = createRoot(el)
  root.render(protos.length
    ? <MountsCtx.Provider value={mounts}><Viewer protos={protos} newer={newer} /></MountsCtx.Provider>
    : <p className={`${face} p-8 text-sm text-zinc-500`}>{t('Nothing was shared here.')}</p>)
  const wait = (ms: number) => new Promise(r => setTimeout(r, ms))
  Promise.all([document.fonts.ready, Promise.race([mountedOnce, wait(5000)])])
    .then(() => requestAnimationFrame(() => requestAnimationFrame(() => { document.documentElement.dataset.ready = '1' })))
  return { newer: newer.raise, framed: false }
}
