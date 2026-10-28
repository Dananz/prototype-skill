// Unit checks for one share host with many users (spec 2026-10-28-shared-host-design): users who
// each publish and touch only their own links, sign-in from a Mac without a token, admission
// (invite, allowlists, open), quotas, the admin's calls, reports, the purge of long-expired pages,
// and one origin per share. The Worker runs in memory (share-memory-env.mjs); GitHub is the fake on
// 127.0.0.1. Nothing here reaches a network, the Keychain or ~/.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { gzipSync } from 'node:zlib'
import { randomBytes } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync, readdirSync } from 'node:fs'
import worker from '../host/worker.mjs'
import { cron, purge } from '../host/lib/cron.mjs'
import { upgrade } from '../host/lib/upgrade.mjs'
import { sign } from '../host/lib/cookies.mjs'
import { today } from '../host/lib/budget.mjs'
import { assertFreeConfig, onlineConfig } from '../scripts/share-online.mjs'
import { TOKEN, hex, memoryEnv } from './share-memory-env.mjs'
import { startFakeGitHub } from './fake-github.mjs'

const KEY = 'viewer-key-for-multiuser-tests'
const DAY_MS = 86_400_000
let gh
before(async () => { gh = await startFakeGitHub() })
after(async () => { await gh.close() })
const DANA = { id: 4242, login: 'dana-test', name: 'Dana', avatar_url: 'https://avatars.githubusercontent.com/u/4242', created_at: '2015-01-01T00:00:00Z' }

// prtype.dev as it runs for everyone: one origin per share (path mode off), sign-in on.
const hostEnv = (extra = {}) => memoryEnv({
  PATH_MODE: '0', SIGNIN: '1', VIEWER_KEY: KEY,
  GITHUB_CLIENT_ID: gh.clientId, GITHUB_CLIENT_SECRET: gh.clientSecret, GITHUB_OAUTH: gh.url, GITHUB_API: gh.url,
  ...extra,
})
const call = (env, url, init) => worker.fetch(new Request(url.startsWith('http') ? url : `https://prtype.dev${url}`, init), env)
const bearer = token => ({ authorization: `Bearer ${token}` })
const JSONH = { 'content-type': 'application/json' }
const XP = { 'x-proto': '1' }
const meta = (o = {}) => Buffer.from(JSON.stringify({ title: 'Pricing', session: 's1', projectLabel: 'shop', scope: { protos: [{ id: 'pricing', variants: ['A'] }], start: 'pricing/A' }, lang: 'en', ...o })).toString('base64url')
const JPEG = () => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])
const codeOf = async res => (await res.clone().json()).code

// A user as a sign-in would leave one: a GitHub identity, a status, a token.
async function addUser(env, id, login, { status = 'active', role = 'user', gh_id = Math.floor(Math.random() * 1e6) + 10_000, expires } = {}) {
  env.DB.sql.prepare('INSERT INTO owners (id, name, created_at, gh_id, gh_login, gh_name, role, status) VALUES (?, ?, 1, ?, ?, ?, ?, ?)').run(id, login, gh_id, login, login, role, status)
  const token = `token-of-${id}`
  env.DB.sql.prepare('INSERT INTO owner_tokens (sha256, owner_id, device, created_at, expires_at) VALUES (?, ?, ?, 1, ?)').run(await hex(token), id, 'Mac', expires ?? null)
  return token
}
const put = (env, token, id, html = '<!doctype html><p>hi', m = meta()) => call(env, `/api/shares/${id}`, { method: 'PUT', headers: { ...bearer(token), 'x-share-meta': m }, body: gzipSync(html) })
async function publish(env, token, html) {
  const created = await call(env, '/api/shares', { method: 'POST', headers: bearer(token) })
  assert.equal(created.status, 200, await created.clone().text())
  const { id } = await created.json()
  const res = await put(env, token, id, html)
  assert.equal(res.status, 200, await res.clone().text())
  return id
}
const comment = (env, shareId, body) => {
  const cid = crypto.randomUUID()
  env.DB.sql.prepare("INSERT OR IGNORE INTO viewers (gh_id, login, name, avatar, seen_at) VALUES (7, 'viewer', 'V', NULL, 1)").run()
  env.DB.sql.prepare("INSERT INTO comments (id, share_id, link_id, viewer, verified, version, route, body, gh_id, variant, created_at, updated_at) VALUES (?, ?, '', 'gh:7', 1, 1, 'pricing/A', ?, 7, 'pricing/A', 1, 1)").run(cid, shareId, body)
  return cid
}

// The sign-in from a Mac without a token: start, the browser's walk through GitHub, the client's poll.
const start = (env, body = { device: 'Test Mac' }, ip = '203.0.113.9') => call(env, '/api/signin/start', { method: 'POST', headers: { ...JSONH, 'cf-connecting-ip': ip }, body: JSON.stringify(body) })
const poll = (env, code, secret) => call(env, '/api/signin/poll', { method: 'POST', headers: JSONH, body: JSON.stringify({ code, poll: secret }) })
// The browser's walk: the sign-in link, GitHub (the fake), the callback, which ends on the confirm page
// with its form token and cookie. { status, text, state, form, cookie }.
async function walk(env, url) {
  let r = await call(env, url, { redirect: 'manual' })
  if (r.status !== 302) return { status: r.status, text: await r.text() }
  const state = r.headers.getSetCookie()[0].split(';')[0]
  r = await fetch(r.headers.get('location'), { redirect: 'manual' })
  r = await call(env, r.headers.get('location'), { redirect: 'manual', headers: { cookie: state } })
  const text = await r.text()
  const set = r.headers.getSetCookie().find(c => /^(__Host-)?gha=/.test(c))
  return { status: r.status, text, state, set, form: /name="t" value="([^"]+)"/.exec(text)?.[1], cookie: set?.split(';')[0] }
}
// The confirm page's buttons: a form post to the apex, from the apex, with the page's cookie.
const decide = (env, w, what = 'approve', { form = w.form, cookie = w.cookie, origin = 'https://prtype.dev' } = {}) => call(env, '/auth/github/approve', {
  method: 'POST', body: new URLSearchParams({ t: form ?? '', do: what }).toString(),
  headers: { 'content-type': 'application/x-www-form-urlencoded', ...(cookie ? { cookie } : {}), ...(origin ? { origin } : {}) },
})
// Walked and approved: the last page, as the person sees it.
async function finish(env, url) {
  const w = await walk(env, url)
  if (!w.form) return w
  const r = await decide(env, w)
  return { ...w, status: r.status, text: await r.text() }
}
async function signIn(env, user = DANA) {
  gh.setUser(user)
  const s = await (await start(env)).json()
  const walked = await finish(env, s.url)
  const res = await poll(env, s.code, s.poll)
  return { ...s, walked, res, body: await res.clone().json() }
}

