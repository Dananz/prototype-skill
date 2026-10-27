// The daily cron (one trigger, "17 0 * * *", just after the UTC reset): the KV deletes that waited
// in kv_trash for a day with budget, then the small tables pruned so they stay small.
import { pruneCaps } from './comments.mjs'
import { CAPS, today, usedOf, spend } from './budget.mjs'

const DAY_MS = 86_400_000
const DRAIN = 800 // of the day's 900 deletes; the rest stays for the day's own updates
const KEEP_DAYS = 7

export async function cron(env, now = Date.now()) {
  const n = Math.min(DRAIN, CAPS.kv_delete - await usedOf(env.DB, 'kv_delete', now))
  if (n > 0) {
    const { results } = await env.DB.prepare('SELECT key FROM kv_trash ORDER BY at LIMIT ?').bind(n).all()
    for (const { key } of results) {
      await env.KV.delete(key)
      await env.DB.prepare('DELETE FROM kv_trash WHERE key = ?').bind(key).run()
    }
    if (results.length) await spend(env.DB, 'kv_delete', results.length)
  }
  await pruneCaps(env, now)
  // An upload's claim on its version (worker.mjs putShare) is spent within the request.
  await env.DB.prepare("DELETE FROM caps WHERE what LIKE 'put:%' AND n < ?").bind(now - DAY_MS).run()
  await env.DB.prepare('DELETE FROM tickets WHERE exp < ?').bind(now).run()
  await env.DB.prepare('DELETE FROM budget WHERE day < ?').bind(today(now - KEEP_DAYS * DAY_MS)).run()
}
