// The Vite plugins of a share build (`vite build --mode share`, run by build.mjs). The session app
// is built as it is, with some of its modules swapped for ones made from the scope: the registry
// holds only the chosen variants, session.json only its name, stack and language, images.ts only
// the pictures those variants name, and slot-source.ts the slot picks of this moment with nothing
// else. Everything the swapped-out globs would have pulled in is then simply not in the bundle.
// The shell itself (shell/shell.ts) is swapped for a stand-in too: a share boots the viewer
// (shell/viewer/), and none of the owner's chrome, or its calls to the session server, goes in.
import { existsSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { dirname, join, relative, sep } from 'node:path'
import { metaOf, slotPointers } from '../server.mjs'
import { trimMeta, trimSession } from './scope.mjs'
import { linksIn } from '../links.mjs'
import { stampsPlugin } from './stamps.mjs'
import { imagesPlugin } from './images.mjs'

const VARIANT_EXTS = ['tsx', 'jsx', 'vue', 'svelte']
const ASSET_EXTS = /\.(png|jpe?g|webp|avif)$/i
const CODE_EXTS = /\.(m?[jt]sx?|vue|svelte)$/
const VIRTUAL = { registry: '\0proto-share:registry', session: '\0proto-share:session', images: '\0proto-share:images', slots: '\0proto-share:slots', shell: '\0proto-share:shell' }

/**
 * sharp from ~/.prototypes/share-tools, where `proto share` installs it (or the folder
 * PROTO_SHARE_TOOLS names, as the smoke does for commands it runs under another HOME); null when
 * it isn't there.
 */
export function loadSharp() {
  const tools = process.env.PROTO_SHARE_TOOLS || join(homedir(), '.prototypes', 'share-tools')
  try { return createRequire(join(tools, 'index.js'))('sharp') } catch { return null }
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

const IMPORT_RE = /(?:\bfrom|\bimport)\s*\(?\s*(['"])(\.{1,2}\/[^'"]+)\1/g
const RESOLVE_EXTS = ['', '.tsx', '.ts', '.jsx', '.js', '.mjs', '.vue', '.svelte', '/index.tsx', '/index.ts', '/index.jsx', '/index.js']
const isFile = f => { try { return statSync(f).isFile() } catch { return false } }

/**
 * The files under dir that entries reach through relative imports (`from './x'`, `import './x.css'`,
 * `import('./x')`), entries included. Imports leaving dir (the shell, src/images) are not followed.
 */
export function reachedFiles(entries, dir) {
  const seen = new Set()
  const visit = file => {
    if (seen.has(file) || !within(dir, file)) return
    seen.add(file)
    if (!CODE_EXTS.test(file)) return
    for (const m of readFileSync(file, 'utf8').matchAll(IMPORT_RE)) {
      const base = join(dirname(file), m[2].split('?')[0])
      const hit = RESOLVE_EXTS.map(x => base + x).find(isFile)
      if (hit) visit(hit)
    }
  }
  entries.forEach(visit)
  return [...seen]
}

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

// What a chat shows for a link copied from the address bar (the short link's page on the host has
// the same): the title, who shared it, the preview image when the host has one, and never in search.
export function shareTags(html, info, lang) {
  const he = lang === 'he'
  const title = info.title || 'Prototype'
  const description = info.owner ? (he ? `אב טיפוס מאת ${info.owner}` : `A prototype shared by ${info.owner}`) : ''
  const tags = [
    '<meta name="robots" content="noindex" />',
    '<meta property="og:type" content="website" />',
    '<meta property="og:site_name" content="Prototype" />',
    `<meta property="og:title" content="${esc(title)}" />`,
    ...description ? [`<meta name="description" content="${esc(description)}" />`, `<meta property="og:description" content="${esc(description)}" />`] : [],
    ...info.card
      ? [`<meta property="og:image" content="${esc(info.card)}" />`, '<meta property="og:image:width" content="1200" />', '<meta property="og:image:height" content="630" />', '<meta name="twitter:card" content="summary_large_image" />']
      : [],
  ]
  return html.replace(/<title>[^<]*<\/title>/, () => [`<title>${esc(title)}</title>`, ...tags].join('\n    '))
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

  // Slots: the variant plugged into each slot that a kept variant holds, right now. The
  // plugged-in variant's code comes along (it is what the shared variant shows); its prototype is
  // not listed. A slot whose holder isn't recorded is kept, since any variant could hold it.
  const kept = new Map(scope.protos.map(p => [p.id, new Set(p.variants)]))
  const holder = (slug, id) => { try { return metaOf(readFileSync(join(protosDir, slug, 'meta.ts'), 'utf8')).slots?.[id]?.variant } catch { return undefined } }
  const slots = Object.fromEntries(Object.entries(slotPointers()).filter(([key]) => {
    const [slug, id] = key.split('/')
    const letter = holder(slug, id)
    return kept.has(slug) && (!letter || kept.get(slug).has(String(letter)))
  }))
  const slotFiles = [...new Set(Object.values(slots))].map(use => variantFile(...use.split('/')))

  // What the share's code is: the kept variant files and the plugged-in ones, and every file
  // under src/protos they reach by relative imports (a lineage helper from an unshared prototype
  // too). Pictures and Tailwind classes are taken from these files only, so an unshared variant
  // beside them adds neither.
  // The designs whose screens are in the share, each screen pinned to the option it shows (the
  // pick stays out, like every meta's), with its <Go to> links: the viewer opens on their map.
  const designsDir = join(root, 'src', 'designs')
  const designs = (existsSync(designsDir) ? readdirSync(designsDir) : []).flatMap(id => {
    let d
    try { d = metaOf(readFileSync(join(designsDir, id, 'design.ts'), 'utf8')) } catch { return [] }
    const links = {}
    const flows = (Array.isArray(d.flows) ? d.flows : []).map(f => ({ name: String(f.name), screens: (Array.isArray(f.screens) ? f.screens : []).flatMap(e => {
      const [slug, pin] = String(e).split('/')
      if (!kept.has(slug)) return []
      let meta = {}
      try { meta = metaOf(readFileSync(join(protosDir, slug, 'meta.ts'), 'utf8')) } catch { return [] }
      const letter = pin || meta.picked || Object.keys(meta.variants || {})[0]
      if (!letter || !kept.get(slug).has(letter)) return []
      try { links[`${slug}/${letter}`] = linksIn(readFileSync(join(protosDir, variantFile(slug, letter)), 'utf8')) } catch { /* no file: no lines */ }
      return [`${slug}/${letter}`]
    }) })).filter(f => f.screens.length)
    return flows.length ? [{ id, title: typeof d.title === 'string' ? d.title : id, created: typeof d.created === 'string' ? d.created : '', flows, links }] : []
  })

  const entries = [...scope.protos.flatMap(p => p.variants.map(v => variantFile(p.id, v))), ...slotFiles].map(f => join(protosDir, f))
  const reached = reachedFiles(entries, protosDir)

  const warnings = []
  const scanned = reached.filter(f => CODE_EXTS.test(f)).map(f => [slash(relative(protosDir, f)), readFileSync(f, 'utf8')])
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
        `export const designs = ${JSON.stringify(designs)}`,
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
    // main.ts calls createShell only outside a share; the module body (its listeners, its
    // fetches, every panel it imports) never runs in one.
    [VIRTUAL.shell]: () => 'export function createShell() { throw new Error(\'a share boots the viewer, not the shell\') }',
  }
  // The modules swapped, by the real file they stand for.
  const swapped = new Map([
    [slash(join(root, 'src', 'registry.ts')), VIRTUAL.registry],
    [slash(join(root, 'session.json')), VIRTUAL.session],
    [slash(join(root, 'src', 'images.ts')), VIRTUAL.images],
    [slash(join(root, 'src', 'slot-source.ts')), VIRTUAL.slots],
    [slash(join(root, 'shell', 'shell.ts')), VIRTUAL.shell],
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
      if (!/(?:^|\/)(?:registry|session\.json|images|slot-source|shell)(?:\.ts)?$/.test(source) || !importer || importer.startsWith('\0')) return null
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

  // Tailwind: shell.css lets it scan all of src/, which would put every class of every variant
  // (arbitrary values carry text: `bg-[url(…)]`, `content-['…']`) in the share's stylesheet. In a
  // share the scan is src/ outside protos, plus the reached files of the share.
  const shellCss = slash(join(root, 'shell', 'shell.css'))
  const sources = [
    ...readdirSync(join(root, 'src')).filter(n => n !== 'protos' && n !== 'assets').map(n => join(root, 'src', n)),
    ...reached,
  ].map(f => `@source ${JSON.stringify(slash(relative(join(root, 'shell'), f)))};`)
  const tailwindSources = {
    name: 'proto-share-tailwind-sources',
    enforce: 'pre',
    transform(code, id) {
      if (bare(id) !== shellCss) return null
      if (!/@source\s+["']\.\.\/src["'];/.test(code)) throw new Error('shell/shell.css no longer has @source "../src"; the share build cannot narrow what Tailwind scans')
      return { code: code.replace(/@source\s+["']\.\.\/src["'];/, () => sources.join('\n')), map: null }
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

  // A share needs JavaScript; without it the page says so, in the session's language.
  const noscript = {
    name: 'proto-share-noscript',
    transformIndexHtml: html => html.replace('<body>', `<body>\n    <noscript>${session.lang === 'he'
      ? '<p dir="rtl" lang="he" style="font:16px/1.5 system-ui,sans-serif;padding:24px">כדי לראות את אב הטיפוס הזה צריך להפעיל JavaScript.</p>'
      : '<p style="font:16px/1.5 system-ui,sans-serif;padding:24px">This prototype needs JavaScript to open. Turn it on and reload.</p>'}</noscript>`),
  }

  const tags = { name: 'proto-share-tags', transformIndexHtml: html => shareTags(html, info, session.lang) }

  return [swap, tailwindSources, fileNames, icon, noscript, tags, options, stampsPlugin({ protosDir }), imagesPlugin({ sharp, root })]
}
