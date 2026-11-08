import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import type { NextConfig } from 'next'
import { initOpenNextCloudflareForDev } from '@opennextjs/cloudflare'

// Sonner and Vaul put their CSS in the page as a <style> they make at runtime, with no nonce. The CSP
// (middleware.ts) lets those two exact texts in by their hashes, worked out here from the installed
// packages at build time, so an upgrade that changes them gets its own hashes and nothing else gets in.
// Both put the <style> in the page empty and fill it after: the empty one is checked too, so its hash
// (of nothing, which can style nothing) is in the list as well.
const require = createRequire(import.meta.url)
function injectedStyleHashes(pkg: string): string[] {
  const out = new Set<string>([`'sha256-${createHash('sha256').update('').digest('base64')}'`])
  const cjs = require.resolve(pkg)
  for (const file of [cjs, cjs.replace(/\.js$/, '.mjs')]) {
    const src = readFileSync(file, 'utf8')
    for (const m of src.matchAll(/__insertCSS\(("(?:[^"\\]|\\.)*")\)/g)) {
      const css = runInNewContext(m[1]) as string
      out.add(`'sha256-${createHash('sha256').update(css, 'utf8').digest('base64')}'`)
    }
  }
  if (out.size < 2) throw new Error(`${pkg} no longer injects its CSS the way next.config.ts reads it: check the CSP's style hashes`)
  return [...out]
}

const nextConfig: NextConfig = {
  poweredByHeader: false,
  env: { ME_STYLE_HASHES: [...new Set([...injectedStyleHashes('sonner'), ...injectedStyleHashes('vaul')])].join(' ') },
  // The Astro site's sitemap addresses, for search consoles that still ask for them.
  async redirects() {
    return [
      { source: '/sitemap-index.xml', destination: '/sitemap.xml', permanent: true },
      { source: '/sitemap-0.xml', destination: '/sitemap.xml', permanent: true },
    ]
  },
}
export default nextConfig
initOpenNextCloudflareForDev()
