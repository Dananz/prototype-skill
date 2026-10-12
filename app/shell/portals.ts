// What the shell renders outside its root (its menus, tooltips, sheets and the docked composer's
// @ menu) goes in one box at the end of <body>. So anything else on the page outside the root is the
// design's: a sheet, a dialog or a toast it renders on document.body through a portal, as Base UI's
// Drawer does by default. The motion dock records that motion too.

let root: HTMLElement | null = null
let box: HTMLElement | null = null

/** The shell's root: everything in it (the chrome, and every design on the stage) is not a portal. */
export function setShellRoot(el: HTMLElement) { root = el; uiBox() }

/** The box the shell's own portals render in. */
export function uiBox() {
  if (!box?.isConnected) {
    box = document.createElement('div')
    box.setAttribute('data-proto-ui', '')
    document.body.append(box)
  }
  return box
}

/**
 * Whether el is something a design rendered outside the stage through a portal: on the page, but
 * not in the shell's root (where the designs on the stage are, each a host of its own) or its box,
 * not the <body> or <html> around them, and not in a shadow root (what a browser extension draws).
 */
export function portaled(el: Node | null): el is Element {
  const other = theirs(el)
  if (other) return other.portaled(el)
  return el instanceof Element && !!root && el.isConnected && el.getRootNode() === document
    && !root.contains(el) && !el.contains(root) && !uiBox().contains(el)
}

/** A design's animations: in its host, and on what it rendered through a portal. */
export function animationsOf(host: HTMLElement): Animation[] {
  const other = theirs(host)
  if (other) return other.animationsOf(host)
  const own = host.getAnimations({ subtree: true })
  const out = root ? document.getAnimations().filter(a => portaled((a.effect as KeyframeEffect | null)?.target ?? null)) : []
  return out.length ? [...own, ...out] : own
}

// A design in a device view's frame (view/frame.ts) is another window's, with its own shell root and
// box: what is a portal there is that page's to say. Each page offers its two answers on its window.
type Portals = { portaled: typeof portaled; animationsOf: typeof animationsOf }
;(window as unknown as { __protoPortals: Portals }).__protoPortals = { portaled, animationsOf }
function theirs(n: Node | null) {
  const d = n?.ownerDocument
  if (!d || d === document) return null
  try { return (d.defaultView as unknown as { __protoPortals?: Portals } | null)?.__protoPortals ?? null } catch { return null }
}
