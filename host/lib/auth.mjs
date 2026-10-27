// Owner tokens: the host keeps only SHA-256 hashes, so a leaked database is not a leaked token.
const enc = new TextEncoder()
const USED_MS = 3_600_000

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
  const row = await env.DB.prepare(
    'SELECT t.sha256 AS sha256, t.last_used_at AS last_used_at, o.id AS id, o.name AS name FROM owner_tokens t JOIN owners o ON o.id = t.owner_id WHERE t.sha256 = ? AND t.revoked_at IS NULL',
  ).bind(hash).first()
  if (!row || !same(row.sha256, hash)) return null
  // At most once an hour: the page polls every 30 s, which would otherwise be 2,880 D1 writes a day.
  const now = Date.now()
  if (!row.last_used_at || row.last_used_at < now - USED_MS) await env.DB.prepare('UPDATE owner_tokens SET last_used_at = ? WHERE sha256 = ?').bind(now, hash).run()
  return { id: row.id, name: row.name }
}
