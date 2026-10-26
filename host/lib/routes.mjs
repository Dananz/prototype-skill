import { isId } from './ids.mjs'

// Which of the host's faces a URL is. `base` is the host's own name with its port, so the same code
// reads localhost:8787 and prtype.dev. Path mode (`<base>/s/<id>/…`) is recognised here and allowed
// or refused by the Worker, which knows PATH_MODE.
export function route(url, base) {
  const path = url.pathname
  if (path === '/_health') return { at: 'health', path }
  const host = url.host.toLowerCase()
  const b = base.toLowerCase()
  if (host === b) {
    if (path === '/api' || path.startsWith('/api/')) return { at: 'api', path }
    const s = /^\/s\/([^/]+)(\/.*)?$/.exec(path)
    if (s && isId(s[1])) return { at: 'share', shareId: s[1], path: s[2] || '' }
    const apex = /^\/([^/]+)\/?$/.exec(path)
    if (apex && isId(apex[1])) return { at: 'apex', shareId: apex[1], path }
    return { at: 'none', path }
  }
  if (host.endsWith('.' + b)) {
    const label = host.slice(0, -(b.length + 1))
    if (isId(label)) return { at: 'share', shareId: label, path }
  }
  return { at: 'none', path }
}
