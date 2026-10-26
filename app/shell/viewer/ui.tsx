// What the viewer's parts share: its materials (the reference's, viewer-board/C in session
// f64ced15), Phosphor's own icons, the zoom state the desk writes and the bar reads, and the one
// way a design is put on the page (Mounted), with the stack's own mount.
import { createContext, useContext, useEffect, useRef } from 'react'
import caretDown from '@phosphor-icons/core/assets/bold/caret-down-bold.svg?raw'
import caretLeft from '@phosphor-icons/core/assets/bold/caret-left-bold.svg?raw'
import caretRight from '@phosphor-icons/core/assets/bold/caret-right-bold.svg?raw'
import check from '@phosphor-icons/core/assets/bold/check-bold.svg?raw'
import minus from '@phosphor-icons/core/assets/bold/minus-bold.svg?raw'
import plus from '@phosphor-icons/core/assets/bold/plus-bold.svg?raw'
import info from '@phosphor-icons/core/assets/bold/info-bold.svg?raw'
import reload from '@phosphor-icons/core/assets/bold/arrow-clockwise-bold.svg?raw'
import eye from '@phosphor-icons/core/assets/regular/eye.svg?raw'
import x from '@phosphor-icons/core/assets/regular/x.svg?raw'
import type { Variant } from '../shell'
import { ERROR_CLASS } from '../building'

export const face = "font-['Google_Sans','Google_Sans_Variable',ui-sans-serif,system-ui,sans-serif] font-[450]"
/** The desk: zinc with a quiet 16 px dot grid, in both themes. */
export const surface = 'bg-zinc-100 dark:bg-black bg-[radial-gradient(circle,rgba(0,0,0,.08)_1px,transparent_1.2px)] dark:bg-[radial-gradient(circle,rgba(255,255,255,.06)_1px,transparent_1.2px)] bg-[length:16px_16px]'
export const card = 'rounded-2xl border border-zinc-200 bg-white dark:border-white/10 dark:bg-zinc-900'
export const iconBtn = 'inline-grid size-8 place-items-center rounded-lg text-zinc-500 hover:bg-zinc-900/5 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-zinc-100'
/** A popup that opens from its anchor: scales and fades in 150 ms. */
export const popup = `${card} origin-[var(--transform-origin)] p-1 shadow-2xl outline-none transition-[opacity,scale] duration-150 data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0 motion-reduce:transition-none`

const ICONS = { 'caret-down': caretDown, 'caret-left': caretLeft, 'caret-right': caretRight, check, minus, plus, info, reload, eye, x }
export type IconName = keyof typeof ICONS
/** One of Phosphor's own files, at the size the class gives. Carets along the line mirror in a right-to-left page. */
export function Icon({ name, className = 'size-4' }: { name: IconName; className?: string }) {
  const along = name === 'caret-left' || name === 'caret-right' ? ' rtl:-scale-x-100' : ''
  return <span aria-hidden="true" className={`inline-grid shrink-0 place-items-center [&>svg]:size-full ${className}${along}`} dangerouslySetInnerHTML={{ __html: ICONS[name] }} />
}

/** One shared design: its route (`pricing/B`), its number and name, and its module. */
export type Screen = { key: string; n: number; name: string; v: Variant }
/** What the desk can be asked to do: fly to a design, Fit, 100 %, or zoom by a factor. */
export type Api = { show: (key: string) => void; fit?: () => void; actual?: () => void; by?: (f: number) => void }

/* ---------------------------------------------------------------- zoom state, outside React */

export type ZoomState = { z: number; fit: boolean }
export function makeStore() {
  let s: ZoomState = { z: 1, fit: true }
  const subs = new Set<() => void>()
  return {
    get: () => s,
    set: (n: ZoomState) => { if (n.z !== s.z || n.fit !== s.fit) { s = n; subs.forEach(f => f()) } },
    sub: (f: () => void) => { subs.add(f); return () => { subs.delete(f) } },
  }
}
export type Store = ReturnType<typeof makeStore>

/* ---------------------------------------------------------------- a design on the page */

type Mount = (el: HTMLElement, component: unknown) => () => void
export type Mounts = { mount: Mount; load: (v: Variant) => Promise<unknown>; mounted: () => void }
export const MountsCtx = createContext<Mounts | null>(null)

/**
 * A design, mounted with the stack's own mount while `live`, else nothing. Each mount gets a box of
 * its own, so a root on its way out (unmounted after React's commit, never during it) and the next
 * one never share an element. `grown` hears the design's height when it is taller than its box.
 */
export function Mounted({ v, live, grown, className = 'h-full' }: { v: Variant; live: boolean; grown?: (h: number) => void; className?: string }) {
  const host = useRef<HTMLDivElement>(null)
  const ctx = useContext(MountsCtx)!
  const grownRef = useRef(grown)
  grownRef.current = grown
  useEffect(() => {
    if (!live) return
    const box = document.createElement('div')
    box.dataset.mount = ''
    box.dataset.live = ''
    box.dir = 'ltr'
    box.className = className
    host.current!.append(box)
    let off: (() => void) | null = null, gone = false, ro: ResizeObserver | null = null
    const measure = () => { if (box.scrollHeight > box.clientHeight + 1) grownRef.current?.(box.scrollHeight) }
    ctx.load(v).then(
      c => {
        if (gone) return
        off = ctx.mount(box, c)
        ctx.mounted()
        if (!grownRef.current) return
        ro = new ResizeObserver(measure)
        requestAnimationFrame(() => requestAnimationFrame(() => {
          if (gone) return
          measure()
          for (const child of box.children) ro!.observe(child)
        }))
      },
      e => { if (!gone) { const pre = document.createElement('pre'); pre.className = ERROR_CLASS; pre.textContent = String(e?.stack || e); box.replaceChildren(pre); ctx.mounted() } })
    return () => {
      gone = true
      ro?.disconnect()
      box.remove()
      if (off) { const o = off; setTimeout(() => { try { o() } catch { /* already gone */ } }) }
    }
  }, [v, live, ctx, className])
  return <div ref={host} data-host className="contents" />
}
