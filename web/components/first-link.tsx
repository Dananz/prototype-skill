'use client'
// /me before the first link: where links show up, and how the first one gets here. Three numbered
// steps on a thin line, each with a small drawing of the real thing (the /prototype prompt, the
// prototype's page with its Share button and the link it makes, the row it becomes here), then the
// install lines with Copy, the landing's own (lib/site INSTALL). It takes the place of both panes
// while there are no links, and of the "no links yet" words for an account that never shared.
// Motion is CSS (globals.css, fl-*): it runs from the server's first paint, where an inline style
// would be refused by the CSP.
import type { ReactNode } from 'react'
import { CheckIcon } from '@phosphor-icons/react'
import { CommandLine } from './command-line'
import { useCopied } from '@/lib/copy'
import { INSTALL } from '@/lib/site'

const SAMPLE = 'k3x9p2mqvd'

function Sketch({ children }: { children: ReactNode }) {
  return <div aria-hidden="true" className="w-full rounded-[14px] border border-line bg-tint p-2.5 sm:w-[228px] sm:shrink-0">{children}</div>
}

/** Step 1: a prompt line in Claude Code, the caret blinking. */
function PromptSketch() {
  return (
    <Sketch>
      <div className="rounded-[6px] bg-white px-3 py-2.5 shadow-[0_0_0_1px_var(--color-soft)]">
        <p className="text-[11px] text-faint">Claude Code</p>
        <p className="mt-1 flex items-center gap-1 text-[13px] text-ink">
          <span className="text-faint">&gt;</span>
          <span className="font-semibold">/prototype</span>
          <span className="truncate text-ink2">a pricing page</span>
          <span className="fl-caret ms-px h-[15px] w-[1.5px] shrink-0 bg-ink" />
        </p>
      </div>
    </Sketch>
  )
}

/** Step 2: the prototype's page, its Share button and the link it makes. */
function ShareSketch({ base }: { base: string }) {
  return (
    <Sketch>
      <div className="rounded-[6px] bg-white p-2 shadow-[0_0_0_1px_var(--color-soft)]">
        <div className="flex items-center justify-between gap-2">
          <span className="flex gap-1">
            <span className="h-1.5 w-8 rounded-full bg-line" />
            <span className="h-1.5 w-5 rounded-full bg-soft" />
          </span>
          <span className="rounded-[6px] bg-brand px-2.5 py-1 text-[11.5px] font-semibold text-white">Share</span>
        </div>
        <div className="mt-2 grid grid-cols-3 gap-1">
          <span className="h-7 rounded-[3px] bg-tint" />
          <span className="h-7 rounded-[3px] bg-tint" />
          <span className="h-7 rounded-[3px] bg-tint" />
        </div>
      </div>
      <p className="mt-2 flex items-center gap-1.5 px-1 text-[12px] text-ink2">
        <CheckIcon size={13} weight="bold" className="shrink-0 text-green" />
        <span className="truncate">{base}/{SAMPLE}</span>
      </p>
    </Sketch>
  )
}

/** Step 3: the row it becomes on this page. */
function RowSketch() {
  return (
    <Sketch>
      <div className="rounded-[6px] bg-white px-3 py-2.5 shadow-[0_0_0_1px_var(--color-soft)]">
        <p className="flex items-center justify-between gap-2">
          <span className="truncate text-[13px] font-semibold">Pricing page</span>
          <span className="grid h-[18px] min-w-[18px] place-items-center rounded-full bg-ink px-1 text-[10.5px] font-semibold text-white">2</span>
        </p>
        <p className="mt-0.5 text-[11.5px] text-dim">your-project</p>
        <p className="mt-1.5 flex items-center gap-2.5 text-[11.5px] text-dim">
          <span>12 views</span>
          <span className="inline-flex items-center gap-1 text-green"><span className="size-1.5 rounded-full bg-live" />Dana is in it</span>
        </p>
      </div>
    </Sketch>
  )
}

// Each step fades in a little after the one before, and the line under its number draws down after it.

export function FirstLink({ base }: { base: string }) {
  const { done, copy } = useCopied()
  const steps: { title: string; body: ReactNode; sketch: ReactNode }[] = [
    {
      title: 'Build it on your Mac',
      body: <>In Claude Code or Codex, type <b className="font-semibold text-ink">/prototype</b> and what you want to design. It builds live designs you can click through.</>,
      sketch: <PromptSketch />,
    },
    {
      title: 'Press Share',
      body: <>Use the Share button on the prototype’s page, or ask Claude to share it. You get a link to send anyone.</>,
      sketch: <ShareSketch base={base} />,
    },
    {
      title: 'It lands here',
      body: <>Every link you share, from any project or Mac, shows up here with its views and comments. Change its message, turn it off or remove it.</>,
      sketch: <RowSketch />,
    },
  ]
  return (
    <main className="flex-1">
      <div className="mx-auto w-full max-w-[640px] px-4 pt-8 pb-16 sm:px-6 sm:pt-12">
        <h1 className="text-[28px] leading-[1.15] font-bold sm:text-[32px]">Your links will show up here</h1>
        <p className="mt-3 max-w-[480px] text-[15px] leading-relaxed text-ink2">You have not shared a prototype yet. This is how the first one gets here.</p>

        <ol className="relative mt-8">
          {steps.map((s, i) => (
            <li key={s.title} className="fl-step relative flex gap-4 pb-8 last:pb-0 sm:gap-5">
              {i < steps.length - 1 && <span aria-hidden="true" className="fl-rail absolute start-[15.5px] top-8 bottom-0 w-px bg-[#dcd9f7]" />}
              <span aria-hidden="true" className="relative z-10 grid size-8 shrink-0 place-items-center rounded-full border border-line bg-white text-[13.5px] font-semibold text-ink2">{i + 1}</span>
              <div className="flex min-w-0 flex-1 flex-col gap-4 sm:flex-row sm:items-start sm:gap-6">
                <div className="min-w-0 flex-1 pt-1">
                  <h2 className="text-[16px] leading-snug font-semibold">{s.title}</h2>
                  <p className="mt-1.5 text-[14.5px] leading-relaxed text-ink2">{s.body}</p>
                </div>
                {s.sketch}
              </div>
            </li>
          ))}
        </ol>

        <section aria-labelledby="fl-install" className="mt-10 border-t border-soft pt-7">
          <h2 id="fl-install" className="text-[16px] font-semibold">No /prototype yet?</h2>
          <p className="mt-1.5 text-[14.5px] leading-relaxed text-ink2">Add it to Claude Code with these two commands, one after the other.</p>
          <div className="mt-4 space-y-2">
            {INSTALL.claude.map((c, i) => (
              <CommandLine key={c} tone="card" shoot={`copy-install-${i + 1}`} command={c} copied={done === c} onCopy={() => copy(c, c)} />
            ))}
          </div>
          <p className="mt-3 min-h-5 text-[12.5px] text-green" aria-live="polite">{done ? 'Copied. Paste it into Claude Code.' : ''}</p>
        </section>
      </div>
    </main>
  )
}
