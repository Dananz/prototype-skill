// Viewer comments on a share's own origin, and the owner's view of them across his shares (spec:
// Viewer comments, from the viewer to Claude and back). Viewer text is stored and returned as plain
// text; nothing here renders it. Claude's replies never come here: only statuses and the owner's
// own words. Every error carries a stable `code` next to its English `error`, for the viewer to
// put in its own words and language.
import { isId } from './ids.mjs'
import { json, fail, bodyOf } from './http.mjs'
import { signinReady, signOutCookie, viewerOf } from './github.mjs'
import { room } from './budget.mjs'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const VARIANT = /^[a-z0-9][a-z0-9_-]{0,63}\/[A-Z]{1,3}$/
const MAX_BODY = 4000
const PER_HOUR = 30 // per viewer
const PER_DAY = 300 // per share
const COMMENT_ROWS = 10
// Forward only: new → sent → working → done. `dismissed` stays on the owner's Mac.
const ORDER = ['new', 'sent', 'working', 'done']

const VIEW = `SELECT c.*, v.login AS login, v.name AS vname, v.avatar AS avatar FROM comments c LEFT JOIN viewers v ON v.gh_id = c.gh_id`
const OWNED = `SELECT c.*, s.title AS share_title, s.version AS share_version, v.login AS login, v.name AS vname, v.avatar AS avatar
  FROM comments c JOIN shares s ON s.id = c.share_id LEFT JOIN viewers v ON v.gh_id = c.gh_id
  WHERE s.owner_id = ? AND s.deleted_at IS NULL AND c.gh_id IS NOT NULL`

const parse = s => { try { return s ? JSON.parse(s) : null } catch { return null } }

const viewerShape = (c, me) => ({
  id: c.id, variant: c.variant, body: c.body, target: parse(c.target), status: c.status,
  owner_reply: c.owner_reply, owner_reply_at: c.owner_reply_at, re: c.re || null,
  author: { login: c.login, name: c.vname, avatar: c.avatar },
  mine: !!me && me.gh_id === c.gh_id,
  created_at: c.created_at, updated_at: c.updated_at,
  version: c.version, done_in: c.done_in,
})

const ownerShape = c => ({
  id: c.id, share: { id: c.share_id, title: c.share_title, version: c.share_version },
  variant: c.variant, version: c.version, body: c.body, target: parse(c.target), status: c.status,
  owner_reply: c.owner_reply, owner_reply_at: c.owner_reply_at, re: c.re || null, hidden: !!c.hidden, deleted: !!c.deleted, withdrawn: !!c.withdrawn, done_in: c.done_in,
  author: { gh_id: c.gh_id, login: c.login, name: c.vname, avatar: c.avatar },
  created_at: c.created_at, updated_at: c.updated_at,
})

// The share's variants as `slug/LETTER`. The scope is parseScope's { protos: [{ id, variants }] };
// the older list form [{ proto, variants }] is read too.
function sharedVariants(scope) {
  const out = new Set()
  const s = parse(scope)
  const protos = Array.isArray(s) ? s.map(p => ({ id: p?.proto, variants: p?.variants })) : s?.protos
  for (const p of Array.isArray(protos) ? protos : []) for (const v of Array.isArray(p?.variants) ? p.variants : []) out.add(`${p.id}/${v}`)
  return out
}

const num = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi
const str = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max

// A pin: the point (%) within the element the viewer clicked, the stamps that find it again, and the
// view it was made in. Only these keys are kept. null is a comment on the whole design.
function readTarget(t) {
  if (t === null || t === undefined) return { value: null }
  if (typeof t !== 'object' || Array.isArray(t) || !num(t.x, 0, 100) || !num(t.y, 0, 100)) return null
  const v = t.view
  if (!v || typeof v !== 'object' || typeof v.size !== 'string' || !/^[a-z-]{1,20}$/.test(v.size) || !num(v.w, 1, 20000) || !num(v.h, 1, 20000)) return null
  const out = {}
  for (const [key, max] of [['src', 300], ['component', 100], ['path', 1000]]) {
    if (t[key] === undefined || t[key] === null) continue
    if (!str(t[key], max)) return null
    out[key] = t[key]
  }
  return { value: { ...out, x: t.x, y: t.y, view: { size: v.size, w: v.w, h: v.h } } }
}

