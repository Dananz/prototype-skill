// Generated images land in src/assets/ while the variants are already on screen.
// image('kiosk-B-hero') is that file's URL once it exists and undefined until then: a variant draws
// a shape in its place meanwhile, and the page swaps the image in by itself when the file lands.
const files = import.meta.glob('./assets/*.{png,jpg,jpeg,webp,avif}', { eager: true, query: '?url', import: 'default' }) as Record<string, string>

export function image(name: string): string | undefined {
  for (const [path, url] of Object.entries(files)) if (path.slice('./assets/'.length).replace(/\.\w+$/, '') === name) return url
}
