// The host's users (spec 2026-10-28-shared-host-design): signing in from a Mac without a token, each
// user's quota inside the host's own daily budget, and what an admin can do. A user is an owners row,
// made by a GitHub sign-in; their tokens are hashed in owner_tokens, as the first owner's always were.
import { newId, isId } from './ids.mjs'
import { json, fail, bodyOf } from './http.mjs'
import { sha256hex, same, TOKEN_MS } from './auth.mjs'
import { b64url } from './cookies.mjs'
import { signinReady } from './github.mjs'
import { giveBack, take } from './comments.mjs'
import { holdBytes, letGo, mb, resetText, room } from './budget.mjs'

const SIGNIN_MS = 10 * 60_000
// A row the person finished at 9:59 can still be taken by a poll a moment after its 10 minutes.
const POLL_GRACE_MS = 60_000
const STARTS_PER_HOUR = 20 // per IP: /api/signin/start needs no token
const DEVICE = /^[^\u0000-\u001f\u007f]{1,80}$/
// The code the Mac shows beside the link and the confirm page repeats: 8 letters, no vowels (no
// words, no I or O to mistake for 1 or 0). 20 letters; bytes from 240 up are drawn again (no bias).
const LETTERS = 'BCDFGHJKLMNPQRSTVWXZ'
function wordsOf() {
  let out = ''
  while (out.length < 8) for (const b of crypto.getRandomValues(new Uint8Array(16))) if (b < 240 && out.length < 8) out += LETTERS[b % 20]
  return `${out.slice(0, 4)}-${out.slice(4)}`
}

// Per user, nested inside the host's 90% refusals (decision 25). Admins aren't held to them: the
// maintainer's own links predate them, and the host's budget still stops everyone.
export const QUOTA = { uploads: 30, shares: 25, bytes: 75_000_000 }
// New ids a user may ask for in a day (POST /api/shares): each is a D1 row in the host's shared
// budget, and most become a share within the day's 30 uploads. An admin's are counted, not capped.
export const CREATES = 60
const NO_CAP = Number.MAX_SAFE_INTEGER
const DAY = () => Math.floor(Date.now() / 86_400_000)

// ---------- sign-in from a Mac without a token ----------

/**
 * POST /api/signin/start { device? }: { code, poll, url, exp, words }. The client opens url, shows
 * words beside it, and polls with the secret; only its hash rests here. The person approves on the
 * host's confirm page, which shows the same words. 20 starts an hour per IP.
 */
export async function signinBegin(req, env, url) {
  if (!signinReady(env)) return fail(503, 'GitHub sign-in is not set up on this host.', { code: 'signin_off' })
  // Past the per-IP count (which many addresses get around), the host's own day: a start writes a
  // few rows, and stops with everything else once the day's D1 writes are used up.
  if (!await room(env.DB, 'd1_write', 10)) return fail(503, `The host's daily budget is used up. ${resetText()}`, { code: 'budget' })
  let device = 'device'
  if (req.headers.get('content-type')) {
    const b = await bodyOf(req)
    if (b instanceof Response) return b
    if (b.device !== undefined && b.device !== null) {
      if (typeof b.device !== 'string' || !DEVICE.test(b.device.trim())) return fail(400, 'device is text of at most 80 characters.', { code: 'invalid' })
      device = b.device.trim()
    }
  }
  const now = Date.now()
  const ip = req.headers.get('cf-connecting-ip') || 'unknown'
  if (!await take(env, `ip:signin:${ip}`, Math.floor(now / 3_600_000), STARTS_PER_HOUR)) return fail(429, 'Too many sign-ins from here this hour. Try again later.', { code: 'rate' })
  const code = newId()
  const poll = b64url(crypto.getRandomValues(new Uint8Array(32)))
  const exp = now + SIGNIN_MS
  const words = wordsOf()
  await env.DB.prepare('INSERT INTO signins (code, poll, device, words, exp) VALUES (?, ?, ?, ?, ?)').bind(code, await sha256hex(poll), device, words, exp).run()
  return json({ code, poll, url: `${url.protocol}//${env.BASE}/auth/github?signin=${code}`, exp, words })
}

/**
 * POST /api/signin/poll { code, poll }: 202 while the person is on GitHub; once they are back, the
 * device token is minted now, its hash stored, the row deleted, and the token answered this once.
 * A wrong secret is a 404, as an unknown code is.
 */
