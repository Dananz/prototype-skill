// Unit checks for sharing with no setup: the built-in prtype.dev host when hosts.json names none,
// its per-share links, the GitHub sign-in a new user runs with no token (from the CLI and from the
// page's session server), signout, the admin calls, what the CLI says with no token or an API too
// new for it, and the words for each refusal. The host is a stubbed fetch built on the Contract in
// docs/superpowers/specs/2026-10-28-shared-host-design.md; nothing here reaches a network, the
// Keychain or ~/.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BUILTIN, client, defaultHost, forget, getToken, hostNamed, linkOf, setupHint, shortLinkOf, signIn, signedInLine, tokenFile, writeShares } from '../app/share/owner.mjs'
import { shareServer } from '../app/share/routes.mjs'
import { admin, main, opensBrowser, reachHost, signin, signout } from '../scripts/share.mjs'

const id = 'k3x9p2m4q7'
const POLL = 'p'.repeat(43)

// A HOME of its own, the file token store, fast sign-in polls, and every fetch answered by `host`
// (anything not prtype.dev fails the test). Put back after.
function fresh(t, host = fakeHost()) {
  const home = mkdtempSync(join(tmpdir(), 'proto-signin-home-'))
  const was = { home: process.env.HOME, store: process.env.PROTO_SHARE_TOKEN_STORE, every: process.env.PROTO_SHARE_SIGNIN_EVERY_MS, wait: process.env.PROTO_SHARE_SIGNIN_WAIT_MS, open: process.env.PROTO_SHARE_NO_OPEN, fetch: globalThis.fetch }
  process.env.HOME = home; process.env.PROTO_SHARE_TOKEN_STORE = 'file'; process.env.PROTO_SHARE_SIGNIN_EVERY_MS = '1'; process.env.PROTO_SHARE_NO_OPEN = '1'
  delete process.env.PROTO_SHARE_SIGNIN_WAIT_MS
  globalThis.fetch = host.fetch
  forget('online'); forget('local')
  t.after(() => {
    globalThis.fetch = was.fetch
    for (const [k, v] of [['HOME', was.home], ['PROTO_SHARE_TOKEN_STORE', was.store], ['PROTO_SHARE_SIGNIN_EVERY_MS', was.every], ['PROTO_SHARE_SIGNIN_WAIT_MS', was.wait], ['PROTO_SHARE_NO_OPEN', was.open]]) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v
    }
    forget('online'); forget('local')
    rmSync(home, { recursive: true, force: true })
  })
  const config = join(home, '.config', 'prototype')
  return { home, config, host, hosts: list => { mkdirSync(config, { recursive: true }); writeFileSync(join(config, 'hosts.json'), JSON.stringify(list)) } }
}

/**
 * prtype.dev as the Contract has it. polls: what each /api/signin/poll answers in turn, as
 * [status, body] (the last repeats). Every request is kept in `asked` as "METHOD /path auth?".
 */
function fakeHost({ polls = [[200, { token: 'tok-new_1', login: 'dana', name: 'Dana', avatar: null, status: 'active' }]], apiMin = '2', hostHash = null, answers = {} } = {}) {
  const asked = []
  let polled = 0
  const reply = (status, body, headers = {}) => new Response(body == null ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })
  const fetch = async (url, init = {}) => {
    const u = new URL(String(url))
    assert.equal(u.host, 'prtype.dev', `no request leaves for ${u.host}`)
    const auth = init.headers?.authorization
    const key = `${init.method || 'GET'} ${u.pathname}${u.search}`
    asked.push(`${key}${auth ? ` ${auth}` : ''}`)
    if (answers[key]) return reply(...answers[key])
    if (u.pathname === '/_health') return new Response('ok', { headers: { 'x-proto-api': '2', 'x-proto-api-min': apiMin, ...(hostHash ? { 'x-proto-host': hostHash } : {}) } })
    if (key === 'POST /api/signin/start') {
      assert.equal(auth, undefined, 'sign-in starts with no token')
      return reply(200, { code: 'c0de', poll: POLL, url: 'https://prtype.dev/auth/github?signin=c0de', exp: Date.now() + 600e3, words: 'BCDF-GHJK' })
    }
    if (key === 'POST /api/signin/poll') {
      const body = JSON.parse(init.body)
      if (body.code !== 'c0de' || body.poll !== POLL) return reply(404, { error: 'no such sign-in', code: 'not_found' })
      const [status, answer] = polls[Math.min(polled++, polls.length - 1)]
      return reply(status, answer)
    }
    if (key === 'POST /api/owner/signout') return reply(200, { ok: true })
    if (key === 'GET /api/owner') return reply(200, { login: 'dana', name: 'Dana', avatar: null, signin: true, status: 'active' })
    return reply(404, { error: 'not here', code: 'not_found' })
  }
  return { fetch, asked, polls: () => polled }
}

