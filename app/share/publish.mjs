// Publishing a share, updating it to a new version and taking it down: the one code `proto share`
// and the page's Share sheet (through the session's server) both run. The caller has the host and
// its owner token; nothing here starts a host, prints or exits. A share is reviewed before it goes:
// anything blocked stops it, and warnings stop it until the person says yes.
import { createHash } from 'node:crypto'
import { randomBytes } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { basename, join, relative } from 'node:path'
import { metaOf } from '../server.mjs'
import { buildShare } from './build.mjs'
import { cardImage } from './card/card.mjs'
import { loadSharp } from './plugin.mjs'
import { client, linkOf, readShares, writeShares } from './owner.mjs'
import { ShareError } from './scope.mjs'

const MiB = 2 ** 20
/** The owner's message for viewers is at most this long (the host refuses more). */
export const MAX_MESSAGE = 280
const filesIn = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? filesIn(join(dir, e.name)) : [join(dir, e.name)])

/** The session's prototypes as parseScope wants them: id, variant letters in the page's order, archived. */
export function protosOf(sessionDir) {
  const root = join(sessionDir, 'src', 'protos')
  if (!existsSync(root)) return []
  return readdirSync(root).flatMap(id => {
    let meta
    try { meta = metaOf(readFileSync(join(root, id, 'meta.ts'), 'utf8')) } catch { return [] }
    const variants = Object.keys(meta.variants || {}).sort((a, b) => a.length - b.length || a.localeCompare(b))
    return [{ id, title: meta.title, variants, archived: !!meta.archived }]
  })
}

export const titleOf = (scope, protos, session) => {
  if (scope.protos.length === 1) return protos.find(p => p.id === scope.protos[0].id)?.title || scope.protos[0].id
  return session.name || basename(session.project || '') || 'Prototypes'
}
export const describe = scope => scope.protos.map(p => `${p.id} (${p.variants.length} variant${p.variants.length === 1 ? '' : 's'})`).join(', ')

/** What the review found, for a person to read: blocks stop the share, notes need their yes. */
export function reviewOf(built) {
  const { block, warn } = built.review
  return {
    sizeMiB: Math.round(built.gzBytes / MiB * 10) / 10,
    block: block.map(b => ({ message: b.message, ...(b.where ? { where: b.where } : {}) })),
    notes: [...warn.map(w => w.message), ...built.warnings],
  }
}

/** A hash of the shared prototypes' files, to tell when the session has moved on from a share. */
export function hashOf(sessionDir, scope) {
  const hash = createHash('sha256')
  for (const p of scope.protos) {
    const from = join(sessionDir, 'src', 'protos', p.id)
    if (!existsSync(from)) { hash.update(`missing ${p.id}\0`); continue }
    for (const f of filesIn(from).sort()) hash.update(relative(sessionDir, f)).update('\0').update(readFileSync(f))
  }
  return hash.digest('hex')
}

/** Whether the shared prototypes changed since that version was published ("Changed since shared"). */
export const changedSince = (sessionDir, entry) => !!entry?.sourceHash && !!entry.scope?.protos && hashOf(sessionDir, entry.scope) !== entry.sourceHash

const VARIANT_FILE = /^([A-Z]{1,3})\.(tsx|jsx|vue|svelte)$/
const namesIn = dir => { try { return metaOf(readFileSync(join(dir, 'meta.ts'), 'utf8')).variants || {} } catch { return {} } }
const filesUnder = dir => existsSync(dir) ? filesIn(dir).map(f => relative(dir, f)) : []

/**
 * Which shared variants changed since the version the link has: its kept sources
 * (.proto/shares/<id>/v<N>/<proto>/) against src/protos/<proto>/, file by file. A shared variant's own
 * file is that variant, { key: '<proto>/<LETTER>', name }; any other file (parts, meta, assets) is
 * { key: '<proto>/*', name: 'Shared parts' }. A letter the link doesn't share is left out. Empty when
 * nothing changed or the version's sources weren't kept.
 */
