// An image pasted or dropped into a comment box sits in the words where it was put, as a chip: a
// small picture and a short name (a screenshot's date and time taken out). Hovering it shows the
// picture, its full name and its file's facts; a click (or a tap, or a click on that picture) opens it
// full screen. One peek and one full-screen view serve every chip, in every comment box and every
// comment shown, through the page's own events: the boxes' chips are DOM nodes inside a
// contentEditable, where React can't hold a tooltip of its own.
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { uiBox } from '../portals'
import { listen } from '../quiet'
import { t } from '../i18n'
import { imageUrl } from './images'
import { isImg, type Seg, type Shot } from './types'

// What a box's chips stand for, by id, so a chip undone back into a box (⌘Z) still knows its image.
const known = new Map<string, Shot>()
let seq = 0
const newId = () => `img-${Date.now().toString(36)}-${(seq++).toString(36)}`
export const rememberImage = (s: Shot): Shot => { const shot = { ...s, id: s.id ?? newId() }; known.set(shot.id!, shot); return shot }
export const imageOf = (id: string | undefined) => (id ? known.get(id) : undefined)

/** A pasted or dropped file, read as an inline picture with its own facts. */
export async function imageShot(file: File, from: 'paste' | 'drop'): Promise<Shot | null> {
  const read = await imageUrl(file)
  if (!read) return null
  const type = (file.type.split('/')[1] || '').replace(/\+.*$/, '').toUpperCase()
  return rememberImage({ src: read.src, pasted: true, inline: true, name: file.name || '', bytes: file.size, w: read.w, h: read.h, ...(type ? { type } : {}), from })
}

const GENERIC = /^(image|img|pasted image|clipboard|untitled|photo|picture|unknown)$/i
/**
 * A name short enough to sit in a sentence: the extension, dates, times and camera counters a
 * screenshot tool or a phone adds are taken out ("Zen Browser 2026-11-07 2.05.53 AM.png" is "Zen
 * Browser"). A name that says nothing then ("image.png") is "Image 2", by its place in the comment.
 */
export function shortName(name: string | undefined, n: number) {
  let s = (name ?? '').replace(/\.[a-z0-9]{2,5}$/i, '')
  s = s.replace(/\b(19|20)\d{2}[-_.]?\d{2}[-_.]?\d{2}\b/g, ' ')
  s = s.replace(/\b(at\s+)?\d{1,2}[.:]\d{2}([.:]\d{2})?(\s*[AP]M)?\b/gi, ' ')
  s = s.replace(/\b(IMG|DSC|PXL|DCIM)[_-]?\d*\b/gi, ' ').replace(/\(\d+\)|\bcopy\b|\bHDR\b/gi, ' ')
  s = s.replace(/[_]+/g, ' ').replace(/\s{2,}/g, ' ').trim().replace(/^[-,.\s]+|[-,.\s]+$/g, '')
  if (/^(screen ?shot|cleanshot)$/i.test(s)) s = t('Screenshot')
  if (!s || GENERIC.test(s)) return t('Image {n}', { n })
  return s.length > 18 ? `${s.slice(0, 17).trimEnd()}…` : s
}

