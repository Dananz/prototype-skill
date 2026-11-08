// The share host, from the server: over the HOST service binding (wrangler.jsonc), as the browser's
// own request, with its cookie. The URL keeps the origin the request came in on (middleware.ts): the
// host reads the cookie by that scheme (__Host-o on https, o on http) and sends any other name to BASE.
import { headers } from 'next/headers'
import { getCloudflareContext } from '@opennextjs/cloudflare'
import type { Link, Me } from './types'

type Host = { fetch: typeof fetch }

async function hostGet(path: string): Promise<Response> {
  const h = await headers()
  const origin = h.get('x-me-origin')
  if (!origin) throw new Error('middleware.ts did not run')
  const { env } = await getCloudflareContext({ async: true })
  const host = (env as unknown as { HOST?: Host }).HOST
  if (!host) throw new Error('no HOST binding')
  const cookie = h.get('cookie')
  return host.fetch(new URL(path, origin), { headers: { accept: 'application/json', ...(cookie ? { cookie } : {}) }, redirect: 'manual' })
}

export type Who =
  | { kind: 'in'; me: Me }
  | { kind: 'out'; signin: boolean }
  /** A host that keeps /me shut (path mode), or one that is down. */
  | { kind: 'closed' }

export async function whoIsIn(): Promise<Who> {
  const r = await hostGet('/me/api/me')
  if (r.status === 401) {
    const b = (await r.json().catch(() => null)) as { signin?: boolean } | null
    return { kind: 'out', signin: b?.signin !== false }
  }
  if (!r.ok) return { kind: 'closed' }
  return { kind: 'in', me: (await r.json()) as Me }
}

export async function sharesOf(): Promise<Link[]> {
  const r = await hostGet('/me/api/shares')
  if (!r.ok) throw new Error(`the host answered ${r.status}`)
  return (await r.json()) as Link[]
}
