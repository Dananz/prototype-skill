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
import { surface, type Screen } from './ui'

const EASE = 'cubic-bezier(.2,.8,.2,1)'
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
const frameSrc = (key: string, dark: boolean) => {
  const q = new URLSearchParams({ frame: key, theme: dark ? 'dark' : 'light', lang })
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
  const [ready, setReady] = useState(false)
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
    setReady(false)
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
  const src = useMemo(() => frameSrc(screen.key, darkNow.current), [screen.key])
  const was = useRef(dark)
  useEffect(() => {
    if (was.current === dark) return
    was.current = dark
    frame.current?.contentWindow?.postMessage({ protoViewer: 'theme', dark }, '*')
  }, [dark])

  // From the preview's place and size on the desk to the card's own, or back.
  const flip = (reverse: boolean) => {
    const c = card.current, from = deskFrame(screen.key)
    if (!c || !from || matchMedia('(prefers-reduced-motion: reduce)').matches) return null
    const to = c.getBoundingClientRect()
    const at = `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width}, ${from.height / to.height})`
    const frames = [{ transform: at, opacity: 0.6 }, { transform: 'none', opacity: 1 }]
    const opts = { duration: 240, easing: EASE, fill: 'both' as const }
    back.current?.animate([{ opacity: 0 }, { opacity: 1 }], { ...opts, direction: reverse ? 'reverse' : 'normal' })
    return c.animate(frames, { ...opts, direction: reverse ? 'reverse' : 'normal' })
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
                  <iframe key={screen.key} ref={frame} src={src} title={`#${screen.n} ${screen.name}`}
                    className={`block border-0 bg-transparent transition-opacity duration-200 motion-reduce:transition-none ${ready ? 'opacity-100' : 'opacity-0'}`}
                    style={{ width: d.w, height: d.h }} />
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
