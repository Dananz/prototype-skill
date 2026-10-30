// Where everything sits on the map, in world pixels: each design's flows as rows of screens (a
// screen is its variant at its frame size), the explorations built on a screen below it, and the
// explorations on no screen in a strip on top. An exploration with a pick folds into a stack that
// shows the pick; an open one is spread out, one card per option (full until picked). Pure.
import type { Design, Proto } from '../shell'

export const GAP = 200, PER_ROW = 6, CARD = 0.36, CARD_GAP = 40, ROW_GAP = 320, LABEL_H = 120, BELOW = 300
export type Board = {
  key: string; kind: 'screen' | 'option'; route: string; slug: string; letter: string; title: string
  x: number; y: number; w: number; h: number
  /** Option cards are drawn at CARD of their frame. */
  scale: number
  design?: string; flow?: string; picked?: boolean; standIn?: boolean
  /** An option card in a stack: its place in the pile (0 on top). */
  pile?: number
}
export type Label = { key: string; kind: 'design' | 'flow' | 'round' | 'section'; text: string; x: number; y: number; count?: number; route?: string; slug?: string; open?: boolean; state?: 'open' | 'done'
  /** A round: its width in world pixels; own: a screen's own options, named by the screen above it. */
  w?: number; own?: boolean }
export type World = { boards: Board[]; labels: Label[]; w: number; h: number }

export const frameOf = (p: Proto): [number, number] => p.kind === 'phone' ? p.screen : [1200, 750]
const roots = (protos: Proto[]) => {
  const byId = new Map(protos.map(p => [p.id, p]))
  // The screen or loose exploration a prototype hangs under: up its from chain, stopping at a loop.
  const top = (p: Proto) => { const seen = new Set([p.id]); let at = p; while (at.from && byId.has(at.from.proto) && !seen.has(at.from.proto)) { at = byId.get(at.from.proto)!; seen.add(at.id) } return at }
  return { byId, top }
}

