import type { Metadata, Viewport } from 'next'
import { Google_Sans } from 'next/font/google'
import { connection } from 'next/server'
import { SITE } from '@/lib/site'
import './globals.css'

// Self-hosted by next/font, so the CSP's font-src 'self' covers it. Never a monospace face: commands
// and code are set in Google Sans too.
const sans = Google_Sans({ subsets: ['latin'], variable: '--font-google-sans', display: 'swap', adjustFontFallback: false })

// Absolute URLs (canonical, og:image) are made on prtype.dev. Each page sets its own title.
export const metadata: Metadata = { metadataBase: new URL(SITE.url) }
export const viewport: Viewport = { width: 'device-width', initialScale: 1 }

// The landing and /me are written in English only, left to right. Every page renders on its request:
// Next.js puts the CSP's nonce (middleware.ts) on its scripts only then; a prerendered page's scripts
// would carry none and be refused.
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  await connection()
  return (
    <html lang="en" dir="ltr" className={sans.variable}>
      <body>{children}</body>
    </html>
  )
}
