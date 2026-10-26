// Brings a database made by an older host/schema.sql up to the current one, once per isolate.
// schema.sql runs only when the local host starts, while `wrangler dev` reloads this Worker on every
// save, so a running host meets a phase-0 database. Additive only; the unit checks compare the
// result with a fresh schema.sql, so the two can't drift apart.
const TABLES = [
  `CREATE TABLE IF NOT EXISTS viewers (gh_id INTEGER PRIMARY KEY, login TEXT NOT NULL, name TEXT, avatar TEXT, seen_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS caps (what TEXT NOT NULL, slot INTEGER NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (what, slot))`,
]
// ADD COLUMN can't add NOT NULL without a default, hence deleted's.
const COLUMNS = [
  ['gh_id', 'INTEGER'], ['variant', 'TEXT'], ['target', 'TEXT'], ['owner_reply_at', 'INTEGER'], ['deleted', 'INTEGER NOT NULL DEFAULT 0'],
]

const done = new WeakMap()

export function upgraded(db) {
  if (!done.has(db)) {
    const p = upgrade(db).catch(e => { done.delete(db); throw e })
    done.set(db, p)
  }
  return done.get(db)
}

async function upgrade(db) {
  for (const t of TABLES) await db.prepare(t).run()
  const { results } = await db.prepare('PRAGMA table_info(comments)').all()
  const have = new Set(results.map(c => c.name))
  for (const [name, type] of COLUMNS) {
    if (have.has(name)) continue
    try {
      await db.prepare(`ALTER TABLE comments ADD COLUMN ${name} ${type}`).run()
    } catch (e) {
      // Another isolate may have added it a moment ago.
      if (!/duplicate column/i.test(String(e?.message || e))) throw e
    }
  }
}
