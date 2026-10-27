// The host's own count of what the Free plan caps per day (spec: Limits and what happens at each
// one). It refuses work at 90% of each cap, so a full day ends in a clear message instead of
// Cloudflare's error. Days are UTC, as Cloudflare's reset is. Requests aren't counted: a counter
// write per request would spend the D1 write cap, and the request cap fails closed by itself.
import { fail } from './http.mjs'

export const CAPS = { kv_write: 900, kv_delete: 900, d1_write: 90_000, kv_bytes: 900_000_000 }

const DAY_MS = 86_400_000
export const today = (now = Date.now()) => new Date(now).toISOString().slice(0, 10)
export const resetsAt = (now = Date.now()) => Date.parse(`${today(now)}T00:00:00Z`) + DAY_MS

export async function usedOf(db, what, now = Date.now()) {
  return (await db.prepare('SELECT n FROM budget WHERE day = ? AND what = ?').bind(today(now), what).first())?.n ?? 0
}
/** Whether n more of `what` stay within today's cap. */
export const room = async (db, what, n = 1) => (await usedOf(db, what)) + n <= CAPS[what]
export const spend = (db, what, n = 1) => db.prepare('INSERT INTO budget (day, what, n) VALUES (?, ?, ?) ON CONFLICT(day, what) DO UPDATE SET n = budget.n + excluded.n').bind(today(), what, n).run()

/** What the live shares hold in KV (one version each; a removed share's key is gone or queued). */
export const storedBytes = async (db, except = '') => (await db.prepare('SELECT COALESCE(SUM(bytes), 0) AS n FROM shares WHERE deleted_at IS NULL AND id != ?').bind(except).first())?.n ?? 0

// "03:00 in Israel" (02:00 in summer); without a time zone database it is left out.
function inIsrael(ms) {
  try { return `${new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(ms)} in Israel` } catch { return null }
}
export function resetText(now = Date.now()) {
  const there = inIsrael(resetsAt(now))
  return `It resets at 00:00 UTC${there ? ` (${there})` : ''}.`
}

const mb = n => `${Math.round(n / 1e5) / 10} MB`

/**
 * Null when an upload of `bytes` to share `id` fits today's KV writes and the stored-bytes cap, else
 * the 507 to answer. Read before anything is written, so a refused upload changes nothing.
 */
export async function uploadRefused(env, id, bytes) {
  if (!await room(env.DB, 'kv_write')) return fail(507, `The host's daily upload budget is used up. ${resetText()}`, { code: 'budget' })
  if (await storedBytes(env.DB, id) + bytes <= CAPS.kv_bytes) return null
  const { results } = await env.DB.prepare('SELECT id, title, bytes FROM shares WHERE deleted_at IS NULL ORDER BY bytes DESC LIMIT 3').all()
  const biggest = results.map(s => `${s.title} (${s.id}, ${mb(s.bytes)})`).join(', ')
  return fail(507, `The host holds at most ${mb(CAPS.kv_bytes)} of shares, and this one would pass it. The biggest: ${biggest}. proto share rm <id> frees room.`, { code: 'budget' })
}

/** Puts a KV key in kv_trash, for the cron to delete. */
export const queueKey = (env, key) => env.DB.prepare('INSERT INTO kv_trash (key, at) VALUES (?, ?) ON CONFLICT(key) DO NOTHING').bind(key, Date.now()).run()

/**
 * Deletes a KV key while today's deletes last. Past that, or when the delete fails, it waits in
 * kv_trash for the cron, so the request that asked still succeeds. True when it is gone now.
 */
export async function dropKey(env, key) {
  try {
    if (await room(env.DB, 'kv_delete')) {
      await env.KV.delete(key)
      await spend(env.DB, 'kv_delete')
      return true
    }
  } catch (e) {
    console.error(e)
  }
  await queueKey(env, key)
  return false
}

export async function putCounted(env, key, value) {
  await env.KV.put(key, value)
  await spend(env.DB, 'kv_write')
}

/**
 * The env with its D1 binding counting the rows each statement writes (D1's meta.rows_written), and
 * flush() adding the sum to today's d1_write once, at the end of a request that wrote.
 */
export function metered(env) {
  let written = 0
  const add = r => { written += Number(r?.meta?.rows_written ?? 0); return r }
  const wrap = s => ({
    bind: (...a) => wrap(s.bind(...a)),
    first: (...a) => s.first(...a),
    all: async () => add(await s.all()),
    run: async () => add(await s.run()),
  })
  return {
    env: { ...env, DB: { prepare: q => wrap(env.DB.prepare(q)) } },
    async flush() {
      if (written > 0) await spend(env.DB, 'd1_write', written)
      written = 0
    },
  }
}

export async function usage(db, now = Date.now()) {
  const [kv_write, kv_delete, d1_write, kv_bytes] = await Promise.all([usedOf(db, 'kv_write', now), usedOf(db, 'kv_delete', now), usedOf(db, 'd1_write', now), storedBytes(db)])
  return { day: today(now), kv_write, kv_delete, d1_write, kv_bytes, caps: CAPS, resetsAt: resetsAt(now) }
}
