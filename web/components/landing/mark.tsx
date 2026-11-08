// The Prototype mark for the landing, path for path from site/src/components/logo.tsx (never redrawn),
// which stays as it is for prototypes that import it through @project. Here the build-up animation
// lives in globals.css (.pl-mark): no <style> made at runtime and no inline style, both of which the
// CSP refuses. Five isometric cubes, each a <g data-cube="1..5">, the picked one (5) purple.
const PLAIN = ['#ffffff', '#e6e4fc', '#c9c6f5']
const PICKED = ['#c4c1fc', '#7f7af4', '#5a53e3']

export const CUBES: { id: number; top: string; left: string; right: string; picked?: boolean }[] = [
  { id: 1, top: 'M441.69 526.76L569.53 600.57L441.69 674.38L313.85 600.57Z', left: 'M313.85 748.19L441.69 822L441.69 674.38L313.85 600.57Z', right: 'M569.53 748.19L441.69 822L441.69 674.38L569.53 600.57Z' },
  { id: 2, top: 'M441.69 364.38L569.53 438.19L441.69 512L313.85 438.19Z', left: 'M313.85 585.81L441.69 659.62L441.69 512L313.85 438.19Z', right: 'M569.53 585.81L441.69 659.62L441.69 512L569.53 438.19Z' },
  { id: 3, top: 'M441.69 202L569.53 275.81L441.69 349.62L313.85 275.81Z', left: 'M313.85 423.43L441.69 497.24L441.69 349.62L313.85 275.81Z', right: 'M569.53 423.43L441.69 497.24L441.69 349.62L569.53 275.81Z' },
  { id: 4, top: 'M582.31 445.57L710.15 519.38L582.31 593.19L454.47 519.38Z', left: 'M454.47 667L582.31 740.81L582.31 593.19L454.47 519.38Z', right: 'M710.15 667L582.31 740.81L582.31 593.19L710.15 519.38Z' },
  { id: 5, top: 'M582.31 283.19L710.15 357L582.31 430.81L454.47 357Z', left: 'M454.47 504.62L582.31 578.43L582.31 430.81L454.47 357Z', right: 'M710.15 504.62L582.31 578.43L582.31 430.81L710.15 357Z', picked: true },
]

export const BRAND = { violet: '#6d68f0', deep: '#312ab8', ink: '#5a53e3', mid: '#7f7af4', soft: '#c4c1fc', plain: PLAIN, picked: PICKED }

type Props = {
  /** The rounded purple tile behind the cubes, as in the app icon. */
  tile?: boolean
  /** 'build' drops the cubes in one by one, then lifts and colors the picked one. 'none' is still. */
  animate?: 'build' | 'none'
  className?: string
  /** The accessible name; empty makes it decorative. */
  title?: string
}

export function LogoMark({ tile = false, animate = 'build', className = '', title = 'Prototype' }: Props) {
  return (
    <svg viewBox="0 0 1024 1024" role={title ? 'img' : undefined} aria-label={title || undefined} aria-hidden={title ? undefined : true}
      className={`pl-mark ${animate === 'build' ? 'pl-build' : ''} ${className}`}>
      {tile && <>
        <defs><linearGradient id="pl-bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#6d68f0" /><stop offset="1" stopColor="#312ab8" /></linearGradient></defs>
        <rect width="1024" height="1024" rx="229" fill="url(#pl-bg)" />
        <rect x="4" y="4" width="1016" height="1016" rx="225" fill="none" stroke="#fff" strokeOpacity=".22" strokeWidth="8" />
      </>}
      {CUBES.map(c => {
        const pal = c.picked ? PICKED : PLAIN
        return (
          <g key={c.id} data-cube={c.id} data-picked={c.picked || undefined}>
            <path d={c.top} fill={pal[0]} />
            <path d={c.left} fill={pal[1]} />
            <path d={c.right} fill={pal[2]} />
          </g>
        )
      })}
    </svg>
  )
}

/** One isometric cube in the mark's own geometry and shading, for building scenes. */
export function Cube({ picked = false, size = 64, className = '' }: { picked?: boolean; size?: number; className?: string }) {
  const pal = picked ? PICKED : PLAIN
  // Cube 3 of the mark, re-based to a 257-wide box.
  return (
    <svg viewBox="313 202 257 296" width={size} height={size * 296 / 257} className={className} aria-hidden="true">
      <path d={CUBES[2].top} fill={pal[0]} />
      <path d={CUBES[2].left} fill={pal[1]} />
      <path d={CUBES[2].right} fill={pal[2]} />
    </svg>
  )
}
