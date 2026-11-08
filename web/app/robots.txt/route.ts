// robots.txt, byte for byte the Astro site's public/robots.txt (what prtype.dev served): the site is
// public; shared prototypes (/s/, and the short links /<id>, which answer noindex) are private links,
// kept out of search. Link previewers may read them to show a card in a chat. A route, not
// app/robots.ts: the Metadata API's robots file can't keep these comments and grouped user agents.
// Cloudflare's managed robots.txt (zone setting) is put before it at the edge, as before.
export const dynamic = 'force-static'

const ROBOTS = `# The site is public; shared prototypes (/s/, and the short links /<id>, which answer noindex) are
# private links, kept out of search. Link previewers may read them to show a card in a chat.

User-agent: Twitterbot
User-agent: facebookexternalhit
User-agent: Facebot
User-agent: LinkedInBot
User-agent: Slackbot
User-agent: Slackbot-LinkExpanding
User-agent: Discordbot
User-agent: TelegramBot
User-agent: WhatsApp
Disallow: /api
Disallow: /auth/

User-agent: *
Disallow: /s/
Disallow: /api
Disallow: /auth/
`

export function GET() {
  return new Response(ROBOTS, { headers: { 'content-type': 'text/plain; charset=utf-8' } })
}
