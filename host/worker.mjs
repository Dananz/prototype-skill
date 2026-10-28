import { newId, isId } from './lib/ids.mjs'
import { ownerOf } from './lib/auth.mjs'
import { namesOf, route } from './lib/routes.mjs'
import { page, ogPage, ROBOTS } from './lib/pages.mjs'
import { json, fail } from './lib/http.mjs'
import { upgraded } from './lib/upgrade.mjs'
import { approveSignin, authCallback, authStart, claimUrl, signinReady, startIn, ticketIn } from './lib/github.mjs'
import { ownerComments, viewerApi } from './lib/comments.mjs'
import { claim, dropKey, metered, putClaimed, queueKey, reserveStore, room, today, usage } from './lib/budget.mjs'
import { cron } from './lib/cron.mjs'
import { admin, banned, createRefused, liveCap, pending, quotaOf, reserveUpload, signinBegin, signinPoll, signout } from './lib/users.mjs'

const MAX_BYTES = 20 * 1024 * 1024
// A preview card is a 1200×630 JPEG of about 50 KB; chat apps skip images much past 300 KB.
const MAX_CARD = 300 * 1024
const MAX_MESSAGE = 280
const MAX_NOTE = 300
const DAY_MS = 86_400_000
const SHARE_LIFETIME_MS = 30 * DAY_MS
// The owner list's faces: the latest 8 viewers of each link, from the last 30 days.
const FACES = 8
const FACES_DAYS = 30

// A version's KV key. Each upload writes its own (a random part makes two uploads of one version two
// keys), and shares.html_key names the live one; a version uploaded before that column has none.
const newKey = (id, version) => `html:${id}:${version}:${newId()}`
const keyOf = row => row.html_key || `html:${row.id}:${row.version}`
// A version just published may not be readable in KV yet at this location: one short wait, then again.
const KV_RETRY_MS = 300

// A share seen on the host's own name (not on <id>.<base>) is path mode.
const onBase = (url, env) => namesOf(env.BASE).names.some(n => n.toLowerCase() === url.host.toLowerCase())
// Path mode is served when the host is set to it, and always by the host on this Mac, which must
// serve 127.0.0.1:<port>/s/<id>/ whether or not *.localhost resolves.
const pathsServed = env => env.PATH_MODE === '1' || namesOf(env.BASE).local
// A host off this Mac in path mode (prtype.dev, workers.dev) serves the path form only: there are no
// per-share names, and a stray <id>.<base> must not become a second way in.
const pathsOnly = env => env.PATH_MODE === '1' && !namesOf(env.BASE).local

// The owner API version this host speaks, and the oldest client it takes (/_health's headers).
const API = 2
const API_MIN = 2

const getShare = (env, id) => env.DB.prepare('SELECT * FROM shares WHERE id = ?').bind(id).first()

// Every answer is nosniff and noindex, redirects and errors included.
function hardened(res) {
  try {
    if (!res.headers.has('x-content-type-options')) res.headers.set('x-content-type-options', 'nosniff')
    if (!res.headers.has('x-robots-tag')) res.headers.set('x-robots-tag', 'noindex')
    return res
  } catch {
    // Immutable headers (a fetched response): copy them once.
    const copy = new Response(res.body, res)
    copy.headers.set('x-content-type-options', 'nosniff')
    copy.headers.set('x-robots-tag', 'noindex')
    return copy
  }
}

// The API faces answer a crash in JSON, as they answer everything else; the pages in HTML.
function crashed(req, env) {
  try {
    const r = route(new URL(req.url), namesOf(env.BASE).names)
    if (r.at === 'api' || (r.at === 'share' && (r.path === '/api' || r.path.startsWith('/api/')))) return fail(500, 'Something went wrong. Try again in a moment.', { code: 'error' })
  } catch {}
  return page('error', {})
}

export default {
  async fetch(req, env) {
    const m = metered(env)
    let res
    try {
      res = await serve(req, m.env)
    } catch (e) {
      console.error(e)
      res = crashed(req, env)
    }
    try { await m.flush() } catch (e) { console.error(e) }
    return hardened(res)
  },
  async scheduled(event, env) {
    const m = metered(env)
    try {
      await cron(m.env, event?.scheduledTime || Date.now())
    } finally {
      await m.flush()
    }
  },
}

