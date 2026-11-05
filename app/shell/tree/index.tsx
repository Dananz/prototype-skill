// The project tree as the sidebar (design #1 of its prototype): designs › flows › screens, each
// screen's options and the explorations built on them, then explorations on no screen. With
// Conversation first on, the page's scope cuts it (this conversation, the whole project, starred);
// off, four filters do (everything, still open, from this conversation, starred). The shell hands it what it needs through
// an api and tells it when that changed; picking inline and the island's modes come later.
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'
import type { Design, Proto } from '../shell'
import { rtl, t, tn } from '../i18n'
import { numberOf } from '../variants'
import { treeOf, type Filter, type TreeNode } from './model'
import { Caret, Collapse, Inside, Mark, Ph, Row } from './row'
import { memory } from './memory'
import { selection } from './selection'
import { Near } from '../near'

export type TreeInput = {
  protos: Proto[]; designs: Design[]
  /** The route on screen (slug/letter), or '' on an overview. */
  place: string
  /** This conversation ('' or null where there is none, as a share's viewer). */
  me: string | null
  /** Conversation first: the page's scope replaces the tree's own filters. */
  conv?: boolean
  /** What the page shows (shell.ts scope): 'all', 'favs' or 'conv:<conversation>'. */
  scope?: string
  /** The scoped conversation's name, when it isn't this one. */
  scopeName?: string
  building: Set<string>
  /** The open variant's states and tools for the sidebar's foot; null without any. */
  dock: { html: string; title: string; count: number; total: number; at: number; state: string } | null
  /** The variant being worked on, as the old sidebar's strip says it ('' when none). */
  work: string
  /** "Live · edited 2 min ago". */
  live: string
  /** The server is up, for the mark's dot. */
  up: boolean
  /** Open comments per slug. */
  counts: Record<string, number>
  /** The prototype the agent is on ('' when none). */
  workSlug?: string
  /** When each variant was last edited, known to the server since it started. */
  edits?: Record<string, number>
}
export type TreeApi = { get(): TreeInput; subscribe(fn: () => void): () => void; go(route: string): void; goWork(): void; hide(): void; name: string
  /** Scopes the page: this conversation, another ('conv:<id>'), the whole project ('all') or favorites ('favs'). */
  setScope?(scope: string): void
  /** Goes to the page of a design's or a flow's first screen (its tree key), that card open in the gallery. */
  frame(key: string): void
  /** Copies the chosen variants, one a line: their links, or their ids (slug/number). */
  copyChosen(what: 'links' | 'ids', routes: string[]): void
  /** Stars them all, or takes the star off when they all have it. */
  favChosen(routes: string[]): void
  /** Whether a variant is starred. */
  isFav(route: string): boolean }

const FILTERS: [Filter, () => string][] = [['all', () => t('All')], ['open', () => t('Open')], ['mine', () => t('This conversation')], ['favs', () => t('Favorites')]]
const SECTION: Record<string, () => string> = { 'section:loose': () => t('Explorations on no screen') }
/** A tree with more rows than this draws only the explorations near the view. */
const WINDOW_ROWS = 120, ROW_H = 32
const pickedOf = (n: TreeNode) => n.children.find(c => c.kind === 'option' && c.picked)?.route
const HOVER = 'hover:bg-zinc-900/[.04] dark:hover:bg-white/[.06]'
const LIT = 'bg-sky-50 text-sky-900 dark:bg-sky-950/60 dark:text-sky-100'
/** Designs, flows, sections and what still waits on the user start open; the rest starts folded. */
const opensByDefault = (n: TreeNode) => ['design', 'flow', 'section'].includes(n.kind) || (n.kind === 'exploration' && ['open', 'stale', 'building'].includes(n.state ?? ''))
/** Where the open screen is; a pin, since a dot on these rows means new. */
const Here = () => <span title={t('The open screen is here')} aria-label={t('The open screen is here')} data-tree-here className="shrink-0"><Ph name="mapPin" className="size-3.5 text-sky-500" /></span>

/** Marks the chosen rows that touch one above or below them at the same indent, so they draw as one shape. */
function joinChosen(root: Element) {
  for (const r of root.querySelectorAll('[data-tree-join]')) r.removeAttribute('data-tree-join')
  const rows = [...root.querySelectorAll<HTMLElement>('[data-tree-chosen]')].map(el => ({ el, box: el.getBoundingClientRect(), join: [] as string[] }))
  rows.forEach((b, i) => {
    const a = rows[i - 1]
    if (a && Math.abs(a.box.bottom - b.box.top) < 1.5 && Math.abs(a.box.left - b.box.left) < 1.5 && Math.abs(a.box.right - b.box.right) < 1.5) { a.join.push('bottom'); b.join.push('top') }
  })
  for (const r of rows) if (r.join.length) r.el.dataset.treeJoin = r.join.join(' ')
}

