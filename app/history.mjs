// A variant's earlier versions, so the page can put one beside the variant as it is now. A version is
// the variant as it was right before a change the user asked for (`proto ask`, `proto work --ask`, a
// pick made in the page) or one saved by hand (`proto history <route> --save`): a copy of its own file
// and the code files beside it that are not variants (parts.tsx, data.ts, styles), in
// src/history/<slug>/<letter>/<n>/, with version.json last so the page never sees half a version.
// It lives under src/ so Tailwind reads its classes, outside src/protos/ so the registry, the editing
// dots and share links never take it for a prototype. Imports that leave the copy (an image, the slot,
// a sub-folder) are pointed back at the originals. Nothing changed since the last version: that
// version takes the new ask too, instead of a copy that looks the same.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'

const CODE = /\.(tsx|ts|jsx|js|mjs|vue|svelte|css)$/
const VARIANT = /^[A-Z]{1,2}\.\w+$/
const toPosix = p => p.split(sep).join('/')

export const historyDir = (app, slug, letter) => join(app, 'src', 'history', ...(slug ? [slug] : []), ...(letter ? [letter] : []))

/** The files a version keeps: the variant's own and the non-variant code files beside it. */
export function filesOf(app, slug, letter) {
  const dir = join(app, 'src', 'protos', slug)
  if (!existsSync(dir)) return []
  const names = readdirSync(dir).filter(f => statSync(join(dir, f)).isFile())
  const own = names.find(f => VARIANT.test(f) && f.replace(/\.\w+$/, '') === letter)
  if (!own) return []
  return [own, ...names.filter(f => f !== own && !VARIANT.test(f) && f !== 'meta.ts' && CODE.test(f))].sort((a, b) => (a === own ? -1 : b === own ? 1 : a.localeCompare(b)))
}

/**
 * A copied file's relative imports, pointed back at the originals unless what they name was copied
 * too (it then sits beside the copy, as it did beside the original). from: the original folder;
 * to: the copy's folder; kept: the names copied.
 */
export function rewriteImports(text, from, to, kept) {
  const has = spec => {
    if (!spec.startsWith('./')) return false
    const name = spec.slice(2)
    return !name.includes('/') && (kept.has(name) || [...kept].some(k => k.replace(/\.\w+$/, '') === name))
  }
  return text.replace(/(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])(\.{1,2}\/[^'"]*)\2/g, (all, lead, q, full) => {
    const [spec, query = ''] = full.split(/(?=\?)/)
    if (has(spec)) return all
    let next = toPosix(relative(to, resolve(from, spec)))
    if (!next.startsWith('.')) next = `./${next}`
    return `${lead}${q}${next}${query}${q}`
  })
}

const readVersion = file => { try { return JSON.parse(readFileSync(file, 'utf8')) } catch { return null } }

/** A variant's versions, oldest first: { n, at, hash, file, before: [{ text, at }] }. */
export function versionsOf(app, slug, letter) {
  const dir = historyDir(app, slug, letter)
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter(d => /^\d+$/.test(d))
    .map(d => readVersion(join(dir, d, 'version.json')))
    .filter(Boolean).sort((a, b) => a.n - b.n)
}

/**
 * Keeps the variant as it is now, before `text` changes it. Returns { n, created } (created false:
 * nothing changed since version n, which now lists this ask too), or null when the variant has no file.
 * note: a version saved by hand (`proto history --save`), in place of an ask.
 */
export function snapshot(app, slug, letter, text, { at = new Date().toISOString(), note = '' } = {}) {
  const names = filesOf(app, slug, letter)
  if (!names.length) return null
  const src = join(app, 'src', 'protos', slug)
  const hash = createHash('sha256')
  for (const f of names) hash.update(f).update('\0').update(readFileSync(join(src, f))).update('\0')
  const digest = hash.digest('hex').slice(0, 16)
  const label = String(text || '').trim()
  const all = versionsOf(app, slug, letter), last = all.at(-1)
  const dir = historyDir(app, slug, letter)
  if (last && last.hash === digest) {
    if (label && !last.before.some(b => b.text === label)) {
      last.before.push({ text: label, at })
      writeFileSync(join(dir, String(last.n), 'version.json'), JSON.stringify(last, null, 2) + '\n')
    }
    return { n: last.n, created: false }
  }
  const n = (last?.n ?? 0) + 1
  // Written aside and moved in whole, so a page reading the folder never meets half a version.
  const tmp = join(dir, `.${n}-${process.pid}`), out = join(dir, String(n))
  rmSync(tmp, { recursive: true, force: true })
  mkdirSync(tmp, { recursive: true })
  const kept = new Set(names)
  for (const f of names) {
    const body = readFileSync(join(src, f), 'utf8')
    writeFileSync(join(tmp, f), rewriteImports(body, src, out, kept))
  }
  const version = { n, at, hash: digest, file: names[0], before: label ? [{ text: label, at }] : [], ...(note ? { note: String(note).trim() } : {}) }
  writeFileSync(join(tmp, 'version.json'), JSON.stringify(version, null, 2) + '\n')
  rmSync(out, { recursive: true, force: true })
  mkdirSync(dirname(out), { recursive: true })
  renameSync(tmp, out)
  return { n, created: true }
}

/** What a version is called in words: its note, else the asks it came before. */
export const versionLabel = v => v.note || (v.before.length ? `before “${v.before.map(b => b.text).join('”, “')}”` : 'saved by hand')
