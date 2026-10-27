// Unit checks for the online host as the owner's side sees it (links and messages by stage, the owner
// API against the Worker in memory) and for `proto share setup` (online, --domain, --github), with
// wrangler and every Cloudflare call faked. Nothing here reaches a network, the Keychain or ~/.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import worker from '../host/worker.mjs'
import { apiOrigin, client, linkOf, setupHint, shortLinkOf } from '../app/share/owner.mjs'

const TOKEN = 'owner-token-for-online-tests'
const hex = async s => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map(b => b.toString(16).padStart(2, '0')).join('')

// The Worker's bindings in memory: D1 on node:sqlite from schema.sql, KV on a Map; one owner, o1,
// named by meta.owner_id as setup leaves it.
export async function memoryEnv(extra = {}) {
  const sql = new DatabaseSync(':memory:')
  sql.exec(readFileSync(new URL('../host/schema.sql', import.meta.url), 'utf8'))
  sql.prepare('INSERT INTO owners (id, name, created_at) VALUES (?, ?, ?)').run('o1', 'Dananz', 1)
  sql.prepare('INSERT INTO owner_tokens (sha256, owner_id, device, created_at) VALUES (?, ?, ?, ?)').run(await hex(TOKEN), 'o1', 'test', 1)
  sql.prepare("INSERT INTO meta (k, v) VALUES ('owner_id', 'o1')").run()
  const store = new Map()
  const KV = {
    store,
    async get(key, type) { const v = store.get(key); if (v === undefined) return null; return type === 'arrayBuffer' ? v.slice(0) : new TextDecoder().decode(v) },
    async put(key, value) { store.set(key, value instanceof ArrayBuffer ? value.slice(0) : value instanceof Uint8Array ? value.slice().buffer : new TextEncoder().encode(String(value)).buffer) },
    async delete(key) { store.delete(key) },
  }
  const stmt = (query, args = []) => ({
    bind: (...a) => stmt(query, a),
    first: async () => sql.prepare(query).get(...args) ?? null,
    all: async () => ({ results: sql.prepare(query).all(...args) }),
    run: async () => { const r = sql.prepare(query).run(...args); return { success: true, meta: { changes: Number(r.changes), rows_written: Number(r.changes) } } },
  })
  const DB = { sql, prepare: q => stmt(q), async batch(list) { const out = []; for (const s of list) out.push(await s.run()); return out } }
  return { KV, DB, BASE: 'prtype.dev', PATH_MODE: '1', SIGNIN: '0', ...extra }
}
// A fetch that hands each request to the Worker in memory, as Cloudflare would.
const workerFetch = env => (url, init) => worker.fetch(new Request(url, init), env)

const local = { name: 'local', url: 'http://localhost:8787', stage: 'local', base: 'localhost:8787', pathMode: false }
const localPath = { ...local, pathMode: true }
const workers = { name: 'online', url: 'https://proto-share.dana-proto.workers.dev', stage: 'workers', base: 'proto-share.dana-proto.workers.dev', pathMode: true }
const domain = { name: 'online', url: 'https://prtype.dev', stage: 'domain', base: 'prtype.dev', pathMode: true }

test('links, the API origin and the setup hint by stage', () => {
  const id = 'k3x9p2m4q7'
  assert.equal(linkOf(local, id), `http://${id}.localhost:8787/`)
  assert.equal(linkOf(localPath, id), `http://127.0.0.1:8787/s/${id}/`)
  assert.equal(linkOf(workers, id), `https://proto-share.dana-proto.workers.dev/s/${id}/`)
  assert.equal(linkOf(domain, id), `https://prtype.dev/s/${id}/`)
  assert.equal(shortLinkOf(domain, id), `https://prtype.dev/${id}`)
  // workers.dev has no short link of its own: the one link is the share's path.
  assert.equal(shortLinkOf(workers, id), linkOf(workers, id))
  assert.equal(shortLinkOf(local, id), linkOf(local, id))
  assert.equal(apiOrigin(local), 'http://127.0.0.1:8787')
  assert.equal(apiOrigin(workers), 'https://proto-share.dana-proto.workers.dev')
  assert.equal(apiOrigin(domain), 'https://prtype.dev')
  assert.equal(setupHint(local), 'proto share setup --local')
  assert.equal(setupHint(domain), 'proto share setup')
  assert.equal(setupHint(workers), 'proto share setup')
  assert.equal(setupHint(null), 'proto share setup')
})

