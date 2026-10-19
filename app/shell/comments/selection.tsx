// Words highlighted on the design: a small toolbar floats right above them with two icon buttons,
// Generate copy options and Comment on this text. A comment starts with the words quoted; copy
// options on a line the design declares (useCopy) open that line's picker, and on any other words
// ask Claude for options for just those words, with an optional note (tone, length) typed in the
// toolbar first. The toolbar is only there while the page is idle (not picking, not writing a
// comment, not in copy mode), and on a finger it waits for the selection to settle and sits below
// the words, where the system's own Copy and Look Up callout isn't.
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { useCtx } from './ctx'
import { describe, rectIn } from './dom'
import { frameSelections } from '../view/frame'
import { useStore } from './store'
import type { Box, Target } from './types'
import { Icon } from './ui'
import { t } from '../i18n'

type Sel = { text: string; target: Target; line?: string }

const coarse = () => matchMedia('(pointer: coarse)').matches
const clip = (s: string, n = 140) => s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s
const btn = 'grid size-8 place-items-center rounded-lg text-zinc-100 outline-none hover:bg-white/15 focus-visible:bg-white/15'

/** A name for a button, above it, on hover (after a moment) and on keyboard focus. */
function Tip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="group/tip relative inline-flex">
      {children}
      <span role="tooltip" className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 -translate-x-1/2 whitespace-nowrap rounded-md bg-zinc-950 px-2 py-1 text-[11px] font-medium text-zinc-100 opacity-0 shadow-md ring-1 ring-white/10 transition-opacity group-hover/tip:opacity-100 group-hover/tip:delay-300 group-focus-within/tip:opacity-100 [@media(pointer:coarse)]:hidden">{label}</span>
    </span>
  )
}

