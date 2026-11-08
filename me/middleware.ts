import { NextResponse, type NextRequest } from 'next/server'
export function middleware(req: NextRequest) {
  const nonce = btoa(crypto.randomUUID())
  const csp = `default-src 'none'; script-src 'nonce-${nonce}' 'strict-dynamic'; style-src 'self' 'nonce-${nonce}'; font-src 'self'; img-src 'self' https://avatars.githubusercontent.com data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`
  const headers = new Headers(req.headers)
  headers.set('x-nonce', nonce)
  headers.set('content-security-policy', csp)
  const res = NextResponse.next({ request: { headers } })
  res.headers.set('content-security-policy', csp)
  return res
}
export const config = { matcher: ['/', '/((?!_next/static|_next/image|favicon.ico).+)'] }
