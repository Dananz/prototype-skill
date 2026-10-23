// The page inside a device view: this same page in a same-origin iframe, at the device's size. The
// page in it knows it is framed (framed, below) and keeps to itself: it doesn't count as someone
// looking (its pings only ask for the status), never writes where it is or what it chose to this
// browser's storage, keeps its comments apart, and offers no device view of its own. What its design
// reports (Try it, copy lines, motion) goes to the page outside, which runs those tools (shared.ts).
import { t } from '../i18n'

/** Whether this page is the one inside a device view: opened with ?dv (as the view loads it), or in a
 *  frame of this page's own (same origin, with a view). Any other frame (an editor's preview pane, a
 *  page on another origin) is someone looking at the page itself, with all of it. */
export const framed = new URLSearchParams(location.search).has('dv') || (() => { try { return window.top !== window && !!window.parent.document.querySelector('[data-view]') } catch { return false } })()

/** Clicks in the page in the frame, heard out here: a frame's events stay in its own document, and
 *  the page outside acts on some of them (⌥-click comments on the design). The view adds each
 *  frame's (view/index.tsx). */
export const frameClicks = new Set<(e: MouseEvent) => void>()

/** A right-click in the page in the frame, with its point in the page outside (the frame is scaled
 *  and offset): the shell opens its menu there, unless the page in the frame made its own. */
export const frameMenus = new Set<(e: MouseEvent, x: number, y: number) => void>()

/** The page in the frame changed what is highlighted (its own document keeps its selection): heard out here for the floating menu on highlighted words. */
export const frameSelections = new Set<() => void>()

/** The page at a place, as a device view loads it: framed, in the theme of the page outside. */
export const frameUrl = (path: string, dark: boolean) => `${location.origin}${path.startsWith('/') ? path : `/${path}`}?dv=1&theme=${dark ? 'dark' : 'light'}`

type ThemeWindow = Window & { __protoTheme?: (dark: boolean) => void }
/** The same-origin frame accepts its parent's theme without remounting the design. */
export function offerTheme(apply: (dark: boolean) => void) { (window as ThemeWindow).__protoTheme = apply }

export type Frame = {
  el: HTMLIFrameElement
  /** The frame's document, once it is the page (not the blank one an iframe starts with). */
  doc(): Document | null
  /** Takes the frame to a place, without a reload; nothing when it is there already. */
  go(path: string): void
  path(): string
  theme(dark: boolean): void
  close(): void
}

/**
 * Puts the page in an iframe in `host`. Its document is bound as soon as it is there, and bound
 * again whenever it loads anew: `route` hears where it goes (its own chrome can move it), `bind`
 * adds what the view listens for in it (two fingers, a pinch, a wheel), returning its undoing, and
 * `bound` says it is there, for the page outside to take it where it is now (it may have moved
 * while the frame loaded).
 */
export function openFrame(host: HTMLElement, url: string, on: { route: (path: string) => void; bind: (d: Document) => () => void; bound: () => void }): Frame {
  const el = document.createElement('iframe')
  el.title = t('This page at another size')
  el.className = 'absolute start-0 top-0 block origin-top-left border-0 bg-white dark:bg-zinc-950'
  host.append(el)
  let d: Document | null = null, unbind = () => {}, closed = false
  const page = () => { try { const n = el.contentDocument; return n && n.URL !== 'about:blank' ? n : null } catch { return null } }
  const route = () => { try { on.route(el.contentWindow!.location.pathname) } catch { /* gone */ } }
  // A load event comes late under a dev server (after every module), so the document is looked for
  // a few times a second: a new one appears as soon as the frame starts loading the page.
  const watch = () => {
    const n = page()
    if (closed || !n || n === d) return
    unbind()
    d = n
    const w = n.defaultView!
    w.addEventListener('proto:place', route)
    const off = on.bind(n)
    unbind = () => { off(); w.removeEventListener('proto:place', route) }
    on.bound()
  }
  const timer = setInterval(watch, 250)
  el.addEventListener('load', watch)
  el.src = url
  return {
    el,
    doc: () => (page() === d ? d : null),
    // As Back would move it: its own address changes, and its page follows (popstate), no reload.
    go(path) {
      try {
        const w = el.contentWindow!
        if (w.location.pathname === path) return
        w.history.pushState(null, '', path + w.location.search)
        w.dispatchEvent(new PopStateEvent('popstate'))
      } catch { /* gone */ }
    },
    path() { try { return el.contentWindow!.location.pathname } catch { return '' } },
    theme(dark) {
      try {
        const w = el.contentWindow as ThemeWindow | null
        if (w?.__protoTheme) {
          const next = new URL(w.location.href)
          next.searchParams.set('theme', dark ? 'dark' : 'light')
          w.history.replaceState(w.history.state, '', next)
          w.__protoTheme(dark)
        }
        // While still loading there is no design state to keep, and its URL supplies the theme.
        else if (w) w.location.replace(frameUrl(w.location.pathname, dark))
      } catch { /* gone */ }
    },
    close() { if (closed) return; closed = true; clearInterval(timer); unbind(); el.remove() },
  }
}

/** The design on the stage of the page in the frame: its mount, in the layer that isn't fading out
 *  (not a lobby's card, not a tool's). */
export function designIn(d: Document | null) {
  const all = d ? [...d.querySelectorAll<HTMLElement>('[data-layers] > :not([inert]) [data-mount]')] : []
  return all.find(m => !m.closest('[data-thumb], [data-stack-item], [data-play-box], [data-fit]')) ?? null
}
