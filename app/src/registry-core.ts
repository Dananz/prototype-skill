// The registry's logic apart from where the files come from: the app hands it two globs, a
// share build hands it the same shapes from its own tree. Variant names live in meta.ts so every
// stack shares them.
import type { Design, Proto, State, Variant, Version } from '../shell/shell'

export type Meta = { title: string; session?: string; owner?: string; next?: boolean; ask?: string; kind?: 'web' | 'phone'; created?: string; archived?: boolean; from?: string; slot?: string; also?: string[]; picked?: string; favorites?: string[]; count?: number; screen?: [number, number]; variants?: Record<string, string>; about?: Record<string, string>; states?: State[]; theme?: string; recommend?: { pick?: string; why?: string; borrow?: string; takes?: Record<string, string> } }

const order = (a: Variant, b: Variant) => a.id.length - b.id.length || a.id.localeCompare(b.id)

/** What history.mjs writes beside each kept version. */
export type VersionMeta = { n: number; at: string; file: string; note?: string; before?: { text: string; at: string }[] }

// A variant's earlier versions (app/history.mjs): src/history/<slug>/<letter>/<n>/, its
// version.json and the copy of the variant's file, oldest first. A share build has none.
const versionsOf = (id: string, letter: string, all: { parts: string[]; v: VersionMeta }[], files: Record<string, () => Promise<unknown>>): Version[] => all
  .filter(({ parts, v }) => parts[3] === letter && v && Number.isInteger(v.n) && typeof v.file === 'string')
  .map(({ parts, v }) => {
    const key = `./${parts.slice(1, 5).join('/')}/${v.file}`
    return { n: v.n, at: v.at ?? '', note: v.note ?? '', before: Array.isArray(v.before) ? v.before : [], file: `/src${key.slice(1)}`, load: files[key] }
  })
  .filter((v): v is Version => !!v.load)
  .sort((a, b) => a.n - b.n)

// Each list is grouped once by its prototype, so a project's load doesn't grow with prototypes times files.
type FileRow = { file: string; load: () => Promise<unknown>; parts: string[] }
const fileGroups = new WeakMap<object, Map<string, FileRow[]>>()
const filesBy = (files: Record<string, () => Promise<unknown>>) => {
  let groups = fileGroups.get(files)
  if (!groups) {
    groups = new Map()
    for (const [file, load] of Object.entries(files)) {
      const parts = file.split('/'), list = groups.get(parts[2])
      if (list) list.push({ file, load, parts }); else groups.set(parts[2], [{ file, load, parts }])
    }
    fileGroups.set(files, groups)
  }
  return groups
}
const versionGroups = new WeakMap<object, Map<string, { parts: string[]; v: VersionMeta }[]>>()
const versionsBy = (metas: Record<string, VersionMeta>) => {
  let groups = versionGroups.get(metas)
  if (!groups) {
    groups = new Map()
    for (const [path, v] of Object.entries(metas)) {
      const parts = path.split('/'), list = groups.get(parts[2])
      if (list) list.push({ parts, v }); else groups.set(parts[2], [{ parts, v }])
    }
    versionGroups.set(metas, groups)
  }
  return groups
}