export async function signinPoll(req, env) {
  const b = await bodyOf(req)
  if (b instanceof Response) return b
  const unknown = () => fail(404, 'No such sign-in.', { code: 'no_signin' })
  if (!isId(b.code) || typeof b.poll !== 'string' || b.poll.length > 100) return unknown()
  const row = await env.DB.prepare('SELECT * FROM signins WHERE code = ?').bind(b.code).first()
  if (!row || !same(row.poll, await sha256hex(b.poll))) return unknown()
  const now = Date.now()
  if (row.exp + (row.owner_id ? POLL_GRACE_MS : 0) <= now) return fail(410, 'This sign-in expired. Start again.', { code: 'expired' })
  if (!row.owner_id) return json({ state: 'waiting' }, 202)
  // Once: of two polls at once, only the one that deletes the row mints.
  const taken = await env.DB.prepare('DELETE FROM signins WHERE code = ? AND owner_id IS NOT NULL').bind(b.code).run()
  if (!taken.meta?.changes) return unknown()
  const owner = await env.DB.prepare('SELECT id, gh_login, gh_name, gh_avatar, status FROM owners WHERE id = ?').bind(row.owner_id).first()
  if (!owner) return unknown()
  // A banned account signs in to the page that says so, and its Mac gets no token.
  const shut = banned(owner)
  if (shut) return shut
  const token = b64url(crypto.getRandomValues(new Uint8Array(32)))
  await env.DB.prepare('INSERT INTO owner_tokens (sha256, owner_id, device, created_at, expires_at) VALUES (?, ?, ?, ?, ?)').bind(await sha256hex(token), owner.id, row.device, now, now + TOKEN_MS).run()
  return json({ token, login: owner.gh_login, name: owner.gh_name ?? null, avatar: owner.gh_avatar ?? null, status: owner.status })
}

/** POST /api/owner/signout: this token is revoked; the others (other Macs) stay. */
export async function signout(env, owner) {
  await env.DB.prepare('UPDATE owner_tokens SET revoked_at = ? WHERE sha256 = ? AND revoked_at IS NULL').bind(Date.now(), owner.sha256).run()
  return json({ ok: true })
}

// ---------- status and quota ----------

/** A banned user's token reads who they are and signs out; nothing else. */
export const banned = owner => owner.status === 'banned' ? fail(403, 'This account is blocked on this host.', { code: 'banned' }) : null
/** A pending user waits for approval before a new share; their own shares (if any) still update. */
export const pending = owner => owner.status === 'pending' ? fail(403, 'Your account waits for the maintainer\'s approval. Sharing opens once you are approved.', { code: 'pending', login: owner.gh_login ?? null }) : null

const uploadsToday = async (env, owner, now = Date.now()) => (await env.DB.prepare('SELECT n FROM caps WHERE what = ? AND slot = ?').bind(`up:${owner.id}`, Math.floor(now / 86_400_000)).first())?.n ?? 0
// Live: not removed and not expired. Stored: what KV holds of theirs (an expired page until its purge).
const liveShares = async (env, owner, except = '', now = Date.now()) => (await env.DB.prepare('SELECT COUNT(*) AS n FROM shares WHERE owner_id = ? AND deleted_at IS NULL AND (expires_at IS NULL OR expires_at > ?) AND id != ?').bind(owner.id, now, except).first())?.n ?? 0
const storedOf = async (env, owner, except = '') => (await env.DB.prepare('SELECT COALESCE(SUM(bytes), 0) AS n FROM shares WHERE owner_id = ? AND deleted_at IS NULL AND purged_at IS NULL AND id != ?').bind(owner.id, except).first())?.n ?? 0

/** GET /api/owner's quota: what this user used against their caps (null caps for an admin). */
export async function quotaOf(env, owner) {
  const free = owner.role === 'admin'
  const [uploads, shares, bytes] = await Promise.all([uploadsToday(env, owner), liveShares(env, owner), storedOf(env, owner)])
  return { uploads, uploadsCap: free ? null : QUOTA.uploads, shares, sharesCap: free ? null : QUOTA.shares, bytes, bytesCap: free ? null : QUOTA.bytes }
}

const over = error => fail(507, error, { code: 'quota' })

/**
 * POST /api/shares: a new id counts against the user's day (CREATES), in the same statement that
 * checks it, so a loop of creates stops there. Null when it may, else the 507.
 */
export async function createRefused(env, owner) {
  if (owner.role !== 'admin' && await liveShares(env, owner) >= QUOTA.shares) return over(`You have ${QUOTA.shares} live links, the most one person can. proto share rm <id> frees one.`)
  if (await take(env, `new:${owner.id}`, DAY(), owner.role === 'admin' ? NO_CAP : CREATES)) return null
  return over(`You've asked for ${CREATES} new links today, the most one person can. ${resetText()}`)
}

