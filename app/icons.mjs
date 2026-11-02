// Dev only: `import { Star } from '@phosphor-icons/react'` in a variant loads the whole package as
// one file (18 MB, and about 9,000 elements built as it runs, which blocks a phone for over a second). This
// points each name at its own small file instead, with the same component. A share's build tree-shakes the
// package and doesn't need it. A name not found (SSR, an import * as) stays on the package and still works.
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const PKG = '@phosphor-icons/react'
const IMPORT = /import\s*\{([^}]*)\}\s*from\s*(['"])@phosphor-icons\/react\2;?/g

/** Which file each public name comes from, read off the package's own index. */
export function iconFiles(indexSource, dist) {
  const files = new Map()
  for (const [, names, file] of indexSource.matchAll(/import\s*\{([^}]*)\}\s*from\s*"\.\/(csr\/[^"]+)"/g)) {
    for (const part of names.split(',')) {
      const name = part.trim().split(/\s+as\s+/)[0]
      if (name) files.set(name, join(dist, file))
    }
  }
  files.set('IconContext', join(dist, 'lib/context.es.js'))
  return files
}

/** The source with each named import split by file; null when nothing changes. */
export function splitImports(code, files) {
  let changed = false
  const next = code.replace(IMPORT, (whole, names) => {
    const byFile = new Map(), rest = []
    for (const raw of names.split(',')) {
      const part = raw.trim()
      if (!part || /^type\s/.test(part)) continue
      const name = part.split(/\s+as\s+/)[0], file = files.get(name)
      if (file) byFile.set(file, [...byFile.get(file) ?? [], part])
      else rest.push(part)
    }
    changed = true
    const lines = [...byFile].map(([file, parts]) => `import { ${parts.join(', ')} } from ${JSON.stringify(file)};`)
    if (rest.length) lines.push(`import { ${rest.join(', ')} } from '${PKG}';`)
    return lines.join(' ')
  })
  return changed ? next : null
}

export function phosphorIcons(appDir) {
  let files = null
  const load = () => {
    if (files) return files
    files = new Map()
    try {
      const index = createRequire(join(appDir, 'package.json')).resolve(PKG).replace(/index\.cjs\.js$/, 'index.es.js')
      if (existsSync(index)) files = iconFiles(readFileSync(index, 'utf8'), dirname(index))
    } catch { /* not installed: nothing to split */ }
    return files
  }
  return {
    name: 'proto-phosphor-icons', apply: 'serve', enforce: 'pre',
    transform(code, id) {
      if (!code.includes(PKG) || id.includes('node_modules') || !id.startsWith(appDir) || !/\.[jt]sx?(\?|$)|\.vue(\?|$)|\.svelte(\?|$)/.test(id)) return null
      const next = splitImports(code, load())
      return next == null ? null : { code: next, map: null }
    },
  }
}

/** The shell's own icons (`import x from '@phosphor-icons/core/assets/…svg?raw'`, one request each) compiled
 *  into the file that imports them. */
export function inlineShellIcons(appDir) {
  const raw = /import\s+(\w+)\s+from\s+'(@phosphor-icons\/core\/assets\/[^'?]+\.svg)\?raw'/g
  const require = createRequire(join(appDir, 'package.json'))
  return {
    name: 'proto-inline-icons', enforce: 'pre',
    transform(code, id) {
      if (!code.includes('@phosphor-icons/core/assets') || !id.startsWith(join(appDir, 'shell'))) return null
      let failed = false
      const next = code.replace(raw, (whole, name, path) => {
        try { return `const ${name} = ${JSON.stringify(readFileSync(require.resolve(path), 'utf8'))}` } catch { failed = true; return whole }
      })
      return failed ? null : { code: next, map: null }
    },
  }
}
