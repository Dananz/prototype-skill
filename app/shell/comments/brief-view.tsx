// The decision brief (app/brief.mjs) drawn as a page instead of its Markdown: only what that file
// writes is read (headings, a quote, lists with or without ticks, bold, italics, code), so no
// Markdown package is needed. Each block takes its own direction: the brief is English, the
// user's quoted words may not be, so each block keeps its own side (data-own-side, shell.css), not
// the page's.
import type { ReactNode } from 'react'
import { Icon } from './ui'

function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`|\b_[^_]+_\b)/g).filter(Boolean).map((part, i) =>
    part.startsWith('**') ? <strong key={i} className="font-semibold text-zinc-900 dark:text-white">{part.slice(2, -2)}</strong>
    : part.startsWith('`') ? <code key={i} dir="ltr" className="rounded bg-zinc-900/[.06] px-1 font-mono text-[11px] dark:bg-white/10">{part.slice(1, -1)}</code>
    : part.startsWith('_') && part.endsWith('_') ? <em key={i} className="text-zinc-500">{part.slice(1, -1)}</em>
    : part)
}

export function BriefView({ markdown }: { markdown: string }) {
  const out: ReactNode[] = []
  let list: ReactNode[] = []
  const flush = () => { if (list.length) out.push(<ul key={`l${out.length}`} className="space-y-1">{list}</ul>); list = [] }
  markdown.split('\n').forEach((line, i) => {
    const tick = line.match(/^- \[( |x)\] (.*)$/)
    if (tick) {
      const done = tick[1] === 'x'
      list.push(<li key={i} dir="auto" className="flex gap-1.5"><span className={`mt-0.5 grid size-3.5 shrink-0 place-items-center rounded-full ${done ? 'bg-emerald-500 text-white' : 'ring-1 ring-inset ring-zinc-400'}`}>{done && <Icon name="check" className="size-2.5" />}</span><span className="min-w-0">{inline(tick[2])}</span></li>)
      return
    }
    if (line.startsWith('- ')) { list.push(<li key={i} dir="auto" className="flex gap-1.5"><span className="mt-[7px] size-1 shrink-0 rounded-full bg-zinc-400" /><span className="min-w-0">{inline(line.slice(2))}</span></li>); return }
    flush()
    if (!line.trim()) return
    if (line.startsWith('# ')) out.push(<h3 key={i} dir="auto" data-own-side className="text-start text-[15px] font-semibold leading-5 text-zinc-900 dark:text-white">{inline(line.slice(2))}</h3>)
    else if (line.startsWith('## ')) out.push(<h4 key={i} dir="auto" data-own-side className="text-start pt-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">{inline(line.slice(3))}</h4>)
    else if (line.startsWith('> ')) out.push(<blockquote key={i} dir="auto" data-own-side className="text-start border-s-2 border-zinc-300 ps-2.5 text-zinc-700 dark:border-zinc-600 dark:text-zinc-200">{inline(line.slice(2))}</blockquote>)
    else out.push(<p key={i} dir="auto" data-own-side className="text-start">{inline(line)}</p>)
  })
  flush()
  return <div data-brief-page className="space-y-2 text-xs leading-5 text-zinc-700 dark:text-zinc-300">{out}</div>
}