/**
 * An upload's share of the user's quota, taken before anything goes to KV (decision 25): one of the
 * day's uploads, and for a page, room for its bytes beside the user's stored shares and their other
 * uploads in flight. Both are counted in the statement that checks them, so uploads at once can't
 * all pass. { refused } (the 507, nothing kept) or { landed, failed }: landed lets the held bytes go
 * once the share's row says them; failed also gives the upload back. Admins are counted, not capped.
 * A new share's live-link cap is read here for the words, and held at the row's insert (liveCap).
 */
export async function reserveUpload(env, owner, { id = '', fresh = false, bytes } = {}) {
  const free = owner.role === 'admin'
  const slot = DAY()
  if (fresh && !free && await liveShares(env, owner, id) >= QUOTA.shares) return { refused: over(`You have ${QUOTA.shares} live links, the most one person can. proto share rm <id> frees one.`) }
  if (!await take(env, `up:${owner.id}`, slot, free ? NO_CAP : QUOTA.uploads)) return { refused: over(`You've uploaded ${QUOTA.uploads} times today, the most one person can. ${resetText()}`) }
  const back = () => giveBack(env, `up:${owner.id}`, slot)
  if (bytes === undefined || free) return { landed: async () => {}, failed: back }
  const what = `held:${owner.id}`
  const held = await holdBytes(env.DB, what, bytes, QUOTA.bytes, 'SELECT COALESCE(SUM(bytes), 0) FROM shares WHERE owner_id = ? AND deleted_at IS NULL AND purged_at IS NULL AND id != ?', [owner.id, id])
  if (held === null) {
    await back()
    return { refused: over(`Your links hold at most ${mb(QUOTA.bytes)}: you hold ${mb(await storedOf(env, owner, id))}, and this one would pass it. proto share rm <id> frees room.`) }
  }
  const landed = () => letGo(env.DB, what, held, bytes)
  return { landed, failed: async () => { await landed(); await back() } }
}

/** The live-link cap for a new share's insert: the most live shares this user may have before it. */
export const liveCap = owner => owner.role === 'admin' ? NO_CAP : QUOTA.shares

// ---------- admin ----------

const STATUSES = ['active', 'pending', 'banned']
const userShape = u => ({ login: u.gh_login ?? null, ghId: u.gh_id ?? null, name: u.gh_name ?? u.name, avatar: u.gh_avatar ?? null, role: u.role, status: u.status, createdAt: u.created_at, shares: Number(u.shares) || 0, bytes: Number(u.bytes) || 0 })

// A user named by GitHub login (any case) or by GitHub id, gh:<id>. A login is refreshed only when
// its user signs in, so after a rename on GitHub two rows can carry one login: then by id only.
async function byLogin(env, name) {
  const id = /^gh:(\d{1,15})$/.exec(name)
  const { results } = id
    ? await env.DB.prepare('SELECT * FROM owners WHERE gh_id = ?').bind(Number(id[1])).all()
    : await env.DB.prepare('SELECT * FROM owners WHERE gh_login = ? COLLATE NOCASE LIMIT 2').bind(name).all()
  if (!results.length) return fail(404, 'No user with that GitHub login.', { code: 'no_user' })
  if (results.length > 1) return fail(409, `More than one user was last seen as @${name} (a GitHub login changed hands). Name them by id, gh:<id> from proto share admin users, or have them sign in again.`, { code: 'ambiguous' })
  return results[0]
}

/**
 * Takes shares down in a few statements whatever their number (a Free invocation has 50
 * subrequests): their keys go to kv_trash for the cron, the rows become tombstones ("This link was
 * removed"), and their comments and presence go, as an owner's own remove does. `where` picks the
 * shares (by owner or by id), its `?` bound to `arg`.
 */
