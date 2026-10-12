// The design kit: saved from one prototype, it tells when the project's files moved on, and a
// later prototype starts on it (theme, parts, frame, a saved Current with its references).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// A 1x1 PNG, standing in for a screenshot of the real screen.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')

export async function designKit({ proto, app, project, local, fail }) {
  const assert = (ok, why) => { if (!ok) fail(`design kit: ${why}`) }
  const kit = join(project, '.prototypes', '_kits', 'main')
  const template = readFileSync(new URL('../app/src/theme.css', import.meta.url), 'utf8')
  const themeFile = join(app, 'src', 'theme.css')

  assert(proto(['kit']).includes('no design kit in this project yet'), 'a project without one says so')
  proto(['kit', 'save'], { ok: false })

  // The project's own look: a token file the theme imports, a size the parts import through
  // @project, and a component the chrome was measured from (named with --sources).
  mkdirSync(join(project, 'brand'), { recursive: true })
  writeFileSync(join(project, 'brand', 'tokens.css'), ':root { --kit-ink: #0f5e52; }\n')
  writeFileSync(join(project, 'brand', 'sizes.ts'), 'export const BAR = 56\n')
  writeFileSync(join(project, 'brand', 'TabBar.tsx'), 'export const TabBar = () => null\n')

  proto(['add', 'kitbase', '--title', 'Kit base', '--variants', 'A:Current', '--kind', 'phone', '--screen', '402x874'])
  const base = join(app, 'src', 'protos', 'kitbase')
  const theme = `@import '../../../brand/tokens.css';\n@theme { --color-kit-ink: #0f5e52; }\n`
  writeFileSync(themeFile, theme)
  writeFileSync(join(base, 'parts.tsx'), `import { BAR } from '@project/brand/sizes'
export function Bar() { return <nav data-shoot="kit-bar" style={{ height: BAR }} className="bg-kit-ink" /> }
`)
  const current = `import { Bar } from './parts'
export default function A() { return <main className="min-h-full bg-white"><h1>Today</h1><Bar /></main> }
`
  writeFileSync(join(base, 'A.tsx'), current)
  mkdirSync(join(app, '.proto', 'ref', 'kitbase'), { recursive: true })
  writeFileSync(join(app, '.proto', 'ref', 'kitbase', 'today.png'), PNG)

  let out = proto(['kit', 'save', 'kitbase', '--sources', 'brand/TabBar.tsx'])
  assert(out.includes('saved kit main: theme.css, parts.tsx'), `save: ${out}`)
  assert(out.includes('tracking 3 sources: brand/TabBar.tsx, brand/sizes.ts, brand/tokens.css'), 'save tracks what the theme and parts import, and --sources')
  assert(readFileSync(join(kit, 'theme.css'), 'utf8') === theme && existsSync(join(kit, 'parts', 'parts.tsx')), 'the theme and parts are in the kit')
  const doc = readFileSync(join(kit, 'design-system.md'), 'utf8')
  assert(doc.includes('phone, screen 402x874') && doc.includes('parts.tsx: Bar') && doc.includes('`brand/tokens.css`'), 'design-system.md starts from what the files say')
  writeFileSync(join(kit, 'design-system.md'), doc + '\nWritten by the agent.\n')
  proto(['kit', 'save', 'kitbase'])
  assert(readFileSync(join(kit, 'design-system.md'), 'utf8').includes('Written by the agent.'), 'saving again keeps design-system.md')
  proto(['kit', 'save', 'kitbase', '--sources', 'brand/TabBar.tsx'])

  out = proto(['kit', 'screen', 'today', 'kitbase/A', '--sources', 'brand/TabBar.tsx'])
  assert(out.includes('saved Current "today" in kit main: kitbase/A, 1 reference, tracking 1 source'), `screen: ${out}`)
  proto(['kit', 'screen', 'nope', 'kitbase/Z'], { ok: false })

  out = proto(['kit'])
  assert(out.includes('sources: 3 tracked, all unchanged') && out.includes('Current "today"'), `status: ${out}`)
  writeFileSync(join(project, 'brand', 'tokens.css'), ':root { --kit-ink: #123456; }\n')
  out = proto(['kit'])
  assert(out.includes('changed: brand/tokens.css'), 'a changed source shows in the status')
  assert(proto(['up']).includes('kit main: out of date (changed: brand/tokens.css)'), 'proto up names the kit and its drift')

  // A later prototype in a session whose theme is still the template's.
  writeFileSync(themeFile, template)
  proto(['add', 'kitnext', '--title', 'Kit next', '--variants', 'B:Bolder', '--kit=nope'], { ok: false })
  proto(['add', 'kitnext', '--title', 'Kit next', '--variants', 'B:Bolder', '--current', 'nope'], { ok: false })
  out = proto(['add', 'kitnext', '--title', 'Kit next', '--variants', 'B:Bolder', '--current', 'today'])
  assert(out.includes('on kit main: theme.css, parts.tsx') && out.includes('the kit is out of date (changed: brand/tokens.css)'), `add --current: ${out}`)
  assert(out.includes('check it once: proto shoot kitnext/A --ref .proto/ref/kitnext/today.png'), 'add says how to check the saved Current')
  const next = join(app, 'src', 'protos', 'kitnext')
  assert(readFileSync(themeFile, 'utf8') === theme, 'the kit\'s theme replaces the template\'s')
  assert(readFileSync(join(next, 'A.tsx'), 'utf8') === current && existsSync(join(next, 'parts.tsx')), 'A is the saved Current, on the kit\'s parts')
  assert(existsSync(join(app, '.proto', 'ref', 'kitnext', 'today.png')), 'the references come along')
  const meta = JSON.parse(readFileSync(join(next, 'meta.ts'), 'utf8').replace(/^[\s\S]*?export default\s*/, ''))
  assert(meta.kind === 'phone' && meta.screen?.join('x') === '402x874', 'the frame comes from the kit')
  assert(Object.keys(meta.variants).join() === 'A,B', 'the saved Current is A, first')

  // A session with tokens of its own keeps them.
  writeFileSync(themeFile, theme + '/* mine */\n')
  out = proto(['add', 'kitmine', '--variants', 'A:Current', '--kit'])
  assert(out.includes('kept this session\'s own src/theme.css'), 'a session\'s own theme is never overwritten')

  let ok = false
  for (let i = 0; i < 40 && !ok; i++) {
    ok = await fetch(`${local}src/protos/kitnext/A.tsx`).then(r => r.ok).catch(() => false)
    if (!ok) await new Promise(r => setTimeout(r, 250))
  }
  assert(ok, 'the saved Current compiles in the new prototype')

  writeFileSync(themeFile, template)
  proto(['archive', 'kitbase']); proto(['archive', 'kitnext']); proto(['archive', 'kitmine'])
  console.log('OK: design kit save, drift, and a later prototype on it')
}