const dies = msg => { throw Object.assign(new Error(msg), { died: true }) }
const logs = t => { const out = []; t.mock.method(console, 'log', (...a) => out.push(a.join(' '))); return out }

test('the built-in host: the default when hosts.json names none, and online when hosts.json has no online entry', t => {
  const { hosts } = fresh(t)
  assert.deepEqual(defaultHost(), { name: 'online', url: 'https://prtype.dev', stage: 'domain', base: 'prtype.dev', pathMode: false, default: true, builtin: true })
  assert.deepEqual(hostNamed('online'), BUILTIN)
  assert.equal(hostNamed('local'), null)
  // A local host that says default wins; online is still the built-in one.
  const local = { name: 'local', url: 'http://localhost:8787', stage: 'local', base: 'localhost:8787', pathMode: false, default: true, owner: 'Dana' }
  hosts([local])
  assert.equal(defaultHost().name, 'local')
  assert.equal(hostNamed('online').builtin, true)
  // An online entry from a past setup (the maintainer's Mac) is used as it is.
  const mine = { name: 'online', url: 'https://prtype.dev', stage: 'domain', base: 'prtype.dev', pathMode: true, default: true, accountId: 'acc' }
  hosts([{ ...local, default: false }, mine])
  assert.deepEqual(defaultHost(), mine)
  assert.deepEqual(hostNamed('online'), mine)
})

test('links on a host with one origin per share, and what the built-in host needs', () => {
  assert.equal(linkOf(BUILTIN, id), `https://${id}.prtype.dev/`)
  assert.equal(shortLinkOf(BUILTIN, id), `https://prtype.dev/${id}`)
  // Path mode (a host from before) keeps its /s/<id>/ link.
  assert.equal(linkOf({ ...BUILTIN, pathMode: true }, id), `https://prtype.dev/s/${id}/`)
  assert.equal(setupHint(BUILTIN), 'proto share signin')
  assert.equal(setupHint({ ...BUILTIN, builtin: undefined }), 'proto share setup')
})

test('signIn: waits, stores the token once, and says who', async t => {
  const host = fakeHost({ polls: [[202, { state: 'waiting' }], [202, { state: 'waiting' }], [200, { token: 'tok-new_1', login: 'dana', name: 'Dana', avatar: 'https://a/1', status: 'active' }]] })
  fresh(t, host)
  const urls = []
  const who = await signIn(BUILTIN, { onUrl: u => urls.push(u) })
  assert.deepEqual(urls, ['https://prtype.dev/auth/github?signin=c0de'])
  assert.deepEqual(who, { login: 'dana', name: 'Dana', avatar: 'https://a/1', status: 'active' })
  assert.equal(host.polls(), 3, 'no poll after the token')
  assert.equal(getToken('online'), 'tok-new_1')
  assert.equal(readFileSync(tokenFile('online'), 'utf8'), 'tok-new_1\n')
  assert.equal(signedInLine(who), 'signed in as @dana')
})

