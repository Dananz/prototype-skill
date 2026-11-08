'use client'
// The one way an icon changes on /me (Copy to Check and back): the old one blurs and shrinks out while
// the new one blurs and grows in, overlapping, in a fixed box. Reduced motion: a short fade. The icons
// are decorative; the control around them owns the name and the state. Before the page is live (the
// server's HTML and the first render) the icon is drawn plain: Motion's inline styles in the server's
// HTML would be refused by the CSP, and there is nothing to animate yet.
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import type { ReactNode } from 'react'
import { useMounted } from '@/lib/media'

export function AnimatedIcon({ state, size, children }: { state: string; size: number; children: ReactNode }) {
  const mounted = useMounted()
  const reduce = useReducedMotion()
  const box = 'relative inline-grid shrink-0 place-items-center'
  const sized = size === 18 ? 'size-[18px]' : size === 16 ? 'size-4' : 'size-[17px]'
  if (!mounted) return <span aria-hidden="true" className={`${box} ${sized}`}>{children}</span>
  const blur = reduce ? {} : { filter: 'blur(6px)', scale: 0.85 }
  const sharp = reduce ? {} : { filter: 'blur(0px)', scale: 1 }
  return (
    <span aria-hidden="true" className={`${box} ${sized}`}>
      <AnimatePresence mode="sync" initial={false}>
        <motion.span key={state} className="absolute inset-0 grid place-items-center"
          initial={{ opacity: 0, ...blur }} animate={{ opacity: 1, ...sharp }} exit={{ opacity: 0, ...blur }}
          transition={{ duration: reduce ? 0.12 : 0.2, ease: 'easeOut' }}>
          {children}
        </motion.span>
      </AnimatePresence>
    </span>
  )
}
