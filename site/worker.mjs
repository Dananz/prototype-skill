// prtype.dev: the site's files, served by Cloudflare straight from dist/ without running this script,
// and the share host's paths handed to the share Worker over a service binding (HOST). Only the paths
// in wrangler.jsonc's run_worker_first, and anything that is not a file, reach this script.

// A share's short link: prtype.dev/<id>, ten characters of the host's id alphabet (host/lib/ids.mjs).
const SHORT = /^\/[0-9a-hjkmnp-tv-z]{10}\/?$/
const HOSTED = /^\/(s\/|api(\/|$)|auth\/|_health$)/

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url)
    if (HOSTED.test(pathname) || SHORT.test(pathname)) {
      // Before the share host is deployed there is nothing to hand to.
      if (!env.HOST) return new Response('Shared links are not open yet.', { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } })
      return env.HOST.fetch(request)
    }
    return env.ASSETS.fetch(request)
  },
}
