// A page that isn't on prtype.dev (a mistyped short link, mostly): the host's "Link not found", in
// deep night. 404 (Next.js answers not-found with it).
import type { Metadata } from 'next'
import { MagnifyingGlassIcon } from '@phosphor-icons/react/ssr'
import { NightWords } from '@/components/states'
import { wordsOf } from '@/lib/done'

const { head, text } = wordsOf('notfound', 'en', null)
export const metadata: Metadata = { title: head, robots: { index: false, follow: false } }

export default function NotFound() {
  return <NightWords head={head} text={text} icon={<MagnifyingGlassIcon size={24} weight="fill" />} />
}
