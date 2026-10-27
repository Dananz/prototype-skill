// The session server's /__proto/share/* routes: the page's Share sheet (list, publish, update,
// remove) and its "From links" tray (comments, send, reply, hide, dismiss), plus the poll that fills
// the tray (spec: In the owner's page). The owner token stays in this process; the page only ever
// talks to this server. Every route is a POST with JSON, behind the server's own origin check.
//
// PROTO_SHARE_POLL_MS sets the poll (default 30 s). 0 means this server never asks a host anything
// on its own: no poll, no refresh when the page asks for the tray, no host listing. The smoke's own
// session runs that way, so it can never reach the owner's real host or Keychain; what the person
// does (publish, send, reply) still goes out.
import { clientFor, defaultHost, dismiss, flush, forget, getToken, hostNamed, hostUp, linkOf, mergeTray, outboxFile, pollOnce, queue, readShares, sendComments, trayItems, trayView } from './owner.mjs'
import { changedSince, protosOf, publishShare, removeShare, titleOf, updateShare } from './publish.mjs'
import { ShareError, parseScope } from './scope.mjs'
import { statSync } from 'node:fs'

const PAGE_FRESH = 10 * 60e3 // a page pinged this recently counts as a person there
const REFRESH_GAP = 3000 // the tray asked for again sooner than this answers from what is here

const failure = (status, error, extra = {}) => Object.assign(new Error(error), { status, extra })

/**
 * root: the session folder. session(): session.json as it is now. receive(data, root): the server's
 * inbox writer. emit(tray): sends `proto:shares` to every open page.
 */
// 0 turns the poll off; anything else is at least a second. Not a number: the default.
export function pollEvery(value) {
  const n = Number(value ?? 30_000)
  if (!Number.isFinite(n)) return 30_000
  return n <= 0 ? 0 : Math.max(1000, n)
}

