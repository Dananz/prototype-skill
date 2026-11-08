// Unit checks for prtype.dev/me (host/lib/me.mjs): the route, the sign-in through GitHub and its
// cookie (its own purpose, never a viewer cookie or a ticket), the list of every link of the GitHub
// account's owners rows, the changes it makes (message, off, remove, hide, reply) only on its own
// links and only from its own origin, and the page's CSP. The Worker runs in memory
// (share-memory-env.mjs); GitHub is the fake on 127.0.0.1.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { gzipSync } from 'node:zlib'
import worker from '../host/worker.mjs'
import { route } from '../host/lib/routes.mjs'
import { sign } from '../host/lib/cookies.mjs'
import { hex, memoryEnv } from './share-memory-env.mjs'
import { startFakeGitHub } from './fake-github.mjs'

const KEY = 'viewer-key-for-me-tests'
let gh
before(async () => { gh = await startFakeGitHub() })
after(async () => { await gh.close() })
const DANA = { id: 4242, login: 'dana-test', name: 'Dana', avatar_url: 'https://avatars.githubusercontent.com/u/4242' }

// prtype.dev as it runs: one origin per share, sign-in on.
const hostEnv = (extra = {}) => memoryEnv({
  PATH_MODE: '0', SIGNIN: '1', VIEWER_KEY: KEY,
  GITHUB_CLIENT_ID: gh.clientId, GITHUB_CLIENT_SECRET: gh.clientSecret, GITHUB_OAUTH: gh.url, GITHUB_API: gh.url,
  ...extra,
})
const call = (env, url, init) => worker.fetch(new Request(url.startsWith('http') ? url : `https://prtype.dev${url}`, init), env)
const ORIGIN = { origin: 'https://prtype.dev' }
const JSONH = { 'content-type': 'application/json' }
const meta = (o = {}) => Buffer.from(JSON.stringify({ title: 'Pricing', session: 's1', projectLabel: 'shop', scope: { protos: [{ id: 'pricing', variants: ['A', 'B'] }], start: 'pricing/A' }, lang: 'en', ...o })).toString('base64url')

async function addOwner(env, id, { gh_id, login = `user-${id}`, status = 'active' }) {
  env.DB.sql.prepare('INSERT INTO owners (id, name, created_at, gh_id, gh_login, gh_name, role, status) VALUES (?, ?, 1, ?, ?, ?, ?, ?)').run(id, login, gh_id ?? null, gh_id ? login : null, gh_id ? login : null, 'user', status)
  const token = `token-of-${id}`
  env.DB.sql.prepare('INSERT INTO owner_tokens (sha256, owner_id, device, created_at) VALUES (?, ?, ?, 1)').run(await hex(token), id, 'Mac')
  return token
}
async function publish(env, token, title = 'Pricing') {
  const { id } = await (await call(env, '/api/shares', { method: 'POST', headers: { authorization: `Bearer ${token}` } })).json()
  const res = await call(env, `/api/shares/${id}`, { method: 'PUT', headers: { authorization: `Bearer ${token}`, 'x-share-meta': meta({ title }) }, body: gzipSync('<!doctype html><p>hi') })
  assert.equal(res.status, 200, await res.clone().text())
  return id
}
function comment(env, shareId, body, { gh = 7, at = 1000 } = {}) {
  const cid = crypto.randomUUID()
  env.DB.sql.prepare("INSERT OR IGNORE INTO viewers (gh_id, login, name, avatar, seen_at) VALUES (?, ?, 'Viewer', NULL, 1)").run(gh, `viewer-${gh}`)
  env.DB.sql.prepare("INSERT INTO comments (id, share_id, link_id, viewer, verified, version, route, body, gh_id, variant, created_at, updated_at) VALUES (?, ?, '', ?, 1, 1, 'pricing/A', ?, ?, 'pricing/A', ?, ?)").run(cid, shareId, `gh:${gh}`, body, gh, at, at)
  return cid
}
// A /me cookie for this GitHub account, as the callback would set it.
const meCookie = async (gh_id, { purpose = 'me', exp = Date.now() + 3_600_000 } = {}) => `__Host-o=${await sign(KEY, purpose, { gh: gh_id, l: 'x', exp })}`
const as = cookie => ({ cookie })