test('the owner API against an online host: create, put, list, comments, patch, usage', async () => {
  const env = await memoryEnv()
  const api = client(domain, TOKEN, { fetch: workerFetch(env) })
  const id = await api.create()
  const { gzipSync } = await import('node:zlib')
  const meta = { title: 'Pricing', session: 's1', projectLabel: 'shop', scope: { protos: [{ id: 'pricing', variants: ['A'] }], start: 'pricing/A' }, lang: 'en' }
  assert.equal((await api.put(id, gzipSync('<!doctype html><p>v1'), meta)).version, 1)
  assert.equal((await api.put(id, gzipSync('<!doctype html><p>v2'), meta)).version, 2)
  const rows = await api.list()
  assert.deepEqual(rows.map(r => [r.id, r.version]), [[id, 2]])
  const page = await workerFetch(env)(`https://prtype.dev/s/${id}/`)
  assert.equal(page.status, 200)
  // A viewer's comment, as if one had signed in, then the owner's view of it and a status.
  env.DB.sql.prepare('INSERT INTO viewers (gh_id, login, name, avatar, seen_at) VALUES (?, ?, ?, ?, ?)').run(7, 'dana', 'Dana', null, 1)
  const cid = crypto.randomUUID()
  env.DB.sql.prepare("INSERT INTO comments (id, share_id, link_id, viewer, verified, version, route, body, gh_id, variant, created_at, updated_at) VALUES (?, ?, '', 'gh:7', 1, 2, 'pricing/A', 'hi', 7, 'pricing/A', 1, 1)").run(cid, id)
  const { comments } = await api.comments(0)
  assert.deepEqual(comments.map(c => [c.id, c.status]), [[cid, 'new']])
  await api.patch(cid, { status: 'sent' }, id)
  assert.equal(env.DB.sql.prepare('SELECT status FROM comments WHERE id = ?').get(cid).status, 'sent')
  const u = await api.usage()
  assert.equal(u.kv_write, 2)
  assert.equal(u.caps.kv_write, 900)
  assert.ok(u.kv_bytes > 0 && u.resetsAt > Date.now())
  await api.remove(id)
  assert.deepEqual(await api.list(), [])
})