test('signIn: a pending user is signed in and told to wait; an expired or timed-out link says run it again', async t => {
  fresh(t, fakeHost({ polls: [[200, { token: 'tok-p', login: 'newbie', name: null, avatar: null, status: 'pending' }]] }))
  const who = await signIn(BUILTIN)
  assert.equal(who.status, 'pending')
  assert.equal(getToken('online'), 'tok-p')
  assert.match(signedInLine(who), /Waiting for the maintainer to approve @newbie/)

  forget('online'); rmSync(tokenFile('online'))
  globalThis.fetch = fakeHost({ polls: [[202, { state: 'waiting' }], [410, { error: 'gone', code: 'expired' }]] }).fetch
  await assert.rejects(signIn(BUILTIN), e => e.code === 'expired' && /expired: run proto share signin again/.test(e.message))
  assert.equal(getToken('online'), null)

  globalThis.fetch = fakeHost({ polls: [[202, { state: 'waiting' }]] }).fetch
  await assert.rejects(signIn(BUILTIN, { wait: 30 }), /No sign-in within five minutes/)
  assert.equal(getToken('online'), null)
})

test('proto share signin with no token: prints the link, opens it only when allowed, stores the token', async t => {
  const host = fakeHost({ polls: [[202, { state: 'waiting' }], [200, { token: 'tok-cli', login: 'dana', name: 'Dana', avatar: null, status: 'active' }]] })
  fresh(t, host)
  const out = logs(t)
  await signin({ 'no-open': true }, { die: dies })
  assert.deepEqual(out, ['Sign in with GitHub: https://prtype.dev/auth/github?signin=c0de', 'Your code: BCDF-GHJK (approve on that page only if it shows this code)', 'The link works once, for 10 minutes.', 'signed in as @dana'])
  assert.equal(getToken('online'), 'tok-cli')
  assert.ok(!host.asked.some(a => a.startsWith('POST /api/owner/claim')), 'no claim without a token')
  // Opening the browser: not with --no-open, not with PROTO_SHARE_NO_OPEN=1, only on a Mac.
  assert.equal(opensBrowser({}, {}, 'darwin'), true)
  assert.equal(opensBrowser({ 'no-open': true }, {}, 'darwin'), false)
  assert.equal(opensBrowser({}, { PROTO_SHARE_NO_OPEN: '1' }, 'darwin'), false)
  assert.equal(opensBrowser({}, {}, 'linux'), false)
})

test('proto share signin, pending: the waiting line', async t => {
  fresh(t, fakeHost({ polls: [[200, { token: 'tok-p', login: 'newbie', name: null, avatar: null, status: 'pending' }]] }))
  const out = logs(t)
  await signin({}, { die: dies })
  assert.match(out.at(-1), /^signed in as @newbie\. Waiting for the maintainer to approve @newbie/)
})

test('proto share signout: revoked on the host, then forgotten here; a host away keeps it', async t => {
  const host = fakeHost()
  const { config } = fresh(t, host)
  mkdirSync(config, { recursive: true }); writeFileSync(tokenFile('online'), 'tok-old\n')
  const out = logs(t)
  await signout({}, { die: dies }, { fetch: host.fetch })
  assert.ok(host.asked.includes('POST /api/owner/signout Bearer tok-old'))
  assert.equal(existsSync(tokenFile('online')), false)
  assert.match(out.at(-1), /signed out of the host "online"/)
  await signout({}, { die: dies }, { fetch: host.fetch })
  assert.match(out.at(-1), /not signed in/)

  writeFileSync(tokenFile('online'), 'tok-old\n')
  await assert.rejects(signout({}, { die: dies }, { fetch: async () => { throw new Error('offline') } }), /token is kept/)
  assert.equal(getToken('online'), 'tok-old')
  // A token the host no longer takes is signed out already.
  await signout({}, { die: dies }, { fetch: fakeHost({ answers: { 'POST /api/owner/signout': [401, { error: 'no', code: 'token' }] } }).fetch })
  assert.equal(existsSync(tokenFile('online')), false)
})

