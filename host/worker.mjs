import { newId, isId } from './lib/ids.mjs'
import { ownerOf } from './lib/auth.mjs'
import { route } from './lib/routes.mjs'
import { page, ogPage } from './lib/pages.mjs'

const MAX_BYTES = 20 * 1024 * 1024

// No route sends CORS headers: the API answers same-origin pages and the owner's CLI only.
const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'x-content-type-options': 'nosniff', 'cache-control': 'no-store' }
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS })
const fail = (status, error) => json({ error }, status)

const htmlKey = (id, version) => `html:${id}:${version}`
const ogKey = (id, version) => `og:${id}:${version}`

// A share seen on the host's own name (not on <id>.<base>) is path mode.
const onBase = (url, env) => url.host.toLowerCase() === env.BASE.toLowerCase()

const getShare = (env, id) => env.DB.prepare('SELECT * FROM shares WHERE id = ?').bind(id).first()

export default {
  async fetch(req, env) {
    try {
      const url = new URL(req.url)
      const r = route(url, env.BASE)
      if (r.at === 'health') return new Response('ok', { headers: { 'content-type': 'text/plain', 'cache-control': 'no-store' } })
      if (r.at === 'api') return await api(req, env, r.path)
      if (r.at === 'apex') return await apex(env, url, r.shareId)
      if (r.at === 'share' && (env.PATH_MODE === '1' || !onBase(url, env))) return await share(req, env, url, r)
      return page('notfound', {})
    } catch (e) {
      console.error(e)
      return page('error', {})
    }
  },
}

async function api(req, env, path) {
  const owner = await ownerOf(req, env)
  if (!owner) return fail(401, 'A valid owner token is needed.')
  const parts = path.split('/').filter(Boolean) // ['api', 'shares', id?]
  if (parts[1] !== 'shares' || parts.length > 3) return fail(404, 'No such route.')
  const id = parts[2]
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
  if (Number(req.headers.get('content-length')) > MAX_BYTES) return fail(413, 'A share is at most 20 MiB gzipped.')
  const meta = readMeta(req.headers.get('x-share-meta'))
  if (!meta) return fail(400, 'x-share-meta must be base64url JSON with title, session, projectLabel, scope and lang.')
  const body = await req.arrayBuffer()
  if (body.byteLength > MAX_BYTES) return fail(413, 'A share is at most 20 MiB gzipped.')
  const magic = new Uint8Array(body, 0, Math.min(2, body.byteLength))
  if (magic[0] !== 0x1f || magic[1] !== 0x8b) return fail(400, 'The body must be gzip.')

  // A version is never overwritten (KV can serve an overwritten key stale): write the new key, flip
  // the pointer in D1, then drop the old key.
  const version = old ? old.version + 1 : 1
  const now = Date.now()
  await env.KV.put(htmlKey(id, version), body)
  await env.DB.prepare(
    `INSERT INTO shares (id, owner_id, session, project_label, title, scope, version, bytes, lang, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET session = excluded.session, project_label = excluded.project_label, title = excluded.title,
       scope = excluded.scope, version = excluded.version, bytes = excluded.bytes, lang = excluded.lang, updated_at = excluded.updated_at`,
  ).bind(id, owner.id, meta.session, meta.projectLabel, meta.title, JSON.stringify(meta.scope), version, body.byteLength, meta.lang, now, now).run()
  if (old) await env.KV.delete(htmlKey(id, old.version))
  return json({ id, version, bytes: body.byteLength })
}

async function deleteShare(env, owner, id) {
  const row = await getShare(env, id)
  if (!row || row.owner_id !== owner.id) return fail(404, 'No such share.')
  await env.KV.delete(htmlKey(id, row.version))
  await env.KV.delete(ogKey(id, row.version))
  await env.DB.prepare('UPDATE shares SET deleted_at = COALESCE(deleted_at, ?) WHERE id = ?').bind(Date.now(), id).run()
  return json({ id })
}

// Where a share lives, in the same form the request came in.
const shareOrigin = (url, env, id) => env.PATH_MODE === '1' ? `${url.protocol}//${env.BASE}/s/${id}/` : `${url.protocol}//${id}.${env.BASE}/`

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
  if (req.method !== 'GET' && req.method !== 'HEAD') return new Response(null, { status: 405, headers: { allow: 'GET, HEAD' } })
  if (onBase(url, env) && r.path === '') return new Response(null, { status: 301, headers: { location: `${url.origin}/s/${r.shareId}/` } })
  const row = await getShare(env, r.shareId)

  if (r.path === '/api/state') {
    if (req.headers.get('x-proto') !== '1') return fail(400, 'X-Proto: 1 is required.')
    if (!row) return fail(404, 'No such share.')
    if (row.deleted_at) return fail(410, 'This share was removed.')
    return json({ version: row.version, updatedAt: row.updated_at, title: row.title })
  }
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
