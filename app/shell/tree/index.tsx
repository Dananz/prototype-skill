// The project tree as the sidebar (design #1 of the map prototype): designs › flows › screens, each
// screen's options and the explorations built on them, then explorations on no screen. Three filters
// cut it (everything, still open, from this conversation). The shell hands it what it needs through
// an api and tells it when that changed; picking inline and the island's modes come with the map.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'
import type { Design, Proto } from '../shell'
import { t } from '../i18n'
import { numberOf } from '../variants'
import { treeOf, type Filter, type TreeNode } from './model'
import { Mark, Ph, Row } from './row'

export type TreeInput = {
  protos: Proto[]; designs: Design[]
  /** The route on screen (slug/letter), or '' on an overview. */
  place: string
  /** This conversation, for its filter. */
  me: string | null
  building: Set<string>
  /** The variant being worked on, as the old sidebar's strip says it ('' when none). */
  work: string
  /** "Live · edited 2 min ago". */
  live: string
  /** Open comments per slug. */
  counts: Record<string, number>
}
export type TreeApi = { get(): TreeInput; subscribe(fn: () => void): () => void; go(route: string): void; goWork(): void; hide(): void; name: string }

const FILTERS: [Filter, () => string][] = [['all', () => t('All')], ['open', () => t('Open')], ['mine', () => t('This conversation')]]
const SECTION: Record<string, () => string> = { 'section:loose': () => t('Explorations on no screen'), 'section:archive': () => t('Archive') }
const pickedOf = (n: TreeNode) => n.children.find(c => c.kind === 'option' && c.picked)?.route

