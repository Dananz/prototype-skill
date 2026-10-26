// The registry's logic apart from where the files come from: the app hands it two globs, a
// share build hands it the same shapes from its own tree. Variant names live in meta.ts so every
// stack shares them.
import type { Proto, State, Variant } from '../shell/shell'

export type Meta = { title: string; ask?: string; kind?: 'web' | 'phone'; created?: string; archived?: boolean; from?: string; slot?: string; also?: string[]; picked?: string; favorites?: string[]; count?: number; screen?: [number, number]; variants?: Record<string, string>; about?: Record<string, string>; states?: State[] }

const order = (a: Variant, b: Variant) => a.id.length - b.id.length || a.id.localeCompare(b.id)

export const protosOf = (metas: Record<string, Meta>, files: Record<string, () => Promise<unknown>>): Proto[] => Object.entries(metas)
  .map(([path, meta]) => {
    const id = path.split('/')[2]
    const variants = Object.entries(files)
      .map(([file, load]) => ({ file, load, parts: file.split('/') }))
      .filter(f => f.parts[2] === id && /^[A-Z]{1,2}\.\w+$/.test(f.parts[3]))
      .map(f => {
        const vid = f.parts[3].replace(/\.\w+$/, '')
        return { id: vid, name: meta.variants?.[vid] ?? vid, load: f.load, file: `/src${f.file.slice(1)}` }
      })
      .sort(order)
    // from: "home/B" (built from variant B of home) or "home" (from the prototype as a whole).
    // also: the other prototypes or variants it combines ("style/B"); it nests under from only.
    const [fp, fv = ''] = typeof meta.from === 'string' ? meta.from.split('/') : []
    const also = fp && Array.isArray(meta.also) ? meta.also.filter(r => typeof r === 'string' && r).map(r => { const [proto, variant = ''] = r.split('/'); return { proto, variant } }) : []
    // states: what is behind clicks in the variants, each reached by clicking its selectors in order.
    const states = (Array.isArray(meta.states) ? meta.states : []).filter(x => x && typeof x.id === 'string' && x.id && Array.isArray(x.click))
    return { id, title: meta.title ?? id, ask: meta.ask ?? '', kind: meta.kind ?? 'web', created: meta.created ?? '', archived: !!meta.archived, from: fp ? { proto: fp, variant: fv } : undefined, slot: typeof meta.slot === 'string' && meta.slot ? meta.slot : undefined, also, picked: meta.picked, favorites: Array.isArray(meta.favorites) ? meta.favorites.filter(f => variants.some(v => v.id === f)) : [], count: Number.isInteger(meta.count) && meta.count! > 0 ? meta.count : undefined, screen: meta.screen ?? [393, 852], about: meta.about ?? {}, states, variants }
  })
  .sort((a, b) => a.created.localeCompare(b.created))
