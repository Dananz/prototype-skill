// A session app from before the project app (.prototypes/<session>/) copied into it: its prototypes
// (a slug the project already has gets -2, -3 … and everything that points at it follows), their
// history, references, briefs and decisions, its assets (same bytes shared; different bytes renamed
// <name>--<sid8>), its theme (app/theme-merge.mjs), packages, asks, comments, shares and
// listener. Shots, snaps and logs are left behind. The legacy folder is marked migratedTo and kept;
// gc deletes it in time. The caller stops its server (scripts/proto.mjs, up).
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, extname, join, relative } from 'node:path'
import { mergeThemes } from '../app/theme-merge.mjs'
import { PROJECT_DIR, keepLock, locked } from './project.mjs'

const read = (f, fallback) => { try { return JSON.parse(readFileSync(f, 'utf8')) } catch { return fallback } }
function write(f, v) {
  mkdirSync(join(f, '..'), { recursive: true })
  const tmp = `${f}.${process.pid}.tmp`
  writeFileSync(tmp, typeof v === 'string' ? v : JSON.stringify(v, null, 2) + '\n')
  renameSync(tmp, f)
}
const metaJson = text => JSON.parse(text.replace(/^[\s\S]*?export default\s*/, '').replace(/;?\s*$/, ''))
const withMeta = (text, meta) => text.replace(/export default[\s\S]*$/, () => `export default ${JSON.stringify(meta, null, 2)}\n`)
const files = dir => !existsSync(dir) ? [] : readdirSync(dir, { recursive: true }).map(f => join(dir, String(f))).filter(f => statSync(f).isFile())
const sha = f => createHash('sha256').update(readFileSync(f)).digest('hex')
const CODE = /\.(tsx|ts|jsx|js|mjs|vue|svelte|css)$/
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const sid8 = sid => sid.replace(/[^a-zA-Z0-9-]/g, '').slice(0, 8) || 'session'

// "^19.2.0" against "~19.3.1": the higher wins.
const version = v => String(v).replace(/^[^\d]*/, '').split(/[.-]/).map(n => parseInt(n, 10) || 0)
const higher = (a, b) => { const x = version(a), y = version(b); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0) ? a : b; return a }

/**
 * @param {string} app the project app
 * @param {{ dir: string, json: object }} legacy
 * @param {{ first: boolean }} opts first: the conversation running `proto up`; its ports come along
 * @returns {{ sid: string, name: string, renames: Record<string,string>, assets: Record<string,string>, conflicts: string[], prototypes: number, depsChanged: boolean, skipped?: string }}
 */
