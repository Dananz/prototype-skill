// What a variant shows instead of itself: while it is building and nothing has rendered yet, a
// quiet box; once it is built, its error. Shared by the shell and the framework adapters.
export const BUILDING_CLASS = 'grid min-h-full place-items-center p-10 text-xs text-zinc-400'
export const ERROR_CLASS = 'm-4 whitespace-pre-wrap rounded-lg bg-rose-50 p-4 text-xs text-rose-700 dark:bg-rose-950 dark:text-rose-200'

/** A variant's file (/src/protos/today/C.tsx, also as a full path) as its prototype and letter; null for any other file. */
export const refOfPath = (path: string) => {
  const m = path.match(/\/src\/protos\/([^/]+)\/([A-Z]{1,2})\.\w+(?:[?#]|$)/)
  return m ? { proto: m[1], variant: m[2] } : null
}

/** A variant's own file or one of its helpers (c-map.tsx belongs to C) as its prototype and letter. */
export const ownerOfPath = (path: string) => {
  const m = path.match(/\/src\/protos\/([^/]+)\/(?:([A-Z]{1,2})\.\w+|([a-z]{1,2})-[^/?#]*)(?:[?#]|$)/)
  return m ? { proto: m[1], variant: (m[2] || m[3]).toUpperCase() } : null
}

/** While its host is marked data-building, keeps a copy of the variant's last complete frame, so an
 *  edit that throws can show it, frozen. The copy is taken 300 ms after the page changes (at most
 *  that often, so a variant that animates is copied too) and never while an error is showing, so a
 *  frame a failed update left half-patched is never kept. onMark runs whenever the mark changes. */
export function keepFrame(host: HTMLElement, failing: () => boolean, onMark: (building: boolean) => void) {
  let frame = '', t = 0
  const snap = () => { t = 0; if (!failing() && host.hasAttribute('data-building')) frame = host.innerHTML }
  const content = new MutationObserver(() => { t ||= window.setTimeout(snap, 300) })
  const sync = () => {
    const building = host.hasAttribute('data-building')
    if (building) { content.observe(host, { childList: true, subtree: true, characterData: true, attributes: true }); t ||= window.setTimeout(snap, 300) }
    else { content.disconnect(); clearTimeout(t); t = 0; frame = '' }
    onMark(building)
  }
  const mark = new MutationObserver(sync)
  mark.observe(host, { attributes: true, attributeFilter: ['data-building'] })
  sync()
  return { frame: () => frame, stop: () => { mark.disconnect(); content.disconnect(); clearTimeout(t) } }
}
