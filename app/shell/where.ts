// Where the place on screen sits in the designs, for the bar's crumb (design › flow › ‹ screen ›)
// and the flow's arrows, and what Jump (⌘K) searches. Pure: the shell draws them.
import type { Design, Proto } from './shell'

type Place = { proto: string; variant: string }
export type Where = {
  design?: { id: string; title: string }
  /** The flow the screen is in, its screens as the routes they open on. */
  flow?: { name: string; routes: string[] }
  /** The screen's place in its flow. */
  at: number
  screen?: Proto
  /** The prototype on screen when it is no screen: built on one (or on no screen when loose). */
  exploration?: Proto
  loose: boolean
}
export type JumpItem = { key: string; kind: 'design' | 'flow' | 'screen' | 'exploration' | 'option'; label: string; sub: string; route: string }

const shown = (p: Proto) => p.picked ?? p.variants[0]?.id ?? 'A'
/** The route a flow's entry opens on: its pinned option, else the pick, else #1 standing in. */
const routeOf = (byId: Map<string, Proto>, entry: string) => { const [slug, pin] = entry.split('/'); const p = byId.get(slug); return p ? `${slug}/${pin || shown(p)}` : '' }
/** Up the from chain to the prototype it all hangs under; a chain that loops leaves p its own root. */
export const rootOf = (p: Proto, byId: Map<string, Proto>) => { const seen = new Set([p.id]); let at = p; while (at.from && byId.has(at.from.proto)) { if (seen.has(at.from.proto)) return p; at = byId.get(at.from.proto)!; seen.add(at.id) } return at }
/** A flow's entries as the screens it walks: each once, the gone ones left out. */
export const entriesOf = (screens: string[], byId: Map<string, Proto>) => screens.filter((e, i) => screens.indexOf(e) === i && byId.has(e.split('/')[0]))

export function whereOf(protos: Proto[], designs: Design[], place: Place): Where {
  const live = protos.filter(p => !p.archived), byId = new Map(live.map(p => [p.id, p]))
  const p = byId.get(place.proto)
  if (!p) return { at: -1, loose: false }
  // The screen it is (pinned to this option, else the entry that shows its pick), or the one it was built on.
  const entry = (match: (e: string) => boolean) => { for (const d of designs) for (const f of d.flows) { const screens = entriesOf(f.screens, byId), i = screens.findIndex(match); if (i >= 0) return { d, f: { ...f, screens }, i } } return null }
  const pinned = (slug: string, letter: string) => entry(e => e === `${slug}/${letter}`)
  const find = (slug: string) => entry(e => e === slug) ?? entry(e => e.split('/')[0] === slug)
  const hit = pinned(p.id, place.variant) ?? find(p.id)
  const top = hit ? p : rootOf(p, byId)
  const at = hit ?? (top !== p ? find(top.id) : null)
  if (!at) return { at: -1, loose: true, exploration: p }
  return {
    design: { id: at.d.id, title: at.d.title }, flow: { name: at.f.name, routes: at.f.screens.map(e => routeOf(byId, e)) }, at: at.i,
    screen: byId.get(at.f.screens[at.i].split('/')[0]), ...(hit ? {} : { exploration: p }), loose: false,
  }
}

/** What a link's chip says about the screen it lands on: its pick, an option pinned in the design, or #1 standing in. */
export function linkState(p: Proto, letter: string): { kind: 'picked' | 'pinned' | 'stand-in'; letter: string } {
  return { kind: p.picked === letter ? 'picked' : !p.picked && letter === p.variants[0]?.id ? 'stand-in' : 'pinned', letter }
}

export function jumpItems(protos: Proto[], designs: Design[]): JumpItem[] {
  const live = protos.filter(p => !p.archived), byId = new Map(live.map(p => [p.id, p]))
  const items: JumpItem[] = [], screens = new Set<string>()
  for (const d of designs) {
    const first = d.flows.flatMap(f => f.screens).map(e => routeOf(byId, e)).find(Boolean)
    if (first) items.push({ key: `design:${d.id}`, kind: 'design', label: d.title, sub: '', route: first })
    for (const f of d.flows) {
      const routes = f.screens.map(e => routeOf(byId, e)).filter(Boolean)
      if (routes.length) items.push({ key: `flow:${d.id}:${f.name}`, kind: 'flow', label: f.name, sub: d.title, route: routes[0] })
      for (const e of f.screens) {
        const p = byId.get(e.split('/')[0]), route = routeOf(byId, e)
        if (!p || !route) continue
        screens.add(p.id)
        items.push({ key: `screen:${e}`, kind: 'screen', label: p.title, sub: `${d.title} › ${f.name}`, route })
      }
    }
  }
  for (const p of live) {
    if (!screens.has(p.id)) items.push({ key: `exp:${p.id}`, kind: 'exploration', label: p.title, sub: p.from ? byId.get(p.from.proto)?.title ?? '' : '', route: `${p.id}/${shown(p)}` })
    for (const [i, v] of p.variants.entries()) items.push({ key: `opt:${p.id}/${v.id}`, kind: 'option', label: v.name, sub: `${p.title} #${i + 1}`, route: `${p.id}/${v.id}` })
  }
  return items
}

const ORDER: JumpItem['kind'][] = ['design', 'flow', 'screen', 'exploration', 'option']
/** Words in any case; a name that starts with the query, then one with a word that does, then the rest. */
export function jumpMatch(items: JumpItem[], query: string, limit = 50): JumpItem[] {
  const q = query.trim().toLowerCase()
  if (!q) return items.filter(i => i.kind !== 'option').slice(0, limit)
  const rank = (i: JumpItem) => { const l = i.label.toLowerCase(); return l.startsWith(q) ? 0 : l.split(/\s+/).some(w => w.startsWith(q)) ? 1 : l.includes(q) ? 2 : `${i.sub}`.toLowerCase().includes(q) ? 3 : -1 }
  return items.map(i => ({ i, r: rank(i) })).filter(x => x.r >= 0)
    .sort((a, b) => a.r - b.r || ORDER.indexOf(a.i.kind) - ORDER.indexOf(b.i.kind)).map(x => x.i).slice(0, limit)
}
