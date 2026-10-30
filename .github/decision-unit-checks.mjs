// Unit checks for the pieces behind History and Decision brief that need no browser:
// app/history.mjs (versions kept before each ask), app/brief.mjs (the brief), and the
// proto CLI around them, on a session folder made by hand in a temp dir.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { filesOf, rewriteImports, snapshot, versionLabel, versionsOf } from '../app/history.mjs'
import { brief, writeBrief } from '../app/brief.mjs'

const skill = dirname(dirname(fileURLToPath(import.meta.url)))

// A session app as `proto up` leaves it, with one prototype of three variants and a shared parts file.
function session() {
  const app = mkdtempSync(join(tmpdir(), 'proto-decisions-'))
  const dir = join(app, 'src', 'protos', 'pricing')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(app, 'session.json'), JSON.stringify({ id: 'unit', name: 'Unit', createdAt: new Date().toISOString(), stack: 'react' }))
  writeFileSync(join(dir, 'meta.ts'), `export default ${JSON.stringify({ title: 'Pricing', ask: 'A pricing page that sells the yearly plan', variants: { A: 'Current', B: 'Big price', C: 'Plan cards' }, about: { B: 'One huge yearly price.', C: 'Three cards side by side.' }, favorites: ['C'] }, null, 2)}\n`)
  writeFileSync(join(dir, 'parts.tsx'), `export const Price = ({ v }: { v: string }) => <b>{v}</b>\n`)
  for (const id of ['A', 'B', 'C']) writeFileSync(join(dir, `${id}.tsx`), `import { Price } from './parts'\nimport { Slot } from '../../slot'\nimport hero from '../../assets/hero.png'\nexport default function ${id}() { return <main><img src={hero} /><Price v="${id}" /></main> }\n`)
  return { app, dir, done: () => rmSync(app, { recursive: true, force: true }) }
}

test('a version keeps the variant and its non-variant files, never the other variants or meta.ts', () => {
  const s = session()
  try {
    assert.deepEqual(filesOf(s.app, 'pricing', 'B'), ['B.tsx', 'parts.tsx'])
    assert.deepEqual(filesOf(s.app, 'pricing', 'Z'), [])
    const kept = snapshot(s.app, 'pricing', 'B', 'make the price bigger')
    assert.deepEqual(kept, { n: 1, created: true })
    const out = join(s.app, 'src', 'history', 'pricing', 'B', '1')
    assert.deepEqual(readdirSync(out).sort(), ['B.tsx', 'parts.tsx', 'version.json'])
    // Kept beside it: ./parts stays; what leaves the copy points back at the originals.
    const copy = readFileSync(join(out, 'B.tsx'), 'utf8')
    assert.match(copy, /from '\.\/parts'/)
    assert.match(copy, /from '\.\.\/\.\.\/\.\.\/\.\.\/slot'/)
    assert.match(copy, /from '\.\.\/\.\.\/\.\.\/\.\.\/assets\/hero\.png'/)
    const v = JSON.parse(readFileSync(join(out, 'version.json'), 'utf8'))
    assert.equal(v.file, 'B.tsx')
    assert.deepEqual(v.before.map(b => b.text), ['make the price bigger'])
  } finally { s.done() }
})

test('nothing changed since the last version: it takes the ask instead of a second copy', () => {
  const s = session()
  try {
    snapshot(s.app, 'pricing', 'B', 'make the price bigger')
    assert.deepEqual(snapshot(s.app, 'pricing', 'B', 'and greener'), { n: 1, created: false })
    assert.deepEqual(versionsOf(s.app, 'pricing', 'B')[0].before.map(b => b.text), ['make the price bigger', 'and greener'])
    // An edit (here to the shared parts file) makes the next ask a new version.
    writeFileSync(join(s.dir, 'parts.tsx'), `export const Price = ({ v }: { v: string }) => <strong>{v}</strong>\n`)
    assert.deepEqual(snapshot(s.app, 'pricing', 'B', 'now a badge'), { n: 2, created: true })
    assert.equal(versionsOf(s.app, 'pricing', 'B').length, 2)
    assert.equal(versionLabel(versionsOf(s.app, 'pricing', 'B')[1]), 'before “now a badge”')
    assert.equal(versionLabel({ note: 'before the rewrite', before: [] }), 'before the rewrite')
    // No half version is ever left behind for the page to find.
    assert.ok(readdirSync(join(s.app, 'src', 'history', 'pricing', 'B')).every(d => /^\d+$/.test(d)))
  } finally { s.done() }
})

test('rewriteImports keeps queries and dynamic imports, and leaves package imports alone', () => {
  const from = '/app/src/protos/p', to = '/app/src/history/p/B/1'
  const out = rewriteImports(`import x from 'react'\nimport css from './a.css?raw'\nconst m = import('./lazy')\nimport './side.css'\nimport y from './parts'`, from, to, new Set(['parts.tsx', 'side.css']))
  assert.match(out, /from 'react'/)
  assert.match(out, /'\.\.\/\.\.\/\.\.\/\.\.\/protos\/p\/a\.css\?raw'/)
  assert.match(out, /import\('\.\.\/\.\.\/\.\.\/\.\.\/protos\/p\/lazy'\)/)
  assert.match(out, /import '\.\/side\.css'/)
  assert.match(out, /from '\.\/parts'/)
})

