// The shell's one tooltip. Every hint in the chrome is written as a plain `title` (about 170 of
// them, in string templates and in React), and the browser's own hint for it comes late, looks
// like the OS and is cut at the window's edge. So this takes them over: on hover or keyboard focus
// it moves the element's `title` to `data-tip` (the browser then shows nothing) and draws its own,
// and puts the title back when the pointer leaves.
//
// - A label: "Comment · C" shows "Comment" with a key chip for C ("Zoom out (-)" too). A last part
//   with a space in it ("Desktop · 1440 × 900") is part of the label, not a key.
// - An explainer: an element that also has `data-tip-body` gets its title in bold and the body
//   under it, up to 240px wide. A touch shows it on a long press; touch shows no label tips.
// - The first tip waits 200ms, then fades in and grows (150ms). The next one within half a second
//   shows at once, without motion, so moving along a toolbar reads them as fast as the eye goes.
// - It opens above the element, or below when there's no room. In a standing bar marked
//   `data-tip-side` (the tool strip) it opens beside it, on the side with the more room, so it
//   covers no other tool and stays clear of the window's edge.
// - Designs on the stage (`data-mount`) keep their own titles, and a frame's title stays its name.
import { uiBox } from './portals'

const DELAY = 200, WARM = 500, LONG_PRESS = 450, PAD = 8, GAP = 8
type Side = 'top' | 'bottom' | 'left' | 'right'

let tip: HTMLDivElement | null = null
let current: HTMLElement | null = null
let timer = 0, hideTimer = 0, lastHide = -Infinity, watch = 0
let quiet: { x: number, y: number } | null = null
let at = { x: -1, y: -1 }
let pressed = false

/** "Comment · C" → label and key. A key is a short last part without a space. */
export function parseTip(text: string): { label: string, kbd?: string } {
  const dot = /^(.*\S)\s+·\s+(\S{1,6})$/.exec(text)
  if (dot) return { label: dot[1], kbd: dot[2] }
  const paren = /^(.*\S)\s+\((\S{1,3})\)$/.exec(text)
  if (paren) return { label: paren[1], kbd: paren[2] }
  return { label: text }
}

function triggerOf(node: EventTarget | null): HTMLElement | null {
  const el = node instanceof Element ? node.closest<HTMLElement>('[title],[data-tip]') : null
  if (!el || el instanceof HTMLIFrameElement || !el.closest('#app, [data-proto-ui]') || el.closest('[data-mount], [data-proto-tip]')) return null
  own(el)
  return el.dataset.tip ? el : null
}

/** Borrow the element's title while it is pointed at or focused, so the browser shows no hint of
 *  its own; give it back after (settle), so the page's markup stays as it was written. */
const borrowed = new Set<HTMLElement>()
function own(el: HTMLElement) {
  const title = el.getAttribute('title')
  if (title === null) return
  el.removeAttribute('title')
  if (!title.trim()) return
  el.dataset.tip = title
  borrowed.add(el)
  // The title was its only name: keep one while it is borrowed (and after, a harmless double).
  if (!el.hasAttribute('aria-label') && !el.hasAttribute('aria-labelledby') && !el.textContent?.trim()) el.setAttribute('aria-label', title)
}
/** Give back every borrowed title but the one still pointed at (keep) or showing. */
function settle(keep: HTMLElement | null = null) {
  for (const el of borrowed) {
    if (el === keep || el === current) continue
    borrowed.delete(el)
    if (!el.isConnected) continue
    if (el.dataset.tip && !el.hasAttribute('title')) el.setAttribute('title', el.dataset.tip)
    delete el.dataset.tip
  }
}

function box() {
  if (!tip?.isConnected) {
    tip = document.createElement('div')
    tip.setAttribute('data-proto-tip', '')
    tip.setAttribute('role', 'tooltip')
    tip.id = 'proto-tip'
    tip.hidden = true
    uiBox().append(tip)
  }
  return tip
}

function fill(t: HTMLDivElement, el: HTMLElement) {
  const text = el.dataset.tip!, body = el.dataset.tipBody
  t.replaceChildren()
  t.toggleAttribute('data-explainer', !!body)
  if (body) {
    const head = document.createElement('b'), p = document.createElement('span')
    head.textContent = text; p.textContent = body
    t.append(head, p)
    return
  }
  const { label, kbd } = parseTip(text)
  const l = document.createElement('span')
  l.textContent = label
  t.append(l)
  if (kbd) { const k = document.createElement('kbd'); k.dir = 'ltr'; k.textContent = kbd; t.append(k) }
}

function place(t: HTMLDivElement, el: HTMLElement) {
  const r = el.getBoundingClientRect(), w = t.offsetWidth, h = t.offsetHeight
  const vw = innerWidth, vh = innerHeight
  const bar = el.closest<HTMLElement>('[data-tip-side]'), br = bar?.getBoundingClientRect()
  const beside = !!br && br.height > br.width
  const fits = (s: Side) => s === 'top' ? r.top - GAP - h >= PAD : s === 'bottom' ? r.bottom + GAP + h <= vh - PAD
    : s === 'left' ? r.left - GAP - w >= PAD : r.right + GAP + w <= vw - PAD
  const order: Side[] = beside ? (r.left + r.width / 2 < vw / 2 ? ['right', 'left', 'bottom', 'top'] : ['left', 'right', 'bottom', 'top']) : ['top', 'bottom', 'right', 'left']
  const side = order.find(fits) ?? order[0]
  let x: number, y: number
  if (side === 'top' || side === 'bottom') { x = r.left + r.width / 2 - w / 2; y = side === 'top' ? r.top - GAP - h : r.bottom + GAP }
  else { y = r.top + r.height / 2 - h / 2; x = side === 'left' ? r.left - GAP - w : r.right + GAP }
  x = Math.min(Math.max(x, PAD), vw - PAD - w)
  y = Math.min(Math.max(y, PAD), vh - PAD - h)
  t.style.left = `${Math.round(x)}px`
  t.style.top = `${Math.round(y)}px`
  t.dataset.side = side
}

