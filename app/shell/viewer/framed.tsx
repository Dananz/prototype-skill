// One design alone, as the full view frames it (full.tsx): this same page opened in a frame with
// ?frame=<proto>/<variant>, so the design's own breakpoints see the device's width, not the
// window's (decision 21; the owner's device view frames its page for the same reason). The page in
// the frame draws only the design, scrolling inside itself, in the theme the viewer gives it, and
// keeps to itself: no header, no bar, nothing asked of the host, nothing written to this browser.
//
// What a frame's document hears stays in it, so it tells the viewer outside, by message (a share
// opened from disk has an opaque origin, where the viewer can't reach into its frame): Esc (back to
// the desk), the viewer's zoom keys, and a pinch or ⌘/Ctrl+wheel, which it keeps from zooming the
// browser's page and hands on as the frame's zoom.
import { createRoot } from 'react-dom/client'
import { MountsCtx, Mounted, type Mounts, type Screen } from './ui'

/** The design this page is the frame of, when it is one. */
export const frameKey = new URLSearchParams(location.search).get('frame')

/** What a frame tells the viewer outside, and the viewer the frame. */
export type FrameMsg =
  | { protoViewer: 'ready' }
  | { protoViewer: 'esc' }
  | { protoViewer: 'key'; key: '0' | '1' | '+' | '-' }
  | { protoViewer: 'zoom'; by: number }
  | { protoViewer: 'theme'; dark: boolean }

/** A message of the viewer's own kind, or null. */
export const frameMsg = (data: unknown): FrameMsg | null =>
  data && typeof data === 'object' && typeof (data as { protoViewer?: unknown }).protoViewer === 'string' ? data as FrameMsg : null

/** A wheel's step as a zoom factor, as the desk takes it. */
export const wheelBy = (dy: number) => Math.exp(-Math.max(-25, Math.min(25, dy)) * 0.01)

// Keys a field or a control keeps for itself.
const typing = (t: EventTarget | null) => !!(t as Element | null)?.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"])')

/**
 * Takes over the gestures that would zoom the page this listens on (a window or a frame's), and
 * hands them to `zoom` as a factor: ⌘/Ctrl+wheel and a trackpad's pinch (Chrome and Firefox send it
 * as Ctrl+wheel; Safari as gesture events), and two fingers. Returns the undoing.
 */
export function holdZoom(target: Window, zoom: (by: number) => void, on: () => boolean = () => true) {
  const wheel = (e: WheelEvent) => { if (!(e.ctrlKey || e.metaKey) || !on()) return; e.preventDefault(); zoom(wheelBy(e.deltaY)) }
  let g = 1
  const gStart = (e: Event) => { if (!on()) return; e.preventDefault(); g = 1 }
  const gChange = (e: Event) => { if (!on()) return; e.preventDefault(); const s = (e as Event & { scale: number }).scale; zoom(s / g); g = s }
  let d0 = 0
  const dist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY)
  const tStart = (e: TouchEvent) => { d0 = e.touches.length === 2 && on() ? dist(e.touches) : 0 }
  const tMove = (e: TouchEvent) => {
    if (e.touches.length !== 2 || !d0) return
    e.preventDefault()
    const d = dist(e.touches)
    zoom(d / d0); d0 = d
  }
  const tEnd = (e: TouchEvent) => { if (e.touches.length < 2) d0 = 0 }
  const opts = { passive: false, capture: true }
  target.addEventListener('wheel', wheel, opts)
  target.addEventListener('gesturestart', gStart, opts)
  target.addEventListener('gesturechange', gChange, opts)
  target.addEventListener('touchstart', tStart, { passive: true, capture: true })
  target.addEventListener('touchmove', tMove, opts)
  target.addEventListener('touchend', tEnd, true)
  target.addEventListener('touchcancel', tEnd, true)
  return () => {
    target.removeEventListener('wheel', wheel, true)
    target.removeEventListener('gesturestart', gStart, true)
    target.removeEventListener('gesturechange', gChange, true)
    target.removeEventListener('touchstart', tStart, true)
    target.removeEventListener('touchmove', tMove, true)
    target.removeEventListener('touchend', tEnd, true)
    target.removeEventListener('touchcancel', tEnd, true)
  }
}

/** The viewer's keys pressed in the frame: the zoom's (not while typing) and Esc, which always goes back. */
export function zoomKey(e: KeyboardEvent): '0' | '1' | '+' | '-' | null {
  if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return null
  return e.key === '0' || e.key === '1' ? e.key : e.key === '+' || e.key === '=' ? '+' : e.key === '-' || e.key === '_' ? '-' : null
}

/** Draws the one design of this frame into el, and resolves the page's ready mark once it is on. */
export function createFramed(el: HTMLElement, screen: Screen | undefined, mounts: Mounts) {
  const tell = (m: FrameMsg) => { if (parent !== window) parent.postMessage(m, '*') }
  const theme = (dark: boolean) => {
    document.documentElement.classList.toggle('dark', dark)
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
  }
  const asked = new URLSearchParams(location.search).get('theme')
  theme(asked ? asked === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches)
  addEventListener('message', e => { const m = frameMsg(e.data); if (e.source === parent && m?.protoViewer === 'theme') theme(m.dark) })
  // Bubbling, after the design's own handlers: a menu of its own closes, and the view still goes back.
  addEventListener('keydown', e => {
    if (e.key === 'Escape') return tell({ protoViewer: 'esc' })
    const k = !e.defaultPrevented && zoomKey(e)
    if (k) { e.preventDefault(); tell({ protoViewer: 'key', key: k }) }
  })
  holdZoom(window, by => tell({ protoViewer: 'zoom', by }))
  let ready = false
  const done = () => {
    if (ready) return
    ready = true
    requestAnimationFrame(() => requestAnimationFrame(() => { document.documentElement.dataset.ready = '1'; tell({ protoViewer: 'ready' }) }))
  }
  createRoot(el).render(screen
    ? <MountsCtx.Provider value={{ ...mounts, mounted: done }}>
      <div data-framed className="h-full bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
        <Mounted v={screen.v} live className="h-full overflow-auto overscroll-contain" />
      </div>
    </MountsCtx.Provider>
    : <></>)
  if (!screen) done()
  setTimeout(done, 5000)
}
