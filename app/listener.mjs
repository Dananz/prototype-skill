// A durable wakeup subscription, owned by the session's server rather than an agent turn.
// Notifications are at-least-once. They never take a batch: the awakened agent reads the inbox,
// whose atomic rename still provides the once-only handoff, including after an ambiguous retry.
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const read = (file, fallback = null) => { try { return JSON.parse(readFileSync(file, 'utf8')) } catch { return fallback } }
// One listener per conversation in the project app: .proto/inbox/listeners/<sid>.json, its status and
// receipts beside it. A session app from before has one, listener.json: the listener without a sid.
const inboxOf = root => join(root, '.proto', 'inbox')
const paths = (root, sid) => sid
  ? { config: join(inboxOf(root), 'listeners', `${sid}.json`), status: join(inboxOf(root), 'listeners', `${sid}-status.json`), receipts: join(inboxOf(root), 'listeners', `${sid}-notified.json`) }
  : { config: join(inboxOf(root), 'listener.json'), status: join(inboxOf(root), 'listener-status.json'), receipts: join(inboxOf(root), 'notified.json') }
/** The conversations with a listener; null is the one listener.json of before. */
export function listenerSids(root) {
  const out = existsSync(paths(root).config) ? [null] : []
  try { for (const f of readdirSync(join(inboxOf(root), 'listeners'))) if (f.endsWith('.json') && !/-(status|notified)\.json$/.test(f) && !f.startsWith('.')) out.push(f.slice(0, -5)) } catch { /* none */ }
  return out
}
// No sid given: the only listener there is (the old single one first), as a session app had.
const which = (root, sid) => sid !== undefined ? sid : existsSync(paths(root).config) ? null : listenerSids(root)[0] ?? null
export const listenerFile = (root, sid) => paths(root, which(root, sid)).config
const active = config => !!config?.url && (config.lifecycle ?? 'active') === 'active'
export function listenerStatus(root, sid) {
  const p = paths(root, which(root, sid))
  const config = read(p.config)
  const state = read(p.status)
  const error = state?.id === config?.id ? state?.error : null
  const lifecycle = config?.lifecycle ?? (config?.url ? 'active' : 'missing')
  const hostEnabled = config?.id ? config.hostEnabled !== false : null
  const desired = lifecycle === 'active'
  const hostAction = config?.id && desired !== hostEnabled
    ? { action: desired ? 'enable' : 'disable', id: config.id, threadId: config.threadId } : null
  return { listening: active(config) && hostEnabled && !error, configured: !!config?.url,
    id: config?.id, threadId: config?.threadId, lifecycle, reason: config?.reason,
    hostEnabled, hostAction, error }
}

function write(file, value) {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
  writeFileSync(tmp, JSON.stringify(value) + '\n', { mode: 0o600, flag: 'wx' })
  try { renameSync(tmp, file) } catch (e) { rmSync(tmp, { force: true }); throw e }
}
export const saveListener = (root, config, sid) => write(listenerFile(root, sid), config)
/** The old single listener.json becomes this conversation's, when it was registered by it. */
export function adoptListener(root, sid) {
  const old = paths(root), mine = paths(root, sid)
  // One registered before configs named their conversation goes to the first that asks.
  if (!sid || !existsSync(old.config) || existsSync(mine.config)) return false
  const owner = read(old.config)?.session
  if (owner && owner !== sid) return false
  mkdirSync(join(inboxOf(root), 'listeners'), { recursive: true })
  for (const k of ['config', 'status', 'receipts']) if (existsSync(old[k])) renameSync(old[k], mine[k])
  return true
}

// Who works on a prototype now (its meta.ts owner, else its maker); scripts/project.mjs has the same.
const metaOf = (root, slug) => { try { return JSON.parse(readFileSync(join(root, 'src', 'protos', slug, 'meta.ts'), 'utf8').replace(/^[\s\S]*?export default\s*/, '').replace(/;?\s*$/, '')) } catch { return null } }
const ownerOfSlug = (root, slug) => { const m = metaOf(root, slug); return m?.owner ?? m?.session ?? null }
/** A batch belongs to the owner of its first comment's prototype; one on no prototype, to nobody. */
export function batchOwner(root, batch) {
  const route = (batch?.comments || []).map(c => c?.route).find(r => typeof r === 'string' && r)
  return route ? ownerOfSlug(root, route.split('/')[0]) : null
}
// Whom a batch wakes: its owner while it listens, else the listening conversation seen last.
export function wakes(root, owner, live = liveSids(root)) {
  if (live.includes(owner ?? null)) return owner ?? null
  const seen = read(join(root, '.proto', 'sessions.json'), {})
  return [...live].sort((a, b) => String(seen[b]?.seenAt ?? '').localeCompare(String(seen[a]?.seenAt ?? '')))[0]
}
const liveSids = root => listenerSids(root).filter(sid => { const c = read(paths(root, sid).config); return active(c) && c.hostEnabled !== false })

