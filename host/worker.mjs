import { newId, isId } from './lib/ids.mjs'
import { ownerOf } from './lib/auth.mjs'
import { namesOf, route } from './lib/routes.mjs'
import { page, ogPage } from './lib/pages.mjs'
import { json, fail } from './lib/http.mjs'
import { upgraded } from './lib/upgrade.mjs'
import { authCallback, authStart, startIn, ticketIn } from './lib/github.mjs'
import { ownerComments, viewerApi } from './lib/comments.mjs'
import { dropKey, metered, putCounted, uploadRefused, usage } from './lib/budget.mjs'
import { cron } from './lib/cron.mjs'

const MAX_BYTES = 20 * 1024 * 1024

const htmlKey = (id, version) => `html:${id}:${version}`
// A crashed upload's claim on its version frees after this (see putShare).
const CLAIM_MS = 60_000

// A share seen on the host's own name (not on <id>.<base>) is path mode.
const onBase = (url, env) => namesOf(env.BASE).names.some(n => n.toLowerCase() === url.host.toLowerCase())
// Path mode is served when the host is set to it, and always by the host on this Mac, which must
// serve 127.0.0.1:<port>/s/<id>/ whether or not *.localhost resolves.
const pathsServed = env => env.PATH_MODE === '1' || namesOf(env.BASE).local
// A host off this Mac in path mode (prtype.dev, workers.dev) serves the path form only: there are no
// per-share names, and a stray <id>.<base> must not become a second way in.
const pathsOnly = env => env.PATH_MODE === '1' && !namesOf(env.BASE).local

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
    await cron(m.env, event?.scheduledTime || Date.now())
    await m.flush()
  },
}

async function serve(req, env) {
  const url = new URL(req.url)
  const gone = moved(url, env)
  if (gone) return gone
  const r = route(url, namesOf(env.BASE).names)
  if (r.at === 'health') {
    const headers = { 'content-type': 'text/plain', 'cache-control': 'no-store' }
    // Which code runs here, for the CLI to tell a host older than the skill.
    if (env.HOST_VERSION) headers['x-proto-host'] = env.HOST_VERSION
    return new Response('ok', { headers })
  }
  await upgraded(env)
  if (r.at === 'api') return await api(req, env, url, r.path)
  if (r.at === 'auth') {
    if (req.method !== 'GET') return new Response(null, { status: 405, headers: { allow: 'GET' } })
    return r.path === '/auth/github' ? await authStart(env, url) : await authCallback(req, env, url)
  }
  if (r.at === 'apex') return await apex(env, url, r.shareId)
  if (r.at === 'share' && (onBase(url, env) ? pathsServed(env) : !pathsOnly(env))) return await share(req, env, url, r)
  return page('notfound', {})
}

// The names the Worker used to answer on (LEGACY, comma-separated: the workers.dev name once the
// domain is live). Links sent from there keep working: a share or a short link moves to the same
// path on BASE. The API and sign-in don't move: an old CLI or a half-done sign-in gets a clear 410.
function moved(url, env) {
  const host = url.host.toLowerCase()
  if (!(env.LEGACY || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean).includes(host)) return null
  const r = route(url, host)
  if (r.at === 'health') return null
  if (r.at === 'api' || r.at === 'auth') return fail(410, `This host moved to https://${env.BASE}.`, { code: 'moved' })
  // A Location can't carry the #/route; the browser keeps it across the redirect.
  if (r.at === 'share' || r.at === 'apex') return new Response(null, { status: 301, headers: { location: `https://${env.BASE}${url.pathname}${url.search}`, 'cache-control': 'no-store' } })
  return page('notfound', {})
}

