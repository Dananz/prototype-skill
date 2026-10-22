// Five small checkout layouts drawn in a 100x100 square, laid onto a cube's top face by an
// isometric matrix (u runs up-right, v down-right). p: how purple the face is; hl: hovered.
import { BRAND } from './logo'

const mixHex = (a: string, b: string, k: number) => {
  const c = (h: string, i: number) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16)
  return `rgb(${[0, 1, 2].map(i => Math.round(c(a, i) + (c(b, i) - c(a, i)) * k)).join(',')})`
}

export function MiniUI({ i, p, hl }: { i: number; p: number; hl: boolean }) {
  const ink = hl ? BRAND.violet : mixHex('#121019', BRAND.deep, p)
  const bar = mixHex('#e6e4fc', '#ffffff', p)
  const line = { stroke: mixHex('#d6d2f5', '#ffffff', p), strokeWidth: 1, vectorEffect: 'non-scaling-stroke' as const }
  const R = (x: number, y: number, w: number, h: number, fill: string, stroke = false) => (
    <rect x={x} y={y} width={w} height={h} rx={2.5} fill={fill} {...(stroke ? line : {})} />
  )
  const field = (x: number, y: number, w = 80) => R(x, y, w, 10, '#ffffff', true)
  const letter = (
    <text x={10} y={9.5} fontSize={7} fontWeight={600} fill={mixHex('#8d89b5', BRAND.deep, p)}
      fontFamily="'Google Sans',system-ui,sans-serif">{'ABCDE'[i]}</text>
  )
  let body
  if (i === 0) body = <>{R(10, 16, 44, 5, bar)}{field(10, 28)}{field(10, 42)}{field(10, 56)}{R(10, 74, 80, 13, ink)}</>
  else if (i === 1) body = <>
    {field(10, 16, 46)}{field(10, 30, 46)}{field(10, 44, 46)}{R(10, 74, 46, 13, ink)}
    {R(62, 16, 28, 71, mixHex('#f1effe', '#ffffff', p * 0.6))}
    {R(66, 22, 20, 4, bar)}{R(66, 30, 13, 4, bar)}{R(66, 76, 20, 6, ink)}
  </>
  else if (i === 2) body = <>
    {R(10, 16, 24, 5, ink)}{R(38, 16, 24, 5, bar)}{R(66, 16, 24, 5, bar)}
    {field(10, 30)}{field(10, 44)}{R(10, 74, 80, 13, ink)}
  </>
  else if (i === 3) body = <>
    {R(30, 15, 40, 5, bar)}{R(22, 26, 56, 22, mixHex('#c9c6f5', '#ffffff', p * 0.5))}
    {field(10, 56)}{R(10, 74, 80, 13, ink)}
  </>
  else body = <>
    {R(10, 15, 80, 13, ink)}
    <path d="M10 39H40M60 39H90" {...line} />{R(44, 37.5, 12, 3, bar)}
    {field(10, 48)}{field(10, 62)}{R(10, 78, 80, 9, '#ffffff', true)}
  </>
  return <>{letter}{body}</>
}
