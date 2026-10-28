// The cron (one trigger, hourly): the small tables pruned so they stay small, then a few of the KV
// deletes that waited in kv_trash for a day with budget. A run is one invocation, held to Free's 50
// subrequests (each D1 query and each KV call is one) and its 10 ms of CPU, so it takes a small batch
// each hour rather than the whole queue at once.
import { pruneCaps } from './comments.mjs'
import { today, usedOf, spend } from './budget.mjs'

// The wrangler config's triggers.crons must hold exactly this (the online setup writes it).
export const CRON = '17 * * * *'

const DAY_MS = 86_400_000
const BATCH = 30 // KV deletes per run: 30 a hour is 720 a day
const CEILING = 800 // of the day's 900 deletes; the rest stays for the day's own updates
const KEEP_DAYS = 7
const PRESENCE_DAYS = 30 // the owner list shows faces from the last 30 days
const PURGE_DAYS = 30 // an expired share's page and card are deleted this long after it expired
const PURGE_BATCH = 50 // shares a run purges at most; their keys wait in kv_trash like any other
const SIGNIN_GRACE_MS = 60_000 // users.mjs: a finished sign-in can be polled a minute past its expiry

// Shares expired more than 30 days ago lose their page and card (decision 25): the keys go to
// kv_trash, which this same run and the next ones drain within the day's deletes, and the row says
// purged_at. The tombstone, the comments and the expiry page stay; an update uploads the page again
// and renews the link, as it always has. The batch is picked once, and both writes take only those
// rows still due: a share renewed meanwhile keeps its new key and is not marked purged. Three queries.
export async function purge(env, now = Date.now()) {
  const before = now - PURGE_DAYS * DAY_MS
  const still = 'deleted_at IS NULL AND purged_at IS NULL AND expires_at IS NOT NULL AND expires_at < ?'
  const { results } = await env.DB.prepare(`SELECT id FROM shares WHERE ${still} ORDER BY expires_at, id LIMIT ${PURGE_BATCH}`).bind(before).all()
  if (!results.length) return
  // One bound value whatever the batch (D1 binds at most 100).
  const ids = JSON.stringify(results.map(r => r.id))
  const due = `FROM shares WHERE id IN (SELECT value FROM json_each(?)) AND ${still}`
  await env.DB.prepare(`INSERT INTO kv_trash (key, at) SELECT COALESCE(html_key, 'html:' || id || ':' || version), ? ${due} UNION ALL SELECT card_key, ? ${due} AND card_key IS NOT NULL ON CONFLICT(key) DO NOTHING`).bind(now, ids, before, now, ids, before).run()
  await env.DB.prepare(`UPDATE shares SET purged_at = ?, card_key = NULL WHERE id IN (SELECT value FROM json_each(?)) AND ${still}`).bind(now, ids, before).run()
}

// About 12 D1 queries besides the BATCH KV deletes, so a run stays under 50.
export async function cron(env, now = Date.now()) {
  try {
    await pruneCaps(env, now)
    await env.DB.prepare('DELETE FROM tickets WHERE exp < ?').bind(now).run()
    await env.DB.prepare('DELETE FROM signins WHERE exp < ?').bind(now - SIGNIN_GRACE_MS).run()
    await env.DB.prepare('DELETE FROM budget WHERE day < ?').bind(today(now - KEEP_DAYS * DAY_MS)).run()
    await env.DB.prepare('DELETE FROM presence WHERE at < ?').bind(now - PRESENCE_DAYS * DAY_MS).run()
    await purge(env, now)
  } catch (e) {
    // A failed prune leaves the trash to drain anyway.
    console.error(e)
  }
  const n = Math.min(BATCH, CEILING - await usedOf(env.DB, 'kv_delete', now))
  if (n <= 0) return
  const { results } = await env.DB.prepare('SELECT key FROM kv_trash ORDER BY at, key LIMIT ?').bind(n).all()
  const gone = []
  for (const { key } of results) {
    try {
      await env.KV.delete(key)
      gone.push(key)
    } catch (e) {
      console.error(e)
    }
  }
  if (!gone.length) return
  await env.DB.prepare(`DELETE FROM kv_trash WHERE key IN (${gone.map(() => '?').join(', ')})`).bind(...gone).run()
  await spend(env.DB, 'kv_delete', gone.length)
}