async function api(req, env, url, path) {
  const owner = await ownerOf(req, env)
  if (!owner) return fail(401, 'A valid owner token is needed.', { code: 'token' })
  const parts = path.split('/').filter(Boolean) // ['api', 'shares', id?] or ['api', 'owner', 'comments', id?]
  if (parts[1] === 'owner' && parts[2] === 'comments' && parts.length <= 4) return ownerComments(req, env, owner, url, parts[3])
  if (parts[1] === 'owner' && parts[2] === 'usage' && parts.length === 3) return req.method === 'GET' ? json(await usage(env.DB)) : fail(405, 'Method not allowed.')
  if (parts[1] !== 'shares' || parts.length > 3) return fail(404, 'No such route.')
  const id = parts[2]
  if ((id === undefined && req.method === 'POST') || (id !== undefined && req.method === 'PUT')) {
    const refused = await uploader(env, owner)
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

// Path mode puts every share on one origin, which is safe only while the owner alone publishes
// (spec: Security). Setup names that owner in meta.owner_id; until it does, a host off this Mac takes
// no uploads at all. The host on this Mac has one owner by construction and keeps phase 0's rule.
async function uploader(env, owner) {
  const row = await env.DB.prepare("SELECT v FROM meta WHERE k = 'owner_id'").first()
  if (row ? row.v === owner.id : namesOf(env.BASE).local) return null
  return fail(403, 'This host takes uploads from its owner only.', { code: 'not_owner' })
}

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

async function listShares(env, owner) {
  const { results } = await env.DB.prepare(
    'SELECT id, title, version, bytes, updated_at FROM shares WHERE owner_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC, id',
  ).bind(owner.id).all()
  return json(results.map(s => ({ id: s.id, title: s.title, version: s.version, bytes: s.bytes, updatedAt: s.updated_at })))
}

function readMeta(header) {
  try {
    const m = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob((header || '').replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))))
    const text = v => typeof v === 'string' && v.length <= 300
    if (!text(m.title) || !text(m.session) || !text(m.projectLabel) || !['en', 'he'].includes(m.lang)) return null
    if (!m.scope || typeof m.scope !== 'object') return null
    return m
  } catch { return null }
}

async function putShare(req, env, owner, id) {
  const reserved = await env.DB.prepare("SELECT 1 AS ok FROM ids WHERE id = ? AND kind = 'share'").bind(id).first()
  const old = await getShare(env, id)
  if (!reserved || (old && (old.owner_id !== owner.id || old.deleted_at))) return fail(404, 'No such share.')
  if (Number(req.headers.get('content-length')) > MAX_BYTES) return fail(413, 'A share is at most 20 MiB gzipped.', { code: 'too_big' })
  const meta = readMeta(req.headers.get('x-share-meta'))
  if (!meta) return fail(400, 'x-share-meta must be base64url JSON with title, session, projectLabel, scope and lang.')
  const body = await req.arrayBuffer()
  if (body.byteLength > MAX_BYTES) return fail(413, 'A share is at most 20 MiB gzipped.', { code: 'too_big' })
  const magic = new Uint8Array(body, 0, Math.min(2, body.byteLength))
  if (magic[0] !== 0x1f || magic[1] !== 0x8b) return fail(400, 'The body must be gzip.')

  // A version is never overwritten (KV can serve an overwritten key stale): write the new key, flip
  // the pointer in D1, then drop the old key. Two uploads at once would both take old+1 and write the
  // same key, so each first claims (share, version) in D1; the loser stops before it touches KV. A
  // claim older than CLAIM_MS is free again, so a crashed upload can't wedge the share.
  const version = old ? old.version + 1 : 1
  const refused = await uploadRefused(env, id, body.byteLength)
  if (refused) return refused
  const now = Date.now()
  const race = () => fail(409, 'Another update of this share landed first. Try again.', { code: 'race' })
  const claim = await env.DB.prepare('INSERT INTO caps (what, slot, n) VALUES (?, ?, ?) ON CONFLICT(what, slot) DO UPDATE SET n = excluded.n WHERE caps.n < ?')
    .bind(`put:${id}`, version, now, now - CLAIM_MS).run()
  if (!claim.meta?.changes) return race()
  await putCounted(env, htmlKey(id, version), body)
  const row = [meta.session, meta.projectLabel, meta.title, JSON.stringify(meta.scope), version, body.byteLength, meta.lang, now]
  const flipped = old
    ? await env.DB.prepare(
      `UPDATE shares SET session = ?, project_label = ?, title = ?, scope = ?, version = ?, bytes = ?, lang = ?, updated_at = ?
       WHERE id = ? AND version = ? AND deleted_at IS NULL`,
    ).bind(...row, id, old.version).run()
    : await env.DB.prepare(
      `INSERT INTO shares (session, project_label, title, scope, version, bytes, lang, updated_at, id, owner_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`,
    ).bind(...row, id, owner.id, now).run()
  if (!flipped.meta?.changes) {
    // Removed meanwhile, or a stale claim lost to a newer one: the key is ours only if the pointer
    // isn't on it.
    const cur = await getShare(env, id)
    if (cur?.version !== version || cur?.deleted_at) await dropKey(env, htmlKey(id, version))
    return race()
  }
  if (old) {
    await dropKey(env, htmlKey(id, old.version))
    // The comments marked done are in this version: the viewer sees "In the latest version".
    await env.DB.prepare("UPDATE comments SET done_in = ?, updated_at = ? WHERE share_id = ? AND status = 'done' AND done_in IS NULL").bind(version, now, id).run()
  }
  return json({ id, version, bytes: body.byteLength })
}

