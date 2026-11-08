import type { Face } from '@/lib/types'

export const nameOf = (a?: Face | null) => a?.name || a?.login || 'Someone'
// A face with no picture: its first letter on one of eight tints, the same one for the same login.
const tintOf = (s: string) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % 8 }
const TINTS = ['tint-0', 'tint-1', 'tint-2', 'tint-3', 'tint-4', 'tint-5', 'tint-6', 'tint-7']
const SIZES = { 20: 'size-5 text-[9px]', 24: 'size-6 text-[11px]', 28: 'size-7 text-[12px]', 30: 'size-[30px] text-[13.5px]' } as const
const GITHUB = /^https:\/\/avatars\.githubusercontent\.com\//

/** A GitHub picture, or the first letter on its tint. `plain` is the dark disc (the owner's own). */
export function Avatar({ who, size, plain = false, className = '' }: { who?: Face | null; size: keyof typeof SIZES; plain?: boolean; className?: string }) {
  const cls = `inline-grid shrink-0 place-items-center rounded-full object-cover font-semibold text-white ${SIZES[size]} ${className}`
  if (who?.avatar && GITHUB.test(who.avatar)) {
    // A plain <img>: a small GitHub picture, no optimizer on this Worker, and the CSP names its host.
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={who.avatar} alt="" title={nameOf(who)} width={size} height={size} referrerPolicy="no-referrer" className={`${cls} bg-ink`} />
  }
  return (
    <span aria-hidden="true" title={nameOf(who)} className={`${cls} ${plain ? 'bg-ink' : TINTS[tintOf(String(who?.login || who?.name || ''))]}`}>
      {nameOf(who).slice(0, 1).toUpperCase()}
    </span>
  )
}
