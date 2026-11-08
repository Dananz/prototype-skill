import type { Metadata, Viewport } from 'next'
import { Google_Sans } from 'next/font/google'
import { headers } from 'next/headers'
import { SITE } from '@/lib/site'
import './globals.css'

// Self-hosted by next/font, so the CSP's font-src 'self' covers it. Never a monospace face: commands
// and code are set in Google Sans too.
const sans = Google_Sans({ subsets: ['latin'], variable: '--font-google-sans', display: 'swap', adjustFontFallback: false })

// Absolute URLs (canonical, og:image) are made on prtype.dev. Each page sets its own title; /me has
// its own icon (app/me/icon.svg).
export const metadata: Metadata = { metadataBase: new URL(SITE.url), icons: { icon: { url: '/favicon.svg', type: 'image/svg+xml' } } }
export const viewport: Viewport = { width: 'device-width', initialScale: 1 }

// The landing and /me are written in English only; /done also in Hebrew, right to left (middleware.ts
// says which, from ?lang). Reading the request's headers renders every page on its request: Next.js
// puts the CSP's nonce (middleware.ts) on its scripts only then; a prerendered page's scripts would
// carry none and be refused. Google Sans' Hebrew faces are in the font's CSS, loaded only when used.
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const he = (await headers()).get('x-lang') === 'he'
  return (
    <html lang={he ? 'he' : 'en'} dir={he ? 'rtl' : 'ltr'} className={sans.variable}>
      <body>{children}</body>
    </html>
  )
}
