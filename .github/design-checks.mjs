// Designs (proto design, add --design): a pick made into a set of linked screens in flows, kept in
// src/designs/<id>/design.ts. CLI only, no install, browser or server.
import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { projectFixture } from './project-checks.mjs'
import { linksIn } from '../app/links.mjs'

const ok = r => assert.equal(r.status, 0, r.stderr + r.stdout)
const plain = text => JSON.parse(text.replace(/^[\s\S]*?export default\s*/, '').replace(/;?\s*$/, ''))
const designOf = (app, id) => plain(readFileSync(join(app, 'src', 'designs', id, 'design.ts'), 'utf8'))
const metaOf = (app, slug) => plain(readFileSync(join(app, 'src', 'protos', slug, 'meta.ts'), 'utf8'))

function withHome(fn) {
  return projectFixture(f => {
    ok(f.call(['up', '--session', 'one', '--no-serve']))
    ok(f.call(['add', 'home', '--variants', 'A:One,B:Two,C:Three', '--session', 'one']))
    return fn({ ...f, run: (...a) => f.call([...a, '--session', 'one']) })
  })
}

test('design makes a design from a variant', () => withHome(({ app, run }) => {
  ok(run('design', 'home/C', '--title', 'Acme'))
  const d = designOf(app, 'acme')
  assert.equal(d.from, 'home/C')
  assert.deepEqual(d.flows, [{ name: 'Main', screens: ['home'] }])
  assert.equal(d.session, 'one')
  assert.equal(metaOf(app, 'home').picked, 'C')
}))

test('a taken id gets -2; a prototype already a screen is pinned in the new design', () => withHome(({ app, run }) => {
  ok(run('design', 'home/C', '--title', 'Acme'))
  ok(run('design', 'home/B', '--title', 'Acme'))
  assert.deepEqual(designOf(app, 'acme-2').flows, [{ name: 'Main', screens: ['home/B'] }])
  assert.equal(metaOf(app, 'home').picked, 'C', 'the first design keeps its pick')
}))

test('add --design appends a screen, --flow makes another flow', () => withHome(({ app, run }) => {
  ok(run('design', 'home/C', '--title', 'Acme'))
  ok(run('add', 'about', '--design', 'acme', '--variants', 'A:One'))
  ok(run('add', 'signup', '--design', 'acme', '--flow', 'Sign up', '--variants', 'A:One'))
  assert.deepEqual(designOf(app, 'acme').flows, [{ name: 'Main', screens: ['home', 'about'] }, { name: 'Sign up', screens: ['signup'] }])
}))

test("a screen of one design can't join another", () => withHome(({ run }) => {
  ok(run('design', 'home/C', '--title', 'Acme'))
  ok(run('design', 'home/B', '--title', 'Other'))
  ok(run('add', 'about', '--design', 'acme', '--variants', 'A:One'))
  const r = run('add', 'about', '--design', 'other', '--variants', 'B:Two')
  assert.notEqual(r.status, 0)
  assert.match(r.stderr + r.stdout, /already a screen of acme/)
}))

test('--design with --next is refused', () => withHome(({ run }) => {
  ok(run('design', 'home/C', '--title', 'Acme'))
  const r = run('add', 'home-redo', '--design', 'acme', '--from', 'home/C', '--next', '--variants', 'A:One')
  assert.notEqual(r.status, 0)
}))