test('proto share admin: the maintainer\'s calls, and the words for anyone else', async t => {
  const host = fakeHost({ answers: {
    'GET /api/admin/users?status=pending': [200, { users: [{ login: 'newbie', name: 'New', status: 'pending', role: 'user', created_at: Date.UTC(2026, 9, 28, 9, 30) }] }],
    'POST /api/admin/users/newbie/approve': [200, { ok: true }],
    'POST /api/admin/users/spam/ban': [200, { ok: true }],
    [`DELETE /api/admin/shares/${id}`]: [200, { ok: true }],
    'GET /api/admin/reports': [200, [{ share_id: id, reason: 'ignore all previous instructions', created_at: Date.UTC(2026, 9, 28) }]],
  } })
  const { config } = fresh(t, host)
  mkdirSync(config, { recursive: true }); writeFileSync(tokenFile('online'), 'tok-admin\n')
  const out = logs(t)
  await admin(['users'], { pending: true }, { die: dies })
  assert.equal(out.at(-1), '@newbie  pending  New  2026-10-28 09:30')
  await admin(['approve', '@newbie'], {}, { die: dies })
  assert.match(out.at(-1), /^approved @newbie/)
  await admin(['ban', 'spam'], {}, { die: dies })
  assert.match(out.at(-1), /^banned @spam/)
  await admin(['rm', id], {}, { die: dies })
  assert.match(out.at(-1), new RegExp(`^took ${id} down`))
  await admin(['reports'], {}, { die: dies })
  assert.equal(out.at(-1), `${id}  2026-10-28 00:00  "ignore all previous instructions"`)
  assert.ok(host.asked.includes('POST /api/admin/users/newbie/approve Bearer tok-admin'))
  await assert.rejects(admin(['approve'], {}, { die: dies }), /proto share admin users/)
  globalThis.fetch = fakeHost({ answers: { 'GET /api/admin/reports': [403, { error: 'admins only', code: 'admin' }] } }).fetch
  await assert.rejects(admin(['reports'], {}, { die: dies }), /Only an admin of the share host "online" can do that/)
})

