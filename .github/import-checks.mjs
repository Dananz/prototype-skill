// Session apps from before the project app (.prototypes/<session>/) are copied into it on `proto up`,
// renaming slugs that collide and everything that points at them. CLI only, no install or server.
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { projectFixture } from './project-checks.mjs'
import { importSession } from '../scripts/import.mjs'

const ok = r => assert.equal(r.status, 0, r.stderr + r.stdout)
const put = (f, text) => { mkdirSync(join(f, '..'), { recursive: true }); writeFileSync(f, typeof text === 'string' ? text : JSON.stringify(text, null, 2)) }
const meta = m => `// Prototype\nexport default ${JSON.stringify(m, null, 2)}\n`
const metaOf = (app, slug) => JSON.parse(readFileSync(join(app, 'src', 'protos', slug, 'meta.ts'), 'utf8').replace(/^[\s\S]*?export default\s*/, '').replace(/;?\s*$/, ''))
const json = f => JSON.parse(readFileSync(f, 'utf8'))

// A legacy session app: session.json, its prototypes and whatever else a test adds.
function legacy(project, sid, { protos = {}, stack = 'react', extra = {}, theme = '' } = {}) {
  const dir = join(project, '.prototypes', sid)
  put(join(dir, 'session.json'), { id: sid, name: `Session ${sid}`, stack, createdAt: extra.createdAt || '2026-10-01T00:00:00.000Z', ...extra })
  put(join(dir, 'package.json'), { dependencies: { react: '^19.2.0' } })
  if (theme) put(join(dir, 'src', 'theme.css'), theme)
  for (const [slug, m] of Object.entries(protos)) {
    put(join(dir, 'src', 'protos', slug, 'meta.ts'), meta({ title: slug, created: '2026-10-01T00:00:00.000Z', variants: { A: 'Current', B: 'Two', C: 'Three' }, ...m }))
    put(join(dir, 'src', 'protos', slug, 'A.tsx'), `export default function A() { return null }\n`)
  }
  return dir
}

test('calling session first keeps slugs, port and tailnet port', () => projectFixture(({ project, app, call }) => {
  legacy(project, 'one', { protos: { home: {} }, extra: { port: 5190, tailnetPort: 9510, createdAt: '2026-10-05T00:00:00.000Z' } })
  legacy(project, 'two', { protos: { home: {} } })
  const r = call(['up', '--session', 'one', '--no-serve'])
  ok(r)
  const s = json(join(app, 'session.json'))
  assert.equal(s.port, 5190)
  assert.equal(s.tailnetPort, 9510)
  assert.equal(metaOf(app, 'home').session, 'one')
  assert.equal(metaOf(app, 'home-2').session, 'two')
  assert.match(r.stdout, /imported Session two \(1 prototype, renamed home → home-2\)/)
  // The old app no longer claims the ports, so stopping or removing it never turns the link off.
  const old = json(join(project, '.prototypes', 'one', 'session.json'))
  assert.equal(old.port ?? null, null); assert.equal(old.tailnetPort ?? null, null); assert.equal(old.pid ?? null, null)
}))

test('references are rewritten', () => projectFixture(({ project, app, call }) => {
  legacy(project, 'one', { protos: { home: {} } })
  const two = legacy(project, 'two', { protos: { home: {}, child: { from: 'home/B', slots: { cta: { variant: 'B', use: 'home/C' } } } }, extra: { createdAt: '2026-10-02T00:00:00.000Z', asks: { 'home/B': [{ at: 'x', text: 'Bigger' }] } } })
  put(join(two, 'src', 'protos', 'child', 'B.tsx'), `import { Slot } from '../../slot'\nimport { Card } from '../home/parts'\nexport default () => <Slot proto="home" id="cta"><Card /></Slot>\n`)
  ok(call(['up', '--session', 'one', '--no-serve']))
  const m = metaOf(app, 'child')
  assert.equal(m.from, 'home-2/B')
  assert.equal(m.slots.cta.use, 'home-2/C')
  assert.deepEqual(json(join(app, 'session.json')).asks['home-2/B'], [{ at: 'x', text: 'Bigger' }])
  const b = readFileSync(join(app, 'src', 'protos', 'child', 'B.tsx'), 'utf8')
  assert.match(b, /proto="home-2"/)
  assert.match(b, /'\.\.\/home-2\/parts'/)
}))