export function shareServer({ root, session, receive, emit, pollMs = pollEvery(process.env.PROTO_SHARE_POLL_MS) }) {
  const quiet = !(pollMs > 0)
  let seen = 0, last = 0, running = null
  const tell = () => { try { emit(trayView(root)) } catch { /* no page to tell */ } }

  // One poll at a time; a page asking again within a few seconds gets what is here.
  const poll = (force = false) => {
    if (quiet) return Promise.resolve(false)
    if (running) return running
    if (!force && Date.now() - last < REFRESH_GAP) return Promise.resolve(false)
    last = Date.now()
    running = pollOnce(root).then(r => { if (r.changed) tell(); return r.changed }).catch(() => false).finally(() => { running = null })
    return running
  }
  const timer = quiet ? null : setInterval(() => {
    if (readShares(root).length && Date.now() - seen < PAGE_FRESH) poll(true)
  }, pollMs)
  timer?.unref?.()
  // What waited in the outbox when the server last stopped goes now. Nothing is asked when it is empty.
  if (!quiet) { try { if (statSync(outboxFile(root)).size > 0) flush(root).catch(() => {}) } catch { /* empty */ } }

  // The host a share is on, and its token; a 409 or 503 the sheet can show when there is none.
  const reach = async name => {
    const host = name ? hostNamed(name) : defaultHost()
    if (!host) throw failure(409, 'No share host yet. Ask Claude to set one up (proto share setup --local).', { code: 'no_host' })
    const token = getToken(host.name)
    if (!token) throw failure(409, `No owner token for the host "${host.name}" on this Mac: proto share setup --local makes one.`, { code: 'no_token' })
    // A token found now ends a "no token" the poll remembered from before setup.
    if (!clientFor(host.name)) forget(host.name)
    if (!await hostUp(host)) throw failure(503, `The share host "${host.name}" isn't running. Ask Claude to share again (it starts the host), or run proto share setup --local.`, { code: 'host_down' })
    return { host, token }
  }
  const entryOf = id => {
    const e = readShares(root).find(x => x.id === id)
    if (!e) throw failure(404, `No share ${id} in this session.`, { code: 'no_share' })
    return e
  }
  const shareView = (e, tray = trayView(root).comments) => {
    const host = hostNamed(e.host)
    const mine = tray.filter(c => c.share.id === e.id)
    return {
      id: e.id, title: e.title, scope: e.scope, version: e.version, publishedAt: e.publishedAt, ...(e.note ? { note: e.note } : {}),
      host: e.host, link: host ? linkOf(host, e.id) : null, changed: changedSince(root, e),
      comments: { total: mine.length, new: mine.filter(c => c.status === 'new' && !c.dismissed).length },
    }
  }
  // A publish or an update answered: the link, or the review that stopped it.
  const published = r => {
    if (r.ok) return { ok: true, share: shareView(r.entry), link: r.link, review: r.review }
    if (r.blocked) throw failure(422, 'The share is blocked: something in it must not leave this Mac.', { ok: false, blocked: true, review: r.review })
    return { ok: false, needsYes: true, review: r.review }
  }
  const item = data => {
    if (typeof data.id !== 'string') throw failure(400, 'send { id }, a comment id from the tray')
    const found = trayItems(root, data.id, typeof data.share === 'string' ? data.share : undefined)
    if (!found.length) throw failure(404, 'No such comment in the tray.', { code: 'no_comment' })
    if (found.length > 1) throw failure(409, 'Two shares have a comment with this id: send share too.', { code: 'ambiguous' })
    return found[0]
  }
  // The owner's reply or hide, through the outbox: sent now when the host answers, else later.
  const change = async (c, field, value) => {
    const e = readShares(root).find(x => x.id === c.share.id)
    queue(root, [{ host: e?.host || defaultHost()?.name || 'local', share: c.share.id, comment: c.id, [field]: value }])
    const { kept } = await flush(root)
    const now = field === 'reply' ? { owner_reply: value, owner_reply_at: value ? Date.now() : null } : { hidden: value }
    if (e) mergeTray(root, e.host, [{ ...c, ...now }], null)
    tell()
    return { ok: true, pending: kept > 0, tray: trayView(root) }
  }

  const routes = {
    async list() {
      const entries = readShares(root)
      const host = defaultHost()
      const tray = trayView(root).comments
      const shares = entries.map(e => shareView(e, tray))
      let hostError = null
      // The sheet's Check again after `proto share setup`: the poll may remember there was no token.
      if (!quiet) for (const name of new Set([host?.name, ...entries.map(e => e.host)])) if (name && !clientFor(name) && getToken(name)) forget(name)
      if (!quiet) for (const name of new Set(entries.map(e => e.host))) {
        const api = clientFor(name)
        try {
          const rows = api ? await api.list() : null
          if (!rows) { hostError = `No owner token for the host "${name}" on this Mac.`; continue }
          const byId = new Map(rows.map(r => [r.id, r]))
          for (const s of shares) if (s.host === name) Object.assign(s, { live: byId.has(s.id), views: byId.get(s.id)?.views ?? null })
        } catch (e) { if (e?.status === 401) forget(name); hostError = String(e?.message || e) }
      }
      for (const s of shares) { s.live ??= null; s.views ??= null }
      return { host: host ? { name: host.name, stage: host.stage, owner: host.owner || '' } : null, hostError, shares }
    },
    async publish(data) {
      const words = Array.isArray(data.scope) ? data.scope.filter(w => typeof w === 'string').slice(0, 60) : []
      const protos = protosOf(root)
      const scope = parseScope(words, data.all === true, protos)
      const title = typeof data.title === 'string' && data.title.trim() ? data.title.trim().slice(0, 200) : titleOf(scope, protos, session())
      const { host, token } = await reach()
      return published(await publishShare({ sessionDir: root, session: session(), host, token, scope, title, yes: data.yes === true }))
    },
    async update(data) {
      if (typeof data.id !== 'string') throw failure(400, 'send { id, note?, yes? }')
      const e = entryOf(data.id)
      const { host, token } = await reach(e.host)
      const r = published(await updateShare({ sessionDir: root, session: session(), host, token, id: e.id, note: typeof data.note === 'string' ? data.note : undefined, yes: data.yes === true }))
      // The tray's comments on the old version now say it has changed since.
      if (r.ok) tell()
      return r
    },
    async remove(data) {
      if (typeof data.id !== 'string') throw failure(400, 'send { id }')
      const e = entryOf(data.id)
      const { host, token } = await reach(e.host)
      await removeShare({ sessionDir: root, host, token, id: e.id })
      mergeTray(root, e.host, [], null)
      tell()
      return { ok: true, id: e.id }
    },
    async comments(data) {
      if (data.refresh !== false) await poll()
      return trayView(root)
    },
    async send(data) {
      const ids = Array.isArray(data.ids) ? data.ids.filter(x => typeof x === 'string').slice(0, 50) : []
      if (!ids.length) throw failure(400, 'send { ids }, comment ids from the tray')
      const rows = [], results = []
      for (const id of ids) {
        const found = trayItems(root, id, typeof data.share === 'string' ? data.share : undefined)
        if (found.length === 1) rows.push(found[0])
        else results.push({ id, result: found.length ? 'ambiguous' : 'unknown' })
      }
      const sent = rows.length ? await sendComments({ sessionDir: root, rows, receive }) : { batch: null, results: [] }
      tell()
      return { batch: sent.batch, results: [...sent.results, ...results], tray: trayView(root) }
    },
    async reply(data) {
      if (!(data.text === null || typeof data.text === 'string') || (typeof data.text === 'string' && data.text.length > 4000)) throw failure(400, 'send { id, text }: text of at most 4,000 characters, or null to take the reply back')
      const text = typeof data.text === 'string' && data.text.trim() ? data.text.trim() : null
      return change(item(data), 'reply', text)
    },
    async hide(data) { return change(item(data), 'hidden', data.off !== true) },
    async dismiss(data) {
      const c = item(data)
      dismiss(root, c.id, c.share.id, data.off !== true)
      tell()
      return { ok: true, tray: trayView(root) }
    },
  }

  return {
    /** The page is there (its minute's ping): the poll runs while one pinged in the last 10 minutes. */
    ping() { seen = Date.now() },
    /** Answers /__proto/share/<name>: resolves { status, body }. */
    async handle(name, data) {
      seen = Date.now()
      const route = Object.hasOwn(routes, name) ? routes[name] : null
      if (!route) return { status: 404, body: { error: `no /__proto/share/${name}` } }
      try { return { status: 200, body: await route(data) } } catch (e) {
        if (e?.unreachable) return { status: 503, body: { error: e.message, code: 'host_down' } }
        // The host refused (its status and code), or the request itself was wrong (a scope, a build).
        if (e instanceof ShareError) return { status: e.status ? 502 : 400, body: { error: e.message, ...(e.code ? { code: e.code } : {}) } }
        if (e?.status) return { status: e.status, body: { error: e.message, ...e.extra } }
        return { status: 500, body: { error: String(e?.message || e).slice(0, 300) } }
      }
    },
    close() { if (timer) clearInterval(timer) },
  }
}
