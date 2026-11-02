// A design's page as a picture, for a gallery card.
import { useEffect, useState } from 'react'
import type { Variant } from '../shell'

type Mount = (el: HTMLElement, component: unknown) => () => void
// A gallery card shows its page as a still, once its entrance settled, instead of the live page: a page
// full of live designs loads every one of them and keeps them all animating. The dev server takes them
// in headless Chrome (app/stills.mjs), at the screen's own size and 2x, with a small one for a card, and
// keeps them on disk until its prototype's files change. Where the server can't (no Chrome) the page
// takes them itself, one at a time, in a hidden box of the card's frame.
type Shot = { url: string; thumb?: string }
// A still asked for again while it waits follows the latest asker: whether it's still wanted.
type Ask = { job: Promise<Shot | null>; wanted: () => boolean }
const stills = new Map<string, Shot>(), latest = new Map<string, Shot>(), asked = new Map<string, Ask>()
type Served = { url?: string; thumb?: string; error?: string }
const heard = new Map<string, (r: Served) => void>()
if (import.meta.hot) import.meta.hot.on('proto:still', (d: Served & { hash: string }) => { heard.get(d.hash)?.(d); heard.delete(d.hash) })
let noServer = !import.meta.hot
/** The server's still of a route, once it's taken; null where the server takes none. */
async function served(route: string, w: number, h: number, theme: string): Promise<Served | null> {
  if (noServer) return null
  try {
    const r = await fetch('/__proto/still', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ route, w: Math.round(w), h: Math.round(h), theme }) })
    if (!r.ok) { if (r.status === 404 || r.status === 405) noServer = true; return null }
    const d = await r.json() as Served & { hash: string; pending?: boolean; unavailable?: boolean }
    if (d.unavailable) { noServer = true; return null }
    if (!d.pending) return d
    return await new Promise<Served>(ok => {
      heard.set(d.hash, ok)
      setTimeout(() => { if (heard.get(d.hash) === ok) { heard.delete(d.hash); ok({ error: 'took too long' }) } }, 30_000)
    })
  } catch { return null }
}
// The stills waiting: three asked of the server at once (it takes them in three tabs), one at a time
// where the page takes them itself.
const waiting: { run: () => Promise<void> }[] = []
let taking = 0
async function pump() {
  if (taking >= (noServer ? 1 : 3)) return
  taking++
  while (waiting.length) await waiting.shift()!.run()
  taking--
}
const SETTLE_MIN = 2000, SETTLE_MAX = 4500
/** A still the page takes itself is given up after this, so a design that hangs holds up none behind it. */
const TAKE_MS = 20_000
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
/** At most `ms` of waiting on `p`. */
const most = (p: Promise<unknown>, ms = 2000) => Promise.race([p, sleep(ms)])
/** Waits out the entrance: a floor (script-driven motion can't be seen), then until no finite animation
 *  runs. Fonts and images get a few seconds each: one that never loads is taken as it is. */
async function settle(box: HTMLElement) {
  const t0 = performance.now()
  await sleep(SETTLE_MIN)
  while (performance.now() - t0 < SETTLE_MAX && box.getAnimations({ subtree: true }).some(a => a.playState === 'running' && a.effect?.getTiming().iterations !== Infinity)) await sleep(150)
  await most(document.fonts.ready)
  await most(Promise.all([...box.querySelectorAll('img')].map(i => i.decode().catch(() => {}))))
}
function stillOf(key: string, route: string, v: Variant, w: number, h: number, scale: number, mount: Mount, wanted: () => boolean): Promise<Shot | null> {
  const had = asked.get(key)
  if (had) { had.wanted = wanted; return had.job }
  let done: (u: Shot | null) => void = () => {}
  const job = new Promise<Shot | null>(r => { done = r })
  const take = async (): Promise<Shot | null> => {
    if (!ask.wanted()) { asked.delete(key); return null }
    const dark = document.documentElement.classList.contains('dark')
    const got = await served(route, w, h, dark ? 'dark' : 'light')
    if (got?.url) { const shot = { url: got.url, thumb: got.thumb }; stills.set(key, shot); latest.set(route, shot); return shot }
    if (got?.error && !ask.wanted()) { asked.delete(key); return null }
    const box = document.createElement('div')
    box.dataset.mount = ''; box.dataset.galleryCapture = ''; box.inert = true; box.dir = 'ltr'
    if (v.theme) box.dataset.protoTheme = v.theme
    box.style.cssText = `position:fixed;left:0;top:0;width:${w}px;height:${h}px;overflow:hidden;opacity:0;pointer-events:none;contain:strict;z-index:-1`
    document.body.append(box)
    let off: (() => void) | null = null
    try {
      const late = sleep(TAKE_MS).then((): never => { throw new Error('took too long') })
      late.catch(() => {}) // a still taken in time leaves it unheard
      off = mount(box, await Promise.race([v.load(), late]))
      await Promise.race([settle(box), late])
      const { domToCanvas } = await import('modern-screenshot')
      const canvas = await Promise.race([domToCanvas(box, {
        scale, width: w, height: h, backgroundColor: dark ? '#09090b' : '#ffffff',
        style: { opacity: '1', position: 'static', zIndex: 'auto' },
        filter: n => !(n.nodeType === 1 && (n as Element).matches('[data-proto-ui], vite-error-overlay')),
      }), late])
      const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, 'image/webp', 0.9))
      if (!blob) throw new Error('no still')
      const shot = { url: URL.createObjectURL(blob) }
      stills.set(key, shot); latest.set(route, shot)
      return shot
    } catch { asked.delete(key); return null }
    finally { try { off?.() } catch { /* gone */ } box.remove() }
  }
  const ask: Ask = { job, wanted }
  waiting.push({ run: () => take().then(done, () => done(null)) })
  asked.set(key, ask)
  void pump(); void pump(); void pump()
  return job
}
export function Still({ v, route, w, h, size, want, stamp, mount }: { v: Variant | undefined; route: string; w: number; h: number; size: number; want: boolean; stamp: string; mount: Mount }) {
  // Taken in the tab: sharp at the card's size, on this screen.
  const scale = Math.round(Math.min(2, devicePixelRatio || 1) * size * 100) / 100
  const key = `${route}|${stamp}|${noServer ? scale : `${Math.round(w)}x${Math.round(h)}`}|${document.documentElement.classList.contains('dark') ? 'dark' : 'light'}`
  // The last still of this route shows while a new one is taken.
  const [shot, setShot] = useState<Shot | null>(() => stills.get(key) ?? latest.get(route) ?? null)
  useEffect(() => {
    const have = stills.get(key)
    if (have) { setShot(have); return }
    if (!want || !v) return
    let gone = false
    stillOf(key, route, v, w, h, scale, mount, () => !gone).then(u => { if (!gone && u) setShot(u) })
    return () => { gone = true }
  }, [key, want, v, mount]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!shot) return null
  return <img data-gallery-still src={shot.thumb ?? shot.url} alt="" draggable={false} decoding="async" className="pointer-events-none absolute inset-0 h-full w-full object-cover object-top" />
}
