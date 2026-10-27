// Unit checks for the Share popover's host and owner side (plan 2026-10-27-share-popover): the owner's
// GitHub sign-in through a 10-minute claim link, the gate on new links, the message for viewers and
// the update's note, presence and its throttle, the owner list's views and faces, the cron's cleanup,
// the session server's owner and signin routes, and which variants changed since a link's version.
// The host is the real Worker in memory (node:sqlite, a Map); GitHub is the fake in fake-github.mjs.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import worker from '../host/worker.mjs'
import { sign } from '../host/lib/cookies.mjs'
import { cron } from '../host/lib/cron.mjs'
import { today } from '../host/lib/budget.mjs'
import { startFakeGitHub, signOwnerIn, walkClaim } from './fake-github.mjs'
import { client, forget, writeShares } from '../app/share/owner.mjs'
import { changedVariants, hashOf, messageOf } from '../app/share/publish.mjs'
import { shareServer } from '../app/share/routes.mjs'

const TOKEN = 'owner-token-for-popover-checks'
const KEY = 'viewer-key-for-popover-checks'
const ORIGIN = 'https://prtype.dev'
const auth = { authorization: `Bearer ${TOKEN}` }
const XP = { 'x-proto': '1' }
const hex = async s => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map(b => b.toString(16).padStart(2, '0')).join('')

let gh
before(async () => { gh = await startFakeGitHub() })
after(async () => { await gh.close() })

// prtype.dev as setup leaves it: path mode, sign-in on, one owner (not yet signed in with GitHub).
async function makeEnv(extra = {}) {
  const sql = new DatabaseSync(':memory:')
  sql.exec(readFileSync(new URL('../host/schema.sql', import.meta.url), 'utf8'))
  sql.prepare('INSERT INTO owners (id, name, created_at) VALUES (?, ?, ?)').run('o1', 'Dananz', 1)
  sql.prepare('INSERT INTO owner_tokens (sha256, owner_id, device, created_at) VALUES (?, ?, ?, ?)').run(await hex(TOKEN), 'o1', 'test', 1)
  sql.prepare("INSERT INTO meta (k, v) VALUES ('owner_id', 'o1')").run()
  const store = new Map()
  const KV = {
    store,
    async get(key, type) { const v = store.get(key); if (v === undefined) return null; return type === 'arrayBuffer' ? v.slice(0) : new TextDecoder().decode(v) },
    async put(key, value) { store.set(key, value instanceof ArrayBuffer ? value.slice(0) : new Uint8Array(value).slice().buffer) },
    async delete(key) { store.delete(key) },
  }
  const stmt = (query, args = []) => ({
    bind: (...a) => stmt(query, a),
    first: async () => sql.prepare(query).get(...args) ?? null,
    all: async () => ({ results: sql.prepare(query).all(...args) }),
    run: async () => { const r = sql.prepare(query).run(...args); return { success: true, meta: { changes: Number(r.changes), rows_written: Number(r.changes) } } },
  })
  const DB = { sql, prepare: q => stmt(q) }
  return {
    KV, DB, BASE: 'prtype.dev', PATH_MODE: '1', SIGNIN: '1',
    GITHUB_CLIENT_ID: gh.clientId, GITHUB_CLIENT_SECRET: gh.clientSecret, VIEWER_KEY: KEY, GITHUB_OAUTH: gh.url, GITHUB_API: gh.url,
    ...extra,
  }
}
const hostFetch = env => (url, init) => worker.fetch(new Request(url, init), env)
const call = (env, path, init) => hostFetch(env)(`${ORIGIN}${path}`, init)
const metaOf = (o = {}) => Buffer.from(JSON.stringify({ title: 'Pricing', session: 's1', projectLabel: 'shop', scope: { protos: [{ id: 'pricing', variants: ['A', 'B'] }], start: 'pricing/A' }, lang: 'en', ...o })).toString('base64url')
const put = (env, id, m = metaOf(), html = '<!doctype html><p>hi') => call(env, `/api/shares/${id}`, { method: 'PUT', headers: { ...auth, 'x-share-meta': m }, body: gzipSync(html) })
async function publish(env, m) {
  const created = await call(env, '/api/shares', { method: 'POST', headers: auth })
  assert.equal(created.status, 200, await created.clone().text())
  const { id } = await created.json()
  const res = await put(env, id, m)
  assert.equal(res.status, 200, await res.clone().text())
  return id
}
const state = async (env, id) => (await call(env, `/s/${id}/api/state`, { headers: XP })).json()
const ownerRow = env => ({ ...env.DB.sql.prepare('SELECT gh_id, gh_login, gh_name, gh_avatar FROM owners WHERE id = ?').get('o1') })
const signedIn = env => env.DB.sql.prepare('UPDATE owners SET gh_id = 4242, gh_login = ?, gh_name = ?, gh_avatar = ? WHERE id = ?').run('dana-test', 'Dana', 'https://avatars.githubusercontent.com/u/4242', 'o1')
const addViewer = (env, gh_id, login) => env.DB.sql.prepare('INSERT OR REPLACE INTO viewers (gh_id, login, name, avatar, seen_at) VALUES (?, ?, ?, ?, ?)').run(gh_id, login, login.toUpperCase(), `https://avatars.example/${gh_id}`, 1)
const cookieOf = async (id, gh_id) => `v=${await sign(KEY, 'v', { gh: gh_id, share: id, exp: Date.now() + 60_000 })}`