async function serve(req, env) {
  const url = new URL(req.url)
  if (url.pathname === '/robots.txt') return new Response(ROBOTS, { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=3600' } })
  const gone = moved(url, env)
  if (gone) return gone
  const r = route(url, namesOf(env.BASE).names)
  if (r.at === 'health') {
    const headers = { 'content-type': 'text/plain', 'cache-control': 'no-store' }
    // Which code runs here, for the CLI to tell a host older than the skill.
    if (env.HOST_VERSION) headers['x-proto-host'] = env.HOST_VERSION
    headers['x-proto-api'] = String(API)
    headers['x-proto-api-min'] = String(API_MIN)
    return new Response('ok', { headers })
  }
  await upgraded(env)
  if (r.at === 'api') return await api(req, env, url, r.path)
  if (r.at === 'auth') {
    // The sign-in's confirm page posts its Approve or Cancel; the rest of the flow is GETs.
    const method = r.path === '/auth/github/approve' ? 'POST' : 'GET'
    if (req.method !== method) return new Response(null, { status: 405, headers: { allow: method } })
    if (method === 'POST') return await approveSignin(req, env, url)
    return r.path === '/auth/github' ? await authStart(env, url) : await authCallback(req, env, url)
  }
  if (r.at === 'apex') return await apex(env, url, r.shareId)
  // One origin per share (decision 23): a path-mode link from before moves to the share's own name.
  // Its viewer cookie was scoped to the path, so the viewer signs in there once more.
  if (r.at === 'share' && onBase(url, env) && !pathsServed(env)) return new Response(null, { status: 301, headers: { location: `${url.protocol}//${r.shareId}.${env.BASE}${r.path || '/'}${url.search}`, 'cache-control': 'no-store' } })
  if (r.at === 'share' && (onBase(url, env) ? pathsServed(env) : !pathsOnly(env))) return await share(req, env, url, r)
  return page('notfound', {})
}

// The names the Worker used to answer on (LEGACY, comma-separated: the workers.dev name once the
// domain is live). Links sent from there keep working: a share or a short link moves to the same
// path on BASE (308, which keeps the method). The API and sign-in don't move: an old CLI or a
// half-done sign-in gets a clear 410.
function moved(url, env) {
  const host = url.host.toLowerCase()
  if (!(env.LEGACY || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean).includes(host)) return null
  const r = route(url, host)
  if (r.at === 'health') return null
  if (r.at === 'api' || r.at === 'auth') return fail(410, `This host moved to https://${env.BASE}.`, { code: 'moved' })
  // A Location can't carry the #/route; the browser keeps it across the redirect.
  if (r.at === 'share' || r.at === 'apex') return new Response(null, { status: 308, headers: { location: `https://${env.BASE}${url.pathname}${url.search}`, 'cache-control': 'no-store' } })
  return page('notfound', {})
}

async function api(req, env, url, path) {
  const parts = path.split('/').filter(Boolean) // ['api', 'shares', id?] or ['api', 'owner', 'comments', id?]
  // Signing in from a Mac that has no token yet: the poll secret stands in for one.
  if (parts[1] === 'signin' && parts.length === 3 && ['start', 'poll'].includes(parts[2])) {
    if (req.method !== 'POST') return fail(405, 'Method not allowed.')
    return parts[2] === 'start' ? signinBegin(req, env, url) : signinPoll(req, env)
  }
  const owner = await ownerOf(req, env)
  if (!owner) return fail(401, 'A valid owner token is needed.', { code: 'token' })
  if (parts[1] === 'owner' && parts.length === 2) return req.method === 'GET' ? json({ ...ownerShape(owner), signin: signinReady(env), status: owner.status, role: owner.role, quota: await quotaOf(env, owner) }) : fail(405, 'Method not allowed.')
  if (parts[1] === 'owner' && parts[2] === 'signout' && parts.length === 3) return req.method === 'POST' ? signout(env, owner) : fail(405, 'Method not allowed.')
  const blocked = banned(owner)
  if (blocked) return blocked
  if (parts[1] === 'admin') return admin(req, env, owner, url, parts)
  if (parts[1] === 'owner' && parts[2] === 'comments' && parts.length <= 4) return ownerComments(req, env, owner, url, parts[3])
  if (parts[1] === 'owner' && parts[2] === 'usage' && parts.length === 3) return req.method === 'GET' ? json(await usage(env.DB)) : fail(405, 'Method not allowed.')
  if (parts[1] === 'owner' && parts[2] === 'claim' && parts.length === 3) {
    if (req.method !== 'POST') return fail(405, 'Method not allowed.')
    if (!signinReady(env)) return fail(409, 'GitHub sign-in is not set up on this host.', { code: 'signin_off' })
    return json({ url: await claimUrl(env, url, owner.id) })
  }
  if (parts[1] === 'shares' && parts[3] === 'card' && parts.length === 4) {
    if (req.method !== 'PUT') return fail(405, 'Method not allowed.')
    if (!isId(parts[2])) return fail(404, 'No such share.')
    return putCard(req, env, owner, parts[2])
  }
  if (parts[1] !== 'shares' || parts.length > 3) return fail(404, 'No such route.')
  const id = parts[2]
  if (id === undefined && req.method === 'POST') {
    const refused = pending(owner) || (needsSignIn(env, owner) && signInFirst()) || await createRefused(env, owner)
    if (refused) return refused
  }
  if (id === undefined) {
    if (req.method === 'POST') return createShare(env)
    if (req.method === 'GET') return listShares(env, owner)
    return fail(405, 'Method not allowed.')
  }
  if (!isId(id)) return fail(404, 'No such share.')
  if (req.method === 'PUT') return putShare(req, env, owner, id)
  if (req.method === 'DELETE') return deleteShare(env, owner, id)
  return fail(405, 'Method not allowed.')
}

// Who uploads: any active user (users.mjs), each share on its own origin so one user's page can't
// act on another's link (decision 23). A pending user waits for approval before a new share; a
// banned one does nothing but read who they are and sign out (api above). Updates, cards and removes
// of a user's own shares are never held back by pending.

// The owner as the Share popover shows them: their GitHub login, name and avatar, each null before
// they sign in. GET /api/owner adds `signin`: whether this host can run the sign-in at all.
const ownerShape = o => ({ login: o.gh_login ?? null, name: o.gh_name ?? null, avatar: o.gh_avatar ?? null })

// A new share goes out under the owner's GitHub name: once the host can run sign-in, it takes none
// until the owner has signed in. Updates and removes of existing shares never ask, so live links keep
// working. A host without sign-in (a local one before setup --github, workers.dev) can't run the
// flow, so it doesn't ask either. Only an owner from before users (setup's, with no gh_id) is ever
// asked: a user who signed in with GitHub has it from birth.
const needsSignIn = (env, owner) => signinReady(env) && !owner.gh_id
const signInFirst = () => fail(403, 'Sign in with GitHub before sharing a new link.', { code: 'sign_in' })

async function createShare(env) {
  for (let i = 0; i < 8; i++) {
    const id = newId()
    try {
      await env.DB.prepare("INSERT INTO ids (id, kind) VALUES (?, 'share')").bind(id).run()
      return json({ id })
    } catch (e) {
      if (!/UNIQUE|constraint/i.test(String(e?.message || e))) throw e
    }
  }
  return fail(503, 'Could not make an id. Try again.')
}

// Three queries whatever the number of shares (a Free invocation has 50 subrequests): the shares,
// their views, and their latest faces.
async function listShares(env, owner) {
  const { results } = await env.DB.prepare(
    'SELECT id, title, version, bytes, updated_at, expires_at, message FROM shares WHERE owner_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC, id',
  ).bind(owner.id).all()
  const views = new Map(), faces = new Map()
  if (results.length) {
    const counted = await env.DB.prepare(
      'SELECT v.share_id AS id, SUM(v.n) AS n FROM views v JOIN shares s ON s.id = v.share_id WHERE s.owner_id = ? AND s.deleted_at IS NULL GROUP BY v.share_id',
    ).bind(owner.id).all()
    for (const r of counted.results) views.set(r.id, Number(r.n) || 0)
    const seen = await env.DB.prepare(
      `SELECT * FROM (SELECT p.share_id AS id, p.route AS route, p.at AS at, v.login AS login, v.name AS name, v.avatar AS avatar,
         ROW_NUMBER() OVER (PARTITION BY p.share_id ORDER BY p.at DESC, p.gh_id) AS k
       FROM presence p JOIN shares s ON s.id = p.share_id JOIN viewers v ON v.gh_id = p.gh_id
       WHERE s.owner_id = ? AND s.deleted_at IS NULL AND p.at >= ?) WHERE k <= ? ORDER BY id, k`,
    ).bind(owner.id, Date.now() - FACES_DAYS * DAY_MS, FACES).all()
    for (const r of seen.results) {
      if (!faces.has(r.id)) faces.set(r.id, [])
      faces.get(r.id).push({ login: r.login, name: r.name, avatar: r.avatar, route: r.route, at: r.at })
    }
  }
  return json(results.map(s => ({
    id: s.id, title: s.title, version: s.version, bytes: s.bytes, updatedAt: s.updated_at, expiresAt: s.expires_at ?? null,
    message: s.message ?? null, views: views.get(s.id) ?? 0, viewers: faces.get(s.id) ?? [],
  })))
}

// The message for viewers: trimmed, at most 280 characters; '' and null are none. Undefined: not sent.
function textOf(v, max) {
  if (v === undefined) return { absent: true }
  if (v === null) return { value: null }
  if (typeof v !== 'string' || v.length > max * 2) return null
  const t = v.trim()
  return t.length > max ? null : { value: t || null }
}

function readMeta(header) {
  try {
    const m = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob((header || '').replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))))
    const text = v => typeof v === 'string' && v.length <= 300
    if (!text(m.title) || !text(m.session) || !text(m.projectLabel) || !['en', 'he'].includes(m.lang)) return null
    if (!m.scope || typeof m.scope !== 'object') return null
    // message: set (a string), cleared (null) or kept (absent); note: an update's "What's new".
    const message = textOf(m.message, MAX_MESSAGE), note = textOf(m.note, MAX_NOTE)
    if (!message || !note) return null
    return { ...m, message, note }
  } catch { return null }
}

