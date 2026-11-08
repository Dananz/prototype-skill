import type { Metadata, Viewport } from 'next'
import { Google_Sans } from 'next/font/google'
import { headers } from 'next/headers'
import { Providers } from '@/components/providers'
import './globals.css'

// Self-hosted by next/font, so the CSP's font-src 'self' covers it.
const sans = Google_Sans({ subsets: ['latin'], variable: '--font-google-sans', display: 'swap', adjustFontFallback: false })

export const metadata: Metadata = {
  title: 'Your links',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
}
export const viewport: Viewport = { width: 'device-width', initialScale: 1 }

// English only, left to right: the page's words are written in English and nowhere else.
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const nonce = (await headers()).get('x-nonce') ?? ''
  return (
    <html lang="en" dir="ltr" className={sans.variable}>
      <body><Providers nonce={nonce}>{children}</Providers></body>
    </html>
  )
}
