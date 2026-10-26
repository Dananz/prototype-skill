// A phone (under 640 px): one design at a time, filling the space between the header and the
// switcher, scrolling inside itself both ways. Nothing here takes a sideways swipe or wheel for
// itself, so the design's own carousels, wide tables and sliders keep every gesture; only the
// switcher changes the design, and exactly one design is mounted (a phone's memory, #136). A new
// design fades up from its top.
import { useLayoutEffect, useRef, type RefObject } from 'react'
import { rtl } from '../i18n'
import { Jump } from './bar'
import { Mounted, type Screen } from './ui'

export function Phone({ screens, i, go, step, root }: {
  screens: Screen[]; i: number; go: (key: string) => void; step: (d: number) => void; root: RefObject<HTMLDivElement | null>
}) {
  const box = useRef<HTMLDivElement>(null)
  const s = screens[i]
  useLayoutEffect(() => {
    box.current?.scrollTo({ top: 0, left: 0 })
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches)
      box.current?.animate([{ opacity: 0, translate: '0 8px' }, { opacity: 1, translate: '0 0' }], { duration: 220, easing: 'cubic-bezier(.2,.8,.2,1)' })
  }, [s.key])
  return (
    <>
      <section aria-label={`#${s.n} ${s.name}`} className="absolute inset-x-3 top-0 bottom-[calc(max(12px,env(safe-area-inset-bottom))+40px)] overflow-hidden rounded-[18px] bg-white shadow-[0_20px_50px_-20px_rgba(0,0,0,.45)] ring-1 ring-zinc-900/10 dark:bg-zinc-950 dark:ring-white/10">
        <div ref={box} data-scroll className="h-full overflow-auto overscroll-contain">
          <Mounted key={s.key} v={s.v} live />
        </div>
      </section>
      <div dir={rtl ? 'rtl' : 'ltr'} className="absolute inset-x-0 bottom-[max(12px,env(safe-area-inset-bottom))] z-10 flex h-7 justify-center">
        <Jump screens={screens} i={i} go={go} step={step} root={root} named />
      </div>
    </>
  )
}
