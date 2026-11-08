// An owner's links as a list, and the changes an owner makes to one of them: turn off or on, the
// message for viewers, remove. Shared by the owner API (a token: one owners row) and prtype.dev/me
// (a GitHub account: every owners row with its gh_id), so each takes the owner ids it may touch.
import { json, fail } from './http.mjs'
import { dropKey, queueKey } from './budget.mjs'
import { offersOf } from './offers.mjs'
import { sharedVariants } from './comments.mjs'

export const MAX_MESSAGE = 280
const DAY_MS = 86_400_000
// The owner list's faces: the latest 8 viewers of each link, from the last 30 days.
const FACES = 8
const FACES_DAYS = 30

export const getShare = (env, id) => env.DB.prepare('SELECT * FROM shares WHERE id = ?').bind(id).first()
// A version's KV key: shares.html_key names the live one; a version uploaded before that column has none.
export const keyOf = row => row.html_key || `html:${row.id}:${row.version}`

const marks = ids => ids.map(() => '?').join(', ')
/** Whether the row is one of these owners' (and so theirs to change). */
export const owns = (ids, row) => !!row && ids.includes(row.owner_id)

// The message for viewers: trimmed, at most 280 characters; '' and null are none. Undefined: not sent.
export function textOf(v, max) {
  if (v === undefined) return { absent: true }
  if (v === null) return { value: null }
  if (typeof v !== 'string' || v.length > max * 2) return null
  const t = v.trim()
  return t.length > max ? null : { value: t || null }
}

// Five queries whatever the number of shares (a Free invocation has 50 subrequests): the shares,
// their views, their comment counts, their latest faces and the offers on them. project: the label
// the share was published with, so the owner's list can say where a link from elsewhere came from.
// designs: how many designs the link shares. `owner` is the token's owner, for the offers on its
// links; without one (prtype.dev/me) there are none.
export async function sharesOf(env, ids, { owner } = {}) {
  const { results } = await env.DB.prepare(
    `SELECT id, title, version, bytes, updated_at, expires_at, message, disabled_at, project_label, scope, card_key FROM shares WHERE owner_id IN (${marks(ids)}) AND deleted_at IS NULL ORDER BY updated_at DESC, id`,
  ).bind(...ids).all()
  const views = new Map(), faces = new Map(), talk = new Map()
  let offers = new Map()
  if (results.length) {
    if (owner) offers = await offersOf(env, owner)
    const counted = await env.DB.prepare(
      `SELECT v.share_id AS id, SUM(v.n) AS n FROM views v JOIN shares s ON s.id = v.share_id WHERE s.owner_id IN (${marks(ids)}) AND s.deleted_at IS NULL GROUP BY v.share_id`,
    ).bind(...ids).all()
    for (const r of counted.results) views.set(r.id, Number(r.n) || 0)
    // What the owner's tray would count: a viewer's own deleted comment is gone; a hidden one is still theirs.
    const said = await env.DB.prepare(
      `SELECT c.share_id AS id, COUNT(*) AS total, SUM(CASE WHEN c.status = 'new' THEN 1 ELSE 0 END) AS fresh FROM comments c JOIN shares s ON s.id = c.share_id WHERE s.owner_id IN (${marks(ids)}) AND s.deleted_at IS NULL AND c.deleted = 0 GROUP BY c.share_id`,
    ).bind(...ids).all()
    for (const r of said.results) talk.set(r.id, { total: Number(r.total) || 0, new: Number(r.fresh) || 0 })
    const seen = await env.DB.prepare(
      `SELECT * FROM (SELECT p.share_id AS id, p.route AS route, p.at AS at, v.login AS login, v.name AS name, v.avatar AS avatar,
         ROW_NUMBER() OVER (PARTITION BY p.share_id ORDER BY p.at DESC, p.gh_id) AS k
       FROM presence p JOIN shares s ON s.id = p.share_id JOIN viewers v ON v.gh_id = p.gh_id
       WHERE s.owner_id IN (${marks(ids)}) AND s.deleted_at IS NULL AND p.at >= ?) WHERE k <= ? ORDER BY id, k`,
    ).bind(...ids, Date.now() - FACES_DAYS * DAY_MS, FACES).all()
    for (const r of seen.results) {
      if (!faces.has(r.id)) faces.set(r.id, [])
      faces.get(r.id).push({ login: r.login, name: r.name, avatar: r.avatar, route: r.route, at: r.at })
    }
  }
  return results.map(s => ({
    id: s.id, title: s.title, version: s.version, bytes: s.bytes, updatedAt: s.updated_at, expiresAt: s.expires_at ?? null,
    message: s.message ?? null, disabled: !!s.disabled_at, views: views.get(s.id) ?? 0, viewers: faces.get(s.id) ?? [], offers: offers.get(s.id) ?? [],
    project: s.project_label ?? null, comments: talk.get(s.id) ?? { total: 0, new: 0 },
    designs: sharedVariants(s.scope).size, card: !!s.card_key,
  }))
}