test('an online host\'s refusals read as what to do: the budget in its own words, not_owner names setup', async () => {
  const env = await memoryEnv()
  const api = client(domain, TOKEN, { fetch: workerFetch(env) })
  const id = await api.create()
  const day = new Date().toISOString().slice(0, 10)
  env.DB.sql.prepare("INSERT INTO budget (day, what, n) VALUES (?, 'kv_write', 900)").run(day)
  const { gzipSync } = await import('node:zlib')
  await assert.rejects(api.put(id, gzipSync('x'), { title: 't', session: 's', projectLabel: 'p', scope: { protos: [] }, lang: 'en' }), e => {
    assert.equal(e.status, 507)
    assert.equal(e.code, 'budget')
    assert.match(e.message, /^The host's daily upload budget is used up\. It resets at 00:00 UTC/)
    return true
  })
  env.DB.sql.prepare("DELETE FROM meta WHERE k = 'owner_id'").run()
  await assert.rejects(api.create(), e => {
    assert.equal(e.status, 403)
    assert.equal(e.message, 'This Mac\'s token isn\'t the host\'s owner: proto share setup')
    return true
  })
})

test('a put that loses a race is asked once more', async () => {
  let n = 0
  const fetch = async () => {
    n++
    return n === 1 ? new Response(JSON.stringify({ code: 'race', error: 'Another upload of this share is in flight.' }), { status: 409 }) : new Response(JSON.stringify({ version: 3 }), { status: 200 })
  }
  assert.deepEqual(await client(domain, TOKEN, { fetch }).put('k3x9p2m4q7', Buffer.from('x'), {}), { version: 3 })
  assert.equal(n, 2)
})

// ---------- proto share setup (online), wrangler and Cloudflare faked ----------

import { chmodSync, existsSync as exists, mkdirSync, mkdtempSync, readFileSync as read, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CRON } from '../host/lib/cron.mjs'
import { assertFreeConfig, bindSite, onlineConfig, ownerAndToken, parseVars, readProdVars, redact, setupGithub, setupOnline } from '../scripts/share-online.mjs'

const SECRET_ID = 'Ov23liFAKECLIENTID9'
const SECRET = 'fake-client-secret-5f3a9c0d1e2b4a6f8e7d'
const VERSION = 'abcdef0123456789'

// A Cloudflare account as setup sees it: wrangler's answers, the REST API, and the deployed host's
// answers. Its D1 is node:sqlite with schema.sql, so the owner rows setup writes can be read back.
function fakeCloudflare({ zones = [{ id: 'z1', name: 'prtype.dev', status: 'active', plan: { legacy_id: 'free' }, name_servers: ['ada.ns.cloudflare.com', 'bob.ns.cloudflare.com'] }], subdomain = null } = {}) {
  const sql = new DatabaseSync(':memory:')
  sql.exec(read(new URL('../host/schema.sql', import.meta.url), 'utf8'))
  const state = { kv: [], db: [], secrets: new Map(), sub: subdomain, zones, calls: [], rest: [], deploys: [], siteBound: false, tlsAfter: 0, health: 0 }
  const ok = (stdout = '') => ({ status: 0, stdout, stderr: '' })
  const wrangler = (args, opts = {}) => {
    state.calls.push({ args, input: opts.input, env: opts.env, cwd: opts.cwd })
    const a = args.join(' ')
    if (a === 'whoami --json') return ok(JSON.stringify({ loggedIn: true, email: 'contactwtimmy@gmail.com', accounts: [{ id: 'acc1', name: 'prtype' }] }))
    if (a === 'auth token --json') return ok(JSON.stringify({ type: 'oauth', token: 'cf-oauth-token' }))
    if (a === 'kv namespace list') return ok(JSON.stringify(state.kv))
    if (a === 'kv namespace create proto-share') { const id = 'f'.repeat(31) + state.kv.length; state.kv.push({ id, title: 'proto-share' }); return ok(`id = "${id}"`) }
    if (a === 'd1 list --json') return ok(JSON.stringify(state.db))
    if (a === 'd1 create proto-share') { state.db.push({ uuid: '11111111-2222-4333-8444-555555555555', name: 'proto-share' }); return ok('created') }
    if (args[0] === 'd1' && args[1] === 'migrations') return ok('Migrations applied')
    if (args[0] === 'deploy') {
      if (args.at(-1).includes('site')) {
        state.siteBound = /"service": "proto-share"/.test(read(args.at(-1), 'utf8'))
        state.deploys.push('site')
      } else {
        // The host as deployed: its BASE, its legacy name and its sign-in switch decide what it answers.
        state.host = JSON.parse(read(args.at(-1), 'utf8').replace(/^\/\/.*\n/, '')).vars
        state.deploys.push(state.host.BASE === 'prtype.dev' ? 'host:domain' : 'host:workers')
      }
      return ok('Deployed')
    }
    if (args[0] === 'secret' && args[1] === 'list') return ok(JSON.stringify([...state.secrets.keys()].map(name => ({ name, type: 'secret_text' }))))
    if (args[0] === 'secret' && args[1] === 'put') { state.secrets.set(args[2], opts.input); return ok('Success') }
    if (args[0] === 'd1' && args[1] === 'execute') {
      const text = args[args.indexOf('--command') + 1]
      const st = sql.prepare(text)
      const results = /^\s*select/i.test(text) ? st.all() : (st.run(), [])
      return ok(JSON.stringify([{ results }]))
    }
    return { status: 1, stdout: '', stderr: `unknown wrangler ${a}` }
  }
  const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })
  const fetch = async (url, init = {}) => {
    const u = new URL(url), method = init.method || 'GET'
    if (u.host === 'api.cloudflare.com') {
      state.rest.push(`${method} ${u.pathname}${u.search}`)
      assert.equal(init.headers.authorization, 'Bearer cf-oauth-token')
      const p = u.pathname.replace('/client/v4', '')
      if (p === '/zones' && u.searchParams.get('name')) return json({ success: true, result: state.zones.filter(z => z.name === u.searchParams.get('name')) })
      if (p === '/zones') return json({ success: true, result: state.zones })
      if (p.startsWith('/zones/')) return json({ success: true, result: state.zones.find(z => z.id === p.split('/')[2]) })
      if (p === '/accounts/acc1/workers/subdomain' && method === 'GET') return state.sub ? json({ success: true, result: { subdomain: state.sub } }) : json({ success: false, errors: [{ code: 10007, message: 'This account does not have a workers.dev subdomain' }] }, 404)
      if (p === '/accounts/acc1/workers/subdomain' && method === 'PUT') { state.sub = JSON.parse(init.body).subdomain; return json({ success: true, result: { subdomain: state.sub } }) }
    }
    // prtype.dev is the site Worker: the share paths reach the host only once it binds HOST.
    if (u.host === 'prtype.dev') {
      if (!state.siteBound) return new Response('Shared links are not open yet.', { status: 503 })
      if (u.pathname === '/_health' && state.health++ < state.tlsAfter) throw new TypeError('fetch failed')
    }
    return hostAnswer(u, init)
  }
  // The share host as host/worker.mjs answers, by the name asked and the config it was deployed with.
  const notFound = () => new Response('not found', { status: 404, headers: { 'x-robots-tag': 'noindex' } })
  const hostAnswer = (u, init) => {
    const vars = state.host
    if (!vars) return new Response('There is nothing here yet', { status: 404 })
    if (u.pathname === '/_health') return new Response('ok', { headers: { 'x-proto-host': vars.HOST_VERSION } })
    if (vars.LEGACY && u.host === vars.LEGACY) {
      if (u.pathname.startsWith('/api') || u.pathname.startsWith('/auth')) return json({ code: 'moved', error: `This host moved to https://${vars.BASE}.` }, 410)
      return new Response(null, { status: 308, headers: { location: `https://${vars.BASE}${u.pathname}` } })
    }
    if (u.host !== vars.BASE) return notFound()
    if (u.pathname === '/api/shares') {
      const t = (init.headers?.authorization || '').replace('Bearer ', '')
      const known = sql.prepare('SELECT 1 FROM owner_tokens WHERE revoked_at IS NULL AND sha256 = ?').get(createHash('sha256').update(t).digest('hex'))
      return json(known ? [] : { code: 'token' }, known ? 200 : 401)
    }
    // Sign-in on: a dummy share is not found (404); off, the "didn't finish" page (400).
    if (u.pathname === '/auth/github') return vars.SIGNIN === '1' && state.secrets.has('GITHUB_CLIENT_SECRET') ? notFound() : new Response('signin', { status: 400 })
    return notFound()
  }
  // What a person would see, once setup is done: the share paths answered by the host, old links moved.
  state.linksWork = async token => {
    const api = await fetch('https://prtype.dev/api/shares', { headers: { authorization: `Bearer ${token}` } })
    const old = await fetch(`https://proto-share.${state.sub}.workers.dev/s/k3x9p2m4q7/`, { redirect: 'manual' })
    const signin = await fetch('https://prtype.dev/auth/github?share=k3x9p2m4q7&nonce=x', { redirect: 'manual' })
    return api.status === 200 && old.status === 308 && old.headers.get('location') === 'https://prtype.dev/s/k3x9p2m4q7/' && signin.status === 404
  }

  return { sql, state, wrangler, fetch }
}

