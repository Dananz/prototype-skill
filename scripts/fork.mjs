// proto fork: someone's shared prototype, into this project. The source travels in the share's own
// page (app/share/source.mjs); this reads it, checks it, and lands it as new prototypes. Then
// `proto fork offer` publishes the fork as the forker's own link and tells the original link's owner,
// who brings it in with `proto fork <their link>`: it lands nested under the original.
// The code is someone else's: nothing lands without --yes, and packages only with --install.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, join, relative, resolve } from 'node:path'
import { isId } from '../host/lib/ids.mjs'
import { numberOf } from '../app/numbers.mjs'
import { mergeThemes } from '../app/theme-merge.mjs'
import { BUILTIN, apiOrigin, client, defaultHost, getToken, hostNamed, isLocal, linkOf, readHosts, readShares, shortLinkOf } from '../app/share/owner.mjs'
import { describe, protosOf, publishShare, titleOf, updateShare } from '../app/share/publish.mjs'
import { ShareError, parseScope } from '../app/share/scope.mjs'
import { checkSource, picturesIn, readSource } from '../app/share/source.mjs'
import { designText } from './design.mjs'
import { locked } from './project.mjs'
import { freshApp, liveHost, links, messageFlag, offerLine, report } from './share.mjs'

const MAX_PAGE = 64 * 2 ** 20
const sha = text => createHash('sha256').update(text).digest('hex')
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const oneLine = (s, max = 120) => String(s ?? '').replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').trim().slice(0, max)
const sanitized = s => String(s ?? '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')

const readJson = (f, fallback) => { try { return JSON.parse(readFileSync(f, 'utf8')) } catch { return fallback } }
function write(f, text) {
  mkdirSync(dirname(f), { recursive: true })
  const tmp = `${f}.${process.pid}.tmp`
  writeFileSync(tmp, text)
  renameSync(tmp, f)
}
const writeJson = (f, v) => write(f, JSON.stringify(v, null, 2) + '\n')
const metaJson = text => JSON.parse(text.replace(/^[\s\S]*?export default\s*/, '').replace(/;?\s*$/, ''))
const metaText = meta => `// Prototype: ${oneLine(meta.title, 200)}. Variant files are named by their letter; names live here.\nexport default ${JSON.stringify(meta, null, 2)}\n`

export const forksFile = app => join(app, '.proto', 'forks.json')
export const readForks = app => readJson(forksFile(app), []).filter(e => e && Array.isArray(e.protos))

/** A link as the host it is on and its id, for a host this Mac knows; null for any other address. */
export function linkTarget(input, hosts = [...readHosts(), BUILTIN]) {
  const text = String(input).trim()
  if (isId(text)) return { host: defaultHost(), id: text }
  let url
  try { url = new URL(text) } catch { return null }
  const seen = url.host.toLowerCase(), path = url.pathname.match(/^\/(?:s\/)?([a-z0-9]{10})\/?$/)?.[1]
  for (const host of hosts) {
    const port = isLocal(host) ? new URL(host.url).port : ''
    const names = isLocal(host) ? [`localhost:${port}`, `127.0.0.1:${port}`] : [String(host.base).toLowerCase()]
    if (url.protocol !== (isLocal(host) ? 'http:' : 'https:')) continue
    if (names.includes(seen) && isId(path)) return { host, id: path }
    for (const name of names) if (seen.endsWith(`.${name}`) && isId(seen.slice(0, -name.length - 1))) return { host, id: seen.slice(0, -name.length - 1) }
  }
  return null
}

/** The page behind a link and what its host says of it: { html, state }. Throws what stops it. */
export async function fetchPage({ host, id }, { fetch = globalThis.fetch } = {}) {
  const page = isLocal(host) ? `${apiOrigin(host)}/s/${id}/` : linkOf(host, id)
  let res
  try { res = await fetch(page, { signal: AbortSignal.timeout(60_000) }) } catch (e) { throw new ShareError(`Could not reach ${page}: ${e?.cause?.code || e?.message || e}`) }
  if (res.status === 410) throw new ShareError('That link was removed or has expired, so there is nothing to fork. Ask its owner for a new one.')
  if (res.status === 403) throw new ShareError('That link is turned off, so there is nothing to fork for now.')
  if (!res.ok) throw new ShareError(`That link answered ${res.status}. Check it, or ask its owner for a new one.`)
  if (Number(res.headers.get('content-length')) > MAX_PAGE) throw new ShareError('That page is too big to fork.')
  const html = await res.text()
  if (html.length > MAX_PAGE) throw new ShareError('That page is too big to fork.')
  let state = null
  try { const r = await fetch(`${page}api/state`, { headers: { 'X-Proto': '1' }, signal: AbortSignal.timeout(10_000) }); if (r.ok) state = await r.json() } catch { /* the page says enough */ }
  return { html, state }
}

