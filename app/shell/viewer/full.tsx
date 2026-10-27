// One design opened full size from the desk: live and interactive, between the header and the bar,
// at a device's size (decision 21): a phone, a tablet (upright or on its side) or a desktop, as the
// owner's device view has them, or a phone prototype's own screen. The design runs in a frame of
// this same page (framed.tsx), so its breakpoints see the device, not the window, and it scrolls
// inside itself. The phone and the tablet are drawn as devices, the desktop as the owner's sheet.
//
// The zoom scales the device only, with CSS zoom on its frame, never a transform and never the
// page: Fit (the whole device in view, never above 100 %) or 25 % to 200 %, centred, the space
// around it scrolling when it is bigger than the view. It grows out of its preview on the desk and
// shrinks back into it (240 ms; none with reduced motion). The desk stays where it was underneath,
// so going back finds it at the same zoom and place.
//
// Comments: the design's pins over it (pins.tsx), and pin mode, which listens in the frame's own
// document (same origin over http(s)); a frame that can't be reached gets neither.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { dims, type Size } from '../view/sizes'
import { shareInfo } from '../mode'
import { lang } from '../i18n'
import type { Device } from './device'
import { frameMsg } from './framed'
import { useTalk } from './comments'
import { Pins } from './pins'
import { Mounted, surface, type Screen } from './ui'

const SMOOTH = 'cubic-bezier(.22,1,.36,1)' // ease-out quint: a quick start and a long, soft landing
const BAR = 76 // the bar's room at the bottom (one row)
const BAR2 = 128 // and with its comment row
const PAD = 24 // the desk around the device at Fit

// The owner's phone (shell.ts PHONE, its bezel and island in shell.css), and a tablet in the same
// materials: a dark bezel, the thin metal edge, the shadow.
const PHONE = 'proto-phone shrink-0 border-[10px] bg-white text-zinc-900 dark:bg-black dark:text-white'
const TABLET = 'relative shrink-0 rounded-[36px] border-[14px] border-[#09090b] bg-white shadow-[0_0_0_1px_#66666b,0_0_0_3px_#303034,0_0_0_4px_#77777c,0_0_0_5px_#29292c,0_18px_36px_-12px_rgb(0_0_0/.4)] dark:bg-black'
const SHEET = 'relative shrink-0 overflow-hidden rounded-[10px] bg-white shadow-[0_18px_44px_-18px_rgb(0_0_0/.35)] ring-1 ring-black/[.08] dark:bg-zinc-950 dark:ring-white/[.12]'
const BEZEL: Record<Size, number> = { phone: 10, tablet: 14, desktop: 0 }

const deskFrame = (key: string) => document.querySelector(`[data-board="${CSS.escape(key)}"] [data-frame]`)?.getBoundingClientRect() ?? null

/** Where the frame loads this page: the design alone, in the viewer's theme and language, the version pinned (the host caches it). */
const frameSrc = (key: string, dark: boolean, size: Size) => {
  const q = new URLSearchParams({ frame: key, theme: dark ? 'dark' : 'light', device: size, lang })
  if (shareInfo) q.set('v', String(shareInfo.version))
  return `${location.pathname}?${q}`
}

/**
 * phone: a phone prototype (screen: its size), drawn as a phone at any device.
 * report: the zoom the device is drawn at, for the bar's readout and the zoom keys.
 */
