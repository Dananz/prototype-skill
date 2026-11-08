// /sitemap.xml: the one public page. The Astro site's /sitemap-index.xml and /sitemap-0.xml move here
// for good (next.config.ts), for search consoles that know the old address.
import type { MetadataRoute } from 'next'
import { SITE } from '@/lib/site'

export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: `${SITE.url}/` }]
}
