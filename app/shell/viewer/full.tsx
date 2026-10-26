// One design opened full size from the desk: live and interactive, filling the space between the
// header and the bar, scrolling inside itself as the shell's stage scrolls a design. A web design
// is drawn at its real 1200 px width when the window has room, else shrunk to the width with CSS
// zoom; a phone prototype is its screen, shrunk to fit. It grows out of its preview on the desk
// and shrinks back into it (240 ms; none with reduced motion). The desk stays where it was
// underneath, so going back finds it at the same zoom and place. The card contains the design's
// own position:fixed (drawers, toasts), as the shell's stage does; so does each preview's frame.
import { useLayoutEffect, useRef, useState } from 'react'
import { Mounted, surface, type Screen } from './ui'

const EASE = 'cubic-bezier(.2,.8,.2,1)'
const BAR = 76 // the bar's room at the bottom

const deskFrame = (key: string) => document.querySelector(`[data-board="${CSS.escape(key)}"] [data-frame]`)?.getBoundingClientRect() ?? null

export function Full({ screen, size, phone, closing, onClosed }: {
  screen: Screen; size: [number, number]; phone: boolean; closing: boolean; onClosed: () => void
}) {
  const [W, H] = size
  const area = useRef<HTMLDivElement>(null)
  const card = useRef<HTMLDivElement>(null)
  const back = useRef<HTMLDivElement>(null)
  const [room, setRoom] = useState<[number, number] | null>(null)
  useLayoutEffect(() => {
    const el = area.current!
    const measure = () => setRoom([el.clientWidth, el.clientHeight])
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // From the preview's place and size on the desk to the card's own, or back.
  const flip = (reverse: boolean) => {
    const c = card.current, from = deskFrame(screen.key)
    if (!c || !from || matchMedia('(prefers-reduced-motion: reduce)').matches) return null
    const to = c.getBoundingClientRect()
    const at = `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width}, ${from.height / to.height})`
    const frames = [{ transform: at, borderRadius: '6px' }, { transform: 'none' }]
    const opts = { duration: 240, easing: EASE, fill: 'both' as const }
    back.current?.animate([{ opacity: 0 }, { opacity: 1 }], { ...opts, direction: reverse ? 'reverse' : 'normal' })
    return c.animate(frames, { ...opts, direction: reverse ? 'reverse' : 'normal' })
  }
  const opened = useRef(false)
  useLayoutEffect(() => {
    if (!room || opened.current) return
    opened.current = true
    flip(false)
  }, [room])
  useLayoutEffect(() => {
    if (!closing) return
    const a = flip(true)
    if (!a) return onClosed()
    a.finished.then(onClosed, onClosed)
  }, [closing])

  const z = room ? (phone ? Math.min(1, room[0] / W, room[1] / H) : Math.min(1, room[0] / W)) : 1
  const h = phone ? H : room ? room[1] / z : H
  return (
    <div data-full className="absolute inset-0 isolate z-[5]">
      <div ref={back} className={`absolute inset-0 ${surface}`} />
      <div ref={area} className="absolute inset-x-3 top-0 grid place-items-center" style={{ bottom: BAR }}>
        {room && (
          <div ref={card} data-full-card className="relative origin-top-left overflow-hidden rounded-xl [contain:layout_paint] bg-white shadow-[0_20px_50px_-20px_rgba(0,0,0,.45)] ring-1 ring-zinc-900/10 dark:bg-zinc-950 dark:ring-white/10"
            style={{ width: W * z, height: h * z }}>
            <div style={{ width: W, height: h, zoom: z }}>
              <Mounted key={screen.key} v={screen.v} live className="h-full overflow-auto overscroll-contain" />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