test('migration 0004 is the owner identity, the message and presence', () => {
  const text = readFileSync(new URL('../host/migrations/0004_owner_presence.sql', import.meta.url), 'utf8')
  for (const col of ['gh_id', 'gh_login', 'gh_name', 'gh_avatar']) assert.match(text, new RegExp(`ALTER TABLE owners ADD COLUMN ${col}\\b`))
  assert.match(text, /ALTER TABLE shares ADD COLUMN message TEXT/)
  assert.match(text, /CREATE TABLE IF NOT EXISTS presence/)
})

test('the gate: no new link before the owner signs in with GitHub; the claim link signs them in', async () => {
  const env = await makeEnv()
  // Signed out: GET /api/owner says so, and a new share is refused at create and at upload alike.
  assert.deepEqual(await (await call(env, '/api/owner', { headers: auth })).json(), { login: null, name: null, avatar: null, signin: true })
  const refused = await call(env, '/api/shares', { method: 'POST', headers: auth })
  assert.equal(refused.status, 403)
  assert.equal((await refused.json()).code, 'sign_in')
  env.DB.sql.prepare("INSERT INTO ids (id, kind) VALUES ('k3x9p2abcd', 'share')").run()
  const skipped = await put(env, 'k3x9p2abcd')
  assert.equal(skipped.status, 403, 'a reserved id does not skip the gate')
  assert.equal((await skipped.json()).code, 'sign_in')
  assert.equal(env.KV.store.size, 0)
  // Only the owner token gets a claim link.
  assert.equal((await call(env, '/api/owner/claim', { method: 'POST' })).status, 401)
  assert.equal((await call(env, '/api/owner/claim', { method: 'GET', headers: auth })).status, 405)
  // The claim, end to end against the fake GitHub: the callback ends on a plain page.
  const done = await signOwnerIn(ORIGIN, TOKEN, { fetch: hostFetch(env) })
  assert.match(done.url, /^https:\/\/prtype\.dev\/auth\/github\?claim=[\w-]+\.[\w-]+$/)
  assert.equal(done.status, 200, done.text)
  assert.match(done.text, /Signed in as dana-test/)
  assert.match(done.text, /You can close this tab/)
  assert.deepEqual(ownerRow(env), { gh_id: 4242, gh_login: 'dana-test', gh_name: 'Dana', gh_avatar: 'https://avatars.githubusercontent.com/u/4242' })
  assert.deepEqual(await (await call(env, '/api/owner', { headers: auth })).json(), { login: 'dana-test', name: 'Dana', avatar: 'https://avatars.githubusercontent.com/u/4242', signin: true })
  // Signed in: a new link goes out.
  const id = await publish(env)
  // Signed out again (another Mac, an old database): updating and removing existing links still work.
  env.DB.sql.prepare('UPDATE owners SET gh_id = NULL, gh_login = NULL, gh_name = NULL, gh_avatar = NULL').run()
  assert.equal((await put(env, id)).status, 200, 'an update needs no sign-in')
  assert.equal((await call(env, `/api/shares/${id}`, { method: 'DELETE', headers: auth })).status, 200, 'a removal needs no sign-in')
})

