// prtype.dev/done/<kind>: where the share host sends the browser when a sign-in ends or a link isn't
// there (lib/done.ts). Deep night, as /me's signed-out page, in English or Hebrew (right to left; the
// root layout reads the language middleware.ts took from ?lang). The status is middleware.ts's.
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { CheckCircleIcon, HourglassMediumIcon, MagnifyingGlassIcon, ProhibitIcon, WarningCircleIcon, XCircleIcon } from '@phosphor-icons/react/ssr'
import { NightWords } from '@/components/states'
import { DONE, isDoneKind, langOf, loginOf, wordsOf } from '@/lib/done'

type Props = { params: Promise<{ kind: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }

const ICON = { ok: CheckCircleIcon, wait: HourglassMediumIcon, stop: ProhibitIcon, off: XCircleIcon, fail: WarningCircleIcon, lost: MagnifyingGlassIcon }

async function read({ params, searchParams }: Props) {
  const [{ kind }, q] = await Promise.all([params, searchParams])
  if (!isDoneKind(kind)) notFound()
  const lang = langOf(q.lang)
  return { kind, lang, ...wordsOf(kind, lang, loginOf(q.login)) }
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { head } = await read(props)
  return { title: head, robots: { index: false, follow: false }, referrer: 'no-referrer' }
}

export default async function Done(props: Props) {
  const { kind, head, text, parts } = await read(props)
  const Icon = ICON[DONE[kind].tone]
  // The login stays left to right inside a Hebrew line.
  const shown = parts ? <>{parts[0]}<bdi dir="ltr">{parts[1]}</bdi>{parts[2]}</> : head
  return <NightWords kind={kind} head={shown} text={text} icon={<Icon size={24} weight="fill" />} />
}
