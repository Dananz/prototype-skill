// The session server's /__proto/share/* routes: the page's Share sheet (list, publish, update,
// remove) and its "From links" tray (comments, send, reply, hide, dismiss), plus the poll that fills
// the tray (spec: In the owner's page). The owner token stays in this process; the page only ever
// talks to this server. Every route is a POST with JSON, behind the server's own origin check.
//
// PROTO_SHARE_POLL_MS sets the poll (default 30 s). 0 means this server never asks a host anything
// on its own: no poll, no refresh when the page asks for the tray, no host listing. The smoke's own
// session runs that way, so it can never reach the owner's real host or Keychain; what the person
// does (publish, send, reply) still goes out.
import { SIGN_IN_FIRST, client, clientFor, defaultHost, dismiss, flush, forget, getToken, hostHealth, hostNamed, isLocal, linkOf, mergeTray, outboxFile, pollOnce, queue, readShares, sendComments, setupHint, signIn, trayItems, trayView } from './owner.mjs'
import { changedSince, changedVariants, messageOf, protosOf, publishShare, removeShare, titleOf, updateShare } from './publish.mjs'
import { ShareError, parseScope } from './scope.mjs'
import { spawn } from 'node:child_process'
import { statSync } from 'node:fs'
import { join } from 'node:path'

const PAGE_FRESH = 10 * 60e3 // a page pinged this recently counts as a person there
const REFRESH_GAP = 3000 // the tray asked for again sooner than this answers from what is here
const OWNER_FRESH = 60e3 // the owner's GitHub identity, asked of the host at most once a minute
const NOW_MS = 2 * 60e3 // a viewer whose last ping is this recent is in the link now

const failure = (status, error, extra = {}) => Object.assign(new Error(error), { status, extra })

