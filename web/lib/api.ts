// The share host's /me API, from the browser: same origin, so the cookie goes with it and every change
// carries the Origin the host checks. Signed out meanwhile: back to /me, which offers the sign-in.
import type { Link } from './types'

export class HostError extends Error {
  constructor(readonly status: number) { super(`the host answered ${status}`) }
}

export async function send<T>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch(`/me/api/${path}`, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (r.status === 401) {
    // A whole new load: the server asks the host again and draws the sign-in.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign('/me')
    throw new HostError(401)
  }
  if (!r.ok) throw new HostError(r.status)
  return (await r.json().catch(() => ({}))) as T
}

export const fetchShares = () => send<Link[]>('GET', 'shares')