async function deleteShare(env, owner, id) {
  const row = await getShare(env, id)
  if (!row || row.owner_id !== owner.id) return fail(404, 'No such share.')
  // The tombstone first: between it and the KV delete the link already says removed, never a 500.
  await env.DB.prepare('UPDATE shares SET deleted_at = COALESCE(deleted_at, ?) WHERE id = ?').bind(Date.now(), id).run()
  // Deleting a share deletes its comments (spec: Data and privacy); the row stays as a tombstone.
  await env.DB.prepare('DELETE FROM comments WHERE share_id = ?').bind(id).run()
  if (!row.deleted_at) await dropKey(env, htmlKey(id, row.version))
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
  return ogPage({ title: row.title, owner: row.owner_name, target: shareOrigin(url, env, id) })
}

function unavailable(row) {
  if (!row) return page('notfound', {})
  if (row.deleted_at) return page('removed', { lang: row.lang })
  if (row.expires_at && row.expires_at < Date.now()) return page('expired', { lang: row.lang })
  return null
}

async function share(req, env, url, r) {
  const pathForm = onBase(url, env)
  if (r.path === '/api' || r.path.startsWith('/api/')) {
    const row = await env.DB.prepare('SELECT s.*, o.name AS owner_name FROM shares s JOIN owners o ON o.id = s.owner_id WHERE s.id = ?').bind(r.shareId).first()
    return viewerApi(req, env, url, row, r.path, pathForm)
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') return new Response(null, { status: 405, headers: { allow: 'GET, HEAD' } })
  if (pathForm && r.path === '') return new Response(null, { status: 301, headers: { location: `${url.origin}/s/${r.shareId}/` } })
  const row = await getShare(env, r.shareId)
  if (r.path === '/_in/auth') return unavailable(row) || ticketIn(req, env, url, row, pathForm)
  if (r.path === '/_in/start') return unavailable(row) || startIn(env, url, row, pathForm)
  if (r.path !== '/') return page('notfound', { lang: row?.lang })
  const gone = unavailable(row)
  if (gone) return gone
  const bytes = await env.KV.get(htmlKey(row.id, row.version), 'arrayBuffer')
  if (!bytes) return page('error', { lang: row.lang })
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
      'cache-control': pinned ? 'private, max-age=31536000, immutable' : 'private, no-cache',
    },
  })
}
