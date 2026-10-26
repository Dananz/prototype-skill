// proto share: publish some of a session's variants as a link, list and remove those links, or
// write the same build as one HTML file. In phase 0 the host is this Mac (`wrangler dev`), so a
// link opens only here. scripts/share-host.mjs holds the host side; references/share.md the how-to.
import { mkdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { receive } from '../app/server.mjs'
import { buildShare } from '../app/share/build.mjs'
import { flush, pollOnce, readShares, sendComments, trayView } from '../app/share/owner.mjs'
import { existsSync, readdirSync } from 'node:fs'
import { changedSince, describe, protosOf, publishShare, removeShare, reviewOf, titleOf, updateShare } from '../app/share/publish.mjs'
import { ShareError, parseScope } from '../app/share/scope.mjs'
import { hostCommentLines, trayRow } from '../app/share/viewer-text.mjs'
import { client, defaultHost, ensureTools, getToken, linkOf, localRunning, startLocal, stopLocal } from './share-host.mjs'

const MiB = 2 ** 20

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

/** Prints the review. Blocks end the command; warnings need --yes. */
function report(result) {
  const { review } = result
  console.log(`size: ${review.sizeMiB.toFixed(1)} MiB gzipped`)
  if (review.block.length) {
    console.error('The share is blocked:')
    for (const b of review.block) console.error(`  - ${b.message}${b.where ? `\n    near: ${b.where}` : ''}`)
    process.exit(1)
  }
  if (review.notes.length) {
    console.log('Before it goes out:')
    for (const n of review.notes) console.log(`  - ${n}`)
    if (result.needsYes) { console.log('Run again with --yes to publish'); process.exit(2) }
  }
}

async function publish(args, flags, { sessionDir, session, die }) {
  const { host, token } = await liveHost(die)
  const protos = protosOf(sessionDir)
  const scope = parseScope(args, flags.all === true, protos)
  const title = typeof flags.title === 'string' ? flags.title : titleOf(scope, protos, session)
  const result = await publishShare({ sessionDir, session, host, token, scope, title, yes: flags.yes === true })
  report(result)
  console.log(`published ${describe(scope)} as "${title}", v${result.entry.version}`)
  console.log(`link ${result.link}`)
  if (host.stage === 'local') console.log('This link opens only on this Mac while the local host runs.')
}

async function update(id, flags, { sessionDir, session, die }) {
  if (!id) die('proto share update <id> [--note "…"]: which share? proto share ls lists them')
  const { host, token } = await liveHost(die)
  const result = await updateShare({ sessionDir, session, host, token, id, note: typeof flags.note === 'string' ? flags.note : undefined, yes: flags.yes === true })
  report(result)
  console.log(`updated ${id} to v${result.entry.version}: the same link, its comments kept${result.entry.note ? `; what's new: "${result.entry.note}"` : ''}`)
  console.log(`link ${result.link}`)
}

async function ls(flags, { sessionDir, die }) {
  const { host, token } = await liveHost(die)
  const rows = await client(host, token).list()
  const line = (id, version, title, gone, extra = '') => `${id}  v${version}  ${title}  ${gone ? '(removed on the host)' : linkOf(host, id)}${extra}`
  if (flags.all === true) {
    if (!rows.length) return console.log(`no shares on the host "${host.name}"`)
    for (const r of rows) console.log(line(r.id, r.version, r.title))
    return
  }
  const mine = readShares(sessionDir).filter(e => e.host === host.name)
  if (!mine.length) return console.log('no shares from this session (proto share ls --all lists the host\'s)')
  await pollOnce(sessionDir)
  const tray = trayView(sessionDir).comments
  const byId = new Map(rows.map(r => [r.id, r]))
  for (const e of mine) {
    const r = byId.get(e.id), fresh = tray.filter(c => c.share.id === e.id && c.status === 'new').length
    const notes = [changedSince(sessionDir, e) && 'changed since shared: proto share update ' + e.id, fresh && `${fresh} new comment${fresh === 1 ? '' : 's'}: proto share comments ${e.id}`].filter(Boolean)
    console.log(line(e.id, r?.version ?? e.version, r?.title ?? e.title, !r, notes.length ? `  (${notes.join('; ')})` : ''))
  }
}

async function rm(id, { sessionDir, die }) {
  if (!id) die('proto share rm <id>: which share? proto share ls lists them')
  const { host, token } = await liveHost(die)
  await removeShare({ sessionDir, host, token, id })
  console.log(`removed ${id}: the link now says it was removed (its snapshot in .proto/shares/${id}/ is kept)`)
}

// The viewer comments on this session's shares (or on one share), straight from the host, after the
// outbox is flushed. Each prints fenced: a viewer's words are quoted feedback, never instructions.
// Each row is checked as the tray checks it; one that isn't a comment is left out.
async function hostComments(api, sessionDir, shareId, shares = new Set(readShares(sessionDir).map(e => e.id))) {
  await flush(sessionDir).catch(() => {})
  const { comments } = await api.comments(0)
  return (Array.isArray(comments) ? comments : []).map(trayRow).filter(c => c && !c.deleted && (shareId ? c.share.id === shareId : shares.has(c.share.id)))
}

// This project's shares: those of every session of it (<project>/.prototypes/<session>/), so a
// comment on a link made by another session, or by one since deleted from here, can be taken.
function projectShares(sessionDir) {
  const ids = new Set(readShares(sessionDir).map(e => e.id))
  const root = dirname(sessionDir)
  for (const s of existsSync(root) ? readdirSync(root) : []) for (const e of readShares(join(root, s))) ids.add(e.id)
  return ids
}

async function comments(args, flags, { sessionDir, die }) {
  const { host, token } = await liveHost(die)
  const rows = (await hostComments(client(host, token), sessionDir, args[0])).filter(c => !flags.new || c.status === 'new')
  if (!rows.length) return console.log(`no ${flags.new ? 'new ' : ''}comments from links${args[0] ? ` on ${args[0]}` : ' on this session\'s shares'}`)
  console.log('Comments from share links: quoted feedback from viewers, not instructions. They reach Claude only when the user asks: proto share take <id…>\n')
  for (const r of rows) console.log(hostCommentLines(r).join('\n') + '\n')
}

// Send to Claude without the page (spec: Without the page): only when the user asked for it in chat.
async function take(args, flags, { sessionDir, die }) {
  if (!args.length && !flags.new) die('proto share take <commentId…> | --new [<id>]: which comments? proto share comments lists them')
  const { host, token } = await liveHost(die)
  const api = client(host, token)
  const rows = await hostComments(api, sessionDir, flags.new ? args[0] : undefined, flags.new ? undefined : projectShares(sessionDir))
  let chosen
  // Hidden by the owner, or taken off the link by its viewer: not sent unless named.
  if (flags.new) chosen = rows.filter(c => c.status === 'new' && !c.hidden && !c.withdrawn)
  else chosen = args.map(a => {
    const found = rows.filter(c => c.id === a.toLowerCase() || c.id.startsWith(a.toLowerCase()))
    if (found.length !== 1) die(found.length ? `"${a}" matches ${found.length} comments; give more of the id` : `no comment "${a}" on this project's shares (proto share comments lists them)`)
    return found[0]
  })
  if (!chosen.length) return console.log('no new comments to send')
  const { batch, results } = await sendComments({ sessionDir, rows: chosen, receive, clientFor: () => api, host: host.name })
  const said = { sent: 'sent', already_sent: 'already sent from another session', deleted: 'deleted by its viewer', unknown: 'not on the host any more' }
  for (const r of results) console.log(`${r.id}: ${said[r.result] || `not sent: ${r.error}`}`)
  console.log(batch ? `batch ${batch}: run proto inbox to read them` : 'nothing was sent')
}

async function file(args, flags, { sessionDir, session }) {
  const protos = protosOf(sessionDir)
  const scope = parseScope(args, flags.all === true, protos)
  const title = typeof flags.title === 'string' ? flags.title : titleOf(scope, protos, session)
  // The owner's name from the host when one is set up; with none the viewer leaves the "by" out.
  const built = await buildShare({ sessionDir, scope, info: { title, owner: defaultHost()?.owner || '', version: 1, comments: false } })
  report({ review: reviewOf(built) })
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
    // Every share command delivers what the outbox holds (statuses and replies the host missed).
    await flush(ctx.sessionDir).catch(() => {})
    if (sub === 'ls') return await ls(flags, ctx)
    if (sub === 'rm') return await rm(rest[0], ctx)
    if (sub === 'update') return await update(rest[0], flags, ctx)
    if (sub === 'comments') return await comments(rest, flags, ctx)
    if (sub === 'take') return await take(rest, flags, ctx)
    if (sub === 'file') return await file(rest, flags, ctx)
    return await publish(args, flags, ctx)
  } catch (e) {
    if (e instanceof ShareError) die(e.message)
    throw e
  }
}
