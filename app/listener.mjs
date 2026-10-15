// A durable wakeup subscription, owned by the session's server rather than an agent turn.
// Notifications are at-least-once. They never take a batch: the awakened agent reads the inbox,
// whose atomic rename still provides the once-only handoff, including after an ambiguous retry.
import { randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const read = (file, fallback = null) => { try { return JSON.parse(readFileSync(file, 'utf8')) } catch { return fallback } }
export const listenerFile = root => join(root, '.proto', 'inbox', 'listener.json')
export function listenerStatus(root) {
  const config = read(listenerFile(root))
  const state = read(join(root, '.proto', 'inbox', 'listener-status.json'))
  const error = state?.id === config?.id ? state?.error : null
  return { listening: !!config?.url && !error, configured: !!config?.url, id: config?.id, error }
}

function write(file, value) {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
  writeFileSync(tmp, JSON.stringify(value) + '\n', { mode: 0o600, flag: 'wx' })
  try { renameSync(tmp, file) } catch (e) { rmSync(tmp, { force: true }); throw e }
}
export const saveListener = (root, config) => write(listenerFile(root), config)

export function commentListener(root, { retryMs = 5000, intervalMs = 1000 } = {}) {
  const inbox = join(root, '.proto', 'inbox'), receiptsFile = join(inbox, 'notified.json')
  let running = null, closed = false, nextTry = 0, controller
  const deliver = async () => {
    const config = read(listenerFile(root))
    if (closed || !config?.url || Date.now() < nextTry) return
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
    if (closed || read(listenerFile(root))?.id !== config.id) return
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
