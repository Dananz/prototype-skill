// The install band: agent-neutral copy, and terminal-style tabs that switch the card's lines
// between Claude Code and Codex.
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { ArrowUpRight, CaretRight, Check, Copy, GithubLogo } from '@phosphor-icons/react'
import { LogoMark } from './logo'
import { SITE } from '../content'

type AgentId = 'claude' | 'codex'

const AGENTS: { id: AgentId; label: string; steps: { label: string; cmds: string[] }[] }[] = [
  { id: 'claude', label: 'Claude Code', steps: [
    { label: 'Add the plugin', cmds: ['/plugin marketplace add Dananz/prototype-skill', '/plugin install prototype@prototype-skill'] },
    { label: 'Then ask for a screen', cmds: ['/prototype the checkout page'] },
  ] },
  { id: 'codex', label: 'Codex', steps: [
    { label: 'Clone the skill', cmds: ['git clone https://github.com/Dananz/prototype-skill ~/.agents/skills/prototype'] },
    { label: 'Then ask for a screen', cmds: ['$prototype the checkout page'] },
  ] },
]

/** Adds d-in once the element scrolls into view, so its children's drop and rise run. */
export function useInView<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [inView, setInView] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setInView(true); io.disconnect() } }, { threshold: 0.25 })
    io.observe(el)
    return () => io.disconnect()
  }, [])
  return [ref, inView] as const
}

function CommandRow({ cmd }: { cmd: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard?.writeText(cmd).catch(() => {})
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }
  return (
    <div className="group flex items-center gap-3 rounded-xl px-4 py-3 transition-colors hover:bg-white/[.04]">
      <CaretRight size={13} weight="bold" className="shrink-0 text-[#a8a4f8]" />
      <code className="d-code min-w-0 flex-1 overflow-x-auto text-[13px] whitespace-nowrap text-white sm:text-sm">{cmd}</code>
      <button type="button" onClick={copy} aria-label={copied ? 'Copied' : `Copy ${cmd}`}
        className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-white/50 transition-colors hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-[#a8a4f8] focus-visible:outline-none">
        {copied ? <Check size={16} weight="bold" className="d-line text-[#c4c1fc]" /> : <Copy size={16} />}
      </button>
    </div>
  )
}

/** Height follows the content, so a swap to fewer or more rows glides instead of jumping. */
function AutoHeight({ children }: { children: ReactNode }) {
  const inner = useRef<HTMLDivElement>(null)
  const [h, setH] = useState<number>()
  useLayoutEffect(() => {
    const el = inner.current
    if (!el) return
    const ro = new ResizeObserver(() => setH(el.offsetHeight))
    ro.observe(el)
    setH(el.offsetHeight)
    return () => ro.disconnect()
  }, [])
  return (
    <div className="ins-h overflow-hidden" style={{ height: h }}>
      <div ref={inner}>{children}</div>
    </div>
  )
}

/** The chosen agent's steps; a new agent fades and rises in. */
function Steps({ agent }: { agent: AgentId }) {
  const a = AGENTS.find(x => x.id === agent)!
  return (
    <AutoHeight>
      <div key={agent} className="ins-in" role="tabpanel" id={`ins-panel-${agent}`} aria-labelledby={`ins-tab-${agent}`}>
        {a.steps.map((s, i) => (
          <div key={s.label}>
            {i > 0 && <div className="mx-4 my-2 h-px bg-white/10" />}
            <p className="px-4 pt-3 pb-1 text-[13px] text-white/60">{s.label}</p>
            {s.cmds.map(c => <CommandRow key={c} cmd={c} />)}
          </div>
        ))}
      </div>
    </AutoHeight>
  )
}

export function Install() {
  const [ref, inView] = useInView<HTMLElement>()
  const [agent, setAgent] = useState<AgentId>('claude')
  // Arrow keys move between tabs, as a tablist should.
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const i = AGENTS.findIndex(a => a.id === agent)
    const next = AGENTS[(i + (e.key === 'ArrowRight' ? 1 : AGENTS.length - 1)) % AGENTS.length].id
    setAgent(next)
    document.getElementById(`ins-tab-${next}`)?.focus()
  }
  return (
    <section id="install" ref={ref} className={`mx-auto max-w-6xl scroll-mt-4 px-3 py-10 sm:px-8 sm:py-16 ${inView ? 'd-in' : ''}`}>
      <div className="relative overflow-hidden rounded-[32px] bg-gradient-to-b from-[#6d68f0] to-[#312ab8] px-5 py-12 text-white ring-1 ring-white/20 ring-inset sm:rounded-[40px] sm:px-14 sm:py-16">
        <div className="d-rise-in d-band -mt-4 mb-2 h-28 w-28 -translate-x-[30%] sm:h-36 sm:w-36">
          {inView ? <LogoMark key="in" className="block h-full w-full" /> : null}
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)] items-center gap-10 lg:grid-cols-[1fr_1.15fr] lg:gap-14">
          <div className="d-rise-in">
            <h2 className="text-[32px] leading-[1.1] font-bold tracking-[-0.03em] text-balance sm:text-[44px]">Install it in your agent</h2>
            <p className="mt-4 max-w-md text-lg leading-relaxed text-[#e6e4fc]">Install once, then ask for any screen. The live link opens on your phone over Tailscale.</p>
            <p className="mt-6 text-[15px] text-white/85">Open source, MIT. <a href={SITE.repo} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded align-[-3px] font-medium text-white underline decoration-white/40 decoration-2 underline-offset-4 transition-colors hover:decoration-white focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none"><GithubLogo size={16} aria-hidden /> GitHub <ArrowUpRight size={13} aria-hidden className="text-white/70" /></a></p>
          </div>
          <div className="d-rise-in min-w-0" style={{ animationDelay: '.15s' }}>
            <div className="-mx-5 -mb-12 sm:mx-0 sm:mb-0">
              <div role="tablist" aria-label="Your agent" onKeyDown={onKey} className="flex gap-1">
                {AGENTS.map(a => {
                  const on = a.id === agent
                  return (
                    <button key={a.id} id={`ins-tab-${a.id}`} role="tab" type="button" aria-selected={on} aria-controls={`ins-panel-${a.id}`} tabIndex={on ? 0 : -1} onClick={() => setAgent(a.id)}
                      className={`flex h-11 items-center gap-2 rounded-t-[14px] px-4 text-[14px] font-medium transition-colors duration-300 focus-visible:ring-2 focus-visible:ring-[#a8a4f8] focus-visible:outline-none focus-visible:ring-inset ${on ? 'bg-[#121019] text-white' : 'bg-white/[.12] text-white/70 hover:bg-white/[.18] hover:text-white'}`}>
                      <CaretRight size={12} weight="bold" className={`transition-colors ${on ? 'text-[#a8a4f8]' : 'text-white/40'}`} />
                      {a.label}
                    </button>
                  )
                })}
              </div>
              <div className="rounded-tr-[22px] bg-[#121019] p-2 pb-4 shadow-[0_30px_60px_-30px_rgba(49,42,184,.45)] sm:rounded-b-[22px] sm:pb-2">
                <Steps agent={agent} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
