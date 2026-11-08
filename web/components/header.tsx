'use client'
// The bar on top: the brand (to prtype.dev), the signed-in login and the avatar's menu with Sign out.
// A Base UI menu on a desktop, a drawer on a phone; one trigger, one open state.
import { useState } from 'react'
import Link from 'next/link'
import { Menu } from '@base-ui/react/menu'
import { SignOutIcon } from '@phosphor-icons/react'
import { Avatar } from './avatar'
import { Logo } from './logo'
import { Sheet } from './sheet'
import { useDesktop } from '@/lib/media'
import type { Me } from '@/lib/types'

// Sign out waits for the host: it is a change to who is signed in, never shown before it happened.
// Whatever the answer, the page reloads, and the host's own word on the cookie decides what it shows.
async function signOut() {
  try { await fetch('/me/api/signout', { method: 'POST', credentials: 'same-origin' }) } catch { /* reloads anyway */ }
  // A whole new load, not a client navigation: the server asks the host again, with no cookie now.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.assign('/me')
}

export function Header({ me }: { me: Me }) {
  const [open, setOpen] = useState(false)
  const desktop = useDesktop()
  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-soft bg-white px-4 sm:px-5">
      <Link href="/" prefetch={false} className="flex items-center gap-2 rounded-lg text-[15px] font-semibold"><Logo tile className="size-7" />Prototype</Link>
      <span className="flex items-center gap-2 text-[13px] text-ink2">
        <span className="max-sm:hidden">@{me.login}</span>
        <Menu.Root open={open && desktop} onOpenChange={setOpen}>
          <Menu.Trigger aria-label="Account" className="flex rounded-full max-md:p-1.5 max-md:-m-1.5">
            <Avatar who={{ avatar: me.avatar, name: me.name, login: me.login }} size={28} plain />
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Positioner side="bottom" align="end" sideOffset={8} className="z-50">
              <Menu.Popup className="min-w-40 origin-[var(--transform-origin)] rounded-xl border border-line bg-white p-1 shadow-[0_12px_40px_-8px_rgba(18,16,25,0.18)] outline-none transition-[opacity,scale] duration-150 ease-out data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0 motion-reduce:transition-none">
                <Menu.Item onClick={() => void signOut()} className="flex h-9 cursor-default items-center gap-2 rounded-lg px-2.5 text-[13px] text-ink2 outline-none select-none data-[highlighted]:bg-tint data-[highlighted]:text-ink">
                  <SignOutIcon size={16} aria-hidden="true" />Sign out
                </Menu.Item>
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>
      </span>
      {!desktop && (
        <Sheet open={open} onOpenChange={setOpen} title={me.name || `@${me.login}`} description={`Signed in with GitHub as @${me.login}.`}>
          <button type="button" onClick={() => void signOut()} className="mt-4 mb-1 flex h-12 w-full items-center gap-3 rounded-xl px-3 text-[15px] font-medium text-ink hover:bg-tint">
            <SignOutIcon size={20} aria-hidden="true" />Sign out
          </button>
        </Sheet>
      )}
    </header>
  )
}
