// The project tree as the sidebar (design #1 of its prototype): designs › flows › screens, each
// screen's options and the explorations built on them, then explorations on no screen. With
// Conversation first on, the page's scope cuts it (this conversation, the whole project, starred);
// off, four filters do (everything, still open, from this conversation, starred). The shell hands it what it needs through
// an api and tells it when that changed; picking inline and the island's modes come later.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'
import type { Design, Proto } from '../shell'
import { rtl, t, tn } from '../i18n'
import { numberOf } from '../variants'
import { treeOf, type Filter, type TreeNode } from './model'
import { Mark, Ph, Row } from './row'
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
}
export type TreeApi = { get(): TreeInput; subscribe(fn: () => void): () => void; go(route: string): void; goWork(): void; hide(): void; name: string
  /** Scopes the page: this conversation, another ('conv:<id>'), the whole project ('all') or favorites ('favs'). */
  setScope?(scope: string): void
  /** Opens a design's, a flow's or an exploration's card in the gallery (its tree key), leaving the screen. */
  frame(key: string): void }

const FILTERS: [Filter, () => string][] = [['all', () => t('All')], ['open', () => t('Open')], ['mine', () => t('This conversation')], ['favs', () => t('Favorites')]]
const SECTION: Record<string, () => string> = { 'section:loose': () => t('Explorations on no screen'), 'section:archive': () => t('Archive') }
/** A tree with more rows than this draws only the explorations near the view. */
const WINDOW_ROWS = 120, ROW_H = 32
const pickedOf = (n: TreeNode) => n.children.find(c => c.kind === 'option' && c.picked)?.route

/** The sidebar's foot: the open variant's states, in one place however far the tree scrolls. It folds to
 *  one line naming the state showing, and stays folded (kept in this browser). */
