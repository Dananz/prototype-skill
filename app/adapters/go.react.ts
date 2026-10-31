// A link to another screen of the design: <Go to="about">About</Go>. The page walks there (the
// screen's pick, else its first option standing in); `proto design <id>` lists these links. Props
// pass to the <a>, so it styles like any link. React only for now, as <Slot> is.
import { createElement as h, type AnchorHTMLAttributes, type MouseEvent } from 'react'

export function Go({ to, children, onClick, ...props }: { to: string } & AnchorHTMLAttributes<HTMLAnchorElement>) {
  return h('a', {
    href: '#', 'data-proto-go': to, ...props,
    onClick: (e: MouseEvent<HTMLAnchorElement>) => {
      onClick?.(e)
      if (e.defaultPrevented) return
      e.preventDefault()
      // The page is the top window, also from inside a device view's frame.
      ;(window.top ?? window).dispatchEvent(new CustomEvent('proto:go', { detail: { to } }))
    },
  }, children)
}