function Tree({ api }: { api: TreeApi }) {
  const input = useSyncExternalStore(api.subscribe, api.get)
  const [filter, setFilter] = useState<Filter>(() => { try { return (localStorage.getItem('proto-tree-filter') as Filter) || 'all' } catch { return 'all' } })
  const [open, setOpen] = useState<Set<string>>(() => new Set())
  const list = useRef<HTMLDivElement>(null)
  const { nodes, waiting } = treeOf(input.protos, input.designs, { filter, me: input.me, building: input.building })
  const toggle = (k: string) => setOpen(o => { const n = new Set(o); if (n.has(k)) n.delete(k); else n.add(k); return n })
  const choose = (f: Filter) => { setFilter(f); try { localStorage.setItem('proto-tree-filter', f) } catch { /* private window */ } }

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
  const isOpen = (n: TreeNode) => ['design', 'flow', 'section'].includes(n.kind) && n.key !== 'section:archive' ? !open.has(n.key) : open.has(n.key)
  const flip = (n: TreeNode) => toggle(n.key)

  const draw = (n: TreeNode, depth: number): React.ReactNode => {
    const here = !!n.route && n.kind !== 'option' && n.route.split('/')[0] === slug
    const lit = n.kind === 'option' ? n.route === input.place : here && !n.children.some(c => c.kind === 'option' && c.route === input.place)
    const shut = n.children.length ? isOpen(n) : undefined
    const kids = shut ? n.children.map(c => draw(c, depth + 1)) : null
    if (n.kind === 'design') return (
      <div key={n.key}>
        <Row id={n.key} depth={depth} strong open={shut} onCaret={() => flip(n)} onClick={() => flip(n)} count={n.count}
          icon={<span className="size-2.5 shrink-0 rounded-full bg-indigo-500" />} label={<span dir="auto">{n.label}</span>} />
        {kids}
      </div>
    )
    if (n.kind === 'flow') return <div key={n.key}><Row id={n.key} depth={depth} medium open={shut} onCaret={() => flip(n)} onClick={() => flip(n)} count={n.count} label={<span dir="auto">{n.label}</span>} />{kids}</div>
    if (n.kind === 'section') return (
      <div key={n.key}>
        <div className="flex items-center px-3 pb-1 pt-3">
          <button type="button" onClick={() => flip(n)} aria-expanded={!!shut} className="flex items-center gap-1 text-[11px] font-medium text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300">
            {n.key === 'section:archive' && <Ph name="archive" className="size-3" />}{SECTION[n.key]()}{n.count != null && ` · ${n.count}`}
          </button>
        </div>
        {kids}
      </div>
    )
    if (n.kind === 'option') {
      const num = numberOf(n.route!.split('/')[1])
      return (
        <Row key={n.key} id={n.key} depth={depth} on={lit} onClick={() => api.go(n.route!)} mv={n.route}
          icon={<span className={'grid size-4 shrink-0 place-items-center rounded text-[10px] font-semibold tabular-nums ' + (n.picked ? 'bg-emerald-500 text-white' : 'bg-zinc-900/[.06] text-zinc-500 dark:bg-white/10')}>{num}</span>}
          label={<span className="flex min-w-0 items-center gap-1"><span dir="auto" className="truncate">{n.label}</span>{input.protos.find(p => p.id === n.route!.split('/')[0])?.favorites.includes(n.route!.split('/')[1]) && <Ph name="starFill" className="size-3 shrink-0 text-amber-400" />}</span>}
          end={n.became ? <span className="shrink-0 truncate text-[11px] text-indigo-500" dir="auto">{t('became {name}', { name: n.became })}</span>
            : n.picked ? <span className="shrink-0 text-[11px] text-emerald-600 dark:text-emerald-400">{t('Picked')}</span> : null} />
      )
    }
    const picked = pickedOf(n)
    const comments = input.counts[n.route!.split('/')[0]] ?? 0
    const parent = n.kind === 'exploration' && n.on ? n : null
    return (
      <div key={n.key}>
        <Row id={n.key} depth={depth} on={lit} open={shut} onCaret={() => flip(n)} onClick={() => { api.go(n.route!); if (!shut) flip(n) }} mv={n.route}
          icon={n.kind === 'screen' ? <Ph name="browser" className="size-3.5 text-sky-500" /> : <Ph name="shuffle" className={'size-3.5 ' + (n.state === 'waits' ? 'text-zinc-300' : 'text-violet-500')} />}
          label={<span className={n.state === 'waits' ? 'text-zinc-400' : ''}><span dir="auto">{n.label}</span>{parent && <span className="text-[11px] text-zinc-400"> · {t('on #{n}', { n: parent.on! })}</span>}</span>}
          end={<span className="flex shrink-0 items-center gap-1.5">
            {n.standIn && <span title={t('#1 stands in until one is picked')} className="rounded bg-zinc-900/[.05] px-1 text-[10px] text-zinc-500 dark:bg-white/10">{t('not picked')}</span>}
            {comments > 0 && <span title={t('Open comments')} className="rounded-full bg-zinc-900/[.06] px-1.5 text-[10px] font-medium tabular-nums text-zinc-600 dark:bg-white/10 dark:text-zinc-300">{comments}</span>}
            {n.state && !(n.kind === 'screen' && n.state === 'open') && <Mark state={n.state} picked={picked ? numberOf(picked.split('/')[1]) : undefined} />}
          </span>} />
        {shut && n.state === 'stale' && <StaleNote n={n} protos={input.protos} depth={depth} />}
        {kids}
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2.5 px-3">
        <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-zinc-900 text-[13px] font-bold text-white dark:bg-white dark:text-zinc-900">{(api.name[0] || 'P').toUpperCase()}</span>
        <span className="min-w-0 flex-1 truncate text-[15px] font-semibold" dir="auto">{api.name}</span>
        <button type="button" onClick={api.hide} aria-label={t('Hide sidebar')} title={t('Hide sidebar · ⌘\\')} className="grid size-8 place-items-center rounded-lg text-zinc-500 hover:bg-zinc-900/5 dark:hover:bg-white/10"><Ph name="sidebar" className="size-[17px]" /></button>
      </div>
      {input.work && (
        <button type="button" data-tree-work onClick={api.goWork} className="mx-2 mb-1 flex min-w-0 items-center gap-2 rounded-lg bg-emerald-500/10 px-2 py-1.5 text-start text-[12px] text-emerald-800 dark:text-emerald-200">
          <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-emerald-500" /><span className="truncate" dir="auto">{input.work}</span>
        </button>
      )}
      <div data-tree-filters className="mx-2 mb-1 mt-1 flex rounded-lg bg-zinc-900/[.05] p-0.5 text-[12px] dark:bg-white/[.06]">
        {FILTERS.map(([k, label]) => (
          <button key={k} type="button" data-tree-filter={k} aria-pressed={filter === k} onClick={() => choose(k)}
            className={'h-7 min-w-0 flex-1 truncate rounded-md px-1 ' + (filter === k ? 'bg-white font-medium shadow-sm dark:bg-zinc-700' : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200')}>
            {k === 'open' ? `${label()} · ${waiting}` : label()}
          </button>
        ))}
      </div>
      <div ref={list} className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-3 pt-1 text-[13px]">
        {nodes.length ? nodes.map(n => draw(n, 0))
          : <p className="px-4 py-6 text-center text-[12px] text-zinc-400">{filter === 'open' ? t('Nothing waits for you') : filter === 'mine' ? t('Nothing from this conversation yet') : t('No prototypes yet')}</p>}
      </div>
      <div className="flex h-10 shrink-0 items-center gap-2 border-t border-black/[.06] px-3 text-[12px] text-zinc-500 dark:border-white/10">
        <span className="size-2 rounded-full bg-emerald-500" /><span className="truncate">{input.live}</span>
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

/** Draws the tree into host; the shell calls the api's listeners when anything it reads changed. */
export function mountTree(host: HTMLElement, api: TreeApi) {
  createRoot(host).render(<Tree api={api} />)
}