function Dock({ dock }: { dock: NonNullable<TreeInput['dock']> }) {
  const [shut, setShut] = useState(() => { try { return localStorage.getItem('proto-tree-dock') === '0' } catch { return false } })
  const flip = () => { const next = !shut; setShut(next); try { localStorage.setItem('proto-tree-dock', next ? '0' : '1') } catch { /* private window */ } }
  return (
    <section data-tree-dock data-shut={shut || undefined} aria-label={dock.title} className="flex max-h-[45%] shrink-0 flex-col border-t border-black/[.06] text-[13px] dark:border-white/10">
      <button type="button" data-tree-dock-head aria-expanded={!shut} onClick={flip} className="flex h-9 w-full shrink-0 items-center gap-1.5 px-3 text-start text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-white">
        <Ph name={shut ? 'caretRight' : 'caretDown'} className={'size-2.5 ' + (shut && rtl ? '-scale-x-100' : '')} />
        <span dir="auto" className="min-w-0 flex-1 truncate">{dock.title}</span>
        {dock.count > 0 && (shut
          ? <span className="flex min-w-0 items-center gap-1.5"><span dir="auto" className="truncate font-medium text-zinc-900 dark:text-white">{dock.state}</span><span className="shrink-0 tabular-nums text-zinc-400">{dock.at + 1}/{dock.total}</span></span>
          : <span className="shrink-0 tabular-nums">{tn(dock.count, '{n} state', '{n} states')}</span>)}
      </button>
      {!shut && <div data-tree-dock-list className="min-h-0 overflow-y-auto overscroll-contain px-1.5 pb-2" dangerouslySetInnerHTML={{ __html: dock.html }} />}
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
  const { nodes, waiting } = treeOf(input.protos, input.designs, { filter, me: input.conv ? sid : input.me, building: input.building })
  const total = input.protos.filter(p => !p.archived).length
  const toggle = (k: string) => setOpen(o => { const n = new Set(o); if (n.has(k)) n.delete(k); else n.add(k); return n })

  // The place on screen opens the tree down to its row, which scrolls into view.
  const slug = input.place.split('/')[0]
  useEffect(() => {
    if (!slug) return
    // Its ancestors, opened (a design, flow or section is open while its key is not in the set).
    const path: TreeNode[] = []
    const walk = (list: TreeNode[], up: TreeNode[]): boolean => list.some(n => {
      if (n.route?.split('/')[0] === slug && n.kind !== 'option') { path.push(...up, n); return true }
      return walk(n.children, [...up, n])
    })
    walk(nodes, [])
    const opensByDefault = (n: TreeNode) => ['design', 'flow', 'section'].includes(n.kind) && n.key !== 'section:archive'
    if (path.length) setOpen(o => {
      const next = new Set(o)
      for (const n of path) if (opensByDefault(n)) next.delete(n.key); else next.add(n.key)
      return [...next].length === o.size && [...next].every(k => o.has(k)) ? o : next
    })
    requestAnimationFrame(() => list.current?.querySelector('[data-on="true"]')?.scrollIntoView({ block: 'nearest' }))
    // nodes change with every edit; the place is what moves the tree.
  }, [slug]) // eslint-disable-line react-hooks/exhaustive-deps

  // Designs, flows and sections start open; screens and explorations start closed.
  // Under Favorites everything kept starts open, to show the starred options; what is closed there is its own.
  const isOpen = (n: TreeNode) => filter === 'favs' ? !shutFavs.has(n.key) : ['design', 'flow', 'section'].includes(n.kind) && n.key !== 'section:archive' ? !open.has(n.key) : open.has(n.key)
  const flip = (n: TreeNode) => filter === 'favs' ? setShutFavs(o => { const s = new Set(o); if (s.has(n.key)) s.delete(n.key); else s.add(n.key); return s }) : toggle(n.key)

  const shownRows = (n: TreeNode): number => 1 + (n.children.length && isOpen(n) ? n.children.reduce((sum, c) => sum + shownRows(c), 0) : 0)
  const windowed = nodes.reduce((sum, n) => sum + shownRows(n), 0) > WINDOW_ROWS
  const holdsPlace = (n: TreeNode): boolean => (!!n.route && n.route.split('/')[0] === slug) || n.children.some(holdsPlace)
  // The first screenfuls are drawn from the first render, so a long tree never opens empty.
  let firstRows = 60
  const draw = (n: TreeNode, depth: number, inside = false): React.ReactNode => {
    const here = !!n.route && n.kind !== 'option' && n.route.split('/')[0] === slug
    const lit = n.kind === 'option' ? n.route === input.place : here && !n.children.some(c => c.kind === 'option' && c.route === input.place)
    const shut = n.children.length ? isOpen(n) : undefined
    const kids = () => shut ? n.children.map(c => draw(c, depth + 1, inside)) : null
    if (n.kind === 'design') return (
      <div key={n.key}>
        <Row id={n.key} depth={depth} strong open={shut} onCaret={() => flip(n)} onClick={() => api.frame(n.key)} count={n.count}
          icon={<span className="size-2.5 shrink-0 rounded-full bg-indigo-500" />} label={<span dir="auto">{n.label}</span>} />
        {kids()}
      </div>
    )
    // A design or a flow: its caret folds it here, its name opens its first screen's card in the gallery.
    if (n.kind === 'flow') return <div key={n.key}><Row id={n.key} depth={depth} medium open={shut} onCaret={() => flip(n)} onClick={() => api.frame(n.key)} count={n.count} label={<span dir="auto">{n.label}</span>} />{kids()}</div>
    if (n.kind === 'section') return (
      <div key={n.key}>
        <div className="flex items-center px-3 pb-1 pt-3">
          <button type="button" onClick={() => flip(n)} aria-expanded={!!shut} className="flex items-center gap-1 text-[11px] font-medium text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300">
            {n.key === 'section:archive' && <Ph name="archive" className="size-3" />}{SECTION[n.key]()}{n.count != null && ` · ${n.count}`}
          </button>
        </div>
        {kids()}
      </div>
    )
    if (n.kind === 'option') {
      const letter = n.route!.split('/')[1], num = numberOf(letter)
      const states = desk ? (input.protos.find(p => p.id === n.route!.split('/')[0])?.states.filter(s => !s.only?.length || s.only.includes(letter)).length ?? 0) : 0
      return (
        <Row key={n.key} id={n.key} depth={depth} on={lit} onClick={() => api.go(n.route!)} mv={n.route}
          icon={<span className={'grid size-4 shrink-0 place-items-center rounded text-[10px] font-semibold tabular-nums ' + (n.picked ? 'bg-emerald-500 text-white' : 'bg-zinc-900/[.06] text-zinc-500 dark:bg-white/10')}>{num}</span>}
          label={<span className="flex min-w-0 items-center gap-1"><span dir="auto" className="truncate">{n.label}</span>{input.protos.find(p => p.id === n.route!.split('/')[0])?.favorites.includes(n.route!.split('/')[1]) && <Ph name="starFill" className="size-3 shrink-0 text-amber-400" />}</span>}
          end={<>{n.became ? <span className="shrink-0 truncate text-[11px] text-indigo-500" dir="auto">{t('became {name}', { name: n.became })}</span>
            : n.picked ? <span className="shrink-0 text-[11px] text-emerald-600 dark:text-emerald-400">{t('Picked')}</span> : null}
            {states > 0 && <span data-tree-states={states} title={tn(states, '{n} state', '{n} states')} className="shrink-0 text-[11px] tabular-nums text-zinc-400">{states}</span>}</>} />
      )
    }
    const picked = pickedOf(n)
    const comments = input.counts[n.route!.split('/')[0]] ?? 0
    const parent = n.kind === 'exploration' && n.on ? n : null
    const block = () => (
      <>
        <Row id={n.key} depth={depth} on={lit} open={shut} onCaret={() => flip(n)} mv={n.route}
          /* An exploration's name opens its card in the gallery, with its options; a screen's opens it. */
          onClick={() => { if (!shut) flip(n); if (n.kind === 'exploration') api.frame(`round:${n.route!.split('/')[0]}`); else api.go(n.route!) }}
          icon={n.kind === 'screen' ? <Ph name="browser" className="size-3.5 text-sky-500" /> : <Ph name="shuffle" className={'size-3.5 ' + (n.state === 'waits' ? 'text-zinc-300' : 'text-violet-500')} />}
          label={<span className={n.state === 'waits' ? 'text-zinc-400' : ''}><span dir="auto">{n.label}</span>{parent && <span className="text-[11px] text-zinc-400"> · {t('on #{n}', { n: parent.on! })}</span>}</span>}
          end={<span className="flex shrink-0 items-center gap-1.5">
            {n.standIn && <span title={t('#1 stands in until one is picked')} className="rounded bg-zinc-900/[.05] px-1 text-[10px] text-zinc-500 dark:bg-white/10">{t('not picked')}</span>}
            {comments > 0 && <span title={t('Open comments')} className="rounded-full bg-zinc-900/[.06] px-1.5 text-[10px] font-medium tabular-nums text-zinc-600 dark:bg-white/10 dark:text-zinc-300">{comments}</span>}
            {n.state && !(n.kind === 'screen' && n.state === 'open') && (n.kind === 'exploration' && picked
              ? /* The pick's mark opens the pick. */ <button type="button" data-tree-picked={picked} onClick={() => api.go(picked)} title={t('Open #{n}, the pick', { n: numberOf(picked.split('/')[1]) })} aria-label={t('Open #{n}, the pick', { n: numberOf(picked.split('/')[1]) })}
                  className="-mx-1 rounded-md px-1 py-0.5 hover:bg-zinc-900/[.06] dark:hover:bg-white/10"><Mark state={n.state} picked={numberOf(picked.split('/')[1])} /></button>
              : <Mark state={n.state} picked={picked ? numberOf(picked.split('/')[1]) : undefined} />)}
          </span>} />
        {shut && n.state === 'stale' && <StaleNote n={n} protos={input.protos} depth={depth} />}
        {shut ? n.children.map(c => draw(c, depth + 1, inside || windowed)) : null}
      </>
    )
    return windowed && !inside
      ? <Near key={n.key} estimate={shownRows(n) * ROW_H} scroller={() => list.current} force={holdsPlace(n)} start={(firstRows -= shownRows(n)) + shownRows(n) > 0}>{block}</Near>
      : <div key={n.key}>{block()}</div>
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
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
      <div ref={list} className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-3 pt-1 text-[13px]">
        {nodes.length ? nodes.map(n => draw(n, 0))
          : <p className="px-4 py-6 text-center text-[12px] text-zinc-400">{filter === 'open' ? t('Nothing waits for you') : filter === 'mine' ? t('Nothing from this conversation yet') : filter === 'favs' ? t('No favorites yet') : t('No prototypes yet')}</p>}
      </div>
      {desk && input.dock && <Dock dock={input.dock} />}
      <div className="flex h-10 shrink-0 items-center gap-2 border-t border-black/[.06] px-3 text-[12px] text-zinc-500 dark:border-white/10">
        <span className={'size-2 rounded-full ' + (input.up ? 'bg-emerald-500' : 'bg-zinc-400')} /><span className="truncate">{input.live}</span>
      </div>
    </div>
  )
}

/** A stale exploration, open: which option it was built on and which one is picked now. */
function StaleNote({ n, protos, depth }: { n: TreeNode; protos: Proto[]; depth: number }) {
  const p = protos.find(x => `exp:${x.id}` === n.key), parent = p?.from && protos.find(x => x.id === p.from!.proto)
  if (!p?.from || !parent?.picked) return null
  return (
    <div className="mb-1 rounded-lg bg-rose-50 px-2 py-1.5 text-[12px] text-rose-800 dark:bg-rose-950/50 dark:text-rose-200" style={{ marginInlineStart: 8 + (depth + 1) * 8, marginInlineEnd: 8 }}>
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
