// Framework-neutral windowing for shell rows and preview grids. Detached rows have a bounded
// LRU cache; measurements stay keyed by item ID so scrolling and reordering keep their geometry.
export const VIRTUAL_THRESHOLD = 50

export type VirtualOptions<T> = {
  items: readonly T[]
  key: (item: T) => string
  render: (item: T, index: number, previous?: HTMLElement) => HTMLElement
  estimate: (item: T, width: number) => number
  columns?: (width: number) => number
  gap?: number
  overscan?: number
  cacheSize?: number
  onAttach?: (element: HTMLElement, item: T, index: number) => void
  onDetach?: (element: HTMLElement, item: T, index: number) => void
  onEvict?: (element: HTMLElement, item: T) => void
  onChange?: () => void
}
export type VirtualEntry<T> = { key: string; item: T; index: number; element: HTMLElement; attached: boolean; revision: number }

const markup = new WeakMap<HTMLElement, string>()
/** Reuses a cached row unless its actual contents or state changed. */
export function virtualHTML(html: string, previous?: HTMLElement): HTMLElement {
  if (previous && markup.get(previous) === html) return previous
  const template = document.createElement('template')
  template.innerHTML = html
  const element = template.content.firstElementChild as HTMLElement
  markup.set(element, html)
  return element
}

/** The nearest scrolling ancestor, including a drawer whose content lives in a portal. */
export function scrollParent(element: HTMLElement): HTMLElement {
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(parent).overflowY)) return parent
  }
  return element
}

export class VirtualList<T> {
  private host: HTMLElement | null = null
  private scroll: HTMLElement | null = null
  private content = document.createElement('div')
  private cache = new Map<string, VirtualEntry<T>>()
  private measured = new Map<string, { width: number; height: number }>()
  private offsets: number[] = [0]
  private columns = 1
  private width = 0
  private revision = 0
  private raf = 0
  private painting = false
  private observer = new ResizeObserver(entries => {
    let changed = false
    for (const entry of entries) {
      const element = entry.target as HTMLElement
      if (element === this.host || element === this.scroll) { changed = true; continue }
      const key = element.dataset.virtualKey
      if (!key) continue
      const height = element.getBoundingClientRect().height
      const was = this.measured.get(key)
      if (height > 0 && (!was || Math.abs(was.height - height) > 0.5 || was.width !== this.width)) {
        this.measured.set(key, { width: this.width, height }); changed = true
      }
    }
    if (changed) this.schedule()
  })

  constructor(private options: VirtualOptions<T>) {
    this.content.dataset.virtualContent = ''
    Object.assign(this.content.style, { position: 'relative', gridColumn: '1 / -1', minWidth: '0', overflowAnchor: 'none' })
  }

  get items() { return this.options.items }
  get element() { return this.host }
  entries(): VirtualEntry<T>[] { return [...this.cache.values()] }

  update(options: VirtualOptions<T>) {
    this.options = options
    this.revision++
    const indices = new Map(options.items.map((item, index) => [options.key(item), index]))
    for (const [key, record] of this.cache) {
      const index = indices.get(key)
      if (index === undefined) this.evict(key, record)
      else record.index = index
    }
    for (const key of this.measured.keys()) if (!indices.has(key)) this.measured.delete(key)
    this.refresh()
  }

  connect(host: HTMLElement, scroll = host) {
    if (this.host === host && this.scroll === scroll) return this.refresh()
    this.disconnect()
    this.host = host; this.scroll = scroll
    host.replaceChildren(this.content)
    scroll.addEventListener('scroll', this.schedule, { passive: true })
    this.observer.observe(host)
    if (scroll !== host) this.observer.observe(scroll)
    this.refresh()
    this.schedule()
  }

  disconnect() {
    if (this.raf) cancelAnimationFrame(this.raf)
    this.raf = 0
    this.scroll?.removeEventListener('scroll', this.schedule)
    this.observer.disconnect()
    for (const record of this.cache.values()) this.detach(record)
    this.content.remove()
    this.host = this.scroll = null
  }

  destroy() {
    this.disconnect()
    for (const [key, record] of this.cache) this.evict(key, record)
    this.measured.clear()
  }

  private schedule = () => {
    if (!this.raf) this.raf = requestAnimationFrame(() => { this.raf = 0; this.refresh() })
  }

  private detach(record: VirtualEntry<T>) {
    if (!record.attached) return
    this.observer.unobserve(record.element)
    this.options.onDetach?.(record.element, record.item, record.index)
    record.element.remove()
    record.attached = false
  }

  private evict(key: string, record: VirtualEntry<T>) {
    this.detach(record)
    this.options.onEvict?.(record.element, record.item)
    this.cache.delete(key)
  }

