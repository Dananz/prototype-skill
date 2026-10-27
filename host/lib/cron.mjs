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

// About 9 D1 queries besides the BATCH KV deletes, so a run stays under 50.
export async function cron(env, now = Date.now()) {
  try {
    await pruneCaps(env, now)
    await env.DB.prepare('DELETE FROM tickets WHERE exp < ?').bind(now).run()
    await env.DB.prepare('DELETE FROM budget WHERE day < ?').bind(today(now - KEEP_DAYS * DAY_MS)).run()
    await env.DB.prepare('DELETE FROM presence WHERE at < ?').bind(now - PRESENCE_DAYS * DAY_MS).run()
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
