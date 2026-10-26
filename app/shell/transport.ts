// The page's calls to a server, in one place. In the owner's session they are the dev server's
// /__proto routes, made exactly as the shell always made them (it reads the Response itself). In a
// share there is no session server: the host answers the share's state, and nothing a viewer does
// can change the session, so the other calls refuse at once. Comments to the host come in phase 1.
import { SHARE } from './mode'

/** A share's state on its host: a version above the page's means the owner updated the link. */
export type ShareState = { version: number; updatedAt: string }

const JSON_TYPE = { 'content-type': 'application/json' }
const readOnly = () => Promise.reject(new Error('read-only'))

/**
 * The session's status (dev; throws when the server is gone, as fetch does), or the share's state
 * (share; null when it can't be had). A share opened from a file has no host to ask.
 */
export async function status<T = ShareState>(): Promise<T | null> {
  if (!SHARE) return (await fetch('/__proto/status')).json()
  if (location.protocol === 'file:') return null
  try {
    // Relative to the document, so a share served under a path (/k3x9p2/) asks its own host route.
    // The custom header is what the host's JSON routes require (no simple cross-origin request has it).
    const res = await fetch('api/state', { headers: { 'X-Proto': '1' }, cache: 'no-store' })
    if (!res.ok) return null
    const { version, updatedAt } = await res.json()
    return typeof version === 'number' ? { version, updatedAt } as T : null
  } catch { return null }
}

/** A change sent to the session server (/__proto/<path>). */
export const post = (path: string, body: unknown, signal?: AbortSignal): Promise<Response> =>
  SHARE ? readOnly() : fetch(`/__proto/${path}`, { method: 'POST', headers: JSON_TYPE, body: JSON.stringify(body), signal })

/** Comments sent to the session's agent. */
export const sendBatch = (body: unknown): Promise<Response> =>
  SHARE ? readOnly() : fetch('/__proto/comments', { method: 'POST', headers: JSON_TYPE, body: JSON.stringify(body) })

/** A variant starred or unstarred. */
export const fav = (body: unknown): Promise<Response> =>
  SHARE ? readOnly() : fetch('/__proto/fav', { method: 'POST', headers: JSON_TYPE, body: JSON.stringify(body) })
