import { imageIn, carriesImage } from './images'
import { besideWords, fill, imageShot, insertImage, InlineImage, relabel, settle, type RawSeg } from './inline-image'
// Writing a comment on one element, or on a moment or a range of the design's motion (in the motion
// dock). `@` offers whole-variant mentions; Tag another element keeps the existing visual picker (a region dragged out there is tagged with its picture); the camera captures the design around the
// element (all of it, on a moment) and opens the editor, and a region dragged out on the design brings its own picture; an image pasted (Ctrl+V) or dropped on the
// composer sits in the words where the caret is, as a chip (inline-image.tsx); ⌘↩ adds it. Whatever is written is held by
// the store as it is typed, so putting the composer away any way but Cancel or Add loses nothing.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Drawer } from '@base-ui/react/drawer'
import { uiBox } from '../portals'
import { listen } from '../quiet'
import { useAgentName, useCtx } from './ctx'
import { find } from './dom'
import { useKeyboard } from './keyboard'
import { progress, useStore } from './store'
import { capture, ShotEditor } from './shot'
import type { Box, Draft, Seg, Shot, Target, Time } from './types'
import { MAX_SHOTS, shotsOf } from './types'
import { MentionShelf, useMentionShelf } from './mention-shelf'
import { routeOfTag, TAG_EVENT, type TagDrop } from '../tag-drag'
import { IB, Icon, MOD, PinDot, PRIMARY, SrcTag, srcOf, PictureStrip, ViewChip, elementName, variantChip, protoChip, protoTitle } from './ui'
import { t } from '../i18n'
import { variantLabel } from '../variants'
import { isSendKey, sendKeyLabel } from './enter-sends'

const spanOf = (t: { at: number; to?: number }) => t.to === undefined ? `${(t.at / 1000).toFixed(2)} s` : `${(t.at / 1000).toFixed(2)}–${(t.to / 1000).toFixed(2)} s`

export function readEditor(el: HTMLElement): RawSeg[] {
  const out: RawSeg[] = []
  el.childNodes.forEach(n => {
    if (n.nodeType === 3) { if (n.textContent) out.push(n.textContent.replace(/​/g, '')) }
    else if ((n as HTMLElement).dataset?.tag) out.push({ tag: Number((n as HTMLElement).dataset.tag) })
    else if ((n as HTMLElement).dataset?.img) out.push({ imgId: (n as HTMLElement).dataset.img! })
    else if ((n as HTMLElement).tagName === 'BR') out.push('\n')
    else out.push((n as HTMLElement).innerText)
  })
  return out.filter(s => s !== '')
}
export const chipNode = (target: Target | undefined, i: number) => {
  const s = document.createElement('span')
  s.contentEditable = 'false'
  s.dir = 'auto'
  s.dataset.tag = String(i)
  const src = srcOf(target)
  if (src) s.title = src.full
  // A variant shows by its number and its name; long names are cut short (the title has it all).
  s.className = 'mx-px inline-block max-w-[16rem] truncate rounded bg-proto-primary-soft px-1 align-bottom font-medium text-proto-primary-soft-fg'
  s.textContent = target?.commentRef ? t('Comment {n}', { n: target.commentRef.n }) : target?.protoRef ? protoChip(target.protoRef) : target?.variantRef ? variantChip(target.variantRef) : target ? `@${target.source ? `${variantLabel(null, target.source.variant)}·` : ''}${elementName(target)}` : `@${i + 1}`
  if (target?.commentRef) s.title = target.commentRef.quote
  if (target?.protoRef) s.title = protoTitle(target.protoRef)
  if (target?.variantRef) s.title = `${target.variantRef.title ? `${target.variantRef.title} › ` : ''}#${target.variantRef.label} ${target.variantRef.name}`
  return s
}
export const endRange = (el: HTMLElement) => { const x = document.createRange(); x.selectNodeContents(el); x.collapse(false); return x }

// An image from the clipboard or dropped on the composer becomes one of the comment's pictures, in
// the words where the caret is (each paste, drop or screenshot adds one, up to MAX_SHOTS). It goes
// through a canvas, so whatever it was (a GIF, a BMP from a screenshot tool) it is sent as a PNG
// the server keeps (it takes png, jpeg and webp only), at most MAX_SIDE px a side; one still too
// big for localStorage is sent as a JPEG.