function show(el: HTMLElement, instant: boolean) {
  const t = box()
  clearTimeout(hideTimer)
  if (current && current !== el) current.removeAttribute('aria-describedby')
  current = el
  settle(el)
  t.hidden = false
  fill(t, el)
  place(t, el)
  el.setAttribute('aria-describedby', t.id)
  t.toggleAttribute('data-instant', instant)
  if (!instant && !t.hasAttribute('data-open')) void t.offsetWidth
  t.setAttribute('data-open', '')
  if (instant) requestAnimationFrame(() => t.removeAttribute('data-instant'))
  cancelAnimationFrame(watch)
  watch = requestAnimationFrame(follow)
}

/** The shell redraws its chrome often, so the element under a tip can be replaced while it shows:
 *  then the tip moves to what is now under the pointer, or closes. */
function follow() {
  if (!current) return
  if (!current.isConnected) {
    const next = at.x >= 0 ? triggerOf(document.elementFromPoint(at.x, at.y)) : null
    if (next) show(next, true)
    else { hide(); return }
  }
  watch = requestAnimationFrame(follow)
}

function hide() {
  clearTimeout(timer); timer = 0
  cancelAnimationFrame(watch)
  const t = tip
  if (current) { current.removeAttribute('aria-describedby'); current = null; lastHide = performance.now() }
  settle()
  if (!t || !t.hasAttribute('data-open')) return
  t.removeAttribute('data-open')
  t.removeAttribute('data-instant')
  hideTimer = window.setTimeout(() => { if (!t.hasAttribute('data-open')) t.hidden = true }, 120)
}

function want(el: HTMLElement | null) {
  if (el === current) return
  clearTimeout(timer); timer = 0
  settle(el)
  if (!el) { hide(); return }
  const warm = !!current || performance.now() - lastHide < WARM
  if (warm) { show(el, true); return }
  timer = window.setTimeout(() => {
    timer = 0
    const now = el.isConnected ? el : at.x >= 0 ? triggerOf(document.elementFromPoint(at.x, at.y)) : null
    if (now) show(now, false)
  }, DELAY)
}

let installed = false
export function installTips() {
  if (installed) return
  installed = true
  const doc = document
  doc.addEventListener('pointerover', e => {
    if (e.pointerType === 'touch') return
    at = { x: e.clientX, y: e.clientY }
    const el = triggerOf(e.target)
    if (quiet || pressed) { if (!el) want(null); return }
    want(el)
  }, true)
  doc.addEventListener('pointermove', e => {
    if (e.pointerType === 'touch') return
    at = { x: e.clientX, y: e.clientY }
    if (!quiet) return
    const el = triggerOf(e.target)
    if (Math.hypot(at.x - quiet.x, at.y - quiet.y) > 3) { quiet = null; if (!pressed) want(el) }
  }, { capture: true, passive: true })
  doc.documentElement.addEventListener('pointerleave', () => { at = { x: -1, y: -1 }; want(null) })
  // A press or Esc is the user acting, not reading: the tip goes, and stays away (through the
  // redraw that often follows) until the pointer moves on.
  const hush = () => { quiet = { ...at }; hide() }
  doc.addEventListener('pointerdown', e => {
    if (e.pointerType === 'touch') { press(e); return }
    pressed = true
    hush()
  }, true)
  doc.addEventListener('pointerup', () => { pressed = false }, true)
  doc.addEventListener('focusin', e => {
    const el = e.target instanceof HTMLElement && e.target.matches(':focus-visible') ? triggerOf(e.target) : null
    if (el) want(el)
  })
  doc.addEventListener('focusout', e => { if (e.target === current) hide() })
  doc.addEventListener('keydown', e => { if (e.key === 'Escape' && (current || timer)) hush() }, true)
  addEventListener('scroll', () => { if (current) hide() }, { capture: true, passive: true })
  addEventListener('wheel', () => { if (current) hide() }, { passive: true })
  addEventListener('resize', () => hide())
  addEventListener('blur', () => hide())
}

/** A long press on an explainer shows it, until the finger lifts and a moment after. The tap that
 *  ends it does nothing else. */
function press(e: PointerEvent) {
  if (!(e.target instanceof Element) || !e.target.closest('[data-tip-body]')) return
  const el = triggerOf(e.target)
  if (!el?.dataset.tipBody) { settle(); return }
  const start = { x: e.clientX, y: e.clientY }
  let shown = false
  const longT = window.setTimeout(() => { shown = true; show(el, false) }, LONG_PRESS)
  const move = (m: PointerEvent) => { if (Math.hypot(m.clientX - start.x, m.clientY - start.y) > 10) done() }
  const done = () => {
    clearTimeout(longT)
    removeEventListener('pointermove', move, true)
    removeEventListener('pointerup', done, true)
    removeEventListener('pointercancel', done, true)
    if (!shown) return
    const eat = (c: MouseEvent) => { c.preventDefault(); c.stopPropagation() }
    addEventListener('click', eat, { capture: true, once: true })
    window.setTimeout(() => removeEventListener('click', eat, true), 400)
    window.setTimeout(() => { if (current === el) hide() }, 1500)
  }
  addEventListener('pointermove', move, true)
  addEventListener('pointerup', done, true)
  addEventListener('pointercancel', done, true)
}
