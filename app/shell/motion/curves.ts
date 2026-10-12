// The curves: each captured animation's eased progress over the take (0 at rest, 1 at its end, past
// 1 where a spring overshoots), named by what it moves, with staggered siblings as one line each in
// one group. Worked out from each part's timing and keyframes, so drawing them never moves the design.
import type { Part, Take } from './take'

/** One animation's progress over the take, as [ms, progress] points. */
export type Line = { pts: [number, number][]; start: number; end: number }
/** What the legend lists: one element's motion, or siblings moving alike one after another. */
export type Track = { id: string; name: string; props: string; color: string; start: number; end: number; lines: Line[] }

export const COLORS = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#f43f5e', '#a855f7', '#14b8a6', '#eab308']

// The progress an effect's own easing gives, read off a throwaway animation with the same timing:
// getComputedTiming().progress is already eased. Nothing is attached to the page.
function probe(timing: EffectTiming) {
  const a = new Animation(new KeyframeEffect(null, [], { ...timing, fill: 'both' }))
  return (local: number) => { a.currentTime = local; return a.effect!.getComputedTiming().progress ?? 0 }
}
const eases = new Map<string, (x: number) => number>()
function ease(e: string) {
  let f = eases.get(e)
  if (!f) { const p = probe({ duration: 1000, easing: e }); f = (x: number) => p(x * 1000); eases.set(e, f) }
  return f
}

/** The part's eased progress at take time t. A CSS animation's timing function is on its keyframes,
 *  not the effect (its progress alone is linear), so each keyframe's easing is applied on top. */
export function progressOf(p: Part) {
  const at = probe(p.timing)
  const segs = p.keyframes.map(k => ({ o: Number(k.computedOffset), e: k.easing ?? 'linear' }))
  const flat = segs.every(s => s.e === 'linear')
  return (t: number) => {
    const x = at((t - p.offset) * p.rate)
    if (flat || segs.length < 2) return x
    let i = segs.length - 2
    for (let j = 0; j < segs.length - 1; j++) if (x <= segs[j + 1].o) { i = j; break }
    const a = segs[i], span = segs[i + 1].o - a.o
    return span > 0 ? a.o + ease(a.e)((x - a.o) / span) * span : x
  }
}

const nice = (s: string) => { const t = s.replace(/[-_]+/g, ' ').trim(); return t.charAt(0).toUpperCase() + t.slice(1) }
/** What a part moves, by name: its data-shoot, its label, the component it is written in (not the
 *  variant's own), a short text, else its tag. */
export function nameOf(el: Element | null, root: Element | null) {
  // Not by instanceof: a design in a device view's frame is another window's.
  if (!el || !('dataset' in el)) return 'Animation'
  const h = el as HTMLElement
  if (h.dataset.shoot) return nice(h.dataset.shoot)
  const own = el.getAttribute('aria-label')?.trim()
  if (own) return own
  const comp = h.dataset.protoComponent
  if (comp && comp !== (root as HTMLElement | null)?.dataset?.protoComponent) return comp
  const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim()
  if (text && text.length <= 24) return `“${text}”`
  return el.tagName.toLowerCase()
}

const sig = (p: Part) => JSON.stringify([p.timing.duration, p.timing.easing, p.timing.iterations, p.timing.direction, p.keyframes.map(k => k.easing)])
// Siblings written on one line of a prototype file (rows from a .map) carry the same data-proto-src;
// anything else counts as a sibling by its parent, tag and classes.
const familyOf = (el: Element | null) => !el ? '' : (el as HTMLElement).dataset?.protoSrc ?? `${el.parentElement ? [...(el.parentElement.parentElement?.children ?? [])].indexOf(el.parentElement) : -1}>${el.tagName}.${el.getAttribute('class') ?? ''}`

export function tracksOf(take: Take, root: Element | null, steps = 180): Track[] {
  // One element's properties moving with the same timing are one line (a row's opacity and transform).
  const lines: { parts: Part[]; props: Set<string> }[] = []
  for (const p of take.parts) {
    const same = lines.find(l => l.parts[0].target === p.target && Math.abs(l.parts[0].start - p.start) < 1 && sig(l.parts[0]) === sig(p))
    if (same) { same.parts.push(p); same.props.add(p.prop) } else lines.push({ parts: [p], props: new Set([p.prop]) })
  }
  // One group per element (a button's quick fade and its slower pop), and siblings moving alike at
  // different times are one group too: a stagger.
  const groups: (typeof lines)[] = []
  for (const l of lines) {
    const p = l.parts[0], props = [...l.props].sort().join()
    const g = groups.find(g => g.some(x => x.parts[0].target === p.target)) ?? groups.find(g => {
      const q = g[0].parts[0]
      return familyOf(q.target) === familyOf(p.target) && [...g[0].props].sort().join() === props && sig(q) === sig(p)
    })
    if (g) g.push(l); else groups.push([l])
  }
  const dt = Math.max(1, take.duration / steps)
  return groups.map((g, i) => {
    const name = nameOf(g[0].parts[0].target, root), n = new Set(g.map(l => l.parts[0].target)).size
    return {
      id: `${i}:${name}`, name: n > 1 ? `${name} ×${n}` : name, props: [...new Set(g.flatMap(l => [...l.props]))].join(', '), color: COLORS[i % COLORS.length],
      start: Math.min(...g.map(l => l.parts[0].start)), end: Math.max(...g.map(l => l.parts[0].end)),
      lines: g.map(l => {
        const p = l.parts[0], at = progressOf(p), pts: [number, number][] = []
        for (let t = p.start; t < p.end; t += dt) pts.push([t, at(t)])
        pts.push([p.end, at(p.end)])
        return { pts, start: p.start, end: p.end }
      }),
    }
  })
}