import { createHash } from 'node:crypto'

// A temporary HOME, a copy of the site's config, and every outside call faked.
function rig(cf, { tokens = new Map(), hosts = [] } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'proto-online-'))
  const siteDir = join(home, 'site')
  mkdirSync(join(siteDir, 'dist'), { recursive: true })
  // The site's config as it was before setup bound the host: the binding back to its placeholder.
  writeFileSync(join(siteDir, 'wrangler.jsonc'), read(new URL('../site/wrangler.jsonc', import.meta.url), 'utf8').replace(/,\n\s*\/\/ The share host, reached[^\n]*\n\s*"services"[^\n]*\n/, '\n  // Added once the share host is deployed (proto share setup):\n  // "services": [{ "binding": "HOST", "service": "<the share host\'s Worker name>" }]\n'))
  const out = []
  const io = {
    wrangler: cf.wrangler, fetch: cf.fetch, log: l => out.push(l), sleep: async () => {},
    getToken: n => tokens.get(n) || null, setToken: (n, t) => tokens.set(n, t),
    saveHost: h => { hosts = [...hosts.filter(x => x.name !== h.name), h] }, readHosts: () => hosts,
    hostname: 'Test Mac', ghLogin: () => 'Dananz', build: () => true, siteDir,
    prodVars: () => ({ GITHUB_CLIENT_ID: SECRET_ID, GITHUB_CLIENT_SECRET: SECRET }),
    hostVersion: VERSION,
    waits: { up: 50, upEvery: 1, tls: 50, tlsEvery: 1, zone: 0, zoneEvery: 1 },
  }
  const was = process.env.HOME
  process.env.HOME = home
  return { io, out, tokens, home, siteDir, hosts: () => hosts, done: () => { process.env.HOME = was; rmSync(home, { recursive: true, force: true }) } }
}
const configOf = home => JSON.parse(read(join(home, '.prototypes', 'host', 'online', 'wrangler.jsonc'), 'utf8').replace(/^\/\/.*\n/, ''))

