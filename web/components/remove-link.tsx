'use client'
// Remove asks once, naming the comments that go with it: a Base UI alert dialog on a desktop, a drawer
// on a phone; one trigger, one open state. On the desktop dialog Remove takes the focus, as the page's
// inline question always did; Escape, the backdrop and Keep it all keep the link.
import { useRef, useState } from 'react'
import { AlertDialog } from '@base-ui/react/alert-dialog'
import { TrashIcon } from '@phosphor-icons/react'
import { Sheet } from './sheet'
import { useDesktop } from '@/lib/media'

const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`

export function RemoveLink({ comments, onRemove }: { comments: number; onRemove: () => void }) {
  const [open, setOpen] = useState(false)
  const desktop = useDesktop()
  const confirm = useRef<HTMLButtonElement>(null)
  const question = comments ? `Remove it and its ${plural(comments, 'comment')} for good?` : 'Remove it for good?'
  const text = 'The page goes, with its comments and its card. This can’t be undone.'
  const go = () => { setOpen(false); onRemove() }
  const buttons = (big: boolean) => (
    <div className={`flex gap-2 ${big ? 'mt-5 flex-col-reverse' : 'mt-5 justify-end'}`}>
      <button type="button" onClick={() => setOpen(false)} className={`${big ? 'h-12 text-[15px]' : 'h-9 text-[13px]'} rounded-lg px-3 font-medium text-ink2 hover:bg-tint`}>Keep it</button>
      <button ref={big ? undefined : confirm} type="button" onClick={go} className={`${big ? 'h-12 text-[15px]' : 'h-9 text-[13px]'} rounded-lg bg-danger px-3 font-medium text-white hover:bg-danger-deep`}>Remove</button>
    </div>
  )
  return (
    <>
      <AlertDialog.Root open={open && desktop} onOpenChange={setOpen}>
        <AlertDialog.Trigger data-shoot="remove" className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium text-dim hover:bg-danger-soft hover:text-danger">
          <TrashIcon size={16} aria-hidden="true" />Remove
        </AlertDialog.Trigger>
        <AlertDialog.Portal>
          <AlertDialog.Backdrop className="fixed inset-0 z-40 bg-ink/30 transition-opacity duration-150 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 motion-reduce:transition-none" />
          <AlertDialog.Popup initialFocus={confirm} data-shoot="confirm"
            className="fixed top-1/2 left-1/2 z-50 w-[min(400px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-line bg-white p-5 text-ink shadow-[0_24px_60px_-12px_rgba(18,16,25,0.3)] outline-none transition-[opacity,scale] duration-150 ease-out data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0 motion-reduce:transition-none">
            <AlertDialog.Title className="text-[15px] font-semibold">{question}</AlertDialog.Title>
            <AlertDialog.Description className="mt-1.5 text-[13.5px] leading-snug text-ink2">{text}</AlertDialog.Description>
            {buttons(false)}
          </AlertDialog.Popup>
        </AlertDialog.Portal>
      </AlertDialog.Root>
      {!desktop && <Sheet open={open} onOpenChange={setOpen} title={question} description={text}>{buttons(true)}</Sheet>}
    </>
  )
}
