'use client'
// Edit on your Mac: the command to paste into Claude Code on the Mac the link was shared from. A Base
// UI popover below its button on a desktop, a drawer on a phone; one trigger, one open state.
import { useState } from 'react'
import { Popover } from '@base-ui/react/popover'
import { CheckIcon, CopyIcon, TerminalWindowIcon } from '@phosphor-icons/react'
import { AnimatedIcon } from './animated-icon'
import { Sheet } from './sheet'
import { useCopied } from '@/lib/copy'
import { useDesktop } from '@/lib/media'

const TEXT = 'The designs live on the Mac you shared from. Paste this into Claude Code there, then update the link.'

function Command({ command }: { command: string }) {
  const { done, copy } = useCopied()
  return (
    <>
      <div className="mt-3 flex items-center gap-1 rounded-xl bg-tint py-1 ps-3 pe-1">
        <code className="min-w-0 flex-1 py-1.5 text-[12.5px] leading-snug break-all">{command}</code>
        <button type="button" onClick={() => copy('cmd', command)} aria-label={done ? 'Copied' : 'Copy the command'} title="Copy the command"
          className="grid size-8 shrink-0 place-items-center rounded-lg text-ink2 hover:bg-white hover:text-ink max-md:size-11">
          <AnimatedIcon state={done ? 'done' : 'idle'} size={16}>{done ? <CheckIcon size={16} /> : <CopyIcon size={16} />}</AnimatedIcon>
        </button>
      </div>
      {/* Its line is always there, so the words appearing never move the drawer. */}
      <p className="mt-2 min-h-[18px] text-[12px] text-green" aria-live="polite">{done ? 'Copied. Paste it into Claude Code.' : ''}</p>
    </>
  )
}

export function EditOnMac({ command, buttonClass }: { command: string; buttonClass: string }) {
  const [open, setOpen] = useState(false)
  const desktop = useDesktop()
  return (
    <>
      <Popover.Root open={open && desktop} onOpenChange={setOpen}>
        <Popover.Trigger data-shoot="edit" aria-label="Edit on your Mac" title="Edit on your Mac" className={`${buttonClass} ${open ? 'bg-tint text-ink' : ''}`}>
          <TerminalWindowIcon size={18} aria-hidden="true" />
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner side="bottom" align="end" sideOffset={8} collisionPadding={12} className="z-50">
            <Popover.Popup className="w-[min(360px,calc(100vw-24px))] origin-[var(--transform-origin)] rounded-2xl border border-line bg-white p-4 text-ink shadow-[0_12px_40px_-8px_rgba(18,16,25,0.18)] outline-none transition-[opacity,scale] duration-150 ease-out data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0 motion-reduce:transition-none">
              <Popover.Title className="text-[14px] font-semibold">Edit on your Mac</Popover.Title>
              <Popover.Description className="mt-1 text-[13px] leading-snug text-ink2">{TEXT}</Popover.Description>
              <Command command={command} />
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
      {!desktop && <Sheet open={open} onOpenChange={setOpen} title="Edit on your Mac" description={TEXT}><Command command={command} /></Sheet>}
    </>
  )
}
