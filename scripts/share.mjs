// proto share: publish some of a session's variants as a link, list and remove those links, or
// write the same build as one HTML file. In phase 0 the host is this Mac (`wrangler dev`), so a
// link opens only here. scripts/share-host.mjs holds the host side; references/share.md the how-to.
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { metaOf } from '../app/server.mjs'
import { buildShare } from '../app/share/build.mjs'
import { ShareError, parseScope } from '../app/share/scope.mjs'
import { client, defaultHost, ensureTools, getToken, linkOf, localRunning, startLocal, stopLocal } from './share-host.mjs'

const MiB = 2 ** 20
const readJson = (f, fallback) => { try { return JSON.parse(readFileSync(f, 'utf8')) } catch { return fallback } }
const filesIn = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? filesIn(join(dir, e.name)) : [join(dir, e.name)])

// The session's prototypes as parseScope wants them: id, variant letters in the page's order, archived.
function protosOf(sessionDir) {
  const root = join(sessionDir, 'src', 'protos')
  if (!existsSync(root)) return []
  return readdirSync(root).flatMap(id => {
    let meta
    try { meta = metaOf(readFileSync(join(root, id, 'meta.ts'), 'utf8')) } catch { return [] }
    const variants = Object.keys(meta.variants || {}).sort((a, b) => a.length - b.length || a.localeCompare(b))
    return [{ id, title: meta.title, variants, archived: !!meta.archived }]
  })
}

const sharesFile = dir => join(dir, '.proto', 'shares.json')
const readShares = dir => readJson(sharesFile(dir), []).filter(e => e && typeof e.id === 'string')
const writeShares = (dir, list) => { mkdirSync(dirname(sharesFile(dir)), { recursive: true }); writeFileSync(sharesFile(dir), JSON.stringify(list, null, 2) + '\n') }

// The default host, running. A local one that is down is started again, unless
// PROTO_SHARE_NO_START=1 (then the upload fails and says so, which the smoke relies on).
async function liveHost(die) {
  const host = defaultHost()
  if (!host) die('No share host yet: run proto share setup --local')
  if (host.stage !== 'local') die(`The host "${host.name}" is a ${host.stage} host; phase 0 publishes to a local one only`)
  const token = getToken(host.name)
  if (!token) die(`No owner token for the host "${host.name}" on this machine: run proto share setup --local`)
  if (process.env.PROTO_SHARE_NO_START === '1' || await localRunning(host)) return { host, token }
  const started = await startLocal()
  return { host: started, token: getToken(started.name) }
}

const titleOf = (scope, protos, session) => {
  if (scope.protos.length === 1) return protos.find(p => p.id === scope.protos[0].id)?.title || scope.protos[0].id
  return session.name || basename(session.project || '') || 'Prototypes'
}
const describe = scope => scope.protos.map(p => `${p.id} (${p.variants.length} variant${p.variants.length === 1 ? '' : 's'})`).join(', ')

/** Prints the review. Blocks end the command; warnings need --yes unless allowed. */
function report(built, { yes, needYes = true }) {
  const { block, warn } = built.review
  const notes = [...warn.map(w => w.message), ...built.warnings]
  console.log(`size: ${(built.gzBytes / MiB).toFixed(1)} MiB gzipped`)
  if (block.length) {
    console.error('The share is blocked:')
    for (const b of block) console.error(`  - ${b.message}${b.where ? `\n    near: ${b.where}` : ''}`)
    process.exit(1)
  }
  if (notes.length) {
    console.log('Before it goes out:')
    for (const n of notes) console.log(`  - ${n}`)
    if (needYes && !yes) { console.log('Run again with --yes to publish'); process.exit(2) }
  }
}

