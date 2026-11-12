// A row of the project tree dragged onto a comment box becomes a tag there: a variant's row its
// variant, a prototype's row the whole prototype, a design's or a flow's every screen in it, and a
// row that is part of the tree's selection everything chosen. What is dragged is a list of routes
// (`slug/A` a variant, `slug` a prototype); the box (comments/tag-field.tsx, comments/composer.tsx)
// takes them on TAG_EVENT and turns them into chips.
//
// The drag is the pointer's, not the browser's (whose picture under the pointer can't change): the
// row lifts off the tree, a little larger and tilted, and leaves a dashed slot; the other chosen
// rows fold in under it as a stack. Leaving the tree, the stack opens into a column of the chips
// they will become; over a box it rises above the pointer, the cursor's count turns into a green
// +N and the box lights. Dropped, each chip glides into the place it took in the words; dropped
// anywhere else (or Esc), the rows go back.
import type { PointerEvent as ReactPointerEvent } from 'react'

export const TAG_EVENT = 'proto:tags'
/** What a box hears on a drop: the routes, and the chips it put in for them (none for a route it already had). */
export type TagDrop = { routes: string[]; landed: { route: string; el: HTMLElement }[] }
/** The key a tag is known by in a drop: the route that made it. */
export const routeOfTag = (x: { protoRef?: { proto: string }; variantRef?: { proto: string; variant: string } }) =>
  x.protoRef ? x.protoRef.proto : x.variantRef ? `${x.variantRef.proto}/${x.variantRef.variant}` : ''

// The chip each route becomes, as the box will write it; set by the tree, which knows the names.
let labelOf: (route: string) => string | null = () => null
export function setTagLabels(fn: (route: string) => string | null) { labelOf = fn; return () => { if (labelOf === fn) labelOf = () => null } }

const START = 5 // px the pointer moves before a press becomes a drag
const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v))
const mix = (a: number, b: number, k: number) => a + (b - a) * k
const ease = (v: number) => 1 - Math.pow(1 - clamp(v), 3)
const still = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
const CHIP = 'rounded bg-proto-primary-soft px-1.5 font-medium text-proto-primary-soft-fg'

type Ghost = { route: string; box: HTMLElement; card: HTMLElement; chip: HTMLElement; row: HTMLElement | null; w: number; h: number; cw: number; k: number; i: number; x: number; y: number }

/** A press on a row that may become a drag (mouse and pen; a finger scrolls the tree). */
export function armTagDrag(e: ReactPointerEvent<HTMLElement>, routes: () => string[]) {
  if (e.button !== 0 || e.pointerType === 'touch' || e.metaKey || e.ctrlKey || e.shiftKey) return
  if ((e.target as Element).closest('[aria-expanded], [data-act], [data-tree-picked], [data-tree-comments]') && !(e.target as Element).closest('[data-tree-more]')) return
  const from = e.currentTarget, id = e.pointerId, x0 = e.clientX, y0 = e.clientY
  const early = (m: PointerEvent) => { if (m.pointerId === id && Math.hypot(m.clientX - x0, m.clientY - y0) >= START) { quit(); begin(from, routes(), x0, y0, m, id) } }
  const quit = () => { removeEventListener('pointermove', early, true); removeEventListener('pointerup', quit, true); removeEventListener('pointercancel', quit, true) }
  addEventListener('pointermove', early, true); addEventListener('pointerup', quit, true); addEventListener('pointercancel', quit, true)
}

