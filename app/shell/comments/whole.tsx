// The box at the foot of the Comments panel (and the phone's list): a comment on the variant as a
// whole, written where the others are listed. Focus outlines the variant edge to edge, ⌘Enter adds
// the comment as a draft, and no composer opens in between.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { t } from '../i18n'
import { useCtx } from './ctx'
import { useStore } from './store'
import { Icon, MOD } from './ui'

export function WholeBox({ className = '' }: { className?: string }) {
  const { store, act } = useCtx()
  const s = useStore(store)
  const [text, setText] = useState('')
  const input = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const el = input.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [text])
  // ⇧C, or a sidebar row's Comment on this: the shell has made the box visible, this puts the cursor in it.
  // A tick later, so the key that asked (⇧C) has finished and its letter cannot land in the box.
  // Not cancelled by the effect's own cleanup: clearing the ask re-runs it before the tick.
  useEffect(() => {
    if (!s.focusAsk) return
    act.askDone()
    window.setTimeout(() => input.current?.focus({ preventScroll: true }), 0)
  }, [s.focusAsk, act])
  useEffect(() => () => act.wholeFocus(false), [act])
  const add = () => { if (act.commentWhole(text)) setText('') }
  return (
    <form data-shoot="whole-box" onSubmit={e => { e.preventDefault(); add() }} className={`flex items-center gap-1.5 rounded-xl bg-zinc-900/[.04] p-1 ring-1 ring-inset ring-transparent focus-within:ring-2 focus-within:ring-proto-primary-ring dark:bg-white/[.06] ${className}`}>
      <Icon name="frame" className="ms-2 mt-2.5 size-4 shrink-0 self-start text-zinc-400" />
      <textarea ref={input} data-shoot="whole-input" rows={1} value={text} onChange={e => setText(e.target.value)} dir="auto" autoComplete="off" enterKeyHint="enter"
        aria-label={t('Comment on the entire variant')} placeholder={t('Comment on the entire variant')} title={`${t('Comment on the whole variant')} · ⇧C`}
        onFocus={() => act.wholeFocus(true)} onBlur={() => act.wholeFocus(false)}
        onKeyDown={e => {
          if (e.nativeEvent.isComposing) return
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); e.stopPropagation(); add() }
          else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); input.current?.blur() }
        }}
        className="min-h-9 max-h-[116px] min-w-0 flex-1 resize-none overflow-y-auto bg-transparent py-2 text-[13px] leading-5 outline-none placeholder:text-zinc-400 [@media(pointer:coarse)]:text-base" />
      {text.trim() && <button type="submit" data-shoot="whole-add" aria-label={t('Add the comment')} title={`${t('Add the comment')} · ${MOD} Enter`}
        className="grid size-9 shrink-0 self-end place-items-center rounded-lg bg-proto-primary text-proto-primary-fg hover:bg-proto-primary-hover"><Icon name="send" className="size-4" /></button>}
    </form>
  )
}
