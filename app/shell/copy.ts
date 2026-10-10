// Copy options: other words for a design's lines, offered when the user asks for other copy. A
// variant declares its lines (src/copy.ts, useCopy): an id, a label, and options whose first is
// the line as it reads today. It shows what this store says for each line, and marks the line's
// element `data-copy="<id>"` so the page's picker (comments/copy.tsx) can find it.
//
// The choices are the page's, not the design's: kept per session and variant ("today/C") by their
// words, so a hot reload (Claude editing the file) keeps them, and every place the variant is
// mounted (the stage, a lobby card) shows the same line. They live in the tab's sessionStorage: a
// reload keeps them, and each tab, so each shot `proto shoot` takes, starts from the design as
// written. A choice Claude has made the line's first option is done, so it goes; so does one whose
// words are no longer among the options. The user's own words stay until they are the first option.

/** One line with options. options[0] is the line as it reads today. */
export type CopyLine = { id: string; label: string; options: string[] }
/** What was chosen for a line: one of its options, or the user's own words. */
export type Choice = { text: string; own?: boolean }

const lines = new Map<Element, CopyLine[]>()
const keys = new Map<Element, string>()
const routes = new WeakMap<Element, string>()
const subs = new Set<() => void>()
let store = ''
let saved: Record<string, Record<string, Choice>> = {}
// A preview while an option is pointed at: shown on that one design only, never kept.
let peeked: { host: Element; id: string; text: string } | null = null
let version = 0

const bump = () => { version++; subs.forEach(f => f()) }
const persist = () => { try { sessionStorage.setItem(store, JSON.stringify(saved)) } catch { /* private mode or full: the choices last until a reload */ } }
// What a variant passes is taken as it comes, so a line without options or a label is skipped.
const clean = (list: unknown): CopyLine[] => (Array.isArray(list) ? list : []).filter(l => l && typeof l.id === 'string' && l.id && Array.isArray(l.options) && l.options.length && l.options.every((o: unknown) => typeof o === 'string'))
  .map(l => ({ id: l.id, label: typeof l.label === 'string' && l.label ? l.label : l.id, options: l.options }))
/** A choice still stands while it differs from the first option and, unless it is the user's own, is one of the options. */
const stands = (line: CopyLine, c?: Choice | null): c is Choice => !!c && typeof c.text === 'string' && !!c.text.trim() && c.text !== line.options[0] && (!!c.own || line.options.includes(c.text))

export const copy = {
  /** Where the choices are kept: one key per session. */
  configure(session: string) {
    store = `proto-copy-${session}`
    try { saved = JSON.parse(sessionStorage.getItem(store) ?? '{}') ?? {} } catch { saved = {} }
    if (typeof saved !== 'object' || Array.isArray(saved)) saved = {}
  },
  /** The variant a host is about to mount ("today/C"), set by the shell before it mounts. */
  bind(host: Element, route: string) { routes.set(host, route) },
  routeOf: (host: Element | null | undefined) => (host && routes.get(host)) || '',

  /** The design mounted in host declares its lines (on every render). Choices the lines no longer
   *  allow are dropped here; a line it doesn't declare right now keeps its choice. */
  set(host: Element, list: CopyLine[]) {
    const next = clean(list), k = JSON.stringify(next)
    const changed = keys.get(host) !== k
    lines.set(host, next)
    keys.set(host, k)
    const route = copy.routeOf(host), mine = saved[route]
    const gone = next.filter(line => mine?.[line.id] && !stands(line, mine[line.id]))
    for (const line of gone) delete mine![line.id]
    if (mine && !Object.keys(mine).length) delete saved[route]
    if (gone.length) persist()
    if (changed || gone.length) bump()
  },
  drop(host: Element) {
    keys.delete(host)
    if (peeked?.host === host) peeked = null
    if (lines.delete(host)) bump()
  },
  of: (host: Element | null | undefined) => (host && lines.get(host)) || [],

  /** What to show for each line: a preview, else the choice, else today's words. Pure, so a design
   *  can call it while it renders, before its lines are declared. */
  texts(host: Element | null | undefined, list: CopyLine[]) {
    const mine = host ? saved[copy.routeOf(host)] : undefined
    const out: Record<string, string> = {}
    for (const line of clean(list)) {
      const c = mine?.[line.id]
      out[line.id] = peeked && peeked.host === host && peeked.id === line.id ? peeked.text : stands(line, c) ? c.text : line.options[0]
    }
    return out
  },
  /** The choice that stands for a line of the design in host, if any. */
  choiceOf(host: Element | null | undefined, id: string): Choice | null {
    const line = copy.of(host).find(l => l.id === id), c = host ? saved[copy.routeOf(host)]?.[id] : undefined
    return line && stands(line, c) ? { text: c.text, ...(c.own ? { own: true } : {}) } : null
  },
  /** Lines of the design in host that read other than today, with what they read. */
  changed: (host: Element | null | undefined) => copy.of(host).flatMap(line => { const c = copy.choiceOf(host, line.id); return c ? [{ line, choice: c }] : [] }),
  /** Choose for a line: an option, the user's own words, or null for today's. */
  choose(host: Element, id: string, choice: Choice | null) {
    const route = copy.routeOf(host), line = copy.of(host).find(l => l.id === id)
    if (!route || !line) return
    const text = choice?.text.trim() ?? ''
    // Own words that match an option are that option.
    const c: Choice = { text, ...(choice?.own && !line.options.includes(text) ? { own: true } : {}) }
    const mine = saved[route] ??= {}
    if (stands(line, c)) mine[id] = c
    else delete mine[id]
    if (!Object.keys(mine).length) delete saved[route]
    persist()
    bump()
  },
  /** Show other words on a line for now (pointing at an option), or stop (null). */
  peek(host: Element, id: string, text: string | null) {
    if (text === null ? !peeked : peeked?.host === host && peeked.id === id && peeked.text === text) return
    peeked = text === null ? null : { host, id, text }
    bump()
  },
  subscribe(f: () => void) { subs.add(f); return () => { subs.delete(f) } },
  /** Bumped on every change: what a design re-renders on. */
  version: () => version,
}