type Props = {
  /** The element it is on; a comment on the motion has a time instead. */
  target?: Target
  time?: Time
  /** Laid out in the motion dock, under the design, instead of beside the element. */
  docked?: boolean
  n: number
  initial?: Draft
  place: Box | null
  sheet: boolean
  tagging: boolean
  editing: boolean
  /** The saved comment being edited. */
  id?: string
}

// The design's root, for a screenshot of all of it at the moment a comment on the motion is on.
const WHOLE: Target = { label: '', selector: ':scope > *', tag: '', text: '', rect: { x: 0, y: 0, w: 0, h: 0 } }
// The moment and the range as icons, in the stroke the page's icons use.
const TIME_PATH = { at: 'M12 9.5V20M9 4h6l-3 4z', range: 'M5 5v14M19 5v14M8.5 12h7' }

export function Composer({ target, time, docked, n, initial, place, sheet, tagging, editing, id }: Props) {
  const agent = useAgentName()
  const { host, store, act } = useCtx()
  // The popover over the design closes with its X, the phone's drawer with a swipe down, and the
  // motion dock keeps Cancel.
  const pop = !docked && !sheet
  const live = store.get().live
  const [mention, setMention] = useState<{ query: string; index: number } | null>(null)
  // Closed, the @ menu stays a moment as it was, so it can sink away instead of vanishing.
  const [menuGone, setMenuGone] = useState<typeof mention>(null)
  const lastMention = useRef(mention)
  if (mention) lastMention.current = mention
  useEffect(() => {
    if (mention) { setMenuGone(null); return }
    const was = lastMention.current
    if (!was) return
    lastMention.current = null
    setMenuGone(was)
    const id = window.setTimeout(() => setMenuGone(null), 140)
    return () => clearTimeout(id)
  }, [!!mention])
  const menuAt = mention ?? menuGone
  const choices = useMemo(() => menuAt ? host.variantMentions?.() ?? [] : [], [!!menuAt]) // eslint-disable-line react-hooks/exhaustive-deps
  // A sent comment, changed while the agent hasn't taken it. If it takes it meanwhile the change can't
  // reach it there, so the words can go as a new comment instead.
  const s = useStore(store), sentItem = id ? s.items.find(i => i.id === id && i.sent) : undefined
  const [taken, setTaken] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const late = !!sentItem && (taken || progress(sentItem, s.inbox).state !== 'sent')
  const nudge = store.get().nudge
  const pending = store.get().pendingTag
  const ed = useRef<HTMLDivElement>(null)
  const [tags, setTags] = useState<Target[]>(initial?.tags ?? [])
  const tagsRef = useRef(tags)
  tagsRef.current = tags
  // Its pictures beside the words: screenshots of the design (marked up or not), and images pasted
  // before images went into the words. Images pasted or dropped now are chips in the editor.
  const [shots, setShots] = useState<Shot[]>(initial ? besideWords(initial.body, shotsOf(initial)) : [])
  const shotsRef = useRef(shots)
  shotsRef.current = shots
  const [inlineN, setInlineN] = useState(initial ? shotsOf(initial).length - shots.length : 0)
  const full = shots.length + inlineN >= MAX_SHOTS
  const count = () => shotsRef.current.length + (ed.current?.querySelectorAll('[data-img]').length ?? 0)
  const note = () => settle(readEditor(ed.current!), shotsRef.current)
  const box = useRef<HTMLDivElement>(null)
  const [empty, setEmpty] = useState(!initial || !initial.body.some(s => typeof s !== 'string' || s.trim()))
  const emit = () => { if (!editing && ed.current) { const n = note(); act.hold({ body: n.body, tags: tagsRef.current, ...(n.shots.length ? { shots: n.shots } : {}) }, target, time) } }
  const regionKey = target?.region ? JSON.stringify(target.region) : ''
  // Moving the comment to the parent (or back), or its region, keeps what is held on what it is on now.
  useEffect(emit, [tags, shots, target?.selector, regionKey]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (nudge) box.current?.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'translateX(-3px)' }, { transform: 'translateX(0)' }], { duration: 320, easing: 'ease-out' })
  }, [nudge])
  // What the picture's place says while one is on its way: a screenshot being taken, or an image read.
  const [capturing, setCapturing] = useState<string | null>(null)
  const [dropping, setDropping] = useState(false)
  // A picture being drawn on: a new screenshot (`at` -1, added when done) or the picture at `at`.
  const [marking, setMarking] = useState<{ src: string; at: number } | null>(null)
  const range = useRef<Range | null>(null)

  // Filled once its box is there: in the phone's drawer that is a moment after the composer, once
  // the drawer's portal has mounted.
  const [edOn, setEdOn] = useState(false)
  const filled = useRef(false)
  useLayoutEffect(() => {
    const el = ed.current
    if (!el || filled.current) return
    filled.current = true
    el.replaceChildren()
    if (initial) fill(el, initial.body, shotsOf(initial), i => chipNode(initial.tags[i], i))
    el.focus({ preventScroll: true })
    const sel = getSelection(); sel?.selectAllChildren(el); sel?.collapseToEnd()
    // On a phone the composer is a sheet over the bottom: the element moves up into view above it.
    if (sheet && target) find(host.mount(), target)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edOn])

  const saveRange = () => { const s = getSelection(); if (s?.rangeCount && ed.current?.contains(s.anchorNode)) range.current = s.getRangeAt(0).cloneRange() }
  const insert = (p: Target, close = true, strip = true) => {
    // A tap on the shelf stays open for another; its @ is gone, so what is typed next closes it.
    setMention(close ? null : { query: '', index: 0 })
    const el = ed.current!
    const i = tagsRef.current.length
    tagsRef.current = [...tagsRef.current, p]
    setTags(tagsRef.current)
    el.focus()
    const r = range.current && el.contains(range.current.startContainer) ? range.current : endRange(el)
    // The @ and what was typed after it go; the chip takes their place.
    const tn = r.startContainer
    if (strip && tn.nodeType === 3) {
      const txt = tn.textContent!, at = txt.lastIndexOf('@', r.startOffset - 1)
      if (at >= 0 && /^[^\s@]*$/.test(txt.slice(at + 1, r.startOffset))) { r.setStart(tn, at); r.deleteContents() }
    }
    const chip = chipNode(p, i), space = document.createTextNode(' ')
    r.insertNode(space); r.insertNode(chip)
    const after = document.createRange(); after.setStartAfter(space); after.collapse(true)
    const s = getSelection(); s?.removeAllRanges(); s?.addRange(after)
    setEmpty(false)
    saveRange()
    return chip
  }
  // Rows dragged in from the project tree (tag-drag.ts): a chip each where the caret was, skipping
  // what is tagged already, each handed back so the dragged chip can glide onto it.
  const dropRef = useRef<(d: TagDrop) => void>(() => {})
  dropRef.current = d => {
    const have = new Set(tagsRef.current.map(routeOfTag).filter(Boolean))
    for (const x of host.tagsFor?.(d.routes) ?? []) if (!have.has(routeOfTag(x))) { const chip = insert(x, true, false); d.landed.push({ route: routeOfTag(x), el: chip }) }
    emit()
  }
  useEffect(() => {
    const take = (e: Event) => { if (e.target === ed.current) dropRef.current((e as CustomEvent<TagDrop>).detail) }
    document.addEventListener(TAG_EVENT, take)
    return () => document.removeEventListener(TAG_EVENT, take)
  }, [])
  // Something picked on the design to tag comes back here.
  useEffect(() => {
    if (!pending || tagging) return
    act.tagTaken()
    const at = tagsRef.current.length
    insert(pending)
    // A region dragged out to tag it comes with its picture, as a region the comment is on does.
    if (!pending.region || count() >= MAX_SHOTS) return
    setCapturing(t('Capturing…'))
    capture(host.mount(), pending, host.dark())
      .then(url => { if (url) setShots(s => count() < MAX_SHOTS ? [...s, { src: url, tag: at }] : s) })
      .catch(() => { /* a design in a device view's frame may not draw from here */ })
      .finally(() => setCapturing(null))
  }, [pending, tagging]) // eslint-disable-line react-hooks/exhaustive-deps

  const submit = () => {
    const { body, shots } = note()
    if (!body.some(s => typeof s !== 'string' || s.trim()) && !tags.length && !shots.length) return
    const d = { body, tags, shots, shot: undefined, pasted: undefined }
    if (late) { act.save(d, target, undefined, time); void act.send(); return }
    if (!sentItem) return act.save(d, target, id, time)
    if (busy) return
    setBusy(true); setError('')
    act.saveSent(sentItem.id, d).catch((e: Error & { taken?: boolean }) => { if (e.taken) setTaken(true); else setError(e.message || t('Could not send')) }).finally(() => setBusy(false))
  }
  const shoot = async () => {
    if (count() >= MAX_SHOTS) return
    setCapturing(t('Capturing…'))
    // A design in a device view's frame may not draw from this window; then there is no picture.
    try { const url = await capture(host.mount(), target ?? WHOLE, host.dark()); if (url) setMarking({ src: url, at: -1 }) } catch { /* nothing to mark up */ } finally { setCapturing(null) }
  }
  // A region dragged out on the design comes with its picture, taken as the composer opens and
  // retaken each time the region is moved or resized, while that picture is still as it was taken
  // (one drawn on, or removed, is the user's: left alone).
  const regionShot = useRef('')
  useEffect(() => {
    if (editing || !target?.region || regionShot.current === regionKey) return
    const first = !regionShot.current
    regionShot.current = regionKey
    if (first ? shotsRef.current.some(p => p.region) : !shotsRef.current.some(p => p.region)) return
    setCapturing('Capturing…')
    capture(host.mount(), target, host.dark())
      .then(url => {
        if (!url || regionShot.current !== regionKey) return
        setShots(s => s.some(p => p.region) ? s.map(p => p.region ? { src: url, region: true } : p) : count() < MAX_SHOTS ? [...s, { src: url, region: true }] : s)
      })
      .catch(() => { /* a design in a device view's frame may not draw from here */ })
      .finally(() => setCapturing(null))
  }, [regionKey]) // eslint-disable-line react-hooks/exhaustive-deps
  // An image pasted or dropped goes where the caret was, as a chip.
  const attach = async (file: File, from: 'paste' | 'drop') => {
    if (count() >= MAX_SHOTS) return
    setCapturing(t('Adding…'))
    try {
      const shot = await imageShot(file, from), el = ed.current
      if (!shot || !el || count() >= MAX_SHOTS) return
      el.focus({ preventScroll: true })
      insertImage(range.current && el.contains(range.current.startContainer) ? range.current : endRange(el), shot, 1)
      saveRange(); changed()
    } finally { setCapturing(null) }
  }
  // After each change: images numbered again in order, the count, the empty hint, what is held.
  const changed = () => {
    const el = ed.current
    if (!el) return
    relabel(el)
    setInlineN(el.querySelectorAll('[data-img]').length)
    setEmpty(!el.innerText.trim())
    emit()
  }

  const [height, setHeight] = useState(260)
  useLayoutEffect(() => {
    if (docked || !box.current) return
    const observer = new ResizeObserver(() => setHeight(box.current?.offsetHeight ?? 260))
    observer.observe(box.current)
    return () => observer.disconnect()
  }, [docked])
  const W = 312
  const lay = host.layer.getBoundingClientRect()
  // What it is on can go mid-sentence (a menu closes, a row re-renders): it stays where it was.
  const kept = useRef<Box | null>(null)
  if (place && !place.via) kept.current = place
  place = kept.current ?? place
  let style: CSSProperties = docked ? {} : { maxHeight: 'calc(100% - 16px)', overflowY: 'auto' }
  if (!sheet && !docked && place) {
    const right = place.x + place.w + 12 + W < lay.width - 8
    const left = place.x - 12 - W > 8
    const x = right ? place.x + place.w + 12 : left ? place.x - 12 - W : Math.min(Math.max(8, place.x), lay.width - W - 8)
    const y = right || left ? Math.min(Math.max(8, place.y - 8), lay.height - height - 8) : Math.min(place.y + place.h + 12, lay.height - height - 8)
    style = { ...style, left: x, top: Math.max(8, y), width: W }
  }
  const keys = (e: React.KeyboardEvent) => {
    if (mention && !e.nativeEvent.isComposing) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setMention(null); return }
      if (shelf.onKey(e)) { e.preventDefault(); return }
    }
    if (isSendKey(e)) { e.preventDefault(); submit(); if (!sentItem) void act.send() }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); act.close() }
  }
  const refocus = () => requestAnimationFrame(() => ed.current?.focus())
  // The @ menu floats over the page, off the composer's edge (above it, or below it when there is
  // more room there), lined up with the editor; it rises in and sinks away. The phone's sheet keeps
  // it inline.
  const taggedNow = () => {
    const keys = new Set<string>()
    ed.current?.querySelectorAll<HTMLElement>('[data-tag]').forEach(n => { const r = tagsRef.current[Number(n.dataset.tag)]?.variantRef; if (r) keys.add(`${r.proto}/${r.variant}`) })
    return keys
  }
  const shelfOpts = {
    choices, query: mention ? mention.query : null, tagged: taggedNow,
    onPick: (c: Target, close: boolean) => insert(c, close),
    onDrop: (c: Target) => {
      const r = c.variantRef!
      ed.current?.querySelectorAll<HTMLElement>('[data-tag]').forEach(n => { const v = tagsRef.current[Number(n.dataset.tag)]?.variantRef; if (v?.proto === r.proto && v.variant === r.variant) n.remove() })
      setEmpty(!ed.current?.innerText.trim()); emit(); setMention(m => m && { ...m })
    },
    onElement: () => { setMention(null); act.tagPick() },
  }
  const shelf = useMentionShelf(shelfOpts)
  const edRect = menuAt && !sheet ? ed.current?.getBoundingClientRect() : null
  const outer = edRect ? (box.current?.getBoundingClientRect() ?? edRect) : null
  const edBox = edRect && outer ? { left: edRect.left, top: outer.top, bottom: outer.bottom } : null
  const above = !!edBox && edBox.top - 16 >= innerHeight - edBox.bottom - 16
  const menu = menuAt && <MentionShelf shelf={shelf} open={!!mention} opts={shelfOpts} count={choices.length} place={edBox ? { center: edBox.left + (edRect!.width / 2), above, edge: above ? innerHeight - edBox.top + 8 : edBox.bottom + 8 } : undefined} />
  const body = (
      <div ref={box} data-composer onKeyDown={keys}
        onDragOver={e => { if (!carriesImage(e.dataTransfer)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setDropping(true) }}
        onDragLeave={e => { if (!box.current?.contains(e.relatedTarget as Node)) setDropping(false) }}
        onDrop={e => {
          setDropping(false)
          const f = imageIn(e.dataTransfer); if (!f) return; e.preventDefault(); void attach(f, 'drop')
        }}
        className={`z-30 flex flex-col text-[13px] text-zinc-900 dark:text-zinc-100 ${docked || sheet ? 'relative' : 'absolute rounded-2xl border border-black/10 bg-white shadow-2xl shadow-black/15 dark:border-white/10 dark:bg-zinc-900'} ${!tagging ? 'pointer-events-auto' : sheet ? 'pointer-events-auto opacity-60' : 'pointer-events-none opacity-40'} ${dropping ? 'ring-2 ring-proto-primary-ring' : ''}`} style={sheet ? undefined : style}>
        <div className={`flex items-center gap-1 px-3 ${sheet ? 'pt-1.5' : 'pt-2.5'}`}>
          <PinDot n={n} size="sm" whole={target?.whole} />
          {time
            ? <span className="inline-flex min-w-0 flex-1 items-center gap-1 text-[11px] font-semibold tabular-nums text-proto-primary-soft-fg"><svg className="size-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={time.to === undefined ? TIME_PATH.at : TIME_PATH.range} /></svg>{time.to === undefined ? t('At {time}', { time: spanOf(time) }) : spanOf(time)}</span>
            // In a view the size takes the file's place: the list shows the file under the words.
            : <><ViewChip v={target?.view} /><span dir="auto" className="min-w-0 flex-1 truncate text-xs font-medium">{target?.whole ? (target.source ? t('Whole variant on {variant}', { variant: target.source.variant }) : t('Whole variant')) : (target?.source ? t('Comment on {variant}', { variant: target.source.variant }) : t('Comment'))}</span>{!target?.view && <SrcTag t={target} />}</>}
          {pop && <button onClick={() => act.cancel()} data-shoot="composer-close" aria-label={t('Cancel')} title={`${t('Cancel')} · Esc`} className={`${IB} -me-1.5 h-7 min-w-7 shrink-0 px-1`}><Icon name="x" className="size-3.5" /></button>}
        </div>
        <div className="relative px-3 pt-1.5">
          <div ref={el => { ed.current = el; if (el) setEdOn(true) }} contentEditable suppressContentEditableWarning data-tag-target="" role="textbox" aria-label={t('Comment')} aria-multiline="true" dir="auto"
            onInput={() => {
              saveRange(); changed()
              const s = getSelection(), node = s?.anchorNode
              const text = node?.nodeType === 3 ? node.textContent!.slice(0, s!.anchorOffset) : ''
              const match = text.match(/(?:^|[^\w.+-])@([^\s@]*)$/u)
              if (match && (host.variantMentions?.().length ?? 0) > 0) setMention({ query: match[1], index: 0 })
              else { setMention(null); if (/(^|[^\w.+-])@$/.test(text)) act.tagPick() }
            }}
            onKeyUp={saveRange} onMouseUp={saveRange} onBlur={() => { saveRange(); setMention(null) }}
            onPaste={e => { const f = imageIn(e.clipboardData); if (!f) return; e.preventDefault(); void attach(f, 'paste') }}
            className="max-h-40 min-h-[52px] overflow-y-auto whitespace-pre-wrap break-words py-1 leading-5 outline-none [@media(pointer:coarse)]:min-h-[60px] [@media(pointer:coarse)]:text-base [@media(pointer:coarse)]:leading-6" />
          {menu && edBox ? createPortal(menu, uiBox()) : menu}
          {/* The @ hint starts its own line, so it never breaks in the middle. */}
          {empty && !inlineN && <span className="pointer-events-none absolute start-3 top-2.5 whitespace-pre-line text-zinc-400 [@media(pointer:coarse)]:text-base [@media(pointer:coarse)]:leading-6">
            {(time
              ? time.to === undefined
                ? t('What should change at this moment? @ mentions a variant or element')
                : t('What should change over this range? @ mentions a variant or element')
              : t('What should change? @ mentions a variant or element')).replace('? @', '?\n@')}
          </span>}

        </div>
        {(capturing || shots.length > 0) && (
          <PictureStrip className="mx-1">
            {shots.map((p, k) => p.pasted
              ? <span key={k} className="inline-flex items-center gap-0.5"><InlineImage shot={p} n={k + 1} /><button onClick={() => setShots(s => s.filter((_, j) => j !== k))} aria-label={t('Remove the image')} title={t('Remove the image')} className={`${IB} h-6 min-w-6 px-0`}><Icon name="x" className="size-3" /></button></span>
              : <span key={k} className="relative">
                  <button onClick={() => setMarking({ src: p.src, at: k })} title={t('Edit the screenshot')} className="group relative block h-12 w-20 overflow-hidden rounded-lg ring-1 ring-black/10 dark:ring-white/15"><img src={p.src} alt={t('Screenshot')} className="size-full object-cover" /><span className="absolute inset-0 grid place-items-center bg-black/40 text-[11px] font-medium text-white opacity-0 transition group-hover:opacity-100">{t('Edit')}</span></button>
                  <button onClick={() => setShots(s => s.filter((_, j) => j !== k))} aria-label={t('Remove the screenshot')} title={t('Remove the screenshot')} className="absolute -end-1.5 -top-1.5 grid size-5 place-items-center rounded-full bg-zinc-900 text-[11px] leading-none text-white shadow ring-2 ring-white dark:bg-zinc-100 dark:text-zinc-900 dark:ring-zinc-900">×</button>
                </span>)}
            {capturing && <span className="grid h-12 w-20 place-items-center rounded-lg bg-zinc-900/[.04] text-[11px] text-zinc-400 dark:bg-white/[.06]">{capturing}</span>}
          </PictureStrip>
        )}
        {late && <p data-shoot="composer-late" role="alert" className="mx-3 mt-1.5 text-[11px] leading-4 text-amber-700 dark:text-amber-300">{t('{agent} has started on this, so it can\'t change now. Your words can go as a new comment.', { agent })}</p>}
        {error && <p role="alert" className="mx-3 mt-1.5 text-[11px] leading-4 text-rose-600 dark:text-rose-400">{error}</p>}
        <div className="flex items-center gap-1 px-2 pb-2 pt-1">
          <button onClick={() => { setMention(null); saveRange(); act.tagPick() }} title={t('Tag another element on the design, or drag out a region to tag it with its picture')} aria-label={t('Tag another element')} className={`${IB} h-8 min-w-8 px-1.5`}><Icon name="target" /></button>
          <button onClick={shoot} disabled={full} title={full ? t('{n} pictures is the most one comment takes; remove one to add another', { n: MAX_SHOTS }) : t('Add a screenshot of this part of the design, then draw on it (or paste an image: {mod} V, or drop one here; each adds a picture)', { mod: MOD })} aria-label={t('Attach a screenshot')} className={`${IB} h-8 min-w-8 px-1.5 disabled:opacity-40`}><Icon name="camera" /></button>
          {editing && <button onClick={() => id && act.remove(id)} title={t('Delete')} aria-label={t('Delete comment')} className={`${IB} h-8 min-w-8 px-1.5 hover:text-rose-600`}><Icon name="trash" /></button>}
          <span className="ms-auto" />
          {docked && <button onClick={() => act.cancel()} className="h-8 rounded-lg px-2.5 text-xs font-medium text-zinc-500 hover:bg-zinc-900/5 dark:hover:bg-white/10">{t('Cancel')}</button>}
          {/* Sent as it is added (Settings), it says so: Send, with the plane. */}
          <button data-shoot="composer-add" onClick={submit} disabled={busy || (empty && !tags.length && !shots.length && !inlineN)} title={late || (live && !editing) ? t('Send to {agent}', { agent }) : sentItem ? t('Save') : t('Add, to send with the rest · {key} adds and sends to {agent}', { key: sendKeyLabel(), agent })} className={`inline-flex h-8 items-center gap-1 rounded-lg ps-2 pe-3 text-xs font-semibold disabled:opacity-40 ${PRIMARY}`}><Icon name={late ? 'send' : editing ? 'check' : live ? 'send' : 'plus'} className="size-3.5" />{late ? t('Send as new comment') : editing ? t('Save') : live ? t('Send') : t('Add')}</button>
        </div>
      </div>
  )
  return (
    <>
      {sheet ? <Sheet onClose={() => act.close()} tagging={!!tagging}>{body}</Sheet> : body}
      {marking && <ShotEditor src={marking.src} onCancel={() => { setMarking(null); refocus() }} onDone={url => {
        const at = marking.at
        setShots(s => at < 0 ? (count() < MAX_SHOTS ? [...s, { src: url }] : s) : s.map((p, j) => j === at ? { src: url, ...(p.pasted ? { pasted: true } : {}), ...(p.tag !== undefined ? { tag: p.tag } : {}) } : p))
        setMarking(null); refocus()
      }} />}
    </>
  )
}

