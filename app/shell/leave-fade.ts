// A popover opens at once and fades as it goes. What fades is an inert copy over the page: the real
// one is gone on the spot, so its focus, its keys and the shell's "is a menu open" never wait.
import { uiBox } from './portals'

const ghosts = new Map<string, HTMLElement>()

/** Call while el is still on the page. key: reopening that popover takes its fading copy away. */
export function leaveFade(el: HTMLElement, key: string) {
  const r = el.getBoundingClientRect()
  if (!r.width) return
  const copy = el.cloneNode(true) as HTMLElement
  const from = [el, ...el.querySelectorAll<HTMLElement>('*')], to = [copy, ...copy.querySelectorAll<HTMLElement>('*')]
  // Nothing looks for what is in the copy. A note's placeholder is drawn from its attribute, so it stays.
  for (const n of to) for (const { name } of [...n.attributes]) if (name === 'id' || name === 'role' || (name.startsWith('data-') && name !== 'data-placeholder')) n.removeAttribute(name)
  copy.inert = true
  copy.setAttribute('data-leaving', '')
  // Pinned where the popover was, whatever placed it, in the text colour it had from the page around it.
  Object.assign(copy.style, { position: 'fixed', inset: 'auto', left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`, margin: '0', translate: 'none', pointerEvents: 'none', color: getComputedStyle(el).color })
  ghosts.get(key)?.remove()
  ghosts.set(key, copy)
  uiBox().append(copy)
  from.forEach((n, i) => { if (n.scrollTop || n.scrollLeft) [to[i].scrollTop, to[i].scrollLeft] = [n.scrollTop, n.scrollLeft] })
  const done = () => { copy.remove(); if (ghosts.get(key) === copy) ghosts.delete(key) }
  copy.animate({ opacity: [1, 0] }, { duration: 200, easing: 'ease-out' }).finished.then(done, done)
}

/** Takes away the copies of what is open again. */
export function dropGhosts(isOpen: (key: string) => boolean) {
  for (const [key, copy] of ghosts) if (isOpen(key)) { copy.remove(); ghosts.delete(key) }
}
