// A design of a fixed size (a plugin window, a kiosk, a TV, a hardware panel) shown whole on the stage:
// <Fit width={556} height={1025}>…</Fit>. It measures the space its parent gives it and shrinks the
// design with CSS `zoom` until all of it shows, so the artboard never scrolls to reach the bottom.
// `max` caps the growth (1 = never larger than designed, the default). `zoom`, not a transform:
// Safari on a phone paints a scaled layer at full size times 3x, and pointer math stays in layout px.
// React only for now, as <Slot> and <Go> are.
import { createElement as h, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'

export function Fit({ width, height, max = 1, pad = 16, background, children }:
  { width: number; height: number; max?: number; pad?: number; background?: string; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState(1)
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const fit = () => {
      const w = el.clientWidth - pad * 2, hgt = el.clientHeight - pad * 2
      if (w > 0 && hgt > 0) setZoom(Math.min(max, w / width, hgt / height))
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [width, height, max, pad])
  const outer: CSSProperties = { position: 'relative', width: '100%', height: '100%', display: 'grid', placeItems: 'center', overflow: 'hidden', background }
  return h('div', { ref: box, style: outer, 'data-fit': zoom.toFixed(3) },
    h('div', { style: { width, height, zoom, flex: 'none' } as CSSProperties }, children))
}
