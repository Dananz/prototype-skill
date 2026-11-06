// The variants chosen in the tree, by route (slug/letter), for acting on several at once. Rows, the
// bar at the sidebar's foot and the shell's menu and keys all read this one list.
// A Shift-click replaces the run it made last (from the anchor to that row), so it shrinks as well as grows;
// base is what was chosen before that run.
let chosen: string[] = [], anchor = '', base: string[] = []
const watchers = new Set<() => void>()
const set = (next: string[]) => { chosen = next; if (!next.length) { anchor = ''; base = [] } for (const fn of watchers) fn() }

export const selection = {
  subscribe(fn: () => void) { watchers.add(fn); return () => { watchers.delete(fn) } },
  get: () => chosen,
  has: (route: string) => chosen.includes(route),
  /** here: the variant on screen, which comes along when this starts a selection. */
  toggle(route: string, here = '') { const had = chosen.includes(route), from = !chosen.length && here && here !== route ? [here] : chosen; anchor = route; const next = had ? chosen.filter(r => r !== route) : [...from, route]; base = next; set(next) },
  /** Chooses everything between the anchor (or `from`, without one) and this row, in `order`, in place of the last run. */
  extend(route: string, order: string[], from = '') {
    const start = order.indexOf(anchor || from), end = order.indexOf(route)
    const span = start < 0 || end < 0 ? [route] : order.slice(Math.min(start, end), Math.max(start, end) + 1)
    if (!anchor) { anchor = start < 0 ? route : order[start]; base = chosen }
    set([...new Set([...base, ...span])])
  },
  clear() { if (chosen.length) set([]) },
  /** Lets go of what no longer exists. */
  keep(ok: (route: string) => boolean) { base = base.filter(ok); if (chosen.some(r => !ok(r))) set(chosen.filter(ok)) },
}
