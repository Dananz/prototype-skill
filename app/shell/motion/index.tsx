// The motion dock, as the shell sees it: shown under the design on the stage while that design has
// declared its motion (useMotion) and the reviewer asked for it, with the room it takes given up by
// the stage (--dock-h), so it never covers the design. The first take is recorded as it is shown
// (as the design arrives, once it's on); using the design lets it run live, and an edit to its
// files records it again. window.__protoMotion is the same take for
// `proto shoot --at/--frames`, which has no dock.
import { createRoot } from 'react-dom/client'
import type { Comments } from '../comments/index'
import { Dock } from './dock'
import { createPlayer, type Player } from './player'
import { motion } from './registry'
import { frame } from './take'
import { portaled } from '../portals'
import { listen } from '../quiet'

export type MotionHost = {
  /** Where the dock is drawn: a box along the bottom of the stage. */
  el: HTMLElement
  /** Gets --dock-h, the height the stage gives up. */
  zone: HTMLElement
  /** The mounted design of the one variant on the stage (not a lobby or a tool), shown or not. */
  stage: () => HTMLElement | null
  /** Whether the dock may show: not in focus mode, not in a shot. */
  show: () => boolean
  /** Whether the reviewer asked for it (Motion in the pill's menu, the bar's curves). Until then
   *  the design runs live and nothing is recorded; put away, it lets the design go and comes back
   *  as it was, as in focus mode. */
  on: () => boolean
  /** Focus mode: the dock hides and lets the design go, so it plays live, and comes back as it was. */
  focused: () => boolean
  /** Mounts the design on the stage again; resolves once it is mounted. */
  remount: () => Promise<unknown>
  comments: Comments
}

