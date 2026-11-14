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
export type Filter = 'all' | 'open' | 'mine' | 'favs'
/** How long a finished chain stays in the tree after its last touch. */
export const SETTLE_AFTER = 3 * 864e5
/** What deciding the shelf takes. keep: what must stay in the tree (the agent is on it, comments are open). */
export type Settle = { now: number; keep(id: string): boolean; touched(p: Proto): number; seen(route: string, p: Proto): boolean; aside(id: string): 'settled' | 'active' | undefined }

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

export function treeOf(protos: Proto[], designs: Design[], o: { filter: Filter; me: string | null; building: Set<string>; settle?: Settle }): { nodes: TreeNode[]; waiting: number; settled: TreeNode[]; waits: { p: Proto; state: 'open' | 'stale'; route: string }[] } {
  const live = protos.filter(p => !p.archived)
  const byId = new Map(live.map(p => [p.id, p]))
  const state = (p: Proto) => stateOf(p, byId, o.building)
  const kids = new Map<string, Proto[]>()
  for (const p of live) {
    const parent = parentOf(p, byId)
    if (parent) kids.set(parent.id, [...kids.get(parent.id) ?? [], p])
  }
  const became = new Map(designs.filter(d => d.from).map(d => [`${d.from!.proto}/${d.from!.variant}`, d.title]))
  const mine = (p: Proto) => o.filter !== 'mine' || p.session === o.me || p.owner === o.me

  // An exploration and what hangs under it; null when the filter leaves nothing of it.
  const explore = (p: Proto, kind: 'screen' | 'exploration', pinned = ''): TreeNode | null => {
    const s = state(p)
    const below = (kids.get(p.id) ?? []).map(k => explore(k, 'exploration')).filter((n): n is TreeNode => !!n)
    const favs = o.filter === 'favs'
    const keep = o.filter === 'open' ? NEEDS.includes(s) || below.length > 0 : favs ? p.favorites.length > 0 || below.length > 0 : mine(p) || below.length > 0
    if (!keep) return null
    const options: TreeNode[] = p.variants.filter(v => !favs || p.favorites.includes(v.id)).map(v => ({
      kind: 'option', key: `opt:${p.id}/${v.id}`, label: v.name, route: `${p.id}/${v.id}`,
      ...(p.picked === v.id ? { picked: true } : {}), ...(became.has(`${p.id}/${v.id}`) ? { became: became.get(`${p.id}/${v.id}`) } : {}), children: [],
    }))
    return {
      kind, key: `${kind === 'screen' ? 'screen' : 'exp'}:${p.id}${pinned ? `/${pinned}` : ''}`, label: p.title, route: `${p.id}/${pinned || shown(p)}`, state: s,
      ...(kind === 'exploration' && p.from?.variant ? { on: numberOf(p.from.variant) } : {}),
      ...(kind === 'screen' && !p.picked && !pinned ? { standIn: true } : {}),
      children: [...options, ...below],
    }
  }

  const onScreen = new Set<string>()
  const nodes: TreeNode[] = []
  for (const d of designs) {
    const flows = d.flows.map(f => {
      // A screen is a slug (it shows its pick) or slug/letter (pinned, in a second design from it).
      const screens = f.screens.map(x => { const [slug, pin = ''] = x.split('/'); return { p: byId.get(slug), pin } })
        .filter((x): x is { p: Proto; pin: string } => !!x.p && (!x.pin || x.p.variants.some(v => v.id === x.pin)))
        .map(({ p, pin }) => { onScreen.add(p.id); return explore(p, 'screen', pin) }).filter((n): n is TreeNode => !!n)
      return screens.length ? { kind: 'flow' as const, key: `flow:${d.id}:${f.name}`, label: f.name, count: screens.length, children: screens } : null
    }).filter((n): n is NonNullable<typeof n> => !!n)
    if (flows.length) nodes.push({ kind: 'design', key: `design:${d.id}`, label: d.title, count: flows.reduce((n, f) => n + f.children.length, 0), children: flows })
  }
  // Roots that are no screen, newest first. A root's parent chain is broken or it has none.
  const roots = live.filter(p => !onScreen.has(p.id) && !parentOf(p, byId)).sort((a, b) => b.created.localeCompare(a.created))
  // A root goes to the shelf with everything built on it, when all of it is decided or was seen and
  // left, nothing needs anyone, and it sat untouched long enough. A hand on it beats all of that.
  const chainOf = (p: Proto): Proto[] => [p, ...(kids.get(p.id) ?? []).flatMap(chainOf)]
  const rests = (p: Proto) => {
    const s = o.settle
    if (!s || o.filter === 'open' || o.filter === 'favs') return false
    const chain = chainOf(p), hand = s.aside(p.id)
    if (chain.some(x => state(x) === 'building') || hand === 'active') return false
    if (hand === 'settled') return true
    return !chain.some(x => s.keep(x.id) || state(x) === 'stale')
      && chain.every(x => x.picked || x.variants.every(v => s.seen(`${x.id}/${v.id}`, x)))
      && chain.every(x => s.now - s.touched(x) >= SETTLE_AFTER)
  }
  const resting = new Set(roots.filter(rests).flatMap(chainOf).map(p => p.id))
  const draw = (list: Proto[]) => list.map(p => explore(p, 'exploration')).filter((n): n is TreeNode => !!n)
  const loose = draw(roots.filter(p => !resting.has(p.id)))
  if (loose.length) nodes.push({ kind: 'section', key: 'section:loose', label: 'Explorations on no screen', children: loose })
  const archived = protos.filter(p => p.archived)
  if (o.filter === 'all' && archived.length) nodes.push({ kind: 'section', key: 'section:archive', label: 'Archive', count: archived.length, children: archived.map(p => ({ kind: 'exploration', key: `exp:${p.id}`, label: p.title, route: `${p.id}/${shown(p)}`, children: [] })) })
  const needs = live.filter(p => !resting.has(p.id) && ['open', 'stale'].includes(state(p)))
  // What waits on the user, for the group above the tree: under "this conversation", only its own.
  // route: where its row in the tree goes (a screen opens the variant it shows, an exploration its page).
  const waits = o.filter === 'favs' || o.filter === 'open' ? [] : needs.filter(mine).map(p => ({ p, state: state(p) as 'open' | 'stale', route: onScreen.has(p.id) ? `${p.id}/${shown(p)}` : p.id }))
  return { nodes, settled: draw(roots.filter(p => resting.has(p.id))), waiting: needs.length, waits }
}
