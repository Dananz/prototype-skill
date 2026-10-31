// Designs on disk: src/designs/<id>/design.ts, plain JSON after `export default` like meta.ts.
// A flow's screen is a prototype's slug (it shows its pick, else its first variant) or slug/letter
// (pinned: a second design grown from another variant of the same prototype).
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const plain = text => JSON.parse(text.replace(/^[\s\S]*?export default\s*/, '').replace(/;?\s*$/, ''))
export const designFile = (dir, id) => join(dir, 'src', 'designs', id, 'design.ts')
export const readDesign = (dir, id) => existsSync(designFile(dir, id)) ? plain(readFileSync(designFile(dir, id), 'utf8')) : null
export const designText = d => `// Design: ${String(d.title).replace(/[\r\n\u2028\u2029]+/g, ' ')}. Screens are prototypes by slug (slug/letter: pinned), in flows.\nexport default ${JSON.stringify(d, null, 2)}\n`
export const designIds = dir => { try { return readdirSync(join(dir, 'src', 'designs')).filter(id => existsSync(designFile(dir, id))).sort() } catch { return [] } }
/** A screen entry as { slug, letter } (letter '' when it shows the pick). */
export const entryOf = e => { const [slug, letter = ''] = String(e).split('/'); return { slug, letter } }
/** The design whose flows hold this prototype unpinned, if any. */
export function designOf(dir, slug) {
  return designIds(dir).find(id => (readDesign(dir, id)?.flows || []).some(f => (f.screens || []).includes(slug))) ?? null
}
/** A free id from a title: its slug, then -2, -3 … */
export function freeId(dir, title) {
  const base = String(title).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'design'
  let id = base, n = 2
  while (existsSync(designFile(dir, id))) id = `${base}-${n++}`
  return id
}