export function importSession(app, legacy, { first }) {
  // first: told by `proto up` itself; any other conversation is told on its next command.
  const { dir, json } = legacy, sid = String(json.id), out = { sid, name: json.name || sid, renames: {}, assets: {}, conflicts: [], prototypes: 0, depsChanged: false, ...(first ? { told: true } : {}) }
  return locked(app, () => {
    // Another `proto up` may have taken it while this one waited for the lock.
    if (read(join(dir, 'session.json'), {}).migratedTo) return { ...out, already: true }
    const project = read(join(app, 'session.json'), {})
    if (json.stack && project.stack && json.stack !== project.stack) {
      out.skipped = `made with ${json.stack}, the project app is ${project.stack}`
      // Kept: no command reaches it any more, so gc must not remove it after its idle days.
      write(join(dir, 'session.json'), { ...read(join(dir, 'session.json'), json), keep: true })
      return log(app, out)
    }

    // Slugs: a taken one gets the first free -n.
    const src = join(dir, 'src', 'protos'), dst = join(app, 'src', 'protos')
    const slugs = readdirSync(src).filter(s => existsSync(join(src, s, 'meta.ts')))
    for (const slug of slugs) {
      let to = slug, n = 2
      // One of its own is an import cut off before its mark: copied again over itself.
      const ours = t => { try { return metaJson(readFileSync(join(dst, t, 'meta.ts'), 'utf8')).session === sid } catch { return false } }
      while ((existsSync(join(dst, to)) && !ours(to)) || Object.values(out.renames).includes(to)) to = `${slug}-${n++}`
      if (to !== slug) out.renames[slug] = to
    }
    const name = slug => out.renames[slug] ?? slug
    const route = r => typeof r === 'string' ? r.replace(/^([a-z0-9][a-z0-9-]*)(?=\/|$)/, s => name(s)) : r

    // Assets: same bytes are one file; different bytes are renamed <name>--<sid8>.
    const assetsFrom = join(dir, 'src', 'assets'), assetsTo = join(app, 'src', 'assets')
    for (const f of files(assetsFrom)) {
      const rel = relative(assetsFrom, f), there = join(assetsTo, rel)
      if (existsSync(there) && sha(there) === sha(f)) continue
      let to = rel
      if (existsSync(there)) { const ext = extname(rel); to = `${rel.slice(0, -ext.length || undefined)}--${sid8(sid)}${ext}`; out.assets[rel] = to }
      keepLock(app)
      mkdirSync(join(assetsTo, to, '..'), { recursive: true })
      cpSync(f, join(assetsTo, to))
    }

    // Theme: merged, and this session's prototypes carry its scope when its tokens disagree.
    const themeFile = join(app, 'src', 'theme.css'), theirs = existsSync(join(dir, 'src', 'theme.css')) ? readFileSync(join(dir, 'src', 'theme.css'), 'utf8') : ''
    let scoped = false
    if (theirs) {
      const merged = mergeThemes(existsSync(themeFile) ? readFileSync(themeFile, 'utf8') : '', [{ scope: sid, css: theirs }])
      write(themeFile, merged.css)
      out.conflicts = merged.conflicts.map(c => c.token).concat(merged.inline)
      scoped = merged.css.includes(`[data-proto-theme="${sid}"]`)
      if (scoped) out.theme = sid
    }

    // Code that names a renamed slug or asset: Slot props, imports between prototypes, history's
    // pointers back at the originals, asset paths and image() names.
    const rewrite = text => {
      for (const [from, to] of Object.entries(out.renames)) {
        text = text.replace(new RegExp(`proto="${esc(from)}"`, 'g'), `proto="${to}"`)
          .replace(new RegExp(`(['"\`])\\.\\./${esc(from)}/`, 'g'), `$1../${to}/`)
          .replace(new RegExp(`/protos/${esc(from)}/`, 'g'), `/protos/${to}/`)
      }
      for (const [from, to] of Object.entries(out.assets)) {
        text = text.replace(new RegExp(`assets/${esc(from)}(['"\`?])`, 'g'), `assets/${to}$1`)
        const bare = f => basename(f).replace(/\.\w+$/, '')
        if (!from.includes('/')) text = text.replace(new RegExp(`image\\((['"\`])${esc(bare(from))}\\1\\)`, 'g'), `image($1${bare(to)}$1)`)
      }
      return text
    }
    const copyTree = (from, to) => {
      if (!existsSync(from)) return
      for (const f of files(from)) {
        const t = join(to, relative(from, f))
        keepLock(app)
        mkdirSync(join(t, '..'), { recursive: true })
        if (CODE.test(f)) writeFileSync(t, rewrite(readFileSync(f, 'utf8')))
        else cpSync(f, t)
      }
    }

    for (const slug of slugs) {
      const to = name(slug)
      copyTree(join(src, slug), join(dst, to))
      const mf = join(dst, to, 'meta.ts'), text = readFileSync(mf, 'utf8'), m = metaJson(text)
      if (m.from) m.from = route(m.from)
      if (Array.isArray(m.also)) m.also = m.also.map(route)
      for (const s of Object.values(m.slots || {})) if (s?.use) s.use = route(s.use)
      const { variants, ...head } = m
      write(mf, withMeta(text, { ...head, session: m.session ?? sid, owner: m.owner ?? sid, ...(scoped ? { theme: sid } : {}), variants }))
      copyTree(join(dir, 'src', 'history', slug), join(app, 'src', 'history', to))
      copyTree(join(dir, '.proto', 'ref', slug), join(app, '.proto', 'ref', to))
      for (const [sub, ext] of [['briefs', '.json'], ['decisions', '.md']]) {
        const f = join(dir, '.proto', sub, slug + ext)
        if (existsSync(f)) { mkdirSync(join(app, '.proto', sub), { recursive: true }); cpSync(f, join(app, '.proto', sub, to + ext)) }
      }
      out.prototypes++
    }

    // Packages: every one either needs; a version both name differently keeps the higher.
    const pkgFile = join(app, 'package.json'), pkg = read(pkgFile, {}), theirsPkg = read(join(dir, 'package.json'), {})
    for (const key of ['dependencies', 'devDependencies']) for (const [n, v] of Object.entries(theirsPkg[key] || {})) {
      const had = pkg[key]?.[n] ?? pkg.dependencies?.[n] ?? pkg.devDependencies?.[n]
      if (had === v) continue
      const keep = had ? higher(had, v) : v
      if (had && had !== v) out.conflicts.push(`${n} ${had} / ${v}`)
      if (keep !== had) { pkg[key] = { ...pkg[key], [n]: keep }; out.depsChanged = true }
    }
    if (out.depsChanged) write(pkgFile, pkg)

    // Asks follow their variants; the conversation running this keeps its working variant.
    const patch = {}
    if (json.asks) {
      patch.asks = { ...project.asks }
      for (const [k, list] of Object.entries(json.asks)) patch.asks[route(k)] = [...(patch.asks[route(k)] || []), ...list]
    }
    if (first) {
      if (json.port && !project.port) patch.port = json.port
      if (json.tailnetPort && !project.tailnetPort) patch.tailnetPort = json.tailnetPort
      if (json.work) { patch.work = { ...json.work, proto: name(json.work.proto) }; patch.before = (json.before || []).map(b => ({ ...b, proto: name(b.proto) })) }
      if (json.lang && !project.lang) patch.lang = json.lang
    }
    if (Object.keys(patch).length) write(join(app, 'session.json'), { ...read(join(app, 'session.json'), {}), ...patch })

    // Its comments go with their owner, answered threads too (the page lists them from taken/).
    const deep = v => Array.isArray(v) ? v.map(deep) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, k === 'route' ? route(x) : k === 'proto' && typeof x === 'string' ? name(x) : deep(x)])) : v
    for (const box of ['new', 'taken']) {
      const from = join(dir, '.proto', 'inbox', box)
      if (!existsSync(from)) continue
      for (const id of readdirSync(from)) {
        const b = read(join(from, id, 'batch.json'), null)
        if (!b) continue
        const to = join(app, '.proto', 'inbox', box, id)
        cpSync(join(from, id), to, { recursive: true })
        write(join(to, 'batch.json'), { ...deep(b), owner: sid })
      }
    }

    // Shares: the same links, published from here, still under the session they were made in.
    const shares = read(join(dir, '.proto', 'shares.json'), [])
    if (shares.length) {
      const mine = read(join(app, '.proto', 'shares.json'), [])
      for (const r of shares) {
        if (mine.some(x => x.id === r.id)) continue
        mine.push({ ...r, session: r.session ?? sid, ...(r.scope ? { scope: { ...r.scope, protos: (r.scope.protos || []).map(p => ({ ...p, id: name(p.id) })), start: route(r.scope.start) } } : {}) })
        if (existsSync(join(dir, '.proto', 'shares', r.id))) cpSync(join(dir, '.proto', 'shares', r.id), join(app, '.proto', 'shares', r.id), { recursive: true })
      }
      write(join(app, '.proto', 'shares.json'), mine)
    }

    // Its listener keeps waking the same conversation (app/listener.mjs reads it per session).
    const from = join(dir, '.proto', 'inbox'), to = join(app, '.proto', 'inbox', 'listeners')
    for (const [f, t] of [['listener.json', `${sid}.json`], ['listener-status.json', `${sid}-status.json`], ['notified.json', `${sid}-notified.json`]]) {
      // Moved, not copied: the legacy folder then holds no listener (and no copy of its private URL,
      // which the project app's dev server could serve), so gc can take it in time.
      if (existsSync(join(from, f))) { mkdirSync(to, { recursive: true }); cpSync(join(from, f), join(to, t)); rmSync(join(from, f)) }
    }

    // Its ports are the project app's now (the first conversation's) or gone: an old app that kept
    // them would turn the project app's tailnet rule off when it is stopped or removed.
    write(join(dir, 'session.json'), { ...read(join(dir, 'session.json'), json), migratedTo: PROJECT_DIR, port: null, tailnetPort: null, pid: null })
    return log(app, out)
  })
}

function log(app, out) {
  const f = join(app, '.proto', 'imports.json')
  write(f, [...read(f, []), { ...out, at: new Date().toISOString() }])
  return out
}

/** What an import did to this conversation's work that it wasn't told yet; marked told. */
export function untold(app, sid) {
  const f = join(app, '.proto', 'imports.json')
  return locked(app, () => {
    const all = read(f, []), mine = all.filter(x => x.sid === sid && !x.told && !x.skipped)
    if (!mine.length) return []
    write(f, all.map(x => mine.includes(x) ? { ...x, told: true } : x))
    return mine
  })
}