// A share is built from this session's copy of the app, which only `proto up` refreshes. The skill
// (PROTO_SKILL, set by `proto up`) brings it up to date first (scripts/app-sync.mjs); a server
// started by an older proto has no PROTO_SKILL, so it publishes as is and says so in the review.
// Resolves with a review note, or null when the copy is current.
export function syncFirst(root, session, skill = process.env.PROTO_SKILL, { timeout = 120_000 } = {}) {
  if (!skill) return Promise.resolve("This session's viewer may be older than the skill: run proto up before sharing.")
  const args = [join(skill, 'scripts', 'proto.mjs'), 'share', '--sync-only', '--project', session.project, '--session', String(session.id)]
  return new Promise(done => {
    let out = '', over = false
    const child = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PROTO_NO_GC: '1' } })
    // A sync that hangs must not hold the sheet's publish forever.
    const timer = setTimeout(() => { over = true; child.kill('SIGKILL') }, timeout)
    child.stdout.on('data', d => { out += d })
    child.stderr.on('data', d => { out += d })
    child.on('error', e => { clearTimeout(timer); done(`This session's app could not be brought up to date (${e.message}): run proto up before sharing.`) })
    child.on('close', code => {
      clearTimeout(timer)
      if (over) return done(`Bringing this session's app up to date took over ${Math.round(timeout / 1000)} s: run proto up before sharing.`)
      // 3: the packages moved, which only proto up installs (it stops the server first).
      if (code === 3) return done("This session's packages changed with the skill: run proto up (it installs them) before sharing.")
      done(code === 0 ? null : `This session's app could not be brought up to date: ${out.trim().split('\n').at(-1) || `exit ${code}`}. Run proto up before sharing.`)
    })
  })
}

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

  // The host a share is on (a name only hosts.json knows that isn't there: a 409 the sheet shows),
  // answering /_health and taking this skill's owner API.
  const hostOf = async name => {
    const host = name ? hostNamed(name) : defaultHost()
    if (!host) throw failure(409, `No share host "${name}" on this Mac. Ask Claude to set one up (${setupHint({ stage: name === 'local' ? 'local' : 'domain' })}).`, { code: 'no_host', setup: setupHint({ stage: name === 'local' ? 'local' : 'domain' }) })
    return host
  }
  const up = async host => {
    const health = await hostHealth(host)
    if (!health.up) {
      throw failure(503, isLocal(host)
        ? `The share host "${host.name}" isn't running. Ask Claude to share again (it starts the host), or run ${setupHint(host)}.`
        : `The share host "${host.name}" can't be reached. Check the network${host.accountId ? `; ${setupHint(host)} repairs a broken deploy` : ''}.`, { code: 'host_down' })
    }
    if (health.update) throw failure(409, health.update, { code: 'update' })
  }
  // The host and its token. No token: the host on this Mac is set up; an online one (the built-in
  // host first) asks for the GitHub sign-in, before the host is asked anything, so a page that only
  // opens the popover never reaches the network.
  const reach = async name => {
    const host = await hostOf(name)
    const token = getToken(host.name)
    if (!token && isLocal(host)) throw failure(409, `No owner token for the host "${host.name}" on this Mac: ${setupHint(host)} makes one.`, { code: 'no_token', setup: setupHint(host) })
    if (!token) throw failure(409, SIGN_IN_FIRST, { code: 'sign_in' })
    // A token found now ends a "no token" the poll remembered from before setup.
    if (!clientFor(host.name)) forget(host.name)
    await up(host)
    return { host, token }
  }

  // The page's sign-in with no token: one at a time per host, a second press taking over from the
  // first (whose tab may be gone). It runs here, where the token is stored; the page only gets the link
  // and the code the host's confirm page will show (words), for the person to check.
  const signins = new Map()
  const signInHere = async host => {
    const mine = {}
    signins.set(host.name, mine)
    const stopped = () => signins.get(host.name) !== mine
    let link
    const opened = new Promise((ok, no) => { link = { ok, no } })
    // The poll waits on a sleep that never holds the server open.
    const sleep = ms => new Promise(r => setTimeout(r, ms).unref?.())
    signIn(host, { onUrl: (u, start) => link.ok({ url: u, ...(typeof start?.words === 'string' ? { words: start.words } : {}) }), stopped, sleep })
      .then(who => { if (who && !stopped()) { owners.delete(host.name); signedInAs.set(host.name, who) } })
      .catch(e => link.no(e))
      .finally(() => { if (!stopped()) signins.delete(host.name) })
    return opened
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
      host: e.host, link: host ? linkOf(host, e.id) : null, changed: changedSince(root, e), changedVariants: changedVariants(root, e),
      message: e.message ?? null,
      comments: { total: mine.length, new: mine.filter(c => c.status === 'new' && !c.dismissed).length },
    }
  }
  // The host's faces on a link, each with `now` (in it within the last two minutes).
  const facesOf = rows => (Array.isArray(rows) ? rows : []).map(v => ({ login: v.login, name: v.name ?? null, avatar: v.avatar ?? null, route: v.route ?? null, at: v.at, now: Date.now() - v.at < NOW_MS }))

  // The owner's GitHub identity per host name: { at, value }. A sign-in or a token found later asks again.
  const owners = new Map()
  // Who the page's last sign-in with no token was (its status), until the host is asked again.
  const signedInAs = new Map()
  const signedOut = host => ({ host: host?.name ?? null, signedIn: false, login: null, name: null, avatar: null, signin: false })
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
          for (const s of shares) {
            if (s.host !== name) continue
            const r = byId.get(s.id)
            Object.assign(s, { live: !!r, views: r?.views ?? null, viewers: facesOf(r?.viewers), ...(r && 'message' in r ? { message: r.message ?? null } : {}) })
          }
        } catch (e) { if (e?.status === 401) forget(name); hostError = String(e?.message || e) }
      }
      for (const s of shares) { s.live ??= null; s.views ??= null; s.viewers ??= [] }
      return { host: host ? { name: host.name, stage: host.stage, owner: host.owner || '' } : null, hostError, shares, setup: setupHint(host) }
    },
    /**
     * Who the owner is on the default host: { host, signedIn, login, name, avatar, signin }, signin
     * saying whether the host can run the GitHub sign-in. Asked of the host at most once a minute;
     * refresh: true asks now (the page waiting for GitHub). A server that never asks a host on its own
     * (PROTO_SHARE_POLL_MS=0) asks only on refresh.
     */
    async owner(data) {
      const host = defaultHost()
      if (!host) return signedOut(null)
      const was = owners.get(host.name)
      const refresh = data.refresh === true
      if (was && !refresh && Date.now() - was.at < OWNER_FRESH) return was.value
      if (quiet && !refresh) return was?.value ?? signedOut(host)
      // A token made since a call found none (setup or a sign-in just ran) is used at once, as list does.
      if (!clientFor(host.name) && getToken(host.name)) forget(host.name)
      const api = clientFor(host.name)
      // No token for an online host is signed out, with the GitHub sign-in that makes one: the
      // popover shows its sign-in step. Nothing is asked of the host.
      if (!api && !isLocal(host)) return { ...signedOut(host), signin: true }
      if (!api) return { ...signedOut(host), code: 'no_token', error: `No owner token for the host "${host.name}" on this Mac: ${setupHint(host)} makes one.` }
      let o
      try { o = await api.owner() } catch (e) {
        if (e?.status === 401) forget(host.name)
        return { ...(was?.value ?? signedOut(host)), code: e?.unreachable ? 'host_down' : e?.code || 'host', error: String(e?.message || e) }
      }
      // The owner's status on a host with users (active, pending, banned), else what the page's own
      // sign-in was told; a host from before users says none (its one owner is let in).
      const status = typeof o?.status === 'string' ? o.status : signedInAs.get(host.name)?.status
      signedInAs.delete(host.name)
      const value = { host: host.name, signedIn: !!o?.login, login: o?.login ?? null, name: o?.name ?? null, avatar: o?.avatar ?? null, signin: o?.signin === true, ...(status ? { status } : {}) }
      owners.set(host.name, { at: Date.now(), value })
      return value
    },
    /**
     * { url }: the GitHub sign-in link to open in a new tab (10 minutes, once). With a token, the
     * owner's claim; with none (online), the host's sign-in, which this server then waits on and whose
     * token it stores: the page's owner, asked again, is signed in once GitHub has answered.
     */
    async signin() {
      const host = await hostOf()
      owners.delete(host.name)
      try {
        if (!getToken(host.name) && !isLocal(host)) {
          await up(host)
          return await signInHere(host)
        }
        const { token } = await reach()
        return { url: (await client(host, token).claim()).url }
      } catch (e) {
        if (e?.code === 'signin_off') throw failure(409, e.message, { code: 'signin_off' })
        if (e?.code === 'rate') throw failure(429, e.message, { code: 'rate' })
        throw e
      }
    },
    async publish(data) {
      const words = Array.isArray(data.scope) ? data.scope.filter(w => typeof w === 'string').slice(0, 60) : []
      const protos = protosOf(root)
      const scope = parseScope(words, data.all === true, protos)
      const title = typeof data.title === 'string' && data.title.trim() ? data.title.trim().slice(0, 200) : titleOf(scope, protos, session())
      const message = messageOf(typeof data.message === 'string' ? data.message : undefined)
      const { host, token } = await reach()
      const stale = await syncFirst(root, session())
      try {
        return published(await publishShare({ sessionDir: root, session: session(), host, token, scope, title, message, yes: data.yes === true, notes: stale ? [stale] : [] }))
      } catch (e) {
        // A new link needs the owner signed in with GitHub: the page shows its sign-in step.
        if (e?.code === 'sign_in') { owners.delete(host.name); throw failure(409, SIGN_IN_FIRST, { code: 'sign_in' }) }
        // Signed in, but not let in (yet): the page shows the waiting line or the ban.
        if (e?.code === 'pending' || e?.code === 'banned') { owners.delete(host.name); throw failure(409, e.message, { code: e.code }) }
        throw e
      }
    },
    async update(data) {
      if (typeof data.id !== 'string') throw failure(400, 'send { id, note?, message?, yes? }')
      if (!(data.message === undefined || data.message === null || typeof data.message === 'string')) throw failure(400, 'message is text, or null to clear it')
      const e = entryOf(data.id)
      const message = messageOf(data.message)
      const { host, token } = await reach(e.host)
      const stale = await syncFirst(root, session())
      const r = published(await updateShare({ sessionDir: root, session: session(), host, token, id: e.id, note: typeof data.note === 'string' ? data.note : undefined, message, yes: data.yes === true, notes: stale ? [stale] : [] }))
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