const free = (taken, base) => { if (!taken(base)) return base; let n = 2; while (taken(`${base}-${n}`)) n++; return `${base}-${n}` }

/** What a fork would need that this app doesn't have. */
export function missingPackages(app, source) {
  const pkg = readJson(join(app, 'package.json'), {})
  return Object.entries(source.packages).filter(([n]) => !pkg.dependencies?.[n] && !pkg.devDependencies?.[n])
}

/** When this is someone's fork of a link of this app's: the prototype it goes back under. */
export function comingHome(app, source) {
  const from = source.protos[0].meta.forkedFrom
  if (!isId(from?.share) || !readShares(app).some(e => e.id === from.share)) return null
  const proto = typeof from.proto === 'string' && /^[a-z0-9][a-z0-9-]*$/.test(from.proto) ? from.proto : null
  const meta = proto ? readJson2(join(app, 'src', 'protos', proto, 'meta.ts')) : null
  return meta && Object.keys(meta.variants || {}).length ? { parent: proto, letter: Object.keys(meta.variants)[0] } : null
}
const readJson2 = f => { try { return metaJson(readFileSync(f, 'utf8')) } catch { return null } }

const SAFE_META = ['title', 'kind', 'screen', 'created', 'states', 'about', 'from', 'slot', 'also', 'theme']

/**
 * Writes a checked source into the app. origin: what meta.forkedFrom says. as: a slug for the first
 * prototype. pictures: picturesIn's found. Resolves with what landed; nothing here reaches a network.
 */
