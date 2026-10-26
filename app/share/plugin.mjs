// The Vite plugins of a share build (`vite build --mode share`, run by build.mjs). The session app
// is built as it is, with five of its modules swapped for ones made from the scope: the registry
// holds only the chosen variants, session.json only its name, stack and language, images.ts only
// the pictures those variants name, and slot-source.ts the slot picks of this moment with nothing
// else. Everything the swapped-out globs would have pulled in is then simply not in the bundle.
import { existsSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { join, relative, sep } from 'node:path'
import { metaOf, slotPointers } from '../server.mjs'
import { trimMeta, trimSession } from './scope.mjs'
import { stampsPlugin } from './stamps.mjs'
import { imagesPlugin } from './images.mjs'

const VARIANT_EXTS = ['tsx', 'jsx', 'vue', 'svelte']
const ASSET_EXTS = /\.(png|jpe?g|webp|avif)$/i
const CODE_EXTS = /\.(m?[jt]sx?|vue|svelte)$/
const VIRTUAL = { registry: '\0proto-share:registry', session: '\0proto-share:session', images: '\0proto-share:images', slots: '\0proto-share:slots' }

/** sharp from ~/.prototypes/share-tools, where `proto share` installs it; null when it isn't there. */
export function loadSharp() {
  try { return createRequire(join(homedir(), '.prototypes', 'share-tools', 'index.js'))('sharp') } catch { return null }
}

const slash = p => p.replaceAll('\\', '/')
const bare = id => slash(id.split('?')[0])
const within = (dir, file) => { const r = relative(dir, file); return !!r && !r.startsWith('..') && !r.startsWith(sep) && !/^[a-z]:/i.test(r) }
const filesIn = dir => {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? filesIn(join(dir, e.name)) : [join(dir, e.name)])
}

/**
 * The names a set of files hands to image() as plain string literals, and whether any of them
 * works a name out at run time (then nobody can tell which pictures it needs).
 */
