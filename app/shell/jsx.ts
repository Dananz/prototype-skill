// The JSX runtime of the session's prototype files (source.mjs points their
// `react/jsx-dev-runtime` here; the shell and the project's files keep React's). It is React's,
// plus where each DOM element is written: `data-proto-src` is its file under src/protos and its line
// (`today/parts.tsx:30`), `data-proto-component` the component it is written in. Names of their own,
// so a design's own `data-src` (a lazy-loaded image) is neither read as a place nor left unstamped. The dev transform
// passes every tag's file and line as jsxDEV's fifth argument, which React itself no longer reads.
// A tag that uses a component (`<Menu …/>`) can't carry an attribute, so its place goes in a
// WeakMap on its props instead: React keeps those props on the component's fiber, and the comment
// layer reads the map going up from the element a comment is on, to say which use of a shared
// component that element belongs to. Kept on the window, so a device view's own copy has its own.
import { Fragment, jsxDEV as devJsxDEV } from 'react/jsx-dev-runtime'
import { jsxDEV as prodJsxDEV } from '../share/jsx-prod'

export { Fragment }

type Source = { fileName?: string; lineNumber?: number; columnNumber?: number; componentName?: string }
// A share is built with production React, which has no jsxDEV; the same call goes to its jsx there.
const reactJsxDEV = (devJsxDEV ?? prodJsxDEV) as (...a: unknown[]) => unknown
const E = Error as ErrorConstructor & { stackTraceLimit?: number }
const names = new Map<string, string>()
const uses: WeakMap<object, string> = ((globalThis as { __protoUses?: WeakMap<object, string> }).__protoUses ??= new WeakMap())
// An edit can rename the function a tag sits in without moving the tag, so each update starts afresh.
if (import.meta.hot) import.meta.hot.on('vite:beforeUpdate', () => names.clear())

/**
 * The component a tag is written in: going out from the tag, the first capitalized function in
 * the same file (a map callback or a lowercase helper can sit between). Read once per tag from the
 * call stack, the way React reads its own dev stacks, and kept, since a tag never moves function.
 * A stack that can't be read leaves the element without a component; its file and line still stand.
 */
function componentOf(file: string, tag: string) {
  let name = names.get(tag)
  if (name !== undefined) return name
  name = ''
  const was = E.stackTraceLimit
  E.stackTraceLimit = 30
  const stack = new Error().stack ?? ''
  E.stackTraceLimit = was
  for (const line of stack.split('\n')) {
    if (!line.includes(file)) continue
    // Chrome: "    at PriceCard (http://…/parts.tsx:3:10)"; Safari and Firefox: "PriceCard@http://…".
    const m = line.match(/^\s*at (?:[\w$]+\.)*([\w$]+) \(/) ?? line.match(/^(?:[\w$]+[./<])*([\w$]+)@/)
    if (m && /^[A-Z]/.test(m[1])) { name = m[1]; break }
  }
  names.set(tag, name)
  return name
}

export function jsxDEV(type: unknown, props: Record<string, unknown>, key: unknown, isStatic: boolean, source?: Source, self?: unknown) {
  const file = source?.fileName?.replaceAll('\\', '/') ?? ''
  const at = file.lastIndexOf('/src/protos/')
  // Only DOM elements: a component would get a prop it doesn't expect.
  if (typeof type === 'string' && at >= 0 && source?.lineNumber && !('data-proto-src' in props)) {
    const src = `${file.slice(at + 12)}:${source.lineNumber}`
    // A share's build can't read the stack (minified names), so it writes the name in at compile time.
    const component = typeof source.componentName === 'string' ? source.componentName : componentOf(file.slice(at), `${src}:${source.columnNumber ?? 0}`)
    props = { ...props, 'data-proto-src': src, ...(component ? { 'data-proto-component': component } : {}) }
  }
  const element = reactJsxDEV(type, props, key, isStatic, source, self) as { props?: object }
  if ((typeof type === 'function' || (typeof type === 'object' && type !== null)) && at >= 0 && source?.lineNumber && element?.props)
    uses.set(element.props, `${file.slice(at + 12)}:${source.lineNumber}`)
  return element
}