export function changedVariants(sessionDir, entry) {
  if (!entry?.scope?.protos || !changedSince(sessionDir, entry)) return []
  const kept = join(sessionDir, '.proto', 'shares', entry.id, `v${entry.version}`)
  if (!existsSync(kept)) return []
  const out = []
  for (const p of entry.scope.protos) {
    const then = join(kept, p.id), now = join(sessionDir, 'src', 'protos', p.id)
    const names = { ...namesIn(then), ...namesIn(now) }
    const letters = new Set(), files = new Set([...filesUnder(then), ...filesUnder(now)])
    let parts = false
    for (const f of files) {
      const a = join(then, f), b = join(now, f)
      if (existsSync(a) && existsSync(b) && readFileSync(a).equals(readFileSync(b))) continue
      const m = f.includes('/') || f.includes('\\') ? null : VARIANT_FILE.exec(f)
      if (!m) parts = true
      else if (p.variants.includes(m[1])) letters.add(m[1])
    }
    for (const v of p.variants) if (letters.has(v)) out.push({ key: `${p.id}/${v}`, name: names[v] || v })
    if (parts) out.push({ key: `${p.id}/*`, name: 'Shared parts' })
  }
  return out
}

/** The message as the host takes it: trimmed, '' is none; longer than 280 characters is refused. */
export function messageOf(v) {
  if (v === undefined) return undefined
  if (v === null) return null
  if (typeof v !== 'string') throw new ShareError('message must be text')
  const t = v.trim()
  if (t.length > MAX_MESSAGE) throw new ShareError(`The message for viewers is at most ${MAX_MESSAGE} characters (this one has ${t.length}).`)
  return t || null
}

// What a version is built from, so what a viewer saw can be compared with the session later: the
// shared prototypes' files and their hash, taken just before the build (an edit during the build
// is then a change since shared, never folded into the snapshot), and kept as v<N> once published.
function sources(sessionDir, scope) {
  const hash = hashOf(sessionDir, scope)
  const stage = join(sessionDir, '.proto', 'shares', `.staging-${process.pid}-${randomBytes(4).toString('hex')}`)
  for (const p of scope.protos) cpSync(join(sessionDir, 'src', 'protos', p.id), join(stage, p.id), { recursive: true })
  return {
    hash,
    keep(id, version) {
      const to = join(sessionDir, '.proto', 'shares', id, `v${version}`)
      mkdirSync(join(to, '..'), { recursive: true })
      rmSync(to, { recursive: true, force: true })
      renameSync(stage, to)
    },
    drop() { rmSync(stage, { recursive: true, force: true }) },
  }
}

// The site in front of a host on its domain has the preview image chats show for a link.
const cardOf = host => host.stage === 'domain' ? `https://${host.base}/og-share.jpg` : undefined

/**
 * The link's preview card (card/card.mjs), drawn here once per publish and sent beside the page, so
 * the host only serves a file. Sent only when it differs from the one the link has (cardHash). The
 * page is already live, so a card that can't be drawn or sent leaves the link with the site's card.
 * Resolves with the hash of the card the link now has, or the one it had.
 */
async function sendCard(api, host, id, title, lang, had) {
  try {
    const sharp = loadSharp()
    if (!sharp) return had
    const me = await api.owner().catch(() => null)
    const owner = me?.login ? me : { name: host.owner || '' }
    const jpeg = await cardImage({ title, owner, lang, sharp })
    const hash = createHash('sha256').update(jpeg).digest('hex').slice(0, 16)
    if (hash !== had) await api.card(id, jpeg)
    return hash
  } catch {
    return had
  }
}

const metaFor = (session, sessionDir, scope, title, extra = {}) => ({
  title, session: String(session.id ?? basename(sessionDir)), projectLabel: basename(session.project || sessionDir), scope, lang: session.lang === 'he' ? 'he' : 'en', ...extra,
})

