import { isId } from './ids.mjs'

// Which of the host's faces a URL is. `base` is the host's own name with its port (or a list of the
// names it answers to), so the same code reads localhost:8787 and prtype.dev. Path mode
// (`<base>/s/<id>/…`) is recognised here and allowed or refused by the Worker, which knows PATH_MODE.
export function route(url, base) {
  const path = url.pathname
  if (path === '/_health') return { at: 'health', path }
  const host = url.host.toLowerCase()
  const names = (Array.isArray(base) ? base : [base]).map(b => b.toLowerCase())
  if (names.includes(host)) {
    if (path === '/api' || path.startsWith('/api/')) return { at: 'api', path }
    const s = /^\/s\/([^/]+)(\/.*)?$/.exec(path)
    if (s && isId(s[1])) return { at: 'share', shareId: s[1], path: s[2] || '' }
    const apex = /^\/([^/]+)\/?$/.exec(path)
    if (apex && isId(apex[1])) return { at: 'apex', shareId: apex[1], path }
    return { at: 'none', path }
  }
  for (const b of names) {
    if (!host.endsWith('.' + b)) continue
    const label = host.slice(0, -(b.length + 1))
    if (isId(label)) return { at: 'share', shareId: label, path }
  }
  return { at: 'none', path }
}

// The names a host answers to. On this Mac (BASE localhost:<port> or 127.0.0.1:<port>) that is both
// loopback names at that port: 127.0.0.1 has no subdomains and *.localhost doesn't resolve in every
// browser, so either may be the one a link has to use. Anywhere else, BASE alone.
export function namesOf(base) {
  const m = /^(localhost|127\.0\.0\.1)(:\d+)?$/i.exec(base)
  if (!m) return { names: [base], local: false }
  return { names: [`localhost${m[2] || ''}`, `127.0.0.1${m[2] || ''}`], local: true }
}
