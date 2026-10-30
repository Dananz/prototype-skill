// The dev-server side of a prototype session: status for the shell, the Keep and Stop
// buttons, and stopping by itself after hours with no edits and nobody looking.
import { batchOwner, commentListener, listenerSids, listenerStatus } from './listener.mjs'
import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, renameSync, rmSync, statSync, watch } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assignmentNeeded, buildUpNeeded, isCurrent } from './assignment.mjs'
import { snapshot } from './history.mjs'
import { writeBrief } from './brief.mjs'

const dir = fileURLToPath(new URL('.', import.meta.url))
const file = join(dir, 'session.json')
// Compared with forward slashes: the watcher's paths and these differ on Windows.
const slash = p => p.replaceAll('\\', '/')
const stylesheet = slash(join(dir, 'shell', 'shell.css'))
const read = () => JSON.parse(readFileSync(file, 'utf8'))
// Read again right before writing, and written whole, under the lock `proto` takes too (it writes
// session.json as well; see locked() in scripts/proto.mjs). patch: the fields, or a function of the
// session as it is now that returns them (nothing to write: null).
const write = patch => locked(() => {
  const now = read(), change = typeof patch === 'function' ? patch(now) : patch
  if (change) writeWhole(file, JSON.stringify({ ...now, ...change }, null, 2) + '\n')
})
function locked(fn) {
  const lock = join(dir, '.proto', 'session.lock')
  mkdirSync(dirname(lock), { recursive: true })
  let mine = false
  for (let i = 0; i < 200 && !mine; i++) {
    try { mkdirSync(lock); mine = true } catch {
      try { if (Date.now() - statSync(lock).mtimeMs > 5000) rmSync(lock, { recursive: true, force: true }) } catch { /* just released */ }
      if (!mine) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20)
    }
  }
  try { return fn() } finally { if (mine) rmSync(lock, { recursive: true, force: true }) }
}

// Newest change to any prototype file; the session's own start time if there are none.
export function lastEdit(root = dir) {
  let newest = 0
  try { newest = Date.parse(JSON.parse(readFileSync(join(root, 'session.json'), 'utf8')).createdAt) || 0 } catch { /* being rewritten by hand */ }
  const walk = d => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name)
      if (e.isDirectory()) walk(p)
      else newest = Math.max(newest, statSync(p).mtimeMs)
    }
  }
  try { walk(join(root, 'src', 'protos')) } catch { /* no prototypes yet */ }
  return newest
}

const DECIDED_IDLE = 90 * 60e3
// True when the session has prototypes and each one is picked or archived.
export function decided() {
  const metas = []
  try {
    for (const slug of readdirSync(join(dir, 'src', 'protos'))) {
      try { metas.push(metaOf(readFileSync(metaFile(slug), 'utf8'))) } catch { /* not a prototype */ }
    }
  } catch { /* none yet */ }
  return metas.length > 0 && metas.every(m => m.archived || m.picked)
}

// The page moves the working variant three ways: back to one under Before (the one it leaves goes
// to Before, as with `proto work`), Undo of a move it was just told about (nothing is kept), or a
// pick made in the page, which also adds what was asked to that variant's history. True when it moved.
const same = (a, b) => !!a && !!b && a.proto === b.proto && a.variant === b.variant
function work({ proto, variant, undo, ask }) {
  const s = read(), t = { proto: String(proto), variant: String(variant) }
  const at = new Date().toISOString(), patch = {}
  if (!same(s.work, t)) {
    const before = undo ? (s.before || []).filter(x => !same(x, t)) : [s.work, ...(s.before || [])].filter(x => x && !same(x, t))
    patch.work = { ...t, at }
    patch.before = before.filter((x, i, all) => all.findIndex(y => same(x, y)) === i).slice(0, 3).map(x => ({ proto: x.proto, variant: x.variant }))
  }
  if (ask) {
    const key = `${t.proto}/${t.variant}`
    patch.asks = { ...s.asks, [key]: [...(s.asks?.[key] || []), { at, text: ask }] }
    // The design as it was picked, kept for History (history.mjs): the note may change it next.
    try { snapshot(dir, t.proto, t.variant, ask, { at }) } catch { /* the pick still counts */ }
  }
  if (Object.keys(patch).length) write(patch)
  return !!patch.work
}
// One line of history on a variant, without moving the working variant: what a plug-in leaves.
function note(key, text) {
  write(now => ({ asks: { ...now.asks, [key]: [...(now.asks?.[key] || []), { at: new Date().toISOString(), text }] } }))
}

