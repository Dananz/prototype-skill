// Writing a comment on one element, or on a moment or a range of the design's motion (in the motion
// dock). `@` or Tag another element starts the existing visual picker, without a named-element menu; the camera captures the design around the
// element (all of it, on a moment) and opens the editor; an image pasted (Ctrl+V) or dropped on the
// composer is attached in its place; ⌘↩ adds it. Whatever is written is held by
// the store as it is typed, so putting the composer away any way but Cancel or Add loses nothing.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { useCtx } from './ctx'
import { find } from './dom'
import { capture, ShotEditor } from './shot'
import type { Box, Draft, Seg, Target, Time } from './types'
import { IB, Icon, MOD, PinDot, PRIMARY, spanOf, SrcTag, srcOf, ImageChip, ViewChip } from './ui'

function readEditor(el: HTMLElement): Seg[] {
  const out: Seg[] = []
  el.childNodes.forEach(n => {
    if (n.nodeType === 3) { if (n.textContent) out.push(n.textContent.replace(/​/g, '')) }
    else if ((n as HTMLElement).dataset?.tag) out.push({ tag: Number((n as HTMLElement).dataset.tag) })
    else if ((n as HTMLElement).tagName === 'BR') out.push('\n')
    else out.push((n as HTMLElement).innerText)
  })
  return out.filter(s => s !== '')
}
const chipNode = (t: Target | undefined, i: number) => {
  const s = document.createElement('span')
  s.contentEditable = 'false'
  s.dataset.tag = String(i)
  const src = srcOf(t)
  if (src) s.title = src.full
  s.className = 'mx-px inline-flex items-center rounded bg-proto-primary-soft px-1 font-medium text-proto-primary-soft-fg'
  s.textContent = `@${i + 1}`
  return s
}
const endRange = (el: HTMLElement) => { const x = document.createRange(); x.selectNodeContents(el); x.collapse(false); return x }