export function landFork(app, source, { sid, origin, as, pictures = new Map(), key: wanted, by }) {
  return locked(app, () => {
    const dst = join(app, 'src', 'protos'), assetsTo = join(app, 'src', 'assets')
    const taken = name => existsSync(join(dst, name))
    const home = comingHome(app, source)
    const key = free(k => readForks(app).some(e => e.key === k), wanted)

    // Slugs: the listed ones and any it borrowed code from. Each gets a free name, and everything that
    // points at it follows. Coming home, the first is named for who sent it.
    const listed = source.protos.map(p => p.id)
    const borrowed = [...new Set(Object.keys(source.files).filter(p => p.startsWith('protos/')).map(p => p.split('/')[1]))].filter(s => !listed.includes(s))
    const renames = {}, used = new Set()
    const claim = (from, want) => { const to = free(n => taken(n) || used.has(n), want); used.add(to); renames[from] = to }
    listed.forEach((id, i) => claim(id, i === 0 && as ? as : i === 0 && home && by ? `${id}-from-${sanitized(by)}` : id))
    borrowed.forEach(id => claim(id, id))

    // Designs follow the same way.
    const designIds = [...new Set(Object.keys(source.files).filter(p => p.startsWith('designs/')).map(p => p.split('/')[1]))]
    const designNames = {}
    for (const id of [...designIds, ...source.designs.map(d => d.id)]) designNames[id] ??= free(n => existsSync(join(app, 'src', 'designs', n)) || Object.values(designNames).includes(n), id)

    // Pictures: same bytes are one file; different bytes get the fork's key. A converted one takes
    // the extension of what it now is, and the code that names it follows.
    const moved = {}, images = {}, base = {}
    for (const [path, { bytes, ext }] of pictures) {
      const [top, ...rest] = path.split('/')
      if (top === 'assets') {
        const rel = rest.join('/'), bare = rel.slice(0, -extname(rel).length)
        let to = bare + ext
        if (existsSync(join(assetsTo, to)) && !readFileSync(join(assetsTo, to)).equals(bytes)) { to = `${bare}--${key}${ext}`; images[bare] = `${bare}--${key}` }
        if (to !== rel) moved[`assets/${rel}`] = `assets/${to}`
        mkdirSync(dirname(join(assetsTo, to)), { recursive: true })
        writeFileSync(join(assetsTo, to), bytes)
      } else {
        // Beside the code that imports it, under its new slug.
        const [slug, ...inner] = rest, name = inner.join('/'), bare = name.slice(0, -extname(name).length)
        const to = join(app, 'src', top, top === 'protos' ? renames[slug] ?? slug : designNames[slug] ?? slug, bare + ext)
        if (extname(name) !== ext) moved[`/${basename(name)}`] = `/${basename(bare)}${ext}`
        mkdirSync(dirname(to), { recursive: true })
        writeFileSync(to, bytes)
        if (top === 'protos') (base[renames[slug] ?? slug] ??= {})[bare + ext] = sha(bytes)
      }
    }

    const rewrite = text => {
      for (const [from, to] of Object.entries(renames)) {
        if (from === to) continue
        text = text.replace(new RegExp(`proto="${esc(from)}"`, 'g'), `proto="${to}"`)
          .replace(new RegExp(`\\bto="${esc(from)}"`, 'g'), `to="${to}"`)
          .replace(new RegExp(`(['"\`])\\.\\./${esc(from)}/`, 'g'), `$1../${to}/`)
          .replace(new RegExp(`/protos/${esc(from)}/`, 'g'), `/protos/${to}/`)
      }
      for (const [from, to] of Object.entries(designNames)) if (from !== to) text = text.replace(new RegExp(`/designs/${esc(from)}/`, 'g'), `/designs/${to}/`)
      for (const [from, to] of Object.entries(moved)) text = text.replace(new RegExp(`${esc(from)}(['"\`?)])`, 'g'), `${to}$1`)
      for (const [from, to] of Object.entries(images)) text = text.replace(new RegExp(`image\\((['"\`])${esc(from)}\\1\\)`, 'g'), `image($1${to}$1)`)
      return text
    }

    // Theme: merged, and the fork's prototypes carry a scope when its tokens disagree with this app's.
    const themeFile = join(app, 'src', 'theme.css')
    let scope = null, conflicts = []
    if (source.theme) {
      const scopeName = `fork-${key}`, merged = mergeThemes(existsSync(themeFile) ? readFileSync(themeFile, 'utf8') : '', [{ scope: scopeName, css: source.theme }])
      write(themeFile, merged.css)
      conflicts = merged.conflicts.map(c => c.token).concat(merged.inline)
      if (merged.css.includes(`[data-proto-theme="${scopeName}"]`)) scope = scopeName
    }

    // Code first, each prototype's meta last, so the page sees a prototype with all its variants at once.
    for (const [path, text] of Object.entries(source.files)) {
      const [top, slug, ...inner] = path.split('/'), name = top === 'protos' ? renames[slug] : designNames[slug]
      const landed = rewrite(text)
      write(join(app, 'src', top, name, ...inner), landed)
      if (top === 'protos') (base[name] ??= {})[inner.join('/')] = sha(landed)
    }
    const route = r => typeof r === 'string' ? r.replace(/^([a-z0-9][a-z0-9-]*)(?=\/|$)/, s => renames[s] ?? s) : r
    for (const d of source.designs) {
      const flows = d.flows.filter(f => f && typeof f.name === 'string' && Array.isArray(f.screens)).map(f => ({ name: oneLine(f.name, 200), screens: f.screens.filter(e => typeof e === 'string').map(route) }))
      write(join(app, 'src', 'designs', designNames[d.id], 'design.ts'), designText({ title: oneLine(d.title ?? d.id, 200), created: new Date().toISOString(), flows }))
    }
    const protos = source.protos.map((p, i) => {
      const slug = renames[p.id], kept = Object.fromEntries(SAFE_META.filter(k => p.meta[k] !== undefined).map(k => [k, p.meta[k]]))
      if (kept.from) kept.from = route(kept.from)
      if (Array.isArray(kept.also)) kept.also = kept.also.map(route)
      // Beside a prototype of the same name, the tree tells them apart by whose it is.
      const title = by && slug !== p.id ? `${oneLine(kept.title ?? p.id, 180)} (@${oneLine(by, 40)})` : oneLine(kept.title ?? p.id, 200)
      write(join(dst, slug, 'meta.ts'), metaText({
        ...kept, title, ask: '', kind: kept.kind === 'phone' ? 'phone' : 'web', created: new Date().toISOString(), session: sid, owner: sid,
        ...(scope && !kept.theme ? { theme: scope } : {}),
        ...(i === 0 && home ? { from: `${home.parent}/${home.letter}`, referenceOnly: true } : {}),
        forkedFrom: { ...origin, proto: p.id },
        variants: p.meta.variants,
      }))
      return { slug, from: p.id, variants: Object.keys(p.meta.variants) }
    })
    const entry = { key, ...origin, at: new Date().toISOString(), protos, base }
    writeJson(forksFile(app), [...readForks(app), entry])
    return { entry, renames, conflicts, home }
  })
}