test('assets: same bytes shared, different bytes renamed with the imports and image() names', () => projectFixture(({ project, app, call }) => {
  const one = legacy(project, 'one', { protos: { home: {} } })
  const two = legacy(project, 'two-session', { protos: { cart: {} }, extra: { createdAt: '2026-10-02T00:00:00.000Z' } })
  put(join(one, 'src', 'assets', 'logo.svg'), '<svg/>')
  put(join(two, 'src', 'assets', 'logo.svg'), '<svg/>')
  put(join(one, 'src', 'assets', 'hero.jpg'), 'one')
  put(join(two, 'src', 'assets', 'hero.jpg'), 'two')
  put(join(two, 'src', 'protos', 'cart', 'A.tsx'), `import hero from '../../assets/hero.jpg'\nimport { image } from '../../images'\nexport default () => <img src={image('hero') ?? hero} />\n`)
  ok(call(['up', '--session', 'one', '--no-serve']))
  assert.equal(readFileSync(join(app, 'src', 'assets', 'logo.svg'), 'utf8'), '<svg/>')
  assert.equal(existsSync(join(app, 'src', 'assets', 'logo--two-sess.svg')), false)
  assert.equal(readFileSync(join(app, 'src', 'assets', 'hero.jpg'), 'utf8'), 'one')
  assert.equal(readFileSync(join(app, 'src', 'assets', 'hero--two-sess.jpg'), 'utf8'), 'two')
  const a = readFileSync(join(app, 'src', 'protos', 'cart', 'A.tsx'), 'utf8')
  assert.match(a, /'\.\.\/\.\.\/assets\/hero--two-sess\.jpg'/)
  assert.match(a, /image\('hero--two-sess'\)/)
}))

test('history, refs, briefs and decisions follow the rename', () => projectFixture(({ project, app, call }) => {
  legacy(project, 'one', { protos: { home: {} } })
  const two = legacy(project, 'two', { protos: { home: {} }, extra: { createdAt: '2026-10-02T00:00:00.000Z' } })
  put(join(two, 'src', 'history', 'home', 'B', '1', 'version.json'), { n: 1, at: 'x', file: 'B.tsx' })
  put(join(two, 'src', 'history', 'home', 'B', '1', 'B.tsx'), `import { Card } from '../../../../protos/home/parts'\n`)
  put(join(two, '.proto', 'ref', 'home', 'shot.png'), 'png')
  put(join(two, '.proto', 'briefs', 'home.json'), { facts: 'x' })
  put(join(two, '.proto', 'decisions', 'home.md'), '# Home')
  ok(call(['up', '--session', 'one', '--no-serve']))
  assert.ok(existsSync(join(app, 'src', 'history', 'home-2', 'B', '1', 'version.json')))
  assert.match(readFileSync(join(app, 'src', 'history', 'home-2', 'B', '1', 'B.tsx'), 'utf8'), /protos\/home-2\/parts/)
  assert.ok(existsSync(join(app, '.proto', 'ref', 'home-2', 'shot.png')))
  assert.ok(existsSync(join(app, '.proto', 'briefs', 'home-2.json')))
  assert.ok(existsSync(join(app, '.proto', 'decisions', 'home-2.md')))
}))

test('the inbox moves with its owner, answered threads included', () => projectFixture(({ project, app, call }) => {
  legacy(project, 'one', { protos: { home: {} } })
  const two = legacy(project, 'two', { protos: { home: {} }, extra: { createdAt: '2026-10-02T00:00:00.000Z' } })
  put(join(two, '.proto', 'inbox', 'new', 'b-new', 'batch.json'), { id: 'b-new', comments: [{ n: 1, route: 'home/A', text: 'Hi' }] })
  put(join(two, '.proto', 'inbox', 'taken', 'b-done', 'batch.json'), { id: 'b-done', comments: [{ n: 1, route: 'home/A', text: 'Old', reply: { text: 'Done' }, done: true }] })
  ok(call(['up', '--session', 'one', '--no-serve']))
  const b = json(join(app, '.proto', 'inbox', 'new', 'b-new', 'batch.json'))
  assert.equal(b.comments[0].route, 'home-2/A')
  assert.equal(b.owner, 'two')
  // The page lists answered threads from taken/: they come along, so nothing it showed goes missing.
  assert.equal(json(join(app, '.proto', 'inbox', 'taken', 'b-done', 'batch.json')).comments[0].route, 'home-2/A')
}))

