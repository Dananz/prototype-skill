// prtype.dev's router: a Worker with no files of its own. The share host's paths go to the share
// Worker (HOST), everything else to the Next.js app in ../web (its own Worker, WEB): the landing, its
// files (og.png, og-share.jpg, robots.txt, llms.txt, sitemap.xml, favicon.svg), /me and /_next.
// Both are service bindings (wrangler.jsonc).

// A share's short link: prtype.dev/<id>, ten characters of the host's id alphabet (host/lib/ids.mjs).
const SHORT = /^\/[0-9a-hjkmnp-tv-z]{10}\/?$/
// /me/api is the owner page's API, on the share host (host/lib/me.mjs); /me itself is the Next.js app.
const HOSTED = /^\/(s\/|api(\/|$)|auth\/|_health$|me\/api(\/|$))/

const closed = text => new Response(text, { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } })

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url)
    if (HOSTED.test(pathname) || SHORT.test(pathname)) {
      // Before the share host is deployed there is nothing to hand to.
      if (!env.HOST) return closed('Shared links are not open yet.')
      return env.HOST.fetch(request)
    }
    if (!env.WEB) return closed('prtype.dev is being set up.')
    return env.WEB.fetch(request)
  },
}
