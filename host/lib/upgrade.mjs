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
  `CREATE TABLE IF NOT EXISTS signins (code TEXT PRIMARY KEY, poll TEXT NOT NULL, device TEXT NOT NULL, words TEXT, exp INTEGER NOT NULL, gh_id INTEGER, owner_id TEXT, done_at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS reports (id TEXT PRIMARY KEY, share_id TEXT NOT NULL, reason TEXT NOT NULL, gh_id INTEGER, created_at INTEGER NOT NULL)`,
]
// ADD COLUMN can't add NOT NULL without a default, hence the defaults.
const COLUMNS = {
  comments: [
    ['gh_id', 'INTEGER'], ['variant', 'TEXT'], ['target', 'TEXT'], ['owner_reply_at', 'INTEGER'],
    ['deleted', 'INTEGER NOT NULL DEFAULT 0'], ['withdrawn', 'INTEGER NOT NULL DEFAULT 0'],
  ],
  shares: [['html_key', 'TEXT'], ['message', 'TEXT'], ['card_key', 'TEXT'], ['purged_at', 'INTEGER']],
  owners: [['gh_id', 'INTEGER'], ['gh_login', 'TEXT'], ['gh_name', 'TEXT'], ['gh_avatar', 'TEXT'], ['role', "TEXT NOT NULL DEFAULT 'user'"], ['status', "TEXT NOT NULL DEFAULT 'active'"]],
  owner_tokens: [['expires_at', 'INTEGER']],
  signins: [['words', 'TEXT']],
}
// After the columns, since they name gh_id: schema.sql can't create this index, because on a local
// database from before 0004 (owners without gh_id) the statement would fail and stop the file. The
// Worker runs upgrade() before its first answer, so every local database has it all the same.
const AFTER = [`CREATE UNIQUE INDEX IF NOT EXISTS owners_gh ON owners (gh_id) WHERE gh_id IS NOT NULL`]

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
  let roles = false
  for (const [table, columns] of Object.entries(COLUMNS)) {
    const { results } = await db.prepare(`PRAGMA table_info(${table})`).all()
    const have = new Set(results.map(c => c.name))
    for (const [name, type] of columns) {
      if (have.has(name)) continue
      try {
        await db.prepare(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`).run()
        if (table === 'owners' && name === 'role') roles = true
      } catch (e) {
        // Another isolate may have added it a moment ago.
        if (!/duplicate column/i.test(String(e?.message || e))) throw e
      }
    }
  }
  for (const s of AFTER) await db.prepare(s).run()
  // As 0006 does, once, when the roles first appear: the owner setup named becomes the admin.
  if (roles) await db.prepare("UPDATE owners SET role = 'admin' WHERE id = (SELECT v FROM meta WHERE k = 'owner_id')").run()
  console.log('proto-share: database schema checked')
}