// meta.ts is `export default` and plain JSON, which is how `proto` reads and rewrites it too.
function metaFile(slug) { return join(dir, 'src', 'protos', slug, 'meta.ts') }
export function metaOf(text) { return JSON.parse(text.replace(/^[\s\S]*?export default\s*/, '').replace(/;?\s*$/, '')) }
// Through a function: a replacement string would read `$&` or `$$` in a variant's name as a pattern.
const withMeta = (text, meta) => text.replace(/export default[\s\S]*$/, () => `export default ${JSON.stringify(meta, null, 2)}\n`)
// A variant is its file, as the page finds it (registry.ts): <letter>.tsx, .jsx, .vue or .svelte.
const hasVariant = (slug, id) => ['tsx', 'jsx', 'vue', 'svelte'].some(x => existsSync(join(dir, 'src', 'protos', slug, `${id}.${x}`)))
// What stands in each slot: `<prototype>/<slot id>` is `<child>/<letter>` while that is the
// `use` in the prototype's meta.ts. A child that is archived, or whose file is gone, plugs
// nothing in, so the original shows.
export function slotPointers() {
  const out = {}
  let slugs = []
  try { slugs = readdirSync(join(dir, 'src', 'protos')) } catch { /* none yet */ }
  for (const slug of slugs) {
    let meta
    try { meta = metaOf(readFileSync(metaFile(slug), 'utf8')) } catch { continue }
    for (const [id, slot] of Object.entries(meta.slots || {})) {
      const [from, letter] = String(slot?.use || '').split('/')
      if (!from || !letter || !hasVariant(from, letter)) continue
      try { if (metaOf(readFileSync(metaFile(from), 'utf8')).archived) continue } catch { continue }
      out[`${slug}/${id}`] = `${from}/${letter}`
    }
  }
  return out
}
// A prototype made to stand in for part of another (`slot` in its meta.ts, `from` naming the
// parent) plugs its pick in there at once: the pick is the slot's `use`. The variant called
// Current (or As built) is the original, and so is no pick, so those clear it. Undoing a pick
// clears it only while it is that variant. Says what it did, or null when nothing changed:
// the parent and the letter that holds the slot, and the `use` it had and has now ('' for none).
function plug(slug, meta, id, off) {
  if (!meta.slot || typeof meta.from !== 'string') return null
  const [parent, from] = meta.from.split('/')
  let text, pm
  try { text = readFileSync(metaFile(parent), 'utf8'); pm = metaOf(text) } catch { return null }
  const slot = pm.slots?.[meta.slot]
  if (!slot) return null
  const use = `${slug}/${id}`
  if (off && slot.use !== use) return null
  const next = off || isCurrent(meta.variants?.[id]) ? '' : use
  if ((slot.use || '') === next) return null
  const { use: _, ...rest } = slot
  pm.slots[meta.slot] = next ? { ...rest, use: next } : rest
  writeWhole(metaFile(parent), withMeta(text, pm))
  return { parent, letter: String(slot.variant || from || ''), was: slot.use || '', now: next }
}
// What a plug-in says on the two variants it touches, in the words the page's strip shows: the
// picked one (or the one unpicked) and the parent variant. The "Picked" line comes first.
function plugLines(did, slug, id) {
  const title = s => { try { return metaOf(readFileSync(metaFile(s), 'utf8')).title || s } catch { return s } }
  const [was, wasId] = did.was.split('/')
  const into = [title(did.parent), did.letter].filter(Boolean).join(' ')
  return [
    [`${slug}/${id}`, did.now ? `Plugged into ${into}` : `Original back in ${into}`],
    ...(did.letter ? [[`${did.parent}/${did.letter}`, did.now ? `Plugged in ${title(slug)} ${id}` : `Original back, took out ${title(was)} ${wasId}`]] : []),
  ]
}
// A pick made in the page is what `proto pick` does, done at once instead of when the agent next
// looks: the variant is marked in its meta.ts and becomes the working variant, its history starting
// with "Picked <letter>" (the page's strip knows those words). Taking the pick back unmarks it only
// while it is still on that variant. Says what it did: 'moved' (the working variant moved too),
// 'done', or 'nothing' (an unpick of a variant that isn't the pick). A failure once meta.ts is
// written is marked as such, so nobody is told to mark it again.
// A pick in a prototype built from another variant (`from: "<parent>/<letter>"`) picks that variant
// too, all the way up: choosing a part of B means choosing B. Only the structural parent (`from`),
// never the `also` list; an archived parent, or one picked already, is left as it is. Undoing a pick
// leaves the parents picked. Returns the routes it picked, as <slug>/<letter>.
export function pickParents(slug) {
  const picked = [], seen = new Set([slug])
  let from
  try { from = metaOf(readFileSync(metaFile(slug), 'utf8')).from } catch { return picked }
  while (typeof from === 'string' && from.includes('/')) {
    const [parent, letter] = from.split('/')
    if (!letter || seen.has(parent)) break
    seen.add(parent)
    let text, pm
    try { text = readFileSync(metaFile(parent), 'utf8'); pm = metaOf(text) } catch { break }
    if (!pm.archived && pm.variants?.[letter] && !pm.picked) {
      pm.picked = letter
      writeWhole(metaFile(parent), withMeta(text, pm))
      picked.push(`${parent}/${letter}`)
    }
    from = pm.from
  }
  return picked
}
function pick(route, off) {
  const [slug, id] = route.split('/')
  const text = readFileSync(metaFile(slug), 'utf8'), meta = metaOf(text)
  if (off && meta.picked !== id) return 'nothing'
  // Before the pick is marked: if the parent can't be written, nothing is marked and `proto pick` redoes both.
  const did = plug(slug, meta, id, off)
  if (off) delete meta.picked
  else meta.picked = id
  writeWhole(metaFile(slug), withMeta(text, meta))
  // the variants it was built from are chosen with it (never undone by an unpick)
  if (!off) try { pickParents(slug) } catch { /* the pick itself is made; the parents can be picked by hand */ }
  let moved = false
  if (!off) {
    try { moved = work({ proto: slug, variant: id, ask: `Picked ${id}` }) }
    catch (e) { throw Object.assign(e instanceof Error ? e : new Error(String(e)), { marked: true }) }
  }
  // History is a trace, never a reason to fail a pick that is already made.
  if (did) try { for (const [key, text] of plugLines(did, slug, id)) note(key, text) } catch { /* the pointer is what counts */ }
  return moved ? 'moved' : 'done'
}

// A favorite is the user's own mark on a variant, for finding it again among many: kept in
// meta.ts as `favorites` (letter IDs in the page's order), where `proto fav` reads and writes it
// too. Unlike a pick it asks nothing of the agent, so it is no comment. Returns the list as it is now.
const order = (a, b) => a.length - b.length || a.localeCompare(b)
function fav({ proto, variant, on }) {
  if (typeof proto !== 'string' || typeof variant !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(proto) || !/^[A-Z]{1,2}$/.test(variant)) throw Object.assign(new Error('send { proto, variant, on }'), { status: 400 })
  let text, meta
  try { text = readFileSync(metaFile(proto), 'utf8'); meta = metaOf(text) } catch { throw Object.assign(new Error(`src/protos/${proto}/meta.ts is missing or isn't plain JSON`), { status: 404 }) }
  if (!meta.variants?.[variant] && !hasVariant(proto, variant)) throw Object.assign(new Error(`${proto} has no variant ${variant}`), { status: 404 })
  const was = Array.isArray(meta.favorites) ? meta.favorites.filter(x => typeof x === 'string') : []
  const now = (on ? [...new Set([...was, variant])] : was.filter(x => x !== variant)).sort(order)
  if (now.join() === was.join()) return now
  if (now.length) meta.favorites = now
  else delete meta.favorites
  writeWhole(metaFile(proto), withMeta(text, meta))
  return now
}

