// While commenting, the design is only looked at, and that includes what it listens to on the page
// as a whole. A design's menu or popover typically closes on a press outside it, heard on window or
// document, often in the capture phase, which runs before anything the shell can put on the
// document. So pressing Comment (or C), then clicking an item in the open menu to comment on it,
// used to close the menu first. Here every listener put on window, document, <html> or <body> for
// a press, a click, a key or a focus move is wrapped, and skips the events `quiet` says are the
// comment layer's: everything while picking or writing a comment, and anything on the comment
// chrome. Nothing is stopped: the event goes on as it would, to React's own roots (which listen on
// their containers, not here) and to the shell, whose own page listeners are added with `listen`
// and never wrapped. Installed when the shell is imported, before any variant has loaded.

const page = EventTarget.prototype
const add = page.addEventListener
const remove = page.removeEventListener

// Pointer and mouse moves are left alone: drags (the design's and the shell's) end on window.
const GUARDED = new Set(['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu', 'touchstart', 'touchend', 'keydown', 'keyup', 'focusin', 'focusout'])
const isPage = (t: EventTarget) => t === window || t === document || t === document.documentElement || t === document.body
const keyOf = (type: string, opts?: boolean | EventListenerOptions) => `${type}|${typeof opts === 'boolean' ? opts : !!opts?.capture}`

let hidden: (e: Event) => boolean = () => false
// One wrapper per target, listener, type and phase, so adding twice still adds once and a remove finds it.
const wrapped = new WeakMap<EventTarget, WeakMap<object, Map<string, EventListener>>>()

page.addEventListener = function (this: EventTarget, type: string, fn: EventListenerOrEventListenerObject | null, opts?: boolean | AddEventListenerOptions) {
  if (!fn || !GUARDED.has(type) || !isPage(this)) return add.call(this, type, fn, opts)
  let byFn = wrapped.get(this)
  if (!byFn) wrapped.set(this, byFn = new WeakMap())
  let byKey = byFn.get(fn)
  if (!byKey) byFn.set(fn, byKey = new Map())
  const k = keyOf(type, opts)
  let w = byKey.get(k)
  if (!w) {
    w = function (this: EventTarget, e: Event) {
      let skip = false
      try { skip = hidden(e) } catch { /* a broken check must never break the page */ }
      if (skip) return
      return typeof fn === 'function' ? fn.call(this, e) : fn.handleEvent(e)
    }
    byKey.set(k, w)
  }
  return add.call(this, type, w, opts)
}
page.removeEventListener = function (this: EventTarget, type: string, fn: EventListenerOrEventListenerObject | null, opts?: boolean | EventListenerOptions) {
  const w = fn ? wrapped.get(this)?.get(fn)?.get(keyOf(type, opts)) : undefined
  return remove.call(this, type, w ?? fn, opts)
}

/** Which events the design's page listeners don't hear; set once by the shell. */
export function quiet(when: (e: Event) => boolean) { hidden = when }

/** The shell's own page listeners: they hear everything. Removed with the plain removeEventListener. */
export function listen<K extends keyof DocumentEventMap>(t: Window | Document, type: K, fn: (e: DocumentEventMap[K]) => void, opts?: boolean | AddEventListenerOptions): void
export function listen(t: EventTarget, type: string, fn: EventListenerOrEventListenerObject, opts?: boolean | AddEventListenerOptions): void
export function listen(t: EventTarget, type: string, fn: EventListenerOrEventListenerObject, opts?: boolean | AddEventListenerOptions) {
  add.call(t, type, fn, opts)
}
