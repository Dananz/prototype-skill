// The gallery: the overview of the project, in place of the lobbies with the project tree on.
import { useMemo, useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'
import type { Design, Proto } from '../shell'
import { Still } from './still'
import { Gallery, type Pic } from './view'

export type GalleryInput = {
  protos: Proto[]; designs: Design[]; hidden: boolean
  /** The clear part of the page (`left,top,right,bottom` insets in px) when it runs under the page's cards. */
  safe?: string
  /** What to show: an exploration (`round:<slug>`), a design or a flow (its tree key), `#n` to ask again. */
  frame?: string
  /** Each prototype's count of file edits (`slug:n`, space-separated): a card's still is taken again when it moves. */
  stamps?: string
  /** What protos holds (shell.ts scope): 'all', 'favs' or 'conv:<conversation>'; me: this conversation. */
  scope?: string; me?: string
  /** The project's conversations, newest first with this one first, as JSON: [{ sid, name, at, n, picked }]. */
  convs?: string
}
export type GalleryApi = {
  get(): GalleryInput; subscribe(fn: () => void): () => void
  /** Opens a route. */
  open(route: string): void
  mount(el: HTMLElement, component: unknown): () => void
  /** Scopes the page (the tree too): 'conv:<id>', 'all' or 'favs'. */
  setScope(scope: string): void
}

function GalleryRoot({ api }: { api: GalleryApi }) {
  const input = useSyncExternalStore(api.subscribe, api.get)
  const safe = useMemo(() => { const [l = 0, t = 0, r = 0, b = 0] = (input.safe ?? '').split(',').map(Number); return { l, t, r, b } }, [input.safe])
  const stampOf = useMemo(() => new Map((input.stamps ?? '').split(' ').filter(Boolean).map(x => { const i = x.lastIndexOf(':'); return [x.slice(0, i), Number(x.slice(i + 1))] as [string, number] })), [input.stamps])
  const pic: Pic = (p, letter, want) => {
    const [w, h] = p.kind === 'phone' ? p.screen : [1200, 750]
    return <Still v={p.variants.find(v => v.id === letter)} route={`${p.id}/${letter}`} w={w} h={h} size={0.4} want={want && !input.hidden} stamp={`${stampOf.get(p.id) ?? 0}:`} mount={api.mount} />
  }
  return <Gallery input={input} pic={pic} open={api.open} safe={safe} setScope={api.setScope} />
}

export function mountGallery(host: HTMLElement, api: GalleryApi) {
  const root = createRoot(host)
  root.render(<GalleryRoot api={api} />)
  return () => root.unmount()
}
