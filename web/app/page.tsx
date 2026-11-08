// prtype.dev: the landing page, a Server Component. The hero card, the three steps, the install band
// and the questions are client components; the rest is plain HTML. It reads the CSP nonce (for the
// structured data), so it renders on each request, like every page under this CSP.
import type { Metadata, Viewport } from 'next'
import { headers } from 'next/headers'
import { GithubLogoIcon } from '@phosphor-icons/react/ssr'
import { Beats } from '@/components/landing/beats'
import { Faq } from '@/components/landing/faq'
import { Install } from '@/components/landing/install'
import { Machine } from '@/components/landing/machine'
import { LogoMark } from '@/components/landing/mark'
import { FAQ, SITE, faqText } from '@/lib/site'

export const metadata: Metadata = {
  title: SITE.title,
  description: SITE.description,
  alternates: { canonical: `${SITE.url}/` },
  icons: { icon: { url: '/favicon.svg', type: 'image/svg+xml' } },
  openGraph: {
    type: 'website',
    siteName: SITE.name,
    url: `${SITE.url}/`,
    title: SITE.title,
    description: SITE.description,
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'The Prototype logo: five isometric cubes, one picked in purple' }],
  },
  twitter: { card: 'summary_large_image', title: SITE.title, description: SITE.description, images: ['/og.png'] },
}

export const viewport: Viewport = { themeColor: '#ffffff' }

const ring = 'focus-visible:ring-2 focus-visible:ring-[#6d68f0] focus-visible:outline-none'

const jsonLd = [
  {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: SITE.name,
    description: SITE.description,
    url: `${SITE.url}/`,
    image: `${SITE.url}/og.png`,
    applicationCategory: 'DeveloperApplication',
    operatingSystem: 'macOS, Linux, Windows',
    license: 'https://opensource.org/licenses/MIT',
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    sameAs: [SITE.repo],
  },
  {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: FAQ.map(f => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: faqText(f.a) } })),
  },
]

export default async function Landing() {
  const nonce = (await headers()).get('x-nonce') ?? undefined
  return (
    <div dir="ltr" className="d-root min-h-full bg-white text-[13px] text-[#121019] antialiased">
      <link rel="sitemap" href="/sitemap.xml" />
      <script type="application/ld+json" nonce={nonce} dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }} />
      <a href="#main" className="sr-only z-50 rounded-lg bg-[#121019] px-4 py-2 text-sm font-medium text-white focus:not-sr-only focus:fixed focus:top-3 focus:left-3">Skip to content</a>

      <header className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 sm:px-8">
        <a href="#top" className={`flex items-center gap-2 rounded-md text-[17px] font-semibold ${ring}`}>
          <LogoMark tile className="h-8 w-8" title="" /> Prototype
        </a>
        <a href={SITE.repo} target="_blank" rel="noreferrer" aria-label="Prototype on GitHub"
          className={`grid h-9 w-9 place-items-center rounded-lg text-[#5b5870] transition-colors hover:bg-[#f3f2fe] hover:text-[#121019] ${ring}`}>
          <GithubLogoIcon size={20} aria-hidden="true" />
        </a>
      </header>

      <main id="main">
        <section id="top" className="mx-auto grid max-w-6xl grid-cols-[minmax(0,1fr)] items-center gap-10 gap-y-8 px-5 pt-6 pb-16 sm:px-8 lg:grid-cols-[1fr_1.1fr] lg:gap-14 lg:pt-14 lg:pb-24">
          <div className="contents lg:block">
            <h1 className="d-rise order-1 text-[44px] leading-[1.02] font-bold text-balance sm:text-[64px]">
              Type one line. <span className="text-[#6d68f0]">Pick one</span> of five.
            </h1>
            <p className="d-rise d-delay-1 order-3 max-w-md text-lg leading-relaxed text-[#4a4760] lg:mt-6">{SITE.description}</p>
            <div className="d-rise d-delay-3 order-4 flex flex-wrap items-center gap-x-6 gap-y-3 lg:mt-8">
              <a href="#install" className="inline-flex h-12 items-center rounded-xl bg-[#5a53e3] px-6 font-medium text-white transition-[background-color,transform] duration-200 hover:-translate-y-0.5 hover:bg-[#4a42d4] focus-visible:ring-2 focus-visible:ring-[#6d68f0] focus-visible:ring-offset-2 focus-visible:outline-none">
                Start prototyping
              </a>
            </div>
          </div>
          <div className="d-rise d-delay-2 order-2 lg:order-none"><Machine /></div>
        </section>

        <Beats />

        <Install />

        <section aria-labelledby="faq-title" className="mx-auto max-w-3xl px-5 pt-6 pb-20 sm:px-8 sm:pb-28">
          <h2 id="faq-title" className="text-[28px] leading-[1.1] font-bold sm:text-[36px]">Questions</h2>
          <Faq />
        </section>
      </main>

      <footer className="border-t border-[#efedfb]">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-8 text-sm text-[#5b5870] sm:px-8">
          <span className="flex items-center gap-2"><LogoMark animate="none" className="h-6 w-6" title="" /> Prototype, by Dananz</span>
          <a href={SITE.repo} target="_blank" rel="noreferrer" className={`rounded transition-colors hover:text-[#121019] ${ring}`}>GitHub</a>
        </div>
      </footer>
    </div>
  )
}
