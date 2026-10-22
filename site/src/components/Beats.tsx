// The three steps (Ask, Watch them land, Pick one): a typed command, a row of cubes, and a pick that steps along.
import { useEffect, useState, type CSSProperties } from 'react'
import { CaretRight } from '@phosphor-icons/react'
import { Cube } from './logo'
import { useInView } from './Install'

function useTyped(text: string, run: boolean, speed = 42) {
  const [n, setN] = useState(0)
  useEffect(() => {
    if (!run) return
    setN(0)
    let i = 0
    const t = window.setInterval(() => { i++; setN(i); if (i >= text.length) clearInterval(t) }, speed)
    return () => clearInterval(t)
  }, [text, run, speed])
  return text.slice(0, n)
}

function CubeRow({ picked, onPick, lift = true }: { picked: number | null; onPick?: (i: number) => void; lift?: boolean }) {
  return (
    <div className="flex items-end justify-center gap-1.5 sm:gap-2">
      {[0, 1, 2, 3, 4].map(i => (
        <button key={i} type="button" data-c tabIndex={onPick ? 0 : -1} aria-label={onPick ? `Pick version ${'ABCDE'[i]}` : undefined} aria-hidden={onPick ? undefined : true}
          onPointerEnter={() => onPick?.(i)} onFocus={() => onPick?.(i)} onClick={() => onPick?.(i)}
          className={`d-pick rounded-md focus-visible:ring-2 focus-visible:ring-[#6d68f0] focus-visible:outline-none ${onPick ? 'cursor-pointer' : 'pointer-events-none'}`}
          style={{ '--i': i } as CSSProperties}>
          <span className="d-lift relative block" style={{ transform: lift && picked === i ? 'translateY(-14px)' : undefined }}>
            <Cube size={44} />
            <Cube size={44} picked className="d-pc absolute inset-0" style={{ opacity: picked === i ? 1 : 0 }} />
          </span>
        </button>
      ))}
    </div>
  )
}

export default function Beats() {
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
        <div className="d-code flex w-full max-w-[280px] items-center gap-2 rounded-xl bg-[#121019] px-3.5 py-3 text-[12.5px] text-white/90">
          <CaretRight size={12} weight="bold" className="shrink-0 text-[#a8a4f8]" />
          <span className="min-w-0 truncate">{typed}</span><span className="d-blink -ml-1 inline-block h-[14px] w-[7px] shrink-0 bg-[#c4c1fc]" />
        </div>
      </div>
    ) },
    { title: 'Watch them land', body: 'One live link, on your laptop or your phone. Each version lands as it is written, with hot reload and no refresh.', art: (
      <div className="flex h-full items-center justify-center"><CubeRow picked={null} lift={false} /></div>
    ) },
    { title: 'Pick one', body: 'Comment on any element and the agent edits it. Compare side by side, then pick one to build into your codebase.', art: (
      <div className="flex h-full items-center justify-center" onPointerEnter={() => setHeld(true)} onPointerLeave={() => setHeld(false)}>
        <CubeRow picked={picked} onPick={setPicked} />
      </div>
    ) },
  ]
  return (
    <section className="border-t border-[#efedfb] bg-[#fbfaff]">
      <div ref={ref} className="mx-auto max-w-6xl px-5 py-20 sm:px-8 lg:py-28">
        <h2 className="max-w-xl text-[32px] leading-[1.1] font-bold tracking-[-0.03em] text-balance transition-[opacity,transform] duration-700 sm:text-[44px]"
          style={{ opacity: inView ? 1 : 0, transform: inView ? 'none' : 'translateY(20px)' }}>
          Every block is a version. The purple one is yours.
        </h2>
        <div className="mt-12 grid gap-4 md:grid-cols-3">
          {beats.map((b, i) => (
            <div key={b.title} className={`d-beat rounded-[22px] border border-[#e6e4fc] bg-white p-2 transition-[border-color,box-shadow] hover:border-[#c4c1fc] hover:shadow-[0_18px_36px_-24px_rgba(49,42,184,.4)] ${inView ? 'in' : ''}`}
              style={{ transition: 'opacity .7s, transform .7s cubic-bezier(.2,.8,.2,1), border-color .3s, box-shadow .3s', transitionDelay: inView ? `${i * 0.12}s, ${i * 0.12}s, 0s, 0s` : '0s', opacity: inView ? 1 : 0, transform: inView ? 'none' : 'translateY(24px)' }}>
              <div className="h-[150px] rounded-[16px] bg-[#f6f5ff]">{b.art}</div>
              <div className="px-4 pt-5 pb-5">
                <h3 className={`text-[22px] font-semibold tracking-[-0.01em] ${i === 2 ? 'text-[#5a53e3]' : ''}`}>{b.title}</h3>
                <p className="mt-2 text-[15px] leading-[1.55] text-[#4a4760]">{b.body}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
