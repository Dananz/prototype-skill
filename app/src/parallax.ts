// Parallax from one image split into depth layers (references/images.md). Each child of the root
// with data-depth (0 = still, 1 = the nearest layer, moving the full travel) is drawn larger than
// the root by its own travel on every side, so no edge of it ever enters the frame, and moved
// against the pointer or the scroll. What it cannot do for you: paint each back layer whole behind
// the layers in front of it. The images must already have that overflow.
//
//   React: useEffect(() => parallax(rootRef.current, { travel: 24 }), [])
//   Vue:   onMounted(() => { stop = parallax(root.value, { travel: 24 }) }); onBeforeUnmount(() => stop?.())
//
// `proto shoot … --parallax 1,1` (or -1,-1) holds every layer at that end of its travel, for checking
// the extremes for holes and edges. Under prefers-reduced-motion the layers stay at rest.

export type ParallaxOptions = {
  /** How far the nearest layer moves, in px, at each end. Default 24. */
  travel?: number
  /** What moves it. Default 'pointer'. */
  on?: 'pointer' | 'scroll' | 'both'
}

const BLEED = 2 // px past the travel, so subpixel rounding never shows a hairline

export function parallax(root: HTMLElement | null | undefined, { travel = 24, on = 'pointer' }: ParallaxOptions = {}): () => void {
  if (!root) return () => {}
  if (getComputedStyle(root).position === 'static') root.style.position = 'relative'
  root.style.overflow = 'hidden'

  const layers = () => [...root.querySelectorAll<HTMLElement>('[data-depth]')]
  const depthOf = (el: HTMLElement) => Math.min(1, Math.max(0, Number(el.dataset.depth) || 0))
  const size = () => {
    for (const el of layers()) {
      const o = depthOf(el) * travel + BLEED
      Object.assign(el.style, {
        position: 'absolute', top: `${-o}px`, left: `${-o}px`,
        width: `calc(100% + ${2 * o}px)`, height: `calc(100% + ${2 * o}px)`,
        maxWidth: 'none', willChange: 'transform',
      })
      if (el instanceof HTMLImageElement && !el.style.objectFit) el.style.objectFit = 'cover'
    }
  }

  let x = 0, y = 0, tx = 0, ty = 0, frame = 0
  const apply = () => {
    for (const el of layers()) {
      const d = depthOf(el) * travel
      el.style.transform = `translate3d(${(-x * d).toFixed(2)}px, ${(-y * d).toFixed(2)}px, 0)`
    }
  }
  const tick = () => {
    x += (tx - x) * 0.12
    y += (ty - y) * 0.12
    if (Math.abs(tx - x) < 0.001 && Math.abs(ty - y) < 0.001) { x = tx; y = ty; frame = 0 }
    else frame = requestAnimationFrame(tick)
    apply()
  }
  const go = (nx: number, ny: number) => {
    tx = Math.min(1, Math.max(-1, nx))
    ty = Math.min(1, Math.max(-1, ny))
    if (!frame) frame = requestAnimationFrame(tick)
  }

  // Layers that land later (an image() that was undefined) are sized as they arrive.
  const watch = new MutationObserver(() => { size(); apply() })
  watch.observe(root, { childList: true, subtree: true })
  size()

  const pinned = new URLSearchParams(location.search).get('parallax')?.match(/^(-?[\d.]+),(-?[\d.]+)$/)
  if (pinned) {
    x = tx = Math.min(1, Math.max(-1, +pinned[1]))
    y = ty = Math.min(1, Math.max(-1, +pinned[2]))
    apply()
    return () => watch.disconnect()
  }
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    apply()
    return () => watch.disconnect()
  }

  const view = root.ownerDocument.defaultView || window
  const onPointer = (e: PointerEvent) => {
    if (e.pointerType === 'touch') return
    const r = root.getBoundingClientRect()
    go(((e.clientX - r.left) / r.width) * 2 - 1, on === 'both' ? ty : ((e.clientY - r.top) / r.height) * 2 - 1)
  }
  const onScroll = () => {
    const r = root.getBoundingClientRect(), vh = view.innerHeight
    go(on === 'both' ? tx : 0, (r.top + r.height / 2 - vh / 2) / (vh / 2 + r.height / 2))
  }
  if (on !== 'scroll') view.addEventListener('pointermove', onPointer, { passive: true })
  if (on !== 'pointer') {
    view.addEventListener('scroll', onScroll, { passive: true, capture: true })
    onScroll()
  }
  return () => {
    watch.disconnect()
    cancelAnimationFrame(frame)
    view.removeEventListener('pointermove', onPointer)
    view.removeEventListener('scroll', onScroll, { capture: true })
  }
}