/** spread: the stacks the user opened (slugs); an exploration with no pick is always spread. */
export function worldOf(protos: Proto[], designs: Design[], spread: Set<string> = new Set()): World {
  const live = protos.filter(p => !p.archived)
  const { byId, top } = roots(live)
  const boards: Board[] = [], labels: Label[] = []
  const onScreen = new Set<string>()
  for (const d of designs) for (const f of d.flows) for (const x of f.screens) onScreen.add(x.split('/')[0])
  // A screen's rounds hang under its unpinned entry; when it is only pinned (a share pins them all), under that.
  const unpinned = new Set(designs.flatMap(d => d.flows.flatMap(f => f.screens.filter(x => !x.includes('/')))))

  // An exploration as a round: its title, then a stack (its pick on top) or its options in a row.
  const round = (p: Proto, x: number, y: number, own = false): number => {
    const [fw, fh] = frameOf(p), cw = fw * CARD, ch = fh * CARD
    const open = !p.picked || spread.has(p.id)
    const label: Label = { key: `round:${p.id}`, kind: 'round', text: p.title, x, y, count: p.variants.length, slug: p.id, route: `${p.id}/${p.picked ?? p.variants[0]?.id ?? 'A'}`, open, state: p.picked ? 'done' : 'open', ...(own ? { own } : {}) }
    labels.push(label)
    const y0 = y
    if (open) {
      p.variants.forEach((v, i) => boards.push({ key: `opt:${p.id}/${v.id}`, kind: 'option', route: `${p.id}/${v.id}`, slug: p.id, letter: v.id, title: v.name, x: x + i * (cw + CARD_GAP), y: y0, w: cw, h: ch, scale: CARD, picked: p.picked === v.id }))
      return (label.w = Math.max(cw, p.variants.length * (cw + CARD_GAP) - CARD_GAP))
    }
    const order = [p.picked!, ...p.variants.map(v => v.id).filter(v => v !== p.picked)].slice(0, 3)
    order.forEach((id, k) => boards.push({ key: `opt:${p.id}/${id}`, kind: 'option', route: `${p.id}/${id}`, slug: p.id, letter: id, title: p.variants.find(v => v.id === id)?.name ?? id, x: x + k * 18, y: y0 + k * 18, w: cw, h: ch, scale: CARD, picked: id === p.picked, pile: k }))
    return (label.w = cw + 36)
  }
  // The rounds under one screen (or loose root): it and everything built on it, side by side.
  const under = (slug: string) => live.filter(p => p.id !== slug && top(p).id === slug).sort((a, b) => a.created.localeCompare(b.created))
  const roundH = (p: Proto) => frameOf(p)[1] * CARD + (p.picked && !spread.has(p.id) ? 36 : 0)

  let y = 0, w = 0
  const loose = live.filter(p => !onScreen.has(p.id) && top(p).id === p.id).sort((a, b) => b.created.localeCompare(a.created))
  if (loose.length) {
    y += LABEL_H
    labels.push({ key: 'section:loose', kind: 'section', text: 'Explorations on no screen', x: 0, y })
    let x = 0, h = 0
    for (const p of loose) {
      for (const r of [p, ...under(p.id)]) { const rw = round(r, x, y); x += rw + GAP; h = Math.max(h, roundH(r)) }
      x += GAP
    }
    w = Math.max(w, x); y += h + ROW_GAP
  }
  for (const d of designs) {
    y += LABEL_H
    labels.push({ key: `design:${d.id}`, kind: 'design', text: d.title, x: 0, y })
    for (const f of d.flows) {
      const screens = f.screens.map(e => { const [slug, pin = ''] = e.split('/'); return { p: byId.get(slug), pin } }).filter((s): s is { p: Proto; pin: string } => !!s.p)
      if (!screens.length) continue
      y += LABEL_H
      labels.push({ key: `flow:${d.id}:${f.name}`, kind: 'flow', text: f.name, x: 0, y, count: screens.length })
      for (let row = 0; row * PER_ROW < screens.length; row++) {
        let x = 0, below = 0
        const part = screens.slice(row * PER_ROW, row * PER_ROW + PER_ROW)
        const rowH = Math.max(...part.map(s => frameOf(s.p)[1]))
        for (const { p, pin } of part) {
          const [fw, fh] = frameOf(p), letter = pin || p.picked || p.variants[0]?.id || 'A'
          boards.push({ key: `screen:${p.id}${pin ? `/${pin}` : ''}`, kind: 'screen', route: `${p.id}/${letter}`, slug: p.id, letter, title: p.title, x, y, w: fw, h: fh, scale: 1, design: d.id, flow: f.name, ...(!pin && !p.picked ? { standIn: true } : {}) })
          // Its own options as a round under it, then the explorations built on it.
          let ry = y + rowH + BELOW, rw = fw
          for (const r of pin && unpinned.has(p.id) ? [] : [p, ...under(p.id)]) { const used = round(r, x, ry, r === p); rw = Math.max(rw, used); ry += roundH(r) + BELOW }
          below = Math.max(below, ry - (y + rowH))
          x += rw + GAP
        }
        w = Math.max(w, x); y += rowH + below + ROW_GAP
      }
    }
  }
  return { boards, labels, w, h: y }
}

/** The screens' links as lines: from the right or bottom edge of one board to the other. */
export function linePath(a: Board, b: Board): string {
  if (Math.abs(b.y - a.y) > a.h) {
    const down = b.y > a.y, p1 = { x: a.x + a.w * 0.75, y: down ? a.y + a.h : a.y }, p2 = { x: b.x + b.w * 0.25, y: down ? b.y : b.y + b.h }
    const dy = Math.max(120, Math.abs(p2.y - p1.y) / 2) * (down ? 1 : -1)
    return `M${p1.x},${p1.y} C${p1.x},${p1.y + dy} ${p2.x},${p2.y - dy} ${p2.x},${p2.y}`
  }
  const right = b.x + b.w / 2 >= a.x + a.w / 2
  const p1 = { x: right ? a.x + a.w : a.x, y: a.y + a.h / 2 }, p2 = { x: right ? b.x : b.x + b.w, y: b.y + b.h / 2 }
  const dx = Math.max(100, Math.abs(p2.x - p1.x) / 2) * (right ? 1 : -1)
  return `M${p1.x},${p1.y} C${p1.x + dx},${p1.y} ${p2.x - dx},${p2.y} ${p2.x},${p2.y}`
}
