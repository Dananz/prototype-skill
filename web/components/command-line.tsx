'use client'
// One command to paste into Claude Code, with its Copy button: the line, never a monospace face, and a
// button whose Copy turns to a check through the shared AnimatedIcon. The caller owns the copied state
// (lib/copy), so a few lines can share one "Copied" line under them. Two tones: on a tinted popover or
// drawer (Edit on your Mac), and as a white card on the page (/me with no links).
import { CheckIcon, CopyIcon } from '@phosphor-icons/react'
import { AnimatedIcon } from './animated-icon'

const TONE = {
  tint: {
    row: 'rounded-xl bg-tint py-1 ps-3 pe-1',
    code: 'text-[12.5px] break-all',
    button: 'size-8 rounded-lg text-ink2 hover:bg-white hover:text-ink max-md:size-11',
    size: 16,
  },
  card: {
    row: 'rounded-xl border border-line bg-white py-1 ps-3.5 pe-1',
    code: 'text-[13.5px] font-medium text-ink break-words',
    button: 'size-9 rounded-[9px] text-ink2 hover:bg-tint hover:text-ink',
    size: 17,
  },
} as const

export function CommandLine({ command, copied, onCopy, tone = 'tint', shoot, className = '' }: {
  command: string; copied: boolean; onCopy: () => void; tone?: keyof typeof TONE; shoot?: string; className?: string
}) {
  const t = TONE[tone]
  const bold = tone === 'card' ? 'bold' : 'regular'
  return (
    <div className={`flex items-center gap-1 ${t.row} ${className}`}>
      <code className={`min-w-0 flex-1 py-1.5 leading-snug ${t.code}`}>{command}</code>
      <button type="button" data-shoot={shoot} onClick={onCopy} aria-label={copied ? 'Copied' : 'Copy the command'} title={copied ? 'Copied' : 'Copy the command'}
        className={`grid shrink-0 place-items-center ${t.button} ${copied && tone === 'card' ? 'text-green! hover:text-green!' : ''}`}>
        <AnimatedIcon state={copied ? 'done' : 'idle'} size={t.size}>{copied ? <CheckIcon size={t.size} weight={bold} /> : <CopyIcon size={t.size} />}</AnimatedIcon>
      </button>
    </div>
  )
}