test('setup online: the steps in order, the workers.dev name registered, then a re-run makes nothing new', async () => {
  const cf = fakeCloudflare()
  const r = rig(cf)
  try {
    const entry = await setupOnline({ 'plan-checked': true }, r.io)
    assert.deepEqual(r.out.map(l => l.split(':')[0]), ['Cloudflare', 'Plan', 'workers.dev', 'KV', 'D1', 'Migrations', 'Config', 'Deployed proto-share', 'Secrets', 'Owner', 'Check', 'Online share host at https', 'Viewers can read; comments open once prtype.dev is set up'])
    assert.equal(cf.state.sub, 'dananz-proto')
    assert.ok(cf.state.rest.includes('PUT /client/v4/accounts/acc1/workers/subdomain'))
    // The subdomain comes before the first deploy, which fails without one.
    assert.ok(r.out.findIndex(l => l.startsWith('workers.dev')) < r.out.findIndex(l => l.startsWith('Deployed')))
    const c = configOf(r.home)
    assert.equal(c.workers_dev, true)
    assert.equal(c.preview_urls, false)
    assert.equal(c.routes, undefined)
    assert.match(c.d1_databases[0].migrations_dir, /host\/migrations$/)
    assert.equal(c.migrations_dir, undefined)
    assert.deepEqual(c.vars, { BASE: 'proto-share.dananz-proto.workers.dev', PATH_MODE: '1', SIGNIN: '0', LEGACY: '', HOST_VERSION: VERSION })
    assert.deepEqual(c.triggers.crons, [CRON])
    assert.deepEqual([...cf.state.secrets.keys()].sort(), ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'VIEWER_KEY'])
    assert.equal(cf.sql.prepare("SELECT v FROM meta WHERE k = 'owner_id'").get().v, cf.sql.prepare('SELECT id FROM owners').get().id)
    assert.ok(r.tokens.get('online'))
    assert.deepEqual({ ...entry, accountId: entry.accountId }, r.hosts().find(h => h.name === 'online'))
    assert.equal(entry.stage, 'workers')
    assert.equal(entry.url, 'https://proto-share.dananz-proto.workers.dev')
    assert.equal(entry.default, true)
    assert.equal(entry.planChecked, true)
    // Every wrangler ran with the account named, never logged in another way.
    assert.ok(cf.state.calls.slice(1).every(c => c.env?.CLOUDFLARE_ACCOUNT_ID === 'acc1'))

    const key = cf.state.secrets.get('VIEWER_KEY'), token = r.tokens.get('online')
    cf.state.calls.length = 0
    r.out.length = 0
    // Again, without --plan-checked: the host entry remembers it was checked.
    await setupOnline({}, r.io)
    const made = cf.state.calls.filter(c => c.args.includes('create'))
    assert.deepEqual(made, [])
    assert.ok(!cf.state.calls.some(c => c.args.join(' ') === 'secret put VIEWER_KEY -c ' + join(r.home, '.prototypes', 'host', 'online', 'wrangler.jsonc')))
    assert.equal(cf.state.secrets.get('VIEWER_KEY'), key)
    assert.equal(r.tokens.get('online'), token)
    assert.equal(cf.sql.prepare('SELECT COUNT(*) AS n FROM owner_tokens').get().n, 1)
    assert.ok(r.out.some(l => l === 'workers.dev: dananz-proto.workers.dev'))
  } finally { r.done() }
})

test('setup online: secrets go in on stdin, never in argv, a log line or an error', async () => {
  const cf = fakeCloudflare()
  const r = rig(cf)
  try {
    await setupOnline({ 'plan-checked': true }, r.io)
    const puts = cf.state.calls.filter(c => c.args[0] === 'secret' && c.args[1] === 'put')
    assert.deepEqual(puts.map(c => c.args[2]), ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'VIEWER_KEY'])
    assert.equal(puts[1].input, SECRET)
    const key = cf.state.secrets.get('VIEWER_KEY')
    for (const c of cf.state.calls) for (const s of [SECRET_ID, SECRET, key]) assert.ok(!c.args.join(' ').includes(s), `a secret in argv: ${c.args.join(' ')}`)
    for (const s of [SECRET_ID, SECRET, key]) assert.ok(!r.out.join('\n').includes(s), 'a secret in the output')
    // A failing put quotes wrangler's output with the values taken out.
    const failing = { ...cf, wrangler: (args, opts) => args[1] === 'put' ? { status: 1, stdout: '', stderr: `refused ${opts.input}` } : cf.wrangler(args, opts) }
    const r2 = rig(failing)
    try {
      await assert.rejects(setupOnline({ 'plan-checked': true }, r2.io), e => { assert.ok(!e.message.includes(SECRET_ID) && e.message.includes('[redacted]'), e.message); return true })
    } finally { r2.done() }
    assert.equal(redact(`a ${SECRET} b`, [SECRET]), 'a [redacted] b')
  } finally { r.done() }
})