// D1 counters: one row per viewer per hour and per share per day. The conditional upsert counts and
// checks in one statement, so two requests at once can't both slip under the cap.
async function take(env, what, slot, cap) {
  const r = await env.DB.prepare('INSERT INTO caps (what, slot, n) VALUES (?, ?, 1) ON CONFLICT(what, slot) DO UPDATE SET n = caps.n + 1 WHERE caps.n < ?').bind(what, slot, cap).run()
  return (r.meta?.changes ?? 0) > 0
}
const giveBack = (env, what, slot) => env.DB.prepare('UPDATE caps SET n = n - 1 WHERE what = ? AND slot = ? AND n > 0').bind(what, slot).run()

/** Drops the counters of past hours and days; posts call it now and then (1 in 50). */
export function pruneCaps(env, now = Date.now()) {
  return env.DB.prepare("DELETE FROM caps WHERE (what LIKE 'gh:%' AND slot < ?) OR (what LIKE 'share:%' AND slot < ?)").bind(Math.floor(now / 3_600_000), Math.floor(now / 86_400_000)).run()
}

/** Every route under <share origin>/api/. `share` has the owner's name joined in (owner_name). */
export async function viewerApi(req, env, url, share, path, pathForm) {
  if (req.headers.get('x-proto') !== '1') return fail(400, 'X-Proto: 1 is required.', { code: 'x_proto' })
  if (!share) return fail(404, 'No such share.', { code: 'no_share' })
  if (share.deleted_at) return fail(410, 'This share was removed.', { code: 'removed' })
  if (share.expires_at && share.expires_at <= Date.now()) return fail(410, 'This link has expired.', { code: 'expired' })
  const m = req.method
  const only = () => fail(405, 'Method not allowed.', { code: 'method' })
  if (path === '/api/state') return m === 'GET' ? json(stateOf(share)) : only()
  if (path === '/api/here') return m === 'POST' ? here(req, env, share) : only()
  if (path === '/api/config') return m === 'GET' ? json({ comments: signinReady(env) && share.comments === 1, owner: share.owner_name }) : only()
  if (path === '/api/me') {
    if (m !== 'GET') return only()
    const me = await viewerOf(req, env, share.id)
    return json(me ? { login: me.login, name: me.name, avatar: me.avatar } : null)
  }
  if (path === '/api/signout') return m === 'POST' ? json({ ok: true }, 200, { 'set-cookie': signOutCookie(url, share.id, pathForm) }) : only()
  if (path === '/api/comments') {
    if (m === 'GET') return listComments(req, env, url, share)
    if (m === 'POST') return createComment(req, env, share)
    return only()
  }
  const one = /^\/api\/comments\/([^/]+)$/.exec(path)
  if (one) return m === 'DELETE' ? deleteComment(req, env, share, one[1]) : only()
  return fail(404, 'No such route.', { code: 'no_route' })
}

// The link as the viewer opens it: its version, the owner's message and the update's note, and who
// shared it (null until the owner signed in with GitHub).
const stateOf = s => ({
  version: s.version, updatedAt: s.updated_at, title: s.title, message: s.message ?? null, note: s.note ?? null,
  owner: s.owner_login ? { login: s.owner_login, name: s.owner_gh_name ?? null, avatar: s.owner_avatar ?? null } : null,
})

const HERE_MS = 50_000 // one write per viewer per link at most this often; the page pings once a minute
const ROUTE = /^[^\u0000-\u001f\u007f]{0,200}$/

// POST /api/here { route }: a signed-in viewer is on the link now (the owner's "who is in it now").
// The row is read first and written only when its last ping is older than 50 s, and not at all
// once today's D1 writes are used up (204 either way: the page has nothing to show for it).
async function here(req, env, share) {
  const me = await viewerOf(req, env, share.id)
  if (!me) return fail(401, 'Sign in with GitHub first.', { code: 'signin' })
  const b = await bodyOf(req)
  if (b instanceof Response) return b
  if (!(b.route === undefined || b.route === null || (typeof b.route === 'string' && ROUTE.test(b.route)))) return fail(400, 'route must be text of at most 200 characters.', { code: 'invalid' })
  const now = Date.now()
  const last = await env.DB.prepare('SELECT at FROM presence WHERE share_id = ? AND gh_id = ?').bind(share.id, me.gh_id).first()
  if (last && last.at > now - HERE_MS) return new Response(null, { status: 204 })
  if (!await room(env.DB, 'd1_write')) return new Response(null, { status: 204 })
  await env.DB.prepare('INSERT INTO presence (share_id, gh_id, route, at) VALUES (?, ?, ?, ?) ON CONFLICT(share_id, gh_id) DO UPDATE SET route = excluded.route, at = excluded.at')
    .bind(share.id, me.gh_id, b.route || null, now).run()
  return new Response(null, { status: 204 })
}

