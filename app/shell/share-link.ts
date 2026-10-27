// Share link: the shell's entry to the sheet that makes a link to prototypes (share-link-sheet.tsx),
// mounted once in the shell's portal box and drawn with new props to open or close it. The links are
// made by the session server (/__proto/share/*, app/share/routes.mjs), the same code `proto share`
// runs; the page never sees the owner token. share.ts is the other Share, for screenshots.
import { createElement as h } from 'react'
import { createRoot } from 'react-dom/client'
import { uiBox } from './portals'
import { LinkSheet, type LinkProps } from './share-link-sheet'

export type { LinkProps }

export function createShareLink() {
  const host = document.createElement('div'); uiBox().append(host)
  const root = createRoot(host)
  let id = 0
  return (props: LinkProps | null) => root.render(props ? h(LinkSheet, { ...props, key: ++id }) : null)
}