test('status lists picks, stand-ins and links', () => withHome(({ app, run }) => {
  ok(run('design', 'home/C', '--title', 'Acme'))
  ok(run('add', 'about', '--design', 'acme', '--variants', 'A:One'))
  writeFileSync(join(app, 'src', 'protos', 'home', 'C.tsx'), `import { Go } from '../../go'\nexport default function C() { return <nav><Go to="about">About</Go><Go to="pricing">Pricing</Go></nav> }\n`)
  const r = run('design', 'acme')
  ok(r)
  assert.match(r.stdout, /home\s+#3 picked/)
  assert.match(r.stdout, /→ about, pricing/)
  assert.match(r.stdout, /about\s+#1 stands in \(not picked\)/)
  assert.match(r.stdout, /links to screens not built: pricing/)
}))

test('status skips a gone screen', () => withHome(({ run }) => {
  ok(run('design', 'home/C', '--title', 'Acme'))
  ok(run('add', 'about', '--design', 'acme', '--variants', 'A:One'))
  ok(run('archive', 'about'))
  const r = run('design', 'acme')
  ok(r)
  assert.match(r.stdout, /about\s+\(gone\)/)
}))

test('flow edits: move, rename, drop', () => withHome(({ app, run }) => {
  ok(run('design', 'home/C', '--title', 'Acme'))
  ok(run('add', 'about', '--design', 'acme', '--variants', 'A:One'))
  ok(run('design', 'acme', '--flow', 'Checkout', '--screens', 'about'))
  assert.deepEqual(designOf(app, 'acme').flows, [{ name: 'Main', screens: ['home'] }, { name: 'Checkout', screens: ['about'] }])
  ok(run('design', 'acme', '--rename', 'Checkout:Pay'))
  assert.equal(designOf(app, 'acme').flows[1].name, 'Pay')
  ok(run('design', 'acme', '--drop', 'about'))
  assert.deepEqual(designOf(app, 'acme').flows, [{ name: 'Main', screens: ['home'] }])
  assert.ok(existsSync(join(app, 'src', 'protos', 'about', 'meta.ts')), 'the prototype stays')
}))

test('handoff --design plans building the chosen screens, links as navigation, open ones marked', () => withHome(({ app, run }) => {
  ok(run('design', 'home/C', '--title', 'Acme'))
  ok(run('add', 'about', '--design', 'acme', '--variants', 'A:One'))
  ok(run('add', 'pricing', '--design', 'acme', '--variants', 'A:One'))
  writeFileSync(join(app, 'src', 'protos', 'home', 'C.tsx'), `import { Go } from '../../go'\nexport default function C() { return <nav><Go to="about">About</Go></nav> }\n`)
  const all = run('handoff', '--design', 'acme')
  ok(all)
  assert.match(all.stdout, /home\/C\s+#3 picked/)
  assert.match(all.stdout, /proto handoff home\/C/)
  assert.match(all.stdout, /home → about/)
  assert.match(all.stdout, /about\/A\s+#1 stands in \(not picked\)/)
  const some = run('handoff', '--design', 'acme', '--screens', 'home,about')
  ok(some)
  assert.doesNotMatch(some.stdout, /pricing/)
  const bad = run('handoff', '--design', 'acme', '--screens', 'nope')
  assert.notEqual(bad.status, 0)
  assert.match(bad.stderr + bad.stdout, /nope is not a screen of acme/)
}))

test('moving screens between flows keeps a pinned entry pinned and refuses a slug that is no screen here', () => withHome(({ app, run }) => {
  ok(run('design', 'home/C', '--title', 'Acme'))
  ok(run('design', 'home/B', '--title', 'Beta'))
  ok(run('design', 'beta', '--flow', 'Other', '--screens', 'home'))
  assert.deepEqual(designOf(app, 'beta').flows, [{ name: 'Other', screens: ['home/B'] }])
  const bad = run('design', 'acme', '--flow', 'Other', '--screens', 'nope')
  assert.notEqual(bad.status, 0)
  assert.match(bad.stderr + bad.stdout, /nope is not a screen of acme/)
}))

test('linksIn finds Go targets', () => {
  assert.deepEqual(linksIn(`<Go to="a" className="x">A</Go><Go className="x" to='b'>B</Go><Go to="a"/>`), ['a', 'b'])
  assert.deepEqual(linksIn(`<Goal to="x" />`), [])
})

test('SKILL.md points to references/designs.md, which covers the commands, links and shared parts', () => {
  const skill = readFileSync(new URL('../SKILL.md', import.meta.url), 'utf8')
  assert.match(skill, /proto design/); assert.match(skill, /references\/designs\.md/)
  const ref = readFileSync(new URL('../references/designs.md', import.meta.url), 'utf8')
  for (const s of ['proto design', '--design', '<Go to=', 'src/designs/<id>/parts.tsx', 'every screen or only this one']) assert.ok(ref.includes(s), `references/designs.md lacks ${s}`)
})