test('the brief says what was asked, the pick and why, the rest, the changes and the feedback', () => {
  const s = session()
  try {
    // Before a pick it says nothing is picked and lists every direction.
    let b = brief(s.app, 'pricing')
    assert.match(b.markdown, /# Decision brief: Pricing/)
    assert.match(b.markdown, /Nothing is picked yet/)
    assert.match(b.markdown, /#3 · Plan cards ★: Three cards side by side\./)
    assert.equal(brief(s.app, 'nope'), null)

    const meta = join(s.dir, 'meta.ts')
    writeFileSync(meta, readFileSync(meta, 'utf8').replace('"title"', '"picked": "B",\n  "title"'))
    const session = JSON.parse(readFileSync(join(s.app, 'session.json'), 'utf8'))
    session.asks = { 'pricing/B': [{ at: '2026-10-30T09:00:00.000Z', text: 'Picked B' }, { at: '2026-10-30T09:05:00.000Z', text: 'make the price bigger' }] }
    writeFileSync(join(s.app, 'session.json'), JSON.stringify(session))
    snapshot(s.app, 'pricing', 'B', 'make the price bigger')
    const batch = (id, comments, where = 'taken') => { mkdirSync(join(s.app, '.proto', 'inbox', where, id), { recursive: true }); writeFileSync(join(s.app, '.proto', 'inbox', where, id, 'batch.json'), JSON.stringify({ id, at: `2026-10-30T09:0${id.length}:00.000Z`, comments })) }
    batch('b1', [
      { n: 1, route: 'pricing/B', text: 'Picked B: the price reads from across the room', action: 'pick', note: 'the price reads from across the room', done: true, reply: { text: 'Noted', at: 'x' } },
      { n: 2, route: 'pricing/C', text: 'cards feel cramped', done: false },
      { n: 3, route: 'pricing/C', text: 'deleted one', withdrawn: true },
      { n: 4, route: 'other/A', text: 'not this prototype' },
    ])

    b = writeBrief(s.app, 'pricing')
    assert.equal(b.file, join(s.app, '.proto', 'decisions', 'pricing.md'))
    assert.equal(readFileSync(b.file, 'utf8'), b.markdown)
    assert.match(b.markdown, /\*\*Picked: #2 · Big price\*\*/)
    assert.match(b.markdown, /Why, in the user's words: “the price reads from across the room”/)
    assert.match(b.markdown, /## The other directions\n\n- #1 · Current\n- #3 · Plan cards ★/)
    assert.match(b.markdown, /make the price bigger/)
    assert.match(b.markdown, /1 earlier version is kept/)
    assert.match(b.markdown, /- \[x\] On #2 · Big price: “Picked B: the price reads from across the room” → “Noted”/)
    assert.match(b.markdown, /- \[ \] On #3 · Plan cards: “cards feel cramped”/)
    assert.doesNotMatch(b.markdown, /deleted one|not this prototype/)
    assert.match(b.markdown, /proto handoff pricing\/B/)
    assert.match(b.markdown, /Still open: 1 comment/)
    assert.equal(b.open, 1)
  } finally { s.done() }
})

test('proto history and proto brief from the command line', () => {
  const s = session()
  try {
    // The CLI finds a session by --project and --session; this one is made by hand in the index's place.
    const project = mkdtempSync(join(tmpdir(), 'proto-decisions-project-'))
    const app = join(project, '.prototypes', 'unit')
    mkdirSync(dirname(app), { recursive: true })
    spawnSync('cp', ['-R', s.app, app])
    const run = (...a) => spawnSync(process.execPath, [join(skill, 'scripts', 'proto.mjs'), ...a, '--project', project, '--session', 'unit'], { encoding: 'utf8', env: { ...process.env, PROTO_NO_UPDATE: '1', PROTO_NO_GC: '1' } })
    try {
      let r = run('history', 'pricing/2')
      assert.equal(r.status, 0, r.stderr)
      assert.match(r.stdout, /no earlier versions yet/)
      r = run('ask', '--to', 'pricing/2', 'make the price bigger')
      assert.equal(r.status, 0, r.stderr)
      assert.match(r.stdout, /1 earlier version kept/)
      r = run('history', 'pricing/B', '--save', 'before the rewrite')
      assert.match(r.stdout, /nothing changed since version 1/)
      r = run('history', 'pricing/B')
      assert.match(r.stdout, /1\. .*before “make the price bigger”/)
      assert.match(r.stdout, /pricing\/B\/~history/)
      r = run('brief', 'pricing')
      assert.equal(r.status, 0, r.stderr)
      assert.match(r.stdout, /# Decision brief: Pricing/)
      assert.ok(existsSync(join(app, '.proto', 'decisions', 'pricing.md')))
      assert.notEqual(run('brief', 'nope').status, 0)
    } finally { rmSync(project, { recursive: true, force: true }) }
  } finally { s.done() }
})