// ---------- the inbox: comments from the page, for the agent running the session ----------
// Each send is one batch folder under .proto/inbox/: batch.json, plus its screenshots as files.
// A new batch waits in new/ until `proto inbox` takes it, which moves it to taken/ (a rename,
// so two readers never both get it). Replies are written into the taken batch.
const inbox = join(dir, '.proto', 'inbox')
const MAX_BODY = 40 * 1024 * 1024
// Windows keeps a directory busy while a scanner or a watcher has a file in it, so a rename can
// fail with EPERM or EBUSY for a moment. Try again for a couple of seconds, and copy as the last resort.
const BUSY = new Set(['EPERM', 'EBUSY', 'EACCES'])
function moveDir(from, to) {
  for (let i = 0; ; i++) {
    try { return renameSync(from, to) } catch (e) {
      if (!BUSY.has(e.code)) throw e
      if (i >= 40) { cpSync(from, to, { recursive: true }); rmSync(from, { recursive: true, force: true }); return }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50)
    }
  }
}
// session.json and meta.ts are written whole or not at all: into a scratch file, then renamed over
// the old one, so nobody (the page, `proto`) reads half of one and a failed write leaves the old one.
// The scratch file waits in .proto/, which the dev server doesn't watch; one next to meta.ts would
// look like an edit to the prototype.
const scratch = join(dir, '.proto', 'tmp')
function writeWhole(to, text) {
  mkdirSync(scratch, { recursive: true })
  const tmp = join(scratch, `${basename(to)}.${process.pid}.${randomBytes(4).toString('hex')}`)
  writeFileSync(tmp, text)
  try { moveDir(tmp, to) } catch (e) { rmSync(tmp, { force: true }); throw e }
}
const alive = pid => { if (!pid) return false; try { process.kill(pid, 0); return true } catch { return false } }
const readJson = (f, fallback) => { try { return JSON.parse(readFileSync(f, 'utf8')) } catch { return fallback } }
const readdirSyncSafe = path => { try { return readdirSync(path).filter(f => !f.startsWith('.')) } catch { return [] } }
const list = sub => { try { return readdirSync(join(inbox, sub)).filter(f => !f.startsWith('.')) } catch { return [] } }

// ---------- the intake: questions the agent asks before building, answered in the page ----------
// `proto intake set` writes .proto/intake/current.json; the page shows it as its own screen until it
// is answered. The answers come back as a batch in the inbox (one comment, action: intake), so the
// agent hears of them the way it hears of comments.
const intakeDir = join(dir, '.proto', 'intake')
const intakeFile = join(intakeDir, 'current.json')
const intakeNow = () => readJson(intakeFile, null)
/** What a page may be told about the intake: the questions, and whether they wait for answers. */
const intakeView = () => { const d = intakeNow(); return d && Array.isArray(d.questions) ? d : null }

/** Where the inbox stands, for the page: what waits, whether an agent is listening, the batches' states. */
export function inboxStatus() {
  const waiter = readJson(join(inbox, 'waiter.json'), null)
  const agent = readJson(join(inbox, 'agent.json'), null)
  const batches = [...list('new').map(id => [id, 'new']), ...list('taken').map(id => [id, 'taken'])].map(([id, where]) => {
    const b = readJson(join(inbox, where, id, 'batch.json'), null)
    return b && {
      id, at: b.at, state: b.done ? 'done' : where === 'new' ? 'sent' : b.takenBy?.pid && !alive(b.takenBy.pid) ? 'lost' : 'seen', reply: b.reply ?? null,
      comments: b.comments.map(c => ({ n: c.n, route: c.route, action: c.action, done: !!c.done, ...(c.withdrawn ? { withdrawn: true } : {}), ...(c.action && c.target ? { scoped: true } : {}), reply: c.reply ?? null })),
    }
  }).filter(Boolean).sort((a, b) => a.at < b.at ? 1 : -1)
  return { intake: intakeView(), new: list('new').length, listening: listenerSids(dir).some(sid => listenerStatus(dir, sid).listening) || !!waiter && alive(waiter.pid), agent: agent?.pid ? (alive(agent.pid) ? 'alive' : 'gone') : null, batches: batches.filter((b, i) => i < 20 || b.comments.some(c => ['try-it', 'copy-options'].includes(c.action) && !c.done && !c.withdrawn)) }
}

