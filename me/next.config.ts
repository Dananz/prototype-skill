import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import type { NextConfig } from 'next'
import { initOpenNextCloudflareForDev } from '@opennextjs/cloudflare'

// Sonner and Vaul put their CSS in the page as a <style> they make at runtime, with no nonce. The CSP
// (middleware.ts) lets those two exact texts in by their hashes, worked out here from the installed
// packages at build time, so an upgrade that changes them gets its own hashes and nothing else gets in.
const require = createRequire(import.meta.url)
function injectedStyleHashes(pkg: string): string[] {
  const out = new Set<string>()
  const cjs = require.resolve(pkg)
  for (const file of [cjs, cjs.replace(/\.js$/, '.mjs')]) {
    const src = readFileSync(file, 'utf8')
    for (const m of src.matchAll(/__insertCSS\(("(?:[^"\\]|\\.)*")\)/g)) {
      const css = runInNewContext(m[1]) as string
      out.add(`'sha256-${createHash('sha256').update(css, 'utf8').digest('base64')}'`)
    }
  }
  if (!out.size) throw new Error(`${pkg} no longer injects its CSS the way next.config.ts reads it: check the CSP's style hashes`)
  return [...out]
}

const nextConfig: NextConfig = {
  poweredByHeader: false,
  env: { ME_STYLE_HASHES: [...injectedStyleHashes('sonner'), ...injectedStyleHashes('vaul')].join(' ') },
}
export default nextConfig
initOpenNextCloudflareForDev()