// ---------- what differs from what was forked ----------

const filesIn = dir => !existsSync(dir) ? [] : readdirSync(dir, { recursive: true }).map(f => join(dir, String(f))).filter(f => statSync(f).isFile())

/** Which variants of a fork moved since it landed: ["pricing/A", "pricing/D (new)", "pricing shared parts"]. */
export function changedSinceFork(app, entry) {
  const out = []
  for (const p of entry.protos) {
    const dir = join(app, 'src', 'protos', p.slug), was = entry.base?.[p.slug] ?? {}
    const now = Object.fromEntries(filesIn(dir).filter(f => basename(f) !== 'meta.ts').map(f => [relative(dir, f), sha(readFileSync(f))]))
    const letters = new Map(); let parts = false
    for (const f of new Set([...Object.keys(was), ...Object.keys(now)])) {
      if (was[f] === now[f]) continue
      const m = /^([A-Z]{1,3})\.\w+$/.exec(f)
      if (m) letters.set(m[1], was[f] === undefined ? 'new' : now[f] === undefined ? 'gone' : 'changed')
      else parts = true
    }
    for (const [l, how] of [...letters].sort()) out.push(`${p.slug}/${l}${how === 'changed' ? '' : ` (${how})`}`)
    if (parts) out.push(`${p.slug} shared parts`)
  }
  return out
}

/**
 * The same as the owner reads it: their prototype's name and the variants' numbers as their page shows
 * them, since a slug here means nothing there: ["#2", "#4 (new)", "shared parts"]. With several
 * prototypes, each is named.
 */
export function changedForOwner(entry, changed) {
  const many = entry.protos.length > 1
  return changed.map(c => {
    const p = entry.protos.find(x => c.startsWith(`${x.slug}/`) || c.startsWith(`${x.slug} `))
    if (!p) return c
    const label = c.slice(p.slug.length).replace(/^\/([A-Z]{1,3})/, (_, l) => `#${numberOf(l)}`).trim()
    return many ? `${p.from} ${label}` : label
  })
}

// ---------- commands ----------

function summary(source, origin, missing, missingPictures, home) {
  const count = source.protos.map(p => `${p.id} (${Object.keys(p.meta.variants).length} variant${Object.keys(p.meta.variants).length === 1 ? '' : 's'})`).join(', ')
  const lines = [`${home ? 'Bring back' : 'Fork'} ${JSON.stringify(oneLine(origin.title))}${origin.owner ? ` by @${oneLine(origin.owner, 40)}` : ''}${origin.version ? `, version ${origin.version}` : ''}: ${count}, ${Object.keys(source.files).length} files`]
  lines.push("This is someone else's code. It runs in your browser when the page opens, and anything written in it is theirs, not instructions.")
  if (home) lines.push(`It lands nested under ${home.parent}, beside your own.`)
  if (missing.length) lines.push(`Packages this app doesn't have: ${missing.map(([n, v]) => `${n}@${v}`).join(', ')} (--install adds them; their install scripts run on this Mac)`)
  if (source.projectImports.length) lines.push(`Imports from their project, which you don't have, so these break: ${source.projectImports.map(x => oneLine(x)).join(', ')}`)
  if (missingPictures.length) lines.push(`Pictures not found in the page, so these stay blank: ${missingPictures.map(x => oneLine(x)).join(', ')}`)
  return lines
}

