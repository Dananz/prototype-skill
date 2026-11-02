// Virtualization for long lists of same-sized blocks: a block far outside its scroller draws an empty box of
// its own height instead of its contents, so the page holds what is near the view and keeps its full scroll
// length. It is drawn again well before it scrolls in. The height comes from its last measure, else the estimate.
import { startTransition, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'

/** How far outside the view (in px) a block stays drawn: a fast flick never reaches an empty one. */
const MARGIN = 1400

// One observer per scroller, however many blocks it holds.
type Watcher = (on: boolean, inView: boolean) => void
const observers = new Map<HTMLElement | null, { io: IntersectionObserver; watchers: Map<Element, Watcher> }>()
function watchNear(root: HTMLElement | null, el: Element, watcher: Watcher) {
  let shared = observers.get(root)
  if (!shared) {
    const watchers = new Map<Element, Watcher>()
    const io = new IntersectionObserver(es => {
      const last = new Map(es.map(e => [e.target, e]))
      for (const [target, e] of last) {
        const v = e.rootBounds, b = e.boundingClientRect
        watchers.get(target)?.(e.isIntersecting, !!v && b.bottom >= v.top + MARGIN && b.top <= v.bottom - MARGIN)
      }
    }, { root, rootMargin: `${MARGIN}px 0px` })
    shared = { io, watchers }
    observers.set(root, shared)
  }
  const { io, watchers } = shared
  watchers.set(el, watcher); io.observe(el)
  return () => {
    watchers.delete(el); io.unobserve(el)
    if (!watchers.size) { io.disconnect(); observers.delete(root) }
  }
}

export function Near({ estimate, placeholder, scroller, force, start, className, style, children }: {
  /** Known to be in the first screenful: drawn from its first render, with no measuring. */
  start?: boolean
  /** The empty box's height until it has been measured. */
  estimate?: number
  /** Or what stands in for it, sized by the same CSS, which stays right at any width. */
  placeholder?: ReactNode
  /** The element it scrolls in. */
  scroller: () => HTMLElement | null
  /** Kept drawn wherever it is (what holds the current row or an open card). */
  force?: boolean
  className?: string; style?: CSSProperties; children: () => ReactNode
}) {
  const box = useRef<HTMLDivElement>(null), height = useRef(0)
  const [near, setNear] = useState(!!start)
  useEffect(() => watchNear(scroller(), box.current!, (on, inView) => {
    // Coming near, it is drawn between frames so scrolling never waits for it; already in view (a long jump), at once.
    if (on && inView) setNear(true)
    else startTransition(() => setNear(on))
  }), []) // eslint-disable-line react-hooks/exhaustive-deps
  const drawn = near || !!force
  useLayoutEffect(() => {
    if (!drawn || placeholder) return
    const ro = new ResizeObserver(() => { const h = box.current?.offsetHeight ?? 0; if (h) height.current = h })
    ro.observe(box.current!)
    return () => ro.disconnect()
  }, [drawn]) // eslint-disable-line react-hooks/exhaustive-deps
  return <div ref={box} className={className} style={drawn || placeholder ? style : { ...style, height: height.current || estimate }}>{drawn ? children() : placeholder}</div>
}
