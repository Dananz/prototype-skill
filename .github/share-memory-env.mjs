// The share host's bindings in memory, for the unit checks that run host/worker.mjs in this process:
// D1 on node:sqlite from schema.sql, KV on a Map. Its own module so a check file can use it without
// importing (and so running) another file's tests.
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'

export const TOKEN = 'owner-token-for-online-tests'
export const hex = async s => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map(b => b.toString(16).padStart(2, '0')).join('')

// One owner, o1, named by meta.owner_id as setup leaves it, and so the admin, as 0006 makes it.
// `ops` counts every D1 query and KV call: each is one of a Free invocation's 50 subrequests.
export async function memoryEnv(extra = {}) {
  const sql = new DatabaseSync(':memory:')
  sql.exec(readFileSync(new URL('../host/schema.sql', import.meta.url), 'utf8'))
  sql.prepare("INSERT INTO owners (id, name, created_at, role) VALUES (?, ?, ?, 'admin')").run('o1', 'Dananz', 1)
  sql.prepare('INSERT INTO owner_tokens (sha256, owner_id, device, created_at) VALUES (?, ?, ?, ?)').run(await hex(TOKEN), 'o1', 'test', 1)
  sql.prepare("INSERT INTO meta (k, v) VALUES ('owner_id', 'o1')").run()
  const store = new Map()
  const ops = { n: 0 }
  const KV = {
    store,
    async get(key, type) { ops.n++; const v = store.get(key); if (v === undefined) return null; return type === 'arrayBuffer' ? v.slice(0) : new TextDecoder().decode(v) },
    async put(key, value) { ops.n++; store.set(key, value instanceof ArrayBuffer ? value.slice(0) : value instanceof Uint8Array ? value.slice().buffer : new TextEncoder().encode(String(value)).buffer) },
    async delete(key) { ops.n++; store.delete(key) },
  }
  const stmt = (query, args = []) => ({
    bind: (...a) => stmt(query, a),
    first: async () => { ops.n++; return sql.prepare(query).get(...args) ?? null },
    all: async () => { ops.n++; return { results: sql.prepare(query).all(...args) } },
    run: async () => { ops.n++; const r = sql.prepare(query).run(...args); return { success: true, meta: { changes: Number(r.changes), rows_written: Number(r.changes) } } },
  })
  const DB = { sql, ops, prepare: q => stmt(q), async batch(list) { const out = []; for (const s of list) out.push(await s.run()); return out } }
  return { KV, DB, BASE: 'prtype.dev', PATH_MODE: '1', SIGNIN: '0', ...extra }
}
