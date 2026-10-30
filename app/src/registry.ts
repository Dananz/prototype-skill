// Finds the prototypes: src/protos/<slug>/meta.ts, plus one file per variant named by its
// letter (A.tsx, B.tsx … or A.vue …). The logic is in registry-core.ts; only the globs live here.
import type { Proto } from '../shell/shell'
import { protosOf, type Meta, type VersionMeta } from './registry-core'

const metas = import.meta.glob<Meta>('./protos/*/meta.ts', { eager: true, import: 'default' })
// Only files named by a letter are variants; helpers beside them (parts.tsx) have no default
// export, and importing one for it would break the page. Not eager: a variant's module loads
// the first time it is shown, so the page only pays for what is on screen.
const files = import.meta.glob(['./protos/*/[A-Z].{tsx,jsx,vue,svelte}', './protos/*/[A-Z][A-Z].{tsx,jsx,vue,svelte}'], { import: 'default' })

// Earlier versions of variants (app/history.mjs), shown beside them by the History tool. The
// version.json files are small and read at once; a version's design loads only when it is shown.
const versionMetas = import.meta.glob<VersionMeta>('./history/*/*/*/version.json', { eager: true, import: 'default' })
const versionFiles = import.meta.glob(['./history/*/*/*/[A-Z].{tsx,jsx,vue,svelte}', './history/*/*/*/[A-Z][A-Z].{tsx,jsx,vue,svelte}'], { import: 'default' })

export const protos: Proto[] = protosOf(metas, files, { metas: versionMetas, files: versionFiles })