test("a session's listener config moves with it", () => projectFixture(({ project, app, call }) => {
  legacy(project, 'one', { protos: { home: {} } })
  const two = legacy(project, 'two', { protos: { cart: {} } })
  put(join(two, '.proto', 'inbox', 'listener.json'), { url: 'https://example.test/hook', id: 'task-2', threadId: 'thread-2', session: 'two' })
  put(join(two, '.proto', 'inbox', 'notified.json'), { b1: 'task-2' })
  ok(call(['up', '--session', 'one', '--no-serve']))
  assert.equal(json(join(app, '.proto', 'inbox', 'listeners', 'two.json')).id, 'task-2')
  assert.deepEqual(json(join(app, '.proto', 'inbox', 'listeners', 'two-notified.json')), { b1: 'task-2' })
  assert.equal(existsSync(join(two, '.proto', 'inbox', 'listener.json')), false)
  // No copy of the wake URL stays behind in the old folder, where the dev server could serve it.
  const left = readdirSync(join(two, '.proto', 'inbox'))
  assert.ok(!left.some(f => readFileSync(join(two, '.proto', 'inbox', f), 'utf8').includes('example.test/hook')), `wake URL left in ${left}`)
}))

test('shares keep their session and follow the rename', () => projectFixture(({ project, app, call }) => {
  legacy(project, 'one', { protos: { home: {} } })
  const two = legacy(project, 'two', { protos: { home: {} }, extra: { createdAt: '2026-10-02T00:00:00.000Z' } })
  put(join(two, '.proto', 'shares.json'), [{ id: 'x', host: 'online', scope: { protos: [{ id: 'home', variants: ['A'] }], start: 'home/A' }, version: 1 }])
  ok(call(['up', '--session', 'one', '--no-serve']))
  const [rec] = json(join(app, '.proto', 'shares.json'))
  assert.equal(rec.session, 'two')
  assert.equal(rec.scope.protos[0].id, 'home-2')
  assert.equal(rec.scope.start, 'home-2/A')
}))

