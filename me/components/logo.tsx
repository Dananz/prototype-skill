// The Prototype mark, path for path from site/src/components/logo.tsx (never redrawn): five cubes, the
// picked one purple, optionally on its tile. Static: the site's build-up animation injects a <style>.
const CUBES = [
  ['M441.69 526.76L569.53 600.57L441.69 674.38L313.85 600.57Z', 'M313.85 748.19L441.69 822L441.69 674.38L313.85 600.57Z', 'M569.53 748.19L441.69 822L441.69 674.38L569.53 600.57Z'],
  ['M441.69 364.38L569.53 438.19L441.69 512L313.85 438.19Z', 'M313.85 585.81L441.69 659.62L441.69 512L313.85 438.19Z', 'M569.53 585.81L441.69 659.62L441.69 512L569.53 438.19Z'],
  ['M441.69 202L569.53 275.81L441.69 349.62L313.85 275.81Z', 'M313.85 423.43L441.69 497.24L441.69 349.62L313.85 275.81Z', 'M569.53 423.43L441.69 497.24L441.69 349.62L569.53 275.81Z'],
  ['M582.31 445.57L710.15 519.38L582.31 593.19L454.47 519.38Z', 'M454.47 667L582.31 740.81L582.31 593.19L454.47 519.38Z', 'M710.15 667L582.31 740.81L582.31 593.19L710.15 519.38Z'],
  ['M582.31 283.19L710.15 357L582.31 430.81L454.47 357Z', 'M454.47 504.62L582.31 578.43L582.31 430.81L454.47 357Z', 'M710.15 504.62L582.31 578.43L582.31 430.81L710.15 357Z'],
]
const PLAIN = ['#ffffff', '#e6e4fc', '#c9c6f5']
const PICKED = ['#c4c1fc', '#7f7af4', '#5a53e3']

export function Logo({ tile = false, className = '' }: { tile?: boolean; className?: string }) {
  return (
    <svg viewBox="0 0 1024 1024" aria-hidden="true" className={className}>
      {tile && <>
        <defs><linearGradient id="me-logo-bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#6d68f0" /><stop offset="1" stopColor="#312ab8" /></linearGradient></defs>
        <rect width="1024" height="1024" rx="229" fill="url(#me-logo-bg)" />
        <rect x="4" y="4" width="1016" height="1016" rx="225" fill="none" stroke="#fff" strokeOpacity=".22" strokeWidth="8" />
      </>}
      {CUBES.map((c, i) => <g key={i}>{c.map((d, k) => <path key={k} d={d} fill={(i === 4 ? PICKED : PLAIN)[k]} />)}</g>)}
    </svg>
  )
}
