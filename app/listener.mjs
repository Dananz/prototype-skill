// A durable wakeup subscription, owned by the session's server rather than an agent turn.
// Notifications are at-least-once. They never take a batch: the awakened agent reads the inbox,
// whose atomic rename still provides the once-only handoff, including after an ambiguous retry.
import { randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const read = (file, fallback = null) => { try { return JSON.parse(readFileSync(file, 'utf8')) } catch { return fallback } }
export const listenerFile = root => join(root, '.proto', 'inbox', 'listener.json')
const active = config => !!config?.url && (config.lifecycle ?? 'active') === 'active'
export function listenerStatus(root) {
  const config = read(listenerFile(root))
  const state = read(join(root, '.proto', 'inbox', 'listener-status.json'))
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
export const saveListener = (root, config) => write(listenerFile(root), config)

// Reconciliation is run by the owning CLI at startup and on inbox wakeups. It cannot
// operate the host scheduler. Retain credentials and identity until the agent confirms
// the exact host task's state, and for reuse when the same conversation reopens review.
export function pendingListenerWork(root) {
  const s = read(join(root, 'session.json'), {})
  if (Object.keys(s.building || {}).length) return true
  if (read(join(root, '.proto', 'intake', 'current.json'))?.status === 'open') return true
  for (const sub of ['new', 'taken']) {
    let ids = []
    try { ids = readdirSync(join(root, '.proto', 'inbox', sub)).filter(id => !id.startsWith('.')) } catch { /* empty */ }
    for (const id of ids) {
      const b = read(join(root, '.proto', 'inbox', sub, id, 'batch.json'))
      if (!Array.isArray(b?.comments) || b.comments.some(c => !c.done && !c.withdrawn)) return true
    }
  }
  return false
}

function prototypes(root) {
  const base = join(root, 'src', 'protos')
  try {
    return readdirSync(base, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => {
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

function lastActivity(root, config) {
  // Ignore generated app files and session.json's mtime (PID/URL and labels change
  // on restart). App sync rewrites src too, except prototypes and theme.css.
  let registered = Date.parse(config.lastActivityAt) || 0
  if (!registered) try { registered = statSync(listenerFile(root)).mtimeMs } catch { /* no config */ }
  let newest = Math.max(registered, Date.parse(read(join(root, 'session.json'))?.createdAt) || 0)
  try { newest = Math.max(newest, statSync(join(root, 'src', 'theme.css')).mtimeMs) } catch { /* no theme */ }
  return Math.max(newest, newestFile(join(root, 'src', 'protos')), newestFile(join(root, '.proto', 'intake')),
    ...['new', 'taken'].map(sub => newestFile(join(root, '.proto', 'inbox', sub))))
}

// Call under the session lock, shared with inbox/reply and server mutations.
export function reconcileListener(root, { close, finish, reopen = false, optIn = false, optOut = false,
  hostEnabled, taskId, touch = false, now = Date.now() } = {}) {
  let config = read(listenerFile(root))
  if (hostEnabled !== undefined) {
    if (!config?.id || taskId !== config.id) throw new Error('host confirmation must name the exact registered task id')
    config.hostEnabled = hostEnabled
  }
  if (!config && !optOut && !close && !finish) return listenerStatus(root)
  config ||= {}
  config.lifecycle ??= optOut ? 'opted-out' : 'active'
  config.lastActivityAt ??= new Date(lastActivity(root, config) || now).toISOString()
  const pending = pendingListenerWork(root)
  if (close && !['finished', 'abandoned'].includes(close)) throw new Error('--close must be finished or abandoned')
  if ((close || finish) && pending) throw new Error('pending inbox, intake or building work prevents listener cleanup; handle it first')
  if (optOut) { config.lifecycle = 'opted-out'; config.reason = 'user' }
  else if (reopen) {
    if (config.lifecycle === 'opted-out' && !optIn) throw new Error('listener explicitly opted out; only user-authorized --reopen --again restores it')
    config.lifecycle = 'active'; config.reason = null; config.finished = {}
    config.lastActivityAt = new Date(now).toISOString()
  } else if (close && config.lifecycle !== 'opted-out') { config.lifecycle = 'closed'; config.reason = close }
  else if (config.lifecycle === 'active') {
    const all = prototypes(root)
    if (finish) {
      if (!all.some(p => p.slug === finish)) throw new Error('--finish needs an existing prototype slug')
      config.finished = { ...config.finished, [finish]: now }
    }
    if (!pending) {
      if (all.length && all.every(p => p.meta && (p.meta.archived ||
        config.finished?.[p.slug] >= newestFile(join(root, 'src', 'protos', p.slug))))) {
        config.lifecycle = 'closed'; config.reason = 'delivered'
      } else if (now - lastActivity(root, config) >= 7 * 864e5) {
        config.lifecycle = 'closed'; config.reason = 'inactive'
      }
    }
    if (touch && config.lifecycle === 'active') config.lastActivityAt = new Date(now).toISOString()
  }
  saveListener(root, config)
  return listenerStatus(root)
}

export function commentListener(root, { retryMs = 5000, intervalMs = 1000 } = {}) {
  const inbox = join(root, '.proto', 'inbox'), receiptsFile = join(inbox, 'notified.json')
  let running = null, closed = false, nextTry = 0, controller
  const deliver = async () => {
    const config = read(listenerFile(root))
    if (closed || !active(config) || config.hostEnabled === false || Date.now() < nextTry) return
    let ids
    try { ids = readdirSync(join(inbox, 'new')).filter(id => !id.startsWith('.')).sort() } catch { return }
    const receipts = read(receiptsFile, {})
    const pending = ids.filter(id => receipts[id] !== config.id)
    if (!pending.length) {
      if (listenerStatus(root).error) write(join(inbox, 'listener-status.json'), { id: config.id, error: null, at: new Date().toISOString() })
      nextTry = 0
      return
    }
    controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)
    let error = null
    try {
      const response = await fetch(config.url, {
        method: 'POST', headers: { 'content-type': 'application/json' }, redirect: 'error',
        body: JSON.stringify({ session: config.session, batchId: pending[0], batchIds: pending }), signal: controller.signal,
      })
      await response.body?.cancel()
      if (!response.ok) error = `notification returned HTTP ${response.status}`
    } catch { error = 'comment notification could not be delivered' } finally { clearTimeout(timeout) }
    if (closed || !active(read(listenerFile(root))) || read(listenerFile(root))?.id !== config.id) return
    if (!error) {
      // Retain receipts only for batches still waiting. A taken batch never needs another wake.
      write(receiptsFile, Object.fromEntries(ids.map(id => [id, config.id])))
    }
    write(join(inbox, 'listener-status.json'), { id: config.id, error, at: new Date().toISOString() })
    nextTry = error ? Date.now() + retryMs : 0
  }
  const flush = () => running || (running = deliver().catch(() => { nextTry = Date.now() + retryMs }).finally(() => { running = null }))
  const timer = intervalMs > 0 ? setInterval(flush, intervalMs) : null
  timer?.unref()
  return {
    flush, status: () => listenerStatus(root),
    close() { closed = true; clearInterval(timer); controller?.abort() },
  }
}