async function putShare(req, env, owner, id) {
  const reserved = await env.DB.prepare("SELECT 1 AS ok FROM ids WHERE id = ? AND kind = 'share'").bind(id).first()
  const first = await getShare(env, id)
  if (!reserved || (first && (first.owner_id !== owner.id || first.deleted_at))) return fail(404, 'No such share.')
  if (Number(req.headers.get('content-length')) > MAX_BYTES) return fail(413, 'A share is at most 20 MiB gzipped.', { code: 'too_big' })
  const meta = readMeta(req.headers.get('x-share-meta'))
  if (!meta) return fail(400, 'x-share-meta must be base64url JSON with title, session, projectLabel, scope and lang (message at most 280 characters, note at most 300).')
  if (!first) {
    const refused = pending(owner) || (needsSignIn(env, owner) && signInFirst())
    if (refused) return refused
  }
  const body = await req.arrayBuffer()
  if (body.byteLength > MAX_BYTES) return fail(413, 'A share is at most 20 MiB gzipped.', { code: 'too_big' })
  const magic = new Uint8Array(body, 0, Math.min(2, body.byteLength))
  if (magic[0] !== 0x1f || magic[1] !== 0x8b) return fail(400, 'The body must be gzip.')

  // A version is never overwritten (KV can serve an overwritten key stale): write this upload's own
  // key, flip the pointer in D1 only if the version is still the one read here, then drop the old
  // key. The share is read again after the body, which may have taken a while to arrive. A loser of
  // two uploads at once finds the version moved, drops its own key (never the live one) and says so.
  const old = await getShare(env, id)
  if (old && (old.owner_id !== owner.id || old.deleted_at)) return fail(404, 'No such share.')
  const version = old ? old.version + 1 : 1
  // Taken before the put, each in the statement that checks it: the user's upload and bytes, then the
  // host's write and bytes. Whatever fails after gives back what it took (the write excepted: spent).
  const quota = await reserveUpload(env, owner, { id, fresh: !old, bytes: body.byteLength })
  if (quota.refused) return quota.refused
  const store = await reserveStore(env, id, body.byteLength, owner.id)
  if (store.refused) { await quota.failed(); return store.refused }
  const failed = async () => { await store.release(); await quota.failed() }
  const now = Date.now()
  const key = newKey(id, version)
  try { await putClaimed(env, key, body) } catch (e) { await failed(); throw e }
  // An update keeps the message unless it says otherwise; its note is this version's alone.
  const message = meta.message.absent ? (old?.message ?? null) : meta.message.value
  const note = old ? (meta.note.value ?? null) : null
  // Each publication renews the link. Existing links gain an expiry only when updated.
  const expiresAt = now + SHARE_LIFETIME_MS
  const row = [meta.session, meta.projectLabel, meta.title, JSON.stringify(meta.scope), version, body.byteLength, meta.lang, now, key, message, note, expiresAt]
  const flipped = old
    ? await env.DB.prepare(
      `UPDATE shares SET session = ?, project_label = ?, title = ?, scope = ?, version = ?, bytes = ?, lang = ?, updated_at = ?, html_key = ?, message = ?, note = ?, expires_at = ?, purged_at = NULL
       WHERE id = ? AND version = ? AND deleted_at IS NULL`,
    ).bind(...row, id, old.version).run()
    // A new share is inserted only while the user has fewer live links than their cap: new shares at
    // once can't all pass the count read before the put.
    : await env.DB.prepare(
      `INSERT INTO shares (session, project_label, title, scope, version, bytes, lang, updated_at, html_key, message, note, expires_at, id, owner_id, created_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
       WHERE (SELECT COUNT(*) FROM shares WHERE owner_id = ? AND deleted_at IS NULL AND (expires_at IS NULL OR expires_at > ?)) < ? ON CONFLICT(id) DO NOTHING`,
    ).bind(...row, id, owner.id, now, owner.id, now, liveCap(owner)).run()
  if (!flipped.meta?.changes) {
    await dropKey(env, key)
    await failed()
    if (!old && !await getShare(env, id)) return fail(507, 'You have 25 live links, the most one person can. proto share rm <id> frees one.', { code: 'quota' })
    return fail(409, 'Another update of this share landed first. Try again.', { code: 'race' })
  }
  await store.release()
  await quota.landed()
  if (old) {
    // The update has landed: a failed delete only queues the old key (dropKey never throws on KV).
    // A purged share's old key is already in kv_trash.
    if (!old.purged_at) await dropKey(env, keyOf(old))
    // The comments marked done are in this version: the viewer sees "In the latest version".
    await env.DB.prepare("UPDATE comments SET done_in = ?, updated_at = ? WHERE share_id = ? AND status = 'done' AND done_in IS NULL").bind(version, now, id).run()
  }
  return json({ id, version, bytes: body.byteLength, message, expiresAt })
}

