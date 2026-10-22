# Prototype site

The landing page for the Prototype skill, built with Astro. The page is static HTML; only the
hero card, the three steps and the install tabs run as islands, on Preact with its React
compatibility layer (the components are written as React; the browser gets Preact's 4 KB runtime).

```
pnpm install
pnpm dev       # local dev server
pnpm build     # type check, then static output in dist/
pnpm preview   # serve dist/
```

The site URL is `https://prototype.dananz.com`; set `SITE_URL` to build for another address (`SITE_URL=https://… pnpm build`).
Canonical links, the sitemap, robots.txt and the share image's absolute URL all come from it.

- `src/pages/index.astro`: the page. `src/layouts/Base.astro`: head, meta, fonts, JSON-LD.
- `src/content.ts`: the description and the questions, shared by the page, the structured data and `llms.txt`.
- `src/pages/robots.txt.ts`, `src/pages/llms.txt.ts`: generated at build. The sitemap comes from `@astrojs/sitemap`.
- Static-page icons are Phosphor's SVGs from `@phosphor-icons/core` (`src/components/Icon.astro`); islands use `@phosphor-icons/react`.
- `astro.config.mjs` bundles Phosphor and the React entries into the server render so they resolve to `preact/compat`.
- Fonts are self-hosted through the Astro Fonts API (Fontsource), with Google Sans preloaded.
