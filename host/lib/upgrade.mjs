// Brings a database made by an older host/schema.sql up to the current one. schema.sql runs only
// when the local host starts, while `wrangler dev` reloads this Worker on every save, so a running
// local host meets a phase-0 database. Additive only; the unit checks compare the result with a
// fresh schema.sql, so the two can't drift apart. A deployed host gets migrations instead.
import { namesOf } from './routes.mjs'

const TABLES = [
  `CREATE TABLE IF NOT EXISTS viewers (gh_id INTEGER PRIMARY KEY, login TEXT NOT NULL, name TEXT, avatar TEXT, seen_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS caps (what TEXT NOT NULL, slot INTEGER NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (what, slot))`,
  `CREATE TABLE IF NOT EXISTS tickets (nonce TEXT PRIMARY KEY, exp INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS kv_trash (key TEXT PRIMARY KEY, at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS presence (share_id TEXT NOT NULL, gh_id INTEGER NOT NULL, route TEXT, at INTEGER NOT NULL, PRIMARY KEY (share_id, gh_id))`,
]
// ADD COLUMN can't add NOT NULL without a default, hence the defaults.
const COLUMNS = {
  comments: [
    ['gh_id', 'INTEGER'], ['variant', 'TEXT'], ['target', 'TEXT'], ['owner_reply_at', 'INTEGER'],
    ['deleted', 'INTEGER NOT NULL DEFAULT 0'], ['withdrawn', 'INTEGER NOT NULL DEFAULT 0'],
  ],
  shares: [['html_key', 'TEXT'], ['message', 'TEXT']],
  owners: [['gh_id', 'INTEGER'], ['gh_login', 'TEXT'], ['gh_name', 'TEXT'], ['gh_avatar', 'TEXT']],
}

// Once per isolate: the binding object may be new on every request, so it can't be the key. An
// isolate serves one host, so one database.
let once = null

export function upgraded(env) {
  if (!namesOf(env.BASE).local) return null
  if (!once) once = upgrade(env.DB).catch(e => { once = null; throw e })
  return once
}

export async function upgrade(db) {
  for (const t of TABLES) await db.prepare(t).run()
  for (const [table, columns] of Object.entries(COLUMNS)) {
    const { results } = await db.prepare(`PRAGMA table_info(${table})`).all()
    const have = new Set(results.map(c => c.name))
    for (const [name, type] of columns) {
      if (have.has(name)) continue
      try {
        await db.prepare(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`).run()
      } catch (e) {
        // Another isolate may have added it a moment ago.
        if (!/duplicate column/i.test(String(e?.message || e))) throw e
      }
    }
  }
  console.log('proto-share: database schema checked')
}