async function publish(args, flags, { sessionDir, session, die }) {
  const { host, token } = await liveHost(die)
  const protos = protosOf(sessionDir)
  const scope = parseScope(args, flags.all === true, protos)
  const title = typeof flags.title === 'string' ? flags.title : titleOf(scope, protos, session)
  const built = await buildShare({ sessionDir, scope, info: { title, owner: host.owner || '', version: 1 } })
  report(built, { yes: flags.yes === true })

  // Nothing is written here until the host has the page.
  const api = client(host, token)
  const id = await api.create()
  const { version } = await api.put(id, built.gz, { title, session: String(session.id ?? basename(sessionDir)), projectLabel: basename(session.project || sessionDir), scope, lang: session.lang === 'he' ? 'he' : 'en' })

  // What this version was built from, so what a viewer saw can be compared with the session later.
  const snapshot = join(sessionDir, '.proto', 'shares', id, `v${version}`)
  const hash = createHash('sha256')
  for (const p of scope.protos) {
    const from = join(sessionDir, 'src', 'protos', p.id)
    cpSync(from, join(snapshot, p.id), { recursive: true })
    for (const f of filesIn(from).sort()) hash.update(relative(sessionDir, f)).update('\0').update(readFileSync(f))
  }
  const entry = { id, host: host.name, title, scope, version, publishedAt: new Date().toISOString(), sourceHash: hash.digest('hex') }
  writeShares(sessionDir, [...readShares(sessionDir).filter(e => e.id !== id), entry])
  console.log(`published ${describe(scope)} as "${title}", v${version}`)
  console.log(`link ${linkOf(host, id)}`)
  if (host.stage === 'local') console.log('This link opens only on this Mac while the local host runs.')
}

async function ls(flags, { sessionDir, die }) {
  const { host, token } = await liveHost(die)
  const rows = await client(host, token).list()
  const line = (id, version, title, gone) => `${id}  v${version}  ${title}  ${gone ? '(removed on the host)' : linkOf(host, id)}`
  if (flags.all === true) {
    if (!rows.length) return console.log(`no shares on the host "${host.name}"`)
    for (const r of rows) console.log(line(r.id, r.version, r.title))
    return
  }
  const mine = readShares(sessionDir).filter(e => e.host === host.name)
  if (!mine.length) return console.log('no shares from this session (proto share ls --all lists the host\'s)')
  const byId = new Map(rows.map(r => [r.id, r]))
  for (const e of mine) { const r = byId.get(e.id); console.log(line(e.id, r?.version ?? e.version, r?.title ?? e.title, !r)) }
}

async function rm(id, { sessionDir, die }) {
  if (!id) die('proto share rm <id>: which share? proto share ls lists them')
  const { host, token } = await liveHost(die)
  await client(host, token).remove(id)
  writeShares(sessionDir, readShares(sessionDir).filter(e => e.id !== id))
  console.log(`removed ${id}: the link now says it was removed (its snapshot in .proto/shares/${id}/ is kept)`)
}

async function file(args, flags, { sessionDir, session }) {
  const protos = protosOf(sessionDir)
  const scope = parseScope(args, flags.all === true, protos)
  const title = typeof flags.title === 'string' ? flags.title : titleOf(scope, protos, session)
  const built = await buildShare({ sessionDir, scope, info: { title, owner: '', version: 1, comments: false } })
  report(built, { yes: true, needYes: false })
  const out = typeof flags.out === 'string' ? resolve(flags.out) : join(sessionDir, '.proto', 'shares', `${scope.protos[0].id}.html`)
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, built.html)
  console.log(`wrote ${out} (${(statSync(out).size / MiB).toFixed(1)} MiB): one file, opens from disk, no comments`)
}

async function setup(flags, die) {
  if (flags.local !== true) die('Phase 0 sets up a host on this Mac only: proto share setup --local')
  await ensureTools()
  const host = await startLocal({ name: flags.name })
  console.log(`local share host on ${host.url} (owner ${host.owner})`)
  console.log(host.pathMode ? `links: http://127.0.0.1:${new URL(host.url).port}/s/<id>/ (*.localhost does not resolve here)` : `links: http://<id>.localhost:${new URL(host.url).port}/`)
  console.log('Links open only on this Mac while it runs. proto share stop stops it; the next share starts it again.')
}

export async function main(args, flags, ctx) {
  const { die } = ctx
  try {
    const [sub, ...rest] = args
    if (sub === 'setup') return await setup(flags, die)
    if (sub === 'stop') {
      const was = await stopLocal()
      return console.log(was ? 'stopped the local share host (its links answer again after the next proto share)' : 'the local share host was not running')
    }
    if (sub === 'ls') return await ls(flags, ctx)
    if (sub === 'rm') return await rm(rest[0], ctx)
    if (sub === 'file') return await file(rest, flags, ctx)
    return await publish(args, flags, ctx)
  } catch (e) {
    if (e instanceof ShareError) die(e.message)
    throw e
  }
}