export async function tombstone(env, where, arg) {
  const now = Date.now()
  const live = `FROM shares WHERE ${where} AND deleted_at IS NULL`
  await env.DB.prepare(`INSERT INTO kv_trash (key, at) SELECT COALESCE(html_key, 'html:' || id || ':' || version), ? ${live} AND purged_at IS NULL ON CONFLICT(key) DO NOTHING`).bind(now, arg).run()
  await env.DB.prepare(`INSERT INTO kv_trash (key, at) SELECT card_key, ? ${live} AND card_key IS NOT NULL ON CONFLICT(key) DO NOTHING`).bind(now, arg).run()
  await env.DB.prepare(`UPDATE shares SET deleted_at = ? WHERE ${where} AND deleted_at IS NULL`).bind(now, arg).run()
  await env.DB.prepare(`DELETE FROM comments WHERE share_id IN (SELECT id FROM shares WHERE ${where})`).bind(arg).run()
  await env.DB.prepare(`DELETE FROM presence WHERE share_id IN (SELECT id FROM shares WHERE ${where})`).bind(arg).run()
}

/** /api/admin/…, with the token checked and role = admin. */
export async function admin(req, env, owner, url, parts) {
  if (owner.role !== 'admin') return fail(403, 'Only an admin of this host can do that.', { code: 'admin' })
  const m = req.method
  const only = () => fail(405, 'Method not allowed.')
  // GET /api/admin/users?status=
  if (parts[2] === 'users' && parts.length === 3) {
    if (m !== 'GET') return only()
    const status = url.searchParams.get('status')
    if (status && !STATUSES.includes(status)) return fail(400, `status is one of ${STATUSES.join(', ')}.`, { code: 'invalid' })
    const { results } = await env.DB.prepare(
      `SELECT o.*, (SELECT COUNT(*) FROM shares s WHERE s.owner_id = o.id AND s.deleted_at IS NULL) AS shares,
         (SELECT COALESCE(SUM(bytes), 0) FROM shares s WHERE s.owner_id = o.id AND s.deleted_at IS NULL AND s.purged_at IS NULL) AS bytes
       FROM owners o WHERE ? IS NULL OR o.status = ? ORDER BY o.created_at, o.id`,
    ).bind(status, status).all()
    return json(results.map(userShape))
  }
  // POST /api/admin/users/<login>/approve | ban
  if (parts[2] === 'users' && parts.length === 5 && ['approve', 'ban'].includes(parts[4])) {
    if (m !== 'POST') return only()
    const u = await byLogin(env, decodeURIComponent(parts[3]))
    if (u instanceof Response) return u
    if (parts[4] === 'approve') {
      await env.DB.prepare("UPDATE owners SET status = 'active' WHERE id = ?").bind(u.id).run()
      return json(userShape({ ...u, status: 'active' }))
    }
    if (u.id === owner.id) return fail(409, 'You can\'t ban yourself.', { code: 'self' })
    if (u.role === 'admin') return fail(409, 'An admin can\'t be banned.', { code: 'admin_user' })
    await env.DB.prepare("UPDATE owners SET status = 'banned' WHERE id = ?").bind(u.id).run()
    await env.DB.prepare('UPDATE owner_tokens SET revoked_at = ? WHERE owner_id = ? AND revoked_at IS NULL').bind(Date.now(), u.id).run()
    await tombstone(env, 'owner_id = ?', u.id)
    return json(userShape({ ...u, status: 'banned' }))
  }
  // DELETE /api/admin/shares/<id>: a takedown, of anyone's share.
  if (parts[2] === 'shares' && parts.length === 4) {
    if (m !== 'DELETE') return only()
    const row = isId(parts[3]) ? await env.DB.prepare('SELECT id, deleted_at FROM shares WHERE id = ?').bind(parts[3]).first() : null
    if (!row) return fail(404, 'No such share.')
    if (!row.deleted_at) await tombstone(env, 'id = ?', row.id)
    return json({ id: row.id })
  }
  // GET /api/admin/reports: the latest 200, newest first; source 'auto' is the upload's scan (scan.mjs).
  if (parts[2] === 'reports' && parts.length === 3) {
    if (m !== 'GET') return only()
    const { results } = await env.DB.prepare(
      `SELECT r.id, r.share_id, r.reason, r.created_at, r.source, s.title, s.deleted_at, o.gh_login AS owner, v.login AS reporter
       FROM reports r LEFT JOIN shares s ON s.id = r.share_id LEFT JOIN owners o ON o.id = s.owner_id LEFT JOIN viewers v ON v.gh_id = r.gh_id
       ORDER BY r.created_at DESC, r.id LIMIT 200`,
    ).all()
    return json(results.map(r => ({ id: r.id, share: { id: r.share_id, title: r.title ?? null, owner: r.owner ?? null, removed: !!r.deleted_at }, reason: r.reason, reporter: r.reporter ?? null, source: r.source === 'auto' ? 'auto' : 'viewer', createdAt: r.created_at })))
  }
  return fail(404, 'No such route.')
}