test('/me is the owner page on the host\'s own name only', () => {
  for (const p of ['/me', '/me/', '/me/api/shares']) assert.equal(route(new URL(`https://prtype.dev${p}`), 'prtype.dev').at, 'me', p)
  assert.equal(route(new URL('https://weh0pb5y5r.prtype.dev/me'), 'prtype.dev').at, 'share')
  assert.equal(route(new URL('https://prtype.dev/meh'), 'prtype.dev').at, 'none')
  assert.equal(route(new URL('https://example.com/me'), 'prtype.dev').at, 'none')
})

test('signed out, /me offers the GitHub sign-in; the sign-in sets the cookie and comes back to /me', async () => {
  const env = await hostEnv()
  const out = await call(env, '/me')
  assert.equal(out.status, 200)
  const html = await out.text()
  assert.match(html, /Every link you shared,<br>in one place[^]*href="\/auth\/github\?me=1"/)
  assert.match(html, /href="\/auth\/github\?me=1"/)
  // The walk: /auth/github?me=1 → GitHub (the fake) → the callback, with the state cookie.
  gh.setUser(DANA)
  let r = await call(env, '/auth/github?me=1', { redirect: 'manual' })
  assert.equal(r.status, 302)
  const state = r.headers.getSetCookie()[0].split(';')[0]
  r = await fetch(r.headers.get('location'), { redirect: 'manual' })
  r = await call(env, r.headers.get('location'), { redirect: 'manual', headers: { cookie: state } })
  assert.equal(r.status, 302)
  assert.equal(r.headers.get('location'), 'https://prtype.dev/me')
  const set = r.headers.getSetCookie().find(c => c.startsWith('__Host-o='))
  assert.ok(set, 'the /me cookie is set')
  assert.match(set, /HttpOnly/)
  assert.match(set, /Secure/)
  assert.match(set, /SameSite=Lax/)
  assert.match(set, /Path=\//)
  assert.doesNotMatch(set, /Domain=/i)
  // Not an owner yet: the plain state.
  const page = await (await call(env, '/me', { headers: as(set.split(';')[0]) })).text()
  assert.match(page, /No links for @dana-test yet/)
  // Without sign-in on this host, there is no dead link.
  const off = await hostEnv({ SIGNIN: '0' })
  assert.doesNotMatch(await (await call(off, '/me')).text(), /auth\/github\?me=1/)
})

test('the /me cookie is never a viewer cookie or a ticket, and those are never it', async () => {
  const env = await hostEnv()
  const token = await addOwner(env, 'u1', { gh_id: DANA.id, login: 'dana-test' })
  const id = await publish(env, token)
  const meValue = (await meCookie(DANA.id)).split('=').slice(1).join('=')
  // As the share's viewer cookie: nobody.
  const asViewer = await call(env, `https://${id}.prtype.dev/api/me`, { headers: { 'x-proto': '1', cookie: `__Host-v=${meValue}` } })
  assert.equal(asViewer.status, 200)
  assert.equal(await asViewer.json(), null)
  // As a sign-in ticket: refused.
  const asTicket = await call(env, `https://${id}.prtype.dev/_in/auth?t=${encodeURIComponent(meValue)}`, { headers: { cookie: '__Host-vn=whatever' } })
  assert.match(await asTicket.text(), /Sign-in didn&#39;t finish|Sign-in didn't finish/)
  // A viewer cookie (or a ticket) as the /me cookie: signed out.
  const v = await sign(KEY, 'v', { gh: DANA.id, share: id, exp: Date.now() + 3_600_000 })
  assert.match(await (await call(env, '/me', { headers: as(`__Host-o=${v}`) })).text(), /Every link you shared,<br>in one place[^]*href="\/auth\/github\?me=1"/)
  const t = await sign(KEY, 'ticket', { gh: DANA.id, share: id, to: '/', nn: 'x', exp: Date.now() + 60_000 })
  assert.equal((await call(env, '/me/api/shares', { headers: as(`__Host-o=${t}`) })).status, 401)
  // Over https only __Host-o is read: a plain `o` (which a sibling share could set) is ignored.
  assert.equal((await call(env, '/me/api/shares', { headers: as(`o=${meValue}`) })).status, 401)
  // Expired: signed out.
  assert.equal((await call(env, '/me/api/shares', { headers: as(await meCookie(DANA.id, { exp: Date.now() - 1 })) })).status, 401)
})

test('the list covers every owners row of the GitHub account, and no one else\'s', async () => {
  const env = await hostEnv()
  // Two rows with one gh_id (an old token owner that claimed it, and a sign-in owner): schema.sql has
  // no unique index on gh_id (upgrade and 0006 add owners_gh), so this database takes both.
  const a = await addOwner(env, 'u1', { gh_id: DANA.id, login: 'dana-test' })
  const b = await addOwner(env, 'u2', { gh_id: DANA.id, login: 'dana-test' })
  const other = await addOwner(env, 'u3', { gh_id: 99, login: 'other' })
  const sa = await publish(env, a, 'From the Studio'), sb = await publish(env, b, 'From the laptop'), so = await publish(env, other, 'Not hers')
  const c = comment(env, sa, 'Option 3 is the one.')
  const res = await call(env, '/me/api/shares', { headers: as(await meCookie(DANA.id)) })
  assert.equal(res.status, 200)
  const list = await res.json()
  assert.deepEqual(list.map(s => s.id).sort(), [sa, sb].sort())
  const one = list.find(s => s.id === sa)
  assert.equal(one.designs, 2)
  assert.equal(one.project, 'shop')
  assert.deepEqual(one.comments, { total: 1, new: 1 })
  assert.deepEqual(one.notes.map(n => n.id), [c])
  // The page lists them too, and not the other account's.
  const html = await (await call(env, '/me', { headers: as(await meCookie(DANA.id)) })).text()
  assert.match(html, /From the Studio/)
  assert.match(html, /From the laptop/)
  assert.doesNotMatch(html, /Not hers/)
  assert.match(html, /2 links<\/span> from every project and Mac/)
  assert.match(html, new RegExp(`/prototype edit https://prtype\\.dev/${sa}`))
  assert.match(html, new RegExp(`https://prtype\\.dev/${sa}#/pricing/A`), 'See it in the design opens its design')
  assert.match(html, /Option 3 is the one\./)
  // A banned row shuts the account out; a pending one alone shows no links.
  env.DB.sql.prepare("UPDATE owners SET status = 'banned' WHERE id = 'u2'").run()
  assert.equal((await call(env, '/me/api/shares', { headers: as(await meCookie(DANA.id)) })).status, 404)
  assert.match(await (await call(env, '/me', { headers: as(await meCookie(DANA.id)) })).text(), /can&#39;t share here|can't share here/)
  assert.ok(so)
})

test('a change without the host\'s own Origin is a 403; on another account\'s link a 404', async () => {
  const env = await hostEnv()
  const mine = await addOwner(env, 'u1', { gh_id: DANA.id })
  const theirs = await addOwner(env, 'u2', { gh_id: 99 })
  const sm = await publish(env, mine), st = await publish(env, theirs)
  const ct = comment(env, st, 'theirs')
  const ck = await meCookie(DANA.id)
  const patch = (id, body, headers = ORIGIN) => call(env, `/me/api/shares/${id}`, { method: 'PATCH', headers: { ...JSONH, ...headers, cookie: ck }, body: JSON.stringify(body) })
  // No Origin, a share's own origin (same-site), another site: 403, and nothing changed.
  assert.equal((await patch(sm, { disabled: true }, {})).status, 403)
  assert.equal((await patch(sm, { disabled: true }, { origin: `https://${st}.prtype.dev` })).status, 403)
  assert.equal((await patch(sm, { disabled: true }, { origin: 'https://evil.example' })).status, 403)
  assert.equal((await call(env, `/me/api/shares/${sm}`, { method: 'DELETE', headers: { cookie: ck } })).status, 403)
  assert.equal((await call(env, '/me/api/signout', { method: 'POST' })).status, 403)
  assert.equal(env.DB.sql.prepare('SELECT disabled_at FROM shares WHERE id = ?').get(sm).disabled_at, null)
  // Another account's link and comment: 404, untouched.
  assert.equal((await patch(st, { disabled: true })).status, 404)
  assert.equal((await patch(st, { message: 'mine now' })).status, 404)
  assert.equal((await call(env, `/me/api/shares/${st}`, { method: 'DELETE', headers: { ...ORIGIN, cookie: ck } })).status, 404)
  assert.equal((await call(env, `/me/api/shares/${st}/card`, { headers: { cookie: ck } })).status, 404)
  assert.equal((await call(env, `/me/api/comments/${ct}`, { method: 'PATCH', headers: { ...JSONH, ...ORIGIN, cookie: ck }, body: JSON.stringify({ share: st, hidden: true }) })).status, 404)
  const row = env.DB.sql.prepare('SELECT disabled_at, deleted_at, message FROM shares WHERE id = ?').get(st)
  assert.deepEqual({ ...row }, { disabled_at: null, deleted_at: null, message: null })
  assert.equal(env.DB.sql.prepare('SELECT hidden FROM comments WHERE id = ?').get(ct).hidden, 0)
  // Signed out: 401.
  assert.equal((await call(env, `/me/api/shares/${sm}`, { method: 'PATCH', headers: { ...JSONH, ...ORIGIN }, body: '{"disabled":true}' })).status, 401)
})

test('message, off and on, hide and reply, and remove work on its own link', async () => {
  const env = await hostEnv()
  const token = await addOwner(env, 'u1', { gh_id: DANA.id })
  const id = await publish(env, token)
  const c = comment(env, id, 'Can the rest timer move?')
  const ck = await meCookie(DANA.id)
  const send = (method, path, body) => call(env, path, { method, headers: { ...JSONH, ...ORIGIN, cookie: ck }, body: body && JSON.stringify(body) })
  // The message: trimmed, at most 280, null clears it; the viewer reads it.
  let r = await send('PATCH', `/me/api/shares/${id}`, { message: '  Which reads fastest?  ' })
  assert.equal(r.status, 200)
  assert.equal((await r.json()).message, 'Which reads fastest?')
  assert.equal((await (await call(env, `https://${id}.prtype.dev/api/state`, { headers: { 'x-proto': '1' } })).json()).message, 'Which reads fastest?')
  assert.equal((await send('PATCH', `/me/api/shares/${id}`, { message: 'x'.repeat(281) })).status, 400)
  assert.equal((await send('PATCH', `/me/api/shares/${id}`, { message: 42 })).status, 400)
  // The owner API's PATCH takes it too, with the same rule.
  r = await call(env, `/api/shares/${id}`, { method: 'PATCH', headers: { ...JSONH, authorization: `Bearer ${token}` }, body: JSON.stringify({ message: null }) })
  assert.equal(r.status, 200)
  assert.equal(env.DB.sql.prepare('SELECT message FROM shares WHERE id = ?').get(id).message, null)
  // Off and back on.
  assert.equal((await send('PATCH', `/me/api/shares/${id}`, { disabled: true })).status, 200)
  assert.equal((await call(env, `https://${id}.prtype.dev/`)).status, 403)
  assert.equal((await send('PATCH', `/me/api/shares/${id}`, { disabled: false })).status, 200)
  assert.equal((await call(env, `https://${id}.prtype.dev/`)).status, 200)
  // Hide, show, reply; the status stays the Mac's.
  r = await send('PATCH', `/me/api/comments/${c}`, { share: id, hidden: true })
  assert.equal(r.status, 200)
  assert.equal(env.DB.sql.prepare('SELECT hidden FROM comments WHERE id = ?').get(c).hidden, 1)
  assert.equal((await send('PATCH', `/me/api/comments/${c}`, { share: id, hidden: false })).status, 200)
  r = await send('PATCH', `/me/api/comments/${c}`, { share: id, reply: 'Yes, trying it.' })
  assert.equal(r.status, 200)
  assert.equal((await r.json()).owner_reply, 'Yes, trying it.')
  assert.equal((await send('PATCH', `/me/api/comments/${c}`, { share: id, status: 'sent' })).status, 400)
  assert.equal(env.DB.sql.prepare('SELECT status FROM comments WHERE id = ?').get(c).status, 'new')
  const html = await (await call(env, '/me', { headers: as(ck) })).text()
  assert.match(html, /<span class="you">You<\/span><span data-reply>Yes, trying it\.<\/span>/)
  // A card is served to its owner only, never cached.
  env.DB.sql.prepare("UPDATE shares SET card_key = 'card:x' WHERE id = ?").run(id)
  await env.KV.put('card:x', new Uint8Array([0xff, 0xd8, 0xff, 1]))
  r = await call(env, `/me/api/shares/${id}/card`, { headers: as(ck) })
  assert.equal(r.status, 200)
  assert.equal(r.headers.get('content-type'), 'image/jpeg')
  assert.match(r.headers.get('cache-control'), /no-store/)
  // Remove: the link is gone with its comments.
  assert.equal((await send('DELETE', `/me/api/shares/${id}`)).status, 200)
  assert.equal((await call(env, `https://${id}.prtype.dev/`)).status, 410)
  assert.equal(env.DB.sql.prepare('SELECT COUNT(*) AS n FROM comments WHERE share_id = ?').get(id).n, 0)
  assert.deepEqual(await (await call(env, '/me/api/shares', { headers: as(ck) })).json(), [])
  // Sign out clears the cookie.
  r = await call(env, '/me/api/signout', { method: 'POST', headers: ORIGIN })
  assert.equal(r.status, 200)
  assert.match(r.headers.get('set-cookie'), /^__Host-o=; Path=\/; Max-Age=0/)
})

test('the page has a strict CSP: a nonce for its one script and style, no eval, no framing', async () => {
  const env = await hostEnv()
  const token = await addOwner(env, 'u1', { gh_id: DANA.id })
  await publish(env, token)
  for (const headers of [{}, as(await meCookie(DANA.id))]) {
    const r = await call(env, '/me', { headers })
    const csp = r.headers.get('content-security-policy')
    assert.ok(csp, 'a CSP')
    const nonce = /script-src 'nonce-([\w-]+)'/.exec(csp)?.[1]
    assert.ok(nonce, csp)
    assert.match(csp, /default-src 'none'/)
    assert.match(csp, /frame-ancestors 'none'/)
    assert.match(csp, /base-uri 'none'/)
    assert.match(csp, /form-action 'self'/)
    assert.match(csp, /connect-src 'self'/)
    assert.doesNotMatch(csp, /unsafe-eval|unsafe-inline/)
    assert.equal(r.headers.get('cache-control'), 'no-store')
    const html = await r.text()
    // Every script and style carries the nonce; no style="" and no on*="" anywhere.
    for (const tag of html.match(/<(script|style)\b[^>]*>/g) || []) assert.ok(tag.includes(`nonce="${nonce}"`), tag)
    assert.doesNotMatch(html, /\sstyle="/)
    assert.doesNotMatch(html, /\son[a-z]+="/)
    assert.doesNotMatch(html, /—/, 'no em dashes')
  }
  // Each answer its own nonce.
  const n1 = (await call(env, '/me')).headers.get('content-security-policy'), n2 = (await call(env, '/me')).headers.get('content-security-policy')
  assert.notEqual(n1, n2)
})

test('a host serving every share under its own name keeps /me shut; robots skip it', async () => {
  const env = await hostEnv({ PATH_MODE: '1' })
  await addOwner(env, 'u1', { gh_id: DANA.id })
  const r = await call(env, '/me', { headers: as(await meCookie(DANA.id)) })
  assert.equal(r.status, 404)
  assert.equal((await call(env, '/me/api/shares', { headers: as(await meCookie(DANA.id)) })).status, 404)
  assert.match(await (await call(env, '/robots.txt')).text(), /Disallow: \/me/)
  // On this Mac, http: the plain `o` cookie, and the other loopback name goes to BASE.
  const local = await memoryEnv({ BASE: 'localhost:8787', VIEWER_KEY: KEY })
  const moved = await worker.fetch(new Request('http://127.0.0.1:8787/me'), local)
  assert.equal(moved.status, 302)
  assert.equal(moved.headers.get('location'), 'http://localhost:8787/me')
})
