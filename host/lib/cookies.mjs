// Signed values (the viewer cookie, the 60 s sign-in ticket, the apex's OAuth state) and the
// cookies that carry them. One HMAC-SHA256 key, VIEWER_KEY; the purpose is part of what is signed,
// so a ticket can never be played back as a cookie, nor a state cookie as a ticket.
const enc = new TextEncoder()

export const b64url = bytes => {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
const unb64url = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))

const keys = new Map()
function keyOf(secret) {
  if (!keys.has(secret)) keys.set(secret, crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']))
  return keys.get(secret)
}

/** `<base64url JSON>.<base64url MAC>`; payload carries its own `exp` (ms). */
export async function sign(secret, purpose, payload) {
  const body = b64url(enc.encode(JSON.stringify(payload)))
  const mac = await crypto.subtle.sign('HMAC', await keyOf(secret), enc.encode(`${purpose}.${body}`))
  return `${body}.${b64url(new Uint8Array(mac))}`
}

/** The payload, or null when the MAC, the purpose or the expiry is wrong. */
export async function verify(secret, purpose, token, now = Date.now()) {
  if (!secret || typeof token !== 'string' || token.length > 4096) return null
  const parts = token.split('.')
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null
  try {
    // subtle.verify compares in constant time.
    if (!await crypto.subtle.verify('HMAC', await keyOf(secret), unb64url(parts[1]), enc.encode(`${purpose}.${parts[0]}`))) return null
    const p = JSON.parse(new TextDecoder().decode(unb64url(parts[0])))
    if (!p || typeof p !== 'object' || typeof p.exp !== 'number' || p.exp <= now) return null
    return p
  } catch { return null }
}

/** Every cookie on the request as [name, value], duplicates kept (path mode can send several `v`). */
export function readCookies(req) {
  return (req.headers.get('cookie') || '').split(';').map(s => s.trim()).filter(Boolean).map(s => {
    const i = s.indexOf('=')
    return i < 0 ? [s, ''] : [s.slice(0, i), s.slice(i + 1)]
  })
}

export function cookie(name, value, { path = '/', maxAge, secure }) {
  return `${name}=${value}; Path=${path}; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`
}

// The viewer cookie. `__Host-` needs Secure and Path=/, so it is used only over https on a share's
// own origin; on http://localhost (Safari refuses Secure there) and in path mode it is plain `v`,
// and path mode scopes it to the share's path, since one origin holds every share.
export function viewerCookie(url, shareId, pathForm) {
  const secure = url.protocol === 'https:'
  return { name: secure && !pathForm ? '__Host-v' : 'v', path: pathForm ? `/s/${shareId}/` : '/', secure }
}

// The apex's OAuth state cookie: 10 minutes, only for /auth/github. Its name differs from the
// viewer's because in path mode the apex and the shares are one origin.
export function stateCookie(url) {
  const secure = url.protocol === 'https:'
  return { name: secure ? '__Host-gh' : 'gh', path: secure ? '/' : '/auth/github', secure }
}
