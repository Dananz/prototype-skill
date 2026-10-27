// The share build's stand-in for React's development JSX runtime, which production React doesn't
// ship (`jsxDEV` is undefined there). The compile step still emits jsxDEV calls for src/protos so
// app/shell/jsx.ts can stamp them; this is what they end up calling. Imports only the production
// runtime: jsx.ts imports this, so anything more would be a cycle.
import { Fragment, jsx, jsxs } from 'react/jsx-runtime'
import type { ReactElement } from 'react'

export { Fragment }

export function jsxDEV(type: unknown, props: Record<string, unknown>, key: unknown, isStatic: boolean): ReactElement {
  return (isStatic ? jsxs : jsx)(type as never, props, key as string | undefined)
}