// ?since=<ms> returns what changed since then (by updated_at, so status flips and replies come
// too), plus the ids that left the link. `now` is the host's clock, to pass back as the next since;
// >= repeats a comment at the boundary at worst, which the page merges by id.
async function listComments(req, env, url, share) {
  const me = await viewerOf(req, env, share.id)
  const s = Number(url.searchParams.get('since'))
  const since = Number.isFinite(s) && s > 0 ? s : 0
  const now = Date.now()
  const { results } = await env.DB.prepare(`${VIEW} WHERE c.share_id = ? AND c.gh_id IS NOT NULL AND c.updated_at >= ? ORDER BY c.created_at, c.rowid`).bind(share.id, since).all()
  // Decision 12: everyone on the link sees every comment, unless the owner made them private.
  const theirs = c => share.others_visible === 1 || (!!me && me.gh_id === c.gh_id)
  const gone = c => c.hidden || c.deleted || c.withdrawn
  return json({
    comments: results.filter(c => theirs(c) && !gone(c)).map(c => viewerShape(c, me)),
    removed: since ? results.filter(c => theirs(c) && gone(c)).map(c => c.id) : [],
    now,
  })
}

async function createComment(req, env, share) {
  const me = await viewerOf(req, env, share.id)
  if (!me) return fail(401, 'Sign in with GitHub to comment.', { code: 'signin' })
  if (!(signinReady(env) && share.comments === 1)) return fail(403, 'Comments are off for this link.', { code: 'comments_off' })
  const b = await bodyOf(req)
  if (b instanceof Response) return b
  const id = typeof b.id === 'string' ? b.id.toLowerCase() : ''
  if (!UUID.test(id)) return fail(400, 'id must be a UUID.', { code: 'invalid' })
  // A retry of a comment already stored answers it again, uncounted.
  const known = async () => {
    const old = await env.DB.prepare(`${VIEW} WHERE c.share_id = ? AND c.id = ?`).bind(share.id, id).first()
    if (!old) return null
    return old.gh_id === me.gh_id ? json(viewerShape(old, me)) : fail(409, 'That comment id is taken.', { code: 'taken' })
  }
  const again = await known()
  if (again) return again
  if (typeof b.body !== 'string' || !b.body.trim()) return fail(400, 'Write something first.', { code: 'empty' })
  if (b.body.length > MAX_BODY) return fail(429, 'A comment is at most 4,000 characters.', { code: 'too_long' })
  // A reply to a comment on the link (the owner answered it, and the viewer answers back): it joins
  // that comment's thread, on its design and its spot. Threads are flat: a reply to a reply is one more
  // reply to the first comment.
  let re = null
  if (b.re !== undefined && b.re !== null) {
    const rid = typeof b.re === 'string' ? b.re.toLowerCase() : ''
    const parent = UUID.test(rid) ? await env.DB.prepare('SELECT id, re, variant, target, deleted, withdrawn, hidden FROM comments WHERE share_id = ? AND id = ?').bind(share.id, rid).first() : null
    if (!parent || parent.deleted || parent.withdrawn || parent.hidden) return fail(404, 'The comment you are replying to is gone.', { code: 'no_comment' })
    re = parent.re || parent.id
    b.variant = parent.variant
    b.target = parse(parent.target)
  }
  if (typeof b.variant !== 'string' || !VARIANT.test(b.variant) || !sharedVariants(share.scope).has(b.variant)) return fail(400, 'variant must be one of the shared designs, as slug/LETTER.', { code: 'invalid' })
  const target = readTarget(b.target)
  if (!target) return fail(400, 'target is not a pin this host can keep.', { code: 'invalid' })

  // The host's own D1 write budget (90% of Free): the viewer's page shows its "Couldn't send". A
  // comment writes about 10 rows: its row and two indexes, two counters with their keys, the day's
  // d1_write counter.
  if (!await room(env.DB, 'd1_write', COMMENT_ROWS)) return fail(429, "The host's daily budget for comments is used up. Try again tomorrow.", { code: 'budget' })
  const now = Date.now()
  const day = Math.floor(now / 86_400_000), hour = Math.floor(now / 3_600_000)
  const atHourCap = () => fail(429, "You've written 30 comments this hour. Try again in a while.", { code: 'hour' })
  // A read first, so a viewer hammering at the cap costs no writes.
  const used = await env.DB.prepare('SELECT n FROM caps WHERE what = ? AND slot = ?').bind(`gh:${me.gh_id}`, hour).first()
  if ((used?.n ?? 0) >= PER_HOUR) return atHourCap()
  if (!await take(env, `share:${share.id}`, day, PER_DAY)) return fail(429, 'This link has had 300 comments today. Try again tomorrow.', { code: 'day' })
  if (!await take(env, `gh:${me.gh_id}`, hour, PER_HOUR)) {
    await giveBack(env, `share:${share.id}`, day)
    return atHourCap()
  }
  if (Math.random() < 1 / 50) await pruneCaps(env, now)
  // The phase-0 columns are NOT NULL: the open link is '', every commenter is verified by GitHub,
  // and route is the variant.
  const ins = await env.DB.prepare(
    `INSERT INTO comments (id, share_id, link_id, viewer, verified, version, route, body, gh_id, variant, target, re, status, hidden, deleted, created_at, updated_at)
     VALUES (?, ?, '', ?, 1, ?, ?, ?, ?, ?, ?, ?, 'new', 0, 0, ?, ?) ON CONFLICT(share_id, id) DO NOTHING`,
  ).bind(id, share.id, `gh:${me.gh_id}`, share.version, b.variant, b.body, me.gh_id, b.variant, target.value && JSON.stringify(target.value), re, now, now).run()
  if (!ins.meta?.changes) {
    // The same id arrived twice at once: the other request stored it.
    await giveBack(env, `share:${share.id}`, day)
    await giveBack(env, `gh:${me.gh_id}`, hour)
    return (await known()) || fail(409, 'That comment id is taken.', { code: 'taken' })
  }
  const row = await env.DB.prepare(`${VIEW} WHERE c.share_id = ? AND c.id = ?`).bind(share.id, id).first()
  return json(viewerShape(row, me), 201)
}

