// The phone list belongs to the bottom bar, so only its height moves. The composer and navigation
// stay at the foot; the list keeps its own native scroll, separate from this header gesture.
import { useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent, type RefObject } from 'react'

export function usePhoneDrawer(on: boolean, open: boolean, cap: RefObject<HTMLDivElement | null>, bottom: number, close: () => void) {
  const [limits, setLimits] = useState({ half: 280, full: 560 })
  const [snap, setSnap] = useState<'half' | 'full'>('half')
  const [height, setHeight] = useState<number | null>(null)
  const gesture = useRef<{ id: number; y: number; from: number; moved: boolean } | null>(null)
  const suppressClick = useRef(false)
  useLayoutEffect(() => {
    if (!on || !cap.current) return
    const el = cap.current, host = el.closest<HTMLElement>('[data-island-host]')!
    const measure = () => {
      const list = el.querySelector<HTMLElement>('[data-island-list]')
      const footer = el.offsetHeight - (list?.offsetHeight ?? 0)
      const full = Math.max(0, host.clientHeight - footer - bottom - 16)
      const half = Math.min(full, Math.max(160, host.clientHeight * 0.5 - footer))
      setLimits(was => was.full === full && was.half === half ? was : { half, full })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(host)
    ro.observe(el)
    return () => ro.disconnect()
  }, [on, open, bottom, cap])
  useLayoutEffect(() => {
    if (!on || !open) { gesture.current = null; setHeight(null); setSnap('half') }
  }, [on, open])
  const cancel = () => { gesture.current = null; setHeight(null) }
  const finish = (e: PointerEvent) => {
    const g = gesture.current
    if (!g || e.pointerId !== g.id) return
    gesture.current = null
    setHeight(null)
    if (!g.moved) return
    const last = Math.max(0, Math.min(limits.full, g.from + g.y - e.clientY))
    if (last < limits.half / 2) close()
    else setSnap(last > (limits.half + limits.full) / 2 ? 'full' : 'half')
  }
  return {
    height: Math.min(limits.full, height ?? limits[snap]),
    dragging: height !== null,
    full: snap === 'full',
    toggle: (e: MouseEvent) => {
      if (suppressClick.current && e.detail > 0) { suppressClick.current = false; return }
      setSnap(s => s === 'half' ? 'full' : 'half')
    },
    grip: {
      onPointerDown: (e: PointerEvent<HTMLElement>) => {
        if (!on || !open || !e.isPrimary || e.button !== 0) return
        const button = (e.target as Element).closest('button')
        if (button && !button.hasAttribute('data-comment-drawer-handle')) return
        suppressClick.current = false
        gesture.current = { id: e.pointerId, y: e.clientY, from: cap.current?.querySelector<HTMLElement>('[data-shoot=comments]')?.offsetHeight ?? limits[snap], moved: false }
      },
      onPointerMove: (e: PointerEvent<HTMLElement>) => {
        const g = gesture.current
        if (!g || e.pointerId !== g.id || (!g.moved && Math.abs(e.clientY - g.y) < 4)) return
        g.moved = true
        suppressClick.current = true
        e.currentTarget.setPointerCapture(e.pointerId)
        e.preventDefault()
        setHeight(Math.max(0, Math.min(limits.full, g.from + g.y - e.clientY)))
      },
      onPointerUp: finish,
      onPointerCancel: cancel,
      onLostPointerCapture: (e: PointerEvent<HTMLElement>) => { if (e.target === e.currentTarget) cancel() },
      onKeyDown: (e: KeyboardEvent) => {
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          if (e.key === 'Escape') close()
          else setSnap(e.key === 'ArrowUp' ? 'full' : 'half')
        }
      },
    },
  }
}