function begin(from: HTMLElement, all: string[], x0: number, y0: number, first: PointerEvent, id: number) {
  if (!all.length) return
  const tree = from.closest<HTMLElement>('[data-tree-root]') ?? from.parentElement!
  const rtl = getComputedStyle(from).direction === 'rtl', calm = still()
  const g = from.getBoundingClientRect(), gx = x0 - g.left, gy = y0 - g.top
  // The rows in the tree that are being dragged: this one, and the chosen ones on screen.
  const rowFor = (route: string) => [...tree.querySelectorAll<HTMLElement>('[data-tree-chosen="true"][data-drag]')].find(r => (JSON.parse(r.dataset.drag!) as string[]).includes(route)) ?? null
  const own = from.dataset.drag ? JSON.parse(from.dataset.drag) as string[] : []
  const front = all.find(r => own.includes(r)) ?? all[0]
  const order = [...all.filter(r => r !== front), front]
  const layer = document.createElement('div')
  layer.dataset.tagDragLayer = ''
  layer.setAttribute('aria-hidden', 'true')
  layer.className = 'pointer-events-none fixed inset-0 z-[2147483000]'
  document.body.append(layer)
  const ghosts: Ghost[] = order.map((route, j) => {
    const row = route === front ? from : rowFor(route)
    const r = row?.getBoundingClientRect() ?? g
    const box = document.createElement('div')
    box.className = 'absolute overflow-hidden'
    box.style.cssText = `left:0;top:0;width:${r.width}px;height:${r.height}px;transform-origin:${gx}px ${gy}px;will-change:transform,width,height`
    const card = document.createElement('div')
    card.className = 'absolute inset-0 rounded-[inherit] border border-black/10 bg-white shadow-xl dark:border-white/15 dark:bg-zinc-800'
    if (row) {
      const copy = row.cloneNode(true) as HTMLElement
      copy.removeAttribute('data-tree-row'); copy.removeAttribute('data-drag'); copy.removeAttribute('data-tree-chosen'); copy.removeAttribute('data-on')
      copy.querySelectorAll('[data-act],[data-tree-picked]').forEach(n => n.remove())
      copy.style.cssText = `position:absolute;inset-block:0;${rtl ? 'right' : 'left'}:0;width:${r.width}px;margin:0;background:transparent`
      card.append(copy)
    }
    const chip = document.createElement('span')
    chip.dir = 'auto'
    chip.className = `absolute inset-0 grid items-center truncate text-[13px] leading-[22px] ${CHIP}`
    chip.textContent = labelOf(route) ?? `@${route}`
    box.append(card, chip)
    layer.append(box)
    const probe = document.createElement('span')
    probe.className = `fixed -top-40 w-max text-[13px] leading-[22px] ${CHIP}`
    probe.textContent = chip.textContent
    document.body.append(probe)
    const cw = Math.min(224, probe.offsetWidth + 2)
    probe.remove()
    return { route, box, card, chip, row, w: r.width, h: r.height, cw, k: route === front ? 0 : order.length - 1 - j, i: all.indexOf(route), x: r.left, y: r.top }
  })
  const badge = document.createElement('span')
  badge.dir = 'ltr'
  badge.className = 'absolute flex h-5 items-center rounded-full bg-proto-primary px-1.5 text-[11px] font-semibold tabular-nums text-proto-primary-fg shadow-lg transition-colors'
  badge.textContent = String(all.length)
  layer.append(badge)
  const sources = [...new Set(ghosts.map(gh => gh.row).filter((r): r is HTMLElement => !!r))]
  sources.forEach(r => r.setAttribute('data-tag-dragging', ''))
  document.documentElement.setAttribute('data-tag-drag', '')
  try { from.setPointerCapture(id) } catch { /* the row left the page */ }

  let px = first.clientX, py = first.clientY, out = 0, over = 0, lift = calm ? 1 : 0, raf = 0, target: HTMLElement | null = null, done = false
  const started = performance.now()
  const treeBox = tree.getBoundingClientRect()
  const draw = () => {
    if (!calm) lift = clamp((performance.now() - started) / 180)
    const dist = Math.max(0, treeBox.left - px, px - treeBox.right, treeBox.top - py, py - treeBox.bottom)
    const wantOut = dist > 0 ? clamp(dist / 140 + 0.15) : 0
    out = calm ? wantOut : mix(out, wantOut, 0.3); over = calm ? (target ? 1 : 0) : mix(over, target ? 1 : 0, 0.25)
    const m = ease(out), fold = ease(lift), n = all.length
    for (const gh of ghosts) {
      const r = gh.row?.getBoundingClientRect()
      const ownX = r ? px - gx + (r.left - g.left) : px - gx, ownY = r ? py - gy + (r.top - g.top) : py - gy
      const rowX = mix(ownX, px - gx + 4 * gh.k * (rtl ? 1 : -1), fold), rowY = mix(ownY, py - gy + 5 * gh.k, fold)
      const chipX = rtl ? px + 10 - gh.cw : px - 10, chipY = py + 16 + gh.i * 26 - (n * 26 + 34) * over
      gh.x = mix(rowX, chipX, m); gh.y = mix(rowY, chipY, m)
      const tilt = calm ? 0 : (rtl ? -2.2 : 2.2) * lift * (1 - m), scale = 1 + 0.04 * lift * (1 - m)
      gh.box.style.width = `${mix(gh.w, gh.cw, m)}px`; gh.box.style.height = `${mix(gh.h, 22, m)}px`
      gh.box.style.borderRadius = `${mix(8, 4, m)}px`
      gh.box.style.transform = `translate(${gh.x}px, ${gh.y}px) rotate(${tilt}deg) scale(${scale})`
      gh.box.style.opacity = String((gh.k ? 1 - 0.25 * (1 - m) : 1) * (calm ? 1 : clamp(lift * 1.5)))
      gh.card.style.opacity = String(1 - clamp(m * 1.8))
      gh.chip.style.opacity = String(clamp(m * 1.8 - 0.8))
    }
    const lit = !!target
    badge.style.transform = `translate(${rtl ? px + 6 : px - 30}px, ${py - 22}px) scale(${mix(0.6, 1, fold)})`
    badge.textContent = lit ? `+${n}` : String(n)
    badge.classList.toggle('bg-emerald-500', lit); badge.classList.toggle('bg-proto-primary', !lit)
    raf = requestAnimationFrame(draw)
  }
  raf = requestAnimationFrame(draw)

  const boxAt = (x: number, y: number) => {
    layer.style.display = 'none'
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-tag-target]') ?? null
    layer.style.display = ''
    return el?.isContentEditable ? el : null
  }
  const move = (m: PointerEvent) => {
    if (m.pointerId !== id) return
    px = m.clientX; py = m.clientY
    const next = boxAt(px, py)
    if (next !== target) { target?.removeAttribute('data-tag-drop'); next?.setAttribute('data-tag-drop', ''); target = next }
  }
  const end = (drop: boolean) => {
    if (done) return
    done = true
    cancelAnimationFrame(raf)
    removeEventListener('pointermove', move, true); removeEventListener('pointerup', up, true); removeEventListener('pointercancel', cancel, true); removeEventListener('keydown', esc, true)
    try { from.releasePointerCapture(id) } catch { /* gone */ }
    // The click that ends a drag is not a click on the row.
    const swallow = (c: MouseEvent) => { c.stopPropagation(); c.preventDefault() }
    addEventListener('click', swallow, true); setTimeout(() => removeEventListener('click', swallow, true), 0)
    const box = target
    target?.removeAttribute('data-tag-drop')
    badge.remove()
    const detail: TagDrop = { routes: all, landed: [] }
    if (drop && box) box.dispatchEvent(new CustomEvent(TAG_EVENT, { bubbles: true, detail }))
    const finish = () => { layer.remove(); sources.forEach(r => r.removeAttribute('data-tag-dragging')); document.documentElement.removeAttribute('data-tag-drag') }
    const T = calm ? 0 : drop && box ? 240 : 200
    for (const gh of ghosts) {
      const home = drop && box ? detail.landed.find(l => l.route === gh.route)?.el : null
      gh.box.style.transition = `transform ${T}ms cubic-bezier(.2,.9,.25,1), width ${T}ms cubic-bezier(.2,.9,.25,1), height ${T}ms, opacity ${T}ms`
      if (home) {
        const r = home.getBoundingClientRect()
        home.style.opacity = '0'
        setTimeout(() => { home.style.opacity = '' }, T)
        gh.card.style.opacity = '0'; gh.chip.style.opacity = '1'
        gh.box.style.width = `${r.width}px`; gh.box.style.height = `${r.height}px`
        gh.box.style.transform = `translate(${r.left}px, ${r.top}px)`
      } else if (drop && box) gh.box.style.opacity = '0'
      else {
        // Back where it came from.
        const r = gh.row?.getBoundingClientRect()
        gh.card.style.opacity = '1'; gh.chip.style.opacity = '0'
        if (r) { gh.box.style.width = `${r.width}px`; gh.box.style.height = `${r.height}px`; gh.box.style.transform = `translate(${r.left}px, ${r.top}px)` }
        gh.box.style.opacity = '0'
      }
    }
    if (T) setTimeout(finish, T + 20); else finish()
  }
  const up = (u: PointerEvent) => { if (u.pointerId === id) { move(u); end(true) } }
  const cancel = (c: PointerEvent) => { if (c.pointerId === id) end(false) }
  const esc = (k: KeyboardEvent) => { if (k.key === 'Escape') { k.preventDefault(); k.stopPropagation(); end(false) } }
  addEventListener('pointermove', move, true); addEventListener('pointerup', up, true); addEventListener('pointercancel', cancel, true); addEventListener('keydown', esc, true)
  move(first)
}
