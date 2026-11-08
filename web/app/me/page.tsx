// prtype.dev/me: asks the share host who this is, then draws that page. The owner's links come from
// the host on the server too, into TanStack Query's cache, so the first paint is the whole page and
// there is no loading state to show.
import { dehydrate, HydrationBoundary, QueryClient } from '@tanstack/react-query'
import { FirstLink } from '@/components/first-link'
import { Header } from '@/components/header'
import { OwnerPage } from '@/components/owner-page'
import { Quiet, SignedOut } from '@/components/states'
import { sharesOf, whoIsIn } from '@/lib/host'
import { SHARES } from '@/lib/types'

// It reads the cookie and the CSP nonce: never prerendered.
export const dynamic = 'force-dynamic'

const Alone = ({ head, text }: { head: string; text: string }) => <div className="flex min-h-dvh flex-col"><Quiet head={head} text={text} /></div>

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [who, params] = await Promise.all([whoIsIn(), searchParams])
  if (who.kind === 'closed') return <Alone head="Your links live on prtype.dev" text="This host has no owner page." />
  if (who.kind === 'out') {
    if (!who.signin) return <Alone head="Sign-in isn’t set up on this host" text="Your links are on prtype.dev/me." />
    return <SignedOut failed={params.failed !== undefined} />
  }
  const { me } = who
  // An account that never shared sees what an owner with no links sees: how the first one gets here.
  if (me.state === 'none') return <div className="flex min-h-dvh flex-col"><Header me={me} /><FirstLink base={me.base} /></div>
  if (me.state !== 'owner') {
    const [head, text] = me.state === 'banned' ? [`@${me.login} can’t share here`, 'This account was blocked on this host.']
      : [`No links for @${me.login} yet`, 'Sharing opens once the maintainer approves your account.']
    return <div className="flex min-h-dvh flex-col"><Header me={me} /><Quiet head={head} text={text} /></div>
  }
  const client = new QueryClient()
  client.setQueryData(SHARES, await sharesOf())
  return (
    <HydrationBoundary state={dehydrate(client)}>
      <OwnerPage me={me} />
    </HydrationBoundary>
  )
}