test('a claim link works once, for 10 minutes, as a claim only, and for no one without the owner token', async () => {
  const env = await makeEnv()
  const { url } = await (await call(env, '/api/owner/claim', { method: 'POST', headers: auth })).json()
  // Walked twice: the second ends on the claim's failure page, the owner row as the first left it.
  assert.equal((await walkClaim(url, { fetch: hostFetch(env) })).status, 200)
  gh.setUser({ id: 9999, login: 'mallory', name: 'M', avatar_url: 'https://avatars.githubusercontent.com/u/9999' })
  try {
    const again = await walkClaim(url, { fetch: hostFetch(env) })
    assert.equal(again.status, 400)
    assert.match(again.text, /works once, for 10 minutes/)
    assert.equal(ownerRow(env).gh_login, 'dana-test')
    // Expired, tampered, signed for another purpose, or naming no owner here: refused before GitHub.
    const claimOf = async (p, purpose = 'claim') => `${ORIGIN}/auth/github?claim=${await sign(KEY, purpose, { owner: 'o1', cn: 'n'.repeat(22), exp: Date.now() + 60_000, ...p })}`
    for (const bad of [
      await claimOf({ exp: Date.now() - 1 }),
      await claimOf({}, 'state'),
      await claimOf({}, 'ticket'),
      await claimOf({ owner: 'o2' }),
      url.replace(/.$/, c => c === 'A' ? 'B' : 'A'),
      `${ORIGIN}/auth/github?claim=junk`,
    ]) {
      const r = await walkClaim(bad, { fetch: hostFetch(env) })
      assert.equal(r.status, 400, bad)
      assert.equal(r.state, null, `${bad} reached GitHub`)
    }
    // A state for a claim whose own 10 minutes ran out while at GitHub is refused at the callback.
    const sc = '__Host-gh'
    const st = await sign(KEY, 'state', { n: 'nnnnnnnnnnnnnnnnnnnnnn', v: 'x', claim: 'o1', cn: 'late', cexp: Date.now() - 1, exp: Date.now() + 60_000 })
    const late = await call(env, '/auth/github/callback?code=c&state=nnnnnnnnnnnnnnnnnnnnnn', { headers: { cookie: `${sc}=${st}` } })
    assert.equal(late.status, 400)
    assert.equal(ownerRow(env).gh_login, 'dana-test')
    // A GitHub refusal on a claim ends on the failure page, not on a share.
    const declined = await call(env, '/auth/github/callback?error=access_denied&state=nnnnnnnnnnnnnnnnnnnnnn', { headers: { cookie: `${sc}=${st}` } })
    assert.equal(declined.status, 400)
  } finally {
    gh.setUser({ id: 4242, login: 'dana-test', name: 'Dana', avatar_url: 'https://avatars.githubusercontent.com/u/4242' })
  }
})

test('a host that cannot run sign-in neither asks for it nor hands out claims', async () => {
  const env = await makeEnv({ SIGNIN: '0' })
  const off = await call(env, '/api/owner/claim', { method: 'POST', headers: auth })
  assert.equal(off.status, 409)
  assert.equal((await off.json()).code, 'signin_off')
  assert.equal((await (await call(env, '/api/owner', { headers: auth })).json()).signin, false)
  await publish(env)
})