export async function deleteShare(env, ids, id) {
  const row = await getShare(env, id)
  if (!owns(ids, row)) return fail(404, 'No such share.')
  // The key is queued before the tombstone, so whatever fails after it, the cron still deletes the
  // bytes; the tombstone comes before the KV delete, so the link says removed, never a 500. Once the
  // tombstone is there, a repeat has nothing left to do.
  if (row.deleted_at) return json({ id })
  const key = keyOf(row)
  await queueKey(env, key)
  await env.DB.prepare('UPDATE shares SET deleted_at = COALESCE(deleted_at, ?) WHERE id = ?').bind(Date.now(), id).run()
  // Deleting a share deletes its comments (spec: Data and privacy); the row stays as a tombstone.
  await env.DB.prepare('DELETE FROM comments WHERE share_id = ?').bind(id).run()
  await env.DB.prepare('DELETE FROM presence WHERE share_id = ?').bind(id).run()
  if (await dropKey(env, key)) await env.DB.prepare('DELETE FROM kv_trash WHERE key = ?').bind(key).run()
  if (row.card_key) await dropKey(env, row.card_key)
  return json({ id })
}

// PATCH { disabled?, message? }. disabled turns a link off or back on; nothing else about it changes:
// the page, its comments and its expiry stay, it still counts as one of the owner's links, and an
// update of a link that is off stays off. message is the words for viewers, as a publish sets them
// (trimmed, at most 280 characters; '' or null clears them).
export async function patchShare(req, env, ids, id) {
  const row = await getShare(env, id)
  if (!owns(ids, row) || row.deleted_at) return fail(404, 'No such share.')
  const body = await req.json().catch(() => null)
  const has = k => !!body && typeof body === 'object' && Object.hasOwn(body, k)
  if (!has('disabled') && !has('message')) return fail(400, 'Send { disabled: true } or { disabled: false }, or { message }.')
  if (has('disabled') && typeof body.disabled !== 'boolean') return fail(400, 'Send { disabled: true } or { disabled: false }.')
  const message = has('message') ? textOf(body.message, MAX_MESSAGE) : { absent: true }
  if (!message) return fail(400, 'message is text of at most 280 characters, or null.', { code: 'invalid' })
  if (has('disabled')) await env.DB.prepare('UPDATE shares SET disabled_at = ? WHERE id = ? AND deleted_at IS NULL').bind(body.disabled ? row.disabled_at ?? Date.now() : null, id).run()
  if (!message.absent) await env.DB.prepare('UPDATE shares SET message = ? WHERE id = ? AND deleted_at IS NULL').bind(message.value, id).run()
  return json({
    id,
    disabled: has('disabled') ? body.disabled : !!row.disabled_at,
    ...(message.absent ? {} : { message: message.value }),
  })
}