// The share's preview card, drawn on the owner's Mac when the link is published (the host has no
// CPU to draw one per visit). Each upload is a key of its own; the row is flipped only if it still
// names the card read here, then the old key goes. A loser of two at once drops its own key.
async function putCard(req, env, owner, id) {
  const row = await getShare(env, id)
  if (!row || row.owner_id !== owner.id || row.deleted_at) return fail(404, 'No such share.')
  if (Number(req.headers.get('content-length')) > MAX_CARD) return fail(413, 'A preview card is at most 300 KiB.', { code: 'too_big' })
  const body = await req.arrayBuffer()
  if (body.byteLength > MAX_CARD) return fail(413, 'A preview card is at most 300 KiB.', { code: 'too_big' })
  const magic = new Uint8Array(body, 0, Math.min(3, body.byteLength))
  if (magic[0] !== 0xff || magic[1] !== 0xd8 || magic[2] !== 0xff) return fail(400, 'The body must be a JPEG.')
  const quota = await reserveUpload(env, owner)
  if (quota.refused) return quota.refused
  if (!await claim(env.DB, 'kv_write')) { await quota.failed(); return fail(507, 'The host\'s daily upload budget is used up.', { code: 'budget' }) }
  const key = `card:${id}:${newId()}`
  try { await putClaimed(env, key, body) } catch (e) { await quota.failed(); throw e }
  const flipped = await env.DB.prepare('UPDATE shares SET card_key = ? WHERE id = ? AND card_key IS ? AND deleted_at IS NULL').bind(key, id, row.card_key ?? null).run()
  if (!flipped.meta?.changes) {
    await dropKey(env, key)
    await quota.failed()
    return fail(409, 'Another update of this share landed first. Try again.', { code: 'race' })
  }
  if (row.card_key) await dropKey(env, row.card_key)
  return json({ id, card: cardPath(key) })
}