export const protosOf = (metas: Record<string, Meta>, files: Record<string, () => Promise<unknown>>, history: { metas: Record<string, VersionMeta>; files: Record<string, () => Promise<unknown>> } = { metas: {}, files: {} }): Proto[] => Object.entries(metas)
  .map(([path, meta]) => {
    const id = path.split('/')[2]
    const variants = (filesBy(files).get(id) ?? [])
      .filter(f => /^[A-Z]{1,2}\.\w+$/.test(f.parts[3]))
      .map(f => {
        const vid = f.parts[3].replace(/\.\w+$/, '')
        // theme: the scope of the project's theme.css this prototype's look comes from (app/theme-merge.mjs).
        return { id: vid, name: meta.variants?.[vid] ?? vid, load: f.load, file: `/src${f.file.slice(1)}`, ...(typeof meta.theme === 'string' && meta.theme ? { theme: meta.theme } : {}) }
      })
      .sort(order)
    // from: "home/B" (built from variant B of home) or "home" (from the prototype as a whole).
    // also: the other prototypes or variants it combines ("style/B"); it nests under from only.
    const [fp, fv = ''] = typeof meta.from === 'string' ? meta.from.split('/') : []
    const also = fp && Array.isArray(meta.also) ? meta.also.filter(r => typeof r === 'string' && r).map(r => { const [proto, variant = ''] = r.split('/'); return { proto, variant } }) : []
    // states: what is behind clicks in the variants, each reached by clicking its selectors in order.
    const states = (Array.isArray(meta.states) ? meta.states : []).filter(x => x && typeof x.id === 'string' && x.id && Array.isArray(x.click))
    // recommend: the agent's pick and why (proto recommend), kept only while it names a variant here.
    const r = meta.recommend, str = (x: unknown) => typeof x === 'string' && x.trim() ? x.trim() : undefined
    const recommend = r && typeof r.pick === 'string' && variants.some(v => v.id === r.pick)
      ? { pick: r.pick, why: str(r.why) ?? '', ...(str(r.borrow) ? { borrow: str(r.borrow)! } : {}), takes: Object.fromEntries(Object.entries(r.takes && typeof r.takes === 'object' ? r.takes : {}).filter(([k, l]) => variants.some(v => v.id === k) && str(l)).map(([k, l]) => [k, str(l)!])) }
      : undefined
    return { id, title: meta.title ?? id, ...(recommend ? { recommend } : {}), ...(typeof meta.session === 'string' ? { session: meta.session } : {}), ...(typeof meta.owner === 'string' ? { owner: meta.owner } : {}), ...(meta.next ? { next: true } : {}), ask: meta.ask ?? '', kind: meta.kind ?? 'web', created: meta.created ?? '', archived: !!meta.archived, from: fp ? { proto: fp, variant: fv } : undefined, slot: typeof meta.slot === 'string' && meta.slot ? meta.slot : undefined, also, picked: meta.picked, versions: Object.fromEntries(variants.map(v => [v.id, versionsOf(id, v.id, versionsBy(history.metas).get(id) ?? [], history.files)]).filter(([, list]) => list.length)), favorites: Array.isArray(meta.favorites) ? meta.favorites.filter(f => variants.some(v => v.id === f)) : [], count: Number.isInteger(meta.count) && meta.count! > 0 ? meta.count : undefined, screen: meta.screen ?? [393, 852], about: meta.about ?? {}, states, variants }
  })
  .sort((a, b) => a.created.localeCompare(b.created))

/** What `proto design` writes in src/designs/<id>/design.ts. */
export type DesignMeta = { title?: string; created?: string; session?: string; owner?: string; from?: string; flows?: unknown }

/** The designs: each a set of screens (prototypes, by slug) in flows, oldest first. */
export const designsOf = (metas: Record<string, DesignMeta>): Design[] => Object.entries(metas)
  // A design.ts that isn't an object (written by hand, half saved) is no design.
  .filter(([, meta]) => !!meta && typeof meta === 'object')
  .map(([path, meta]) => {
    const id = path.split('/')[2]
    const [proto, variant = ''] = typeof meta.from === 'string' ? meta.from.split('/') : []
    const flows = (Array.isArray(meta.flows) ? meta.flows : [])
      .filter((f): f is { name: string; screens?: unknown } => !!f && typeof f === 'object' && typeof (f as { name?: unknown }).name === 'string')
      .map(f => ({ name: f.name, screens: (Array.isArray(f.screens) ? f.screens : []).filter((x): x is string => typeof x === 'string' && !!x) }))
    return { id, title: meta.title ?? id, created: meta.created ?? '', ...(typeof meta.session === 'string' ? { session: meta.session } : {}), ...(typeof meta.owner === 'string' ? { owner: meta.owner } : {}), ...(proto ? { from: { proto, variant } } : {}), flows }
  })
  .sort((a, b) => a.created.localeCompare(b.created))
