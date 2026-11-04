// A fork offered back: the forker's own link, named on the row of the link it came from. Only that
// link's owner ever reads it, and only its owner can wave it away. An offer on a link that is gone is
// refused; one whose fork is gone or expired simply stops being listed.
import { isId } from './ids.mjs'
import { fail, json } from './http.mjs'

const MAX_OFFERS = 50 // on one link, past which more are refused: an inbox someone else can fill
const MAX_CHANGED = 40

const liveShare = (env, id) => env.DB.prepare('SELECT id, owner_id, version, deleted_at FROM shares WHERE id = ?').bind(id).first()

/** POST /api/shares/<id>/offer { to, base, changed }: <id> is the caller's own link. */
export async function offerShare(req, env, owner, id) {
  const mine = await liveShare(env, id)
  if (!mine || mine.owner_id !== owner.id || mine.deleted_at) return fail(404, 'No such share.', { code: 'no_share' })
  const body = await req.json().catch(() => null)
  if (!isId(body?.to) || body.to === id) return fail(400, 'Send { to }, the id of the link this is a version of.')
  const origin = await liveShare(env, body.to)
  if (!origin || origin.deleted_at) return fail(404, 'The original link is gone, so there is nobody to offer it to.', { code: 'no_origin' })
  const base = Number.isInteger(body.base) && body.base > 0 ? body.base : null
  const changed = Array.isArray(body.changed) ? body.changed.filter(c => typeof c === 'string' && c.length <= 80).slice(0, MAX_CHANGED) : []
  const now = Date.now()
  // In one statement, so offers at once can't all pass a count read first. An offer made again keeps
  // its place and comes back if it was waved away: it is a new version.
  const r = await env.DB.prepare(
    `INSERT INTO offers (origin_id, share_id, owner_id, base_version, changed, created_at, updated_at)
     SELECT ?, ?, ?, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM offers WHERE origin_id = ?) < ? OR EXISTS (SELECT 1 FROM offers WHERE origin_id = ? AND share_id = ?)
     ON CONFLICT(origin_id, share_id) DO UPDATE SET base_version = excluded.base_version, changed = excluded.changed, updated_at = excluded.updated_at, dismissed_at = NULL`,
  ).bind(body.to, id, owner.id, base, JSON.stringify(changed), now, now, body.to, MAX_OFFERS, body.to, id).run()
  if (!r.meta?.changes) return fail(429, 'This link has as many offers as it can hold.', { code: 'quota' })
  return json({ id, to: body.to })
}

/** DELETE /api/shares/<origin>/offers/<share>: its owner waves the offer away. */
export async function dismissOffer(env, owner, origin, share) {
  const row = await liveShare(env, origin)
  if (!row || row.owner_id !== owner.id) return fail(404, 'No such share.', { code: 'no_share' })
  await env.DB.prepare('UPDATE offers SET dismissed_at = ? WHERE origin_id = ? AND share_id = ?').bind(Date.now(), origin, share).run()
  return json({ id: origin, share })
}

/** The owner's offers by link: id -> offers still standing, newest first. One query, however many links. */
export async function offersOf(env, owner, now = Date.now()) {
  const { results } = await env.DB.prepare(
    `SELECT f.origin_id AS origin, f.share_id AS id, f.base_version AS base, f.changed AS changed, f.updated_at AS at, s.title AS title, s.version AS version, s.message AS message,
       o.gh_login AS login, o.gh_name AS name, o.gh_avatar AS avatar
     FROM offers f JOIN shares origin ON origin.id = f.origin_id JOIN shares s ON s.id = f.share_id JOIN owners o ON o.id = f.owner_id
     WHERE origin.owner_id = ? AND f.dismissed_at IS NULL AND s.deleted_at IS NULL AND s.disabled_at IS NULL AND (s.expires_at IS NULL OR s.expires_at > ?) AND o.status != 'banned'
     ORDER BY f.updated_at DESC`,
  ).bind(owner.id, now).all()
  const by = new Map()
  for (const r of results) {
    let changed = []
    try { changed = JSON.parse(r.changed) || [] } catch { /* none */ }
    if (!by.has(r.origin)) by.set(r.origin, [])
    by.get(r.origin).push({ id: r.id, title: r.title, version: r.version, message: r.message ?? null, base: r.base ?? null, changed, at: r.at, login: r.login ?? null, name: r.name ?? null, avatar: r.avatar ?? null })
  }
  return by
}
