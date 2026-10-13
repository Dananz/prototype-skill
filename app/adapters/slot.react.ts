// A part of a variant that another prototype can stand in for. Wrap the element in <Slot
// proto="<this prototype>" id="<id>" …props>, its original markup as children. While the page has
// a variant plugged in (its pick, see proto add --slot), that variant is drawn here with the
// slot's props; otherwise, or when it fails, the children are.
import { Component, Fragment, Suspense, createElement as h, lazy, useSyncExternalStore, type ComponentType, type ReactNode } from 'react'

const loaders = import.meta.glob<{ default: ComponentType<any> }>(['./protos/*/[A-Z].{tsx,jsx}', './protos/*/[A-Z][A-Z].{tsx,jsx}'])

let pointers: Record<string, string> = {}
const listeners = new Set<() => void>()
const read = async () => {
  try { pointers = (await (await fetch('/__proto/status')).json()).slots ?? {} } catch { /* the originals show */ }
  listeners.forEach(f => f())
}
// Top level await: a variant that imports this never paints the original and then swaps.
await read()
import.meta.hot?.on('proto:edit', (d: { path: string }) => { if (/\/meta\.ts$/.test(d.path)) void read() })

const subscribe = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f) } }
const parts = new Map<string, ComponentType<any>>()
function partOf(use: string) {
  const [proto, letter] = use.split('/')
  const key = Object.keys(loaders).find(k => k.startsWith(`./protos/${proto}/${letter}.`))
  if (!key) return null
  if (!parts.has(key)) parts.set(key, lazy(loaders[key]))
  return parts.get(key)!
}

class Guard extends Component<{ original: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? this.props.original : this.props.children }
}

export function Slot({ proto, id, children, ...props }: { proto: string; id: string; children?: ReactNode; [prop: string]: unknown }) {
  const use = useSyncExternalStore(subscribe, () => pointers[`${proto}/${id}`] ?? '')
  const Part = use ? partOf(use) : null
  if (!Part) return h(Fragment, null, children)
  return h(Guard, { key: use, original: children }, h(Suspense, { fallback: children }, h(Part, props)))
}