// Built and reviewed; null when it may go out, else what stops it.
// notes: the caller's own warnings, which need the same yes.
async function built({ sessionDir, scope, info, yes, notes = [] }) {
  const src = sources(sessionDir, scope)
  let b
  try { b = await buildShare({ sessionDir, scope, info }) } catch (e) { src.drop(); throw e }
  const review = reviewOf(b)
  review.notes.push(...notes)
  const stop = review.block.length ? { ok: false, blocked: true, review } : review.notes.length && !yes ? { ok: false, needsYes: true, review } : null
  if (stop) src.drop()
  return { b, review, stop, src }
}

/**
 * Builds the scope, reviews it, publishes it as a new link and records it in .proto/shares.json.
 * Resolves with { ok: true, entry, link, review }, or { ok: false, blocked | needsYes, review }
 * with nothing sent. Nothing is written on this Mac until the host has the page.
 */
export async function publishShare({ sessionDir, session, host, token, scope, title, message, yes, notes, fetch }) {
  const words = messageOf(message) ?? null
  const { b, review, stop, src } = await built({ sessionDir, scope, info: { title, owner: host.owner || '', version: 1, card: cardOf(host) }, yes, notes })
  if (stop) return stop
  let id, version, api
  try {
    api = client(host, token, fetch ? { fetch } : {})
    id = await api.create()
    ;({ version } = await api.put(id, b.gz, metaFor(session, sessionDir, scope, title, words ? { message: words } : {})))
  } catch (e) { src.drop(); throw e }
  src.keep(id, version)
  const cardHash = await sendCard(api, host, id, title, session.lang)
  const entry = { id, host: host.name, title, scope, version, publishedAt: new Date().toISOString(), sourceHash: src.hash, ...(words ? { message: words } : {}), ...(cardHash ? { cardHash } : {}) }
  writeShares(sessionDir, [...readShares(sessionDir).filter(e => e.id !== id), entry])
  return { ok: true, entry, link: linkOf(host, id), review }
}

/**
 * Update link: the same scope rebuilt and published as version N+1 of the same link, which keeps
 * its comments (the host marks those done as in this version). The note is kept with the share
 * here and sent along for the viewer's "What's new". message: text sets the viewers' message, null
 * clears it, undefined keeps the one the link has.
 */
export async function updateShare({ sessionDir, session, host, token, id, note, message, yes, notes, fetch }) {
  const entry = readShares(sessionDir).find(e => e.id === id)
  if (!entry) throw new ShareError(`No share ${id} in this session: proto share ls lists them`)
  if (entry.host !== host.name) throw new ShareError(`${id} is on the host "${entry.host}", not "${host.name}"`)
  const text = typeof note === 'string' ? note.trim().slice(0, 300) : ''
  const words = messageOf(message)
  const { b, review, stop, src } = await built({ sessionDir, scope: entry.scope, info: { title: entry.title, owner: host.owner || '', version: (entry.version || 1) + 1, card: cardOf(host) }, yes, notes })
  if (stop) return stop
  let version
  const api = client(host, token, fetch ? { fetch } : {})
  try {
    ;({ version } = await api.put(id, b.gz, metaFor(session, sessionDir, entry.scope, entry.title, { ...(text ? { note: text } : {}), ...(words !== undefined ? { message: words } : {}) })))
  } catch (e) { src.drop(); throw e }
  src.keep(id, version)
  const cardHash = await sendCard(api, host, id, entry.title, session.lang, entry.cardHash)
  const next = { ...entry, version, publishedAt: new Date().toISOString(), sourceHash: src.hash, ...(text ? { note: text } : {}), ...(words ? { message: words } : {}), ...(cardHash ? { cardHash } : {}) }
  if (!text) delete next.note
  if (words === null) delete next.message
  writeShares(sessionDir, readShares(sessionDir).map(e => e.id === id ? next : e))
  return { ok: true, entry: next, link: linkOf(host, id), review }
}

/** Takes a link down on the host, then forgets it here (its snapshots are kept). */
export async function removeShare({ sessionDir, host, token, id, fetch }) {
  await client(host, token, fetch ? { fetch } : {}).remove(id)
  writeShares(sessionDir, readShares(sessionDir).filter(e => e.id !== id))
}
