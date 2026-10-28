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
/**
 * Takes n of today's `what` if they fit, in one statement, so requests at once can't all pass a read
 * and then all spend: true when taken (and so already spent).
 */
export async function claim(db, what, n = 1) {
  const r = await db.prepare('INSERT INTO budget (day, what, n) SELECT ?, ?, ? WHERE ? <= ? ON CONFLICT(day, what) DO UPDATE SET n = budget.n + excluded.n WHERE budget.n + excluded.n <= ?')
    .bind(today(), what, n, n, CAPS[what], CAPS[what]).run()
  return (r.meta?.changes ?? 0) > 0
}
export const spend = (db, what, n = 1) => db.prepare('INSERT INTO budget (day, what, n) VALUES (?, ?, ?) ON CONFLICT(day, what) DO UPDATE SET n = budget.n + excluded.n').bind(today(), what, n).run()

/** What the shares hold in KV (one version each; a removed or purged share's key is gone or queued). */
export const storedBytes = async (db, except = '') => (await db.prepare('SELECT COALESCE(SUM(bytes), 0) AS n FROM shares WHERE deleted_at IS NULL AND purged_at IS NULL AND id != ?').bind(except).first())?.n ?? 0

// "03:00 in Israel" (02:00 in summer); without a time zone database it is left out.
function inIsrael(ms) {
  try { return `${new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(ms)} in Israel` } catch { return null }
}
export function resetText(now = Date.now()) {
  const there = inIsrael(resetsAt(now))
  return `It resets at 00:00 UTC${there ? ` (${there})` : ''}.`
}

export const mb = n => `${Math.round(n / 1e5) / 10} MB`

// ---------- bytes held while an upload is in flight ----------
// What the shares hold is their rows' SUM(bytes); an upload's bytes are in no row until it lands. So
// each upload first holds its bytes in a caps row (`held:<who>`, this hour), in one conditional
// statement that adds the rows' sum and what others hold now: uploads at once can't all fit. The
// hold is let go once the row says the bytes (or the upload failed). A hold a crash left behind
// lasts at most the hour (the cron prunes past hours).
const hour = () => Math.floor(Date.now() / 3_600_000)

/** Holds `bytes` under `what` if `sum` (SQL, its ? bound to `args`) plus every hold plus them fits `cap`: the slot to let go, or null. */
export async function holdBytes(db, what, bytes, cap, sum, args) {
  const slot = hour()
  const r = await db.prepare(
    `INSERT INTO caps (what, slot, n) SELECT ?, ?, ? WHERE (${sum}) + ? <= ?
     ON CONFLICT(what, slot) DO UPDATE SET n = caps.n + excluded.n WHERE (${sum}) + caps.n + excluded.n <= ?`,
  ).bind(what, slot, bytes, ...args, bytes, cap, ...args, cap).run()
  return (r.meta?.changes ?? 0) > 0 ? slot : null
}
export const letGo = (db, what, slot, bytes) => db.prepare('UPDATE caps SET n = MAX(n - ?, 0) WHERE what = ? AND slot = ?').bind(bytes, what, slot).run()

const ALL = 'SELECT COALESCE(SUM(bytes), 0) FROM shares WHERE deleted_at IS NULL AND purged_at IS NULL AND id != ?'

/**
 * Today's KV write and room for `bytes` more in what the host holds, taken at once for an upload to
 * share `id`: { refused } (the 507, nothing taken) or { release } (lets the bytes go; call it once
 * the share's row says them, or the upload failed). The write is spent when taken. The biggest
 * shares it names are the uploader's own: other users' titles are not theirs to read.
 */
export async function reserveStore(env, id, bytes, ownerId) {
  if (!await claim(env.DB, 'kv_write')) return { refused: fail(507, `The host's daily upload budget is used up. ${resetText()}`, { code: 'budget' }) }
  const slot = await holdBytes(env.DB, 'held:all', bytes, CAPS.kv_bytes, ALL, [id])
  if (slot !== null) return { release: () => letGo(env.DB, 'held:all', slot, bytes) }
  // Not written: the write taken above goes back.
  await env.DB.prepare('UPDATE budget SET n = n - 1 WHERE day = ? AND what = ? AND n > 0').bind(today(), 'kv_write').run()
  const { results } = await env.DB.prepare('SELECT id, title, bytes FROM shares WHERE owner_id = ? AND deleted_at IS NULL AND purged_at IS NULL ORDER BY bytes DESC LIMIT 3').bind(ownerId ?? '').all()
  const biggest = results.length ? ` Your biggest: ${results.map(s => `${s.title} (${s.id}, ${mb(s.bytes)})`).join(', ')}. proto share rm <id> frees room.` : ''
  return { refused: fail(507, `The host holds at most ${mb(CAPS.kv_bytes)} of shares, and this one would pass it.${biggest}`, { code: 'budget' }) }
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
/** A KV put whose write was taken already (claim). */
export const putClaimed = (env, key, value) => env.KV.put(key, value)

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