// Reconciliation is run by the owning CLI at startup and on inbox wakeups. It cannot
// operate the host scheduler. Retain credentials and identity until the agent confirms
// the exact host task's state, and for reuse when the same conversation reopens review.
// sid: only what is that conversation's (a prototype or batch with no owner is everyone's).
export function pendingListenerWork(root, sid) {
  const mine = owner => !sid || !owner || owner === sid
  const s = read(join(root, 'session.json'), {})
  if (Object.keys(s.building || {}).some(k => mine(ownerOfSlug(root, k.split('/')[0])))) return true
  if (read(join(root, '.proto', 'intake', 'current.json'))?.status === 'open') return true
  for (const sub of ['new', 'taken']) {
    let ids = []
    try { ids = readdirSync(join(root, '.proto', 'inbox', sub)).filter(id => !id.startsWith('.')) } catch { /* empty */ }
    for (const id of ids) {
      const b = read(join(root, '.proto', 'inbox', sub, id, 'batch.json'))
      if (b && !mine(b.owner)) continue
      if (!Array.isArray(b?.comments) || b.comments.some(c => !c.done && !c.withdrawn)) return true
    }
  }
  return false
}

function prototypes(root, sid) {
  const base = join(root, 'src', 'protos')
  try {
    return readdirSync(base, { withFileTypes: true }).filter(e => e.isDirectory()).filter(e => { const o = ownerOfSlug(root, e.name); return !sid || !o || o === sid }).map(e => {
      try {
        const text = readFileSync(join(base, e.name, 'meta.ts'), 'utf8')
        return { slug: e.name, meta: JSON.parse(text.replace(/^[\s\S]*?export default\s*/, '').replace(/;?\s*$/, '')) }
      } catch { return { slug: e.name, meta: null } }
    })
  } catch { return [] }
}

function newestFile(path) {
  let newest = 0
  const walk = path => {
    try {
      for (const e of readdirSync(path, { withFileTypes: true })) {
        const p = join(path, e.name)
        if (e.isDirectory()) walk(p)
        else if (e.isFile()) newest = Math.max(newest, statSync(p).mtimeMs)
      }
    } catch { /* no work yet */ }
  }
  walk(path)
  return newest
}

function lastActivity(root, config, sid) {
  // Ignore generated app files and session.json's mtime (PID/URL and labels change
  // on restart). App sync rewrites src too, except prototypes and theme.css.
  let registered = Date.parse(config.lastActivityAt) || 0
  if (!registered) try { registered = statSync(listenerFile(root, sid)).mtimeMs } catch { /* no config */ }
  let newest = Math.max(registered, Date.parse(read(join(root, 'session.json'))?.createdAt) || 0)
  try { newest = Math.max(newest, statSync(join(root, 'src', 'theme.css')).mtimeMs) } catch { /* no theme */ }
  return Math.max(newest, newestFile(join(root, 'src', 'protos')), newestFile(join(root, '.proto', 'intake')),
    ...['new', 'taken'].map(sub => newestFile(join(root, '.proto', 'inbox', sub))))
}

