import type { APIRoute } from 'astro'

// Search engines and AI answer engines are all welcome; the named bots are listed so the intent is explicit.
const bots = ['Googlebot', 'Bingbot', 'GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-SearchBot', 'Claude-User', 'PerplexityBot', 'Perplexity-User', 'Google-Extended', 'Applebot-Extended']

export const GET: APIRoute = ({ site }) => {
  const sitemap = new URL('sitemap-index.xml', site)
  const body = [...bots.map(b => `User-agent: ${b}\nAllow: /`), 'User-agent: *\nAllow: /', `Sitemap: ${sitemap.href}`].join('\n\n')
  return new Response(body + '\n', { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
}