test('themes merge, and a session whose tokens disagree gets its scope', () => projectFixture(({ project, app, call }) => {
  legacy(project, 'one', { protos: { home: {} }, theme: '@theme { --color-brand: #111; }' })
  legacy(project, 'two', { protos: { cart: {} }, theme: '@theme { --color-brand: #222; }', extra: { createdAt: '2026-10-02T00:00:00.000Z' } })
  ok(call(['up', '--session', 'one', '--no-serve']))
  const css = readFileSync(join(app, 'src', 'theme.css'), 'utf8')
  assert.match(css, /--color-brand: #111/)
  assert.match(css, /\[data-proto-theme="two"\]/)
  assert.equal(metaOf(app, 'cart').theme, 'two')
  assert.equal(metaOf(app, 'home').theme, undefined)
}))

test("a conversation's new prototypes keep its scope after the import", () => projectFixture(({ project, app, call }) => {
  legacy(project, 'one', { protos: { home: {} }, theme: '@theme { --color-brand: #111; }' })
  legacy(project, 'two', { protos: { cart: {} }, theme: '@theme { --color-brand: #222; }', extra: { createdAt: '2026-10-02T00:00:00.000Z' } })
  ok(call(['up', '--session', 'one', '--no-serve']))
  ok(call(['add', 'checkout', '--variants', 'A:One', '--session', 'two']))
  ok(call(['add', 'about', '--variants', 'A:One', '--session', 'one']))
  assert.equal(metaOf(app, 'checkout').theme, 'two')
  assert.equal(metaOf(app, 'about').theme, undefined)
}))

test('a session whose font rule differs gets its scope too', () => projectFixture(({ project, app, call }) => {
  legacy(project, 'one', { protos: { home: {} }, theme: '.app { --font-sans: "Rubik", "Arial Hebrew"; }' })
  legacy(project, 'two', { protos: { cart: {} }, theme: '.app { --font-sans: "Inter"; }', extra: { createdAt: '2026-10-02T00:00:00.000Z' } })
  ok(call(['up', '--session', 'one', '--no-serve']))
  const css = readFileSync(join(app, 'src', 'theme.css'), 'utf8')
  assert.match(css, /\[data-proto-theme="two"\] \.app/)
  assert.equal(metaOf(app, 'cart').theme, 'two')
  assert.equal(metaOf(app, 'home').theme, undefined)
}))

test('a session on another stack is skipped and left untouched', () => projectFixture(({ project, app, call }) => {
  legacy(project, 'one', { protos: { home: {} } })
  const vue = legacy(project, 'vue1', { protos: { form: {} }, stack: 'vue' })
  const r = call(['up', '--session', 'one', '--no-serve'])
  ok(r)
  assert.match(r.stdout, /skipped Session vue1/)
  assert.equal(existsSync(join(app, 'src', 'protos', 'form')), false)
  assert.equal(json(join(vue, 'session.json')).migratedTo, undefined)
  // Kept, so gc never removes work no command can reach any more.
  assert.equal(json(join(vue, 'session.json')).keep, true)
  assert.match(r.stdout, /kept in .*vue1/)
}))

test('import runs once, and marks each session it took', () => projectFixture(({ project, app, call }) => {
  const one = legacy(project, 'one', { protos: { home: {} } })
  ok(call(['up', '--session', 'one', '--no-serve']))
  const log = json(join(app, '.proto', 'imports.json'))
  ok(call(['up', '--session', 'one', '--no-serve']))
  assert.equal(json(join(app, '.proto', 'imports.json')).length, log.length)
  assert.equal(json(join(one, 'session.json')).migratedTo, '_project')
}))

test('a second import of a session another run already took does nothing', () => projectFixture(({ project, app, call }) => {
  const one = legacy(project, 'one', { protos: { home: {} } })
  const listing = { dir: one, json: json(join(one, 'session.json')) }
  ok(call(['up', '--session', 'one', '--no-serve']))
  importSession(app, listing, { first: false })
  assert.equal(existsSync(join(app, 'src', 'protos', 'home-2')), false)
}))

test('an import cut off before its mark resumes into the same slugs', () => projectFixture(({ project, app, call }) => {
  const one = legacy(project, 'one', { protos: { home: {} } })
  ok(call(['up', '--session', 'one', '--no-serve']))
  const s = json(join(one, 'session.json')); delete s.migratedTo
  put(join(one, 'session.json'), s)
  ok(call(['up', '--session', 'one', '--no-serve']))
  assert.equal(existsSync(join(app, 'src', 'protos', 'home-2')), false)
  assert.equal(json(join(one, 'session.json')).migratedTo, '_project')
}))

test('one unreadable old app is skipped, the rest still come in and up still works', () => projectFixture(({ project, app, call }) => {
  legacy(project, 'one', { protos: { home: {} } })
  const bad = legacy(project, 'bad', { protos: { cart: {} }, extra: { createdAt: '2026-10-02T00:00:00.000Z' } })
  put(join(bad, 'src', 'protos', 'cart', 'meta.ts'), 'export default { title: cart, }\n')
  legacy(project, 'three', { protos: { menu: {} }, extra: { createdAt: '2026-10-03T00:00:00.000Z' } })
  const r = call(['up', '--session', 'one', '--no-serve'])
  ok(r)
  assert.match(r.stdout, /skipped Session bad/)
  assert.ok(existsSync(join(app, 'src', 'protos', 'menu', 'meta.ts')))
}))

test("another conversation is told once, on its next command, what the import renamed", () => projectFixture(({ project, call }) => {
  legacy(project, 'one', { protos: { home: {} } })
  legacy(project, 'two', { protos: { home: {} }, extra: { createdAt: '2026-10-02T00:00:00.000Z' } })
  ok(call(['up', '--session', 'one', '--no-serve']))
  const first = call(['url', '--session', 'two'])
  ok(first)
  assert.match(first.stdout, /renamed home → home-2/)
  const again = call(['url', '--session', 'two'])
  assert.doesNotMatch(again.stdout, /renamed home → home-2/)
  assert.doesNotMatch(call(['url', '--session', 'one']).stdout, /moved into the project app/)
}))
