import { imageIn, carriesImage } from './images'
import { besideWords, fill, imageShot, insertImage, relabel, settle, type RawSeg } from './inline-image'
import { MAX_SHOTS, type Shot } from './types'
// A comment box that can tag: what is typed, with a chip in it wherever a tag was written. `@` opens
// a menu of the prototype's variants and, last, Tag an element, which picks one on the design and
// brings it back where the @ was. The box's owner holds its state (useTagField), so the box itself
// can come and go (the island's side panel folds while an element is picked) and keep what was in it.
import { useEffect, useId, useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { uiBox } from '../portals'
import { t } from '../i18n'
import { useCtx } from './ctx'
import { useStore } from './store'
import { chipNode, readEditor } from './composer'
import { MentionShelf, useMentionShelf } from './mention-shelf'
import { routeOfTag, TAG_EVENT, type TagDrop } from '../tag-drag'
import type { Note, Seg, Target } from './types'
import { isSendKey } from './enter-sends'

type Opts = {
  /** Who a picked element goes back to; by default this box alone. */
  owner?: string
  /** No Tag an element (a phone's sheet covers the design). */
  noElements?: boolean
  /** What it starts with (a reply kept while its row was closed). */
  initial?: Note
  onChange?: (n: Note) => void
  /** Keys the box does not take itself: the send key (isSendKey), Esc. */
  onKey?: (e: KeyboardEvent<HTMLDivElement>) => void
  /** Before a picked element comes back, open what the box is in; returns how long that takes, in ms. */
  reopen?: () => number
  /** The variant the note is about, when it may not be the one on screen: an element picked on the
   *  one on screen says which it is on. */
  about?: { proto: string; variant: string }
  autoFocus?: boolean
}

/**
 * The words as written, the tags that are still in them numbered in order, the images still in them
 * after the box's other pictures (`keep`), trimmed at both ends.
 */
function noteOf(el: HTMLElement, tags: Target[], keep: Shot[]): Note {
  const used: number[] = []
  const raw = readEditor(el).map((s): RawSeg => typeof s === 'string' || !('tag' in s) ? s : { tag: used.includes(s.tag) ? used.indexOf(s.tag) : used.push(s.tag) - 1 })
  const { body, shots } = settle(raw, keep)
  const trimmed = body.map((s, i) => typeof s === 'string' && i === 0 ? s.trimStart() : s).map((s, i, all) => typeof s === 'string' && i === all.length - 1 ? s.trimEnd() : s).filter((s): s is Seg => s !== '')
  return { body: trimmed, tags: used.map(k => tags[k]), shots }
}

export function useTagField(opts: Opts) {
  const { act, host, store } = useCtx()
  const s = useStore(store)
  const own = useId()
  const owner = opts.owner ?? `field${own}`
  const optsRef = useRef(opts)
  optsRef.current = opts
  const input = useRef<HTMLDivElement | null>(null)
  // Pictures beside the words: images pasted before images went into them. New ones are chips in the words.
  const [shots, setShots] = useState<Shot[]>(opts.initial ? besideWords(opts.initial.body, opts.initial.shots ?? []) : [])
  const shotsRef = useRef(shots)
  shotsRef.current = shots
  const [adding, setAdding] = useState(false)
  const importing = useRef(false)
  const [imageError, setImageError] = useState('')
  const generation = useRef(0)
  const read = (): Note => input.current ? noteOf(input.current, tagsRef.current, shotsRef.current) : { body: [], tags: [], shots: shotsRef.current }
  const count = () => shotsRef.current.length + (input.current?.querySelectorAll('[data-img]').length ?? 0)
  // Each image goes where the caret was, as a chip, in the order they came.
  const attach = async (files: File[], from: 'paste' | 'drop') => {
    if (importing.current) return
    importing.current = true
    const gen = generation.current
    setAdding(true); setImageError('')
    try {
      for (const file of files.filter(f => f.type.startsWith('image/'))) {
        if (count() >= MAX_SHOTS) { setImageError(t('Up to {n} images per comment', { n: MAX_SHOTS })); break }
        const shot = await imageShot(file, from)
        if (gen !== generation.current) return
        const el = input.current
        if (!shot) { setImageError(t('Could not read the image')); continue }
        if (!el) continue
        el.focus({ preventScroll: true })
        insertImage(atCaret(false), shot, 1)
        saveCaret()
        changed()
      }
    } finally { importing.current = false; setAdding(false) }
  }
  const [tags, setTags] = useState<Target[]>(opts.initial?.tags ?? [])
  const tagsRef = useRef(tags)
  tagsRef.current = tags
  const [empty, setEmpty] = useState(!opts.initial?.body.length)
  // The @ menu: what follows the @ typed in the box, and the highlighted row. Closed, it stays a moment
  // as it was, so it can sink away instead of vanishing.
  const [mention, setMention] = useState<{ query: string; index: number } | null>(null)
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

  // The box goes when what it is in folds: what was in it moves into the next one, so its words, its
  // chips and where the caret was are all kept. The first one is filled with what it starts with.
  const lastBox = useRef<HTMLDivElement | null>(null)
  const ref = (el: HTMLDivElement | null) => {
    input.current = el
    if (!el || lastBox.current === el) return
    if (lastBox.current) el.append(...lastBox.current.childNodes)
    else {
      const initial = optsRef.current.initial
      if (initial) fill(el, initial.body, initial.shots ?? [], i => chipNode(tagsRef.current[i], i))
      if (optsRef.current.autoFocus) window.setTimeout(() => { el.focus({ preventScroll: true }); const sel = getSelection(); sel?.selectAllChildren(el); sel?.collapseToEnd() }, 0)
    }
    lastBox.current = el
  }
  const changed = () => {
    const el = input.current
    if (!el) return
    // Emptied, it is emptied for good (no stray line break left by the browser), so its placeholder
    // shows; lines started with Enter are kept.
    if (!el.textContent && el.childNodes.length === 1 && el.firstChild!.nodeName === 'BR') el.replaceChildren()
    relabel(el)
    setEmpty(!el.innerText.trim() && !el.querySelector('[data-img]'))
    optsRef.current.onChange?.(read())
  }
  const caret = useRef<{ node: Node; offset: number } | null>(null)
  const saveCaret = () => {
    const sel = getSelection()
    if (!sel?.rangeCount || !input.current?.contains(sel.anchorNode)) return
    const r = sel.getRangeAt(0)
    caret.current = { node: r.startContainer, offset: r.startOffset }
  }
  // Where the caret was, with the @ and what was typed after it taken out (the chip takes their place).
  const atCaret = (strip: boolean) => {
    const el = input.current!, c = caret.current, r = document.createRange()
    if (c && el.contains(c.node)) { r.setStart(c.node, Math.min(c.offset, c.node.nodeType === 3 ? c.node.textContent!.length : c.node.childNodes.length)); r.collapse(true) }
    else { r.selectNodeContents(el); r.collapse(false) }
    const tn = r.startContainer
    if (strip && tn.nodeType === 3) {
      const txt = tn.textContent!, at = txt.lastIndexOf('@', r.startOffset - 1)
      if (at >= 0 && /^[^\s@]*$/.test(txt.slice(at + 1, r.startOffset))) { r.setStart(tn, at); r.deleteContents() }
    }
    return r
  }
  const place = (r: Range) => { const sel = getSelection(); sel?.removeAllRanges(); sel?.addRange(r) }
  const insert = (p: Target, strip: boolean): HTMLElement | undefined => {
    const el = input.current
    if (!el) return
    const i = tagsRef.current.length
    tagsRef.current = [...tagsRef.current, p]
    setTags(tagsRef.current)
    el.focus({ preventScroll: true })
    const r = atCaret(strip), chip = chipNode(p, i), space = document.createTextNode(' ')
    r.insertNode(space); r.insertNode(chip)
    const after = document.createRange(); after.setStartAfter(space); after.collapse(true)
    place(after)
    saveCaret()
    changed()
    return chip
  }
  // The pick this box asked for is over: the element comes back as a chip where the @ was (on the
  // variant on screen, it says so when the note is about another), or, cancelled, the caret goes back.
  useEffect(() => {
    if (s.wholeTag || s.tagOwner !== owner) return
    const picked = s.wholePicked, about = optsRef.current.about, at = s.place
    act.wholeTagTaken()
    const tag = picked && about && at && (about.proto !== at.proto || about.variant !== at.variant) && !picked.source ? { ...picked, source: { proto: at.proto, variant: at.variant, ...(at.state ? { state: at.state } : {}) } } : picked
    const wait = optsRef.current.reopen?.() ?? 0
    window.setTimeout(() => {
      if (tag) return insert(tag, false)
      const el = input.current
      if (!el) return
      el.focus({ preventScroll: true })
      place(atCaret(false))
    }, wait)
  }, [s.wholeTag, s.tagOwner]) // eslint-disable-line react-hooks/exhaustive-deps

  // The @ menu's rows: the variants it can mention, narrowed by what follows the @, then Tag an element.
  const elements = !optsRef.current.noElements && !!s.place
  const choices = useMemo(() => menuAt ? host.variantMentions?.() ?? [] : [], [!!menuAt]) // eslint-disable-line react-hooks/exhaustive-deps
  const choose = (c: Target | null, close = true) => {
    if (!mention) return
    // A tap on the shelf stays open for another; its @ is gone, so what is typed next closes it.
    setMention(close ? null : { query: '', index: 0 })
    if (c) { insert(c, true); return }
    // The @ goes now; the element picked on the design comes back where it was.
    const r = atCaret(true)
    caret.current = { node: r.startContainer, offset: r.startOffset }
    changed()
    act.tagWhole(owner)
  }
  const shelfOpts = {
    choices, query: mention ? mention.query : null,
    tagged: () => {
      const keys = new Set<string>()
      input.current?.querySelectorAll<HTMLElement>('[data-tag]').forEach(n => { const r = tagsRef.current[Number(n.dataset.tag)]?.variantRef; if (r) keys.add(`${r.proto}/${r.variant}`) })
      return keys
    },
    onPick: (c: Target, close: boolean) => choose(c, close),
    onDrop: (c: Target) => {
      const r = c.variantRef!
      input.current?.querySelectorAll<HTMLElement>('[data-tag]').forEach(n => { const v = tagsRef.current[Number(n.dataset.tag)]?.variantRef; if (v?.proto === r.proto && v.variant === r.variant) n.remove() })
      changed(); setMention(m => m && { ...m })
    },
    ...(elements ? { onElement: () => choose(null) } : {}),
  }
  const shelf = useMentionShelf(shelfOpts)
  // Rows dragged in from the project tree: a chip each where the caret was (at the end when it never
  // was in the box), after a space, skipping what is tagged already.
  // Each chip it puts in is handed back, so the dragged chip can glide onto it (tag-drag.ts).
  const takeDrop = (d: TagDrop) => {
    const el = input.current
    if (!el?.isContentEditable) return
    const have = new Set<string>()
    el.querySelectorAll<HTMLElement>('[data-tag]').forEach(n => { const k = routeOfTag(tagsRef.current[Number(n.dataset.tag)] ?? {}); if (k) have.add(k) })
    const fresh = (host.tagsFor?.(d.routes) ?? []).filter(x => !have.has(routeOfTag(x)))
    if (!fresh.length) return
    const r = atCaret(false), n = r.startContainer
    const before = n.nodeType === 3 ? n.textContent!.slice(0, r.startOffset) : [...n.childNodes].slice(0, r.startOffset).map(c => c.textContent).join('')
    if (before && !/\s$/.test(before)) { const space = document.createTextNode(' '); r.insertNode(space); caret.current = { node: space, offset: 1 } }
    else caret.current = { node: r.startContainer, offset: r.startOffset }
    for (const x of fresh) { const chip = insert(x, false); if (chip) d.landed.push({ route: routeOfTag(x), el: chip }) }
  }
  const dropRef = useRef(takeDrop)
  dropRef.current = takeDrop
  useEffect(() => {
    const take = (e: Event) => { if (e.target === input.current) dropRef.current((e as CustomEvent<TagDrop>).detail) }
    document.addEventListener(TAG_EVENT, take)
    return () => document.removeEventListener(TAG_EVENT, take)
  }, [])
  const watchMention = () => {
    const sel = getSelection(), node = sel?.anchorNode
    const before = node?.nodeType === 3 ? node.textContent!.slice(0, sel!.anchorOffset) : '', m = /(?:^|[^\w.+-])@([^\s@]*)$/.exec(before)
    setMention(m ? { query: m[1], index: 0 } : null)
  }
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.nativeEvent.isComposing) return
    if (mention && shelf.onKey(e)) { e.preventDefault(); e.stopPropagation(); return }
    if (mention && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setMention(null); return }
    if (importing.current && isSendKey(e)) { e.preventDefault(); return }
    optsRef.current.onKey?.(e)
    if (e.defaultPrevented) return
    // Enter alone starts a new line, as it does in a text field, unless Enter sends (then Shift Enter does).
    if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) { e.preventDefault(); if (!isSendKey(e)) document.execCommand('insertLineBreak') }
  }
  const picking = s.wholeTag && s.tagOwner === owner
  const props = {
    ref, contentEditable: true, suppressContentEditableWarning: true, role: 'textbox', 'aria-multiline': true, dir: 'auto' as const,
    'data-tag-picking': picking || undefined,
    onInput: () => { saveCaret(); changed(); watchMention() },
    onKeyDown, onKeyUp: saveCaret, onMouseUp: saveCaret,
    onBlur: () => { saveCaret(); setMention(null) },
    // Rows of the project tree can be dragged onto it (tag-drag.ts).
    'data-tag-target': '',
    // Plain text keeps its words; image files become attachments.
    onDrop: (e: DragEvent<HTMLDivElement>) => { if (carriesImage(e.dataTransfer)) { e.preventDefault(); e.stopPropagation(); void attach([...e.dataTransfer.files], 'drop') } },
    onDragOver: (e: DragEvent<HTMLDivElement>) => { if (carriesImage(e.dataTransfer)) e.preventDefault() },
    onPaste: (e: ClipboardEvent<HTMLDivElement>) => { e.preventDefault(); const image = imageIn(e.clipboardData); if (image) { void attach([image], 'paste'); return }; document.execCommand('insertText', false, e.clipboardData.getData('text/plain')) },
  }

  // The shelf, over the page (outside whatever clips the box): above the box, or below it when there
  // is no room above.
  const box = menuAt ? input.current?.getBoundingClientRect() : null
  const below = !!box && box.top < 240
  const menu: ReactNode = menuAt && box ? createPortal(
    <MentionShelf shelf={shelf} open={!!mention} opts={shelfOpts} count={choices.length} place={{ center: box.left + box.width / 2, above: !below, edge: below ? box.bottom + 8 : innerHeight - box.top + 8 }} />, uiBox()) : null

  const pictures = (shots.length > 0 || adding || imageError) ? <span className="flex flex-wrap items-center gap-1 px-2 py-1">
      {shots.map((shot, i) => <span key={i} className="relative inline-block"><img src={shot.src} alt="Attached image" className="h-12 w-16 rounded object-cover" /><button type="button" aria-label="Remove image" className="absolute end-0 top-0 rounded bg-zinc-900 px-1 text-white" onClick={() => { shotsRef.current = shotsRef.current.filter((_, k) => k !== i); setShots(shotsRef.current); optsRef.current.onChange?.(read()) }}>×</button></span>)}

      {adding && <span role="status" className="text-xs">{t('Adding…')}</span>}{imageError && <span role="alert" className="text-xs text-rose-500">{imageError}</span>}
  </span> : null
  return {
    props, menu, adding, empty: adding || (empty && !shots.length), picking,
    pictures,
    el: () => input.current,
    focus: () => input.current?.focus({ preventScroll: true }),
    read,
    clear: () => { generation.current++; shotsRef.current = []; setShots([]); setImageError(''); input.current?.replaceChildren(); caret.current = null; tagsRef.current = []; setTags([]); setEmpty(true); setMention(null) },
  }
}

/** The placeholder of a box from useTagField: shown while it is empty, in the box's own padding. */
export const PLACEHOLDER = 'empty:before:pointer-events-none empty:before:text-zinc-400 empty:before:content-[attr(data-placeholder)]'