test('the message for viewers: set on publish, kept, changed or cleared on update; the note is the update\'s', async () => {
  const env = await makeEnv()
  signedIn(env)
  const id = await publish(env, metaOf({ message: '  Which one would you pick?  ' }))
  let s = await state(env, id)
  assert.deepEqual({ message: s.message, note: s.note, owner: s.owner, version: s.version }, {
    message: 'Which one would you pick?', note: null, version: 1,
    owner: { login: 'dana-test', name: 'Dana', avatar: 'https://avatars.githubusercontent.com/u/4242' },
  })
  assert.equal((await put(env, id, metaOf({ note: 'Bigger toggle' }))).status, 200)
  s = await state(env, id)
  assert.deepEqual([s.version, s.message, s.note], [2, 'Which one would you pick?', 'Bigger toggle'], 'absent keeps the message')
  assert.equal((await put(env, id, metaOf({ message: 'Is anything confusing?' }))).status, 200)
  s = await state(env, id)
  assert.deepEqual([s.version, s.message, s.note], [3, 'Is anything confusing?', null], 'a new message; no note this time')
  assert.equal((await put(env, id, metaOf({ message: null }))).status, 200)
  assert.equal((await state(env, id)).message, null, 'null clears it')
  for (const bad of ['x'.repeat(281), 42, { a: 1 }]) {
    const r = await put(env, id, metaOf({ message: bad }))
    assert.equal(r.status, 400, JSON.stringify(bad))
  }
  assert.equal((await put(env, id, metaOf({ note: 'n'.repeat(301) }))).status, 400)
  // The owner's list carries it too; a link of an owner not signed in has owner null.
  assert.equal((await (await call(env, '/api/shares', { headers: auth })).json())[0].message, null)
  env.DB.sql.prepare('UPDATE owners SET gh_login = NULL').run()
  assert.equal((await state(env, id)).owner, null)
})

test('presence: signed-in viewers only, at most one write per 50 s, metered, quiet when the budget is used up', async () => {
  const env = await makeEnv()
  signedIn(env)
  const id = await publish(env)
  addViewer(env, 7, 'ana')
  const here = (cookie, body = { route: 'pricing/A' }) => call(env, `/s/${id}/api/here`, { method: 'POST', headers: { ...XP, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) })
  const row = () => env.DB.sql.prepare('SELECT route, at FROM presence WHERE share_id = ? AND gh_id = 7').get(id)
  const writes = () => env.DB.sql.prepare("SELECT n FROM budget WHERE day = ? AND what = 'd1_write'").get(today())?.n ?? 0
  const out = await here(null)
  assert.equal(out.status, 401)
  assert.equal((await out.json()).code, 'signin')
  assert.equal((await here(await cookieOf('zzzzzzzzzz', 7))).status, 401, 'a cookie for another share is nobody here')
  assert.equal((await call(env, `/s/${id}/api/here`, { headers: XP })).status, 405)
  const jar = await cookieOf(id, 7)
  assert.equal((await here(jar, { route: 'x'.repeat(201) })).status, 400)
  const w0 = writes()
  assert.equal((await here(jar)).status, 204)
  const first = row()
  assert.equal(first.route, 'pricing/A')
  assert.ok(writes() > w0, 'the upsert is counted in d1_write')
  // Again at once: nothing is written.
  const w1 = writes()
  assert.equal((await here(jar, { route: 'pricing/B' })).status, 204)
  assert.deepEqual(row(), first)
  assert.equal(writes(), w1)
  // 50 s later it is.
  env.DB.sql.prepare('UPDATE presence SET at = at - 51000').run()
  assert.equal((await here(jar, { route: 'pricing/B' })).status, 204)
  assert.equal(row().route, 'pricing/B')
  // The day's D1 writes used up: refused quietly, nothing written.
  env.DB.sql.prepare('UPDATE presence SET at = at - 51000').run()
  const was = row()
  env.DB.sql.prepare("INSERT INTO budget (day, what, n) VALUES (?, 'd1_write', 90000) ON CONFLICT(day, what) DO UPDATE SET n = 90000").run(today())
  assert.equal((await here(jar, { route: 'pricing/A' })).status, 204)
  assert.deepEqual(row(), was)
})