/** What to do with the rows chosen, while there are any. At the sidebar's foot; on top in the phone's sheet, whose foot starts below the screen. */
function ChosenBar({ api, routes, top }: { api: TreeApi; routes: string[]; top?: boolean }) {
  const [copied, setCopied] = useState<'links' | 'ids' | null>(null)
  const timer = useRef(0)
  useEffect(() => () => clearTimeout(timer.current), [])
  const copy = (what: 'links' | 'ids') => { api.copyChosen(what, routes); setCopied(what); clearTimeout(timer.current); timer.current = window.setTimeout(() => setCopied(null), 1600) }
  const starred = routes.every(api.isFav)
  const btn = 'grid size-8 shrink-0 place-items-center rounded-md text-zinc-500 hover:bg-zinc-900/[.06] hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-white [@media(pointer:coarse)]:size-10'
  const tool = (act: string, label: string, icon: React.ReactNode, run: () => void) => <button type="button" data-tree-chosen-act={act} aria-label={label} title={label} onClick={run} className={btn}>{icon}</button>
  return (
    <section data-tree-chosen-bar aria-label={t('Selected rows')} className={'flex shrink-0 items-center gap-0.5 border-black/[.06] py-1 pe-1.5 ps-3 text-[12px] dark:border-white/10 ' + (top ? 'border-b' : 'border-t')}>
      <span role="status" className="min-w-0 flex-1 truncate font-medium">{copied ? t('Copied') : tn(routes.length, '1 selected', '{n} selected')}</span>
      {tool('links', t('Copy links'), <Ph name={copied === 'links' ? 'check' : 'linkSimple'} className="size-4" />, () => copy('links'))}
      {tool('ids', t('Copy IDs'), <Ph name={copied === 'ids' ? 'check' : 'hash'} className="size-4" />, () => copy('ids'))}
      {tool('fav', starred ? t('Unfavorite') : t('Favorite'), <Ph name={starred ? 'starFill' : 'star'} className={'size-4 ' + (starred ? 'text-amber-400' : '')} />, () => api.favChosen(routes))}
      {tool('clear', t('Clear selection'), <Ph name="x" className="size-4" />, selection.clear)}
    </section>
  )
}

/** The foot's shelf: what is finished or was left alone, with the archive inside it. It stays shut
 *  (kept in this browser) except for the one thing it can't hide: what is on screen. */
function Shelf({ nodes, archive, slug, draw, go }: { nodes: TreeNode[]; archive: TreeNode | undefined; slug: string; draw(n: TreeNode): React.ReactNode; go(route: string): void }) {
  const [open, setOpen] = useState(() => { try { return localStorage.getItem('proto-tree-shelf') === '1' } catch { return false } })
  const [arch, setArch] = useState(false)
  const flip = () => { const next = !open; setOpen(next); try { localStorage.setItem('proto-tree-shelf', next ? '1' : '0') } catch { /* private window */ } }
  const holds = (n: TreeNode): boolean => (!!n.route && n.route.split('/')[0] === slug) || n.children.some(holds)
  const here = nodes.find(holds)
  const held = !!(here || (archive?.children.some(holds)))
  return (
    <section data-tree-shelf aria-label={t('Settled')} className="shrink-0 border-t border-black/[.06] text-[12px] dark:border-white/10">
      <div className="mx-1.5 flex items-center gap-1.5 py-0.5 pe-2" style={{ paddingInlineStart: 2 }}>
        <Caret open={open} onFlip={flip} label={open ? t('Collapse {name}', { name: t('Settled') }) : t('Expand {name}', { name: t('Settled') })} />
        <button type="button" data-tree-shelf-head onClick={flip} className="flex min-w-0 flex-1 items-center gap-1.5 py-1.5 text-start font-medium text-zinc-500 hover:text-zinc-900 dark:hover:text-white"><Ph name="tray" className="size-3.5" />{t('Settled')}</button>
        {held && !open && <Here />}
        <span className="tabular-nums text-zinc-400 dark:text-zinc-500">{nodes.length}</span>
      </div>
      {!open && here && <div className="pb-1 text-zinc-500">{draw(here)}</div>}
      <Collapse open={open}>
        <div className="max-h-56 overflow-y-auto overscroll-contain pb-1.5"><Inside>
          <div className="text-zinc-500">{nodes.map(draw)}</div>
          {archive && (
            <>
              <div className="mx-1.5 mt-1 flex items-center gap-1.5 pe-2" style={{ paddingInlineStart: 2 }}>
                <Caret open={arch} onFlip={() => setArch(!arch)} />
                <button type="button" data-tree-archive onClick={() => setArch(!arch)} className="flex min-w-0 flex-1 items-center gap-1.5 py-1 text-start text-zinc-400 hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300"><Ph name="archive" className="size-3.5" />{t('Archive')}</button>
                <span className="text-[11px] tabular-nums text-zinc-400 dark:text-zinc-600">{archive.children.length}</span>
              </div>
              <Collapse open={arch}><Inside>{archive.children.map(n => <Row key={n.key} id={n.key} depth={0} on={!!n.route && n.route.split('/')[0] === slug} onClick={() => go(n.route!)} mv={n.route} label={<span dir="auto" className="text-zinc-400 dark:text-zinc-600">{n.label}</span>} />)}</Inside></Collapse>
            </>
          )}
        </Inside></div>
      </Collapse>
    </section>
  )
}

