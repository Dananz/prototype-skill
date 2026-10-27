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