// The phone's composer: a drawer from the foot of the screen (Base UI's, like the shell's other
// sheets) over the bar, riding the keyboard while it is up. It leaves the design free to touch,
// for tagging another element and for Parent on the outline, so a swipe down or a tap on the page
// puts it away, keeping what was typed for the next time (as Esc does).
function Sheet({ children, onClose, tagging }: { children: ReactNode; onClose: () => void; tagging: boolean }) {
  const kb = useKeyboard(true)
  const now = useRef({ onClose, tagging })
  now.current = { onClose, tagging }
  useEffect(() => {
    const down = (e: Event) => {
      const t = e.target as Element
      if (now.current.tagging || t.closest?.('[data-comments], [data-comment-ui], [data-composer], [data-pill]')) return
      now.current.onClose()
    }
    listen(document, 'pointerdown', down, true)
    return () => document.removeEventListener('pointerdown', down, true)
  }, [])
  return (
    <Drawer.Root open modal={false} disablePointerDismissal onOpenChange={(open: boolean) => { if (!open) onClose() }}>
      <Drawer.Portal container={uiBox()}>
        <Drawer.Viewport data-comment-ui="" className="pointer-events-none fixed inset-x-0 top-0 z-[200] flex items-end justify-center transition-[bottom] duration-300 ease-out" style={{ bottom: kb }}>
          <Drawer.Popup data-shoot="composer-sheet" className="pointer-events-auto w-full rounded-t-[22px] border-t border-black/10 bg-white pt-2 shadow-[0_-12px_40px_-12px_rgb(0_0_0/.35)] outline-none [transform:translateY(var(--drawer-swipe-movement-y))] transition-transform duration-[450ms] ease-[cubic-bezier(0.32,0.72,0,1)] data-swiping:select-none data-starting-style:[transform:translateY(100%)] data-ending-style:[transform:translateY(100%)] dark:border-white/10 dark:bg-zinc-900"
            style={{ paddingBottom: kb ? 0 : 'max(.25rem, env(safe-area-inset-bottom))' }}>
            <div className="mx-auto h-1 w-10 rounded-full bg-zinc-300 dark:bg-zinc-700" />
            <Drawer.Title className="sr-only">{t('Comment')}</Drawer.Title>
            <Drawer.Content>{children}</Drawer.Content>
          </Drawer.Popup>
        </Drawer.Viewport>
      </Drawer.Portal>
    </Drawer.Root>
  )
}