/** The sidebar's foot: the open variant's states, in one place however far the tree scrolls. It folds to
 *  one line naming the state showing, and stays folded (kept in this browser). */
function Dock({ dock }: { dock: NonNullable<TreeInput['dock']> }) {
  const [shut, setShut] = useState(() => { try { return localStorage.getItem('proto-tree-dock') === '0' } catch { return false } })
  const flip = () => { const next = !shut; setShut(next); try { localStorage.setItem('proto-tree-dock', next ? '0' : '1') } catch { /* private window */ } }
  // The state showing stays in sight, however it was reached (up and down from anywhere walk the list).
  const list = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => { list.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest' }) }, [dock.html, shut])
  return (
    <section data-tree-dock data-shut={shut || undefined} aria-label={dock.title} className="flex max-h-[45%] shrink-0 flex-col border-t border-black/[.06] text-[13px] dark:border-white/10">
      <button type="button" data-tree-dock-head aria-expanded={!shut} onClick={flip} className="flex h-9 w-full shrink-0 items-center gap-1.5 px-3 text-start text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-white">
        <Ph name={shut ? 'caretRight' : 'caretDown'} className={'size-2.5 ' + (shut && rtl ? '-scale-x-100' : '')} />
        <span dir="auto" className="min-w-0 flex-1 truncate">{dock.title}</span>
        {dock.count > 0 && (shut
          ? <span className="flex min-w-0 items-center gap-1.5"><span dir="auto" className="truncate font-medium text-zinc-900 dark:text-white">{dock.state}</span><span className="shrink-0 tabular-nums text-zinc-400">{dock.at + 1}/{dock.total}</span></span>
          : <span className="shrink-0 tabular-nums">{tn(dock.count, '{n} state', '{n} states')}</span>)}
      </button>
      {!shut && <div ref={list} data-tree-dock-list className="min-h-0 overflow-y-auto overscroll-contain px-1.5 pb-2" dangerouslySetInnerHTML={{ __html: dock.html }} />}
    </section>
  )
}

/** desk: the wide page's sidebar, which also says what each variant has and holds the dock. */
function Tree({ api, desk }: { api: TreeApi; desk?: boolean }) {
  const input = useSyncExternalStore(api.subscribe, api.get)
  // The scope is the page's (shell.ts): the tree and the gallery show the same explorations.
  const scope = input.scope ?? 'all', sid = scope.startsWith('conv:') ? scope.slice('conv:'.length) : null
  // Off, the tree keeps its own filter (kept in this browser).
  const [own, setOwn] = useState<Filter>(() => { try { return (localStorage.getItem('proto-tree-filter') as Filter) || 'all' } catch { return 'all' } })
  const choose = (f: Filter) => { setOwn(f); try { localStorage.setItem('proto-tree-filter', f) } catch { /* private window */ } }
  const filter: Filter = !input.conv ? own : sid ? 'mine' : scope === 'favs' ? 'favs' : 'all'
  const [open, setOpen] = useState<Set<string>>(() => new Set())
  const [shutFavs, setShutFavs] = useState<Set<string>>(() => new Set())
  const list = useRef<HTMLDivElement>(null)
  useSyncExternalStore(memory.subscribe, memory.version)
  const chosen = useSyncExternalStore(selection.subscribe, selection.get)
  // Again once a fold has finished moving the rows.
  const rootEl = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const root = rootEl.current
    if (!root) return
    joinChosen(root)
    if (!chosen.length) return
    const later = setTimeout(() => joinChosen(root), 240)
    return () => clearTimeout(later)
  })
  // Another filter hides rows: nothing it hides should stay chosen. A variant gone is let go of.
  useEffect(() => { selection.clear() }, [filter, sid])
  useEffect(() => { selection.keep(r => { const [slug, letter] = r.split('/'); return !!input.protos.find(p => p.id === slug)?.variants.some(v => v.id === letter) }) }, [input.protos])
  const touched = (p: Proto) => Math.max(Date.parse(p.created) || 0, memory.visitedAt(p.id), ...p.variants.flatMap(v => [input.edits?.[`${p.id}/${v.id}`] ?? 0, ...(p.versions?.[v.id] ?? []).map(x => Date.parse(x.at) || 0)]))
  const { nodes: tree, waiting, settled } = treeOf(input.protos, input.designs, { filter, me: input.conv ? sid : input.me, building: input.building, settle: {
    now: Date.now(), touched, aside: memory.asideOf, seen: (route, p) => memory.isSeen(route, p.created),
    keep: id => id === input.workSlug || (input.counts[id] ?? 0) > 0,
  } })
  const nodes = tree.filter(n => n.key !== 'section:archive'), archive = tree.find(n => n.key === 'section:archive')
  useEffect(() => {
    memory.settled = new Set(settled.map(n => n.route!.split('/')[0]))
    memory.loose = new Set([...memory.settled, ...(tree.find(n => n.key === 'section:loose')?.children ?? []).map(n => n.route!.split('/')[0])])
  })
  const total = input.protos.filter(p => !p.archived).length
  const toggle = (k: string) => { auto.current.delete(k); setOpen(o => { const n = new Set(o); if (n.has(k)) n.delete(k); else n.add(k); return n }) }
  /** What the place opened by itself, not the user: it folds again when the place moves on. */
  const auto = useRef(new Set<string>())

  // The place on screen opens the tree down to its row, which scrolls into view.
  const slug = input.place.split('/')[0]
  useEffect(() => {
    if (!slug) return
    memory.visit(input.place)
    // Its ancestors, opened (a design, flow or section is open while its key is not in the set). Its
    // own row opens too, unless the row already shows what is on screen: its winner.
    const path: TreeNode[] = []
    const walk = (list: TreeNode[], up: TreeNode[]): boolean => list.some(n => {
      if (n.route?.split('/')[0] === slug && n.kind !== 'option') { const showsIt = !input.place.split('/')[1] || pickedOf(n) === input.place; path.push(...up, ...(showsIt ? [] : [n])); return true }
      return walk(n.children, [...up, n])
    })
    walk(nodes, [])
    const keys = new Set(path.map(n => n.key))
    setOpen(o => {
      const next = new Set(o)
      for (const k of auto.current) if (!keys.has(k)) { next.delete(k); auto.current.delete(k) }
      for (const n of path) {
        if (opensByDefault(n)) next.delete(n.key)
        else if (!next.has(n.key)) { next.add(n.key); auto.current.add(n.key) }
      }
      return [...next].length === o.size && [...next].every(k => o.has(k)) ? o : next
    })
    requestAnimationFrame(() => list.current?.querySelector('[data-on="true"]')?.scrollIntoView({ block: 'nearest' }))
    // nodes change with every edit; the place is what moves the tree.
  }, [input.place]) // eslint-disable-line react-hooks/exhaustive-deps

  // Designs, flows, sections and undecided explorations start open; the rest starts closed.
  // Under Favorites everything kept starts open, to show the starred options; what is closed there is its own.
  const isOpen = (n: TreeNode) => filter === 'favs' ? !shutFavs.has(n.key) : opensByDefault(n) ? !open.has(n.key) : open.has(n.key)
  const flip = (n: TreeNode) => filter === 'favs' ? setShutFavs(o => { const s = new Set(o); if (s.has(n.key)) s.delete(n.key); else s.add(n.key); return s }) : toggle(n.key)

  const shownRows = (n: TreeNode): number => 1 + (n.children.length && isOpen(n) ? n.children.reduce((sum, c) => sum + shownRows(c), 0) : 0)
  const windowed = nodes.reduce((sum, n) => sum + shownRows(n), 0) > WINDOW_ROWS
  const holdsPlace = (n: TreeNode): boolean => (!!n.route && n.route.split('/')[0] === slug) || n.children.some(holdsPlace)
  // The first screenfuls are drawn from the first render, so a long tree never opens empty.
  let firstRows = 60
  // Every level folds alike, so the depth is in the nesting (Inside), not in the padding.
  const foldable = (list: TreeNode[]): TreeNode[] => list.flatMap(n => [...(n.kind === 'option' || n.kind === 'section' || !n.children.length ? [] : [n]), ...foldable(n.children)])
  const anyOpen = () => foldable(nodes).some(isOpen)
  const foldAll = () => { const shut = anyOpen(); auto.current.clear(); setOpen(o => { const next = new Set(o); for (const n of foldable(nodes)) { if (opensByDefault(n) === shut) next.add(n.key); else next.delete(n.key) } return next }) }
  const FoldAll = () => filter === 'favs' ? null : (
    <button type="button" data-tree-fold-all onClick={foldAll} aria-label={anyOpen() ? t('Fold everything') : t('Open everything')} title={anyOpen() ? t('Fold everything') : t('Open everything')}
      className="grid size-7 shrink-0 place-items-center rounded-md text-zinc-400 hover:bg-zinc-900/[.06] hover:text-zinc-700 dark:text-zinc-500 dark:hover:bg-white/10 dark:hover:text-zinc-200 [@media(pointer:coarse)]:size-9"><Ph name={anyOpen() ? 'foldAll' : 'openAll'} className="size-3.5" /></button>
  )
  const favOf = (route: string) => input.protos.find(p => p.id === route.split('/')[0])?.favorites.includes(route.split('/')[1])
  const statesOf = (route: string) => { const letter = route.split('/')[1]; return desk ? (input.protos.find(p => p.id === route.split('/')[0])?.states.filter(s => !s.only?.length || s.only.includes(letter)).length ?? 0) : 0 }
  const protoOf = (n: TreeNode) => input.protos.find(p => p.id === n.route!.split('/')[0])
  const isNew = (route: string) => { const p = input.protos.find(x => x.id === route.split('/')[0]); return !!p && !memory.isSeen(route, p.created) }
  const optionEnd = (n: TreeNode) => {
    const states = statesOf(n.route!)
    return <>{n.became ? <span className="shrink-0 truncate text-[11px] text-indigo-500" dir="auto">{t('became {name}', { name: n.became })}</span> : null}
      {states > 0 && <span data-tree-states={states} title={tn(states, '{n} state', '{n} states')} className="shrink-0 text-[11px] tabular-nums text-zinc-400">{states}</span>}</>
  }
  /** tone: picked (the plain row, under Favorites), passed (grey, a step back), candidate (undecided: new or seen). */
  const option = (n: TreeNode, tone: 'picked' | 'passed' | 'candidate') => {
    const num = numberOf(n.route!.split('/')[1]), on = n.route === input.place
    const seen = tone === 'candidate' && !isNew(n.route!), fresh = tone === 'candidate' && !seen
    const faint = !on && (tone === 'passed' || seen)
    return (
      <Row key={n.key} id={n.key} depth={0} on={on} onClick={() => api.go(n.route!)} mv={n.route}
        icon={<span className={'grid size-4 shrink-0 place-items-center rounded text-[10px] font-semibold tabular-nums ' + (n.picked ? 'bg-emerald-500 text-white' : 'bg-zinc-900/[.06] text-zinc-500 dark:bg-white/10 dark:text-zinc-400 ') + (faint ? 'opacity-60' : '')}>{num}</span>}
        label={<span className="flex min-w-0 items-center gap-1"><span dir="auto" className={'truncate ' + (faint ? 'text-zinc-500' : fresh ? 'font-medium' : '')}>{n.label}</span>{favOf(n.route!) && <Ph name="starFill" className="size-3 shrink-0 text-amber-400" />}</span>}
        end={<>{optionEnd(n)}
          {tone === 'picked' && n.picked && !n.became && <span className="shrink-0 text-[11px] text-emerald-600 dark:text-emerald-400">{t('Picked')}</span>}
          {fresh && <span data-tree-new className="flex shrink-0 items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400"><span className="size-1.5 rounded-full bg-amber-500" />{t('New')}</span>}
          {seen && <span title={t('Seen')} data-tree-seen><Ph name="eye" className="size-3.5 text-zinc-300 dark:text-zinc-600" /></span>}</>} />
    )
  }
  const draw = (n: TreeNode, inside = false): React.ReactNode => {
    const here = !!n.route && n.kind !== 'option' && n.route.split('/')[0] === slug
    const lit = n.kind === 'option' ? n.route === input.place : here && !n.children.some(c => c.kind === 'option' && c.route === input.place)
    const shut = n.children.length ? isOpen(n) : undefined
    const kids = (nest = inside) => <Collapse open={!!shut}><Inside>{n.children.map(c => draw(c, nest))}</Inside></Collapse>
    if (n.kind === 'design') return (
      <div key={n.key}>
        <Row id={n.key} depth={0} strong open={shut} onCaret={() => flip(n)} onClick={() => api.frame(n.key)} count={n.count}
          icon={<span className="size-2.5 shrink-0 rounded-full bg-indigo-500" />} label={<span dir="auto">{n.label}</span>} end={nodes[0] === n ? <FoldAll /> : null} />
        {kids()}
      </div>
    )
    // A design or a flow: its caret folds it here, its name goes to its first screen's page (/slug).
    if (n.kind === 'flow') return <div key={n.key}><Row id={n.key} depth={0} medium open={shut} onCaret={() => flip(n)} onClick={() => api.frame(n.key)} count={n.count} label={<span dir="auto">{n.label}</span>} />{kids()}</div>
    if (n.kind === 'section') return (
      <div key={n.key}>
        <div className="mx-1.5 mt-1 flex items-center gap-1.5 pe-1.5" style={{ paddingInlineStart: 2 }}>
          <Caret open={!!shut} onFlip={() => flip(n)} />
          <button type="button" onClick={() => flip(n)} className="flex min-w-0 flex-1 items-center gap-1.5 py-1 text-start text-[11px] font-medium text-zinc-400 hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300">
            <Ph name="squaresFour" className="size-3.5" /><span className="truncate">{SECTION[n.key]()}</span>{n.count != null && ` · ${n.count}`}
          </button>
          {nodes[0] === n && <FoldAll />}
        </div>
        <Collapse open={!!shut}>{n.children.map(c => draw(c, inside))}</Collapse>
      </div>
    )
    if (n.kind === 'option') return option(n, n.picked ? 'picked' : 'candidate')
    const picked = pickedOf(n)
    const comments = input.counts[n.route!.split('/')[0]] ?? 0
    const parent = n.kind === 'exploration' && n.on ? n : null
    const options = n.children.filter(c => c.kind === 'option'), below = n.children.filter(c => c.kind !== 'option')
    const winner = options.find(c => c.picked), passed = options.filter(c => !c.picked)
    const title = <span dir="auto">{n.label}</span>
    const working = !!input.workSlug && (n.route!.split('/')[0] === input.workSlug || (!shut && JSON.stringify(n).includes(`"route":"${input.workSlug}/`)))
    const pulse = working && <span title={t('The agent is working on this')} data-tree-working className="size-1.5 shrink-0 animate-pulse rounded-full bg-emerald-500" />
    const comment = comments > 0 && <span title={t('Open comments')} className="flex shrink-0 items-center gap-0.5 text-[11px] tabular-nums text-zinc-500 dark:text-zinc-300"><Ph name="chatCircle" className="size-3.5" />{comments}</span>
    const icon = n.kind === 'screen' ? <Ph name="browser" className="size-3.5 text-sky-500" /> : <Ph name="shuffle" className={'size-3.5 ' + (n.state === 'waits' ? 'text-zinc-300' : n.state === 'open' ? 'text-amber-500' : 'text-violet-500')} />
    const page = () => api.go(n.kind === 'exploration' ? n.route!.split('/')[0] : n.route!)
    const block = () => {
      // Decided: one block, its name above its winner. Folded it says what it holds; open, what was
      // built on it comes first and the options passed on stay behind one more row.
      if (winner && filter !== 'favs') {
        const onIt = winner.route === input.place || lit, hidden = !shut && !onIt && holdsPlace(n)
        return (
          <>
            <div data-tree-decided className={'mx-1.5 rounded-lg ' + (onIt ? LIT : HOVER)}>
              <Row flat id={n.key} depth={0} on={lit} open={shut} onCaret={() => flip(n)} onClick={page} stands={winner.route} strong={!parent && !!below.length} medium={!parent && !below.length} icon={icon}
                label={<span className={parent ? 'font-medium dark:text-zinc-200' : ''}>{title}{parent && <span className="text-[11px] font-normal text-zinc-400"> · {t('on #{n}', { n: parent.on! })}</span>}</span>}
                end={<span className="flex shrink-0 items-center gap-2 text-[11px] tabular-nums text-zinc-400">{pulse}{comment}{hidden && <Here />}
                  {!shut && !!below.length && <span title={tn(below.length, '{n} exploration built on this', '{n} explorations built on this')} className="flex items-center gap-0.5"><Ph name="gitBranch" className="size-3.5" />{below.length}</span>}
                  {!shut && !!passed.length && <span title={tn(passed.length, '{n} more option', '{n} more options')} className="flex items-center gap-0.5"><Ph name="rows" className="size-3.5" />{passed.length}</span>}</span>} />
              <Row flat slim id={winner.key} depth={0} on={winner.route === input.place} onClick={() => api.go(winner.route!)} mv={winner.route}
                icon={<Mark state="done" picked={numberOf(winner.route!.split('/')[1])} />}
                label={<span className="flex min-w-0 items-center gap-1 text-[12px] text-zinc-500 dark:text-zinc-400"><span dir="auto" className="truncate">{winner.label}</span>{favOf(winner.route!) && <Ph name="starFill" className="size-3 shrink-0 text-amber-400" />}</span>}
                end={optionEnd(winner)} />
            </div>
            <Collapse open={!!shut}><Inside>
              {below.map(c => draw(c, inside || windowed))}
              {below.length > 0 && passed.length > 0 ? <PassedRows n={n} hold={passed.some(c => c.route === input.place)}>{passed.map(c => option(c, 'passed'))}</PassedRows> : passed.map(c => option(c, 'passed'))}
            </Inside></Collapse>
          </>
        )
      }
      const fresh = passed.filter(c => isNew(c.route!)).length
      return (
        <>
          <Row id={n.key} depth={0} on={lit} open={shut} onCaret={() => flip(n)} mv={n.route}
            /* An exploration's name goes to its own page (/slug), its card open in the gallery; a screen's opens it. */
            onClick={() => { if (!shut) flip(n); page() }}
            icon={icon}
            label={<span className={n.state === 'waits' ? 'text-zinc-400' : n.state === 'open' ? 'font-medium' : ''}>{title}{parent && <span className="text-[11px] font-normal text-zinc-400"> · {t('on #{n}', { n: parent.on! })}</span>}</span>}
            end={<span className="flex shrink-0 items-center gap-1.5">
              {pulse}
              {n.standIn && <span title={t('#1 stands in until one is picked')} className="rounded bg-zinc-900/[.05] px-1 text-[10px] text-zinc-500 dark:bg-white/10">{t('not picked')}</span>}
              {comment}
              {!shut && !lit && holdsPlace(n) && <Here />}
              {n.state === 'open' && n.kind === 'exploration' && !comments && <span data-mark="open" title={t('Waiting for your pick')} className="shrink-0 text-[11px] text-amber-600 dark:text-amber-400">{fresh ? tn(fresh, '{n} new', '{n} new') : t('Waiting for you')}</span>}
              {n.state && n.state !== 'open' && <Mark state={n.state} picked={picked ? numberOf(picked.split('/')[1]) : undefined} />}
            </span>} />
          <Collapse open={!!shut}><Inside>
            {n.state === 'stale' && <StaleNote n={n} protos={input.protos} />}
            {options.map(c => option(c, c.picked ? 'picked' : 'candidate'))}
            {below.map(c => draw(c, inside || windowed))}
          </Inside></Collapse>
        </>
      )
    }
    return windowed && !inside
      ? <Near key={n.key} estimate={shownRows(n) * ROW_H} scroller={() => list.current} force={holdsPlace(n)} start={(firstRows -= shownRows(n)) + shownRows(n) > 0}>{block}</Near>
      : <div key={n.key}>{block()}</div>
  }
  /** A shelf row: one quiet line, its pick or that none was made. What was built on it opens under it. */
  const shelved = (n: TreeNode): React.ReactNode => {
    const options = n.children.filter(c => c.kind === 'option'), below = n.children.filter(c => c.kind !== 'option')
    const winner = options.find(c => c.picked), here = !!n.route && n.route.split('/')[0] === slug
    const shut = !!isOpen(n)
    return (
      <div key={n.key}>
        <Row id={n.key} depth={0} on={here} open={below.length ? shut : undefined} onCaret={() => flip(n)} onClick={() => api.go(n.route!)} mv={n.route}
          label={<span dir="auto" className="text-[12px]">{n.label}</span>}
          end={winner ? <span className="opacity-60"><Mark state="done" picked={numberOf(winner.route!.split('/')[1])} /></span>
            : <span className="flex shrink-0 items-center gap-1 text-[11px] text-zinc-400 dark:text-zinc-600"><Ph name="eyeSlash" className="size-3.5" />{t('Not picked')}</span>} />
        {below.length > 0 && <Collapse open={shut}><Inside>{below.map(shelved)}</Inside></Collapse>}
      </div>
    )
  }

  return (
    <div ref={rootEl} data-tree-root className="flex h-full min-h-0 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2.5 px-3">
        <button type="button" data-act="settings:session" data-tree-session aria-haspopup="dialog" title={t('Session settings')} className="-ms-1 flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-1 py-1 text-start hover:bg-zinc-900/5 dark:hover:bg-white/10">
          <span className="relative grid size-7 shrink-0 place-items-center rounded-lg bg-zinc-900 text-[13px] font-bold text-white dark:bg-white dark:text-zinc-900">{(api.name[0] || 'P').toUpperCase()}
            <span data-tree-live={input.up ? 'on' : 'off'} className={'absolute -end-1 -top-1 size-2.5 rounded-full ring-2 ring-white dark:ring-zinc-950 ' + (input.up ? 'bg-emerald-500' : 'bg-zinc-400')} /></span>
          <span className="min-w-0 truncate text-[15px] font-semibold" dir="auto">{api.name}</span>
        </button>
        <button type="button" onClick={api.hide} aria-label={t('Hide sidebar')} title={t('Hide sidebar · ⌘\\')} className="grid size-8 place-items-center rounded-lg text-zinc-500 hover:bg-zinc-900/5 dark:hover:bg-white/10"><Ph name="sidebar" className="size-[17px]" /></button>
      </div>
      {input.work && (
        <button type="button" data-tree-work onClick={api.goWork} className="mx-2 mb-1 flex min-w-0 items-center gap-2 rounded-lg bg-emerald-500/10 px-2 py-1.5 text-start text-[12px] text-emerald-800 dark:text-emerald-200">
          <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-emerald-500" /><span className="truncate" dir="auto">{input.work}</span>
        </button>
      )}
      {!input.conv && (
        <div data-tree-filters className="mx-2 mb-1 mt-1 flex rounded-lg bg-zinc-900/[.05] p-0.5 text-[12px] dark:bg-white/[.06]">
          {FILTERS.map(([k, label]) => (
            <button key={k} type="button" data-tree-filter={k} aria-pressed={filter === k} onClick={() => choose(k)} {...k === 'favs' ? { 'aria-label': label(), title: label() } : {}}
              className={'h-7 min-w-0 truncate rounded-md px-1 ' + (k === 'favs' ? 'grid w-8 shrink-0 place-items-center ' : 'flex-1 ') + (filter === k ? 'bg-white font-medium shadow-sm dark:bg-zinc-700' : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200')}>
              {k === 'favs' ? <Ph name="starFill" className={'size-3.5 ' + (filter === k ? 'text-amber-500' : '')} /> : k === 'open' ? `${label()} · ${waiting}` : label()}
            </button>
          ))}
        </div>
      )}
      {/* The page's scope: this conversation (or the one opened from the past), the whole project, favorites. */}
      {input.conv && <div data-tree-scope role="radiogroup" aria-label={t('Show')} className="mx-2 mb-1 mt-1 flex rounded-lg bg-zinc-900/[.05] p-0.5 text-[12px] dark:bg-white/[.06]">
        {([
          ...(input.me || sid ? [['conv', sid && sid !== input.me ? (input.scopeName || t('A past conversation')) : t('This conversation')] as const] : []),
          ['all', `${t('Whole project')} · ${total}`] as const,
          ['favs', t('Favorites')] as const,
        ]).map(([k, label]) => {
          const on = k === 'conv' ? !!sid : scope === k
          return (
            <button key={k} type="button" role="radio" data-tree-filter={k} aria-checked={on} onClick={() => api.setScope?.(k === 'conv' ? `conv:${input.me || sid}` : k)} {...k === 'favs' ? { 'aria-label': label, title: label } : { title: label }}
              className={'h-7 min-w-0 truncate rounded-md px-1.5 ' + (k === 'favs' ? 'grid w-8 shrink-0 place-items-center ' : 'flex-1 ') + (on ? 'bg-white font-medium shadow-sm dark:bg-zinc-700' : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200')}>
              {k === 'favs' ? <Ph name="starFill" className={'size-3.5 ' + (on ? 'text-amber-500' : '')} /> : <span dir="auto">{label}</span>}
            </button>
          )
        })}
      </div>}
      {!desk && chosen.length > 0 && <ChosenBar top api={api} routes={chosen} />}
      <div ref={list} className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-3 pt-1 text-[13px]">
        {nodes.length ? nodes.map(n => draw(n))
          : <p className="px-4 py-6 text-center text-[12px] text-zinc-400">{filter === 'open' ? t('Nothing waits for you') : filter === 'mine' ? t('Nothing from this conversation yet') : filter === 'favs' ? t('No favorites yet') : t('No prototypes yet')}</p>}
      </div>
      {desk && chosen.length > 0 && <ChosenBar api={api} routes={chosen} />}
      {(settled.length > 0 || archive) && <Shelf nodes={settled} archive={archive} slug={slug} draw={shelved} go={api.go} />}
      {desk && input.dock && <Dock dock={input.dock} />}
      <div className="flex h-10 shrink-0 items-center gap-2 border-t border-black/[.06] px-3 text-[12px] text-zinc-500 dark:border-white/10">
        <span className={'size-2 rounded-full ' + (input.up ? 'bg-emerald-500' : 'bg-zinc-400')} /><span className="truncate">{input.live}</span>
      </div>
    </div>
  )
}

/** The options passed on, behind one row, under what was built on a decided exploration. */
function PassedRows({ n, hold, children }: { n: TreeNode; hold: boolean; children: React.ReactNode[] }) {
  const [more, setMore] = useState(false), open = more || hold
  return (
    <>
      <button type="button" data-tree-more={n.key} aria-expanded={open} onClick={() => setMore(!more)} className="mx-1.5 flex h-8 w-[calc(100%-12px)] items-center gap-1.5 rounded-lg px-2 text-start text-[12px] text-zinc-400 hover:bg-zinc-900/[.04] dark:text-zinc-500 dark:hover:bg-white/[.06] [@media(pointer:coarse)]:h-10">
        <span className={'grid place-items-center transition-transform duration-200 ease-out motion-reduce:transition-none ' + (open ? '' : 'ltr:-rotate-90 rtl:rotate-90')}><Ph name="caretDown" className="size-2.5" /></span>
        <Ph name="rows" className="size-3.5" />{open ? t('Hide') : tn(children.length, '{n} more option', '{n} more options')}
      </button>
      <Collapse open={open}>{children}</Collapse>
    </>
  )
}

/** A stale exploration, open: which option it was built on and which one is picked now. */
function StaleNote({ n, protos }: { n: TreeNode; protos: Proto[] }) {
  const p = protos.find(x => `exp:${x.id}` === n.key), parent = p?.from && protos.find(x => x.id === p.from!.proto)
  if (!p?.from || !parent?.picked) return null
  return (
    <div className="mb-1 rounded-lg bg-rose-50 px-2 py-1.5 text-[12px] text-rose-800 dark:bg-rose-950/50 dark:text-rose-200" style={{ marginInlineStart: 8, marginInlineEnd: 8 }}>
      {t('Built on #{was}, and #{now} is picked now', { was: numberOf(p.from.variant), now: numberOf(parent.picked) })}
    </div>
  )
}

/** The tree as a component, for a host that renders it in a root of its own (the phone's tree sheet). */
export function TreeView({ api }: { api: TreeApi }) { return <Tree api={api} /> }

/** Draws the tree into host; the shell calls the api's listeners when anything it reads changed. */
export function mountTree(host: HTMLElement, api: TreeApi) {
  createRoot(host).render(<Tree api={api} desk />)
}
