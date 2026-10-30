// The project tree the sidebar draws: designs › flows › screens, each screen's options and the
// explorations built on them (a prototype made --from another hangs under it, "on #n"), then the
// explorations on no screen and the archive. Pure: the sidebar (tree/index.tsx) owns the DOM.
import type { Design, Proto } from '../shell'
import { numberOf } from '../variants'

/** open: waits on the user's pick; waits: on the pick above it; stale: built on an option the
 *  parent no longer has picked; done: picked; building: the agent is writing one of its variants. */
export type ExpState = 'open' | 'waits' | 'stale' | 'done' | 'building'
export type TreeNode = {
  kind: 'design' | 'flow' | 'screen' | 'exploration' | 'option' | 'section'
  key: string; label: string; route?: string; state?: ExpState
  /** A nested exploration: the number of the parent's option it is built on. */
  on?: number
  /** A screen with no pick: its first option stands in for it. */
  standIn?: boolean
  picked?: boolean
  /** An option a design was made from: the design's title. */
  became?: string
  count?: number
  children: TreeNode[]
}
export type Filter = 'all' | 'open' | 'mine'

/** Its parent, unless the chain up from it loops or names a prototype that isn't there. */
function parentOf(p: Proto, byId: Map<string, Proto>): Proto | null {
  const seen = new Set([p.id])
  for (let at: Proto | undefined = p; at?.from; ) {
    const up = byId.get(at.from.proto)
    if (!up || seen.has(up.id)) return null
    seen.add(up.id)
    at = up
  }
  return p.from ? byId.get(p.from.proto) ?? null : null
}

export function stateOf(p: Proto, byId: Map<string, Proto>, building: Set<string>): ExpState {
  if (p.variants.some(v => building.has(`${p.id}/${v.id}`))) return 'building'
  const parent = parentOf(p, byId)
  if (parent && p.from?.variant) {
    if (parent.picked && parent.picked !== p.from.variant) return 'stale'
    if (!parent.picked) return 'waits'
  }
  return p.picked ? 'done' : 'open'
}

const NEEDS: ExpState[] = ['open', 'stale', 'building']
const shown = (p: Proto) => p.picked ?? p.variants[0]?.id ?? 'A'

export function treeOf(protos: Proto[], designs: Design[], o: { filter: Filter; me: string | null; building: Set<string> }): { nodes: TreeNode[]; waiting: number } {
  const live = protos.filter(p => !p.archived)
  const byId = new Map(live.map(p => [p.id, p]))
  const state = (p: Proto) => stateOf(p, byId, o.building)
  const kids = new Map<string, Proto[]>()
  for (const p of live) {
    const parent = parentOf(p, byId)
    if (parent) kids.set(parent.id, [...kids.get(parent.id) ?? [], p])
  }
  const became = new Map(designs.filter(d => d.from).map(d => [`${d.from!.proto}/${d.from!.variant}`, d.title]))
  const mine = (p: Proto) => o.filter !== 'mine' || p.session === o.me

  // An exploration and what hangs under it; null when the filter leaves nothing of it.
  const explore = (p: Proto, kind: 'screen' | 'exploration'): TreeNode | null => {
    const s = state(p)
    const below = (kids.get(p.id) ?? []).map(k => explore(k, 'exploration')).filter((n): n is TreeNode => !!n)
    const keep = o.filter === 'open' ? NEEDS.includes(s) || below.length > 0 : mine(p) || below.length > 0
    if (!keep) return null
    const options: TreeNode[] = p.variants.map(v => ({
      kind: 'option', key: `opt:${p.id}/${v.id}`, label: v.name, route: `${p.id}/${v.id}`,
      ...(p.picked === v.id ? { picked: true } : {}), ...(became.has(`${p.id}/${v.id}`) ? { became: became.get(`${p.id}/${v.id}`) } : {}), children: [],
    }))
    return {
      kind, key: `${kind === 'screen' ? 'screen' : 'exp'}:${p.id}`, label: p.title, route: `${p.id}/${shown(p)}`, state: s,
      ...(kind === 'exploration' && p.from?.variant ? { on: numberOf(p.from.variant) } : {}),
      ...(kind === 'screen' && !p.picked ? { standIn: true } : {}),
      children: [...options, ...below],
    }
  }

  const onScreen = new Set<string>()
  const nodes: TreeNode[] = []
  for (const d of designs) {
    const flows = d.flows.map(f => {
      const screens = f.screens.map(slug => byId.get(slug)).filter((p): p is Proto => !!p).map(p => { onScreen.add(p.id); return explore(p, 'screen') }).filter((n): n is TreeNode => !!n)
      return screens.length ? { kind: 'flow' as const, key: `flow:${d.id}:${f.name}`, label: f.name, count: screens.length, children: screens } : null
    }).filter((n): n is NonNullable<typeof n> => !!n)
    if (flows.length) nodes.push({ kind: 'design', key: `design:${d.id}`, label: d.title, count: flows.reduce((n, f) => n + f.children.length, 0), children: flows })
  }
  // Roots that are no screen, newest first. A root's parent chain is broken or it has none.
  const loose = live.filter(p => !onScreen.has(p.id) && !parentOf(p, byId)).sort((a, b) => b.created.localeCompare(a.created))
    .map(p => explore(p, 'exploration')).filter((n): n is TreeNode => !!n)
  if (loose.length) nodes.push({ kind: 'section', key: 'section:loose', label: 'Explorations on no screen', children: loose })
  const archived = protos.filter(p => p.archived)
  if (o.filter === 'all' && archived.length) nodes.push({ kind: 'section', key: 'section:archive', label: 'Archive', count: archived.length, children: archived.map(p => ({ kind: 'exploration', key: `exp:${p.id}`, label: p.title, route: `${p.id}/${shown(p)}`, children: [] })) })
  return { nodes, waiting: live.filter(p => ['open', 'stale'].includes(state(p))).length }
}