// Deleting is for second thoughts: only while the comment is new. Once the owner has sent it to
// Claude it can only leave the link (withdrawn, the viewer's own flag, which the owner's hide and
// unhide leave alone), so the owner's batch still makes sense.
async function deleteComment(req, env, share, raw) {
  const me = await viewerOf(req, env, share.id)
  if (!me) return fail(401, 'Sign in with GitHub first.', { code: 'signin' })
  const id = raw.toLowerCase()
  const c = UUID.test(id) ? await env.DB.prepare('SELECT gh_id, deleted FROM comments WHERE share_id = ? AND id = ?').bind(share.id, id).first() : null
  if (!c || c.deleted) return fail(404, 'No such comment.', { code: 'no_comment' })
  if (c.gh_id !== me.gh_id) return fail(403, 'Only its author can delete a comment.', { code: 'not_yours' })
  const now = Date.now()
  const r = await env.DB.prepare("UPDATE comments SET deleted = 1, body = '', target = NULL, updated_at = ? WHERE share_id = ? AND id = ? AND status = 'new' AND deleted = 0").bind(now, share.id, id).run()
  if (r.meta?.changes) return json({ id, deleted: true })
  await env.DB.prepare('UPDATE comments SET withdrawn = 1, updated_at = ? WHERE share_id = ? AND id = ?').bind(now, share.id, id).run()
  return json({ id, withdrawn: true })
}

