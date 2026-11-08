// Every page of prtype.dev that this app draws answers with a strict CSP: a nonce per answer for
// Next.js's scripts (and Base UI's, through CSPProvider), 'strict-dynamic' for the chunks they load,
// no eval outside `next dev`, no framing, and the two runtime <style>s of Sonner and Vaul by their
// hashes (next.config.ts). The page reads the nonce, and the origin the request came in on (the share
// host checks both the cookie name and the Origin against it), from request headers set here; a
// client's own copies are overwritten. The landing and its files are for search and link previews;
// everything else (/me, /done, and any page that isn't there) is noindex and sends no referrer.
// /done/<kind> (lib/done.ts) answers with its kind's status (a page can only say 200 or 404 itself;
// OpenNext keeps a rewrite's status) and its language for the root layout's <html lang dir>.
// middleware.ts, not proxy.ts: OpenNext for Cloudflare does not run proxy.ts yet.
import { NextResponse, type NextRequest } from 'next/server'
import { DONE, doneKindOf, langOf } from '@/lib/done'

const DEV = process.env.NODE_ENV === 'development'
const PUBLIC = new Set(['/', '/robots.txt', '/llms.txt', '/sitemap.xml'])

export function middleware(req: NextRequest) {
  const nonce = btoa(crypto.randomUUID())
  const csp = [
    "default-src 'none'",
    `script-src 'nonce-${nonce}' 'strict-dynamic'${DEV ? " 'unsafe-eval'" : ''}`,
    `style-src 'self' 'nonce-${nonce}' ${process.env.ME_STYLE_HASHES ?? ''}`.trim(),
    "font-src 'self'",
    "img-src 'self' https://avatars.githubusercontent.com data:",
    `connect-src 'self'${DEV ? ' ws:' : ''}`,
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
  ].join('; ')
  const headers = new Headers(req.headers)
  headers.set('x-nonce', nonce)
  headers.set('x-me-origin', req.nextUrl.origin)
  headers.set('content-security-policy', csp)
  const done = doneKindOf(req.nextUrl.pathname)
  headers.set('x-lang', done ? langOf(req.nextUrl.searchParams.get('lang')) : 'en')
  const res = done
    ? NextResponse.rewrite(req.nextUrl, { status: DONE[done].status, request: { headers } })
    : NextResponse.next({ request: { headers } })
  if (done) res.headers.set('cache-control', 'no-store')
  res.headers.set('content-security-policy', csp)
  res.headers.set('x-frame-options', 'DENY')
  res.headers.set('x-content-type-options', 'nosniff')
  if (!PUBLIC.has(req.nextUrl.pathname)) {
    res.headers.set('referrer-policy', 'no-referrer')
    res.headers.set('x-robots-tag', 'noindex')
  }
  return res
}

// Every page, '/' included (the second pattern alone does not match it); not the static files.
export const config = { matcher: ['/', '/((?!_next/static|_next/image|favicon.ico).+)'] }