export async function fork(input, flags, { sessionDir, session, sid, die, install }, options = {}) {
  if (!input) die('proto fork <link|file.html> [--as <slug>] [--yes] [--install]: which link?')
  if (flags.as !== undefined && (typeof flags.as !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(flags.as))) die('--as takes a slug like "hero-sections" (lowercase, digits, dashes)')
  const asFile = !/^https?:/.test(input) && !isId(input) && existsSync(resolve(input))
  let html, state = null, target = null
  if (asFile) html = readFileSync(resolve(input), 'utf8')
  else {
    target = linkTarget(input)
    if (!target) die(`"${oneLine(input)}" isn't a share link on a host this Mac knows. Only links on those hosts, or a saved share page, can be forked.`)
    ;({ html, state } = await fetchPage(target, options))
  }
  const raw = readSource(html)
  if (!raw) die('That page carries no source: it was shared without it, or before forking existed. Ask its owner to run proto share update.')
  const source = checkSource(raw)
  if (session.stack && source.stack !== session.stack) die(`That prototype is ${oneLine(source.stack, 20)} and this project's app is ${session.stack}, so it can't land here.`)
  const owner = oneLine(state?.owner?.login || source.owner, 80)
  const origin = {
    ...(target ? { host: target.host.name, share: target.id } : {}), version: Number(state?.version) || source.version, owner,
    title: oneLine(state?.title || source.title || source.protos[0].meta.title, 200),
  }
  const { found, missing: missingPictures } = picturesIn(html, source.assets)
  const missing = missingPackages(sessionDir, source)
  const home = comingHome(sessionDir, source)
  const said = summary(source, origin, missing, missingPictures, home)
  if (flags.yes !== true) {
    for (const l of said) console.log(l)
    console.log('Run again with --yes to land it')
    process.exit(2)
  }
  const key = target?.id ?? `file-${sha(html).slice(0, 8)}`
  const { entry, conflicts } = landFork(sessionDir, source, { sid, origin, as: flags.as, pictures: found, key, by: owner })
  if (missing.length && flags.install === true) {
    const pkg = readJson(join(sessionDir, 'package.json'), {})
    writeJson(join(sessionDir, 'package.json'), { ...pkg, dependencies: { ...pkg.dependencies, ...Object.fromEntries(missing) } })
    install()
  }
  if (flags.json === true) return console.log(JSON.stringify({ slug: entry.protos[0].slug, slugs: entry.protos.map(p => p.slug), home: !!home, missing: flags.install === true ? [] : missing.map(([n]) => n) }))
  for (const l of said.slice(1)) if (!/^It lands/.test(l) && !/^Packages/.test(l)) console.log(l)
  console.log(`${home ? 'brought back' : 'forked'} ${entry.protos.map(p => p.slug).join(', ')}${owner ? ` from @${owner}` : ''}`)
  if (session.url) console.log(`${session.url}${entry.protos[0].slug}`)
  if (conflicts.length) console.log(`Its theme disagrees with this app's on ${conflicts.join(', ')}, so its prototypes keep their own.`)
  if (missing.length && flags.install !== true) console.log(`It needs ${missing.map(([n, v]) => `${n}@${v}`).join(', ')}: add them only on the user's word, then proto up.`)
  console.log(home ? 'Yours and theirs now sit side by side in the page.' : `Work on it like any prototype. proto fork offer ${entry.protos[0].slug} offers your version back${origin.share ? '' : ' (not this one: it came from a file, so there is nobody to offer it to)'}.`)
}