/** /api/owner/comments[/<id>] with the owner's bearer token already checked. */
export async function ownerComments(req, env, owner, url, id) {
  if (id === undefined) {
    if (req.method !== 'GET') return fail(405, 'Method not allowed.', { code: 'method' })
    const s = Number(url.searchParams.get('since'))
    const since = Number.isFinite(s) && s > 0 ? s : 0
    const now = Date.now()
    const { results } = await env.DB.prepare(`${OWNED} AND c.updated_at >= ? ORDER BY c.updated_at, c.rowid`).bind(owner.id, since).all()
    return json({ comments: results.map(ownerShape), now })
  }
  if (req.method !== 'PATCH') return fail(405, 'Method not allowed.', { code: 'method' })
  return patchComment(req, env, owner, id.toLowerCase())
}

async function patchComment(req, env, owner, id) {
  const b = await bodyOf(req)
  if (b instanceof Response) return b
  const has = k => Object.hasOwn(b, k)
  const invalid = why => fail(400, why, { code: 'invalid' })
  if (!has('status') && !has('reply') && !has('hidden')) return invalid('Send status, reply or hidden.')
  if (has('status') && !ORDER.includes(b.status)) return invalid(`status is one of ${ORDER.join(', ')}.`)
  if (has('reply') && !(b.reply === null || (typeof b.reply === 'string' && b.reply.length <= MAX_BODY))) return invalid('reply is text of at most 4,000 characters, or null.')
  if (has('hidden') && typeof b.hidden !== 'boolean') return invalid('hidden is true or false.')
  if (has('share') && !isId(b.share)) return invalid('share is a share id.')
  if (!UUID.test(id)) return fail(404, 'No such comment.', { code: 'no_comment' })
  // Comment ids are the viewers' UUIDs, unique per share; `share` settles the (unlikely) clash.
  const found = (await env.DB.prepare(`${OWNED} AND c.id = ?${has('share') ? ' AND c.share_id = ?' : ''} LIMIT 2`).bind(owner.id, id, ...(has('share') ? [b.share] : [])).all()).results
  if (!found.length) return fail(404, 'No such comment.', { code: 'no_comment' })
  if (found.length > 1) return fail(409, 'Two of your shares have a comment with this id. Pass share.', { code: 'ambiguous' })
  const c = found[0]
  const deleted = () => fail(410, 'The viewer deleted this comment.', { code: 'deleted' })
  if (c.deleted) return deleted()
  const key = [c.share_id, id]
  const now = Date.now()

  if (has('status')) {
    // Sent only from new, so two sessions (or two tabs) can't both send it to Claude.
    if (b.status === 'sent') {
      // deleted = 0: the viewer may delete it between the read above and this write.
      const r = await env.DB.prepare("UPDATE comments SET status = 'sent', updated_at = ? WHERE share_id = ? AND id = ? AND status = 'new' AND deleted = 0").bind(now, ...key).run()
      if (!r.meta?.changes) {
        const cur = await env.DB.prepare('SELECT status, deleted FROM comments WHERE share_id = ? AND id = ?').bind(...key).first()
        if (cur?.deleted) return deleted()
        return fail(409, 'Already sent from another session.', { code: 'already_sent', status: cur?.status })
      }
    } else {
      const from = ORDER.indexOf(c.status), to = ORDER.indexOf(b.status)
      if (to < from) return fail(409, 'A status only moves forward.', { code: 'backward', status: c.status })
      // Setting the status it has is harmless (an outbox may send an update twice).
      if (to > from) {
        const r = await env.DB.prepare('UPDATE comments SET status = ?, updated_at = ? WHERE share_id = ? AND id = ? AND status = ? AND deleted = 0').bind(b.status, now, ...key, c.status).run()
        if (!r.meta?.changes) return fail(409, 'It changed meanwhile. Try again.', { code: 'changed' })
      }
    }
  }
  if (has('reply')) {
    const text = typeof b.reply === 'string' && b.reply.trim() ? b.reply : null
    await env.DB.prepare('UPDATE comments SET owner_reply = ?, owner_reply_at = ?, updated_at = ? WHERE share_id = ? AND id = ?').bind(text, text ? now : null, now, ...key).run()
  }
  if (has('hidden')) await env.DB.prepare('UPDATE comments SET hidden = ?, updated_at = ? WHERE share_id = ? AND id = ?').bind(b.hidden ? 1 : 0, now, ...key).run()
  const row = await env.DB.prepare(`${OWNED} AND c.share_id = ? AND c.id = ?`).bind(owner.id, ...key).first()
  return json(ownerShape(row))
}