export function Full({ screen, phone, device, dark, closing, onClosed, report, row, setReach }: {
  screen: Screen; phone: [number, number] | null; device: Device; dark: boolean; closing: boolean; onClosed: () => void; report: (z: number, fit: number) => void
  /** The bar has its comment row. */
  row: boolean
  /** Whether the frame's design can be reached (pins and pin mode need it). */
  setReach: (r: boolean) => void
}) {
  const talk = useTalk()
  const size: Size = phone ? 'phone' : device.size
  const d = phone ? { w: phone[0], h: phone[1] } : dims(device.size, device.land)
  const b = BEZEL[size]
  const W = d.w + 2 * b, H = d.h + 2 * b
  const area = useRef<HTMLDivElement>(null)
  const card = useRef<HTMLDivElement>(null)
  const back = useRef<HTMLDivElement>(null)
  const frame = useRef<HTMLIFrameElement>(null)
  const [room, setRoom] = useState<[number, number] | null>(null)
  // Ready is per design, so a new design is never shown as ready for the old one's sake.
  const [readyKey, setReadyKey] = useState<string | null>(null)
  const ready = readyKey === screen.key
  const setReady = (on: boolean) => setReadyKey(on ? screen.key : null)
  // Until the live design has faded in, its preview stands under the frame (desktop only: the preview
  // lays out at the window's breakpoints, as on the desk), so opening or switching never shows a blank card.
  const [settled, setSettled] = useState<string | null>(null)
  useEffect(() => {
    if (!ready) return
    const t = setTimeout(() => setSettled(screen.key), 200)
    return () => clearTimeout(t)
  }, [ready, screen.key])
  useLayoutEffect(() => {
    const el = area.current!
    const measure = () => setRoom(r => (r && r[0] === el.clientWidth && r[1] === el.clientHeight ? r : [el.clientWidth, el.clientHeight]))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const fit = room ? Math.max(0.05, Math.min(1, (room[0] - 2 * PAD) / W, (room[1] - 2 * PAD) / H)) : 1
  // Snapped so the design's width is whole device pixels: its page then measures exactly the
  // device's width (a fraction is floored, and 834 became 833 to the design's breakpoints).
  const z = Math.max(1, Math.round(d.w * (device.zoom ? device.zoom / 100 : fit))) / d.w
  useEffect(() => { report(z, fit) }, [z, fit])

  // A new zoom keeps the middle of the view where it was.
  const mid = useRef<[number, number]>([0.5, 0.5])
  useEffect(() => {
    const a = area.current!
    const keep = () => { mid.current = [(a.scrollLeft + a.clientWidth / 2) / a.scrollWidth, (a.scrollTop + a.clientHeight / 2) / a.scrollHeight] }
    a.addEventListener('scroll', keep, { passive: true })
    return () => a.removeEventListener('scroll', keep)
  }, [])
  useLayoutEffect(() => {
    const a = area.current!
    a.scrollLeft = mid.current[0] * a.scrollWidth - a.clientWidth / 2
    a.scrollTop = mid.current[1] * a.scrollHeight - a.clientHeight / 2
  }, [z, W, H])

  // The page in the frame says it is ready, and asks for nothing else; the theme follows the viewer's.
  useEffect(() => {
    const ok = (e: MessageEvent) => { if (e.source === frame.current?.contentWindow && frameMsg(e.data)?.protoViewer === 'ready') setReady(true) }
    addEventListener('message', ok)
    const f = frame.current
    const load = () => { try { if (f?.contentDocument?.documentElement.dataset.ready) setReady(true) } catch { /* opaque: its first message says it */ } }
    const poll = setInterval(load, 100)
    const give = setTimeout(() => setReady(true), 4000)
    return () => { removeEventListener('message', ok); clearInterval(poll); clearTimeout(give) }
  }, [screen.key])
  // The frame's address is made once per design, in the theme of that moment; a later theme goes by
  // message, so the open design keeps its state (what was typed, where it scrolled).
  const darkNow = useRef(dark)
  darkNow.current = dark
  const sizeNow = useRef(size)
  sizeNow.current = size
  const src = useMemo(() => frameSrc(screen.key, darkNow.current, sizeNow.current), [screen.key])
  // A switch keeps the design shown so far under the next one until the next is ready and has faded
  // in over it: one design crossfades into the other at any device, never through an empty screen.
  // The last design that settled stays under the frame (in the same render the switch happens in, so it
  // is never unmounted) until the new one has faded in over it.
  const [last, setLast] = useState<{ key: string; src: string } | null>(null)
  useEffect(() => { if (settled === screen.key) setLast({ key: screen.key, src }) }, [settled, screen.key])
  const prev = last && last.key !== screen.key ? last : null
  useEffect(() => { frame.current?.contentWindow?.postMessage({ protoViewer: 'device', size }, '*') }, [size, ready])
  const was = useRef(dark)
  useEffect(() => {
    if (was.current === dark) return
    was.current = dark
    frame.current?.contentWindow?.postMessage({ protoViewer: 'theme', dark }, '*')
  }, [dark])

  // From the preview's place and size on the desk to the card's own, or back.
  // Scaled from the card's top-left corner (the translate is measured corner to corner); a preview that
  // is off screen on the desk isn't flown to: the card fades in place instead.
  const flip = (reverse: boolean) => {
    const c = card.current, from = deskFrame(screen.key), view = area.current?.getBoundingClientRect()
    if (!c || matchMedia('(prefers-reduced-motion: reduce)').matches) return null
    const to = c.getBoundingClientRect()
    const seen = !!from && !!view && from.width > 0 && from.right > view.left && from.left < view.right && from.bottom > view.top && from.top < view.bottom
    const at = seen ? `translate(${from!.left - to.left}px, ${from!.top - to.top}px) scale(${from!.width / to.width}, ${from!.height / to.height})` : 'scale(.96)'
    // Played forwards both ways (never reversed: a reversed ease-out lands with a jolt). Going back it
    // keeps its look until it sits on its preview, then melts into it.
    const frames = !reverse
      ? [{ transform: at, opacity: seen ? 0.6 : 0 }, { transform: 'none', opacity: 1 }]
      : seen ? [{ transform: 'none', opacity: 1 }, { transform: at, opacity: 1, offset: 0.8 }, { transform: at, opacity: 0 }]
        : [{ transform: 'none', opacity: 1 }, { transform: at, opacity: 0 }]
    const opts = { duration: seen ? (reverse ? 380 : 300) : 200, easing: SMOOTH, fill: 'both' as const }
    back.current?.animate(reverse ? [{ opacity: 1 }, { opacity: 0 }] : [{ opacity: 0 }, { opacity: 1 }], { ...opts, easing: reverse ? 'ease-in-out' : SMOOTH })
    c.style.transformOrigin = seen ? '0 0' : '50% 50%'
    return c.animate(frames, opts)
  }
  const opened = useRef(false)
  useLayoutEffect(() => {
    if (!room || opened.current) return
    opened.current = true
    // Once grown, nothing of the animation stays on the card.
    const a = flip(false)
    a?.finished.then(() => a.cancel(), () => {})
  }, [room])
  useLayoutEffect(() => {
    if (!closing) return
    const a = flip(true)
    if (!a) return onClosed()
    a.finished.then(onClosed, onClosed)
  }, [closing])

  // The design in the frame, when its document can be reached: same origin over http(s), never from disk.
  const mount = useCallback(() => { try { return frame.current?.contentDocument?.querySelector<HTMLElement>('[data-mount]') ?? null } catch { return null } }, [])
  useEffect(() => {
    if (!ready) return
    let reach = false
    try { reach = !!frame.current?.contentDocument?.documentElement } catch { /* opaque */ }
    setReach(reach)
    return () => setReach(false)
  }, [ready, screen.key])
  const at = useCallback(() => { try { return frame.current?.contentDocument ? frame.current.contentWindow : null } catch { return null } }, [])
  const view = useCallback(() => ({ size, w: d.w, h: d.h }), [size, d.w, d.h])

  // The frame keeps its page (what was typed, where it scrolled) through a new size or zoom; a new design is a new page.
  const shell = size === 'phone' ? PHONE : size === 'tablet' ? TABLET : SHEET
  const screenCls = size === 'phone' ? 'h-full overflow-hidden' : size === 'tablet' ? 'h-full overflow-hidden rounded-[22px]' : 'h-full'
  return (
    <div data-full className="absolute inset-0 isolate z-[5]">
      <div ref={back} className={`absolute inset-0 ${surface}`} />
      <div ref={area} data-full-area className="absolute inset-x-0 top-0 overflow-auto overscroll-contain [scrollbar-width:thin]" style={{ bottom: row ? BAR2 : BAR }}>
        <div className="flex h-max min-h-full w-max min-w-full items-center justify-center" style={{ padding: PAD }}>
          {room && (
            <div ref={card} data-full-card className="shrink-0" style={{ width: W * z, height: H * z }}>
              <div data-device-frame={size} className={shell} style={{ width: W, height: H, zoom: z }}>
                <div data-phone-screen={size === 'phone' ? '' : undefined} className={`relative bg-white dark:bg-zinc-950 ${screenCls}`}>
                  {/* The frame shown now comes first, and the one switched from after it, so React never moves a
                      frame (a moved frame reloads); the stacking puts the new one on top. */}
                  <iframe key={screen.key} ref={frame} src={src} title={`#${screen.n} ${screen.name}`}
                    className={`relative z-[2] block border-0 bg-white transition-opacity duration-200 dark:bg-zinc-950 motion-reduce:transition-none ${ready ? 'opacity-100' : 'opacity-0'}`}
                    style={{ width: d.w, height: d.h }} />
                  {prev && (
                    <iframe key={prev.key} src={prev.src} aria-hidden="true" tabIndex={-1} title=""
                      className="pointer-events-none absolute start-0 top-0 z-[1] block border-0 bg-white dark:bg-zinc-950" style={{ width: d.w, height: d.h }} />
                  )}
                  {size === 'desktop' && !prev && settled !== screen.key && (
                    <div key="preview" aria-hidden="true" data-full-preview className="absolute inset-0 z-[1] overflow-hidden [&_*]:![animation-delay:-60s] [&_*]:![animation-play-state:paused]">
                      <Mounted key={screen.key} v={screen.v} live inert className="pointer-events-none h-full overflow-hidden" />
                    </div>
                  )}
                  {ready && talk.reach && <Pins variant={screen.key} mount={mount} kind="full" ready={ready} pick={{ on: talk.pinMode, at, view }} scale={1 / z} />}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
