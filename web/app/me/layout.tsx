import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { Providers } from '@/components/providers'

export const metadata: Metadata = {
  title: 'Your links',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
}

// /me's client state (TanStack Query), the CSP nonce for the libraries that add a <style>, and toasts.
export default async function MeLayout({ children }: { children: React.ReactNode }) {
  const nonce = (await headers()).get('x-nonce') ?? ''
  return <Providers nonce={nonce}>{children}</Providers>
}