export function imageNames(sources) {
  const names = new Set()
  const dynamic = []
  for (const [file, code] of sources) {
    for (const m of code.matchAll(/(?<![\w$.-])image\(\s*(?:(['"])([^'"\\\n]*)\1|`([^`$\\]*)`)?\s*(\)?)/g)) {
      const name = m[2] ?? m[3]
      if (name !== undefined && m[4]) names.add(name)
      else dynamic.push(file)
    }
  }
  return { names, dynamic: [...new Set(dynamic)] }
}

/**
 * scope: { protos: [{ id, variants }], start } from parseScope. info: { title, owner, version,
 * updatedAt }, the share's own facts for the viewer (__PROTO_SHARE__). session: the real
 * session.json. appDir: the session app's folder. outDir: where Vite writes. report: a JSON file
 * this writes for build.mjs, with what the review needs from inside the build.
 */
export function sharePlugins({ scope, info, session, sharp, appDir, outDir, report }) {
  const root = realpathSync(appDir)
  // Vite hands plugins real paths; the session may sit behind a link (macOS /tmp), so every
  // comparison is made with the real ones, or nothing would match and the stamps would keep the
  // absolute paths they exist to remove.
  const protosDir = join(root, 'src', 'protos')
  const realProject = realpathSync(session.project)
  const shared = new Set(scope.protos.map(p => p.id))
  const variantFile = (slug, letter) => {
    const ext = VARIANT_EXTS.find(x => existsSync(join(protosDir, slug, `${letter}.${x}`)))
    if (!ext) throw new Error(`src/protos/${slug}/${letter} has no file`)
    return `${slug}/${letter}.${ext}`
  }

  // Slots: the variant plugged into each slot of a shared prototype right now. The plugged-in
  // variant's code comes along (it is what the shared variant shows); its prototype is not listed.
  const slots = Object.fromEntries(Object.entries(slotPointers()).filter(([key]) => shared.has(key.split('/')[0])))
  const slotFiles = [...new Set(Object.values(slots))].map(use => variantFile(...use.split('/')))

  const warnings = []
  // Pictures: those the shared prototypes' code (and the plugged-in variants') name in image('…').
  const scanned = [...new Set([...shared, ...slotFiles.map(f => f.split('/')[0])])]
    .flatMap(slug => filesIn(join(protosDir, slug)).filter(f => CODE_EXTS.test(f)).map(f => [slash(relative(protosDir, f)), readFileSync(f, 'utf8')]))
  const { names, dynamic } = imageNames(scanned)
  const assets = filesIn(join(root, 'src', 'assets')).filter(f => ASSET_EXTS.test(f))
  const keptAssets = dynamic.length ? assets : assets.filter(f => names.has(f.slice(join(root, 'src', 'assets').length + 1).replace(/\.\w+$/, '')))
  if (dynamic.length) warnings.push(`${dynamic.join(', ')} ${dynamic.length === 1 ? 'calls' : 'call'} image() with a name worked out while it runs, so every picture in src/assets is in the share`)

  const modules = {
    [VIRTUAL.registry]: () => {
      const metas = Object.fromEntries(scope.protos.map(p => [`./protos/${p.id}/meta.ts`, trimMeta(metaOf(readFileSync(join(protosDir, p.id, 'meta.ts'), 'utf8')), p.variants, shared)]))
      const files = scope.protos.flatMap(p => p.variants.map(v => variantFile(p.id, v)))
      return [
        `import { protosOf } from ${JSON.stringify(join(root, 'src', 'registry-core.ts'))}`,
        `const metas = ${JSON.stringify(metas)}`,
        `const files = {${files.map(f => `\n  ${JSON.stringify(`./protos/${f}`)}: () => import(${JSON.stringify(join(protosDir, f))}).then(m => m.default),`).join('')}\n}`,
        'export const protos = protosOf(metas, files)',
      ].join('\n')
    },
    [VIRTUAL.session]: () => `export default ${JSON.stringify(trimSession(session))}`,
    [VIRTUAL.images]: () => [
      ...keptAssets.map((f, i) => `import a${i} from ${JSON.stringify(`${f}?url`)}`),
      `const byName = new Map([${keptAssets.map((f, i) => `[${JSON.stringify(f.slice(join(root, 'src', 'assets').length + 1).replace(/\.\w+$/, ''))}, a${i}]`).join(', ')}])`,
      'export const image = name => byName.get(name)',
    ].join('\n'),
    [VIRTUAL.slots]: () => [
      `export const loaders = {${slotFiles.map(f => `\n  ${JSON.stringify(`./protos/${f}`)}: () => import(${JSON.stringify(join(protosDir, f))}),`).join('')}\n}`,
      `export const pointers = async () => (${JSON.stringify(slots)})`,
      'export const onChange = () => {}',
    ].join('\n'),
  }
  // The modules swapped, by the real file they stand for.
  const swapped = new Map([
    [slash(join(root, 'src', 'registry.ts')), VIRTUAL.registry],
    [slash(join(root, 'session.json')), VIRTUAL.session],
    [slash(join(root, 'src', 'images.ts')), VIRTUAL.images],
    [slash(join(root, 'src', 'slot-source.ts')), VIRTUAL.slots],
  ])
  const inProtos = id => within(protosDir, bare(id))

  const swap = {
    name: 'proto-share-modules',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      // The prototype files' JSX goes through shell/jsx.ts for their stamps; everything else
      // (the shell, jsx.ts itself, the project's files) through jsx-prod.ts, since production
      // React has no jsxDEV for the development transform's calls.
      if (source === 'react/jsx-dev-runtime') return join(root, importer && inProtos(importer) ? join('shell', 'jsx.ts') : join('share', 'jsx-prod.ts'))
      if (!/(?:^|\/)(?:registry|session\.json|images|slot-source)(?:\.ts)?$/.test(source) || !importer || importer.startsWith('\0')) return null
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true })
      return (resolved && swapped.get(bare(resolved.id))) ?? resolved
    },
    load(id) { return modules[id]?.() ?? null },
  }

  // The development JSX transform names the file of every tag. Under src/protos the stamps plugin
  // turns that into the path the dev server shows; anywhere else (the shell, @project files) it
  // would be this machine's absolute path in the share, so it is blanked.
  const fileNames = {
    name: 'proto-share-file-names',
    enforce: 'post',
    transform(code, id) {
      if (inProtos(id) || !code.includes('_jsxFileName')) return null
      return { code: code.replace(/(\b_jsxFileName\d*\s*=\s*)(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g, '$1""'), map: null }
    },
  }

  // Vite emits a page's icon as a file of its own whatever its size; the share has room for one
  // file only, so the icon goes into the page.
  const icon = {
    name: 'proto-share-icon',
    transformIndexHtml: {
      order: 'pre',
      handler: html => html.replace(/(<link\b[^>]*\brel="icon"[^>]*\bhref=")\/([^"]+\.svg)"/g, (all, head, file) => {
        const path = join(root, file)
        return existsSync(path) ? `${head}data:image/svg+xml;base64,${readFileSync(path).toString('base64')}"` : all
      }),
    },
  }

  const options = {
    name: 'proto-share-options',
    config: () => ({
      // Nothing from any .env reaches a share: no folder to read them from, and a prefix no
      // variable has.
      envDir: false,
      envPrefix: '__PROTO_NONE__',
      // Vite's Oxc transform (which @vitejs/plugin-react 6 configures instead of running Babel)
      // takes `oxc.jsx.development`, defaulting to !isProduction. On, so the prototype files'
      // tags carry their source for the stamps (stamps.mjs); fileNames above blanks the rest.
      oxc: { jsx: { development: true } },
      define: { __PROTO_SHARE__: JSON.stringify({ ...info, scope }) },
      build: {
        outDir,
        emptyOutDir: true,
        copyPublicDir: false,
        sourcemap: false,
        // Every asset becomes a data URL, so the HTML is the whole share. It is also what inlines
        // a picture as it is when sharp is missing (images.mjs then leaves it to Vite).
        assetsInlineLimit: Number.MAX_SAFE_INTEGER,
        cssCodeSplit: false,
        // One JS chunk: the variants' lazy imports are inlined, so switching needs no request.
        // Rolldown 1.2's `output.codeSplitting: false`; its older `inlineDynamicImports: true`
        // is marked deprecated in favour of it (rolldown/dist/shared/define-config-*.d.mts).
        rolldownOptions: { output: { codeSplitting: false } },
      },
    }),
    // Which files of the owner's project went in (design kit parts, theme): the review names them.
    buildEnd() {
      const projectImports = [...this.getModuleIds()]
        .filter(id => !id.startsWith('\0'))
        .map(bare)
        .filter(id => within(realProject, id) && !within(root, id) && !id.includes('/node_modules/'))
        .map(id => slash(relative(realProject, id)))
      writeFileSync(report, JSON.stringify({ projectImports, warnings: [...warnings, ...imagesPlugin.warnings] }))
    },
  }

  return [swap, fileNames, icon, options, stampsPlugin({ protosDir }), imagesPlugin({ sharp, root })]
}
