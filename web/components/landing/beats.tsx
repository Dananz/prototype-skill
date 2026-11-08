'use client'
// The three steps (Ask, Watch them land, Pick one): a typed command, a row of cubes, and a pick that
// steps along. The pick row is a Base UI toggle group (one pressed at a time); hovering or focusing a
// cube picks it too. Entrances are CSS classes (globals.css): an inline style in the server's HTML
// would be refused by the CSP.
import { useEffect, useState } from 'react'
import { ToggleGroup } from '@base-ui/react/toggle-group'
import { Toggle } from '@base-ui/react/toggle'
import { CaretRightIcon } from '@phosphor-icons/react'
import { Cube } from './mark'
import { useInView } from './in-view'

// One literal class per cube, so Tailwind sees each: the stagger of the drop-in.
const STAGGER = ['[--i:0]', '[--i:1]', '[--i:2]', '[--i:3]', '[--i:4]']

function useTyped(text: string, run: boolean, speed = 42) {
  const [n, setN] = useState(0)
  useEffect(() => {
    if (!run) return
    let i = 0
    const t = window.setInterval(() => { i++; setN(i); if (i >= text.length) clearInterval(t) }, speed)
    return () => clearInterval(t)
  }, [text, run, speed])
  return text.slice(0, n)
}

function Stack({ on }: { on: boolean }) {
  return (
    <span className={`d-lift relative block ${on ? 'd-lifted' : ''}`}>
      <Cube size={44} />
      <Cube size={44} picked className={`d-pc absolute inset-0 ${on ? 'opacity-100' : 'opacity-0'}`} />
    </span>
  )
}

/** The cubes landing, nothing to pick yet. */
function CubeRow() {
  return (
    <div aria-hidden="true" className="flex items-end justify-center gap-1.5 sm:gap-2">
      {STAGGER.map(c => <span key={c} data-c className={`d-pick ${c}`}><Stack on={false} /></span>)}
    </div>
  )
}

/** The cubes to pick from: one pressed, the purple one. */
function PickRow({ picked, onPick }: { picked: number; onPick: (i: number) => void }) {
  return (
    <ToggleGroup value={[String(picked)]} onValueChange={v => { if (v[0] !== undefined) onPick(Number(v[0])) }} aria-label="Versions"
      className="flex items-end justify-center gap-1.5 sm:gap-2">
      {STAGGER.map((c, i) => (
        <Toggle key={c} value={String(i)} data-c aria-label={`Pick version ${'ABCDE'[i]}`}
          onPointerEnter={() => onPick(i)} onFocus={() => onPick(i)}
          className={`d-pick ${c} cursor-pointer rounded-md focus-visible:ring-2 focus-visible:ring-[#6d68f0] focus-visible:outline-none`}>
          <Stack on={picked === i} />
        </Toggle>
      ))}
    </ToggleGroup>
  )
}

export function Beats() {
  const [ref, inView] = useInView<HTMLDivElement>()
  const typed = useTyped('/prototype 3 empty states', inView)
  const [picked, setPicked] = useState(4)
  const [held, setHeld] = useState(false)
  useEffect(() => {
    if (!inView || held) return
    const t = window.setInterval(() => setPicked(p => (p + 1) % 5), 1800)
    return () => clearInterval(t)
  }, [inView, held])
  const beats = [
    { title: 'Ask', body: 'Say what you want and how many. Point at the screen that ships, and every version is checked against screenshots of your real product.', art: (
      <div className="flex h-full items-center justify-center px-4">
        <div className="flex w-full max-w-[280px] items-center gap-2 rounded-xl bg-[#121019] px-3.5 py-3 text-[12.5px] text-white/90">
          <CaretRightIcon size={12} weight="bold" aria-hidden="true" className="shrink-0 text-[#a8a4f8]" />
          <span className="min-w-0 truncate">{typed}</span><span className="d-blink -ml-1 inline-block h-[14px] w-[7px] shrink-0 bg-[#c4c1fc]" />
        </div>
      </div>
    ) },
    { title: 'Watch them land', body: 'One live link, on your laptop or your phone. Each version lands as it is written, with hot reload and no refresh.', art: (
      <div className="flex h-full items-center justify-center"><CubeRow /></div>
    ) },
    { title: 'Pick one', body: 'Comment on any element and the agent edits it. Compare side by side, then pick one to build into your codebase.', art: (
      <div className="flex h-full items-center justify-center" onPointerEnter={() => setHeld(true)} onPointerLeave={() => setHeld(false)}>
        <PickRow picked={picked} onPick={setPicked} />
      </div>
    ) },
  ]
  return (
    <section className="border-t border-[#efedfb] bg-[#fbfaff]">
      <div ref={ref} className="mx-auto max-w-6xl px-5 py-20 sm:px-8 lg:py-28">
        <h2 className={`d-reveal max-w-xl text-[32px] leading-[1.1] font-bold text-balance sm:text-[44px] ${inView ? 'in' : ''}`}>
          Every block is a version. The purple one is yours.
        </h2>
        <div className="mt-12 grid gap-4 md:grid-cols-3">
          {beats.map((b, i) => (
            <div key={b.title} className={`d-beat d-card rounded-[22px] border border-[#e6e4fc] bg-white p-2 hover:border-[#c4c1fc] hover:shadow-[0_18px_36px_-24px_rgba(49,42,184,.4)] ${inView ? 'in' : ''}`}>
              <div className="h-[150px] rounded-[16px] bg-[#f6f5ff]">{b.art}</div>
              <div className="px-4 pt-5 pb-5">
                <h3 className={`text-[22px] font-semibold ${i === 2 ? 'text-[#5a53e3]' : ''}`}>{b.title}</h3>
                <p className="mt-2 text-[15px] leading-[1.55] text-[#4a4760]">{b.body}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