export function createMotion(o: MotionHost) {
  let host: HTMLElement | null = null, player: Player | null = null, shown = false, unwire = () => {}
  // A new dock for each design (and each player), so what was chosen on one doesn't carry over.
  let gen = 0
  const root = createRoot(o.el)
  // Put away: in focus mode, or on the page until the reviewer asks for it. A shot has no dock and
  // asks for nothing, so its takes hold.
  const putAway = () => o.focused() || (o.show() && !o.on())
  const room = () => o.zone.style.setProperty('--dock-h', `${shown ? o.el.offsetHeight : 0}px`)
  new ResizeObserver(room).observe(o.el)

  // Using the design itself (a real press or key in it, or in what it renders through a portal, such
  // as a sheet's close button) lets it run live; the dock's next move holds it again. Clicks the shell
  // replays to reach a state aren't trusted, and picking what to comment on only looks at the design.
  function wire(h: HTMLElement, p: Player) {
    const use = (e: Event) => {
      if (!e.isTrusted || o.zone.hasAttribute('data-picking')) return
      // In copy mode a press on a line opens its options, over the moment held.
      if (h.hasAttribute('data-copy-on') && (e.target as Element | null)?.closest?.('[data-copy]')) return
      p.letGo()
    }
    const usePortal = (e: Event) => { const t = e.target as Node | null; if (t?.nodeType && portaled(t)) use(e) }
    // The design's document: in a device view, the frame's.
    const d = h.ownerDocument
    h.addEventListener('pointerdown', use, true)
    h.addEventListener('keydown', use, true)
    listen(d, 'pointerdown', usePortal, true)
    listen(d, 'keydown', usePortal, true)
    return () => {
      h.removeEventListener('pointerdown', use, true); h.removeEventListener('keydown', use, true)
      d.removeEventListener('pointerdown', usePortal, true); d.removeEventListener('keydown', usePortal, true)
    }
  }

  function sync() {
    const h = o.stage(), declared = !!motion.of(h)
    // A take that mounts the design again has it undeclared for a moment; that's still this design.
    const taking = !!player && player.get().status === 'taking'
    if (player && (h !== host || (!declared && !taking))) { unwire(); player.dispose(); player = null }
    host = h
    if (h && declared && !player) {
      const p = player = createPlayer(h, { remount: o.remount })
      gen++
      const unwireUse = wire(h, p)
      // In focus mode, or put away, a take that ends (or a move that held it) lets the design go at once.
      const unsub = p.subscribe(() => { if (putAway()) p.letGo() })
      unwire = () => { unwireUse(); unsub() }
      // The first take: the design was just mounted, so it is at rest and its entrance is running.
      if (o.show() && o.on()) void p.take(true)
    }
    // Put away (in focus mode, or until asked for) it lets the design go and stays as it was.
    const want = !!player && o.show() && o.on(), away = !!player && putAway()
    if (away) player!.letGo()
    // Shown later (out of focus mode, or asked for), with nothing recorded yet: record it now.
    if (want && !shown && player!.get().status === 'off') void player!.take()
    shown = want
    o.el.hidden = !shown
    room()
    // Put away, the dock stays mounted, so it comes back with what was chosen on it.
    root.render(player && (shown || away) ? o.comments.wrap(<Dock key={gen} player={player} />) : null)
  }
  motion.subscribe(sync)

  // For `proto shoot --at/--frames` (and the smoke test): the take on the stage, recorded from rest,
  // set to any moment, its curves, and the box the motion happens in.
  const api = {
    async take() {
      if (!player) return { error: 'this design declares no motion: add useMotion (src/motion.ts)' }
      await player.take()
      const s = player.get()
      return {
        status: s.status, duration: Math.round(s.duration),
        ...(s.error ? { error: `useMotion's ${s.error}` } : {}), late: s.late,
        parts: s.take?.parts.map(p => ({ prop: p.prop, start: Math.round(p.start), end: Math.round(p.end), shoot: (p.target as HTMLElement | null)?.dataset?.shoot ?? null })) ?? [],
        tracks: s.tracks.map(tr => ({ name: tr.name, props: tr.props, start: Math.round(tr.start), end: Math.round(tr.end) })),
      }
    },
    async seek(t: number) { await player?.seek(t); await frame(); await frame(); return Math.round(player?.get().t ?? -1) },
    state: () => { const s = player?.get(); return s ? { status: s.status, t: Math.round(s.t), playing: s.playing, span: s.span, live: s.live, duration: Math.round(s.duration), error: s.error, late: s.late } : null },
    curves(steps = 160) {
      const s = player?.get()
      return s ? { duration: s.duration, tracks: s.tracks.map(tr => ({ name: tr.name, props: tr.props, color: tr.color, lines: tr.lines.map(l => l.pts.filter((_, i) => i % Math.max(1, Math.round(l.pts.length / steps)) === 0 || i === l.pts.length - 1)) })) } : null
    },
    /** The box (in CSS px of the window) every animated part covers at the start, middle and end. */
    async box() {
      const s = player?.get()
      if (!s?.take || !player) return null
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
      for (const t of [0, s.duration / 2, s.duration]) {
        await player.seek(t); await frame()
        for (const p of s.take.parts) {
          const r = p.target?.getBoundingClientRect()
          if (!r || !r.width || !r.height) continue
          x0 = Math.min(x0, r.left); y0 = Math.min(y0, r.top); x1 = Math.max(x1, r.right); y1 = Math.max(y1, r.bottom)
        }
      }
      return Number.isFinite(x0) ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null
    },
  }
  ;(window as unknown as { __protoMotion: typeof api }).__protoMotion = api

  return {
    /** The page moved or redrew: the dock follows the design on the stage. */
    sync,
    /** Files changed: the design on the stage records its take again when its prototype's own
     *  files did, or a shared helper did (another prototype's variant is no business of this one,
     *  and a meta.ts holds no motion). */
    edited(paths: string[], proto: string | null) {
      if (!player || !proto) return
      const ours = paths.some(p => !/\/meta\.ts$/.test(p) && (p.includes(`/src/protos/${proto}/`) || !/\/[A-Z]{1,2}\.\w+$/.test(p)))
      if (!ours) return
      clearTimeout(editTimer)
      editTimer = window.setTimeout(() => player?.edited(), 350)
    },
  }
}
let editTimer = 0
export type MotionDock = ReturnType<typeof createMotion>