const box = r => r && typeof r === 'object' ? { x: Math.round(+r.x || 0), y: Math.round(+r.y || 0), w: Math.round(+r.w || 0), h: Math.round(+r.h || 0) } : undefined
const clip = (s, n) => typeof s === 'string' ? s.slice(0, n) : undefined
// A region dragged out on the design: a box in its px with some size to it.
const regionOf = r => { const b = box(r); return b && b.w >= 1 && b.h >= 1 ? b : undefined }
const element = t => t && typeof t === 'object' ? {
  selector: clip(t.selector, 500), shoot: clip(t.shoot, 100), src: clip(t.src, 300), component: clip(t.component, 100),
  tag: clip(t.tag, 40), text: clip(t.text, 300), rect: box(t.rect), within: clip(t.within, 100),
  ...(t.stage && Number.isInteger(t.stage.w) && Number.isInteger(t.stage.h) && t.stage.w > 0 && t.stage.h > 0 && t.stage.w <= 10000 && t.stage.h <= 10000 ? { stage: { w: t.stage.w, h: t.stage.h } } : {}),
  ...(t.source && typeof t.source.proto === 'string' && /^[a-z0-9][a-z0-9-]*$/i.test(t.source.proto) && typeof t.source.variant === 'string' && /^[A-Z]+$/.test(t.source.variant) ? { source: { proto: clip(t.source.proto, 100), variant: clip(t.source.variant, 12), ...(typeof t.source.state === 'string' ? { state: clip(t.source.state, 100) } : {}) } } : {}),
  ...(t.whole === true ? { whole: true } : {}),
  ...(regionOf(t.region) ? { region: regionOf(t.region) } : {}),
  ...(t.commentRef && typeof t.commentRef === 'object' && typeof t.commentRef.id === 'string' && typeof t.commentRef.proto === 'string' && typeof t.commentRef.variant === 'string' && Number.isInteger(t.commentRef.n) && t.commentRef.n > 0 ? { commentRef: { id: clip(t.commentRef.id, 160), proto: clip(t.commentRef.proto, 100), variant: clip(t.commentRef.variant, 12), n: t.commentRef.n, quote: clip(t.commentRef.quote, 2000) } } : {}),
  ...(t.variantRef && typeof t.variantRef === 'object' && typeof t.variantRef.proto === 'string' && typeof t.variantRef.variant === 'string' && typeof t.variantRef.label === 'string' && typeof t.variantRef.name === 'string' && /^[a-z0-9][a-z0-9-]*$/i.test(t.variantRef.proto) && /^[A-Z]+$/.test(t.variantRef.variant) ? { variantRef: { proto: clip(t.variantRef.proto, 100), variant: clip(t.variantRef.variant, 12), label: clip(t.variantRef.label, 80), name: clip(t.variantRef.name, 160) } } : {}),
  ...(Array.isArray(t.route) && t.route.length ? { route: t.route.slice(0, 6).filter(r => typeof r === 'string').map(r => clip(r, 200)) } : {}),
  ...(Array.isArray(t.uses) && t.uses.length ? { uses: t.uses.slice(0, 4).filter(u => u && typeof u === 'object').map(u => ({ component: clip(u.component, 100), at: clip(u.at, 300), ...(u.key != null ? { key: clip(String(u.key), 100) } : {}), ...(typeof u.props === 'string' ? { props: clip(u.props, 240) } : {}) })) } : {}),
} : undefined
// The design's own localStorage as the page had it when the batch was sent, for `proto shoot --pin`:
// string keys and values, none of the page's own (proto-), at most 64 KB in all. Anything else is
// left out whole.
const storageOf = st => {
  if (!st || typeof st !== 'object' || Array.isArray(st)) return null
  const out = {}
  let size = 0
  for (const [k, v] of Object.entries(st)) {
    if (typeof v !== 'string' || !k || k.startsWith('proto-')) return null
    size += k.length + v.length
    if (size > 64 * 1024) return null
    out[k] = v
  }
  return Object.keys(out).length ? out : null
}
// A comment on the design's motion (the page's motion dock) is on a moment of its take, `at`, or a
// range of it, `at` to `to`, in ms, and says how long the take is: whole numbers of ms inside it.
// Null when the comment has none; false when what it has isn't that.
const MAX_TAKE = 60_000
const timeOf = c => {
  if (c.at === undefined && c.to === undefined && c.take === undefined) return null
  const ms = x => typeof x === 'number' && Number.isFinite(x) ? Math.round(x) : NaN
  const at = ms(c.at), to = c.to === undefined ? undefined : ms(c.to), take = ms(c.take)
  if (!(take > 0 && take <= MAX_TAKE && at >= 0 && at <= take) || (to !== undefined && !(to > at && to <= take))) return false
  return { at, ...(to !== undefined ? { to } : {}), take }
}
// A comment written in the page's device view is about that layout: a phone's, a tablet's or a
// desktop's, at the size it was shown, in whole CSS px. Null when the comment has none; false when
// what it has isn't that.
const VIEW_SIZES = new Set(['phone', 'tablet', 'desktop'])
const viewOf = c => {
  if (c.view === undefined) return null
  const v = c.view, px = x => Number.isInteger(x) && x >= 200 && x <= 4000
  return v && typeof v === 'object' && VIEW_SIZES.has(v.size) && px(v.w) && px(v.h) ? { size: v.size, w: v.w, h: v.h } : false
}

