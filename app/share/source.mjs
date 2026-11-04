// A share's source, carried in its own page so a link can be forked: the files its variants reach,
// their metas cut as a share cuts them, the theme, the package versions they import. Inert JSON in a
// script tag, so the viewer never reads it and the pre-publish review reads it with the rest of the
// page. Pictures aren't repeated: the page holds each as a data URL, and the block names them by the
// hash of that data URL. checkSource is what a fork trusts: the page may come from anyone.
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, extname, join, relative } from 'node:path'
import { ShareError, trimMeta } from './scope.mjs'

export const SOURCE_ID = 'proto-source'
const SOURCE_VERSION = 1
const slash = p => p.replaceAll('\\', '/')
const sha = text => createHash('sha256').update(text).digest('hex')

const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.gif': 'image/gif' }
const EXT_OF = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/avif': '.avif', 'image/gif': '.gif' }
const TEXT = /\.(?:tsx|ts|jsx|js|mjs|vue|svelte|css|json)$/
const PICTURE = /\.(?:png|jpe?g|webp|avif|gif)$/i

const CSS_URL = /url\(\s*["']?(\.{1,2}\/[^"')]+)/g
const IMPORT_RE = /(?:\bfrom|\bimport)\s*\(?\s*(['"])([^'"\n]+)\1/g
const RESOLVE = ['', '.tsx', '.ts', '.jsx', '.js', '.mjs', '.vue', '.svelte', '.css', '/index.tsx', '/index.ts', '/index.jsx', '/index.js']
const isFile = f => { try { return statSync(f).isFile() } catch { return false } }
const packageOf = spec => (spec.startsWith('@') ? spec.split('/').slice(0, 2) : spec.split('/').slice(0, 1)).join('/')

/**
 * What a set of entry files needs, followed through relative imports inside src/: the files under
 * protos/ and designs/ (the rest of src/ is the app, which a fork already has), the bare packages,
 * and the imports from the project. A file is named by its path under src/.
 */
export function sourceFiles(entries, srcDir) {
  const seen = new Set(), bare = new Set(), project = new Set()
  const visit = file => {
    if (seen.has(file) || relative(srcDir, file).startsWith('..')) return
    seen.add(file)
    if (!TEXT.test(file) || file.endsWith('.json')) return
    const code = readFileSync(file, 'utf8')
    // A stylesheet reaches its pictures by url(), which no import names.
    if (file.endsWith('.css')) for (const m of code.matchAll(CSS_URL)) { const hit = join(dirname(file), m[1].split(/[?#]/)[0]); if (isFile(hit)) visit(hit) }
    for (const m of code.matchAll(IMPORT_RE)) {
      const spec = m[2].split('?')[0]
      if (spec.startsWith('.')) { const hit = RESOLVE.map(x => join(dirname(file), spec) + x).find(isFile); if (hit) visit(hit) }
      else if (spec.startsWith('@project/')) project.add(spec)
      else if (!spec.startsWith('/') && !spec.startsWith('virtual:') && !spec.includes(':')) bare.add(packageOf(spec))
    }
  }
  entries.forEach(visit)
  const rel = f => slash(relative(srcDir, f))
  const ours = [...seen].filter(f => /^(?:protos|designs)\//.test(rel(f)) && !/\/(?:meta|design)\.ts$/.test(rel(f)))
  return { text: ours.filter(f => TEXT.test(f)), pictures: ours.filter(f => PICTURE.test(f)), packages: [...bare], projectImports: [...project] }
}

const dataUrl = (bytes, mime) => `data:${mime};base64,${bytes.toString('base64')}`

/**
 * The block as the share build writes it. made: file -> the data URL the images plugin made of it;
 * a picture not converted (no sharp, a CSS background) stays in the page as its own bytes, so both
 * hashes are named.
 */
export function buildSource({ root, session, scope, info, metaOf, designs = [], entries, assets = [], made = new Map() }) {
  const srcDir = join(root, 'src'), protosDir = join(srcDir, 'protos')
  const { text, pictures, packages, projectImports } = sourceFiles(entries, srcDir)
  const shared = new Set(scope.protos.map(p => p.id))
  const protos = scope.protos.map(p => {
    const meta = metaOf(readFileSync(join(protosDir, p.id, 'meta.ts'), 'utf8'))
    return { id: p.id, meta: { ...trimMeta(meta, p.variants, shared), ...(typeof meta.theme === 'string' ? { theme: meta.theme } : {}), ...(meta.forkedFrom ? { forkedFrom: meta.forkedFrom } : {}) } }
  })
  const files = Object.fromEntries(text.map(f => [slash(relative(srcDir, f)), readFileSync(f, 'utf8')]))
  // Written by hand, in the code, and by name in image(): each picture a fork has to put back.
  const named = new Set(assets)
  const assetsDir = join(srcDir, 'assets')
  for (const code of Object.values(files)) for (const m of code.matchAll(/\bassets\/([\w./-]+\.(?:png|jpe?g|webp|avif|gif))/gi)) { const f = join(assetsDir, m[1]); if (existsSync(f)) named.add(f) }
  const hashes = file => {
    const mime = MIME[extname(file).toLowerCase()]
    if (!mime) return []
    const raw = sha(dataUrl(readFileSync(file), mime))
    return made.has(file) ? [raw, sha(made.get(file))] : [raw]
  }
  const pictureRows = [...named, ...pictures].map(f => ({ path: slash(relative(srcDir, f)), hashes: hashes(f) })).filter(r => r.hashes.length)
  let pkg = {}
  try { pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) } catch { /* none */ }
  const versions = Object.fromEntries(packages.flatMap(n => { const v = pkg.dependencies?.[n] ?? pkg.devDependencies?.[n]; return v ? [[n, v]] : [] }))
  let theme = ''
  try { theme = readFileSync(join(srcDir, 'theme.css'), 'utf8') } catch { /* none */ }
  return {
    v: SOURCE_VERSION, stack: session.stack, title: info.title || '', owner: info.owner || '', version: info.version || 1, lang: session.lang ?? 'en',
    theme, protos, files, designs, assets: pictureRows, packages: versions, projectImports,
  }
}

// JSON that can't end its script tag or the line it is on.
export function sourceTag(source) {
  const json = JSON.stringify(source).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
  return `<script type="application/json" id="${SOURCE_ID}">${json}</script>`
}

/** The block in a page, parsed and not yet checked; null when the page carries none. */
export function readSource(html) {
  const at = html.indexOf(`id="${SOURCE_ID}">`)
  if (at < 0) return null
  const from = at + SOURCE_ID.length + 6
  const end = html.indexOf('</script>', from)
  if (end < 0) throw new ShareError('This page\'s source is cut off: it can\'t be forked.')
  try { return JSON.parse(html.slice(from, end)) } catch { throw new ShareError('This page\'s source can\'t be read: it can\'t be forked.') }
}

const SLUG = /^[a-z0-9][a-z0-9-]*$/
const LETTER = /^[A-Z]{1,3}$/
const PATH_PART = /^[\w.@-]+$/
const VERSION = /^[\^~]?\d[\w.+-]*$/
const PACKAGE = /^(?:@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/
const MAX_FILES = 2000
const MAX_TEXT = 32 * 2 ** 20

const safePath = p => {
  const parts = p.split('/')
  return parts.length >= 3 && (parts[0] === 'protos' || parts[0] === 'designs' || parts[0] === 'assets') && parts.every(x => PATH_PART.test(x) && x !== '.' && x !== '..') && SLUG.test(parts[0] === 'assets' ? 'assets' : parts[1])
}
const assetPath = p => {
  const parts = p.split('/')
  return PICTURE.test(p) && parts.every(x => PATH_PART.test(x) && x !== '.' && x !== '..') && (parts[0] === 'assets' ? parts.length >= 2 : safePath(p))
}

/**
 * Whether a block from a page may be written here, and only what it may: a page is someone else's,
 * and every path in it becomes a file on this Mac. Throws what is wrong; resolves with a clean copy.
 */
export function checkSource(raw) {
  const no = why => { throw new ShareError(`This page's source can't be forked: ${why}.`) }
  if (!raw || typeof raw !== 'object') no('it is not a source block')
  if (raw.v !== SOURCE_VERSION) no(`it is source version ${raw.v}, and this skill reads ${SOURCE_VERSION}: update the skill`)
  if (typeof raw.stack !== 'string') no('it names no stack')
  if (!Array.isArray(raw.protos) || !raw.protos.length) no('it holds no prototypes')
  const protos = raw.protos.map(p => {
    if (!p || !SLUG.test(p.id ?? '')) no(`"${p?.id}" is not a prototype's name`)
    const meta = p.meta && typeof p.meta === 'object' ? p.meta : {}
    const variants = Object.fromEntries(Object.entries(meta.variants || {}).filter(([k, v]) => LETTER.test(k) && typeof v === 'string'))
    if (!Object.keys(variants).length) no(`${p.id} has no variants`)
    return { id: p.id, meta: { ...meta, variants } }
  })
  const entries = Object.entries(raw.files && typeof raw.files === 'object' ? raw.files : {})
  if (entries.length > MAX_FILES) no(`it holds ${entries.length} files`)
  let size = 0
  for (const [path, text] of entries) {
    if (!safePath(path) || !TEXT.test(path)) no(`"${path}" is not a place a fork may write`)
    if (/\/(?:meta|design)\.ts$/.test(path)) no(`"${path}" is written by the fork itself`)
    if (typeof text !== 'string') no(`"${path}" is not text`)
    size += text.length
  }
  if (size > MAX_TEXT) no('its code is over 32 MiB')
  for (const p of protos) for (const letter of Object.keys(p.meta.variants)) {
    if (!entries.some(([path]) => path.startsWith(`protos/${p.id}/${letter}.`))) no(`${p.id} has no file for its variant ${letter}`)
  }
  const assets = (Array.isArray(raw.assets) ? raw.assets : []).filter(a => a && typeof a.path === 'string' && Array.isArray(a.hashes))
  for (const a of assets) if (!assetPath(a.path)) no(`"${a.path}" is not a picture a fork may write`)
  const packages = raw.packages && typeof raw.packages === 'object' ? raw.packages : {}
  for (const [n, v] of Object.entries(packages)) {
    if (!PACKAGE.test(n) || typeof v !== 'string' || !VERSION.test(v)) no(`the package ${n}@${v} isn't a plain name and version`)
  }
  const designs = (Array.isArray(raw.designs) ? raw.designs : []).filter(d => d && SLUG.test(d.id ?? '') && Array.isArray(d.flows))
  return {
    v: raw.v, stack: raw.stack, title: String(raw.title ?? ''), owner: String(raw.owner ?? ''), version: Number(raw.version) || 1, lang: raw.lang === 'he' ? 'he' : 'en',
    theme: typeof raw.theme === 'string' ? raw.theme : '', protos, files: Object.fromEntries(entries), designs, assets, packages,
    projectImports: (Array.isArray(raw.projectImports) ? raw.projectImports : []).filter(x => typeof x === 'string'),
  }
}

const DATA_URL = /data:(image\/(?:png|jpeg|webp|avif|gif));base64,[A-Za-z0-9+/=]+/g

/** The pictures of a block out of its page: path -> { bytes, ext }, and the paths not found there. */
export function picturesIn(html, assets) {
  const byHash = new Map()
  for (const m of html.matchAll(DATA_URL)) byHash.set(sha(m[0]), m)
  const found = new Map(), missing = []
  for (const a of assets) {
    const m = a.hashes.map(h => byHash.get(h)).find(Boolean)
    if (!m) { missing.push(a.path); continue }
    found.set(a.path, { bytes: Buffer.from(m[0].slice(m[0].indexOf(',') + 1), 'base64'), ext: EXT_OF[m[1]] })
  }
  return { found, missing }
}
