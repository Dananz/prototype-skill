// Merging several theme.css files into the project app's one, so no imported design changes its look.
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { mergeThemes } from '../app/theme-merge.mjs'

// What a variant of a scope sees: the global @theme values, then its scope's block over them.
function resolved(css, scope) {
  const block = re => [...css.matchAll(re)].map(m => m[1]).join(';')
  const decls = body => Object.fromEntries(body.split(';').map(d => d.trim()).filter(d => d.startsWith('--')).map(d => [d.slice(0, d.indexOf(':')).trim(), d.slice(d.indexOf(':') + 1).trim()]))
  const global = decls(block(/@theme(?:\s+inline)?\s*\{([^}]*)\}/g))
  const own = scope ? decls(block(new RegExp(`\\[data-proto-theme="${scope.replace(/[:.]/g, '\\$&')}"\\]\\s*\\{([^}]*)\\}`, 'g'))) : {}
  return { ...global, ...own }
}
const tokensOf = css => Object.fromEntries([...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/(--[\w-]+)\s*:\s*([^;}]+)/g)].map(m => [m[1], m[2].trim()]))
const balanced = css => { let d = 0; for (const c of css.replace(/\/\*[\s\S]*?\*\//g, '')) { d += c === '{' ? 1 : c === '}' ? -1 : 0; if (d < 0) return false } return d === 0 }

test('same token, same value: one global line, no scoped block', () => {
  const { css, conflicts } = mergeThemes('', [{ scope: 's1', css: '@theme { --color-brand: #111; }' }, { scope: 's2', css: '@theme { --color-brand: #111; }' }])
  assert.equal(css.match(/--color-brand/g).length, 1)
  assert.doesNotMatch(css, /data-proto-theme/)
  assert.deepEqual(conflicts, [])
})

test('same token, different values: the first wins globally, the other is scoped', () => {
  const { css, conflicts } = mergeThemes('', [{ scope: 's1', css: '@theme { --color-brand: #111; }' }, { scope: 's2', css: '@theme { --color-brand: #222; }' }])
  assert.equal(resolved(css)['--color-brand'], '#111')
  assert.match(css, /\[data-proto-theme="s2"\]\s*\{\s*--color-brand:\s*#222;\s*\}/)
  assert.deepEqual(conflicts, [{ token: '--color-brand', scopes: ['s1', 's2'] }])
})

test('a token only one scope has is global', () => {
  const { css } = mergeThemes('@theme { --color-a: #000; }', [{ scope: 's2', css: '@theme { --color-brand: #222; }' }])
  assert.equal(resolved(css)['--color-brand'], '#222')
  assert.doesNotMatch(css, /data-proto-theme/)
})

test('an @theme inline token that disagrees stays global and is listed', () => {
  const { css, inline } = mergeThemes('', [{ scope: 's1', css: '@theme inline { --color-x: red; }' }, { scope: 's2', css: '@theme inline { --color-x: blue; }' }])
  assert.equal(resolved(css)['--color-x'], 'red')
  assert.deepEqual(inline, ['--color-x'])
  assert.doesNotMatch(css, /data-proto-theme/)
})

test('@import lines are deduped and hoisted', () => {
  const { css } = mergeThemes('', [{ scope: 's1', css: '.a { color: red; }\n@import "x.css";' }, { scope: 's2', css: '@import "x.css";\n@theme { --c: 1; }' }])
  assert.equal(css.match(/@import "x\.css";/g).length, 1)
  assert.ok(css.indexOf('@import') < css.indexOf('.a'))
})

test('other rules are kept once per distinct text', () => {
  const { css } = mergeThemes('', [{ scope: 's1', css: '.app { --font-sans: X; }' }, { scope: 's2', css: '.app { --font-sans: X; }' }, { scope: 's3', css: '.app { --font-sans: Y; }' }])
  assert.equal(css.match(/--font-sans: X/g).length, 1)
  assert.equal(css.match(/--font-sans: Y/g).length, 1)
})

test('comments, like the example @theme in the template, are not read as tokens', () => {
  const { css } = mergeThemes('/* @theme { --color-brand: #0f5e52; } */', [{ scope: 's1', css: '@theme { --color-brand: #111; }' }])
  assert.equal(resolved(css)['--color-brand'], '#111')
})

test('merging the output again changes nothing', () => {
  const once = mergeThemes('', [{ scope: 's1', css: '@theme { --c: 1; --d: 2; }' }, { scope: 's2', css: '@theme { --c: 3; }\n.x { a: b; }' }]).css
  assert.equal(mergeThemes(once, []).css, once)
})

// Real themes: every session app under PROTO_THEME_FIXTURES (a .prototypes folder), else HeyRan's on
// this Mac, else skipped. Every token of every input resolves to its own value under its scope.
const fixtures = process.env.PROTO_THEME_FIXTURES || join(homedir(), 'Code', 'HeyRan', '.prototypes')
test('real fixtures keep every value under their scope', { skip: !existsSync(fixtures) && 'no fixtures here' }, () => {
  const scopes = readdirSync(fixtures).filter(d => !d.startsWith('_') && existsSync(join(fixtures, d, 'src', 'theme.css')))
    .map(d => ({ scope: d.slice(0, 8), css: readFileSync(join(fixtures, d, 'src', 'theme.css'), 'utf8') }))
  assert.ok(scopes.length > 1)
  const { css, inline } = mergeThemes('', scopes)
  assert.ok(balanced(css))
  for (const s of scopes) {
    const want = tokensOf((s.css.replace(/\/\*[\s\S]*?\*\//g, '').match(/@theme(?:\s+inline)?\s*\{[^}]*\}/g) || []).join('')), got = resolved(css, s.scope)
    for (const [k, v] of Object.entries(want)) if (!inline.includes(k)) assert.equal(got[k], v, `${s.scope} ${k}`)
  }
})

test('a prototype with a theme scope gives its variants that scope, for their mount root', async () => {
  const { stripTypeScriptTypes } = await import('node:module')
  const code = stripTypeScriptTypes(readFileSync(new URL('../app/src/registry-core.ts', import.meta.url), 'utf8'))
  const { protosOf } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
  const load = () => Promise.resolve({})
  const [p] = protosOf({ './protos/home/meta.ts': { title: 'Home', theme: 'two' } }, { './protos/home/A.tsx': load })
  assert.equal(p.variants[0].theme, 'two')
  const [q] = protosOf({ './protos/cart/meta.ts': { title: 'Cart' } }, { './protos/cart/A.tsx': load })
  assert.equal('theme' in q.variants[0], false)
})

test('a scope resolved for a kit has its values in @theme and no scope blocks', async () => {
  const { resolveTheme } = await import('../app/theme-merge.mjs')
  const merged = mergeThemes('', [{ scope: 's1', css: '@theme { --c: #111; --d: 1px; }' }, { scope: 's2', css: '@theme { --c: #222; }' }]).css
  const out = resolveTheme(merged, 's2')
  assert.match(out, /--c: #222;/)
  assert.match(out, /--d: 1px;/)
  assert.doesNotMatch(out, /data-proto-theme/)
  assert.match(resolveTheme(merged, undefined), /--c: #111;/)
})

// Rules other than @theme: the template puts the font on `.app { --font-sans: … }`, shadcn themes
// keep variables in :root and .dark. A later scope's different rule for the same selector is scoped,
// so the first design keeps its look and the later one keeps its own.
test('same selector, different rule: the first stays global, the later is scoped', () => {
  const { css, conflicts } = mergeThemes('', [
    { scope: 's1', css: '.app { --font-sans: "Rubik", "Arial Hebrew"; }\n:root { --radius: 8px; }\n.dark { --bg: #000; }' },
    { scope: 's2', css: '.app { --font-sans: "Inter"; }\n:root { --radius: 4px; }\n.dark { --bg: #111; }\nh1, .app h2 { font-weight: 700; }' },
  ])
  const heads = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/(?:^|\n)([^{}@\n][^{}\n]*?)\s*\{/g)].map(m => m[1].trim())
  assert.equal(heads.filter(h => h === '.app').length, 1, `one global .app rule:\n${css}`)
  assert.match(css, /\.app\s*\{\s*--font-sans:\s*"Rubik", "Arial Hebrew";\s*\}/)
  assert.match(css, /\[data-proto-theme="s2"\] \.app\s*\{\s*--font-sans:\s*"Inter";\s*\}/)
  assert.match(css, /\[data-proto-theme="s2"\]\s*\{\s*--radius:\s*4px;\s*\}/, ':root becomes the scope itself')
  assert.match(css, /\.dark \[data-proto-theme="s2"\]\s*\{\s*--bg:\s*#111;\s*\}/, '.dark (on the page root) scopes its descendants')
  assert.match(css, /(?:^|\n)h1, \.app h2\s*\{/, 'a selector nobody had stays global')
  assert.ok(conflicts.some(c => c.token === '.app' && c.scopes.includes('s2')), JSON.stringify(conflicts))
  assert.ok(balanced(css))
})

test('an at-rule block that differs cannot be scoped: kept and reported', () => {
  const { css, inline } = mergeThemes('', [
    { scope: 's1', css: '@layer base { body { color: red; } }' },
    { scope: 's2', css: '@layer base { body { color: blue; } }' },
  ])
  assert.match(css, /color: red/); assert.match(css, /color: blue/)
  assert.ok(inline.includes('@layer base'), JSON.stringify(inline))
})