test('setup online: the guard refuses another account, an unchecked plan, and a config with paid bindings', async () => {
  const other = fakeCloudflare({ zones: [{ id: 'z0', name: 'dananz.com', status: 'active' }, { id: 'z1', name: 'prtype.dev', status: 'active' }] })
  const r = rig(other)
  try {
    await assert.rejects(setupOnline({ 'plan-checked': true }, r.io), /not the separate prtype\.dev account \(it has dananz\.com\)[^]*wrangler-home[^]*logout/)
    await assert.rejects(setupOnline({}, rig(fakeCloudflare()).io), /Workers & Pages › Plans[^]*--plan-checked/)
    assert.ok(!other.state.calls.some(c => c.args[0] === 'deploy'), 'deployed past the guard')
  } finally { r.done() }
  const good = onlineConfig({ accountId: 'a', kvId: 'k', dbId: 'd', base: 'x.workers.dev', hostVersion: 'v' })
  assert.doesNotThrow(() => assertFreeConfig(good))
  for (const bad of [{ r2_buckets: [{ binding: 'R2' }] }, { durable_objects: {} }, { queues: {} }, { services: [] }, { limits: {} }, { usage_model: 'unbound' }, { migrations_dir: 'x' }, { routes: [{ pattern: 'prtype.dev', custom_domain: true }] }]) {
    assert.throws(() => assertFreeConfig({ ...good, ...bad }), /a free host doesn't use/, JSON.stringify(bad))
  }
  assert.throws(() => assertFreeConfig({ ...good, triggers: { crons: ['1 * * * *', '2 * * * *'] } }), /one cron/)
  // No r2 command anywhere in the setup's code.
  assert.doesNotMatch(read(new URL('../scripts/share-online.mjs', import.meta.url), 'utf8'), /['"]r2['"]/)
})

test('prod.vars: comments and quotes read, other keys and a readable mode refused, no value in an error', () => {
  assert.deepEqual(parseVars(`# prtype.dev\nGITHUB_CLIENT_ID=abc\n\nGITHUB_CLIENT_SECRET="s3cr3t"\n`, ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET']), { GITHUB_CLIENT_ID: 'abc', GITHUB_CLIENT_SECRET: 's3cr3t' })
  assert.throws(() => parseVars('GITHUB_CLIENT_ID=abc\nGITHUB_CLIENT_SECRET=x\nOTHER=hush', ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET']), e => /OTHER/.test(e.message) && !e.message.includes('hush'))
  assert.throws(() => parseVars('GITHUB_CLIENT_ID=abc', ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET']), /no GITHUB_CLIENT_SECRET/)
  assert.throws(() => parseVars('nonsense hush', ['GITHUB_CLIENT_ID']), e => /Line 1/.test(e.message) && !e.message.includes('hush'))
  const dir = mkdtempSync(join(tmpdir(), 'proto-vars-'))
  try {
    const f = join(dir, 'prod.vars')
    writeFileSync(f, 'GITHUB_CLIENT_ID=abc\nGITHUB_CLIENT_SECRET=def\n')
    chmodSync(f, 0o644)
    assert.throws(() => readProdVars(f), /mode 644[^]*chmod 600/)
    chmodSync(f, 0o600)
    assert.deepEqual(readProdVars(f), { GITHUB_CLIENT_ID: 'abc', GITHUB_CLIENT_SECRET: 'def' })
    chmodSync(f, 0o400)
    assert.deepEqual(readProdVars(f), { GITHUB_CLIENT_ID: 'abc', GITHUB_CLIENT_SECRET: 'def' })
    chmodSync(f, 0o600)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('a token lost from this Mac is made again, and the old one\'s row is revoked', async () => {
  const sql = new DatabaseSync(':memory:')
  sql.exec(read(new URL('../host/schema.sql', import.meta.url), 'utf8'))
  const run = async text => /^\s*select/i.test(text) ? sql.prepare(text).all() : (sql.prepare(text).run(), [])
  const store = new Map()
  const first = await ownerAndToken({ sql: run, name: () => 'Dananz', tokenName: 'online', device: 'Studio', get: n => store.get(n), set: (n, t) => store.set(n, t) })
  assert.equal(first.minted, true)
  const old = store.get('online')
  // Another Mac's token stays.
  await ownerAndToken({ sql: run, name: () => 'x', tokenName: 'online', device: 'M4', get: () => null, set: () => {} })
  store.delete('online')
  const again = await ownerAndToken({ sql: run, name: () => 'nobody', tokenName: 'online', device: 'Studio', get: n => store.get(n), set: (n, t) => store.set(n, t) })
  assert.equal(again.minted, true)
  assert.equal(again.owner.name, 'Dananz')
  assert.notEqual(store.get('online'), old)
  const rows = sql.prepare('SELECT device, revoked_at IS NOT NULL AS revoked FROM owner_tokens ORDER BY created_at, rowid').all().map(r => `${r.device}:${r.revoked}`)
  assert.deepEqual(rows.sort(), ['M4:0', 'Studio:0', 'Studio:1'])
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM owners').get().n, 1)
  assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM meta WHERE k = 'owner_id'").get().n, 1)
})

test('setup --domain: a zone missing or pending stops with the step to take and changes nothing', async () => {
  const missing = fakeCloudflare({ zones: [] })
  const r = rig(missing)
  try {
    assert.equal(await setupOnline({ 'plan-checked': true, domain: 'prtype.dev' }, r.io), null)
    assert.match(r.out.join('\n'), /Add a domain › prtype\.dev › Free[^]*Run this again when it's added/)
    assert.ok(!missing.state.calls.some(c => c.args[0] === 'deploy'))
  } finally { r.done() }
  const pending = fakeCloudflare({ zones: [{ id: 'z1', name: 'prtype.dev', status: 'pending', plan: { legacy_id: 'free' }, name_servers: ['ada.ns.cloudflare.com', 'bob.ns.cloudflare.com'] }] })
  const p = rig(pending)
  try {
    assert.equal(await setupOnline({ 'plan-checked': true, domain: 'prtype.dev' }, p.io), null)
    assert.match(p.out.join('\n'), /ada\.ns\.cloudflare\.com and bob\.ns\.cloudflare\.com[^]*up to 48 h/)
    assert.ok(!pending.state.calls.some(c => c.args[0] === 'deploy'))
  } finally { p.done() }
  const paid = fakeCloudflare({ zones: [{ id: 'z1', name: 'prtype.dev', status: 'active', plan: { legacy_id: 'pro', name: 'Pro' } }] })
  const q = rig(paid)
  try { await assert.rejects(setupOnline({ 'plan-checked': true, domain: 'prtype.dev' }, q.io), /Pro plan/) } finally { q.done() }
})

test('setup --domain on an active zone: the site reaches the host before the host moves behind it; links work; a re-run only deploys the host', async () => {
  const cf = fakeCloudflare()
  const r = rig(cf)
  try {
    await setupOnline({ 'plan-checked': true }, r.io)
    assert.equal(await cf.state.linksWork(r.tokens.get('online')), false)
    const entry = await setupOnline({ domain: 'prtype.dev' }, r.io)
    // workers.dev first (as it was), then the site with the binding, and only then the host's domain config.
    assert.deepEqual(cf.state.deploys, ['host:workers', 'host:workers', 'site', 'host:domain'])
    assert.ok(await cf.state.linksWork(r.tokens.get('online')), 'after --domain the links on prtype.dev do not work')
    const c = configOf(r.home)
    assert.deepEqual(c.vars, { BASE: 'prtype.dev', PATH_MODE: '1', SIGNIN: '1', LEGACY: 'proto-share.dananz-proto.workers.dev', HOST_VERSION: VERSION })
    assert.equal(c.routes, undefined)
    assert.equal(c.workers_dev, true)
    const site = read(join(r.siteDir, 'wrangler.jsonc'), 'utf8')
    assert.match(site, /"services": \[\{ "binding": "HOST", "service": "proto-share" \}\]/)
    assert.doesNotMatch(site, /Added once the share host is deployed/)
    // Still JSON once its comments are gone, with the domain route the site already had.
    const parsed = JSON.parse(site.replace(/^\s*\/\/.*$/gm, ''))
    assert.deepEqual(parsed.routes, [{ pattern: 'prtype.dev', custom_domain: true }])
    assert.equal(entry.stage, 'domain')
    assert.equal(entry.url, 'https://prtype.dev')
    assert.equal(entry.workersDev, 'proto-share.dananz-proto.workers.dev')
    assert.deepEqual(cf.sql.prepare("SELECT k, v FROM meta WHERE k IN ('stage', 'base') ORDER BY k").all().map(x => `${x.k}=${x.v}`), ['base=prtype.dev', 'stage=domain'])
    assert.match(r.out.at(-1), /prtype\.dev is live: links are https:\/\/prtype\.dev\/<id>/)

    cf.state.deploys.length = 0
    await setupOnline({}, r.io)
    assert.deepEqual(cf.state.deploys, ['host:domain'])
    assert.equal(configOf(r.home).vars.BASE, 'prtype.dev')
    assert.ok(await cf.state.linksWork(r.tokens.get('online')))
  } finally { r.done() }
})

test('a plain setup never moves a host on the domain back to workers.dev, even with this Mac\'s entry gone', async () => {
  const cf = fakeCloudflare()
  const r = rig(cf)
  try {
    await setupOnline({ 'plan-checked': true }, r.io)
    await setupOnline({ domain: 'prtype.dev' }, r.io)
    // Another Mac: no host entry, no token.
    const other = rig(cf)
    try {
      cf.state.deploys.length = 0
      await assert.rejects(setupOnline({ 'plan-checked': true }, other.io), /live on prtype\.dev[^]*proto share setup --domain prtype\.dev/)
      assert.deepEqual(cf.state.deploys, [])
      assert.ok(await cf.state.linksWork(r.tokens.get('online')), 'the refused run broke the links')
      // With --domain it deploys straight behind the domain, and adds that Mac's token.
      const entry = await setupOnline({ 'plan-checked': true, domain: 'prtype.dev' }, other.io)
      // (its checkout's site config has no binding yet, so the site is deployed too)
      assert.deepEqual(cf.state.deploys, ['host:domain', 'site'])
      assert.equal(entry.stage, 'domain')
      assert.ok(await cf.state.linksWork(other.tokens.get('online')))
    } finally { other.done() }
  } finally { r.done() }
})

test('setup --domain: a certificate not issued yet times out with the re-run advice, and the links stay on workers.dev', async () => {
  const cf = fakeCloudflare()
  const r = rig(cf)
  try {
    await setupOnline({ 'plan-checked': true }, r.io)
    cf.state.tlsAfter = 1e9
    await assert.rejects(setupOnline({ domain: 'prtype.dev' }, r.io), /doesn't answer over TLS yet[^]*15 minutes to 24 hours[^]*Links keep working on workers\.dev meanwhile[^]*again later/)
    assert.equal(r.hosts().find(h => h.name === 'online').stage, 'workers')
    // The host never moved: its links on workers.dev still answer.
    assert.equal(configOf(r.home).vars.BASE, 'proto-share.dananz-proto.workers.dev')
    assert.ok(!cf.state.deploys.includes('host:domain'))
  } finally { r.done() }
})

test('setup --domain as the very first run: a TLS wait that times out still leaves the workers.dev host and the plan check', async () => {
  const cf = fakeCloudflare()
  const r = rig(cf)
  try {
    cf.state.tlsAfter = 1e9
    await assert.rejects(setupOnline({ 'plan-checked': true, domain: 'prtype.dev' }, r.io), /over TLS yet/)
    const entry = r.hosts().find(h => h.name === 'online')
    assert.equal(entry.stage, 'workers')
    assert.equal(entry.planChecked, true)
    cf.state.tlsAfter = 0
    cf.state.health = 0
    assert.equal((await setupOnline({ domain: 'prtype.dev' }, r.io)).stage, 'domain')
  } finally { r.done() }
})

test('setup --github writes the local OAuth App beside the viewer key, mode 600, and restarts nothing', async () => {
  const home = mkdtempSync(join(tmpdir(), 'proto-gh-'))
  const was = process.env.HOME
  process.env.HOME = home
  try {
    const out = []
    mkdirSync(join(home, '.prototypes', 'host'), { recursive: true })
    writeFileSync(join(home, '.prototypes', 'host', '.dev.vars'), 'VIEWER_KEY=keep-this-viewer-key\n')
    await setupGithub({ 'client-id': 'Ov23liLOCALID12' }, { log: l => out.push(l), read: async (n, prompts) => { assert.deepEqual(prompts.map(p => p.hidden), [true]); return ['0123456789abcdef0123456789abcdef01234567'] }, port: 8787 })
    const file = join(home, '.prototypes', 'host', '.dev.vars')
    assert.equal(statSync(file).mode & 0o777, 0o600)
    assert.deepEqual(read(file, 'utf8').split('\n').filter(Boolean).map(l => l.split('=')[0]).sort(), ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'VIEWER_KEY'])
    assert.match(read(file, 'utf8'), /^VIEWER_KEY=keep-this-viewer-key$/m)
    assert.match(out.join('\n'), /callback URL: http:\/\/localhost:8787\/auth\/github\/callback/)
    assert.match(out.at(-1), /proto share stop && proto share setup --local/)
    assert.ok(!out.join('\n').includes('0123456789abcdef0123456789abcdef01234567'))
    await assert.rejects(setupGithub({}, { log: () => {}, read: async () => ['x', 'y'] }), /client id/)
  } finally { process.env.HOME = was; rmSync(home, { recursive: true, force: true }) }
})

test('every wrangler the share tool starts runs on its own login', () => {
  for (const f of ['../scripts/share-host.mjs', '../scripts/share-online.mjs', './share-online-checks.mjs']) {
    const url = new URL(f, import.meta.url)
    if (!exists(url)) continue
    const lines = read(url, 'utf8').split('\n')
    for (const [i, line] of lines.entries()) {
      // The call and the two lines after it, where a long call puts its options.
      if (/\b(spawn|spawnSync)\(process\.execPath, \[(tools|t)\.wrangler/.test(line)) assert.match(lines.slice(i, i + 3).join('\n'), /wranglerEnv\(|wenv\(\)/, `${f}:${i + 1} starts wrangler without wranglerEnv()`)
    }
  }
})

test('wrangler never sees a Cloudflare token or key from the shell', async () => {
  const { wranglerEnv } = await import('../scripts/share-host.mjs')
  const was = { ...process.env }
  Object.assign(process.env, { CLOUDFLARE_API_TOKEN: 't', CLOUDFLARE_API_KEY: 'k', CLOUDFLARE_EMAIL: 'e@x' })
  try {
    const env = wranglerEnv({ CLOUDFLARE_ACCOUNT_ID: 'acc1' })
    for (const k of ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_API_KEY', 'CLOUDFLARE_EMAIL']) assert.equal(env[k], undefined, k)
    assert.equal(env.CLOUDFLARE_ACCOUNT_ID, 'acc1')
    assert.match(env.XDG_CONFIG_HOME, /wrangler-home$/)
  } finally { for (const k of ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_API_KEY', 'CLOUDFLARE_EMAIL']) if (!(k in was)) delete process.env[k] }
})

test('an update to a host that moved waits in the outbox, and the error names setup', async () => {
  const { flush, queue, outboxFile } = await import('../app/share/owner.mjs')
  const dir = mkdtempSync(join(tmpdir(), 'proto-moved-'))
  try {
    queue(dir, [{ host: 'online', share: 'k3x9p2m4q7', comment: 'c1', status: 'done' }])
    const fetch = async () => new Response(JSON.stringify({ code: 'moved', error: 'This host moved to https://prtype.dev.' }), { status: 410 })
    const api = client(workers, TOKEN, { fetch })
    await assert.rejects(api.patch('c1', { status: 'done' }), e => /moved[^]*proto share setup to point this Mac at it/.test(e.message))
    const r = await flush(dir, { clientFor: () => api })
    assert.deepEqual(r, { delivered: 0, kept: 1 })
    assert.match(read(outboxFile(dir), 'utf8'), /"status":"done"/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