// An image from the clipboard or dropped on the composer becomes the comment's picture, the way a
// screenshot does. It goes through a canvas, so whatever it was (a GIF, a BMP from a screenshot
// tool) it is sent as a PNG the server keeps (it takes png, jpeg and webp only), at most MAX_SIDE
// px a side; one still too big for localStorage is sent as a JPEG.
const MAX_SIDE = 2000
const imageIn = (dt: DataTransfer | null) => {
  if (!dt) return null
  for (const f of dt.files) if (f.type.startsWith('image/')) return f
  for (const i of dt.items) if (i.kind === 'file' && i.type.startsWith('image/')) return i.getAsFile()
  return null
}
const carriesImage = (dt: DataTransfer | null) => !!dt && [...dt.items].some(i => i.kind === 'file' && i.type.startsWith('image/'))
async function imageUrl(file: File): Promise<string | null> {
  const src = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = src
    await img.decode()
    const k = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight))
    const c = document.createElement('canvas')
    c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k))
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
    const png = c.toDataURL('image/png')
    return png.length < 3_000_000 ? png : c.toDataURL('image/jpeg', 0.9)
  } catch { return null } finally { URL.revokeObjectURL(src) }
}

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
  const { host, store, act } = useCtx()
  const nudge = store.get().nudge
  const pending = store.get().pendingTag
  const ed = useRef<HTMLDivElement>(null)
  const [tags, setTags] = useState<Target[]>(initial?.tags ?? [])
  const tagsRef = useRef(tags)
  tagsRef.current = tags
  const [shot, setShot] = useState<string | undefined>(initial?.shot)
  const shotRef = useRef(shot)
  shotRef.current = shot
  // Whether the picture is an image the user pasted or dropped, not one of the design.
  const [pasted, setPasted] = useState(!!initial?.pasted)
  const pastedRef = useRef(pasted)
  pastedRef.current = pasted
  const box = useRef<HTMLDivElement>(null)
  const [empty, setEmpty] = useState(!initial || !initial.body.some(s => typeof s !== 'string' || s.trim()))
  const emit = () => { if (!editing && ed.current) act.hold({ body: readEditor(ed.current), tags: tagsRef.current, shot: shotRef.current, pasted: pastedRef.current }, target, time) }
  // Moving the comment to the parent (or back) keeps what is held on the element it is on now.
  useEffect(emit, [tags, shot, pasted, target?.selector]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (nudge) box.current?.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'translateX(-3px)' }, { transform: 'translateX(0)' }], { duration: 320, easing: 'ease-out' })
  }, [nudge])
  // What the picture's place says while one is on its way: a screenshot being taken, or an image read.
  const [capturing, setCapturing] = useState<string | null>(null)
  const [dropping, setDropping] = useState(false)
  const [marking, setMarking] = useState<string | null>(null)
  const range = useRef<Range | null>(null)

  useLayoutEffect(() => {
    const el = ed.current!
    el.replaceChildren()
    initial?.body.forEach(s => el.append(typeof s === 'string' ? document.createTextNode(s) : chipNode(initial.tags[s.tag], s.tag)))
    el.focus({ preventScroll: true })
    const sel = getSelection(); sel?.selectAllChildren(el); sel?.collapseToEnd()
    // On a phone the composer is a sheet over the bottom: the element moves up into view above it.
    if (sheet && target) find(host.mount(), target)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const saveRange = () => { const s = getSelection(); if (s?.rangeCount && ed.current?.contains(s.anchorNode)) range.current = s.getRangeAt(0).cloneRange() }
  const insert = (p: Target) => {
    const el = ed.current!
    const i = tagsRef.current.length
    setTags(t => [...t, p])
    el.focus()
    const r = range.current && el.contains(range.current.startContainer) ? range.current : endRange(el)
    // The @ and what was typed after it go; the chip takes their place.
    const tn = r.startContainer
    if (tn.nodeType === 3) {
      const txt = tn.textContent!, at = txt.lastIndexOf('@', r.startOffset - 1)
      if (at >= 0 && /^[^\s@]*$/.test(txt.slice(at + 1, r.startOffset))) { r.setStart(tn, at); r.deleteContents() }
    }
    const chip = chipNode(p, i), space = document.createTextNode(' ')
    r.insertNode(space); r.insertNode(chip)
    const after = document.createRange(); after.setStartAfter(space); after.collapse(true)
    const s = getSelection(); s?.removeAllRanges(); s?.addRange(after)
    setEmpty(false)
    saveRange()
  }
  // Something picked on the design to tag comes back here.
  useEffect(() => {
    if (!pending || tagging) return
    act.tagTaken()
    insert(pending)
  }, [pending, tagging]) // eslint-disable-line react-hooks/exhaustive-deps

  const submit = () => {
    const body = readEditor(ed.current!)
    if (!body.some(s => typeof s !== 'string' || s.trim()) && !tags.length) return
    act.save({ body, tags, shot, pasted: (!!shot && pasted) || undefined }, target, id, time)
  }
  const shoot = async () => {
    setCapturing('Capturing…')
    // A design in a device view's frame may not draw from this window; then there is no picture.
    try { const url = await capture(host.mount(), target ?? WHOLE, host.dark()); if (url) setMarking(url) } catch { /* nothing to mark up */ } finally { setCapturing(null) }
  }
  const attach = async (file: File) => {
    setCapturing('Adding…')
    try { const url = await imageUrl(file); if (url) { setShot(url); setPasted(true) } } finally { setCapturing(null); refocus() }
  }

  const W = 312
  const lay = host.layer.getBoundingClientRect()
  let style: CSSProperties = {}
  if (!sheet && !docked && place) {
    const right = place.x + place.w + 12 + W < lay.width - 8
    const left = place.x - 12 - W > 8
    const x = right ? place.x + place.w + 12 : left ? place.x - 12 - W : Math.min(Math.max(8, place.x), lay.width - W - 8)
    const y = right || left ? Math.min(Math.max(8, place.y - 8), lay.height - 260) : Math.min(place.y + place.h + 12, lay.height - 260)
    style = { left: x, top: Math.max(8, y), width: W }
  }
  const keys = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); void act.send() }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); act.close() }
  }
  const refocus = () => requestAnimationFrame(() => ed.current?.focus())
  return (
    <>
      <div ref={box} data-composer onKeyDown={keys}
        onDragOver={e => { if (!carriesImage(e.dataTransfer)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setDropping(true) }}
        onDragLeave={e => { if (!box.current?.contains(e.relatedTarget as Node)) setDropping(false) }}
        onDrop={e => { setDropping(false); const f = imageIn(e.dataTransfer); if (!f) return; e.preventDefault(); void attach(f) }}
        className={`pointer-events-auto z-30 flex flex-col text-[13px] text-zinc-900 dark:text-zinc-100 ${docked ? 'relative' : `rounded-2xl border border-black/10 bg-white shadow-2xl shadow-black/15 dark:border-white/10 dark:bg-zinc-900 ${sheet ? 'absolute inset-x-2 bottom-2' : 'absolute'}`} ${tagging ? 'opacity-60' : ''} ${dropping ? 'ring-2 ring-proto-primary-ring' : ''}`} style={style}>
        <div className="flex items-center gap-2 px-3 pt-2.5">
          <PinDot n={n} size="sm" />
          {time
            ? <span className="inline-flex min-w-0 flex-1 items-center gap-1 text-[11px] font-semibold tabular-nums text-proto-primary-soft-fg"><svg className="size-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={time.to === undefined ? TIME_PATH.at : TIME_PATH.range} /></svg>{time.to === undefined ? `At ${spanOf(time)}` : spanOf(time)}</span>
            // In a view the size takes the file's place: the list shows the file under the words.
            : <><ViewChip v={target?.view} /><span dir="auto" className="min-w-0 flex-1 truncate text-xs font-medium">Comment</span>{!target?.view && <SrcTag t={target} />}</>}
        </div>
        <div className="relative px-3 pt-1.5">
          <div ref={ed} contentEditable suppressContentEditableWarning role="textbox" aria-label="Comment" aria-multiline="true" dir="auto"
            onInput={() => {
              saveRange(); setEmpty(!ed.current!.innerText.trim()); emit()
              const s = getSelection(), node = s?.anchorNode
              const text = node?.nodeType === 3 ? node.textContent!.slice(0, s!.anchorOffset) : ''
              if (/(^|\s)@$/.test(text)) act.tagPick()
            }}
            onKeyUp={saveRange} onMouseUp={saveRange} onBlur={saveRange}
            onPaste={e => { const f = imageIn(e.clipboardData); if (!f) return; e.preventDefault(); void attach(f) }}
            className="max-h-40 min-h-[52px] overflow-y-auto whitespace-pre-wrap break-words py-1 leading-5 outline-none [@media(pointer:coarse)]:min-h-[60px] [@media(pointer:coarse)]:text-base [@media(pointer:coarse)]:leading-6" />
          {empty && <span className="pointer-events-none absolute left-3 top-2.5 text-zinc-400 [@media(pointer:coarse)]:text-base [@media(pointer:coarse)]:leading-6">{time ? `What should change ${time.to === undefined ? 'at this moment' : 'over this range'}? @ tags an element` : 'What should change? @ tags another element'}</span>}

        </div>
        {(capturing || (shot && !pasted)) && (
          <div className="flex items-center gap-2 px-3 pb-1 pt-1.5">
            {capturing ? <span className="grid h-12 w-20 place-items-center rounded-lg bg-zinc-900/[.04] text-[11px] text-zinc-400 dark:bg-white/[.06]">{capturing}</span>
              : <button onClick={() => setMarking(shot!)} title="Edit the screenshot" className="group relative h-12 w-20 overflow-hidden rounded-lg ring-1 ring-black/10 dark:ring-white/15"><img src={shot} alt="Screenshot" className="size-full object-cover" /><span className="absolute inset-0 grid place-items-center bg-black/40 text-[11px] font-medium text-white opacity-0 transition group-hover:opacity-100">Edit</span></button>}
            {shot && <button onClick={() => { setShot(undefined); setPasted(false) }} className="text-xs text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200">Remove</button>}
          </div>
        )}
        <div className="flex items-center gap-1 px-2 pb-2 pt-1">
          <button onClick={() => { saveRange(); act.tagPick() }} title="Tag another element on the design" aria-label="Tag another element" className={`${IB} h-8 min-w-8 px-1.5`}><Icon name="target" /></button>
          <button onClick={shoot} title={`Screenshot this part of the design, then draw on it (or paste an image: ${MOD} V, or drop one here)`} aria-label="Attach a screenshot" className={`${IB} h-8 min-w-8 px-1.5`}><Icon name="camera" /></button>
          {shot && pasted && !capturing && <ImageChip src={shot} onOpen={() => setMarking(shot)} onRemove={() => { setShot(undefined); setPasted(false) }} />}
          {editing && <button onClick={() => id && act.remove(id)} title="Delete" aria-label="Delete comment" className={`${IB} h-8 min-w-8 px-1.5 hover:text-rose-600`}><Icon name="trash" /></button>}
          <span className="ms-auto" />
          <button onClick={() => act.cancel()} className="h-8 rounded-lg px-2.5 text-xs font-medium text-zinc-500 hover:bg-zinc-900/5 dark:hover:bg-white/10">Cancel</button>
          <button onClick={submit} disabled={empty && !tags.length} title={`Add, to send with the rest · ${MOD} Enter adds and sends to Claude`} className={`inline-flex h-8 items-center gap-1 rounded-lg pl-2 pr-3 text-xs font-semibold disabled:opacity-40 ${PRIMARY}`}><Icon name={editing ? 'check' : 'plus'} className="size-3.5" />{editing ? 'Save' : 'Add'}</button>
        </div>
      </div>
      {marking && <ShotEditor src={marking} onCancel={() => { setMarking(null); refocus() }} onDone={url => { setPasted(pasted && marking === shot); setShot(url); setMarking(null); refocus() }} />}
    </>
  )
}