test('two users each publish; neither can update, remove, card, or read the comments of the other\'s', async () => {
  const env = await hostEnv()
  const ann = await addUser(env, 'u1', 'ann'), bob = await addUser(env, 'u2', 'bob')
  const a = await publish(env, ann), b = await publish(env, bob)
  const ca = comment(env, a, 'for ann'), cb = comment(env, b, 'for bob')
  // Each list and each comment feed is the user's own.
  assert.deepEqual((await (await call(env, '/api/shares', { headers: bearer(ann) })).json()).map(s => s.id), [a])
  assert.deepEqual((await (await call(env, '/api/shares', { headers: bearer(bob) })).json()).map(s => s.id), [b])
  assert.deepEqual((await (await call(env, '/api/owner/comments', { headers: bearer(bob) })).json()).comments.map(c => c.id), [cb])
  // The other's share is a 404, as if there were none.
  assert.equal((await put(env, bob, a, 'mine now')).status, 404)
  assert.equal((await call(env, `/api/shares/${a}`, { method: 'DELETE', headers: bearer(bob) })).status, 404)
  assert.equal((await call(env, `/api/shares/${a}/card`, { method: 'PUT', headers: bearer(bob), body: JPEG() })).status, 404)
  assert.equal((await call(env, `/api/owner/comments/${ca}`, { method: 'PATCH', headers: { ...bearer(bob), ...JSONH }, body: JSON.stringify({ status: 'sent' }) })).status, 404)
  assert.equal(env.DB.sql.prepare('SELECT status FROM comments WHERE id = ?').get(ca).status, 'new')
  assert.equal(env.DB.sql.prepare('SELECT deleted_at FROM shares WHERE id = ?').get(a).deleted_at, null)
  // Each page lives on its own origin.
  assert.equal((await call(env, `https://${a}.prtype.dev/`)).status, 200)
  assert.equal((await call(env, `https://${b}.prtype.dev/`)).status, 200)
})

test('pending waits for a new share but updates and removes its own; banned only reads itself and signs out; admin calls need the role', async () => {
  const env = await hostEnv()
  const pat = await addUser(env, 'u1', 'pat')
  const id = await publish(env, pat)
  env.DB.sql.prepare("UPDATE owners SET status = 'pending' WHERE id = 'u1'").run()
  const created = await call(env, '/api/shares', { method: 'POST', headers: bearer(pat) })
  assert.equal(created.status, 403)
  assert.equal(await codeOf(created), 'pending')
  assert.match((await created.json()).error, /approval/)
  env.DB.sql.prepare("INSERT INTO ids (id, kind) VALUES ('k3x9p2abcd', 'share')").run()
  assert.equal(await codeOf(await put(env, pat, 'k3x9p2abcd')), 'pending', 'a reserved id does not skip the wait')
  assert.equal((await put(env, pat, id, 'v2')).status, 200)
  assert.equal((await call(env, `/api/shares/${id}/card`, { method: 'PUT', headers: bearer(pat), body: JPEG() })).status, 200)
  const me = await (await call(env, '/api/owner', { headers: bearer(pat) })).json()
  assert.equal(me.status, 'pending')
  assert.equal(me.role, 'user')
  assert.equal((await call(env, `/api/shares/${id}`, { method: 'DELETE', headers: bearer(pat) })).status, 200)

  env.DB.sql.prepare("UPDATE owners SET status = 'banned' WHERE id = 'u1'").run()
  for (const [path, init] of [['/api/shares', {}], ['/api/shares', { method: 'POST' }], ['/api/owner/comments', {}], ['/api/owner/usage', {}], ['/api/admin/users', {}]]) {
    const r = await call(env, path, { ...init, headers: bearer(pat) })
    assert.equal(r.status, 403, path)
    assert.equal(await codeOf(r), 'banned', path)
  }
  assert.equal((await (await call(env, '/api/owner', { headers: bearer(pat) })).json()).status, 'banned')

  const user = await addUser(env, 'u2', 'una')
  for (const [path, method] of [['/api/admin/users', 'GET'], ['/api/admin/users/pat/approve', 'POST'], ['/api/admin/users/pat/ban', 'POST'], [`/api/admin/shares/${id}`, 'DELETE'], ['/api/admin/reports', 'GET']]) {
    const r = await call(env, path, { method, headers: bearer(user) })
    assert.equal(r.status, 403, path)
    assert.equal(await codeOf(r), 'admin', path)
  }
  // The admin: the list by status, then an approval lets a pending user share.
  env.DB.sql.prepare("UPDATE owners SET status = 'pending' WHERE id = 'u2'").run()
  const pendingList = await (await call(env, '/api/admin/users?status=pending', { headers: bearer(TOKEN) })).json()
  assert.deepEqual(pendingList.map(u => [u.login, u.status, u.role]), [['una', 'pending', 'user']])
  assert.equal((await call(env, '/api/admin/users?status=nope', { headers: bearer(TOKEN) })).status, 400)
  assert.equal((await call(env, '/api/admin/users/UNA/approve', { method: 'POST', headers: bearer(TOKEN) })).status, 200, 'logins match in any case')
  await publish(env, user)
  assert.equal((await call(env, '/api/admin/users/nobody/approve', { method: 'POST', headers: bearer(TOKEN) })).status, 404)
})

test('sign-in without a token: waiting, a token once, a wrong secret and an unknown code alike, expiry, and no token at rest', async () => {
  const env = await hostEnv({ ALLOW_LOGINS: 'dana-test' })
  gh.setUser(DANA)
  const s = await (await start(env)).json()
  assert.match(s.code, /^[0-9a-z]{10}$/)
  assert.equal(s.url, `https://prtype.dev/auth/github?signin=${s.code}`)
  assert.ok(s.exp > Date.now() && s.exp <= Date.now() + 10 * 60_000)
  // Only the poll secret's hash rests here.
  const row = env.DB.sql.prepare('SELECT * FROM signins WHERE code = ?').get(s.code)
  assert.equal(row.poll, await hex(s.poll))
  assert.equal(row.device, 'Test Mac')
  const waiting = await poll(env, s.code, s.poll)
  assert.equal(waiting.status, 202)
  assert.deepEqual(await waiting.json(), { state: 'waiting' })
  const walked = await finish(env, s.url)
  assert.equal(walked.status, 200, walked.text)
  assert.match(walked.text, /Signed in as @dana-test/)
  assert.match(walked.text, /You can close this tab/)
  assert.match(walked.state, /^__Host-gh=/, 'the apex state cookie is __Host- over https')
  // The public profile only.
  assert.equal(gh.calls.filter(c => c.path === '/login/oauth/authorize').at(-1).query.scope, '')
  // A wrong secret is an unknown code; the right one gets the token, once.
  assert.equal((await poll(env, s.code, s.poll + 'x')).status, 404)
  assert.equal((await poll(env, 'zzzzzzzzzz', s.poll)).status, 404)
  const done = await poll(env, s.code, s.poll)
  assert.equal(done.status, 200)
  const got = await done.json()
  assert.deepEqual({ ...got, token: typeof got.token }, { token: 'string', login: 'dana-test', name: 'Dana', avatar: DANA.avatar_url, status: 'active' })
  assert.equal((await poll(env, s.code, s.poll)).status, 404, 'a token is answered once')
  // The link works once too.
  assert.equal((await finish(env, s.url)).status, 400)
  // The token is the user's, and expires in a year; no table holds it in plain text.
  const me = await (await call(env, '/api/owner', { headers: bearer(got.token) })).json()
  assert.equal(me.login, 'dana-test')
  assert.equal(me.status, 'active')
  const t = env.DB.sql.prepare('SELECT * FROM owner_tokens WHERE sha256 = ?').get(await hex(got.token))
  assert.equal(t.device, 'Test Mac')
  assert.ok(t.expires_at > Date.now() + 364 * DAY_MS)
  for (const { name } of env.DB.sql.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()) {
    assert.ok(!JSON.stringify(env.DB.sql.prepare(`SELECT * FROM ${name}`).all()).includes(got.token), `${name} holds the token`)
  }
  await publish(env, got.token)
  // A second sign-in of the same account finds the same user.
  const again = await signIn(env)
  assert.equal(again.res.status, 200)
  assert.equal(env.DB.sql.prepare('SELECT COUNT(*) AS n FROM owners WHERE gh_id = 4242').get().n, 1)

  // Expired before the person came back: the link and the poll both say so.
  const late = await (await start(env)).json()
  env.DB.sql.prepare('UPDATE signins SET exp = ? WHERE code = ?').run(Date.now() - 2 * 60_000, late.code)
  assert.equal((await poll(env, late.code, late.poll)).status, 410)
  assert.equal((await finish(env, late.url)).status, 400)
  // Finished in time, polled a moment past the 10 minutes: still taken; long past: expired.
  const slow = await (await start(env)).json()
  await finish(env, slow.url)
  env.DB.sql.prepare('UPDATE signins SET exp = ? WHERE code = ?').run(Date.now() - 1_000, slow.code)
  assert.equal((await poll(env, slow.code, slow.poll)).status, 200)
  const gone = await (await start(env)).json()
  await finish(env, gone.url)
  env.DB.sql.prepare('UPDATE signins SET exp = ? WHERE code = ?').run(Date.now() - 5 * 60_000, gone.code)
  assert.equal((await poll(env, gone.code, gone.poll)).status, 410)
  // The cron forgets old rows.
  await cron(env, Date.now())
  assert.equal(env.DB.sql.prepare('SELECT COUNT(*) AS n FROM signins WHERE code IN (?, ?)').get(late.code, gone.code).n, 0)
  // Bad bodies.
  assert.equal((await call(env, '/api/signin/poll', { method: 'POST', headers: JSONH, body: '{}' })).status, 404)
  assert.equal((await call(env, '/api/signin/start', { method: 'GET' })).status, 405)
  assert.equal((await start(env, { device: 'x'.repeat(81) })).status, 400)
})

