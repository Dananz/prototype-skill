'use client'
// The phone's side of each overlay on /me (Edit on your Mac, the account menu, Remove): a Vaul bottom
// drawer, dragged down or tapped outside to close. The desktop side is the Base UI primitive in each
// overlay's own component; both read one `open` state, held by that component, and one trigger.
import { Drawer } from 'vaul'
import type { ReactNode } from 'react'

export function Sheet({ open, onOpenChange, title, description, children }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: ReactNode
  children: ReactNode
}) {
  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-40 bg-ink/40" />
        <Drawer.Content className="fixed inset-x-0 bottom-0 z-50 flex max-h-[85dvh] flex-col rounded-t-[20px] bg-white pb-[max(16px,env(safe-area-inset-bottom))] text-ink outline-none">
          <Drawer.Handle className="mt-2.5 mb-1" />
          <div className="overflow-y-auto px-5 pt-3">
            <Drawer.Title className="text-[16px] font-semibold">{title}</Drawer.Title>
            {description ? <Drawer.Description className="mt-1 text-[14px] leading-snug text-ink2">{description}</Drawer.Description> : <Drawer.Description className="sr-only">{title}</Drawer.Description>}
            {children}
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  )
}
