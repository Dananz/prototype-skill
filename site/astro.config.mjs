// @ts-check
import { defineConfig, fontProviders } from 'astro/config'
import preact from '@astrojs/preact'
import sitemap from '@astrojs/sitemap'
import tailwindcss from '@tailwindcss/vite'

// Bundled into the server render so their React imports resolve to preact/compat. Setting this list turns
// off the Preact integration's own one, so it repeats the React entries it would have added.
const bundled = ['@phosphor-icons/react', 'react', 'react-dom', 'react-dom/test-utils', 'react/jsx-runtime']

// The public address. Canonical links, the sitemap, robots.txt and the share image's absolute URL
// all come from it. SITE_URL overrides it, e.g. for a preview deploy.
const site = process.env.SITE_URL ?? 'https://prototype.dananz.com'

export default defineConfig({
  site,
  // Preact with its React compatibility layer: the islands keep their React code, but ship a 4 KB runtime instead of React's.
  integrations: [preact({ compat: true }), sitemap()],
  // One request fewer before first paint: the page's CSS (about 6 KB gzipped) goes inline.
  build: { inlineStylesheets: 'always' },
  vite: {
    plugins: [tailwindcss()],
    environments: {
      ssr: { resolve: { noExternal: bundled } },
      prerender: { resolve: { noExternal: bundled } },
    },
    preview: { allowedHosts: ['.ts.net'] },
  },
  fonts: [
    { provider: fontProviders.fontsource(), name: 'Google Sans', cssVariable: '--font-sans', weights: ['400 700'], subsets: ['latin'], fallbacks: ['system-ui', 'sans-serif'] },
    { provider: fontProviders.fontsource(), name: 'Google Sans Code', cssVariable: '--font-code', weights: ['400 600'], subsets: ['latin'], fallbacks: ['ui-monospace', 'monospace'] },
  ],
})
