// Publishing a share, updating it to a new version and taking it down: the one code `proto share`
// and the page's Share sheet (through the session's server) both run. The caller has the host and
// its owner token; nothing here starts a host, prints or exits. A share is reviewed before it goes:
// anything blocked stops it, and warnings stop it until the person says yes.
import { createHash } from 'node:crypto'
import { cpSync, existsSync, readFileSync, readdirSync } from 'node:fs'
import { basename, join, relative } from 'node:path'
import { metaOf } from '../server.mjs'
import { buildShare } from './build.mjs'
import { client, linkOf, readShares, writeShares } from './owner.mjs'
import { ShareError } from './scope.mjs'

const MiB = 2 ** 20
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

// What this version was built from, so what a viewer saw can be compared with the session later.
function snapshot(sessionDir, id, version, scope) {
  const to = join(sessionDir, '.proto', 'shares', id, `v${version}`)
  for (const p of scope.protos) cpSync(join(sessionDir, 'src', 'protos', p.id), join(to, p.id), { recursive: true })
}

const metaFor = (session, sessionDir, scope, title, extra = {}) => ({
  title, session: String(session.id ?? basename(sessionDir)), projectLabel: basename(session.project || sessionDir), scope, lang: session.lang === 'he' ? 'he' : 'en', ...extra,
})

// Built and reviewed; null when it may go out, else what stops it.
async function built({ sessionDir, scope, info, yes }) {
  const b = await buildShare({ sessionDir, scope, info })
  const review = reviewOf(b)
  if (review.block.length) return { b, review, stop: { ok: false, blocked: true, review } }
  if (review.notes.length && !yes) return { b, review, stop: { ok: false, needsYes: true, review } }
  return { b, review, stop: null }
}

/**
 * Builds the scope, reviews it, publishes it as a new link and records it in .proto/shares.json.
 * Resolves with { ok: true, entry, link, review }, or { ok: false, blocked | needsYes, review }
 * with nothing sent. Nothing is written on this Mac until the host has the page.
 */
export async function publishShare({ sessionDir, session, host, token, scope, title, yes, fetch }) {
  const { b, review, stop } = await built({ sessionDir, scope, info: { title, owner: host.owner || '', version: 1 }, yes })
  if (stop) return stop
  const api = client(host, token, fetch ? { fetch } : {})
  const id = await api.create()
  const { version } = await api.put(id, b.gz, metaFor(session, sessionDir, scope, title))
  snapshot(sessionDir, id, version, scope)
  const entry = { id, host: host.name, title, scope, version, publishedAt: new Date().toISOString(), sourceHash: hashOf(sessionDir, scope) }
  writeShares(sessionDir, [...readShares(sessionDir).filter(e => e.id !== id), entry])
  return { ok: true, entry, link: linkOf(host, id), review }
}

/**
 * Update link: the same scope rebuilt and published as version N+1 of the same link, which keeps
 * its comments (the host marks those done as in this version). The note is kept with the share
 * here and sent along for the viewer's "What's new".
 */
export async function updateShare({ sessionDir, session, host, token, id, note, yes, fetch }) {
  const entry = readShares(sessionDir).find(e => e.id === id)
  if (!entry) throw new ShareError(`No share ${id} in this session: proto share ls lists them`)
  if (entry.host !== host.name) throw new ShareError(`${id} is on the host "${entry.host}", not "${host.name}"`)
  const text = typeof note === 'string' ? note.trim().slice(0, 300) : ''
  const { b, review, stop } = await built({ sessionDir, scope: entry.scope, info: { title: entry.title, owner: host.owner || '', version: (entry.version || 1) + 1 }, yes })
  if (stop) return stop
  const { version } = await client(host, token, fetch ? { fetch } : {}).put(id, b.gz, metaFor(session, sessionDir, entry.scope, entry.title, text ? { note: text } : {}))
  snapshot(sessionDir, id, version, entry.scope)
  const next = { ...entry, version, publishedAt: new Date().toISOString(), sourceHash: hashOf(sessionDir, entry.scope), ...(text ? { note: text } : {}) }
  if (!text) delete next.note
  writeShares(sessionDir, readShares(sessionDir).map(e => e.id === id ? next : e))
  return { ok: true, entry: next, link: linkOf(host, id), review }
}

/** Takes a link down on the host, then forgets it here (its snapshots are kept). */
export async function removeShare({ sessionDir, host, token, id, fetch }) {
  await client(host, token, fetch ? { fetch } : {}).remove(id)
  writeShares(sessionDir, readShares(sessionDir).filter(e => e.id !== id))
}
