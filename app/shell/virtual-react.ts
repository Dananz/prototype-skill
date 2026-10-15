// React owns each cached cell's contents; VirtualList owns only its placement and lifetime.
import { createElement as h, Fragment, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { scrollParent, VirtualList, type VirtualEntry } from './virtual'

export type CachedListProps<T> = {
  items: readonly T[]
  itemKey: (item: T) => string
  render: (item: T, index: number) => ReactNode
  estimate: (item: T, width: number) => number
  className?: string
  gap?: number
  cacheSize?: number
  overscan?: number
  version?: unknown
  initialIndex?: number
  focusSelector?: string
  onVisible?: (items: T[]) => void
}

export function CachedList<T>(p: CachedListProps<T>) {
  const host = useRef<HTMLDivElement>(null), list = useRef<VirtualList<T> | null>(null)
  const now = useRef(p); now.current = p
  const [records, setRecords] = useState<VirtualEntry<T>[]>([])
  const pendingFocus = useRef<number | null>(null)
  const options = () => ({
    items: now.current.items,
    key: (item: T) => now.current.itemKey(item),
    render: (_item: T, _index: number, previous?: HTMLElement) => previous ?? document.createElement('div'),
    estimate: (item: T, width: number) => now.current.estimate(item, width),
    gap: now.current.gap, cacheSize: now.current.cacheSize, overscan: now.current.overscan,
    onChange: () => {
      // Entries are mutable in the core. Snapshot their attachment and index for React.
      const next = list.current!.entries().map(record => ({ ...record }))
      setRecords(was => was.length === next.length && was.every((record, i) => {
        const other = next[i]
        return record.key === other.key && record.element === other.element && record.attached === other.attached && record.index === other.index && record.item === other.item
      }) ? was : next)
    },
  })
  useLayoutEffect(() => {
    const instance = new VirtualList(options()); list.current = instance
    const element = host.current!
    instance.connect(element, scrollParent(element))
    if (now.current.initialIndex !== undefined && now.current.initialIndex > 0) instance.scrollToIndex(now.current.initialIndex, 'center')
    const keydown = (event: KeyboardEvent) => {
      if (!now.current.focusSelector || event.altKey || event.ctrlKey || event.metaKey) return
      const target = event.target as HTMLElement
      if (!target.matches(now.current.focusSelector)) return
      const cell = target.closest<HTMLElement>('[data-virtual-index]')
      if (!cell) return
      const index = Number(cell.dataset.virtualIndex), count = now.current.items.length
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? count - 1 : event.key === 'ArrowDown' ? Math.min(count - 1, index + 1) : event.key === 'ArrowUp' ? Math.max(0, index - 1) : null
      if (next === null) return
      event.preventDefault(); event.stopPropagation()
      pendingFocus.current = next
      if (instance.focus(next, now.current.focusSelector)) pendingFocus.current = null
    }
    element.addEventListener('keydown', keydown, true)
    return () => { element.removeEventListener('keydown', keydown, true); list.current = null; instance.destroy() }
  }, [])
  useLayoutEffect(() => {
    const instance = list.current
    if (!instance) return
    // The render callback reads current props, so captions and selection do not invalidate
    // the core's cells, or create an update -> onChange -> React render loop.
    instance.update(options())
  }, [p.items, p.version])
  useLayoutEffect(() => {
    now.current.onVisible?.(records.filter(record => record.attached).map(record => record.item))
    if (pendingFocus.current !== null && now.current.focusSelector) {
      const index = pendingFocus.current
      const frame = requestAnimationFrame(() => { if (list.current?.focus(index, now.current.focusSelector)) pendingFocus.current = null })
      return () => cancelAnimationFrame(frame)
    }
  }, [records])
  return h(Fragment, null,
    h('div', { ref: host, className: p.className, 'data-virtual-react': '' }),
    ...records.map(record => createPortal(p.render(record.item, record.index), record.element, record.key)))
}
