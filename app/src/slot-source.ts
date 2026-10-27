// Where slot.ts finds what to plug in: every variant file a slot could draw, and which one stands
// in each slot now. Apart from slot.ts so a share build can swap this module for one with the
// pointers of the moment baked in and only the variants they name (app/share/plugin.mjs): a share
// has no dev server to ask, and the glob here would put every variant of the session in it.
import type { ComponentType } from 'react'

export const loaders = import.meta.glob<{ default: ComponentType<any> }>(['./protos/*/[A-Z].{tsx,jsx}', './protos/*/[A-Z][A-Z].{tsx,jsx}'])

/** `<prototype>/<slot id>` -> `<child>/<letter>`, as the dev server works them out from meta.ts; null when it can't be asked. */
export async function pointers(): Promise<Record<string, string> | null> {
  try { return (await (await fetch('/__proto/status')).json()).slots ?? {} } catch { return null }
}

/** Calls back when a meta.ts changes, which is when a pointer can. */
export const onChange = (f: () => void) => import.meta.hot?.on('proto:edit', (d: { path: string }) => { if (/\/meta\.ts$/.test(d.path)) f() })
