// Owner tokens: the host keeps only SHA-256 hashes, so a leaked database is not a leaked token.
const enc = new TextEncoder()
const USED_MS = 3_600_000
const DAY_MS = 86_400_000
// A token dies a year after its last use, so a lost laptop's token does too.
export const TOKEN_MS = 365 * DAY_MS

export async function sha256hex(s) {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(s))
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
}

// Constant time for equal-length strings; the length itself is not a secret here (hex digests).
export function same(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export async function ownerOf(req, env) {
  const m = /^Bearer (\S+)$/.exec(req.headers.get('authorization') || '')
  if (!m) return null
  const hash = await sha256hex(m[1])
  const now = Date.now()
  const row = await env.DB.prepare(
    `SELECT t.sha256 AS sha256, t.last_used_at AS last_used_at, t.expires_at AS expires_at, o.id AS id, o.name AS name, o.gh_id AS gh_id, o.gh_login AS gh_login, o.gh_name AS gh_name, o.gh_avatar AS gh_avatar, o.role AS role, o.status AS status
     FROM owner_tokens t JOIN owners o ON o.id = t.owner_id WHERE t.sha256 = ? AND t.revoked_at IS NULL AND (t.expires_at IS NULL OR t.expires_at > ?)`,
  ).bind(hash, now).first()
  if (!row || !same(row.sha256, hash)) return null
  // At most once an hour: the page polls every 30 s, which would otherwise be 2,880 D1 writes a day.
  // The expiry slides in that same write, at most once a day; a token without one (made before
  // expiry existed) keeps none.
  const slide = row.expires_at !== null && row.expires_at !== undefined && row.expires_at < now + TOKEN_MS - DAY_MS
  if (slide || !row.last_used_at || row.last_used_at < now - USED_MS) {
    await env.DB.prepare('UPDATE owner_tokens SET last_used_at = ?, expires_at = ? WHERE sha256 = ?').bind(now, slide ? now + TOKEN_MS : row.expires_at ?? null, hash).run()
  }
  // gh_*: the owner's GitHub identity once they signed in (null before). sha256: this token, for signout.
  return {
    id: row.id, name: row.name, gh_id: row.gh_id ?? null, gh_login: row.gh_login ?? null, gh_name: row.gh_name ?? null, gh_avatar: row.gh_avatar ?? null,
    role: row.role || 'user', status: row.status || 'active', sha256: hash,
  }
}