test('the owner list: message, views, and the latest 8 faces of the last 30 days with their route', async () => {
  const env = await makeEnv()
  signedIn(env)
  const id = await publish(env, metaOf({ message: 'Hi' }))
  const other = await publish(env)
  // Two views today (the page served), one HEAD that isn't one.
  for (const method of ['GET', 'GET', 'HEAD']) assert.equal((await call(env, `/s/${id}/`, { method })).status, 200)
  env.DB.sql.prepare("INSERT INTO views (share_id, link_id, day, n) VALUES (?, '', '2026-01-01', 5)").run(id)
  const now = Date.now()
  for (let i = 1; i <= 10; i++) {
    addViewer(env, i, `v${i}`)
    env.DB.sql.prepare('INSERT INTO presence (share_id, gh_id, route, at) VALUES (?, ?, ?, ?)').run(id, i, `pricing/${i % 2 ? 'A' : 'B'}`, now - i * 1000)
  }
  addViewer(env, 50, 'old')
  env.DB.sql.prepare('INSERT INTO presence (share_id, gh_id, route, at) VALUES (?, ?, ?, ?)').run(other, 50, 'pricing/A', now - 31 * 86_400_000)
  const rows = await (await call(env, '/api/shares', { headers: auth })).json()
  const mine = rows.find(r => r.id === id), theirs = rows.find(r => r.id === other)
  assert.equal(mine.message, 'Hi')
  assert.equal(mine.views, 7)
  assert.deepEqual(mine.viewers.map(v => v.login), ['v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'v7', 'v8'])
  assert.deepEqual(mine.viewers[0], { login: 'v1', name: 'V1', avatar: 'https://avatars.example/1', route: 'pricing/A', at: now - 1000 })
  assert.deepEqual([theirs.views, theirs.viewers, theirs.message], [0, [], null])
  // The cron drops presence older than 30 days, and a removed link's rows go with it.
  await cron(env, now)
  assert.equal(env.DB.sql.prepare('SELECT COUNT(*) AS n FROM presence WHERE share_id = ?').get(other).n, 0)
  assert.equal(env.DB.sql.prepare('SELECT COUNT(*) AS n FROM presence WHERE share_id = ?').get(id).n, 10)
  await call(env, `/api/shares/${id}`, { method: 'DELETE', headers: auth })
  assert.equal(env.DB.sql.prepare('SELECT COUNT(*) AS n FROM presence').get().n, 0)
})

test('the message as the owner\'s side takes it: trimmed, empty is none, 280 at most', () => {
  assert.equal(messageOf(undefined), undefined)
  assert.equal(messageOf(null), null)
  assert.equal(messageOf('  hi  '), 'hi')
  assert.equal(messageOf('   '), null)
  assert.equal(messageOf('x'.repeat(280)).length, 280)
  assert.throws(() => messageOf('x'.repeat(281)), /at most 280/)
})

test('changed variants: the kept sources against the session, file by file', t => {
  const dir = mkdtempSync(join(tmpdir(), 'proto-popover-checks-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const src = join(dir, 'src', 'protos', 'pricing')
  mkdirSync(src, { recursive: true })
  writeFileSync(join(src, 'meta.ts'), 'export default {"title":"Pricing","variants":{"A":"Coral","B":"Ocean","C":"Forest"}}\n')
  for (const f of ['A.tsx', 'B.tsx', 'C.tsx', 'parts.tsx']) writeFileSync(join(src, f), `// ${f}\n`)
  const scope = { protos: [{ id: 'pricing', variants: ['A', 'B'] }], start: 'pricing/A' }
  const entry = { id: 'k3x9p2abcd', host: 'local', title: 'Pricing', scope, version: 2, sourceHash: hashOf(dir, scope) }
  cpSync(src, join(dir, '.proto', 'shares', entry.id, 'v2', 'pricing'), { recursive: true })
  assert.deepEqual(changedVariants(dir, entry), [])
  // A variant the link doesn't share changed: nothing to tell its viewers.
  writeFileSync(join(src, 'C.tsx'), '// C, changed\n')
  assert.deepEqual(changedVariants(dir, entry), [])
  writeFileSync(join(src, 'B.tsx'), '// B, changed\n')
  assert.deepEqual(changedVariants(dir, entry), [{ key: 'pricing/B', name: 'Ocean' }])
  writeFileSync(join(src, 'parts.tsx'), '// parts, changed\n')
  writeFileSync(join(src, 'A.tsx'), '// A, changed\n')
  assert.deepEqual(changedVariants(dir, entry), [{ key: 'pricing/A', name: 'Coral' }, { key: 'pricing/B', name: 'Ocean' }, { key: 'pricing/*', name: 'Shared parts' }])
  // A new file under the prototype is a shared part; a version whose sources weren't kept says nothing.
  assert.deepEqual(changedVariants(dir, { ...entry, version: 1 }), [])
})

test('the session server: owner (cached, refresh asks now), signin, and the list\'s message, views and faces', async t => {
  // The host on this Mac runs sign-in once it has the GitHub App's secrets: none yet.
  const env = await makeEnv({ BASE: 'localhost:8787', PATH_MODE: '0', SIGNIN: '0', GITHUB_CLIENT_ID: undefined })
  const home = mkdtempSync(join(tmpdir(), 'proto-popover-home-'))
  const dir = mkdtempSync(join(tmpdir(), 'proto-popover-session-'))
  const was = { home: process.env.HOME, store: process.env.PROTO_SHARE_TOKEN_STORE, fetch: globalThis.fetch }
  process.env.HOME = home; process.env.PROTO_SHARE_TOKEN_STORE = 'file'
  // The host on this Mac is reached at 127.0.0.1:8787: those requests go to the Worker in memory.
  let asked = 0
  globalThis.fetch = (url, init) => {
    const u = new URL(String(url))
    if (u.host !== '127.0.0.1:8787') return was.fetch(url, init)
    if (u.pathname === '/api/owner') asked++
    return worker.fetch(new Request(url, init), env)
  }
  t.after(() => {
    globalThis.fetch = was.fetch
    process.env.HOME = was.home
    if (was.store === undefined) delete process.env.PROTO_SHARE_TOKEN_STORE; else process.env.PROTO_SHARE_TOKEN_STORE = was.store
    rmSync(home, { recursive: true, force: true }); rmSync(dir, { recursive: true, force: true })
  })
  const config = join(home, '.config', 'prototype')
  mkdirSync(config, { recursive: true })
  const HOST = { name: 'local', url: 'http://localhost:8787', stage: 'local', base: 'localhost:8787', pathMode: false, default: true, owner: 'Dananz' }
  writeFileSync(join(config, 'hosts.json'), JSON.stringify([HOST]))
  writeFileSync(join(config, 'token-local'), TOKEN)
  forget('local')
  const server = shareServer({ root: dir, session: () => ({}), receive: () => {}, emit: () => {}, pollMs: 60_000 })
  t.after(() => server.close())

  // Sign-in off on this host: signed out, the flow can't run, signin says why.
  let r = await server.handle('owner', {})
  assert.deepEqual(r, { status: 200, body: { host: 'local', signedIn: false, login: null, name: null, avatar: null, signin: false } })
  r = await server.handle('signin', {})
  assert.equal(r.status, 409)
  assert.equal(r.body.code, 'signin_off')
  assert.match(r.body.error, /proto share setup --github/)
  // Sign-in on (the local host's GitHub App): the claim link, walked, then refresh shows who.
  env.GITHUB_CLIENT_ID = gh.clientId
  r = await server.handle('signin', {})
  assert.equal(r.status, 200)
  assert.match(r.body.url, /^http:\/\/localhost:8787\/auth\/github\?claim=/)
  const n = asked
  assert.equal((await server.handle('owner', {})).body.signedIn, false)
  assert.equal(asked, n + 1, 'a signin forgets what was cached')
  await server.handle('owner', {})
  assert.equal(asked, n + 1, 'asked again within a minute: from the cache')
  const walked = await walkClaim(r.body.url.replace('localhost:8787', '127.0.0.1:8787'), { fetch: (u, i) => worker.fetch(new Request(u, i), env) })
  assert.equal(walked.status, 200, walked.text)
  r = await server.handle('owner', { refresh: true })
  assert.deepEqual(r.body, { host: 'local', signedIn: true, login: 'dana-test', name: 'Dana', avatar: 'https://avatars.githubusercontent.com/u/4242', signin: true })

  // A link of this session, with a message, a view and someone in it now.
  const api = client(HOST, TOKEN)
  const id = await api.create()
  await api.put(id, gzipSync('<!doctype html><p>hi'), { title: 'Pricing', session: 's1', projectLabel: 'shop', scope: { protos: [{ id: 'pricing', variants: ['A'] }], start: 'pricing/A' }, lang: 'en', message: 'Which one?' })
  writeShares(dir, [{ id, host: 'local', title: 'Pricing', scope: { protos: [{ id: 'pricing', variants: ['A'] }], start: 'pricing/A' }, version: 1 }])
  await worker.fetch(new Request(`http://${id}.localhost:8787/`), env)
  addViewer(env, 7, 'ana')
  env.DB.sql.prepare('INSERT INTO presence (share_id, gh_id, route, at) VALUES (?, 7, ?, ?)').run(id, 'pricing/A', Date.now() - 5000)
  addViewer(env, 8, 'ben')
  env.DB.sql.prepare('INSERT INTO presence (share_id, gh_id, route, at) VALUES (?, 8, ?, ?)').run(id, 'pricing/A', Date.now() - 10 * 60_000)
  r = await server.handle('list', {})
  assert.equal(r.status, 200)
  const s = r.body.shares[0]
  assert.equal(s.message, 'Which one?')
  assert.equal(s.views, 1)
  assert.deepEqual(s.viewers.map(v => [v.login, v.route, v.now]), [['ana', 'pricing/A', true], ['ben', 'pricing/A', false]])
  assert.deepEqual(s.changedVariants, [])
  assert.equal(s.changed, false)
})

test('a viewer replies on the link: the reply joins the first comment\'s thread, its design and spot', async () => {
  const env = await makeEnv()
  signedIn(env)
  const id = await publish(env)
  addViewer(env, 77, 'noa')
  const cookie = await cookieOf(id, 77)
  const post = body => call(env, `/s/${id}/api/comments`, { method: 'POST', headers: { ...XP, cookie, 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const first = crypto.randomUUID(), second = crypto.randomUUID(), third = crypto.randomUUID()
  const target = { x: 10, y: 20, view: { size: 'desktop', w: 1440, h: 900 } }
  assert.equal((await post({ id: first, variant: 'pricing/B', body: 'too dark', target })).status, 201)
  // The reply names only the comment it answers; the host gives it that comment's design and spot.
  const r = await post({ id: second, variant: 'pricing/A', body: 'thanks!', target: null, re: first })
  assert.equal(r.status, 201, await r.clone().text())
  const got = await r.json()
  assert.equal(got.re, first)
  assert.equal(got.variant, 'pricing/B')
  assert.deepEqual(got.target, target)
  // A reply to a reply joins the same thread: threads stay flat.
  const r3 = await (await post({ id: third, variant: 'pricing/B', body: 'one more', target: null, re: second })).json()
  assert.equal(r3.re, first)
  // The owner sees what it answers.
  const owned = await (await call(env, '/api/owner/comments', { headers: auth })).json()
  assert.equal(owned.comments.find(c => c.id === second).re, first)
  // Nothing to answer: refused.
  assert.equal((await post({ id: crypto.randomUUID(), variant: 'pricing/B', body: 'x', re: crypto.randomUUID() })).status, 404)
})

test('a reply sent to Claude carries what it answers, inside the quoted fence', async () => {
  const { fromComment, sharedLines } = await import('../app/share/viewer-text.mjs')
  const dir = mkdtempSync(join(tmpdir(), 'proto-reply-'))
  const row = { id: crypto.randomUUID(), share: { id: 'abcdefghjk', title: 'T', version: 1 }, variant: 'pricing/B', version: 1, body: 'thanks!', author: { login: 'noa' }, re: crypto.randomUUID() }
  const parent = { body: 'too dark', owner_reply: 'made it lighter' }
  const c = fromComment(row, dir, parent)
  assert.deepEqual(c.from.earlier, { text: 'too dark', reply: 'made it lighter' })
  const lines = sharedLines({ ...c, n: 1 }).join('\n')
  const fenceStart = lines.indexOf('┌')
  assert.ok(fenceStart > 0 && lines.indexOf('replying to their earlier comment: too dark') > fenceStart, lines)
  assert.match(lines, /which the owner answered: made it lighter/)
  rmSync(dir, { recursive: true, force: true })
})
