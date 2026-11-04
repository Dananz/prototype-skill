// The variants chosen in the tree, by route (slug/letter), for acting on several at once. Rows, the
// bar at the sidebar's foot and the shell's menu and keys all read this one list.
let chosen: string[] = [], anchor = ''
const watchers = new Set<() => void>()
const set = (next: string[]) => { chosen = next; if (!next.length) anchor = ''; for (const fn of watchers) fn() }

export const selection = {
  subscribe(fn: () => void) { watchers.add(fn); return () => { watchers.delete(fn) } },
  get: () => chosen,
  has: (route: string) => chosen.includes(route),
  /** here: the variant on screen, which comes along when this starts a selection. */
  toggle(route: string, here = '') { const had = chosen.includes(route), base = !chosen.length && here && here !== route ? [here] : chosen; anchor = route; set(had ? chosen.filter(r => r !== route) : [...base, route]) },
  /** Adds everything between the last row chosen (or `from`, without one) and this row, in `order`. */
  extend(route: string, order: string[], from = '') {
    const start = order.indexOf(anchor || from), end = order.indexOf(route)
    const span = start < 0 || end < 0 ? [route] : order.slice(Math.min(start, end), Math.max(start, end) + 1)
    if (!anchor) anchor = start < 0 ? route : order[start]
    set([...new Set([...chosen, ...span])])
  },
  clear() { if (chosen.length) set([]) },
  /** Lets go of what no longer exists. */
  keep(ok: (route: string) => boolean) { if (chosen.some(r => !ok(r))) set(chosen.filter(ok)) },
}
