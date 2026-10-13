// Generated images land in src/assets/ while the variants are already on screen.
// image('kiosk-B-hero') is that file's URL once it exists and undefined until then: a variant draws
// a shape in its place meanwhile, and the page swaps the image in by itself when the file lands
// (a new file re-runs this module).
const files = import.meta.glob('./assets/*.{png,jpg,jpeg,webp,avif}', { eager: true, query: '?url', import: 'default' }) as Record<string, string>
const byName = new Map(Object.entries(files).map(([path, url]) => [path.slice('./assets/'.length).replace(/\.\w+$/, ''), url]))

export const image = (name: string): string | undefined => byName.get(name)