const kb = (b: number) => b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`
/** Its file's facts, in one line: size, px, type, where it came from. What a picture saved before has. */
export const factsOf = (s: Shot) => [s.bytes ? kb(s.bytes) : '', s.w && s.h ? `${s.w} × ${s.h}` : '', s.type ?? '', s.from === 'drop' ? t('Dropped') : s.from === 'paste' ? t('Pasted') : ''].filter(Boolean)

const CHIP = 'mx-px inline-flex h-[1.35em] max-w-[14rem] cursor-pointer items-center gap-1 rounded-md bg-proto-primary-soft ps-[2px] pe-1.5 align-middle font-medium leading-none text-proto-primary-soft-fg select-none'
const THUMB = 'size-[1.05em] shrink-0 rounded-[4px] object-cover ring-1 ring-black/10 dark:ring-white/20'
const X = '<svg class="size-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>'

/** The chip in a comment box: not editable itself, with × to take it out. */
export function imageNode(shot: Shot, n: number) {
  const s = document.createElement('span')
  s.contentEditable = 'false'
  s.dataset.img = shot.id!
  s.tabIndex = 0
  s.setAttribute('role', 'button')
  s.className = CHIP
  const img = document.createElement('img')
  img.src = shot.src; img.alt = ''; img.className = THUMB
  const name = document.createElement('span')
  name.dataset.imgName = ''
  // The chip reads the way its sentence does (its picture first); the name keeps its own direction.
  name.dir = 'auto'
  name.className = 'min-w-0 truncate'
  name.textContent = shortName(shot.name, n)
  s.setAttribute('aria-label', shot.name || name.textContent)
  const x = document.createElement('button')
  x.type = 'button'
  x.tabIndex = -1
  x.dataset.imgRemove = ''
  x.className = '-me-1 grid size-4 shrink-0 place-items-center rounded hover:bg-zinc-900/10 dark:hover:bg-white/10'
  x.setAttribute('aria-label', t('Remove the image'))
  x.title = t('Remove the image')
  x.innerHTML = X
  s.append(img, name, x)
  return s
}

/** "Image 2" follows the chip's place: names are set again, in order, after each change in the box. */
export function relabel(el: HTMLElement, before = 0) {
  el.querySelectorAll<HTMLElement>('[data-img]').forEach((chip, k) => {
    const shot = imageOf(chip.dataset.img), name = chip.querySelector('[data-img-name]')
    if (shot && name) name.textContent = shortName(shot.name, before + k + 1)
  })
}

/** What a box's editor holds: words, tags and its images by chip id. */
export type RawSeg = Seg | { imgId: string }
/**
 * A box's words with its images, as a comment keeps them: the box's other pictures first (screenshots,
 * images pasted before images went inline), then each image still in the words, in order.
 */
export function settle(raw: RawSeg[], keep: Shot[]): { body: Seg[]; shots: Shot[] } {
  const inline: Shot[] = []
  const body = raw.flatMap((s): Seg[] => {
    if (typeof s === 'string' || !('imgId' in s)) return [s]
    const shot = imageOf(s.imgId)
    if (!shot) return []
    inline.push(shot)
    return [{ img: keep.length + inline.length - 1 }]
  })
  return { body, shots: [...keep, ...inline] }
}

/** Fills a box with what a comment had: its words, tags (by `tag`) and images, as chips again. */
export function fill(el: HTMLElement, body: Seg[], shots: Shot[], tag: (i: number) => Node) {
  let n = 0
  body.forEach(s => {
    if (typeof s === 'string') el.append(document.createTextNode(s))
    else if (isImg(s)) { const shot = shots[s.img]; if (shot) el.append(imageNode(rememberImage(shot), shots.filter(p => !p.inline).length + ++n)) }
    else el.append(tag(s.tag))
  })
}
/** A comment's pictures that are not in its words: those stay in the strip under them. */
export const besideWords = (body: Seg[], shots: Shot[]) => shots.filter((_, k) => !body.some(s => isImg(s) && s.img === k))

/** Puts a chip where the caret is in a box, with a space after it, and the caret after that. */
export function insertImage(r: Range, shot: Shot, n: number) {
  const chip = imageNode(shot, n), space = document.createTextNode(' ')
  r.deleteContents()
  r.insertNode(space); r.insertNode(chip)
  const after = document.createRange(); after.setStartAfter(space); after.collapse(true)
  const sel = getSelection(); sel?.removeAllRanges(); sel?.addRange(after)
}

/** The chip in a comment shown (the list, a thread, the pin's card). */
export function InlineImage({ shot, n }: { shot: Shot; n: number }) {
  const s = rememberImage(shot)
  return (
    <span data-img={s.id} role="button" tabIndex={0} aria-label={s.name || shortName(s.name, n)} className={CHIP}>
      <img src={s.src} alt="" className={THUMB} /><span dir="auto" className="min-w-0 truncate">{shortName(s.name, n)}</span>
    </span>
  )
}

// ---------- the peek on hover, and the picture full screen ----------
type Peek = { shot: Shot; chip: HTMLElement }
export function ImagePeek() {
  const [peek, setPeek] = useState<Peek | null>(null)
  const [full, setFull] = useState<Shot | null>(null)
  const timer = useRef(0)
  const pop = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const chipOf = (e: Event) => (e.target as Element | null)?.closest?.<HTMLElement>('[data-img]') ?? null
    const show = (chip: HTMLElement, wait: number) => {
      const shot = imageOf(chip.dataset.img)
      if (!shot) return
      clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setPeek({ shot, chip }), wait)
    }
    const hide = (wait = 120) => { clearTimeout(timer.current); timer.current = window.setTimeout(() => setPeek(null), wait) }
    const over = (e: PointerEvent) => {
      if (pop.current?.contains(e.target as Node)) { clearTimeout(timer.current); return }
      const chip = chipOf(e)
      if (chip && e.pointerType === 'mouse') show(chip, 250)
    }
    const out = (e: PointerEvent) => {
      const to = e.relatedTarget as Node | null
      if (to && (pop.current?.contains(to) || chipOf({ target: to } as unknown as Event))) return
      if (chipOf(e) || pop.current?.contains(e.target as Node)) hide()
    }
    // The × keeps the caret in the box; the rest of the chip opens its picture.
    const down = (e: MouseEvent) => { if ((e.target as Element)?.closest?.('[data-img-remove]')) e.preventDefault() }
    const click = (e: MouseEvent) => {
      const chip = chipOf(e)
      if (!chip) return
      e.preventDefault(); e.stopPropagation()
      if ((e.target as Element).closest('[data-img-remove]')) {
        const box = chip.closest<HTMLElement>('[contenteditable="true"]')
        const next = chip.nextSibling
        if (next?.nodeType === 3 && next.textContent!.startsWith(' ')) next.textContent = next.textContent!.slice(1)
        chip.remove()
        setPeek(null)
        if (box) { box.focus({ preventScroll: true }); box.dispatchEvent(new Event('input', { bubbles: true })) }
        return
      }
      const shot = imageOf(chip.dataset.img)
      if (shot) { setPeek(null); setFull(shot) }
    }
    const key = (e: KeyboardEvent) => {
      const chip = chipOf(e)
      if (!chip || e.target !== chip || (e.key !== 'Enter' && e.key !== ' ')) return
      e.preventDefault(); e.stopPropagation()
      const shot = imageOf(chip.dataset.img)
      if (shot) { setPeek(null); setFull(shot) }
    }
    const focus = (e: FocusEvent) => { const chip = chipOf(e); if (chip && e.target === chip) show(chip, 0) }
    const blur = (e: FocusEvent) => { if (chipOf(e)) hide() }
    listen(document, 'pointerover', over as EventListener, true)
    listen(document, 'pointerout', out as EventListener, true)
    listen(document, 'mousedown', down as EventListener, true)
    listen(document, 'click', click as EventListener, true)
    listen(document, 'keydown', key as EventListener, true)
    listen(document, 'focusin', focus as EventListener, true)
    listen(document, 'focusout', blur as EventListener, true)
    return () => {
      clearTimeout(timer.current)
      document.removeEventListener('pointerover', over, true)
      document.removeEventListener('pointerout', out, true)
      document.removeEventListener('mousedown', down, true)
      document.removeEventListener('click', click, true)
      document.removeEventListener('keydown', key, true)
      document.removeEventListener('focusin', focus, true)
      document.removeEventListener('focusout', blur, true)
    }
  }, [])
  // A chip taken out of the page (its comment closed, the box cleared) takes its peek with it.
  useEffect(() => { if (peek && !peek.chip.isConnected) setPeek(null) })
  return createPortal(<>
    {peek && peek.chip.isConnected && <PeekCard ref={pop} peek={peek} onOpen={() => { setPeek(null); setFull(peek.shot) }} />}
    {full && <FullScreen shot={full} onClose={() => setFull(null)} />}
  </>, uiBox())
}

function PeekCard({ peek, onOpen, ref }: { peek: Peek; onOpen: () => void; ref: React.Ref<HTMLDivElement> }) {
  const r = peek.chip.getBoundingClientRect(), W = 272
  const below = r.top < 260
  const rtl = getComputedStyle(peek.chip).direction === 'rtl'
  const left = Math.min(Math.max(8, rtl ? r.right - W : r.left), innerWidth - W - 8)
  const s = peek.shot, facts = factsOf(s)
  return (
    <div ref={ref} data-comment-ui="" data-shoot="image-peek" role="tooltip" dir="auto"
      className="pointer-events-auto fixed z-[260] w-[272px] origin-bottom animate-[proto-peek_.14s_ease-out] overflow-hidden rounded-xl bg-white text-start shadow-xl ring-1 ring-black/10 motion-reduce:animate-none dark:bg-zinc-900 dark:ring-white/15"
      style={{ left, ...(below ? { top: r.bottom + 8 } : { bottom: innerHeight - r.top + 8 }) }}>
      <button type="button" onClick={onOpen} aria-label={t('Open full screen')} className="group/p relative block w-full cursor-zoom-in bg-zinc-100 dark:bg-zinc-950">
        <img src={s.src} alt="" className="mx-auto block max-h-44 w-full object-contain" />
        <span className="absolute bottom-2 end-2 inline-flex items-center gap-1 rounded-full bg-black/60 px-2 py-1 text-[11px] font-medium text-white opacity-0 backdrop-blur transition-opacity group-hover/p:opacity-100 group-focus-visible/p:opacity-100">
          <svg className="size-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" /></svg>{t('Full screen')}
        </span>
      </button>
      <span className="block border-t border-black/5 px-3 py-2 dark:border-white/10">
        <span className="block break-all text-xs font-medium text-zinc-900 dark:text-zinc-100"><bdi>{s.name || shortName(s.name, 1)}</bdi></span>
        {facts.length > 0 && <span className="mt-0.5 flex flex-wrap gap-x-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">{facts.map((f, k) => <span key={k} className="inline-flex gap-x-1.5">{k > 0 && <span aria-hidden>·</span>}<bdi className="tabular-nums">{f}</bdi></span>)}</span>}
      </span>
    </div>
  )
}

function FullScreen({ shot, onClose }: { shot: Shot; onClose: () => void }) {
  const close = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const was = document.activeElement as HTMLElement | null
    close.current?.focus({ preventScroll: true })
    // Esc closes the picture only, not the comment box under it.
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); onClose() } }
    listen(window, 'keydown', key as EventListener, true)
    return () => { window.removeEventListener('keydown', key, true); was?.focus?.({ preventScroll: true }) }
  }, [onClose])
  const facts = factsOf(shot)
  return (
    <div data-comment-ui="" data-shoot="image-full" role="dialog" aria-modal="true" aria-label={shot.name || t('Image')} onClick={onClose}
      className="pointer-events-auto fixed inset-0 z-[400] flex animate-[proto-fade_.16s_ease-out] flex-col bg-black/90 backdrop-blur-md motion-reduce:animate-none">
      <div className="flex items-center gap-3 px-4 py-3 text-white" onClick={e => e.stopPropagation()}>
        <span className="min-w-0 flex-1 text-start">
          <span className="block truncate text-sm font-medium"><bdi>{shot.name || t('Image')}</bdi></span>
          {facts.length > 0 && <span className="flex flex-wrap gap-x-1.5 text-[11px] text-zinc-400">{facts.map((f, k) => <span key={k} className="inline-flex gap-x-1.5">{k > 0 && <span aria-hidden>·</span>}<bdi className="tabular-nums">{f}</bdi></span>)}</span>}
        </span>
        <button ref={close} type="button" onClick={onClose} aria-label={t('Close')} title={`${t('Close')} · Esc`} className="grid size-10 shrink-0 place-items-center rounded-full bg-white/10 hover:bg-white/20">
          <svg className="size-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
        </button>
      </div>
      <div className="grid min-h-0 flex-1 place-items-center p-4 pt-0">
        <img src={shot.src} alt={shot.name || ''} onClick={e => e.stopPropagation()} className="max-h-full max-w-full animate-[proto-zoom_.2s_cubic-bezier(.2,.8,.2,1)] rounded-lg object-contain shadow-2xl motion-reduce:animate-none" />
      </div>
    </div>
  )
}