test('sign-in asks before it signs in: the device and the Mac\'s code shown, Approve only from that browser, once; Cancel ends it', async () => {
  const env = await hostEnv({ ALLOW_LOGINS: 'dana-test' })
  gh.setUser(DANA)
  const s = await (await start(env, { device: 'Studio <b>' })).json()
  assert.match(s.words, /^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/)
  const w = await walk(env, s.url)
  assert.equal(w.status, 200)
  assert.match(w.text, /Sign in Studio &lt;b&gt; as @dana-test\?/)
  assert.ok(w.text.includes(`<code data-words>${s.words}</code>`), 'the code the Mac shows')
  assert.match(w.set, /^__Host-gha=[\w-]+; Path=\/; Max-Age=600; HttpOnly; SameSite=Lax; Secure$/)
  assert.equal(env.DB.sql.prepare("SELECT COUNT(*) AS n FROM owners WHERE gh_id = 4242").get().n, 0, 'nobody made before Approve')
  // Back from GitHub is not signed in: the poll still waits.
  assert.equal((await poll(env, s.code, s.poll)).status, 202)
  // Refused: no cookie, another browser's cookie, another site's form, a forged or re-purposed token, a GET.
  const refused = async (r, why) => { assert.equal(r.status, 400, why); assert.match(await r.text(), /Sign-in didn/, why) }
  await refused(await decide(env, w, 'approve', { cookie: null }), 'no cookie')
  await refused(await decide(env, w, 'approve', { cookie: '__Host-gha=AAAAAAAAAAAAAAAAAAAAAA' }), 'another cookie')
  await refused(await decide(env, w, 'approve', { origin: 'https://k3x9p2m4q7.prtype.dev' }), 'a share posting it')
  const mid = Math.floor(w.form.length * 0.75)
  await refused(await decide(env, w, 'approve', { form: w.form.slice(0, mid) + (w.form[mid] === 'A' ? 'B' : 'A') + w.form.slice(mid + 1) }), 'a tampered token')
  const nonce = w.cookie.split('=')[1]
  const user = { gh_id: 4242, login: 'dana-test', name: 'Dana', avatar: DANA.avatar_url }
  await refused(await decide(env, w, 'approve', { form: await sign(KEY, 'state', { c: s.code, u: user, a: true, n: nonce, exp: Date.now() + 60_000 }) }), 'another purpose')
  await refused(await decide(env, w, 'approve', { form: await sign(KEY, 'approve', { c: s.code, u: user, a: true, n: nonce, exp: Date.now() - 1 }) }), 'expired')
  await refused(await decide(env, w, 'maybe'), 'neither button')
  assert.equal((await call(env, '/auth/github/approve')).status, 405)
  assert.equal((await poll(env, s.code, s.poll)).status, 202)
  // Approved: signed in, and the poll has its token. The same form again does nothing more.
  const ok = await decide(env, w)
  assert.equal(ok.status, 200)
  assert.match(await ok.text(), /Signed in as @dana-test/)
  assert.ok(ok.headers.getSetCookie().some(c => /^__Host-gha=;.*Max-Age=0/.test(c)), 'the cookie is cleared')
  await refused(await decide(env, w), 'replayed')
  assert.equal((await poll(env, s.code, s.poll)).status, 200)
  // A form token is bound to its own sign-in: one from this walk can't finish another.
  const other = await (await start(env)).json()
  await refused(await decide(env, w, 'approve', { form: await sign(KEY, 'approve', { c: other.code, u: { ...user, gh_id: 9 }, a: true, n: 'x', exp: Date.now() + 60_000 }) }), 'a forged token for another sign-in')
  assert.equal((await poll(env, other.code, other.poll)).status, 202)
  // Cancel: nothing signed in, and the poll says the sign-in is over.
  const c = await walk(env, other.url)
  const no = await decide(env, c, 'cancel')
  assert.equal(no.status, 200)
  assert.match(await no.text(), /Sign-in cancelled/)
  assert.equal((await poll(env, other.code, other.poll)).status, 410)
  await refused(await decide(env, c), 'approve after cancel')
})

test('sign-in starts: 20 an hour per IP, and a 503 where sign-in is not set up', async () => {
  const env = await hostEnv()
  for (let i = 0; i < 20; i++) assert.equal((await start(env)).status, 200, `start ${i + 1}`)
  const capped = await start(env)
  assert.equal(capped.status, 429)
  assert.equal(await codeOf(capped), 'rate')
  assert.equal((await start(env, {}, '198.51.100.1')).status, 200, 'another IP has its own count')
  const off = await hostEnv({ SIGNIN: '0' })
  const r = await start(off)
  assert.equal(r.status, 503)
  assert.equal(await codeOf(r), 'signin_off')
})