  private layout() {
    const { items, key, estimate, gap = 0 } = this.options
    const width = this.content.clientWidth || this.host?.clientWidth || 1
    this.columns = Math.max(1, Math.floor(this.options.columns?.(width) ?? 1))
    this.width = (width - gap * (this.columns - 1)) / this.columns
    this.offsets = [0]
    for (let i = 0; i < items.length; i += this.columns) {
      let height = 1
      for (let j = i; j < Math.min(items.length, i + this.columns); j++) {
        const size = this.measured.get(key(items[j]))
        height = Math.max(height, size && Math.abs(size.width - this.width) < 1 ? size.height : estimate(items[j], this.width))
      }
      this.offsets.push(this.offsets.at(-1)! + height + gap)
    }
    this.content.style.height = `${Math.max(0, this.offsets.at(-1)! - gap)}px`
  }

  private contentTop() {
    return this.content.getBoundingClientRect().top - this.scroll!.getBoundingClientRect().top + this.scroll!.scrollTop - this.scroll!.clientTop
  }

  refresh() {
    if (!this.host || !this.scroll || this.painting) return
    this.painting = true
    try {
      this.layout()
      const { items, key, gap = 0, overscan = 2 } = this.options
      const top = this.scroll.scrollTop - this.contentTop(), bottom = top + this.scroll.clientHeight
      let first = 0, last = this.offsets.length - 1
      while (first < last) { const mid = (first + last) >> 1; if (this.offsets[mid + 1] < top) first = mid + 1; else last = mid }
      const start = Math.max(0, first - overscan)
      let end = first
      while (end < this.offsets.length - 1 && this.offsets[end] <= bottom) end++
      end = Math.min(this.offsets.length - 1, end + overscan)
      const wanted = new Set<number>()
      if (this.scroll.clientHeight && this.host.getClientRects().length) {
        for (let i = start * this.columns; i < Math.min(items.length, end * this.columns); i++) wanted.add(i)
      }
      // Scrolling must not remove the control currently receiving keyboard input.
      const focused = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('[data-virtual-index]')
      if (focused && this.content.contains(focused)) wanted.add(Number(focused.dataset.virtualIndex))
      let changed = false
      for (const record of this.cache.values()) if (record.attached && !wanted.has(record.index)) { this.detach(record); changed = true }
      for (const index of [...wanted].sort((a, b) => a - b)) {
        if (!items[index]) continue
        const item = items[index], id = key(item)
        let record = this.cache.get(id)
        if (!record || record.revision !== this.revision) {
          const element = this.options.render(item, index, record?.element)
          if (record && element !== record.element) { this.evict(id, record); record = undefined; this.measured.delete(id) }
          if (!record) record = { key: id, item, index, element, attached: false, revision: this.revision }
          record.item = item; record.index = index; record.revision = this.revision
          changed = true
        }
        this.cache.delete(id); this.cache.set(id, record)
        const element = record.element
        element.dataset.virtualIndex = String(index); element.dataset.virtualKey = id
        Object.assign(element.style, { position: 'absolute', top: `${this.offsets[Math.floor(index / this.columns)]}px`, left: `${(index % this.columns) * (this.width + gap)}px`, width: `${this.width}px`, margin: '0' })
        if (!record.attached) {
          // Insert in logical order so Tab and assistive technology follow the visual order.
          const after = [...this.content.children].find(e => Number((e as HTMLElement).dataset.virtualIndex) > index)
          this.content.insertBefore(element, after ?? null)
          record.attached = true
          this.observer.observe(element)
          this.options.onAttach?.(element, item, index)
          changed = true
        }
      }
      const limit = Math.max(this.options.cacheSize ?? 48, wanted.size)
      for (const [id, record] of this.cache) {
        if (this.cache.size <= limit) break
        if (!record.attached) { this.evict(id, record); changed = true }
      }
      if (changed) this.options.onChange?.()
    } finally { this.painting = false }
  }

  scrollToIndex(index: number, align: 'nearest' | 'center' = 'nearest') {
    if (!this.scroll || !this.host || !this.items.length) return
    index = Math.max(0, Math.min(this.items.length - 1, index))
    this.layout()
    const row = Math.floor(index / this.columns), top = this.contentTop() + this.offsets[row]
    const bottom = this.contentTop() + this.offsets[row + 1] - (this.options.gap ?? 0)
    if (align === 'center') this.scroll.scrollTop = (top + bottom - this.scroll.clientHeight) / 2
    else if (top < this.scroll.scrollTop) this.scroll.scrollTop = top
    else if (bottom > this.scroll.scrollTop + this.scroll.clientHeight) this.scroll.scrollTop = bottom - this.scroll.clientHeight
    this.refresh()
  }

  focus(index: number, selector = 'button'): HTMLElement | null {
    this.scrollToIndex(index)
    const item = this.items[index], record = item && this.cache.get(this.options.key(item))
    const element = record?.element
    const control = element?.matches(selector) ? element : element?.querySelector<HTMLElement>(selector)
    control?.focus({ preventScroll: true })
    return control ?? null
  }
}