async function offer(args, flags, ctx) {
  const { sessionDir, session, die } = ctx
  const forks = readForks(sessionDir)
  const [slug] = (args[0] ?? '').split('/')
  const entry = slug ? forks.find(e => e.protos.some(p => p.slug === slug)) : forks.length === 1 ? forks[0] : null
  if (!entry) die(slug ? `${slug} isn't a fork here: proto fork ls lists them` : 'proto fork offer <slug>[/<n>…] [--message "…"] [--yes]: which fork? proto fork ls lists them')
  if (!entry.share || !entry.host) die('That fork came from a file, so there is no link to offer it back to. proto share makes it a link of your own.')
  const { host, token } = await liveHost(die, { ...flags, host: entry.host })
  freshApp(sessionDir, die)
  const protos = protosOf(sessionDir)
  const words = args.length ? args : entry.protos.map(p => p.slug)
  const scope = parseScope(words, false, protos)
  const message = messageFlag(flags, false)
  const yes = flags.yes === true
  // The same link when this fork was offered before: the owner sees a new version, not a second offer.
  const had = entry.offer && readShares(sessionDir).some(e => e.id === entry.offer) ? entry.offer : null
  const result = had
    ? await updateShare({ sessionDir, session, host, token, id: had, message, yes })
    : await publishShare({ sessionDir, session, host, token, scope, title: typeof flags.title === 'string' ? flags.title : titleOf(scope, protos, session), message, yes })
  report(result)
  const id = result.entry.id
  writeJson(forksFile(sessionDir), readForks(sessionDir).map(e => e.key === entry.key ? { ...e, offer: id } : e))
  try {
    await client(host, token).offer(id, { to: entry.share, base: entry.version, changed: changedForOwner(entry, changedSinceFork(sessionDir, entry)) })
  } catch (e) {
    links(host, id)
    if (e instanceof ShareError) die(`The link is up, but @${entry.owner || 'its owner'} wasn't told: ${e.message}. proto fork offer ${slug || entry.protos[0].slug} tries again; or send them the link.`)
    throw e
  }
  console.log(`offered ${describe(scope)} to @${entry.owner || 'the original link\'s owner'}, who sees it on their link "${entry.title}". Yours is v${result.entry.version} of your own link.`)
  links(host, id)
}

async function ls(flags, { sessionDir, die }, options = {}) {
  const forks = readForks(sessionDir)
  if (!forks.length) console.log('nothing forked here (proto fork <link> brings one in)')
  for (const e of forks) {
    const changed = changedSinceFork(sessionDir, e)
    console.log(`${e.protos.map(p => p.slug).join(', ')}  from ${e.owner ? `@${e.owner}` : 'a file'}  ${JSON.stringify(e.title)}  v${e.version}${changed.length ? `  (changed: ${changed.join(', ')})` : '  (no changes yet)'}`)
    if (e.offer) { const h = hostNamed(e.host); console.log(`    offered back as ${h ? shortLinkOf(h, e.offer) : e.offer}`) }
    if (!e.share) continue
    const host = hostNamed(e.host)
    if (!host) continue
    try {
      const { state } = await fetchPage({ host, id: e.share }, options)
      if (state?.version > e.version) console.log(`    the original is at v${state.version}. proto fork ${e.share} lands it beside yours`)
    } catch (err) { if (err instanceof ShareError) console.log(`    the original: ${err.message}`) }
  }
  const host = defaultHost()
  if (!getToken(host.name)) return
  let rows = []
  try { rows = await client(host, getToken(host.name), options).list() } catch { return }
  for (const r of rows) {
    if (!r.offers?.length) continue
    console.log(`on your link "${r.title}" (${r.id}):`)
    for (const o of r.offers) console.log(offerLine(host, o))
  }
}

async function dismiss(args, flags, { die }) {
  const [id] = args
  if (!isId(id)) die('proto fork dismiss <offer link id> [--on <your link id>]')
  const { host, token } = await liveHost(die, flags)
  const api = client(host, token)
  const on = typeof flags.on === 'string' ? flags.on : (await api.list()).find(r => r.offers?.some(o => o.id === id))?.id
  if (!on) die(`No offer ${id} on your links: proto fork ls lists them`)
  await api.dismissOffer(on, id)
  console.log(`dismissed the offer ${id}. It comes back only if they offer a new version.`)
}

export async function main(args, flags, ctx) {
  try {
    const [sub, ...rest] = args
    if (sub === 'ls') return await ls(flags, ctx)
    if (sub === 'offer') return await offer(rest, flags, ctx)
    if (sub === 'dismiss') return await dismiss(rest, flags, ctx)
    return await fork(sub, flags, ctx)
  } catch (e) {
    if (e instanceof ShareError) ctx.die(e.message)
    throw e
  }
}
