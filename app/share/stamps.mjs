// Compile-time version of what app/shell/jsx.ts does in the dev server. A share is a production
// build, where the minifier has renamed every function (the call stack can't say which component a
// tag is in) and the JSX transform would put the owner's disk path in every tag. So the build runs
// the JSX transform in development mode for src/protos, and this plugin, after it, rewrites each
// source object `{ fileName, lineNumber, columnNumber }` to the path the dev server shows
// (`/src/protos/pricing/parts.tsx`) and adds `componentName`, which jsx.ts then uses as is.
// The tree comes from this.parse, Rolldown's own parser, which Vite 8 hands every plugin.
import { relative, sep } from 'node:path'

const capitalized = name => /^[A-Z]/.test(name ?? '')

/**
 * The name a function goes by: its own, or the variable it is assigned to, looking through
 * `memo(…)` / `forwardRef(…)` wrappers that sit between the function and the variable.
 */
function nameOf(node, parents) {
  if (node.id) return node.id.name
  let i = parents.length - 1
  while (parents[i]?.type === 'CallExpression') i--
  const holder = parents[i]
  return holder?.type === 'VariableDeclarator' && holder.id.type === 'Identifier' ? holder.id.name : undefined
}

const isFunction = node => node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression'

/**
 * `code` (the JSX transform's output) with every tag's source object rewritten: fileName becomes
 * `/src/protos/<rel>`, and componentName the nearest enclosing function with a capitalized name
 * (a map callback or a lowercase helper can sit between), left out when there is none. `ast` is
 * the parsed `code`. A pure function so the unit checks can run it on a string.
 */
export function stampSource(code, ast, rel) {
  const file = JSON.stringify(`/src/protos/${rel}`)
  const edits = []
  const functions = []
  const parents = []
  const visit = node => {
    if (node.type === 'VariableDeclarator' && /^_jsxFileName\d*$/.test(node.id.name) && node.init?.type === 'Literal') edits.push([node.init.start, node.init.end, file])
    const fn = isFunction(node)
    if (fn) functions.push(nameOf(node, parents))
    // jsxDEV(type, props, key, isStatic, source, self): the source is the fifth argument.
    const source = node.type === 'CallExpression' && /jsxDEV/.test(node.callee.name ?? '') ? node.arguments[4] : null
    if (source?.type === 'ObjectExpression') {
      const prop = source.properties.find(p => p.key?.name === 'fileName')
      if (prop) {
        const component = functions.findLast(capitalized)
        edits.push([prop.value.start, prop.value.end, file])
        if (component) edits.push([prop.end, prop.end, `, componentName: ${JSON.stringify(component)}`])
      }
    }
    parents.push(node)
    for (const key in node) {
      const child = node[key]
      if (Array.isArray(child)) for (const c of child) { if (c && typeof c.type === 'string') visit(c) }
      else if (child && typeof child.type === 'string') visit(child)
    }
    parents.pop()
    if (fn) functions.pop()
  }
  visit(ast)
  // From the end, so earlier offsets stay true.
  for (const [start, end, text] of edits.sort((a, b) => b[0] - a[0] || b[1] - a[1])) code = code.slice(0, start) + text + code.slice(end)
  return code
}

/** Runs after the JSX transform (`enforce: 'post'`), on the files under protosDir only. */
export function stampsPlugin({ protosDir }) {
  return {
    name: 'proto-share-stamps',
    enforce: 'post',
    transform(code, id) {
      const path = id.split('?')[0]
      const rel = relative(protosDir, path)
      if (!rel || rel.startsWith('..') || rel.startsWith(sep) || /^[a-z]:/i.test(rel) || !code.includes('jsxDEV')) return null
      return { code: stampSource(code, this.parse(code), rel.split(sep).join('/')), map: null }
    },
  }
}