// Call under the session lock, shared with inbox/reply and server mutations.
export function reconcileListener(root, { sid: given, close, finish, reopen = false, optIn = false, optOut = false,
  hostEnabled, taskId, touch = false, now = Date.now() } = {}) {
  const sid = which(root, given)
  let config = read(listenerFile(root, sid))
  if (hostEnabled !== undefined) {
    if (!config?.id || taskId !== config.id) throw new Error('host confirmation must name the exact registered task id')
    config.hostEnabled = hostEnabled
  }
  if (!config && !optOut && !close && !finish) return listenerStatus(root, sid)
  config ||= {}
  config.lifecycle ??= optOut ? 'opted-out' : 'active'
  config.lastActivityAt ??= new Date(lastActivity(root, config, sid) || now).toISOString()
  const pending = pendingListenerWork(root, sid)
  if (close && !['finished', 'abandoned'].includes(close)) throw new Error('--close must be finished or abandoned')
  if ((close || finish) && pending) throw new Error('pending inbox, intake or building work prevents listener cleanup; handle it first')
  if (optOut) { config.lifecycle = 'opted-out'; config.reason = 'user' }
  else if (reopen) {
    if (config.lifecycle === 'opted-out' && !optIn) throw new Error('listener explicitly opted out; only user-authorized --reopen --again restores it')
    config.lifecycle = 'active'; config.reason = null; config.finished = {}
    config.lastActivityAt = new Date(now).toISOString()
  } else if (close && config.lifecycle !== 'opted-out') { config.lifecycle = 'closed'; config.reason = close }
  else if (config.lifecycle === 'active') {
    const all = prototypes(root, sid)
    if (finish) {
      if (!all.some(p => p.slug === finish)) throw new Error('--finish needs an existing prototype slug')
      config.finished = { ...config.finished, [finish]: now }
    }
    if (!pending) {
      if (all.length && all.every(p => p.meta && (p.meta.archived ||
        config.finished?.[p.slug] >= newestFile(join(root, 'src', 'protos', p.slug))))) {
        config.lifecycle = 'closed'; config.reason = 'delivered'
      } else if (now - lastActivity(root, config, sid) >= 7 * 864e5) {
        config.lifecycle = 'closed'; config.reason = 'inactive'
      }
    }
    if (touch && config.lifecycle === 'active') config.lastActivityAt = new Date(now).toISOString()
  }
  saveListener(root, config, sid)
  return listenerStatus(root, sid)
}

// One pump for the app: each waiting batch wakes whom wakes() says, once per listener (receipts).
export function commentListener(root, { retryMs = 5000, intervalMs = 1000 } = {}) {
  const inbox = inboxOf(root)
  let running = null, closed = false, controller
  const nextTry = new Map()
  const deliver = async () => {
    if (closed) return
    let ids
    try { ids = readdirSync(join(inbox, 'new')).filter(id => !id.startsWith('.')).sort() } catch { return }
    const live = liveSids(root), routed = new Map(live.map(sid => [sid, []]))
    for (const id of ids) {
      const to = wakes(root, read(join(inbox, 'new', id, 'batch.json'))?.owner ?? null, live)
      if (to !== undefined) routed.get(to).push(id)
    }
    for (const [sid, mine] of routed) {
      if (closed || Date.now() < (nextTry.get(sid) ?? 0)) continue
      const p = paths(root, sid), config = read(p.config), receipts = read(p.receipts, {})
      const pending = mine.filter(id => receipts[id] !== config.id)
      if (!pending.length) {
        if (listenerStatus(root, sid).error) write(p.status, { id: config.id, error: null, at: new Date().toISOString() })
        nextTry.delete(sid)
        continue
      }
      controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 5000)
      let error = null
      try {
        const response = await fetch(config.url, {
          method: 'POST', headers: { 'content-type': 'application/json' }, redirect: 'error',
          body: JSON.stringify({ session: config.session ?? sid, batchId: pending[0], batchIds: pending }), signal: controller.signal,
        })
        await response.body?.cancel()
        if (!response.ok) error = `notification returned HTTP ${response.status}`
      } catch { error = 'comment notification could not be delivered' } finally { clearTimeout(timeout) }
      if (closed || !active(read(p.config)) || read(p.config)?.id !== config.id) continue
      // Retain receipts only for batches still waiting. A taken batch never needs another wake.
      if (!error) write(p.receipts, Object.fromEntries(mine.map(id => [id, config.id])))
      write(p.status, { id: config.id, error, at: new Date().toISOString() })
      if (error) nextTry.set(sid, Date.now() + retryMs); else nextTry.delete(sid)
    }
  }
  const flush = () => running || (running = deliver().catch(() => { for (const sid of listenerSids(root)) nextTry.set(sid, Date.now() + retryMs) }).finally(() => { running = null }))
  const timer = intervalMs > 0 ? setInterval(flush, intervalMs) : null
  timer?.unref()
  return {
    flush, status: () => listenerStatus(root),
    close() { closed = true; clearInterval(timer); controller?.abort() },
  }
}