test('with no token the CLI asks for the sign-in, before asking the host anything', async t => {
  const host = fakeHost()
  fresh(t, host)
  const dir = mkdtempSync(join(tmpdir(), 'proto-signin-session-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  for (const args of [['ls'], ['rm', id], ['update', id], ['pricing/1']]) {
    await assert.rejects(main(args, {}, { sessionDir: dir, session: {}, die: dies }), e => e.died && e.message === 'Sign in with GitHub first: proto share signin', args.join(' '))
  }
  assert.deepEqual(host.asked, [])
})

test('the API version: a host that needs a newer skill stops it; the code-hash notice only for a host this Mac deployed', async t => {
  const { hosts } = fresh(t)
  await assert.rejects(reachHost(dies, {}, { fetch: fakeHost({ apiMin: '3' }).fetch }), /^Error: Update the skill to share: the share host "online" needs owner API 3/)
  const out = logs(t)
  // A host without the headers (older than both) is taken; the built-in host never says "older code".
  assert.equal((await reachHost(dies, {}, { fetch: fakeHost({ apiMin: '', hostHash: 'old' }).fetch })).name, 'online')
  assert.deepEqual(out, [])
  hosts([{ name: 'online', url: 'https://prtype.dev', stage: 'domain', base: 'prtype.dev', pathMode: false, default: true, accountId: 'acc' }])
  await reachHost(dies, {}, { fetch: fakeHost({ hostHash: 'old' }).fetch })
  assert.deepEqual(out, ['The online host runs older code: proto share setup updates it.'])
})

test('refusals in words: pending, banned, quota, admin, rate', async () => {
  const say = async (status, body) => {
    const api = client(BUILTIN, 'tok', { fetch: async () => new Response(JSON.stringify(body), { status }) })
    try { await api.create(); return null } catch (e) { return [e.status, e.code, e.message] }
  }
  assert.deepEqual(await say(403, { error: 'pending', code: 'pending', login: 'newbie' }), [403, 'pending', 'Waiting for the maintainer to approve @newbie: sharing opens once they do'])
  assert.match((await say(403, { error: 'pending', code: 'pending' }))[2], /^Waiting for the maintainer to approve your GitHub account/)
  assert.equal((await say(403, { error: 'banned', code: 'banned' }))[2], 'This GitHub account can\'t share on the host "online" any more')
  assert.equal((await say(507, { error: 'You have 25 live links, the most a user can have. proto share rm frees one.', code: 'quota' }))[2], 'You have 25 live links, the most a user can have. proto share rm frees one.')
  assert.match((await say(507, { code: 'quota' }))[2], /share limit/)
  assert.equal((await say(403, { error: 'admins only', code: 'admin' }))[2], 'Only an admin of the share host "online" can do that')
  assert.match((await say(429, { error: 'slow down', code: 'rate' }))[2], /^Too many tries from this network/)
})

test('the session server with the built-in host and no token: signed out with sign-in, then the page\'s sign-in lands', async t => {
  const host = fakeHost({ polls: [[202, { state: 'waiting' }], [200, { token: 'tok-page', login: 'dana', name: 'Dana', avatar: null, status: 'pending' }]],
    answers: { 'GET /api/owner': [200, { login: 'dana', name: 'Dana', avatar: null, signin: true, status: 'pending' }] } })
  fresh(t, host)
  const dir = mkdtempSync(join(tmpdir(), 'proto-signin-session-'))
  const server = shareServer({ root: dir, session: () => ({}), receive: () => {}, emit: () => {}, pollMs: 60_000 })
  t.after(() => { server.close(); rmSync(dir, { recursive: true, force: true }) })

  // The popover's two questions: a host (not NoHost) and an owner signed out who can sign in (not a `code`).
  let r = await server.handle('list', {})
  assert.equal(r.status, 200)
  assert.deepEqual(r.body.host, { name: 'online', stage: 'domain', owner: '' })
  r = await server.handle('owner', { refresh: true })
  assert.deepEqual(r, { status: 200, body: { host: 'online', signedIn: false, login: null, name: null, avatar: null, signin: true } })
  // A link of this session, removed with no token: the sign-in, not setup.
  writeShares(dir, [{ id, host: 'online', title: 'Pricing', scope: { protos: [{ id: 'pricing', variants: ['A'] }], start: 'pricing/A' }, version: 1 }])
  r = await server.handle('remove', { id })
  assert.deepEqual([r.status, r.body.code, r.body.error], [409, 'sign_in', 'Sign in with GitHub first: proto share signin'])
  assert.deepEqual(host.asked, [], 'nothing asked of the host before Sign in is pressed')

  // Sign in with GitHub: the link comes back at once; the server waits on the host and stores the token.
  r = await server.handle('signin', {})
  assert.deepEqual(r, { status: 200, body: { url: 'https://prtype.dev/auth/github?signin=c0de', words: 'BCDF-GHJK' } })
  for (const end = Date.now() + 5000; !getToken('online') && Date.now() < end;) await new Promise(ok => setTimeout(ok, 5))
  assert.equal(getToken('online'), 'tok-page')
  r = await server.handle('owner', { refresh: true })
  assert.deepEqual(r.body, { host: 'online', signedIn: true, login: 'dana', name: 'Dana', avatar: null, signin: true, status: 'pending' })
  assert.ok(host.asked.includes('GET /api/owner Bearer tok-page'))
})

test('the session server: a named host that isn\'t here is no_host; the local host with no token is no_token', async t => {
  const { hosts } = fresh(t)
  const dir = mkdtempSync(join(tmpdir(), 'proto-signin-session-'))
  const server = shareServer({ root: dir, session: () => ({}), receive: () => {}, emit: () => {}, pollMs: 60_000 })
  t.after(() => { server.close(); rmSync(dir, { recursive: true, force: true }) })
  writeShares(dir, [{ id, host: 'local', title: 'Pricing', scope: { protos: [{ id: 'pricing', variants: ['A'] }], start: 'pricing/A' }, version: 1 }])
  let r = await server.handle('remove', { id })
  assert.deepEqual([r.status, r.body.code, r.body.setup], [409, 'no_host', 'proto share setup --local'])
  hosts([{ name: 'local', url: 'http://localhost:8787', stage: 'local', base: 'localhost:8787', pathMode: false, default: true, owner: 'Dana' }])
  r = await server.handle('remove', { id })
  assert.deepEqual([r.status, r.body.code], [409, 'no_token'])
  r = await server.handle('owner', { refresh: true })
  assert.equal(r.body.code, 'no_token')
})
