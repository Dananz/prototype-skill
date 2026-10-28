// The owner's side of share links, as both the session's server (the page's Share sheet and "From
// links" tray) and `proto share` use it: which hosts this Mac knows and its owner token, the owner
// API, this session's shares, the outbox that carries statuses and replies to the host, the tray of
// viewer comments, and Send to Claude. It lives in app/share/ so a session's own copy of the app has
// it; scripts/share-host.mjs re-exports the host parts and keeps what needs the skill (starting the
// local host). Only statuses and the owner's own replies ever go to the host; Claude's replies stay here.
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { appendFileSync, chmodSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { homedir, hostname } from 'node:os'
import { dirname, join } from 'node:path'
import { ShareError } from './scope.mjs'
import { fromComment, trayRow } from './viewer-text.mjs'

const readJson = (f, fallback) => { try { return JSON.parse(readFileSync(f, 'utf8')) } catch { return fallback } }
// Written whole: into a scratch name beside it, then renamed over it.
function writeJson(file, value) {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
  writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n')
  try { renameSync(tmp, file) } catch (e) { rmSync(tmp, { force: true }); throw e }
}

// ---------- hosts and the owner token ----------

// Read at each call, not at import: HOME is what the tests move.
const configDir = () => join(homedir(), '.config', 'prototype')

/**
 * Host = { name, url, stage, base, pathMode, default, owner }. stage is 'local' (wrangler dev on
 * this Mac), 'workers' (online, on its workers.dev name) or 'domain' (online, on prtype.dev). An
 * online host deployed from this Mac also keeps its Cloudflare ids (accountId, worker, kvId, dbId)
 * and hostVersion; never a secret.
 */
export const readHosts = () => readJson(join(configDir(), 'hosts.json'), []).filter(h => h && typeof h.name === 'string')
/**
 * The host every user shares to with no setup: prtype.dev, run by the maintainer, one origin per
 * share. Named 'online' on purpose, so its token is the Keychain item a past setup made and every
 * session's shares.json (host: "online") still finds it.
 */
export const BUILTIN = Object.freeze({ name: 'online', url: 'https://prtype.dev', stage: 'domain', base: 'prtype.dev', pathMode: false, default: true, builtin: true })
// A hosts.json default (a local host, a self-hosted one) wins; with none named, the built-in host.
export const defaultHost = () => { const hosts = readHosts(); return hosts.find(h => h.default) || hosts[0] || { ...BUILTIN } }
export const hostNamed = name => readHosts().find(h => h.name === name) || (name === BUILTIN.name ? { ...BUILTIN } : null)

// The Keychain on macOS. PROTO_SHARE_TOKEN_STORE=file sends tokens to the file store instead: the
// tests set it, since `security` writes to the login keychain whatever HOME says.
export const inKeychain = () => process.platform === 'darwin' && process.env.PROTO_SHARE_TOKEN_STORE !== 'file'
export const service = name => `prototype-share-${name}`
export const tokenFile = name => join(configDir(), `token-${name}`)

export function getToken(name) {
  if (inKeychain()) {
    const r = spawnSync('security', ['find-generic-password', '-s', service(name), '-w'], { encoding: 'utf8' })
    return r.status === 0 && r.stdout.trim() ? r.stdout.trim() : null
  }
  try { return readFileSync(tokenFile(name), 'utf8').trim() || null } catch { return null }
}

/**
 * The `security` call that stores a token: the command goes in on stdin (`security -i`), so the
 * token never shows in `ps` the way an argument would. Tokens are base64url, so nothing needs quoting.
 */
export function keychainAdd(name, token) {
  if (!/^[A-Za-z0-9_-]+$/.test(token) || !/^[A-Za-z0-9_-]+$/.test(name)) throw new ShareError('The owner token or host name has characters the Keychain command cannot take')
  return { args: ['-i'], input: `add-generic-password -U -a prototype -s ${service(name)} -w ${token}\n` }
}

// Here, not in scripts/: a session's server writes the token too, when the page signs in. A token
// written ends whatever "no token" clientFor remembered.
export function setToken(name, token) {
  if (inKeychain()) {
    const { args, input } = keychainAdd(name, token)
    const r = spawnSync('security', args, { input, encoding: 'utf8' })
    if (r.status !== 0) throw new ShareError(`Could not save the owner token in the Keychain: ${r.stderr.trim()}`)
  } else {
    mkdirSync(configDir(), { recursive: true })
    writeFileSync(tokenFile(name), token + '\n', { mode: 0o600 })
    chmodSync(tokenFile(name), 0o600)
  }
  forget(name)
}

/** Takes this Mac's token for a host out of the store (signout). Says whether there was one. */
export function deleteToken(name) {
  forget(name)
  if (inKeychain()) return spawnSync('security', ['delete-generic-password', '-s', service(name)], { stdio: 'ignore' }).status === 0
  try { rmSync(tokenFile(name)); return true } catch { return false }
}

const portOf = host => Number(new URL(host.url).port || 80)
export const isLocal = host => !host || host.stage === 'local'
/**
 * Where the owner API is reached: on this Mac by 127.0.0.1, which the host answers on as well as
 * localhost; online at https://<base>.
 */
export const apiOrigin = host => isLocal(host) ? `http://127.0.0.1:${portOf(host)}` : `https://${host.base}`

/**
 * The link a share opens on: one origin per share where it can, https://<id>.<base>/ online and
 * http://<id>.localhost:<port>/ on this Mac (where *.localhost resolves); else the path form,
 * https://<base>/s/<id>/ or http://127.0.0.1:<port>/s/<id>/.
 */
export function linkOf(host, id) {
  if (!isLocal(host)) return host.pathMode === false ? `https://${id}.${host.base}/` : `https://${host.base}/s/${id}/`
  const port = portOf(host)
  return host.pathMode ? `http://127.0.0.1:${port}/s/${id}/` : `http://${id}.localhost:${port}/`
}

/** The link to send: on prtype.dev the short https://prtype.dev/<id>, which opens the share; else linkOf. */
export const shortLinkOf = (host, id) => host?.stage === 'domain' ? `https://${host.base}/${id}` : linkOf(host, id)

/**
 * What makes a host like this one usable: --local sets up the host on this Mac; the built-in host
 * needs only a GitHub sign-in; any other online host is set up (or repaired) by its maintainer.
 */
export const setupHint = host => host?.stage === 'local' ? 'proto share setup --local' : host?.builtin ? 'proto share signin' : 'proto share setup'

/** What a new link answers until the owner has signed in with GitHub (the host's 403 sign_in, or no token). */
export const SIGN_IN_FIRST = 'Sign in with GitHub first: proto share signin'

/**
 * The owner API version this skill speaks. A host sends its own (x-proto-api) and the oldest client
 * it still takes (x-proto-api-min) on /_health; a host without them is older than both, and taken.
 */
export const API = 2
/** The words for a host that needs a newer skill than this one, from its /_health headers; null when it takes this one. */
export function apiTooOld(host, headers) {
  const min = Number(headers?.get?.('x-proto-api-min'))
  return Number.isFinite(min) && min > API ? `Update the skill to share: the share host "${host.name}" needs owner API ${min}, and this skill speaks ${API}` : null
}

/** The host's /_health within two seconds: { up, update }, update being apiTooOld's words. */
export async function hostHealth(host, { fetch = globalThis.fetch } = {}) {
  try {
    const res = await fetch(`${apiOrigin(host)}/_health`, { signal: AbortSignal.timeout(2000) })
    return { up: res.ok, update: res.ok ? apiTooOld(host, res.headers) : null }
  } catch { return { up: false, update: null } }
}

/** Whether the host answers at all (its /_health), within two seconds. */
export async function hostUp(host, options) { return (await hostHealth(host, options)).up }

// What a refusal says. The budget's and the per-user quota's words are the host's (when it resets,
// what is biggest); a token the host doesn't take as its owner's is repaired by setup.
function refusal(host, status, data) {
  if ((data?.code === 'budget' || data?.code === 'quota') && data.error) return data.error
  if (data?.code === 'quota') return `You've reached your share limit on the host "${host.name}": proto share rm <id> frees a link`
  if (data?.code === 'pending') return `Waiting for the maintainer to approve ${data.login ? `@${data.login}` : 'your GitHub account'}: sharing opens once they do`
  if (data?.code === 'banned') return `This GitHub account can't share on the host "${host.name}" any more`
  if (data?.code === 'admin') return `Only an admin of the share host "${host.name}" can do that`
  if (data?.code === 'rate') return `Too many tries from this network for the share host "${host.name}": wait an hour and try again`
  if (data?.code === 'not_owner') return `This Mac's token isn't the host's owner: ${setupHint(host)}`
  if (data?.code === 'sign_in') return SIGN_IN_FIRST
  if (data?.code === 'signin_off') return `GitHub sign-in isn't set up on the share host "${host.name}": ${isLocal(host) ? 'proto share setup --github' : 'proto share setup --domain prtype.dev'}`
  if (data?.code === 'moved') return `The share host "${host.name}" moved${data.error ? ` (${data.error})` : ''}: run ${setupHint(host)} to point this Mac at it`
  return `The share host "${host.name}" answered ${status}${data?.error ? `: ${data.error}` : ''}`
}

/**
 * The owner API. A refusal throws a ShareError with the host's `status` and `code`; a host that
 * can't be reached throws one with neither. `fetch` is for the tests (the Worker in memory).
 */
// One call to a host's API, with the owner token or (token null: the sign-in calls) without.
// Resolves { status, data } for a 2xx.
async function request(host, token, method, path, { body, headers = {}, fetch = globalThis.fetch, timeout = 60_000 } = {}) {
  const origin = apiOrigin(host)
  let res
  try {
    res = await fetch(origin + path, { method, body, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, signal: AbortSignal.timeout(timeout) })
  } catch (e) {
    throw Object.assign(new ShareError(`Could not reach the share host "${host.name}" at ${origin}: ${e?.cause?.code || e?.message || e}`), { unreachable: true })
  }
  const text = await res.text()
  let data = null
  try { data = JSON.parse(text) } catch { /* an HTML error page */ }
  if (!res.ok) throw Object.assign(new ShareError(refusal(host, res.status, data)), { status: res.status, code: data?.code, data })
  return { status: res.status, data }
}
const json = { 'content-type': 'application/json' }

export function client(host, token, { fetch = globalThis.fetch, timeout = 60_000 } = {}) {
  const call = async (method, path, options = {}) => (await request(host, token, method, path, { ...options, fetch, timeout })).data
  const login = l => encodeURIComponent(String(l).replace(/^@/, ''))
  return {
    host,
    create: async () => (await call('POST', '/api/shares')).id,
    // Another upload of the same share in flight (409 race): asked once more, which by then is the
    // next version.
    put: async (id, gz, meta) => {
      const header = Buffer.from(JSON.stringify(meta)).toString('base64url')
      const once = () => call('PUT', `/api/shares/${id}`, { body: gz, headers: { 'content-type': 'application/gzip', 'x-share-meta': header } })
      let r
      try { r = await once() } catch (e) { if (e?.code !== 'race') throw e; r = await once() }
      return { version: r.version }
    },
    /** The link's preview card, a JPEG: { id, card }. */
    card: (id, jpeg) => call('PUT', `/api/shares/${id}/card`, { body: jpeg, headers: { 'content-type': 'image/jpeg' } }),
    list: () => call('GET', '/api/shares'),
    remove: async id => { await call('DELETE', `/api/shares/${id}`) },
    /** The owner's GitHub identity on this host: { login, name, avatar, signin }, nulls before they sign in. */
    owner: () => call('GET', '/api/owner'),
    /** { url }: the 10-minute sign-in link that ties the owner to a GitHub account (refused with signin_off). */
    claim: () => call('POST', '/api/owner/claim'),
    /** Today's counts against the daily caps (an online host): { day, kv_write, kv_delete, d1_write, kv_bytes, caps, resetsAt }. */
    usage: () => call('GET', '/api/owner/usage'),
    /** { comments: OwnerComment[], now }: every comment on the owner's live shares changed at or after `since`. */
    comments: since => call('GET', `/api/owner/comments${since ? `?since=${Number(since)}` : ''}`),
    /** One comment's status, the owner's reply or hidden; `share` settles a comment id two shares have. */
    patch: (id, body, share) => call('PATCH', `/api/owner/comments/${encodeURIComponent(id)}`, { body: JSON.stringify({ ...body, ...(share ? { share } : {}) }), headers: json }),
    /** Revokes this Mac's token on the host (signout). */
    signout: () => call('POST', '/api/owner/signout'),
    // The maintainer's calls (role admin; anyone else is refused with `admin`).
    admin: {
      /** The host's users, all or those of one status (pending, active, banned). */
      users: status => call('GET', `/api/admin/users${status ? `?status=${encodeURIComponent(status)}` : ''}`),
      approve: l => call('POST', `/api/admin/users/${login(l)}/approve`),
      /** Bans a user: their tokens revoked, their links taken down. */
      ban: l => call('POST', `/api/admin/users/${login(l)}/ban`),
      /** Takes any share down (its link then says it was removed). */
      takedown: id => call('DELETE', `/api/admin/shares/${encodeURIComponent(id)}`),
      reports: () => call('GET', '/api/admin/reports'),
    },
  }
}

// ---------- signing in with no token (a host-mediated GitHub web flow) ----------
// The host hands out a sign-in link and a poll secret only this process holds; the person signs in
// with GitHub in the browser; this side asks every two seconds until the host mints this device's
// token, which it answers once. Both the CLI (proto share signin) and the session's server (the
// page's Sign in with GitHub) run it, so the token lands in the same store either way.

const SIGNIN_WAIT_MS = 5 * 60e3

/** { code, poll, url, exp }: a sign-in to open at `url`, ten minutes. Refused 429 `rate`, 503 `signin_off`. */
export async function signinStart(host, { fetch = globalThis.fetch, device = hostname() } = {}) {
  return (await request(host, null, 'POST', '/api/signin/start', { body: JSON.stringify({ device }), headers: json, fetch, timeout: 15_000 })).data
}

/** One poll: { state: 'waiting' }, or once signed in { token, login, name, avatar, status }. 410 `expired`, 404 unknown. */
export async function signinPoll(host, code, poll, { fetch = globalThis.fetch } = {}) {
  const { status, data } = await request(host, null, 'POST', '/api/signin/poll', { body: JSON.stringify({ code, poll }), headers: json, fetch, timeout: 15_000 })
  return status === 202 || !data?.token ? { state: 'waiting' } : data
}

/**
 * The whole sign-in: starts it, hands the link to `onUrl` (print it, open it, give it to the page),
 * then polls every `every` ms until the host answers the token, the link expires or `wait` passes.
 * The token is stored under the host's name. Resolves { login, name, avatar, status }; throws a
 * ShareError that says what to do. A poll the network drops is asked again; `stopped()` true ends it
 * quietly (resolves null): another sign-in took over.
 */
// PROTO_SHARE_SIGNIN_EVERY_MS and PROTO_SHARE_SIGNIN_WAIT_MS shorten both for the tests.
export async function signIn(host, { fetch = globalThis.fetch, onUrl = () => {}, every = Number(process.env.PROTO_SHARE_SIGNIN_EVERY_MS) || 2000, wait = Number(process.env.PROTO_SHARE_SIGNIN_WAIT_MS) || SIGNIN_WAIT_MS, sleep = ms => new Promise(r => setTimeout(r, ms)), stopped = () => false, device } = {}) {
  const start = await signinStart(host, { fetch, device })
  if (typeof start?.url !== 'string' || typeof start.code !== 'string' || typeof start.poll !== 'string') throw new ShareError(`The share host "${host.name}" answered a sign-in without its link`)
  await onUrl(start.url, start)
  // Not capped at the link's `exp`: the host still answers a sign-in finished just before it, and
  // says 410 expired once it won't.
  const end = Date.now() + wait
  while (Date.now() < end) {
    await sleep(every)
    if (stopped()) return null
    let r
    try { r = await signinPoll(host, start.code, start.poll, { fetch }) } catch (e) {
      if (e?.unreachable || e?.status === 429 || e?.status >= 500) continue
      if (e?.status === 410) throw Object.assign(new ShareError('The sign-in link expired: run proto share signin again'), { code: 'expired' })
      throw e
    }
    if (stopped()) return null
    if (r.state === 'waiting') continue
    setToken(host.name, r.token)
    return { login: r.login ?? null, name: r.name ?? null, avatar: r.avatar ?? null, status: r.status ?? 'active' }
  }
  throw Object.assign(new ShareError('No sign-in within five minutes: run proto share signin again'), { code: 'expired' })
}

/** What a finished sign-in says: who, or that the maintainer still has to let them in. */
export function signedInLine(who) {
  if (who.status === 'pending') return `signed in as @${who.login}. Waiting for the maintainer to approve @${who.login}: sharing opens once they do`
  if (who.status === 'banned') return `signed in as @${who.login}, but this GitHub account can't share on this host`
  return `signed in as @${who.login}`
}

// One client per host name for a process, its token read once: the Keychain is a process spawn.
// `forget` drops it, after the host refused the token.
// A host with no token is remembered for a minute, so a poll doesn't ask the Keychain every time.
const clients = new Map(), missing = new Map()
export function clientFor(name, options) {
  if (!clients.has(name)) {
    if (Date.now() - (missing.get(name) || 0) < 60e3) return null
    const host = hostNamed(name), token = host && getToken(name)
    if (!host || !token) { missing.set(name, Date.now()); return null }
    clients.set(name, client(host, token, { timeout: 15_000, ...options }))
  }
  return clients.get(name)
}
export const forget = name => { clients.delete(name); missing.delete(name) }

// ---------- this session's shares ----------

export const sharesFile = dir => join(dir, '.proto', 'shares.json')
export const readShares = dir => readJson(sharesFile(dir), []).filter(e => e && typeof e.id === 'string')
export const writeShares = (dir, list) => writeJson(sharesFile(dir), list)

// ---------- the outbox ----------
// Host updates not yet delivered (spec: On the Mac): a status a batch reached (working, done), the
// owner's reply, hidden. Each is a line of .proto/shares/outbox.jsonl, sent by whoever flushes next:
// the command that queued it, the server's next poll, or the next `proto share` command. Updates set,
// never toggle, so sending one twice is harmless; a status behind the host's is dropped. Flushing
// takes the file away by renaming it (one taker wins), so a line queued meanwhile waits in a new
// file, and lines that could not be delivered go back in.

const ORDER = ['new', 'sent', 'working', 'done']
export const outboxFile = dir => join(dir, '.proto', 'shares', 'outbox.jsonl')

/** Appends updates: { host, share, comment, status? | reply? | hidden?, at? }. */
export function queue(dir, entries) {
  if (!entries.length) return
  mkdirSync(dirname(outboxFile(dir)), { recursive: true })
  appendFileSync(outboxFile(dir), entries.map(e => JSON.stringify({ at: Date.now(), ...e }) + '\n').join(''))
}

// A host that refuses for good (no such comment, deleted, a status behind it, already sent) is done
// with the update; one that can't be reached, refuses the token, is busy, failed or moved keeps it.
// A host that moved (410 `moved`, the old workers.dev name once the domain is live) keeps them too:
// they go once this Mac points at the new name (proto share setup).
const keep = e => !e?.status || e.status === 401 || e.status === 408 || e.status === 429 || e.status >= 500 || e.code === 'moved'

/**
 * Sends what the outbox holds. clientFor(hostName) gives the owner API for a host (or null). Says how
 * many updates were delivered (or settled) and how many wait. Asks no host when nothing waits.
 */
export async function flush(dir, { clientFor: get = clientFor } = {}) {
  const file = outboxFile(dir), folder = dirname(file)
  const taken = []
  // A claimed file is touched: a rename keeps the old time, and an old one would look abandoned.
  const claim = from => {
    const to = join(folder, `outbox.${process.pid}.${randomBytes(4).toString('hex')}.sending`)
    try { renameSync(from, to) } catch { return /* another flush took it */ }
    taken.push(to)
    try { const now = new Date(); utimesSync(to, now, now) } catch { /* still ours to read */ }
  }
  try { if (statSync(file).size > 0) claim(file) } catch { /* nothing queued */ }
  // A flush that died halfway left its file: anyone takes it over after two minutes.
  try {
    for (const f of readdirSync(folder)) {
      const at = join(folder, f)
      if (/^outbox\..+\.sending$/.test(f) && !taken.includes(at) && Date.now() - statSync(at).mtimeMs > 120e3) claim(at)
    }
  } catch { /* no folder, or a file another flush just took */ }
  if (!taken.length) return { delivered: 0, kept: 0 }

  const entries = taken.flatMap(f => readFileSync(f, 'utf8').split('\n').filter(Boolean).flatMap(l => { try { return [JSON.parse(l)] } catch { return [] } }))
    .filter(e => typeof e?.host === 'string' && typeof e.share === 'string' && typeof e.comment === 'string')
    .sort((a, b) => (a.at || 0) - (b.at || 0))
  // One update per comment and field: the furthest status, the latest reply, the latest hidden.
  const byComment = new Map()
  for (const e of entries) {
    const k = `${e.host}\n${e.share}\n${e.comment}`
    const u = byComment.get(k) || { host: e.host, share: e.share, comment: e.comment }
    if (ORDER.includes(e.status) && ORDER.indexOf(e.status) >= ORDER.indexOf(u.status?.value ?? 'new')) u.status = { value: e.status, at: e.at }
    if ('reply' in e) u.reply = { value: e.reply, at: e.at }
    if (typeof e.hidden === 'boolean') u.hidden = { value: e.hidden, at: e.at }
    byComment.set(k, u)
  }
  let delivered = 0
  const back = []
  for (const u of byComment.values()) {
    const api = get(u.host)
    for (const field of ['status', 'reply', 'hidden']) {
      if (!u[field]) continue
      const line = { at: u[field].at, host: u.host, share: u.share, comment: u.comment, [field]: u[field].value }
      if (!api) { back.push(line); continue }
      try { await api.patch(u.comment, { [field]: u[field].value }, u.share); delivered++ } catch (e) { if (keep(e)) back.push(line); else delivered++ }
    }
  }
  queue(dir, back)
  for (const f of taken) rmSync(f, { force: true })
  return { delivered, kept: back.length }
}

// ---------- the tray: viewer comments on this session's shares ----------
// .proto/shares/tray.json: { cursor: { <host>: <host time> }, items: { "<share>/<comment>": OwnerComment
// plus dismissed }, checkedAt, error }. Dismissed is the owner's own, on this Mac (spec: the tray).

export const trayFile = dir => join(dir, '.proto', 'shares', 'tray.json')
const readTray = dir => {
  const t = readJson(trayFile(dir), {})
  return { cursor: t.cursor && typeof t.cursor === 'object' ? t.cursor : {}, items: t.items && typeof t.items === 'object' ? t.items : {}, checkedAt: t.checkedAt ?? null, error: t.error ?? null }
}
const keyOf = (share, id) => `${share}/${id}`

/**
 * Takes the host's rows into the tray: only comments on this session's shares, deleted ones dropped.
 * `now` (the host's clock) becomes the host's cursor; null leaves it. Says whether anything changed.
 */
export function mergeTray(dir, hostName, rows, now) {
  const tray = readTray(dir)
  const mine = new Set(readShares(dir).map(e => e.id))
  let changed = false
  for (const k of Object.keys(tray.items)) if (!mine.has(k.split('/')[0])) { delete tray.items[k]; changed = true }
  for (const raw of rows) {
    // Only what passes the same checks as a batch's comments, with only the host's fields.
    const row = trayRow(raw)
    const share = row?.share?.id
    if (!row || !mine.has(share)) continue
    const k = keyOf(share, row.id), prev = tray.items[k]
    if (row.deleted) { if (prev) { delete tray.items[k]; changed = true } continue }
    const next = { ...row, dismissed: !!prev?.dismissed }
    if (JSON.stringify(prev) !== JSON.stringify(next)) { tray.items[k] = next; changed = true }
  }
  // The newest 300 are plenty for a tray.
  const all = Object.entries(tray.items)
  if (all.length > 300) for (const [k] of all.sort((a, b) => b[1].created_at - a[1].created_at).slice(300)) delete tray.items[k]
  if (now != null) tray.cursor[hostName] = now
  writeJson(trayFile(dir), tray)
  return changed
}

/** Records when the host was last asked and what went wrong; says whether that changed. */
function noteCheck(dir, error) {
  const tray = readTray(dir)
  const changed = tray.error !== error
  writeJson(trayFile(dir), { ...tray, checkedAt: Date.now(), error })
  return changed
}

/** The tray's items for a comment id (and share, when one is given). */
export function trayItems(dir, id, share) {
  return Object.values(readTray(dir).items).filter(c => c.id === id && (!share || c.share.id === share))
}

/** Marks a tray item dismissed (or not), on this Mac only. Says whether there was one. */
export function dismiss(dir, id, share, on = true) {
  const tray = readTray(dir)
  const found = Object.entries(tray.items).filter(([, c]) => c.id === id && (!share || c.share.id === share))
  for (const [k, c] of found) tray.items[k] = { ...c, dismissed: on }
  if (found.length) writeJson(trayFile(dir), tray)
  return found.length > 0
}

const variantHere = (dir, variant) => {
  const [slug, letter] = String(variant).split('/')
  try { return !!letter && readdirSync(join(dir, 'src', 'protos', slug)).some(f => f.startsWith(`${letter}.`)) } catch { return false }
}

/**
 * The tray as the page shows it: newest first, each comment with `dismissed`, `changed` (made on an
 * earlier version than the share has now) and `gone` (its variant is no longer in the session); how
 * many are new (not yet sent, not dismissed); when the host was last asked and any error.
 */
export function trayView(dir) {
  const tray = readTray(dir)
  // The link's version as this Mac has it: an update doesn't touch the comments, so the host sends
  // no new row for them and the row's own share version stays the one it was fetched at.
  const versions = new Map(readShares(dir).map(e => [e.id, e.version]))
  const comments = Object.values(tray.items).filter(c => versions.has(c.share?.id))
    .sort((a, b) => b.created_at - a.created_at)
    .map(c => ({ ...c, dismissed: !!c.dismissed, changed: c.version < Math.max(c.share.version, versions.get(c.share.id) || 0), gone: !variantHere(dir, c.variant) }))
  return {
    comments,
    new: comments.filter(c => c.status === 'new' && !c.dismissed).length,
    dismissed: comments.filter(c => c.dismissed).length,
    checkedAt: tray.checkedAt, error: tray.error,
  }
}

/**
 * Asks the hosts of this session's shares for what changed since last time (after flushing the
 * outbox) and takes it into the tray. Says whether the tray changed. Asks nothing when the session
 * has no shares.
 */
export async function pollOnce(dir, { clientFor: get = clientFor } = {}) {
  const hosts = [...new Set(readShares(dir).map(e => e.host).filter(h => typeof h === 'string'))]
  if (!hosts.length) return { changed: false, error: null }
  await flush(dir, { clientFor: get }).catch(() => {})
  let changed = false, error = null
  for (const name of hosts) {
    const api = get(name)
    if (!api) { error = `No owner token for the host "${name}" on this machine: run ${setupHint(hostNamed(name))}`; continue }
    try {
      const { comments, now } = await api.comments(readTray(dir).cursor[name] || 0)
      changed = mergeTray(dir, name, Array.isArray(comments) ? comments : [], now) || changed
    } catch (e) {
      if (e?.status === 401) forget(name)
      error = String(e?.message || e)
    }
  }
  return { changed: noteCheck(dir, error) || changed, error }
}

/**
 * Send to Claude (spec: In the owner's page): each comment flips to `sent` on its host, conditionally
 * (two sessions or tabs can't both send it), and those that flipped become one inbox batch through
 * `receive` (app/server.mjs), each with `from` and the viewer's words as data. Each row is an
 * OwnerComment. Says the batch made (or null) and, per comment, sent, already_sent, deleted, unknown
 * or error. Nothing is sent when a comment's batch entry can't be made.
 */
export async function sendComments({ sessionDir, rows, receive, clientFor: get = clientFor, host }) {
  const results = [], winners = [], flipped = []
  const shares = readShares(sessionDir)
  for (const row of rows) {
    const id = row?.id
    let c
    // Made and checked as the inbox will take it before anything is marked sent on the host, so a
    // comment is never sent there and missing here.
    try { c = fromComment(row, sessionDir, row.re ? trayItems(sessionDir, row.re, row.share.id)[0] : null); receive({ comments: [c] }, sessionDir, { check: true }) } catch (e) { results.push({ id, result: 'error', error: String(e?.message || e) }); continue }
    const name = shares.find(e => e.id === row.share.id)?.host || host || defaultHost()?.name
    const api = name && get(name)
    if (!api) { results.push({ id, result: 'error', error: `No share host with an owner token on this machine: run ${setupHint(hostNamed(name) || defaultHost())}` }); continue }
    try {
      const updated = await api.patch(id, { status: 'sent' }, row.share.id)
      winners.push(c)
      flipped.push([name, updated])
      results.push({ id, result: 'sent' })
    } catch (e) {
      const result = e?.code === 'already_sent' ? 'already_sent' : e?.status === 410 ? 'deleted' : e?.status === 404 ? 'unknown' : 'error'
      results.push({ id, result, ...(result === 'error' ? { error: String(e?.message || e) } : {}) })
      if (result === 'already_sent' && e.data?.status) flipped.push([name, { ...row, status: e.data.status }])
      if (e?.status === 401) forget(name)
    }
  }
  let batch = null
  if (winners.length) {
    try { batch = receive({ comments: winners }, sessionDir).batch.id } catch (e) {
      for (const r of results) if (r.result === 'sent') Object.assign(r, { result: 'error', error: `Sent on the host, but the inbox batch could not be written: ${e?.message || e}` })
    }
  }
  for (const [name, row] of flipped) if (row?.share?.id) mergeTray(sessionDir, name, [row], null)
  return { batch, results }
}

/**
 * The statuses a batch's comments from links have reached, queued and flushed: `working` once
 * `proto inbox` takes the batch, `done` once its comment is closed. Never throws.
 */
export async function report(dir, comments, status) {
  const shares = readShares(dir)
  const entries = comments.filter(c => c?.from?.share && c.from.comment).map(c => ({ host: shares.find(e => e.id === c.from.share)?.host || defaultHost()?.name || 'local', share: c.from.share, comment: c.from.comment, status }))
  if (!entries.length) return null
  try { queue(dir, entries); return await flush(dir) } catch { return null }
}