// Where a comment from a share link came from (app/share/viewer-text.mjs fromComment): the share,
// the version the viewer saw, their GitHub login and display name, and the host's comment id.
const SHARE_ID = /^[0-9a-z]{10}$/
const fromOk = f => !!f && typeof f === 'object' && SHARE_ID.test(f.share) && SHARE_ID.test(f.link) && Number.isInteger(f.version) && f.version > 0 && f.version < 1e6
  && typeof f.viewer === 'string' && /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(f.viewer) && typeof f.verified === 'boolean'
  && typeof f.comment === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(f.comment)
  && (f.name === undefined || (typeof f.name === 'string' && /^[\p{L}\p{N} .'-]{0,40}$/u.test(f.name)))
  && (f.title === undefined || (typeof f.title === 'string' && f.title.length <= 120 && !/[\x00-\x1f\x7f-\x9f]/.test(f.title)))
  && (f.earlier === undefined || (!!f.earlier && typeof f.earlier.text === 'string' && f.earlier.text.length <= 4000 && (f.earlier.reply === null || (typeof f.earlier.reply === 'string' && f.earlier.reply.length <= 4000))))
// A reply on the link keeps what it answers (earlier: the viewer's comment and the owner's reply to it).
const fromOf = f => ({ share: f.share, version: f.version, viewer: f.viewer, name: f.name ?? '', verified: f.verified, link: f.link, comment: f.comment, ...(f.title ? { title: f.title } : {}), ...(f.earlier ? { earlier: { text: f.earlier.text, reply: f.earlier.reply } } : {}) })

// A decision on a variant made in the page (its Pick, More like this and Build it) comes as a
// comment with one of these and no element. A copy choice (the copy picker's Send) is one too, on
// the element of the line it changes. More variants is the one made on a prototype (route <slug>),
// with how many.
// Fix before sharing is asked from a share review: the owner's words and what the review found.
const ACTIONS = new Set(['pick', 'unpick', 'more', 'more-variants', 'build', 'copy', 'try-it', 'copy-options', 'share-fix'])

/**
 * Writes one send from the page as a new batch; images come as data URLs and are stored as files.
 * All of it is checked before anything is written: an action's variant must be there, and a pick's
 * prototype must have a meta.ts that reads, since the pick is written into it. Picks are made next,
 * each on its own, so one that fails says why in its comment and never keeps the batch from
 * arriving. Returns the batch, and whether the working variant moved.
 */
export function receive(data, root = dir, { check = false } = {}) {
  const inbox = join(root, '.proto', 'inbox')
  const comments = Array.isArray(data.comments) ? data.comments : []
  if (!comments.length) throw Object.assign(new Error('no comments'), { status: 400 })
  const bad = (i, why) => Object.assign(new Error(`comment ${i + 1}${why}`), { status: 400 })
  const at = new Date().toISOString()
  // Unique among the batches there are: two sends in one second that drew the same suffix would
  // share a folder, and the second could never be taken.
  let id
  do id = `${at.replace(/[-:]/g, '').replace(/\..*/, '')}-${randomBytes(2).toString('hex')}`
  while (['new', 'taken', '.incoming'].some(sub => existsSync(join(inbox, sub, id))))
  const files = []
  const list = comments.map((c, i) => {
    if (typeof c?.text !== 'string') throw bad(i, ' has no text')
    if (typeof c.route !== 'string' || !/^[a-z0-9][a-z0-9-]*(\/[A-Z]{1,2}(\/[\w-]+)?)?$/.test(c.route)) throw bad(i, ': route is <slug>[/<letter>[/<state>]]')
    const time = timeOf(c)
    if (time === false) throw bad(i, `: a moment of the motion is at (and to, for a range) in ms inside the take, and take, its length in ms (up to ${MAX_TAKE})`)
    if (time && (!/^[^/]+\/[A-Z]{1,2}(\/|$)/.test(c.route) || c.action !== undefined || c.point !== undefined || c.region !== undefined)) throw bad(i, ': a comment on the motion is on a variant (<slug>/<letter>), with no action, point or region')
    // A follow-up answers the reply to a comment sent before: which one, so `proto inbox` can say
    // what was said before it. Only its address is kept; the thread itself is in the batches.
    if (c.re !== undefined && (typeof c.re?.batch !== 'string' || !/^[\w-]{1,60}$/.test(c.re.batch) || !Number.isInteger(c.re.n) || c.re.n < 1 || c.action !== undefined)) throw bad(i, ': re is { batch, n }, the sent comment whose reply this answers, on a comment with no action')
    // A viewer's comment from a share link (Send to Claude, or `proto share take`): their words are
    // data, printed fenced by `proto inbox`; it carries none of what only the owner's page can send.
    if (c.from !== undefined) {
      if (!fromOk(c.from)) throw bad(i, ': from is { share, version, viewer, verified, link, comment }, a comment from a share link')
      if (c.action !== undefined || c.re !== undefined || c.point !== undefined || c.region !== undefined || time || (Array.isArray(c.tags) && c.tags.length) || (Array.isArray(c.images) && c.images.length)) throw bad(i, ': a comment from a link has no action, follow-up, spot, region, moment, tags or pictures')
    }
    const view = viewOf(c)
    if (view === false) throw bad(i, ': view is { size: phone, tablet or desktop, w, h }, the layout\'s size in whole CSS px from 200 to 4000')
    if (view && (c.action !== undefined || time)) throw bad(i, ': a comment in a device view is on the design, with no action and no moment of the motion')
    if (c.action === 'more-variants') {
      const [slug, ...rest] = c.route.split('/')
      if (rest.length) throw bad(i, ': more-variants is on a prototype (<slug>), not a variant')
      if (!existsSync(join(root, 'src', 'protos', slug))) throw bad(i, `: there is no prototype ${slug}`)
      if (!Number.isInteger(c.count) || c.count < 1 || c.count > 9) throw bad(i, ': count is a whole number from 1 to 9')
      if (c.point !== undefined || c.region !== undefined || c.target !== undefined || time) throw bad(i, ': more-variants has no element, spot, region or moment')
    } else if (c.action !== undefined) {
      const [slug, letter, more] = c.route.split('/')
      if (!ACTIONS.has(c.action) || !letter || more !== undefined) throw bad(i, ': an action is pick, unpick, more, build, copy, try-it, copy-options or share-fix, on a variant (<slug>/<letter>)')
      if (c.action === 'pick' || c.action === 'unpick') {
        let meta
        try { meta = metaOf(readFileSync(metaFile(slug), 'utf8')) } catch { throw bad(i, `: src/protos/${slug}/meta.ts is missing or isn't plain JSON, so a pick can't be marked in it`) }
        if (!meta?.variants?.[letter]) throw bad(i, `: ${slug} has no variant ${letter}`)
      } else if (!hasVariant(slug, letter)) throw bad(i, `: ${slug} has no variant ${letter}`)
    }
    const images = (Array.isArray(c.images) ? c.images : []).map(img => {
      const m = String(img?.dataUrl ?? img).match(/^data:image\/(png|jpeg|webp);base64,(.+)$/)
      if (!m) return null
      const file = `${files.length + 1}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`
      files.push([file, Buffer.from(m[2], 'base64')])
      return { file, name: clip(img?.name, 100) }
    }).filter(Boolean)
    if (!c.text.trim() && !images.length) throw bad(i, ' has no text or images')
    return {
      n: i + 1, route: c.route, text: c.text.trim().slice(0, 4000),
      ...(c.action ? { action: c.action } : {}),
      ...(c.action === 'more-variants' ? { count: c.count } : {}),
      ...(c.action === 'pick' && typeof c.note === 'string' && c.note.trim() ? { note: c.note.trim().slice(0, 600) } : {}),
      point: c.point && { x: Math.round(+c.point.x || 0), y: Math.round(+c.point.y || 0) },
      ...(regionOf(c.region) ? { region: regionOf(c.region) } : {}),
      ...time,
      ...(view ? { view } : {}),
      ...(c.re ? { re: { batch: c.re.batch, n: c.re.n } } : {}),
      ...(c.from ? { from: fromOf(c.from), ...(typeof c.note === 'string' && c.note ? { note: clip(c.note, 400) } : {}) } : {}),
      target: element(c.target),
      tags: (Array.isArray(c.tags) ? c.tags : []).map(element).filter(Boolean).slice(0, 20),
      images,
    }
  })
  // check: only whether the batch would be taken, with nothing written (Send checks before it marks
  // comments sent on the host).
  if (check) return { batch: null, comments: list }
  // Optional generation is one request per variant/capability until answered or withdrawn.
  // Read disk (not the UI's cached status): retries, reloads and two tabs cannot enqueue it twice.
  const optional = list.filter(c => ['try-it', 'copy-options'].includes(c.action))
  if (optional.length) {
    if (list.length !== 1) throw bad(0, ': request one optional capability at a time')
    const wanted = optional[0]
    // One on highlighted words (it has an element) is about those words, so it is never the variant's request again.
    if (!wanted.target) for (const sub of ['new', 'taken']) {
      for (const folder of readdirSyncSafe(join(inbox, sub))) {
        const previous = readJson(join(inbox, sub, folder, 'batch.json'), null)
        if (previous?.comments.some(c => c.route === wanted.route && c.action === wanted.action && !c.done && !c.withdrawn)) return { batch: previous, moved: false }
      }
    }
  }
  // A pick is made before the batch is seen, so the agent reads about one already made, and it is
  // done when it has no note; a note stays pending until the agent handles it. A failed pick says why (marked:
  // meta.ts has it, only the working variant didn't move), and so does an unpick that changed nothing.
  let moved = false
  for (const c of list) {
    // Build it picks the variant too: best effort, since a build never waits on meta.ts.
    if (c.action === 'build') {
      const [slug, letter] = c.route.split('/')
      try {
        if (metaOf(readFileSync(metaFile(slug), 'utf8'))?.picked !== letter) { moved = pick(c.route, false) === 'moved' || moved; c.picked = true }
      } catch { /* the build is asked for either way */ }
      continue
    }
    if (c.action !== 'pick' && c.action !== 'unpick') continue
    const [slug, letter] = c.route.split('/')
    try {
      const did = pick(c.route, c.action === 'unpick')
      if (did === 'nothing') Object.assign(c, { nothing: true, failed: `${letter} isn't the pick of ${slug}, so there was nothing to take back` })
      else {
        if (c.action === 'pick') c.assignment = assignmentNeeded(dir, slug, letter)
        // Picked among a variant's next versions: it stays open until it is built into the parents.
        if (c.action === 'pick' && !c.assignment) c.buildUp = buildUpNeeded(dir, slug, letter) || undefined
        if (c.action === 'pick' && (c.note || c.assignment || c.buildUp)) c.marked = true
        else c.done = true
        moved = did === 'moved' || moved
      }
    } catch (e) {
      c.failed = String(e?.message || e).slice(0, 300)
      if (e?.marked) c.marked = true
    }
  }
  const batch = {
    id, at,
    viewport: data.viewport && { w: +data.viewport.w || 0, h: +data.viewport.h || 0, phone: !!data.viewport.phone },
    theme: data.theme === 'dark' ? 'dark' : 'light',
    // The design's storage is the owner's page's; a batch from a link has none.
    ...(() => { const st = !list.some(c => c.from) && storageOf(data.storage); return st ? { storage: st } : {} })(),
    comments: list,
    ...(list.every(c => c.done) ? { done: true } : {}),
  }
  // The conversation working on its first comment's prototype takes it (app/listener.mjs).
  const owner = batchOwner(dir, batch)
  if (owner) batch.owner = owner
  const folder = join(inbox, '.incoming', id)
  mkdirSync(folder, { recursive: true })
  for (const [file, bytes] of files) writeFileSync(join(folder, file), bytes)
  writeFileSync(join(folder, 'batch.json'), JSON.stringify(batch, null, 2) + '\n')
  // Complete before anyone can see it: a waiter only ever finds a whole batch in new/.
  mkdirSync(join(inbox, 'new'), { recursive: true })
  moveDir(folder, join(inbox, 'new', id))
  return { batch, moved }
}

const INTAKE_FILE_MAX = 20 * 1024 * 1024
/**
 * The answers to the open intake, as one batch for the agent: a comment with action intake, whose
 * `intake` holds the answers and where each file was saved. The questions are marked answered, so
 * the page puts its own screen away.
 */
function receiveIntake(data) {
  const cur = intakeNow()
  if (!cur || cur.status !== 'open') throw Object.assign(new Error('there is no open intake to answer'), { status: 409 })
  if (data.id !== cur.id) throw Object.assign(new Error('these answers are for another intake'), { status: 409 })
  const known = new Map(cur.questions.map(q => [q.id, q]))
  const answers = {}
  for (const [qid, v] of Object.entries(data.answers && typeof data.answers === 'object' ? data.answers : {})) {
    const q = known.get(qid)
    if (!q || !Array.isArray(v)) continue
    const vals = v.filter(x => typeof x === 'string').map(x => x.slice(0, q.kind === 'text' ? 2000 : 300)).slice(0, 40)
    if (vals.length) answers[qid] = vals
  }
  const at = new Date().toISOString()
  let id
  do id = `${at.replace(/[-:]/g, '').replace(/\..*/, '')}-${randomBytes(2).toString('hex')}`
  while (['new', 'taken', '.incoming'].some(sub => existsSync(join(inbox, sub, id))))
  const files = [], saved = []
  for (const f of Array.isArray(data.files) ? data.files.slice(0, 60) : []) {
    const m = String(f?.dataUrl ?? '').match(/^data:([\w.+-]+\/[\w.+-]+);base64,(.+)$/)
    const qid = typeof f?.question === 'string' ? f.question : ''
    if (!m || !known.has(qid.split(':')[0])) continue
    const bytes = Buffer.from(m[2], 'base64')
    if (bytes.length > INTAKE_FILE_MAX) continue
    const base = clip(String(f.name || 'file').replace(/[^\w.\- ]+/g, '_'), 80) || 'file'
    const file = `${files.length + 1}-${base}`
    files.push([file, bytes])
    saved.push({ file, name: clip(f.name, 100) || base, type: m[1], question: qid.split(':')[0], for: qid.includes(':') ? qid.split(':')[1] : '' })
  }
  const answered = Object.keys(answers).length + new Set(saved.map(f => f.question)).size
  const batch = {
    id, at,
    viewport: data.viewport && { w: +data.viewport.w || 0, h: +data.viewport.h || 0, phone: !!data.viewport.phone },
    theme: data.theme === 'dark' ? 'dark' : 'light',
    comments: [{
      n: 1, route: 'intake', action: 'intake',
      text: `Answered the questions (${Object.keys(answers).length} of ${cur.questions.length}${saved.length ? `, ${saved.length} file${saved.length > 1 ? 's' : ''}` : ''}).`,
      intake: { id: cur.id, ask: cur.ask ?? '', questions: cur.questions.map(q => ({ id: q.id, title: q.title, kind: q.kind, options: (q.options ?? []).map(o => ({ id: o.id, label: o.label })) })), answers, decided: (Array.isArray(data.decided) ? data.decided : []).filter(x => known.has(x)), files: saved },
      images: [],
    }],
  }
  const folder = join(inbox, '.incoming', id)
  mkdirSync(folder, { recursive: true })
  for (const [file, bytes] of files) writeFileSync(join(folder, file), bytes)
  writeFileSync(join(folder, 'batch.json'), JSON.stringify(batch, null, 2) + '\n')
  mkdirSync(join(inbox, 'new'), { recursive: true })
  moveDir(folder, join(inbox, 'new', id))
  writeWhole(intakeFile, JSON.stringify({ ...cur, status: 'answered', answeredAt: at, batch: id, answered }, null, 2) + '\n')
  return batch
}

/**
 * A sent comment the user deleted in the page: taken back. It is marked withdrawn (and done, so
 * its batch can finish without it) where it waits. A batch still in new/ that has nothing left is
 * removed, so the agent never hears of it; `proto inbox` leaves withdrawn comments out of what it
 * prints, and `proto reply` says so when one is answered anyway. Says what it did: 'withdrawn',
 * 'dropped' (the whole batch went) or 'gone' (no such batch or comment any more, which is fine).
 */
function withdraw(data) {
  const id = data.batch, n = Number(data.n)
  if (typeof id !== 'string' || !/^[\w-]{1,64}$/.test(id) || !Number.isInteger(n) || n < 1) throw Object.assign(new Error('withdraw takes { batch, n }: a batch id and a comment number from 1'), { status: 400 })
  // new/ first: `proto inbox` can move the batch to taken/ between the read and the write, and then
  // the write there fails and taken/ is where it is.
  for (const where of ['new', 'taken']) {
    const folder = join(inbox, where, id), f = join(folder, 'batch.json')
    const b = readJson(f, null)
    if (!b) continue
    const c = b.comments.find(x => x.n === n)
    if (!c) return 'gone'
    c.withdrawn = true
    c.done = true
    b.done = b.comments.every(x => x.done) || undefined
    if (where === 'new' && b.comments.every(x => x.withdrawn)) {
      try { rmSync(folder, { recursive: true, force: true }) } catch { /* busy: it is written withdrawn below instead */ }
      if (!existsSync(folder)) { if (existsSync(join(inbox, 'taken', id))) continue; return 'dropped' }
    }
    try { writeWhole(f, JSON.stringify(b, null, 2) + '\n'); return 'withdrawn' } catch (e) { if (e?.code !== 'ENOENT') throw e }
  }
  return 'gone'
}

export function prototypeServer(session) {
  let activity = Date.now()
  // With the working variant as the server left it, so the page knows a move it asked for when
  // session.json brings it.
  // When each variant (its own file or a helper of its own, c-map.tsx for C) was last edited, for
  // the page's Building marks, which count from there. Kept here, not in session.json: rewriting
  // that on every edit can reach Vite as a deleted file and reload the page.
  const edits = {}
  const status = () => {
    let s = {}
    try { s = read() } catch { /* being rewritten by hand; the rest still answers */ }
    return { lastEdit: lastEdit(), edits, keep: !!s.keep, idleHours: s.idleHours ?? 6, deleteDays: s.deleteDays ?? 14, work: s.work ? { proto: s.work.proto, variant: s.work.variant } : null, slots: slotPointers(), inbox: inboxStatus() }
  }
  const stop = reason => {
    // The tailnet port as session.json has it now: on a session's first run, `proto up` gives it one
    // only after this server started, so the copy read at startup has none.
    let tport = session.tailnetPort
    try { tport = read().tailnetPort ?? tport } catch {}
    // An unreadable session.json must not keep it from stopping, or the tailnet port stays served.
    try { write({ stoppedAt: new Date().toISOString(), stopReason: reason, pid: null }) } catch {}
    const exit = () => process.exit(0)
    setTimeout(exit, 3000)
    if (tport) execFile('tailscale', ['serve', `--https=${tport}`, 'off'], exit)
    else exit()
  }
  return {
    name: 'prototype-server',
    configureServer(server) {
      const src = slash(join(dir, 'src'))
      server.watcher.on('all', (_, path) => {
        if (!slash(path).startsWith(src)) return
        activity = Date.now()
        if (!slash(path).startsWith(`${src}/protos/`)) return
        server.ws.send({ type: 'custom', event: 'proto:edit', data: { path: slash(path).slice(slash(dir).length - 1) } })
        const [slug, name = ''] = slash(path).slice(src.length + '/protos/'.length).split('/')
        const letter = (name.match(/^([A-Z]{1,2})\.\w+$/) || name.match(/^([a-z]{1,2})-/) || [])[1]
        if (letter) edits[`${slug}/${letter.toUpperCase()}`] = Date.now()
      })
      // Anything but /status changes something, so it must come from the page itself: a POST with a
      // JSON body (which a page on another site can only send after a CORS preflight, and none is
      // ever answered: Vite's own CORS is off too) and, when the browser names its origin, the host
      // this request came to: 127.0.0.1 or the tailnet name, whichever the page was opened on
      // (`tailscale serve` passes the tailnet name as Host). Otherwise any site open in the browser
      // could plant a pick or a build order with a no-cors POST, or stop the server with an <img>.
      // X-Forwarded-Host isn't asked: whoever sends the request can write it.
      const refused = (req, route) => {
        if (route === '/status') return req.method === 'GET' || req.method === 'HEAD' ? null : [405, '/status is read with GET']
        if (req.method !== 'POST') return [405, 'POST only']
        if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) return [415, 'send JSON, with content-type: application/json']
        if (req.headers.origin === undefined) return null
        let host = ''
        try { host = new URL(req.headers.origin).host } catch { /* "null", or not a URL */ }
        return host && host === String(req.headers.host || '').trim().toLowerCase() ? null : [403, 'only the prototype page itself can do this']
      }
      // Share links: the owner's side, with the poll that fills the tray (`proto:shares`). Loaded
      // here rather than imported above, so server.mjs still loads on its own (as the checks copy it).
      let shares = null
      const sharesReady = import('./share/routes.mjs').then(({ shareServer }) => {
        shares = shareServer({
          root: dir, session: () => read(), receive: (data, root, options) => receive(data, root, options),
          emit: tray => server.ws.send({ type: 'custom', event: 'proto:shares', data: tray }),
        })
        server.httpServer?.once('close', () => shares.close())
        return shares
      })
      sharesReady.catch(e => console.error(`share links are off: ${e?.message || e}`))
      server.middlewares.use('/__proto', (req, res) => {
        const chunks = []
        let size = 0
        const fail = (code, error) => {
          if (res.headersSent) return res.end()
          res.statusCode = code; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ error }))
        }
        // A client that goes away mid-send is its own business; it must not take the server down.
        req.on('error', () => {})
        const no = refused(req, req.url.split('?')[0])
        if (no) { req.resume(); return fail(...no) }
        req.on('data', c => {
          size += c.length
          if (size <= MAX_BODY) chunks.push(c)
        })
        // Whatever one request does wrong (a body that is valid JSON but no object, a file that
        // can't be written), it gets an error back and the server keeps running.
        req.on('end', () => {
          try {
            if (size > MAX_BODY) return fail(413, `over ${MAX_BODY / 1048576} MB; send fewer or smaller screenshots`)
            const route = req.url.split('?')[0]
            let data = {}
            try { if (size) data = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { return fail(400, 'not JSON') }
            if (!data || typeof data !== 'object' || Array.isArray(data)) return fail(400, 'send a JSON object')
            // Share links (app/share/routes.mjs): the Share sheet and the "From links" tray.
            if (route.startsWith('/share/')) {
              sharesReady.then(sh => sh.handle(route.slice('/share/'.length), data)).then(({ status, body }) => {
                res.statusCode = status
                res.setHeader('content-type', 'application/json')
                res.end(JSON.stringify(body))
              }, e => fail(500, String(e?.message || e).slice(0, 300)))
              return
            }
            if (route === '/ping') { activity = Date.now(); shares?.ping() }
            if (route === '/keep') write({ keep: !!data.keep })
            if (route === '/work' && typeof data.proto === 'string' && typeof data.variant === 'string') work({ proto: data.proto, variant: data.variant, undo: data.undo })
            let got
            if (route === '/comments') {
              activity = Date.now()
              // A viewer's comment reaches the inbox only through Send (/__proto/share/send), from the
              // host's own copy of it: the page never says where a comment came from.
              if (Array.isArray(data.comments) && data.comments.some(c => c && typeof c === 'object' && 'from' in c)) return fail(400, 'comments from share links are sent with /__proto/share/send')
              try { got = receive(data) } catch (e) { return fail(e.status || 500, e.message) }
            }
            let heard
            if (route === '/intake') {
              activity = Date.now()
              try { heard = receiveIntake(data) } catch (e) { return fail(e.status || 500, e.message) }
            }
            let took
            if (route === '/withdraw') {
              try { took = withdraw(data) } catch (e) { return fail(e.status || 500, e.message) }
            }
            // Decision brief in the page: made now, kept at .proto/decisions/<slug>.md, and shown.
            if (route === '/brief') {
              const made = typeof data.proto === 'string' && /^[a-z0-9][a-z0-9-]*$/.test(data.proto) ? writeBrief(dir, data.proto) : null
              if (!made) return fail(404, `no prototype ${String(data.proto ?? '')}`)
              res.setHeader('content-type', 'application/json')
              return res.end(JSON.stringify({ markdown: made.markdown, file: `.proto/decisions/${data.proto}.md`, picked: made.picked, open: made.open }))
            }
            if (route === '/fav') {
              let favorites
              try { favorites = fav(data) } catch (e) { return fail(e.status || 500, e.message) }
              res.setHeader('content-type', 'application/json')
              return res.end(JSON.stringify({ favorites }))
            }
            // A send answers with its batch, whether a pick in it moved the working variant, and how
            // each decision in it went: done, or failed and why.
            const results = got && got.batch.comments.filter(c => c.action).map(c => ({ n: c.n, action: c.action, done: !!c.done, ...(c.failed ? { failed: c.failed } : {}), ...(c.marked ? { marked: true } : {}), ...(c.nothing ? { nothing: true } : {}) }))
            const body = JSON.stringify(got ? { ...status(), sent: got.batch.id, moved: got.moved, results } : heard ? { ...status(), sent: heard.id } : took ? { ...status(), withdrawn: took } : status())
            res.setHeader('content-type', 'application/json')
            res.end(body)
            if (route === '/stop') setTimeout(() => stop('stopped from the page'), 100)
          } catch (e) { fail(500, String(e?.message || e).slice(0, 300)) }
        })
      })
      // .proto/ is outside Vite's watcher, so the inbox is watched here: a batch taken, a
      // reply written or a listener starting reaches every open page at once.
      mkdirSync(inbox, { recursive: true })
      mkdirSync(intakeDir, { recursive: true })
      const listener = commentListener(dir)
      server.httpServer?.once('close', () => listener.close())
      let pending
      const changed = () => { clearTimeout(pending); pending = setTimeout(() => server.ws.send({ type: 'custom', event: 'proto:inbox', data: inboxStatus() }), 100) }
      // A process that dies makes no file event: look again every few seconds for who is alive.
      let seen = ''
      setInterval(() => { const s = inboxStatus(), k = JSON.stringify([s.listening, s.agent, s.batches.map(b => b.state)]); if (seen && k !== seen) changed(); seen = k }, 5e3).unref()
      // A watched folder that is removed (the session deleted) raises an error event on Windows; it must not stop the server.
      try { watch(intakeDir, changed).on('error', () => {}) } catch { /* the page's status ping still catches up */ }
      try { watch(inbox, { recursive: true }, changed).on('error', () => {}) } catch { /* no recursive watch here: the page's status ping still catches up */ }
      // A visible page pings every minute, so "idle" means no edits and nobody looking. Once
      // every prototype is picked or archived, nothing is left to decide: stop much sooner, unless
      // the session is kept (Settings > Session), which keeps its normal idle hours.
      const idle = (read().idleHours ?? 6) * 3600e3
      setInterval(() => {
        let kept = false
        try { kept = !!read().keep } catch { /* unreadable session.json: treat as not kept */ }
        const early = !kept && decided()
        if (Date.now() - activity > (early ? Math.min(idle, DECIDED_IDLE) : idle)) stop(early ? 'idle, all decided' : 'idle')
      }, 60e3).unref()
    },
    // Tailwind rescans only when a file it has already read changes, and Vite gives it nothing
    // for a new one, so a new prototype folder's classes stayed missing until a restart. A new
    // file refreshes the stylesheet, which rescans. A copy that can't take a hot update is only
    // marked stale, since updating it would reload the page. session.json and meta.ts are written
    // whole, by a rename the watcher can report as a new file; they hold no classes.
    hotUpdate({ type, file, modules }) {
      if (type !== 'create' || /[/\\](session\.json|meta\.ts)$/.test(file)) return
      const graph = this.environment.moduleGraph
      const sheets = [...graph.getModulesByFile(stylesheet) ?? []]
      for (const m of sheets) if (!m.isSelfAccepting) graph.invalidateModule(m)
      const live = sheets.filter(m => m.isSelfAccepting)
      if (live.length) return [...modules, ...live]
    },
  }
}
