// The Prototype mark, path for path from assets/icon/prototype.svg (never redraw it).
// Five isometric cubes: four plain, one picked (the purple one, top right).
// Each cube is a <g data-cube="1..5" data-picked?> so a variant can animate them with its own CSS.
// Build order (bottom up): 1 left-bottom, 2 left-middle, 3 left-top, 4 right-bottom, 5 right-top (picked).
import type { CSSProperties } from 'react'

const PLAIN = ['#ffffff', '#e6e4fc', '#c9c6f5']
const PICKED = ['#c4c1fc', '#7f7af4', '#5a53e3']

export const CUBES: { id: number; top: string; left: string; right: string; picked?: boolean }[] = [
  { id: 1, top: 'M441.69 526.76L569.53 600.57L441.69 674.38L313.85 600.57Z', left: 'M313.85 748.19L441.69 822L441.69 674.38L313.85 600.57Z', right: 'M569.53 748.19L441.69 822L441.69 674.38L569.53 600.57Z' },
  { id: 2, top: 'M441.69 364.38L569.53 438.19L441.69 512L313.85 438.19Z', left: 'M313.85 585.81L441.69 659.62L441.69 512L313.85 438.19Z', right: 'M569.53 585.81L441.69 659.62L441.69 512L569.53 438.19Z' },
  { id: 3, top: 'M441.69 202L569.53 275.81L441.69 349.62L313.85 275.81Z', left: 'M313.85 423.43L441.69 497.24L441.69 349.62L313.85 275.81Z', right: 'M569.53 423.43L441.69 497.24L441.69 349.62L569.53 275.81Z' },
  { id: 4, top: 'M582.31 445.57L710.15 519.38L582.31 593.19L454.47 519.38Z', left: 'M454.47 667L582.31 740.81L582.31 593.19L454.47 519.38Z', right: 'M710.15 667L582.31 740.81L582.31 593.19L710.15 519.38Z' },
  { id: 5, top: 'M582.31 283.19L710.15 357L582.31 430.81L454.47 357Z', left: 'M454.47 504.62L582.31 578.43L582.31 430.81L454.47 357Z', right: 'M710.15 504.62L582.31 578.43L582.31 430.81L710.15 357Z', picked: true },
]

type Props = {
  /** Draw the rounded purple tile behind the cubes, as in the app icon. */
  tile?: boolean
  /** 'build' drops the cubes in one by one, then lifts and colors the picked one. 'none' is static. */
  animate?: 'build' | 'none'
  className?: string
  style?: CSSProperties
  title?: string
}

const css = `
.pl-mark [data-cube]{transform-box:view-box;transform-origin:512px 512px}
.pl-mark.pl-build [data-cube]{animation:pl-drop .7s cubic-bezier(.2,.9,.25,1.15) both}
.pl-mark.pl-build [data-cube="1"]{animation-delay:.05s}
.pl-mark.pl-build [data-cube="2"]{animation-delay:.2s}
.pl-mark.pl-build [data-cube="3"]{animation-delay:.35s}
.pl-mark.pl-build [data-cube="4"]{animation-delay:.5s}
.pl-mark.pl-build [data-cube="5"]{animation:pl-drop .7s cubic-bezier(.2,.9,.25,1.15) .65s both, pl-lift 1.1s cubic-bezier(.3,1.4,.4,1) 1.5s both}
.pl-mark.pl-build [data-picked] path{animation:pl-pick .6s ease 1.5s both}
@keyframes pl-drop{from{transform:translateY(-240px);opacity:0}60%{opacity:1}to{transform:none;opacity:1}}
@keyframes pl-lift{0%{transform:none}40%{transform:translateY(-36px)}100%{transform:translateY(-14px)}}
@keyframes pl-pick{from{fill:var(--pl-from)}to{fill:var(--pl-to)}}
@media (prefers-reduced-motion:reduce){.pl-mark [data-cube],.pl-mark [data-picked] path{animation:none!important}}
`
let injected = false
function inject() {
  if (injected || typeof document === 'undefined') return
  injected = true
  const s = document.createElement('style')
  s.textContent = css
  document.head.append(s)
}

export function LogoMark({ tile = false, animate = 'build', className = '', style, title = 'Prototype' }: Props) {
  inject()
  return (
    <svg viewBox="0 0 1024 1024" role={title ? 'img' : undefined} aria-label={title || undefined} aria-hidden={title ? undefined : true} style={style}
      className={`pl-mark ${animate === 'build' ? 'pl-build' : ''} ${className}`}>
      <defs>
        <linearGradient id="pl-bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#6d68f0" /><stop offset="1" stopColor="#312ab8" /></linearGradient>
      </defs>
      {tile && <>
        <rect width="1024" height="1024" rx="229" fill="url(#pl-bg)" />
        <rect x="4" y="4" width="1016" height="1016" rx="225" fill="none" stroke="#fff" strokeOpacity=".22" strokeWidth="8" />
      </>}
      {CUBES.map(c => {
        const pal = c.picked ? PICKED : PLAIN
        const v = (i: number) => (c.picked && animate === 'build'
          ? ({ '--pl-from': PLAIN[i], '--pl-to': PICKED[i] } as CSSProperties)
          : undefined)
        return (
          <g key={c.id} data-cube={c.id} data-picked={c.picked || undefined}>
            <path d={c.top} fill={pal[0]} style={v(0)} />
            <path d={c.left} fill={pal[1]} style={v(1)} />
            <path d={c.right} fill={pal[2]} style={v(2)} />
          </g>
        )
      })}
    </svg>
  )
}

/** One isometric cube in the mark's own geometry and shading, for building scenes. */
export function Cube({ picked = false, size = 64, className = '', style }: { picked?: boolean; size?: number; className?: string; style?: CSSProperties }) {
  const pal = picked ? PICKED : PLAIN
  // cube 3 of the mark, re-based to a 256-wide box
  return (
    <svg viewBox="313 202 257 296" width={size} height={size * 296 / 257} className={className} style={style} aria-hidden>
      <path d={CUBES[2].top} fill={pal[0]} />
      <path d={CUBES[2].left} fill={pal[1]} />
      <path d={CUBES[2].right} fill={pal[2]} />
    </svg>
  )
}

export const BRAND = {
  violet: '#6d68f0', deep: '#312ab8', ink: '#5a53e3', mid: '#7f7af4', soft: '#c4c1fc',
  plain: PLAIN, picked: PICKED,
}