export function Selection() {
  const { host, store, act, copyStore, copyAct } = useCtx()
  const s = useStore(store)
  const cs = useSyncExternalStore(copyStore.subscribe, copyStore.get)
  const on = !!s.place && s.mode.kind === 'idle' && !cs.on
  const [sel, setSel] = useState<Sel | null>(null)
  const [box, setBox] = useState<Box | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [said, setSaid] = useState('')
  const range = useRef<Range | null>(null)
  const frame = useRef<HTMLDivElement>(null)
  const [at, setAt] = useState<{ left: number; top: number } | null>(null)
  // The note field takes the focus, which drops the highlight in the page: what was highlighted is kept meanwhile.
  const locked = useRef(false)
  locked.current = note !== null || !!said

  const forget = () => { locked.current = false; range.current = null; setSel(null); setBox(null); setNote(null); setSaid('') }
  const unhighlight = () => host.mount()?.ownerDocument.getSelection()?.removeAllRanges()

  // What is highlighted in the design, and what it is on.
  useEffect(() => {
    if (!on) { forget(); return }
    let timer = 0
    const read = () => {
      if (locked.current) return
      const mount = host.mount(), g = mount?.ownerDocument.getSelection()
      if (!mount || !g || g.isCollapsed || !g.rangeCount) { range.current = null; setSel(null); return }
      const r = g.getRangeAt(0), n = r.commonAncestorContainer
      const e = (n.nodeType === 1 ? n : n.parentElement) as HTMLElement | null
      const text = g.toString().replace(/\s+/g, ' ').trim()
      if (!e || e === mount || !mount.contains(e) || text.length < 2 || e.closest('input, textarea, [contenteditable=true], [data-inspect-ui]')) { range.current = null; setSel(null); return }
      const v = host.view?.()
      const t = describe(mount, e)
      const id = e.closest<HTMLElement>('[data-copy]')?.dataset.copy
      range.current = r.cloneRange()
      setSel({ text, target: v?.size ? { ...t, view: { size: v.size, w: v.w!, h: v.h! } } : t, ...(id && copyAct.lines().some(l => l.id === id) ? { line: id } : {}) })
    }
    // Settled: the pointer is up, or the finger has stopped moving its handles.
    const soon = () => { clearTimeout(timer); timer = window.setTimeout(read, coarse() ? 350 : 60) }
    document.addEventListener('selectionchange', soon)
    frameSelections.add(soon)
    soon()
    return () => { clearTimeout(timer); document.removeEventListener('selectionchange', soon); frameSelections.delete(soon) }
  }, [on, host, copyAct])

  // Where it is, kept in step with scrolling and resizing.
  useEffect(() => {
    if (!sel) { setBox(null); return }
    let raf = 0, last = ''
    const tick = () => {
      const r = range.current, doc = host.mount()?.ownerDocument
      if (r && doc) {
        const b = rectIn(r.getBoundingClientRect(), doc, host.layer), k = `${Math.round(b.x)},${Math.round(b.y)},${Math.round(b.w)},${Math.round(b.h)}`
        if (k !== last) { last = k; setBox(b) }
      }
      raf = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [sel, host])

  // Above the words on a pointer, below them on a finger; kept inside the layer.
  useLayoutEffect(() => {
    const el = frame.current
    if (!el || !box) return
    const w = el.offsetWidth, h = el.offsetHeight, W = host.layer.clientWidth
    const left = Math.min(Math.max(box.x + box.w / 2 - w / 2, 8), Math.max(8, W - w - 8))
    const above = box.y - h - 8
    const top = !coarse() && above >= 4 ? above : box.y + box.h + (coarse() ? 26 : 8)
    setAt(p => p && p.left === left && p.top === top ? p : { left, top })
  })

  if (!on || !sel || !box || box.w < 1 || box.y + box.h < 0 || box.y > host.layer.clientHeight) return null
  const target = sel.target

  const comment = () => {
    const q = clip(sel.text)
    unhighlight(); forget()
    act.begin(target, q)
  }
  const copyOptions = () => {
    if (!sel.line) { setNote(''); return }
    // A line the design declares has its picker: the options are listed under it, in place.
    const id = sel.line
    unhighlight(); forget()
    if (!copyStore.get().on) copyAct.toggle()
    copyAct.show(id)
  }
  const send = async () => {
    const q = clip(sel.text), words = note ?? ''
    setNote(null)
    try {
      await act.askCopy(target, q, words)
      setSaid(t('Asked for copy options'))
    } catch (e) {
      setSaid(e instanceof Error ? e.message : t('Could not send'))
    }
    window.setTimeout(() => { unhighlight(); forget() }, 1600)
  }

  return (
    <>
      {/* The highlight goes when the note field takes the focus: drawn here until the toolbar does. */}
      {note !== null && !said && <div aria-hidden className="pointer-events-none absolute z-20 rounded-sm bg-proto-primary/25" style={{ left: box.x, top: box.y, width: box.w, height: box.h }} />}
    <div ref={frame} data-inspect-ui data-shoot="selection-menu" role="toolbar" aria-label={t('Highlighted text')}
      onMouseDown={e => { if ((e.target as HTMLElement).tagName !== 'INPUT') e.preventDefault() }}
      className="pointer-events-auto absolute z-30 flex items-center gap-0.5 rounded-xl bg-zinc-900 p-1 shadow-lg shadow-black/20 ring-1 ring-white/10 dark:bg-zinc-800 dark:ring-white/15"
      style={{ left: at?.left ?? box.x, top: at?.top ?? box.y, visibility: at ? 'visible' : 'hidden' }}>
      {said ? (
        <span role="status" data-shoot="selection-said" className="flex h-8 items-center gap-1.5 px-2 text-xs font-medium text-zinc-100"><Icon name="check" className="size-3.5 text-emerald-400" />{said}</span>
      ) : note !== null ? (
        <>
          <Tip label={t('Back · Esc')}><button type="button" onClick={() => setNote(null)} aria-label={t('Back')} className={btn}><Icon name="left" /></button></Tip>
          <input autoFocus value={note} onChange={e => setNote(e.target.value)} maxLength={80} placeholder={t('Tone or length? (optional)')} aria-label={t('Tone or length (optional)')} dir="auto"
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void send() } if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setNote(null) } }}
            className="h-8 w-44 rounded-lg bg-white/10 px-2 text-[13px] text-zinc-50 outline-none placeholder:text-zinc-400 focus:bg-white/15 [@media(pointer:coarse)]:text-base" />
          <Tip label={t('Generate copy options · Enter')}><button type="button" data-shoot="selection-send" onClick={() => void send()} aria-label={t('Generate copy options')} className={`${btn} bg-proto-primary hover:bg-proto-primary-hover`}><Icon name="send" className="size-3.5" /></button></Tip>
        </>
      ) : (
        <>
          <Tip label={t('Generate copy options')}><button type="button" data-shoot="selection-copy" onClick={copyOptions} aria-label={t('Generate copy options')} className={btn}><Icon name="text" /></button></Tip>
          <Tip label={t('Comment on this text')}><button type="button" data-shoot="selection-comment" onClick={comment} aria-label={t('Comment on this text')} className={btn}><Icon name="comment" /></button></Tip>
        </>
      )}
    </div>
    </>
  )
}
