// What a share carries: which prototypes and variants, and the slice of their meta.ts and
// session.json that may leave the machine. Everything not named here stays behind.
import { letterOf } from '../numbers.mjs'

/** An error whose message is meant for the person running the command. */
export class ShareError extends Error {}

const slugOf = ref => String(ref).split('/')[0]

/**
 * The words after `share` (slug, slug/2, slug/B) as the prototypes and variants to publish.
 * `all` takes every prototype that isn't archived. start is the route the link opens on.
 */
export function parseScope(words, all, protos) {
  const byId = new Map(protos.map(p => [p.id, p]))
  const picked = new Map()
  if (all) for (const p of protos) if (!p.archived) picked.set(p.id, new Set(p.variants))
  for (const word of words) {
    const [slug, spec] = word.split('/')
    const p = byId.get(slug)
    if (!p) throw new ShareError(`No prototype called "${slug}" (in "${word}")`)
    if (!p.variants.length) throw new ShareError(`"${slug}" has no variants to share`)
    const set = picked.get(slug) ?? new Set()
    if (spec === undefined) p.variants.forEach(v => set.add(v))
    else {
      const letter = /^\d+$/.test(spec) ? letterOf(spec) : spec.toUpperCase()
      if (!p.variants.includes(letter)) throw new ShareError(`"${word}" is not a variant of ${slug} (it has ${p.variants.join(', ')})`)
      set.add(letter)
    }
    picked.set(slug, set)
  }
  if (!picked.size) throw new ShareError('Name a prototype to share (pricing, pricing/2, pricing/B) or pass --all')
  const out = [...picked].map(([id, set]) => ({ id, variants: byId.get(id).variants.filter(v => set.has(v)) })).filter(p => p.variants.length)
  if (!out.length) throw new ShareError('Nothing to share: no prototype has variants yet')
  // The first word's route: its own variant when it named one, else the prototype's first.
  const [slug, spec] = (words[0] ?? `${out[0].id}`).split('/')
  const p = out.find(x => x.id === slug)
  const variant = spec === undefined ? p.variants[0] : /^\d+$/.test(spec) ? letterOf(spec) : spec.toUpperCase()
  return { protos: out, start: `${slug}/${variant}` }
}

/**
 * The part of a prototype's meta that is safe to publish: what the page draws, never the
 * owner's ask, notes, picks or work markers. Lineage survives only where both ends are shared.
 */
export function trimMeta(meta, keep, shared) {
  const out = {}
  for (const k of ['title', 'kind', 'screen', 'created', 'states']) if (meta[k] !== undefined) out[k] = meta[k]
  for (const k of ['variants', 'about']) {
    if (meta[k] && typeof meta[k] === 'object') out[k] = Object.fromEntries(Object.entries(meta[k]).filter(([id]) => keep.includes(id)))
  }
  if (typeof meta.from === 'string' && shared.has(slugOf(meta.from))) {
    out.from = meta.from
    if (typeof meta.slot === 'string' && meta.slot) out.slot = meta.slot
    if (Array.isArray(meta.also)) out.also = meta.also.filter(r => typeof r === 'string' && shared.has(slugOf(r)))
  }
  return out
}

/** session.json in a share is the name, the stack and the language, nothing about this machine. */
export const trimSession = session => ({ name: session.name, stack: session.stack, lang: session.lang ?? 'en' })
