import { headers } from 'next/headers'
import { getCloudflareContext } from '@opennextjs/cloudflare'
import { Probe } from './probe'
export const dynamic = 'force-dynamic'
export default async function Page() {
  const h = await headers()
  let host = 'no binding'
  try {
    const { env } = getCloudflareContext() as unknown as { env: { HOST?: { fetch: typeof fetch } } }
    if (env.HOST) host = String((await env.HOST.fetch('https://prtype.dev/_health')).status)
  } catch (e) { host = String(e) }
  return <main className="p-8 font-sans"><h1>spike</h1><p>nonce {h.get('x-nonce') ? 'set' : 'missing'}; host {host}</p><Probe /></main>
}