test('invite (the default): a new user gets a token and waits; upload says pending; the admin approves', async () => {
  const env = await hostEnv()
  const s = await signIn(env)
  assert.match(s.walked.text, /Thanks, @dana-test/)
  assert.match(s.walked.text, /approves you/)
  assert.equal(s.res.status, 200)
  assert.equal(s.body.status, 'pending')
  const refused = await call(env, '/api/shares', { method: 'POST', headers: bearer(s.body.token) })
  assert.equal(refused.status, 403)
  assert.deepEqual({ ...await refused.json(), error: '' }, { error: '', code: 'pending', login: 'dana-test' }, 'the 403 names who waits')
  assert.equal(env.DB.sql.prepare("SELECT role, status FROM owners WHERE gh_login = 'dana-test'").get().role, 'user')
  assert.equal((await call(env, '/api/admin/users/dana-test/approve', { method: 'POST', headers: bearer(TOKEN) })).status, 200)
  await publish(env, s.body.token)
  // A banned account signs in to a page that says so, and its Mac gets no token: the poll says banned.
  env.DB.sql.prepare("UPDATE owners SET status = 'banned' WHERE gh_login = 'dana-test'").run()
  const tokens = env.DB.sql.prepare('SELECT COUNT(*) AS n FROM owner_tokens').get().n
  const b = await signIn(env)
  assert.equal(b.walked.status, 403)
  assert.match(b.walked.text, /can&#39;t share here/)
  assert.equal(b.res.status, 403)
  assert.deepEqual({ ...b.body, error: '' }, { error: '', code: 'banned' })
  assert.equal(env.DB.sql.prepare('SELECT COUNT(*) AS n FROM owner_tokens').get().n, tokens, 'no token minted')
  assert.equal((await poll(env, b.code, b.poll)).status, 404, 'and none later')
})

test('allowlists: a login, or a public member of an org (asked with the user\'s own token), starts active; a pending user let in later turns active', async () => {
  const byLogin = await hostEnv({ ALLOW_LOGINS: 'someone, Dana-Test' })
  assert.equal((await signIn(byLogin)).body.status, 'active')

  const byOrg = await hostEnv({ ALLOW_ORGS: 'acme' })
  gh.setOrgs({ acme: ['dana-test'] })
  try {
    const before = gh.calls.length
    const s = await signIn(byOrg)
    assert.equal(s.body.status, 'active')
    const asked = gh.calls.slice(before).find(c => c.path === '/orgs/acme/members/dana-test')
    assert.ok(asked, 'the org was asked')
    assert.match(asked.headers.authorization, /^Bearer gho_/)
    gh.setOrgs({ acme: ['someone-else'] })
    const other = await hostEnv({ ALLOW_ORGS: 'acme' })
    assert.equal((await signIn(other)).body.status, 'pending')
    // Let in since: the next sign-in finds the pending user and turns them active.
    other.ALLOW_LOGINS = 'dana-test'
    assert.equal((await signIn(other)).body.status, 'active')
  } finally { gh.setOrgs({}) }
})

test('open: GitHub accounts 30 days old start active, younger ones wait', async () => {
  const env = await hostEnv({ SIGNUP: 'open' })
  assert.equal((await signIn(env, { ...DANA, created_at: new Date(Date.now() - 31 * DAY_MS).toISOString() })).body.status, 'active')
  const young = await hostEnv({ SIGNUP: 'open' })
  assert.equal((await signIn(young, { ...DANA, created_at: new Date(Date.now() - 5 * DAY_MS).toISOString() })).body.status, 'pending')
  const unknown = await hostEnv({ SIGNUP: 'open' })
  assert.equal((await signIn(unknown, { ...DANA, created_at: undefined })).body.status, 'pending')
})

test('quotas: 30 uploads a day (cards count), 25 live links, 75 MB, each a 507 quota before the host\'s own budget; /api/owner shows them', async () => {
  const env = await hostEnv()
  const una = await addUser(env, 'u1', 'una')
  const id = await publish(env, una)
  assert.equal((await call(env, `/api/shares/${id}/card`, { method: 'PUT', headers: bearer(una), body: JPEG() })).status, 200)
  let me = await (await call(env, '/api/owner', { headers: bearer(una) })).json()
  assert.deepEqual(me.quota, { uploads: 2, uploadsCap: 30, shares: 1, sharesCap: 25, bytes: me.quota.bytes, bytesCap: 75_000_000 })
  assert.ok(me.quota.bytes > 0)
  const quota = async (res, words) => { assert.equal(res.status, 507); const b = await res.json(); assert.equal(b.code, 'quota'); assert.match(b.error, words) }

  // Uploads: the day's 30th was the last, for pages and cards; the host's own budget comes after.
  const slot = Math.floor(Date.now() / DAY_MS)
  env.DB.sql.prepare('UPDATE caps SET n = 30 WHERE what = ? AND slot = ?').run('up:u1', slot)
  env.DB.sql.prepare("INSERT INTO budget (day, what, n) VALUES (?, 'kv_write', 900) ON CONFLICT(day, what) DO UPDATE SET n = 900").run(today())
  await quota(await put(env, una, id, 'again'), /uploaded 30 times today.*resets at 00:00 UTC/)
  await quota(await call(env, `/api/shares/${id}/card`, { method: 'PUT', headers: bearer(una), body: JPEG() }), /uploaded 30 times today/)
  env.DB.sql.prepare('UPDATE caps SET n = 0 WHERE what = ? AND slot = ?').run('up:u1', slot)
  assert.equal(await codeOf(await put(env, una, id, 'again')), 'budget', 'within the quota, the host\'s budget still stops it')
  env.DB.sql.prepare('DELETE FROM budget').run()

  // Live links: 25, expired and removed ones not counted.
  const row = env.DB.sql.prepare("INSERT INTO shares (id, owner_id, session, project_label, title, scope, version, bytes, lang, created_at, updated_at, expires_at, deleted_at) VALUES (?, 'u1', 's', 'p', 't', '[]', 1, 10, 'en', 1, 1, ?, ?)")
  for (let i = 0; i < 24; i++) row.run(`live${String(i).padStart(6, '0')}`, Date.now() + DAY_MS, null)
  row.run('expired000', Date.now() - DAY_MS, null)
  row.run('removed000', Date.now() + DAY_MS, 1)
  await quota(await call(env, '/api/shares', { method: 'POST', headers: bearer(una) }), /25 live links/)
  assert.equal((await put(env, una, id, 'an update is not a new link')).status, 200)
  env.DB.sql.prepare("DELETE FROM shares WHERE id LIKE 'live%'").run()

  // Stored: 75 MB, expired pages counted until their purge.
  env.DB.sql.prepare("UPDATE shares SET bytes = 74999990 WHERE id = 'expired000'").run()
  await quota(await put(env, una, id, 'x'.repeat(5000)), /hold at most 75 MB/)
  env.DB.sql.prepare("UPDATE shares SET purged_at = 1 WHERE id = 'expired000'").run()
  assert.equal((await put(env, una, id, 'x'.repeat(5000))).status, 200)
  me = await (await call(env, '/api/owner', { headers: bearer(una) })).json()
  assert.equal(me.quota.shares, 1)

  // The admin (signed in with GitHub, as a new share needs) is held to none of them.
  env.DB.sql.prepare("UPDATE owners SET gh_id = 1001, gh_login = 'dananz' WHERE id = 'o1'").run()
  env.DB.sql.prepare("INSERT INTO caps (what, slot, n) VALUES ('up:o1', ?, 99)").run(slot)
  await publish(env, TOKEN)
  assert.deepEqual((await (await call(env, '/api/owner', { headers: bearer(TOKEN) })).json()).quota.uploadsCap, null)
})

test('signout revokes this token only; an expired token is refused; use slides the expiry at most daily', async () => {
  const env = await hostEnv()
  const una = await addUser(env, 'u1', 'una', { expires: Date.now() + 100 * DAY_MS })
  const other = 'token-of-u1-other-mac'
  env.DB.sql.prepare("INSERT INTO owner_tokens (sha256, owner_id, device, created_at) VALUES (?, 'u1', 'M4', 1)").run(await hex(other))
  assert.equal((await call(env, '/api/owner/signout', { method: 'GET', headers: bearer(una) })).status, 405)
  // Used: the expiry slides to a year from now, in the same write as last_used_at.
  const hash = await hex(una)
  const t = () => env.DB.sql.prepare('SELECT * FROM owner_tokens WHERE sha256 = ?').get(hash)
  assert.equal((await call(env, '/api/owner', { headers: bearer(una) })).status, 200)
  const slid = t().expires_at
  assert.ok(slid > Date.now() + 364 * DAY_MS)
  assert.equal(t().last_used_at > 0, true)
  // Not again the same day.
  env.DB.sql.prepare('UPDATE owner_tokens SET expires_at = ? WHERE sha256 = ?').run(slid - 1000, hash)
  await call(env, '/api/owner', { headers: bearer(una) })
  assert.equal(t().expires_at, slid - 1000)
  const out = await call(env, '/api/owner/signout', { method: 'POST', headers: bearer(una) })
  assert.deepEqual(await out.json(), { ok: true })
  assert.equal((await call(env, '/api/owner', { headers: bearer(una) })).status, 401)
  assert.equal((await call(env, '/api/owner', { headers: bearer(other) })).status, 200, 'the other Mac stays signed in')
  // Past its expiry, a token is no token; one without an expiry (from before) never expires.
  env.DB.sql.prepare('UPDATE owner_tokens SET expires_at = ? WHERE sha256 = ?').run(Date.now() - 1, await hex(other))
  const expired = await call(env, '/api/shares', { headers: bearer(other) })
  assert.equal(expired.status, 401)
  assert.equal(await codeOf(expired), 'token')
  assert.equal((await call(env, '/api/owner', { headers: bearer(TOKEN) })).status, 200)
  assert.equal(env.DB.sql.prepare('SELECT expires_at FROM owner_tokens WHERE sha256 = ?').get(await hex(TOKEN)).expires_at, null)
})

test('ban: tokens revoked, every share a tombstone in a few queries; takedown of one share; neither on oneself', async () => {
  const env = await hostEnv()
  const bob = await addUser(env, 'u2', 'bob')
  const ids = []
  for (let i = 0; i < 3; i++) ids.push(await publish(env, bob))
  assert.equal((await call(env, `/api/shares/${ids[0]}/card`, { method: 'PUT', headers: bearer(bob), body: JPEG() })).status, 200)
  // Many more shares than one Worker invocation could take down one at a time.
  const row = env.DB.sql.prepare("INSERT INTO shares (id, owner_id, session, project_label, title, scope, version, bytes, lang, created_at, updated_at) VALUES (?, 'u2', 's', 'p', 't', '[]', 1, 10, 'en', 1, 1)")
  for (let i = 0; i < 40; i++) row.run(`many${String(i).padStart(6, '0')}`)
  comment(env, ids[1], 'hello')
  const before = env.DB.ops.n
  const res = await call(env, '/api/admin/users/bob/ban', { method: 'POST', headers: bearer(TOKEN) })
  assert.equal(res.status, 200)
  assert.equal((await res.json()).status, 'banned')
  assert.ok(env.DB.ops.n - before <= 50, `${env.DB.ops.n - before} subrequests`)
  assert.equal(env.DB.sql.prepare("SELECT COUNT(*) AS n FROM shares WHERE owner_id = 'u2' AND deleted_at IS NULL").get().n, 0)
  assert.equal(env.DB.sql.prepare("SELECT COUNT(*) AS n FROM owner_tokens WHERE owner_id = 'u2' AND revoked_at IS NULL").get().n, 0)
  assert.equal(env.DB.sql.prepare('SELECT COUNT(*) AS n FROM comments WHERE share_id = ?').get(ids[1]).n, 0)
  assert.equal((await call(env, '/api/shares', { headers: bearer(bob) })).status, 401)
  const page = await call(env, `https://${ids[0]}.prtype.dev/`)
  assert.equal(page.status, 410)
  assert.match(await page.text(), /This link was removed/)
  // The keys wait in kv_trash; the cron deletes them.
  const queued = env.DB.sql.prepare('SELECT key FROM kv_trash').all().map(r => r.key)
  assert.ok(queued.some(k => k.startsWith(`card:${ids[0]}:`)) && ids.every(id => queued.some(k => k.startsWith(`html:${id}:`))), queued.join())
  // 30 a run: two runs drain the 44 keys.
  await cron(env, Date.now())
  await cron(env, Date.now())
  assert.equal(env.DB.sql.prepare('SELECT COUNT(*) AS n FROM kv_trash').get().n, 0)
  assert.ok(![...env.KV.store.keys()].some(k => ids.some(id => k.includes(id))))
  // Takedown: anyone's share.
  const ann = await addUser(env, 'u3', 'ann')
  const a = await publish(env, ann)
  assert.equal((await call(env, `/api/admin/shares/${a}`, { method: 'DELETE', headers: bearer(TOKEN) })).status, 200)
  assert.equal((await call(env, `https://${a}.prtype.dev/`)).status, 410)
  assert.equal((await call(env, '/api/admin/shares/zzzzzzzzzz', { method: 'DELETE', headers: bearer(TOKEN) })).status, 404)
  // The admin can't ban themselves, nor another admin.
  env.DB.sql.prepare("UPDATE owners SET gh_login = 'dananz' WHERE id = 'o1'").run()
  assert.equal((await call(env, '/api/admin/users/dananz/ban', { method: 'POST', headers: bearer(TOKEN) })).status, 409)
  await addUser(env, 'u4', 'boss', { role: 'admin' })
  assert.equal((await call(env, '/api/admin/users/boss/ban', { method: 'POST', headers: bearer(TOKEN) })).status, 409)
})

test('purge: 30 days after expiry the page and card go within the delete budget; comments and the row stay; an update brings it back', async () => {
  const env = await hostEnv()
  const una = await addUser(env, 'u1', 'una')
  const old = await publish(env, una), recent = await publish(env, una)
  await call(env, `/api/shares/${old}/card`, { method: 'PUT', headers: bearer(una), body: JPEG() })
  const cid = comment(env, old, 'still here')
  env.DB.sql.prepare('UPDATE shares SET expires_at = ? WHERE id = ?').run(Date.now() - 31 * DAY_MS, old)
  env.DB.sql.prepare('UPDATE shares SET expires_at = ? WHERE id = ?').run(Date.now() - 10 * DAY_MS, recent)
  const usedBefore = (await (await call(env, '/api/owner/usage', { headers: bearer(TOKEN) })).json()).kv_bytes
  const before = env.DB.ops.n
  await cron(env, Date.now())
  assert.ok(env.DB.ops.n - before <= 50, `${env.DB.ops.n - before} subrequests`)
  const row = env.DB.sql.prepare('SELECT * FROM shares WHERE id = ?').get(old)
  assert.ok(row.purged_at > 0)
  assert.equal(row.card_key, null)
  assert.equal(row.deleted_at, null)
  assert.ok(![...env.KV.store.keys()].some(k => k.includes(old)), 'the page and card are gone from KV')
  assert.ok([...env.KV.store.keys()].some(k => k.startsWith(`html:${recent}:`)), 'expired 10 days: kept')
  assert.equal(env.DB.sql.prepare('SELECT COUNT(*) AS n FROM comments WHERE id = ?').get(cid).n, 1)
  assert.equal((await call(env, `https://${old}.prtype.dev/`)).status, 410)
  assert.ok((await (await call(env, '/api/owner/usage', { headers: bearer(TOKEN) })).json()).kv_bytes < usedBefore, 'a purged page no longer counts as stored')
  // Run again: nothing more to do.
  await cron(env, Date.now())
  assert.equal(env.DB.sql.prepare('SELECT COUNT(*) AS n FROM kv_trash').get().n, 0)
  // The deletes wait for a day with budget, as every other delete does.
  const late = await publish(env, una)
  env.DB.sql.prepare('UPDATE shares SET expires_at = ? WHERE id = ?').run(Date.now() - 40 * DAY_MS, late)
  env.DB.sql.prepare("INSERT INTO budget (day, what, n) VALUES (?, 'kv_delete', 800) ON CONFLICT(day, what) DO UPDATE SET n = 800").run(today())
  await cron(env, Date.now())
  assert.ok(env.DB.sql.prepare('SELECT purged_at FROM shares WHERE id = ?').get(late).purged_at > 0)
  assert.ok([...env.KV.store.keys()].some(k => k.startsWith(`html:${late}:`)), 'past the ceiling the key waits')
  assert.equal(env.DB.sql.prepare('SELECT COUNT(*) AS n FROM kv_trash').get().n, 1)
  // An update uploads the page again and renews the link.
  const again = await put(env, una, old, 'back')
  assert.equal(again.status, 200)
  assert.equal(env.DB.sql.prepare('SELECT purged_at FROM shares WHERE id = ?').get(old).purged_at, null)
  assert.equal((await call(env, `https://${old}.prtype.dev/`)).status, 200)
})

test('report: from the share\'s own origin, signed in or not, 5 an hour per IP; the admin lists them', async () => {
  const env = await hostEnv()
  const una = await addUser(env, 'u1', 'una')
  const id = await publish(env, una)
  const report = (body, more = {}) => call(env, `https://${id}.prtype.dev/api/report`, { method: 'POST', headers: { ...XP, ...JSONH, 'cf-connecting-ip': '203.0.113.5', ...more }, body: JSON.stringify(body) })
  assert.equal((await report({ reason: '' })).status, 400)
  assert.equal((await report({ reason: 'x'.repeat(501) })).status, 400)
  assert.equal((await report({ reason: 'phishing' }, { 'x-proto': '' })).status, 400, 'X-Proto, as every viewer call')
  // Signed in on the link: the report names who sent it.
  env.DB.sql.prepare("INSERT INTO viewers (gh_id, login, name, avatar, seen_at) VALUES (77, 'reporter', 'R', NULL, 1)").run()
  const cookie = `__Host-v=${await sign(KEY, 'v', { gh: 77, share: id, exp: Date.now() + 60_000 })}`
  const ok = await report({ reason: 'phishing' }, { cookie })
  assert.equal(ok.status, 200)
  assert.deepEqual(await ok.json(), { ok: true })
  for (let i = 0; i < 4; i++) assert.equal((await report({ reason: `spam ${i}` })).status, 200)
  const capped = await report({ reason: 'one more' })
  assert.equal(capped.status, 429)
  assert.equal(await codeOf(capped), 'rate')
  const list = await (await call(env, '/api/admin/reports', { headers: bearer(TOKEN) })).json()
  assert.equal(list.length, 5)
  const first = list.find(r => r.reason === 'phishing')
  assert.deepEqual(first.share, { id, title: 'Pricing', owner: 'una', removed: false })
  assert.equal(first.reporter, 'reporter')
  // A removed link takes no reports.
  await call(env, `/api/admin/shares/${id}`, { method: 'DELETE', headers: bearer(TOKEN) })
  assert.equal((await report({ reason: 'late' }, { 'cf-connecting-ip': '198.51.100.3' })).status, 410)
})

test('one origin per share: <id>.prtype.dev serves it, /s/<id>/<rest> moves there with its query, health speaks API 2', async () => {
  const env = await hostEnv()
  const id = await publish(env, await addUser(env, 'u1', 'una'))
  assert.equal((await call(env, `https://${id}.prtype.dev/`)).status, 200)
  for (const [path, to] of [[`/s/${id}/`, '/'], [`/s/${id}`, '/'], [`/s/${id}/card.jpg?v=abc`, '/card.jpg?v=abc'], [`/s/${id}/?v=2`, '/?v=2']]) {
    const r = await call(env, path, { redirect: 'manual' })
    assert.equal(r.status, 301, path)
    assert.equal(r.headers.get('location'), `https://${id}.prtype.dev${to}`, path)
    assert.equal(r.headers.get('x-robots-tag'), 'noindex')
  }
  // The short link goes to the share's own origin.
  assert.ok((await (await call(env, `/${id}`)).text()).includes(`location.replace("https://${id}.prtype.dev/" + location.hash)`))
  const health = await call(env, '/_health')
  assert.equal(health.headers.get('x-proto-api'), '2')
  assert.equal(health.headers.get('x-proto-api-min'), '2')
  // On its own https origin a share reads only __Host-v: a plain v could be set by a sibling share.
  env.DB.sql.prepare("INSERT INTO viewers (gh_id, login, name, avatar, seen_at) VALUES (77, 'viewer', 'V', NULL, 1)").run()
  const value = await sign(KEY, 'v', { gh: 77, share: id, exp: Date.now() + 60_000 })
  const me = async cookie => (await call(env, `https://${id}.prtype.dev/api/me`, { headers: { ...XP, cookie } })).json()
  assert.equal(await me(`v=${value}`), null)
  assert.equal((await me(`__Host-v=${value}`)).login, 'viewer')
  // A viewer's sign-in from the share sets __Host- cookies only.
  const begin = await call(env, `https://${id}.prtype.dev/_in/start?back=/`, { redirect: 'manual' })
  assert.ok(begin.headers.getSetCookie().every(c => c.startsWith('__Host-')), begin.headers.getSetCookie().join())
  const apex = await call(env, begin.headers.get('location'), { redirect: 'manual' })
  assert.ok(apex.headers.getSetCookie().every(c => c.startsWith('__Host-') && !/domain=/i.test(c)), apex.headers.getSetCookie().join())
  // Path mode, where set, still serves the path form.
  const paths = await hostEnv({ PATH_MODE: '1' })
  const p = await publish(paths, await addUser(paths, 'u1', 'una'))
  assert.equal((await call(paths, `/s/${p}/`)).status, 200)
})

test('the online config: on the domain, path mode off and exactly the wildcard route; anything else refused', () => {
  const opts = { accountId: 'a', kvId: 'k', dbId: 'd', hostVersion: 'v' }
  const domain = onlineConfig({ ...opts, base: 'prtype.dev', signin: true, card: true, subdomains: true })
  assert.equal(onlineConfig({ ...opts, base: 'prtype.dev', signin: true, card: true }).vars.PATH_MODE, '1', 'only when asked')
  assert.equal(domain.vars.PATH_MODE, '0')
  assert.deepEqual(domain.routes, [{ pattern: '*.prtype.dev/*', zone_name: 'prtype.dev' }])
  assert.doesNotThrow(() => assertFreeConfig(domain))
  const workers = onlineConfig({ ...opts, base: 'x.workers.dev' })
  assert.equal(workers.vars.PATH_MODE, '1')
  assert.equal(workers.routes, undefined)
  for (const routes of [[{ pattern: 'prtype.dev', custom_domain: true }], [{ pattern: '*.other.dev/*', zone_name: 'other.dev' }], [...domain.routes, { pattern: 'prtype.dev/*', zone_name: 'prtype.dev' }], [{ pattern: '*.prtype.dev/*', zone_name: 'prtype.dev', custom_domain: true }]]) {
    assert.throws(() => assertFreeConfig({ ...domain, routes }), /a free host doesn't use/, JSON.stringify(routes))
  }
  assert.throws(() => assertFreeConfig({ ...workers, routes: domain.routes }), /a free host doesn't use/, 'the route names BASE')
})

// ---------- the review's findings: counted before spent, at once ----------

const createId = async (env, token) => (await (await call(env, '/api/shares', { method: 'POST', headers: bearer(token) })).json()).id
// A page that gzip can't shrink, of about `n` bytes on the wire.
const noise = n => gzipSync(randomBytes(n))
const putRaw = (env, token, id, body) => call(env, `/api/shares/${id}`, { method: 'PUT', headers: { ...bearer(token), 'x-share-meta': meta() }, body })

test('new ids count: 60 a day per user, then 507 quota; sign-in starts stop with the host\'s D1 day', async () => {
  const env = await hostEnv()
  const una = await addUser(env, 'u1', 'una')
  for (let i = 0; i < 60; i++) assert.equal((await call(env, '/api/shares', { method: 'POST', headers: bearer(una) })).status, 200, `create ${i + 1}`)
  const capped = await call(env, '/api/shares', { method: 'POST', headers: bearer(una) })
  assert.equal(capped.status, 507)
  const b = await capped.json()
  assert.equal(b.code, 'quota')
  assert.match(b.error, /60 new links today/)
  assert.equal(env.DB.sql.prepare("SELECT COUNT(*) AS n FROM ids").get().n, 60, 'the refused create made no row')
  // Many addresses get past the per-IP count; the host's own day does not.
  env.DB.sql.prepare("INSERT INTO budget (day, what, n) VALUES (?, 'd1_write', 89995) ON CONFLICT(day, what) DO UPDATE SET n = 89995").run(today())
  const r = await start(env, {}, '2001:db8::1')
  assert.equal(r.status, 503)
  assert.equal(await codeOf(r), 'budget')
})

test('uploads at once: the day\'s 30, a user\'s 75 MB, the live-link cap and the host\'s stored bytes all hold', async () => {
  const env = await hostEnv()
  const una = await addUser(env, 'u1', 'una')
  const ids = []
  for (let i = 0; i < 10; i++) ids.push(await createId(env, una))
  // Bytes: ten 9 MB pages at once, 75 MB of room: eight land, and what lands fits.
  const body = noise(9_000_000)
  const many = await Promise.all(ids.map(id => putRaw(env, una, id, body)))
  assert.deepEqual(many.map(r => r.status).sort(), [200, 200, 200, 200, 200, 200, 200, 200, 507, 507])
  assert.ok(env.DB.sql.prepare("SELECT SUM(bytes) AS n FROM shares WHERE owner_id = 'u1'").get().n <= 75_000_000)
  assert.equal(env.DB.sql.prepare("SELECT COALESCE(SUM(n), 0) AS n FROM caps WHERE what = 'held:u1'").get().n, 0, 'every hold let go')
  // A refused upload gave its count back: 8 uploads today.
  const slot = Math.floor(Date.now() / DAY_MS)
  assert.equal(env.DB.sql.prepare("SELECT n FROM caps WHERE what = 'up:u1' AND slot = ?").get(slot).n, 8)
  // Uploads: at 25 of 30, ten cards at once: five land.
  env.DB.sql.prepare("UPDATE caps SET n = 25 WHERE what = 'up:u1' AND slot = ?").run(slot)
  const cards = await Promise.all(Array.from({ length: 10 }, () => call(env, `/api/shares/${ids[0]}/card`, { method: 'PUT', headers: bearer(una), body: JPEG() })))
  assert.equal(cards.filter(r => r.status === 200 || r.status === 409).length, 5, cards.map(r => r.status).join())
  assert.equal(cards.filter(r => r.status === 507).length, 5)
  assert.ok(env.DB.sql.prepare("SELECT n FROM caps WHERE what = 'up:u1' AND slot = ?").get(slot).n <= 30)

  // Live links: at 23 of 25, five new shares at once: two land.
  const bob = await addUser(env, 'u2', 'bob')
  const row = env.DB.sql.prepare("INSERT INTO shares (id, owner_id, session, project_label, title, scope, version, bytes, lang, created_at, updated_at, expires_at) VALUES (?, 'u2', 's', 'p', 't', '[]', 1, 10, 'en', 1, 1, ?)")
  for (let i = 0; i < 23; i++) row.run(`bob${String(i).padStart(7, '0')}`, Date.now() + DAY_MS)
  const fresh = []
  for (let i = 0; i < 5; i++) { env.DB.sql.prepare("INSERT INTO ids (id, kind) VALUES (?, 'share')").run(`new${i}aaaaaa`); fresh.push(`new${i}aaaaaa`) }
  const news = await Promise.all(fresh.map(id => put(env, bob, id)))
  assert.deepEqual(news.map(r => r.status).sort(), [200, 200, 507, 507, 507])
  assert.equal(env.DB.sql.prepare("SELECT COUNT(*) AS n FROM shares WHERE owner_id = 'u2'").get().n, 25)
  assert.ok(![...env.KV.store.keys()].some(k => fresh.some(id => k.startsWith(`html:${id}:`)) && !env.DB.sql.prepare('SELECT 1 FROM shares WHERE html_key = ?').get(k)), 'no page left behind by a refused insert')

  // The host's stored bytes (the admin, held to no quota of their own): 20 MB of room, five 9 MB at once.
  env.DB.sql.prepare("UPDATE owners SET gh_id = 1001, gh_login = 'dananz' WHERE id = 'o1'").run()
  env.DB.sql.prepare("INSERT INTO shares (id, owner_id, session, project_label, title, scope, version, bytes, lang, created_at, updated_at) VALUES ('bigbigbig0', 'o1', 's', 'p', 'Big', '[]', 1, ?, 'en', 1, 1)")
    .run(900_000_000 - 20_000_000 - Number(env.DB.sql.prepare('SELECT SUM(bytes) AS n FROM shares WHERE deleted_at IS NULL').get().n))
  const adminIds = []
  for (let i = 0; i < 5; i++) adminIds.push(await createId(env, TOKEN))
  const big = await Promise.all(adminIds.map(id => putRaw(env, TOKEN, id, body)))
  assert.deepEqual(big.map(r => r.status).sort(), [200, 200, 507, 507, 507])
  assert.ok(env.DB.sql.prepare('SELECT SUM(bytes) AS n FROM shares WHERE deleted_at IS NULL').get().n <= 900_000_000)
  assert.equal(env.DB.sql.prepare("SELECT COALESCE(SUM(n), 0) AS n FROM caps WHERE what = 'held:all'").get().n, 0)
})

test('approve and ban by login refuse a login two users carry; gh:<id> names one', async () => {
  const env = await hostEnv()
  await addUser(env, 'u1', 'sam', { status: 'pending', gh_id: 501 })
  await addUser(env, 'u2', 'Sam', { status: 'pending', gh_id: 502 })
  const two = await call(env, '/api/admin/users/sam/approve', { method: 'POST', headers: bearer(TOKEN) })
  assert.equal(two.status, 409)
  const b = await two.json()
  assert.equal(b.code, 'ambiguous')
  assert.match(b.error, /gh:<id>/)
  assert.equal((await call(env, '/api/admin/users/sam/ban', { method: 'POST', headers: bearer(TOKEN) })).status, 409)
  assert.equal(env.DB.sql.prepare("SELECT COUNT(*) AS n FROM owners WHERE status = 'pending'").get().n, 2, 'nobody changed')
  const one = await call(env, '/api/admin/users/gh:502/approve', { method: 'POST', headers: bearer(TOKEN) })
  assert.equal(one.status, 200)
  assert.deepEqual([(await one.json()).ghId, env.DB.sql.prepare("SELECT status FROM owners WHERE id = 'u2'").get().status], [502, 'active'])
  assert.equal((await call(env, '/api/admin/users/gh:999/approve', { method: 'POST', headers: bearer(TOKEN) })).status, 404)
  assert.ok((await (await call(env, '/api/admin/users', { headers: bearer(TOKEN) })).json()).every(u => 'ghId' in u))
})

test('purge picks its batch once: a share renewed between the two writes keeps its page, and none is purged unqueued', async () => {
  const env = await hostEnv()
  await addUser(env, 'u1', 'una')
  const row = env.DB.sql.prepare("INSERT INTO shares (id, owner_id, session, project_label, title, scope, version, bytes, lang, created_at, updated_at, expires_at, html_key) VALUES (?, 'u1', 's', 'p', 't', '[]', 1, 10, 'en', 1, 1, ?, ?)")
  // 51 due: the batch is the 50 that expired first.
  for (let i = 0; i < 51; i++) row.run(`due${String(i).padStart(7, '0')}`, Date.now() - (40 + 51 - i) * DAY_MS, `html:due${i}:1:k`)
  const renewed = 'due0000003'
  // Between the pick and the writes, the owner updates one of the batch.
  const prepare = env.DB.prepare
  env.DB.prepare = q => {
    const st = prepare(q)
    if (!/^SELECT id FROM shares WHERE deleted_at IS NULL AND purged_at IS NULL/.test(q)) return st
    const wrap = s => ({ ...s, bind: (...a) => wrap(s.bind(...a)), all: async () => { const r = await s.all(); env.DB.sql.prepare("UPDATE shares SET expires_at = ?, html_key = 'html:renewed:2:k' WHERE id = ?").run(Date.now() + DAY_MS, renewed); return r } })
    return wrap(st)
  }
  await purge(env, Date.now())
  env.DB.prepare = prepare
  const purged = env.DB.sql.prepare('SELECT id, html_key FROM shares WHERE purged_at IS NOT NULL').all()
  const queued = new Set(env.DB.sql.prepare('SELECT key FROM kv_trash').all().map(r => r.key))
  assert.equal(purged.length, 49, 'the batch of 50, less the renewed one; the 51st waits for the next run')
  assert.ok(purged.every(p => queued.has(p.html_key)), 'every purged share had its key queued')
  assert.equal(env.DB.sql.prepare('SELECT purged_at FROM shares WHERE id = ?').get(renewed).purged_at, null)
  assert.ok(!queued.has('html:renewed:2:k'), 'the renewed page is not queued for deletion')
  assert.equal(env.DB.sql.prepare("SELECT purged_at FROM shares WHERE id = 'due0000050'").get().purged_at, null)
})

// ---------- the schema: 0006 on top of 0001-0005, schema.sql, and upgrade() agree ----------

const MIGRATIONS = new URL('../host/migrations/', import.meta.url)
const migrations = () => readdirSync(MIGRATIONS).filter(f => /^\d{4}_[a-z0-9_]+\.sql$/.test(f)).sort().map(f => [f, readFileSync(new URL(f, MIGRATIONS), 'utf8')])
const d1Of = sql => {
  const stmt = (query, args = []) => ({
    bind: (...a) => stmt(query, a),
    first: async () => sql.prepare(query).get(...args) ?? null,
    all: async () => ({ results: sql.prepare(query).all(...args) }),
    run: async () => { const r = sql.prepare(query).run(...args); return { success: true, meta: { changes: Number(r.changes) } } },
  })
  return { sql, prepare: q => stmt(q) }
}
// As share-unit-checks' shapeOf: columns by name, indexes with their columns, uniqueness and whether partial.
function shapeOf(sql) {
  const out = {}
  for (const { name } of sql.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != 'd1_migrations' ORDER BY name").all()) {
    const cols = sql.prepare(`PRAGMA table_info(${name})`).all().map(c => [c.name, c.type, c.notnull, c.dflt_value, c.pk].join(' ')).sort()
    const idx = sql.prepare(`PRAGMA index_list(${name})`).all().filter(i => i.origin === 'c').map(i => `${i.name} ${i.unique} ${i.partial} ${sql.prepare(`PRAGMA index_info(${i.name})`).all().map(c => c.name).join(',')}`).sort()
    out[name] = { cols, idx }
  }
  return out
}
// A local database: schema.sql, then the Worker's upgrade() (which adds the owners_gh index).
const SCHEMA = readFileSync(new URL('../host/schema.sql', import.meta.url), 'utf8')
const fromSchema = async () => { const sql = new DatabaseSync(':memory:'); sql.exec(SCHEMA); await upgrade(d1Of(sql)); return sql }
// A deployed database as it was before 0006: one owner named by setup, signed in, with a share.
function before0006() {
  const sql = new DatabaseSync(':memory:')
  for (const [f, text] of migrations()) if (f < '0006') sql.exec(text)
  sql.exec(`INSERT INTO owners (id, name, created_at, gh_id, gh_login) VALUES ('o_tomer', 'Tomer', 1, 1001, 'dananz'), ('o_other', 'Other', 2, NULL, NULL);
    INSERT INTO owner_tokens (sha256, owner_id, device, created_at) VALUES ('h1', 'o_tomer', 'Mac Studio', 1);
    INSERT INTO meta (k, v) VALUES ('owner_id', 'o_tomer');`)
  return sql
}

test('migration 0006 on top of 0001-0005: the schema.sql end state; the owner setup named becomes admin, everyone stays active', async () => {
  const list = migrations()
  assert.equal(list[5]?.[0], '0006_users.sql')
  const sql = before0006()
  sql.exec(list[5][1])
  assert.deepEqual(shapeOf(sql), shapeOf(await fromSchema()))
  assert.deepEqual(sql.prepare('SELECT id, role, status FROM owners ORDER BY id').all().map(r => ({ ...r })), [{ id: 'o_other', role: 'user', status: 'active' }, { id: 'o_tomer', role: 'admin', status: 'active' }])
  assert.equal(sql.prepare("SELECT expires_at FROM owner_tokens WHERE sha256 = 'h1'").get().expires_at, null, 'existing tokens never expire')
  // One user per GitHub account; many owners may still have none.
  assert.throws(() => sql.exec("INSERT INTO owners (id, name, created_at, gh_id) VALUES ('o_dup', 'Dup', 3, 1001)"), /UNIQUE/)
  sql.exec("INSERT INTO owners (id, name, created_at) VALUES ('o_none', 'None', 3)")
  // Run again: it fails on its first column, changing nothing.
  const shape = JSON.stringify(shapeOf(sql))
  assert.throws(() => sql.exec(list[5][1]), /duplicate column/i)
  assert.equal(JSON.stringify(shapeOf(sql)), shape)
})

test('a local database from before 0006 plus upgrade() makes what schema.sql makes, the setup owner admin', async () => {
  const sql = before0006()
  await upgrade(d1Of(sql))
  await upgrade(d1Of(sql))
  assert.deepEqual(shapeOf(sql), shapeOf(await fromSchema()))
  assert.equal(sql.prepare("SELECT role FROM owners WHERE id = 'o_tomer'").get().role, 'admin')
  assert.equal(sql.prepare("SELECT role FROM owners WHERE id = 'o_other'").get().role, 'user')
})

test('schema.sql runs on a local database from before 0004 (owners without gh_id); upgrade() then completes it', async () => {
  const sql = new DatabaseSync(':memory:')
  sql.exec(readFileSync(new URL('0001_initial.sql', MIGRATIONS), 'utf8'))
  sql.exec("INSERT INTO owners (id, name, created_at) VALUES ('o1', 'Dananz', 1)")
  assert.doesNotThrow(() => sql.exec(SCHEMA))
  await upgrade(d1Of(sql))
  assert.deepEqual(shapeOf(sql), shapeOf(await fromSchema()))
})
