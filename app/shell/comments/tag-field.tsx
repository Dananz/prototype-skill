// A comment box that can tag: what is typed, with a chip in it wherever a tag was written. `@` opens
// a menu of the prototype's variants and, last, Tag an element, which picks one on the design and
// brings it back where the @ was. The box's owner holds its state (useTagField), so the box itself
// can come and go (the island's side panel folds while an element is picked) and keep what was in it.
import { useEffect, useId, useRef, useState, type ClipboardEvent, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { uiBox } from '../portals'
import { t } from '../i18n'
import { useCtx } from './ctx'
import { useStore } from './store'
import { chipNode, readEditor } from './composer'
import { Icon } from './ui'
import type { Note, Seg, Target } from './types'

type Opts = {
  /** Who a picked element goes back to; by default this box alone. */
  owner?: string
  /** No Tag an element (a phone's sheet covers the design). */
  noElements?: boolean
  /** What it starts with (a reply kept while its row was closed). */
  initial?: Note
  onChange?: (n: Note) => void
  /** Keys the box does not take itself: ⌘↩, Esc. */
  onKey?: (e: KeyboardEvent<HTMLDivElement>) => void
  /** Before a picked element comes back, open what the box is in; returns how long that takes, in ms. */
  reopen?: () => number
  /** The variant the note is about, when it may not be the one on screen: an element picked on the
   *  one on screen says which it is on. */
  about?: { proto: string; variant: string }
  autoFocus?: boolean
}

/** The words as written, the tags that are still in them numbered in order, trimmed at both ends. */
function noteOf(el: HTMLElement, tags: Target[]): Note {
  const used: number[] = []
  const body = readEditor(el).map(s => typeof s === 'string' ? s : { tag: used.includes(s.tag) ? used.indexOf(s.tag) : used.push(s.tag) - 1 })
  const trimmed = body.map((s, i) => typeof s === 'string' && i === 0 ? s.trimStart() : s).map((s, i, all) => typeof s === 'string' && i === all.length - 1 ? s.trimEnd() : s).filter((s): s is Seg => s !== '')
  return { body: trimmed, tags: used.map(k => tags[k]) }
}

export function useTagField(opts: Opts) {
  const { act, host, store } = useCtx()
  const s = useStore(store)
  const own = useId()
  const owner = opts.owner ?? `field${own}`
  const optsRef = useRef(opts)
  optsRef.current = opts
  const input = useRef<HTMLDivElement | null>(null)
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
  const menuRef = useRef<HTMLDivElement>(null)
  useEffect(() => { menuRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }) }, [mention?.index, !!mention])

  // The box goes when what it is in folds: what was in it moves into the next one, so its words, its
  // chips and where the caret was are all kept. The first one is filled with what it starts with.
  const lastBox = useRef<HTMLDivElement | null>(null)
  const ref = (el: HTMLDivElement | null) => {
    input.current = el
    if (!el || lastBox.current === el) return
    if (lastBox.current) el.append(...lastBox.current.childNodes)
    else {
      optsRef.current.initial?.body.forEach(seg => el.append(typeof seg === 'string' ? document.createTextNode(seg) : chipNode(tagsRef.current[seg.tag], seg.tag)))
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
    setEmpty(!el.innerText.trim())
    optsRef.current.onChange?.(noteOf(el, tagsRef.current))
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
  const insert = (p: Target, strip: boolean) => {
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
  const choices = menuAt ? (host.variantMentions?.() ?? []).filter(c => !menuAt.query || `${c.variantRef?.label} ${c.variantRef?.variant} ${c.variantRef?.name}`.toLocaleLowerCase().includes(menuAt.query.toLocaleLowerCase())) : []
  const options: (Target | null)[] = mention ? [...choices, ...(elements ? [null] : [])] : []
  const choose = (c: Target | null) => {
    if (!mention) return
    setMention(null)
    if (c) { insert(c, true); return }
    // The @ goes now; the element picked on the design comes back where it was.
    const r = atCaret(true)
    caret.current = { node: r.startContainer, offset: r.startOffset }
    changed()
    act.tagWhole(owner)
  }
  const watchMention = () => {
    const sel = getSelection(), node = sel?.anchorNode
    const before = node?.nodeType === 3 ? node.textContent!.slice(0, sel!.anchorOffset) : '', m = /(?:^|[^\w.+-])@([^\s@]*)$/.exec(before)
    setMention(m ? { query: m[1], index: 0 } : null)
  }
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.nativeEvent.isComposing) return
    if (mention && options.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); const step = e.key === 'ArrowDown' ? 1 : -1; setMention({ ...mention, index: (mention.index + step + options.length) % options.length }); return }
      if ((e.key === 'Enter' || e.key === 'Tab') && !e.metaKey && !e.ctrlKey && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); choose(options[Math.min(mention.index, options.length - 1)]); return }
    }
    if (mention && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setMention(null); return }
    optsRef.current.onKey?.(e)
    if (e.defaultPrevented) return
    // Enter alone starts a new line, as it does in a text field.
    if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) { e.preventDefault(); document.execCommand('insertLineBreak') }
  }
  const picking = s.wholeTag && s.tagOwner === owner
  const props = {
    ref, contentEditable: true, suppressContentEditableWarning: true, role: 'textbox', 'aria-multiline': true, dir: 'auto' as const,
    'data-tag-picking': picking || undefined,
    onInput: () => { saveCaret(); changed(); watchMention() },
    onKeyDown, onKeyUp: saveCaret, onMouseUp: saveCaret,
    onBlur: () => { saveCaret(); setMention(null) },
    // Pasted, only the words come in: no styles, links or pictures from where they were.
    onPaste: (e: ClipboardEvent<HTMLDivElement>) => { e.preventDefault(); document.execCommand('insertText', false, e.clipboardData.getData('text/plain')) },
  }

  // The menu, over the page (outside whatever clips the box): above the box, or below it when there
  // is no room above.
  const box = menuAt ? input.current?.getBoundingClientRect() : null
  const below = !!box && box.top < 240
  const menu: ReactNode = menuAt && box && (choices.length || elements) ? createPortal(
    <div ref={menuRef} role="listbox" aria-label={t('Mention a variant')} data-comment-ui=""
      style={{ position: 'fixed', zIndex: 250, left: Math.max(8, Math.min(box.left, innerWidth - Math.min(300, innerWidth - 16) - 8)), width: Math.min(300, innerWidth - 16), ...(below ? { top: box.bottom + 8 } : { bottom: innerHeight - box.top + 8 }) }}
      className={`${below ? 'origin-top-left' : 'origin-bottom-left'} overflow-hidden rounded-xl border border-black/10 bg-white text-[13px] text-zinc-900 shadow-lg dark:border-white/10 dark:bg-zinc-950 dark:text-zinc-100 ${mention ? 'pointer-events-auto animate-[proto-isl-menu-in_.18s_cubic-bezier(.2,.9,.25,1)_both]' : 'pointer-events-none animate-[proto-isl-menu-out_.14s_ease-in_forwards]'}`}>
      <div className="px-3 pb-1 pt-2 text-[11px] font-medium text-zinc-400">{t('Mention a variant')}</div>
      <div className="max-h-48 overflow-y-auto">
        {choices.map((c, i) => (
          <button key={`${c.variantRef?.proto}/${c.variantRef?.variant}/${c.variantRef?.label}`} type="button" role="option" aria-selected={i === menuAt.index} onMouseDown={e => e.preventDefault()} onClick={() => choose(c)}
            className={`flex min-h-9 w-full items-center gap-2 px-3 py-2 text-start text-xs ${i === menuAt.index ? 'bg-proto-primary-soft text-proto-primary-soft-fg' : 'hover:bg-zinc-900/5 dark:hover:bg-white/5'}`}>
            <span className="font-semibold">@{c.variantRef?.label}</span><span className="min-w-0 flex-1 truncate">{c.variantRef?.name}</span>
          </button>
        ))}
        {!choices.length && <p className="px-3 py-2 text-xs text-zinc-400">{t('No matching variants')}</p>}
      </div>
      {elements && <button type="button" role="option" data-tag-pick aria-selected={menuAt.index === choices.length} onMouseDown={e => e.preventDefault()} onClick={() => choose(null)}
        className={`flex min-h-9 w-full items-center gap-2 border-t border-black/[.06] px-3 py-2 text-start text-xs dark:border-white/10 ${menuAt.index === choices.length ? 'bg-proto-primary-soft text-proto-primary-soft-fg' : 'text-zinc-500 hover:bg-zinc-900/5 dark:hover:bg-white/5'}`}>
        <Icon name="target" className="size-3.5" />{t('Tag an element')}
      </button>}
    </div>, uiBox()) : null

  return {
    props, menu, empty, picking,
    el: () => input.current,
    focus: () => input.current?.focus({ preventScroll: true }),
    read: (): Note => input.current ? noteOf(input.current, tagsRef.current) : { body: [], tags: [] },
    clear: () => { input.current?.replaceChildren(); caret.current = null; tagsRef.current = []; setTags([]); setEmpty(true); setMention(null) },
  }
}

/** The placeholder of a box from useTagField: shown while it is empty, in the box's own padding. */
export const PLACEHOLDER = 'empty:before:pointer-events-none empty:before:text-zinc-400 empty:before:content-[attr(data-placeholder)]'
