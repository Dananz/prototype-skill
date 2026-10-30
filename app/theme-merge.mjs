// One theme.css for the project app out of several (each imported session's, a kit's), so no design
// changes its look: one @theme holds every token name, the first value met wins, and a scope whose
// value differs gets its own block, [data-proto-theme="<scope>"], which the variant's mount root
// carries (meta.theme). Tailwind's utilities read tokens through var(), so the block re-colours them
// there. An `@theme inline` token is written into the utilities themselves, so it can't be scoped: it
// stays global and is listed. Other rules are kept once per distinct text, statements (@import,
// @source, @plugin) once and on top. No CSS parser: a brace-aware scan is enough for these files.

const strip = css => css.replace(/\/\*[\s\S]*?\*\//g, '')

// Top-level pieces: { kind: 'stmt', text } for `@x …;`, { kind: 'theme', inline, body } and
// { kind: 'rule', text } for any other block.
function pieces(css) {
  const out = [], s = strip(css)
  let i = 0
  while (i < s.length) {
    while (i < s.length && /\s/.test(s[i])) i++
    if (i >= s.length) break
    let j = i, depth = 0, open = -1
    for (; j < s.length; j++) {
      const c = s[j]
      if (c === '{') { if (!depth) open = j; depth++ } else if (c === '}') { depth--; if (!depth) { j++; break } } else if (c === ';' && !depth) { j++; break }
    }
    const text = s.slice(i, j).trim()
    if (open < 0) out.push({ kind: 'stmt', text })
    else {
      const head = s.slice(i, open).trim()
      const theme = /^@theme(\s+inline)?$/.exec(head)
      out.push(theme ? { kind: 'theme', inline: !!theme[1], body: s.slice(open + 1, j - 1) } : { kind: 'rule', text })
    }
    i = j
  }
  return out
}

// A theme body's entries, in order: [name, value], where a nested block (@keyframes x { … }) is
// named by its head and valued by its whole text.
function entries(body) {
  const out = []
  for (const p of pieces(body)) {
    if (p.kind === 'stmt') {
      const d = p.text.replace(/;$/, ''), at = d.indexOf(':')
      if (at > 0) out.push([d.slice(0, at).trim(), d.slice(at + 1).trim()])
    } else {
      const text = p.kind === 'theme' ? `@theme { ${p.body} }` : p.text
      out.push([text.slice(0, text.indexOf('{')).trim(), text])
    }
  }
  return out
}

/**
 * @param {string} base the project app's theme.css as it is
 * @param {{ scope: string, css: string }[]} scopes in the order they are merged
 * @returns {{ css: string, conflicts: { token: string, scopes: string[] }[], inline: string[] }}
 */
export function mergeThemes(base, scopes) {
  const stmts = [], rules = [], tokens = new Map(), scoped = new Map(), conflicts = new Map(), inline = new Set()
  const add = (list, text) => { if (!list.includes(text)) list.push(text) }
  for (const { scope, css } of [{ scope: null, css: base }, ...scopes]) {
    for (const p of pieces(css)) {
      if (p.kind === 'stmt') add(stmts, p.text)
      else if (p.kind === 'rule') add(rules, p.text)
      else for (const [name, value] of entries(p.body)) {
        const had = tokens.get(name)
        if (!had) { tokens.set(name, { value, inline: p.inline, from: scope }); continue }
        if (had.value === value) continue
        const who = conflicts.get(name) || [had.from].filter(Boolean)
        if (scope && !who.includes(scope)) who.push(scope)
        conflicts.set(name, who)
        if (p.inline || had.inline || !name.startsWith('--')) { inline.add(name); continue }
        if (!scope) continue
        if (!scoped.has(scope)) scoped.set(scope, [])
        scoped.get(scope).push([name, value])
      }
    }
  }
  const imports = stmts.filter(s => s.startsWith('@import')), others = stmts.filter(s => !s.startsWith('@import'))
  const decl = ([name, value]) => name.startsWith('--') ? `  ${name}: ${value};` : `  ${value}`
  const all = [...tokens].map(([name, t]) => [name, t.value, t.inline])
  const block = (isInline, list) => list.length ? `@theme${isInline ? ' inline' : ''} {\n${list.map(([n, v]) => decl([n, v])).join('\n')}\n}` : ''
  // Scope blocks the base already had are rules: they come back as they were.
  const scopeRules = [...scoped].map(([scope, list]) => `[data-proto-theme="${scope}"] {\n${list.map(decl).join('\n')}\n}`).filter(r => !rules.includes(r))
  const css = [
    '/* The project app\'s look: every merged theme\'s tokens (scripts/import.mjs, app/theme-merge.mjs). */',
    ...imports, ...others,
    block(false, all.filter(t => !t[2])), block(true, all.filter(t => t[2])),
    ...rules, ...scopeRules,
  ].filter(Boolean).join('\n\n') + '\n'
  return {
    css,
    conflicts: [...conflicts].filter(([n]) => !inline.has(n)).map(([token, s]) => ({ token, scopes: s })),
    inline: [...inline],
  }
}

/** The theme as one scope sees it, its block folded into @theme: what a kit saves from a prototype. */
export function resolveTheme(css, scope) {
  const own = pieces(css).find(p => p.kind === 'rule' && p.text.startsWith(`[data-proto-theme="${scope}"]`))
  const over = new Map(own ? entries(own.text.slice(own.text.indexOf('{') + 1, own.text.lastIndexOf('}'))) : [])
  const kept = pieces(css).map(p => p.kind === 'stmt' ? p.text : p.kind === 'rule' ? (p.text.startsWith('[data-proto-theme=') ? '' : p.text)
    : `@theme${p.inline ? ' inline' : ''} {\n${entries(p.body).map(([n, v]) => n.startsWith('--') ? `  ${n}: ${over.get(n) ?? v};` : `  ${v}`).join('\n')}\n}`)
  return kept.filter(Boolean).join('\n\n') + '\n'
}
