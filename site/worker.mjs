// prtype.dev: the site's files, served by Cloudflare straight from dist/ without running this script,
// and the share host's paths handed to the share Worker over a service binding (HOST). Only the paths
// in wrangler.jsonc's run_worker_first, and anything that is not a file, reach this script.

// A share's short link: prtype.dev/<id>, ten characters of the host's id alphabet (host/lib/ids.mjs).
const SHORT = /^\/[0-9a-hjkmnp-tv-z]{10}\/?$/
const HOSTED = /^\/(s\/|api(\/|$)|auth\/|_health$|me(\/|$))/
// /me/api: the owner page's API, on the share host (host/lib/me.mjs). The page itself, /me and its
// assets, is the Next.js app in me/ (its own Worker, ME); without it, the host's own page answers.
const ME_API = /^\/me\/api(\/|$)/
const ME = /^\/me(\/|$)/

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url)
    if (ME.test(pathname) && !ME_API.test(pathname) && env.ME) return env.ME.fetch(request)
    if (HOSTED.test(pathname) || SHORT.test(pathname)) {
      // Before the share host is deployed there is nothing to hand to.
      if (!env.HOST) return new Response('Shared links are not open yet.', { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } })
      return env.HOST.fetch(request)
    }
    return env.ASSETS.fetch(request)
  },
}