// The card's address under the share: the key's random part names the version, so a new card is a
// new URL and chats that cached the old one fetch it again.
const cardPath = key => `card.jpg?v=${key.split(':').pop()}`

async function deleteShare(env, owner, id) {
  const row = await getShare(env, id)
  if (!row || row.owner_id !== owner.id) return fail(404, 'No such share.')
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

// Where a share lives, for the visitor of the apex page. On this Mac it stays on the name the
// visitor came in on (the page answers on both loopback names), and 127.0.0.1 can only take the path
// form; anywhere else it is BASE.
function shareOrigin(url, env, id) {
  const base = namesOf(env.BASE).local ? url.host : env.BASE
  const paths = env.PATH_MODE === '1' || /^127\.0\.0\.1(:|$)/.test(base)
  return paths ? `${url.protocol}//${base}/s/${id}/` : `${url.protocol}//${id}.${base}/`
}

async function apex(env, url, id) {
  const row = await env.DB.prepare('SELECT s.*, o.name AS owner_name FROM shares s JOIN owners o ON o.id = s.owner_id WHERE s.id = ?').bind(id).first()
  const gone = unavailable(row)
  if (gone) return gone
  // The share's own card; else CARD (set by setup when the site is in front of the host), the site's.
  const card = row.card_key ? shareOrigin(url, env, id) + cardPath(row.card_key) : env.CARD ? new URL(env.CARD, url.origin).href : null
  return ogPage({ title: row.title, owner: row.owner_name, target: shareOrigin(url, env, id), url: `${url.origin}/${id}`, card, message: row.message, lang: row.lang })
}

function unavailable(row) {
  if (!row) return page('notfound', {})
  if (row.deleted_at) return page('removed', { lang: row.lang })
  if (row.expires_at && row.expires_at <= Date.now()) return page('expired', { lang: row.lang })
  return null
}

async function card(env, row) {
  if (!row.card_key) return page('notfound', { lang: row.lang })
  let bytes = await env.KV.get(row.card_key, 'arrayBuffer')
  if (!bytes) {
    await new Promise(go => setTimeout(go, KV_RETRY_MS))
    bytes = await env.KV.get(row.card_key, 'arrayBuffer')
  }
  if (!bytes) return page('notfound', { lang: row.lang })
  // Public: link previewers fetch it with no cookie, and a new card is a new ?v=.
  return new Response(bytes, { headers: { 'content-type': 'image/jpeg', 'cache-control': 'public, max-age=86400' } })
}

// A view of the link: one row per share per day, counted while today's D1 writes last. A view that
// can't be counted is still served.
async function counted(env, id) {
  try {
    if (!await room(env.DB, 'd1_write')) return
    await env.DB.prepare("INSERT INTO views (share_id, link_id, day, n) VALUES (?, '', ?, 1) ON CONFLICT(share_id, link_id, day) DO UPDATE SET n = views.n + 1").bind(id, today()).run()
  } catch (e) { console.error(e) }
}

async function share(req, env, url, r) {
  const pathForm = onBase(url, env)
  if (r.path === '/api' || r.path.startsWith('/api/')) {
    const row = await env.DB.prepare(
      'SELECT s.*, o.name AS owner_name, o.gh_login AS owner_login, o.gh_name AS owner_gh_name, o.gh_avatar AS owner_avatar FROM shares s JOIN owners o ON o.id = s.owner_id WHERE s.id = ?',
    ).bind(r.shareId).first()
    return viewerApi(req, env, url, row, r.path, pathForm)
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') return new Response(null, { status: 405, headers: { allow: 'GET, HEAD' } })
  if (pathForm && r.path === '') return new Response(null, { status: 301, headers: { location: `${url.origin}/s/${r.shareId}/` } })
  const row = await getShare(env, r.shareId)
  if (r.path === '/_in/auth') return unavailable(row) || ticketIn(req, env, url, row, pathForm)
  if (r.path === '/_in/start') return unavailable(row) || startIn(env, url, row, pathForm)
  if (r.path === '/card.jpg') return unavailable(row) || await card(env, row)
  if (r.path !== '/') return page('notfound', { lang: row?.lang })
  const gone = unavailable(row)
  if (gone) return gone
  let bytes = await env.KV.get(keyOf(row), 'arrayBuffer')
  if (!bytes) {
    await new Promise(go => setTimeout(go, KV_RETRY_MS))
    bytes = await env.KV.get(keyOf(row), 'arrayBuffer')
  }
  if (!bytes) return page('error', { lang: row.lang })
  if (req.method === 'GET') await counted(env, row.id)
  const pinned = url.searchParams.get('v') === String(row.version)
  // encodeBody: 'manual' is a Workers-only init option: the bytes are already gzip, so the runtime
  // must send them as they are with our content-encoding instead of compressing them again.
  return new Response(bytes, {
    status: 200,
    encodeBody: 'manual',
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'content-encoding': 'gzip',
      'x-robots-tag': 'noindex',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "frame-ancestors 'self'",
      'x-frame-options': 'SAMEORIGIN',
      // Expiring pages must check the host even when their version is pinned.
      'cache-control': pinned && !row.expires_at ? 'private, max-age=31536000, immutable' : 'private, no-cache',
    },
  })
}
