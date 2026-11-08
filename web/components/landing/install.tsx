'use client'
// The install band: agent-neutral copy, and terminal-style tabs (Base UI Tabs) that switch the card's
// lines between Claude Code and Codex. The chosen agent's lines rise in with Motion and the card's
// height follows them; Copy turns to a check through the shared AnimatedIcon.
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { Tabs } from '@base-ui/react/tabs'
import { ArrowUpRightIcon, CaretRightIcon, CheckIcon, CopyIcon, GithubLogoIcon } from '@phosphor-icons/react'
import { AnimatedIcon } from '@/components/animated-icon'
import { useMounted } from '@/lib/media'
import { INSTALL, SITE } from '@/lib/site'
import { LogoMark } from './mark'
import { useInView } from './in-view'

type AgentId = 'claude' | 'codex'

const AGENTS: { id: AgentId; label: string; steps: { label: string; cmds: string[] }[] }[] = [
  { id: 'claude', label: 'Claude Code', steps: [
    { label: 'Add the plugin', cmds: INSTALL.claude },
    { label: 'Then ask for a screen', cmds: [INSTALL.ask.claude] },
  ] },
  { id: 'codex', label: 'Codex', steps: [
    { label: 'Clone the skill', cmds: INSTALL.codex },
    { label: 'Then ask for a screen', cmds: [INSTALL.ask.codex] },
  ] },
]

function CommandRow({ cmd }: { cmd: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard?.writeText(cmd).catch(() => {})
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }
  return (
    <div className="group flex items-center gap-3 rounded-xl px-4 py-3 transition-colors hover:bg-white/[.04]">
      <CaretRightIcon size={13} weight="bold" aria-hidden="true" className="shrink-0 text-[#a8a4f8]" />
      <code className="min-w-0 flex-1 overflow-x-auto text-[13px] whitespace-nowrap text-white sm:text-sm">{cmd}</code>
      <button type="button" onClick={copy} aria-label={copied ? 'Copied' : `Copy ${cmd}`}
        className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-white/50 transition-colors hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-[#a8a4f8] focus-visible:outline-none">
        <AnimatedIcon state={copied ? 'copied' : 'copy'} size={16}>
          {copied ? <CheckIcon size={16} weight="bold" className="text-[#c4c1fc]" /> : <CopyIcon size={16} />}
        </AnimatedIcon>
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
    return () => ro.disconnect()
  }, [])
  return (
    <div className="ins-h overflow-hidden" style={h === undefined ? undefined : { height: h }}>
      <div ref={inner}>{children}</div>
    </div>
  )
}

/** One agent's steps. A newly chosen agent fades and rises in (not on the first paint). */
function Steps({ agent, animate }: { agent: AgentId; animate: boolean }) {
  const reduce = useReducedMotion()
  const a = AGENTS.find(x => x.id === agent)!
  const rows = a.steps.map((s, i) => (
    <div key={s.label}>
      {i > 0 && <div className="mx-4 my-2 h-px bg-white/10" />}
      <p className="px-4 pt-3 pb-1 text-[13px] text-white/60">{s.label}</p>
      {s.cmds.map(c => <CommandRow key={c} cmd={c} />)}
    </div>
  ))
  if (!animate) return <div>{rows}</div>
  return (
    <motion.div key={agent} initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8, filter: 'blur(2px)' }}
      animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0, filter: 'blur(0px)' }} transition={{ duration: 0.38, ease: [0.2, 0.8, 0.2, 1] }}>
      {rows}
    </motion.div>
  )
}

export function Install() {
  const [ref, inView] = useInView<HTMLElement>()
  const [agent, setAgent] = useState<AgentId>('claude')
  const [switched, setSwitched] = useState(false)
  const mounted = useMounted()
  return (
    <section id="install" ref={ref} className={`mx-auto max-w-6xl scroll-mt-4 px-3 py-10 sm:px-8 sm:py-16 ${inView ? 'd-in' : ''}`}>
      <div className="relative overflow-hidden rounded-[32px] bg-gradient-to-b from-[#6d68f0] to-[#312ab8] px-5 py-12 text-white ring-1 ring-white/20 ring-inset sm:rounded-[40px] sm:px-14 sm:py-16">
        <div className="d-rise-in d-band -mt-4 mb-2 h-28 w-28 -translate-x-[30%] sm:h-36 sm:w-36">
          {inView ? <LogoMark key="in" className="block h-full w-full" /> : null}
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)] items-center gap-10 lg:grid-cols-[1fr_1.15fr] lg:gap-14">
          <div className="d-rise-in">
            <h2 className="text-[32px] leading-[1.1] font-bold text-balance sm:text-[44px]">Install it in your agent</h2>
            <p className="mt-4 max-w-md text-lg leading-relaxed text-[#e6e4fc]">Install once, then ask for any screen. The live link opens on your phone over Tailscale.</p>
            <p className="mt-6 text-[15px] text-white/85">Open source, MIT. <a href={SITE.repo} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded align-[-3px] font-medium text-white underline decoration-white/40 decoration-2 underline-offset-4 transition-colors hover:decoration-white focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none"><GithubLogoIcon size={16} aria-hidden="true" /> GitHub <ArrowUpRightIcon size={13} aria-hidden="true" className="text-white/70" /></a></p>
          </div>
          <div className="d-rise-in d-later min-w-0">
            <Tabs.Root value={agent} onValueChange={v => { setAgent(v as AgentId); setSwitched(true) }} className="-mx-5 -mb-12 sm:mx-0 sm:mb-0">
              <Tabs.List activateOnFocus aria-label="Your agent" className="flex gap-1">
                {AGENTS.map(a => (
                  <Tabs.Tab key={a.id} value={a.id}
                    className="group flex h-11 items-center gap-2 rounded-t-[14px] bg-white/[.12] px-4 text-[14px] font-medium text-white/70 transition-colors duration-300 hover:bg-white/[.18] hover:text-white focus-visible:ring-2 focus-visible:ring-[#a8a4f8] focus-visible:outline-none focus-visible:ring-inset data-[active]:bg-[#121019] data-[active]:text-white data-[active]:hover:bg-[#121019]">
                    <CaretRightIcon size={12} weight="bold" aria-hidden="true" className="text-white/40 transition-colors group-data-[active]:text-[#a8a4f8]" />
                    {a.label}
                  </Tabs.Tab>
                ))}
              </Tabs.List>
              <div className="rounded-tr-[22px] bg-[#121019] p-2 pb-4 shadow-[0_30px_60px_-30px_rgba(49,42,184,.45)] sm:rounded-b-[22px] sm:pb-2">
                <AutoHeight>
                  {AGENTS.map(a => (
                    <Tabs.Panel key={a.id} value={a.id}>
                      <Steps agent={a.id} animate={mounted && switched} />
                    </Tabs.Panel>
                  ))}
                </AutoHeight>
              </div>
            </Tabs.Root>
          </div>
        </div>
      </div>
    </section>
  )
}
