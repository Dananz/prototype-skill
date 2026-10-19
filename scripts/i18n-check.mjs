#!/usr/bin/env node
// Checks the page's translations: every literal the shell passes to t() or tn() has an entry in
// each language's dictionary (app/shell/i18n/<lang>/), and no entry is left that nothing asks for.
// Usage: node scripts/i18n-check.mjs [--unused]
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const SHELL = join(dirname(dirname(fileURLToPath(import.meta.url))), 'app', 'shell')
const walk = dir => readdirSync(dir).flatMap(f => { const p = join(dir, f); return statSync(p).isDirectory() ? walk(p) : [p] })
const files = walk(SHELL).filter(f => /\.(ts|tsx)$/.test(f))
const code = files.filter(f => !f.includes(`${SHELL}/i18n/`) && f !== join(SHELL, 'i18n.ts'))

// A string literal in any of JS's three quotes (a template literal only without ${}).
const STR = String.raw`'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|\`(?:[^\`\\$]|\\.)*\``
const unquote = s => s[0] === '`' ? s.slice(1, -1).replace(/\\`/g, '`').replace(/\\\\/g, '\\') : JSON.parse(s[0] === "'" ? `"${s.slice(1, -1).replace(/\\'/g, "'").replace(/"/g, '\\"')}"` : s)
const used = new Map()
for (const f of code) {
  const src = readFileSync(f, 'utf8')
  for (const m of src.matchAll(new RegExp(String.raw`\bt\(\s*(${STR})`, 'g'))) used.set(unquote(m[1]), f)
  for (const m of src.matchAll(new RegExp(String.raw`\btn\(\s*[^,]+,\s*(${STR})\s*,\s*(${STR})`, 'g'))) { used.set(unquote(m[1]), f); used.set(unquote(m[2]), f) }
}

let bad = 0
for (const lang of readdirSync(join(SHELL, 'i18n')).filter(d => statSync(join(SHELL, 'i18n', d)).isDirectory())) {
  const dict = new Map()
  for (const f of walk(join(SHELL, 'i18n', lang)).filter(f => f.endsWith('.ts') && !f.endsWith('index.ts'))) {
    const src = readFileSync(f, 'utf8')
    for (const m of src.matchAll(new RegExp(String.raw`^\s*(${STR})\s*:\s*(${STR})\s*,?\s*$`, 'gm'))) {
      const k = unquote(m[1])
      if (dict.has(k)) { console.log(`${lang}: twice: ${JSON.stringify(k)} (${f.slice(SHELL.length + 1)})`); bad++ }
      dict.set(k, unquote(m[2]))
    }
  }
  for (const [k, f] of used) if (!dict.has(k)) { console.log(`${lang}: missing ${JSON.stringify(k)}  (${f.slice(SHELL.length + 1)})`); bad++ }
  for (const [k, v] of dict) {
    const want = [...k.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(), got = [...v.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join()
    if (want !== got) { console.log(`${lang}: placeholders differ: ${JSON.stringify(k)} -> ${JSON.stringify(v)}`); bad++ }
  }
  if (process.argv.includes('--unused')) for (const k of dict.keys()) if (!used.has(k)) console.log(`${lang}: unused ${JSON.stringify(k)}`)
  console.log(`${lang}: ${dict.size} entries, ${used.size} strings used`)
}
process.exit(bad ? 1 : 0)
