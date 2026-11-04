// Forking a share, without a browser or a build: the source block in and out of a page, what it refuses
// (a page is someone else's), landing it in an app, and an offer back against the host in memory.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import worker from '../host/worker.mjs'
import { client } from '../app/share/owner.mjs'
import { review } from '../app/share/review.mjs'
import { ShareError } from '../app/share/scope.mjs'
import { buildSource, checkSource, picturesIn, readSource, sourceFiles, sourceTag } from '../app/share/source.mjs'
import { changedForOwner, changedSinceFork, comingHome, landFork, linkTarget, missingPackages, readForks } from '../scripts/fork.mjs'
import { TOKEN, memoryEnv } from './share-memory-env.mjs'

const metaOf = text => JSON.parse(text.replace(/^[\s\S]*?export default\s*/, '').replace(/;?\s*$/, ''))
const metaFile = meta => `// Prototype\nexport default ${JSON.stringify(meta, null, 2)}\n`
const dataUrl = (bytes, mime) => `data:${mime};base64,${bytes.toString('base64')}`

function app(files = {}) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'proto-fork-')))
  const put = (rel, text) => { mkdirSync(join(dir, rel, '..'), { recursive: true }); writeFileSync(join(dir, rel), text) }
  put('session.json', JSON.stringify({ id: 'app', stack: 'react', project: dir }))
  put('package.json', JSON.stringify({ dependencies: { react: '^19.0.0' } }))
  put('src/theme.css', '@theme { --color-brand: red; }\n')
  mkdirSync(join(dir, 'src', 'protos'), { recursive: true })
  for (const [rel, text] of Object.entries(files)) put(rel, text)
  return dir
}

const SHARER = {
  'src/protos/pricing/meta.ts': metaFile({ title: 'Pricing', ask: 'SECRET ASK', kind: 'web', picks: ['A'], variants: { A: 'Calm', B: 'Bold', C: 'Unshared' } }),
  'src/protos/pricing/A.tsx': "import { Card } from './parts'\nimport { hint } from '../helpers/hint'\nimport { motion } from 'motion/react'\nimport { image } from '../../images'\nimport bg from '../../assets/bg.png'\nexport default () => <Card src={image('hero')} bg={bg} a={hint} m={motion} />\n",
  'src/protos/pricing/B.tsx': "import { Card } from './parts'\nimport { Go } from '../../go'\nexport default () => <Go to=\"pricing\"><Card /></Go>\n",
  'src/protos/pricing/C.tsx': 'export default () => <p>never shared</p>\n',
  'src/protos/pricing/parts.tsx': 'export const Card = () => <div />\n',
  'src/protos/helpers/hint.ts': 'export const hint = 1\n',
  'src/protos/helpers/other.ts': 'export const unreached = 1\n',
  'src/images.ts': 'export const image = n => n\n',
  'src/go.tsx': 'export const Go = () => null\n',
  'src/assets/hero.png': 'HERO',
  'src/assets/bg.png': 'BACKGROUND',
}
const SCOPE = { protos: [{ id: 'pricing', variants: ['A', 'B'] }], start: 'pricing/A' }

function sharedSource(extra = {}) {
  const dir = app({ ...SHARER, 'package.json': JSON.stringify({ dependencies: { react: '^19.0.0', motion: '^12.1.0' } }) })
  const hero = join(dir, 'src/assets/hero.png')
  const heroUrl = 'data:image/webp;base64,V0VCUA=='
  const block = buildSource({ root: dir, session: { stack: 'react', lang: 'en' }, scope: SCOPE, info: { title: 'Pricing', owner: 'dana', version: 3 }, metaOf, entries: ['A', 'B'].map(l => join(dir, `src/protos/pricing/${l}.tsx`)), assets: [hero], made: new Map([[hero, heroUrl]]), ...extra })
  const bgUrl = dataUrl(Buffer.from('BACKGROUND'), 'image/png')
  return { dir, block, html: `<html><script>const a="${heroUrl}",b="${bgUrl}"</script>${sourceTag(block)}</html>` }
}

test('the source holds what the shared variants reach and nothing of the owner', () => {
  const { block } = sharedSource()
  assert.deepEqual(Object.keys(block.files).sort(), ['protos/helpers/hint.ts', 'protos/pricing/A.tsx', 'protos/pricing/B.tsx', 'protos/pricing/parts.tsx'])
  assert.deepEqual(Object.keys(block.protos[0].meta.variants), ['A', 'B'], 'an unshared variant stays out')
  assert.equal(block.protos[0].meta.ask, undefined)
  assert.equal(block.protos[0].meta.picks, undefined)
  assert.deepEqual(block.packages, { motion: '^12.1.0' })
  assert.deepEqual(block.assets.map(a => a.path).sort(), ['assets/bg.png', 'assets/hero.png'])
})

test('a project import is named, and never followed', () => {
  const dir = app({ 'src/protos/x/A.tsx': "import y from '@project/src/secret'\nexport default y\n" })
  const r = sourceFiles([join(dir, 'src/protos/x/A.tsx')], join(dir, 'src'))
  assert.deepEqual(r.projectImports, ['@project/src/secret'])
  assert.equal(r.packages.length, 0)
})

test('a picture named only by a stylesheet\'s url() travels too', () => {
  const dir = app({ 'src/protos/x/A.tsx': "import './a.css'\nexport default () => null\n", 'src/protos/x/a.css': '.a { background: url("./tile.png") }\n.b { background: url(./gone.png) }\n', 'src/protos/x/tile.png': 'T' })
  const r = sourceFiles([join(dir, 'src/protos/x/A.tsx')], join(dir, 'src'))
  assert.deepEqual(r.pictures.map(f => f.split('/').pop()), ['tile.png'])
  assert.deepEqual(r.text.map(f => f.split('/').pop()).sort(), ['A.tsx', 'a.css'])
})

test('the block survives its page: tag text in code stays code', () => {
  const block = { v: 1, stack: 'react', protos: [], files: { 'protos/x/A.tsx': 'const s = "</script><img src=x>\u2028"' } }
  const html = `<body>${sourceTag(block)}</body>`
  assert.equal(html.match(/<\/script>/g).length, 1, 'the block can\'t end its own tag early')
  assert.equal(readSource(html).files['protos/x/A.tsx'], block.files['protos/x/A.tsx'])
  assert.equal(readSource('<body></body>'), null)
  assert.throws(() => readSource('<script id="proto-source">{oops</script>'), ShareError)
})

test('the review reads the block: a secret in a comment blocks the share', () => {
  const secret = 'ghp_' + 'a'.repeat(36)
  const html = sourceTag({ v: 1, files: { 'protos/x/A.tsx': `// token ${secret}` } })
  assert.ok(review({ html, gzBytes: 1, projectPath: '/nope', home: '/nowhere', projectImports: [], currents: [] }).block.some(b => b.code === 'secret'))
})

test('the review says a forkable share of project code can be read', () => {
  const args = { html: '', gzBytes: 1, projectPath: '/nope', home: '/nowhere', projectImports: ['a.ts'], currents: [] }
  assert.ok(review({ ...args, forkable: true }).warn.some(w => w.code === 'forkable'))
  assert.ok(!review({ ...args, forkable: false }).warn.some(w => w.code === 'forkable'))
  assert.ok(!review({ ...args, projectImports: [], forkable: true }).warn.some(w => w.code === 'forkable'), 'a plain prototype needs no extra yes')
})

test('checkSource refuses what a fork must not write', () => {
  const good = () => ({ v: 1, stack: 'react', protos: [{ id: 'x', meta: { variants: { A: 'a' } } }], files: { 'protos/x/A.tsx': 'x' } })
  assert.equal(checkSource(good()).protos[0].id, 'x')
  const bad = (name, change) => assert.throws(() => { const s = good(); change(s); checkSource(s) }, ShareError, name)
  bad('a path out', s => { s.files['protos/x/../../../../evil.js'] = '' })
  bad('an absolute path', s => { s.files['/etc/passwd'] = '' })
  bad('outside protos and designs', s => { s.files['shell/shell.ts'] = '' })
  bad('the app\'s config', s => { s.files['protos/x/../../vite.config.mjs'] = '' })
  bad('a package.json of its own, deep', s => { s.files['protos/x/run.sh'] = '' })
  bad('a meta of its own', s => { s.files['protos/x/meta.ts'] = '' })
  bad('a slug with a dot', s => { s.protos[0].id = '../x' })
  bad('a variant without a file', s => { s.protos[0].meta.variants.B = 'b' })
  bad('a git package', s => { s.packages = { evil: 'git+https://example.com/evil.git' } })
  bad('a file package', s => { s.packages = { evil: 'file:../../evil' } })
  bad('a newer source', s => { s.v = 99 })
  bad('a picture out', s => { s.assets = [{ path: 'assets/../../evil.png', hashes: [] }] })
  bad('an svg', s => { s.assets = [{ path: 'assets/evil.svg', hashes: [] }] })
  const clean = checkSource({ ...good(), packages: { '@scope/ok': '~1.2.3', ok: '^4' } })
  assert.deepEqual(clean.packages, { '@scope/ok': '~1.2.3', ok: '^4' })
})

test('a picture comes out of the page by its hash, the converted form first', () => {
  const { block, html } = sharedSource()
  const { found, missing } = picturesIn(html, block.assets)
  assert.equal(found.get('assets/hero.png').ext, '.webp')
  assert.equal(found.get('assets/hero.png').bytes.toString(), 'WEBP')
  assert.equal(found.get('assets/bg.png').bytes.toString(), 'BACKGROUND', 'a CSS background stays as its own bytes')
  assert.equal(missing.length, 0)
  assert.deepEqual(picturesIn('<html></html>', block.assets).missing.length, 2)
})

test('only links on a known host are links', () => {
  const hosts = [{ name: 'online', stage: 'domain', base: 'prtype.dev', url: 'https://prtype.dev' }, { name: 'local', stage: 'local', url: 'http://localhost:8787', base: 'localhost:8787' }]
  const id = 'k3x9p2m4q7'
  for (const url of [`https://prtype.dev/${id}`, `https://prtype.dev/s/${id}/`, `https://${id}.prtype.dev/`, `https://${id}.prtype.dev/?v=2#/a/B`]) assert.equal(linkTarget(url, hosts)?.host.name, 'online', url)
  for (const url of [`http://${id}.localhost:8787/`, `http://127.0.0.1:8787/s/${id}/`]) assert.equal(linkTarget(url, hosts)?.host.name, 'local', url)
  for (const url of [`https://evil.example/${id}`, `https://${id}.evil.example/`, `https://prtype.dev.evil.example/${id}`, `http://prtype.dev/${id}`, 'https://prtype.dev/too-short', 'not a link']) assert.equal(linkTarget(url, hosts), null, url)
})

test('a fork lands beside what is here: slugs, code, metas, pictures, base', () => {
  const { block, html } = sharedSource()
  const here = app({ 'src/protos/pricing/meta.ts': metaFile({ title: 'Mine', variants: { A: 'x' } }), 'src/protos/pricing/A.tsx': 'mine', 'src/assets/bg.webp': 'different' })
  const source = checkSource(JSON.parse(JSON.stringify(block)))
  assert.deepEqual(missingPackages(here, source).map(([n]) => n), ['motion'])
  const { found } = picturesIn(html, source.assets)
  const origin = { host: 'online', share: 'k3x9p2m4q7', version: 3, owner: 'dana', title: 'Pricing' }
  const { entry, renames } = landFork(here, source, { sid: 'me', origin, pictures: found, key: 'k3x9p2m4q7', by: 'dana' })
  assert.equal(renames.pricing, 'pricing-2')
  assert.equal(readFileSync(join(here, 'src/protos/pricing/A.tsx'), 'utf8'), 'mine', 'what was here stays')
  const a = readFileSync(join(here, 'src/protos/pricing-2/A.tsx'), 'utf8')
  assert.match(readFileSync(join(here, 'src/protos/pricing-2/B.tsx'), 'utf8'), /to="pricing-2"/)
  assert.match(a, /\.\.\/helpers\/hint/, 'a borrowed helper keeps its free name')
  assert.ok(existsSync(join(here, 'src/protos/helpers/hint.ts')))
  assert.ok(!existsSync(join(here, 'src/protos/helpers/meta.ts')), 'a borrowed helper is no prototype')
  const meta = metaOf(readFileSync(join(here, 'src/protos/pricing-2/meta.ts'), 'utf8'))
  assert.deepEqual(Object.keys(meta.variants), ['A', 'B'])
  assert.equal(meta.session, 'me')
  assert.equal(meta.ask, '')
  assert.deepEqual(meta.forkedFrom, { ...origin, proto: 'pricing' })
  assert.equal(readFileSync(join(here, 'src/assets/hero.webp'), 'utf8'), 'WEBP')
  assert.equal(readFileSync(join(here, 'src/assets/bg.png'), 'utf8'), 'BACKGROUND')
  assert.equal(readForks(here)[0].key, entry.key)
  assert.deepEqual(changedSinceFork(here, entry), [])
  writeFileSync(join(here, 'src/protos/pricing-2/A.tsx'), a + '// mine now\n')
  writeFileSync(join(here, 'src/protos/pricing-2/D.tsx'), 'export default () => null\n')
  writeFileSync(join(here, 'src/protos/pricing-2/parts.tsx'), 'export const Card = () => <b />\n')
  assert.deepEqual(changedSinceFork(here, entry), ['pricing-2/A', 'pricing-2/D (new)', 'pricing-2 shared parts'])
  assert.deepEqual(changedForOwner(entry, changedSinceFork(here, entry)), ['#1', '#4 (new)', 'shared parts'], 'the owner reads their own numbers, not a slug from here')
  assert.equal(meta.title, 'Pricing (@dana)', 'beside one of the same name it says whose it is')
  // A second fork of the same link lands beside the first.
  const again = landFork(here, source, { sid: 'me', origin, pictures: found, key: 'k3x9p2m4q7', by: 'dana' })
  assert.equal(again.entry.protos[0].slug, 'pricing-3')
  assert.notEqual(again.entry.key, entry.key)
})

test('a picture with the same name and other bytes keeps both, and the code follows', () => {
  const here = app({ 'src/assets/hero.webp': 'MINE' })
  const { block, html } = sharedSource()
  const source = checkSource(JSON.parse(JSON.stringify(block)))
  const { found } = picturesIn(html, source.assets)
  landFork(here, source, { sid: 'me', origin: { owner: 'dana', title: 't', version: 1 }, pictures: found, key: 'abc', by: 'dana' })
  assert.equal(readFileSync(join(here, 'src/assets/hero.webp'), 'utf8'), 'MINE')
  assert.equal(readFileSync(join(here, 'src/assets/hero--abc.webp'), 'utf8'), 'WEBP')
  assert.match(readFileSync(join(here, 'src/protos/pricing/A.tsx'), 'utf8'), /image\('hero--abc'\)/)
})

test('a fork of your own link comes home, nested under the original', () => {
  const home = app({
    '.proto/shares.json': JSON.stringify([{ id: 'k3x9p2m4q7', host: 'online', title: 'Pricing', scope: SCOPE, version: 3 }]),
    'src/protos/pricing/meta.ts': metaFile({ title: 'Pricing', variants: { A: 'Calm', B: 'Bold' } }),
    'src/protos/pricing/A.tsx': 'mine',
  })
  const { block } = sharedSource()
  const raw = JSON.parse(JSON.stringify(block))
  raw.protos[0].meta.forkedFrom = { host: 'online', share: 'k3x9p2m4q7', version: 3, owner: 'dana', title: 'Pricing', proto: 'pricing' }
  const source = checkSource(raw)
  assert.deepEqual(comingHome(home, source), { parent: 'pricing', letter: 'A' })
  const { entry } = landFork(home, source, { sid: 'me', origin: { host: 'online', share: 'n3wf0rk4bc', version: 1, owner: 'friend', title: 'Pricing' }, key: 'n3wf0rk4bc', by: 'friend' })
  assert.equal(entry.protos[0].slug, 'pricing-from-friend')
  const meta = metaOf(readFileSync(join(home, 'src/protos/pricing-from-friend/meta.ts'), 'utf8'))
  assert.equal(meta.from, 'pricing/A')
  assert.equal(meta.referenceOnly, true)
  assert.match(meta.title, /@friend/)
  assert.equal(comingHome(app(), source), null, 'someone else\'s fork is a plain fork')
})

// ---------- offers against the host ----------

const workerFetch = env => (url, init) => worker.fetch(new Request(url, init), env)
const domain = { name: 'online', url: 'https://prtype.dev', stage: 'domain', base: 'prtype.dev', pathMode: true }
const hex = s => createHash('sha256').update(s).digest('hex')

async function twoUsers() {
  const env = await memoryEnv()
  env.DB.sql.prepare("INSERT INTO owners (id, name, created_at, gh_login, gh_id) VALUES ('o2', 'Friend', 1, 'friend', 2)").run()
  env.DB.sql.prepare("INSERT INTO owner_tokens (sha256, owner_id, device, created_at) VALUES (?, 'o2', 'test', 1)").run(hex('friend-token'))
  const fetch = workerFetch(env)
  const meta = title => ({ title, session: 's', projectLabel: 'p', scope: { protos: [{ id: 'a', variants: ['A'] }], start: 'a/A' }, lang: 'en' })
  const mine = client(domain, TOKEN, { fetch }), theirs = client(domain, 'friend-token', { fetch })
  const origin = await mine.create()
  await mine.put(origin, gzipSync('<!doctype html><p>original'), meta('Original'))
  const fork = await theirs.create()
  await theirs.put(fork, gzipSync('<!doctype html><p>fork'), meta('Fork'))
  return { env, mine, theirs, origin, fork, meta }
}

test('an offer reaches the original link\'s owner and nobody else', async () => {
  const { mine, theirs, origin, fork } = await twoUsers()
  await theirs.offer(fork, { to: origin, base: 3, changed: ['a/A', 'a/D (new)'] })
  const [row] = await mine.list()
  assert.equal(row.offers.length, 1)
  assert.deepEqual({ ...row.offers[0], at: 0 }, { id: fork, title: 'Fork', version: 1, message: null, base: 3, changed: ['a/A', 'a/D (new)'], at: 0, login: 'friend', name: null, avatar: null })
  assert.deepEqual((await theirs.list())[0].offers, [], 'the forker\'s own row lists nothing')
})

test('an offer is the caller\'s own link, to a link that exists', async () => {
  const { mine, theirs, origin, fork } = await twoUsers()
  await assert.rejects(mine.offer(fork, { to: origin }), e => e.status === 404, 'someone else\'s link')
  await assert.rejects(theirs.offer(fork, { to: fork }), e => e.status === 400, 'itself')
  await assert.rejects(theirs.offer(fork, { to: 'nonsense' }), e => e.status === 400)
  await mine.remove(origin)
  await assert.rejects(theirs.offer(fork, { to: origin }), e => e.code === 'no_origin')
})

test('a dismissed offer stays away until a new version; a removed fork stops being listed', async () => {
  const { env, mine, theirs, origin, fork } = await twoUsers()
  await theirs.offer(fork, { to: origin })
  await assert.rejects(theirs.dismissOffer(origin, fork), e => e.status === 404, 'only the origin\'s owner dismisses')
  await mine.dismissOffer(origin, fork)
  assert.deepEqual((await mine.list())[0].offers, [])
  await theirs.offer(fork, { to: origin })
  assert.equal((await mine.list())[0].offers.length, 1)
  await theirs.remove(fork)
  assert.deepEqual((await mine.list())[0].offers, [])
  assert.equal(env.DB.sql.prepare('SELECT COUNT(*) AS n FROM offers').get().n, 1)
})

test('a banned forker\'s offers disappear, and an old host says it needs an update', async () => {
  const { env, mine, theirs, origin, fork } = await twoUsers()
  await theirs.offer(fork, { to: origin })
  env.DB.sql.prepare("UPDATE owners SET status = 'banned' WHERE id = 'o2'").run()
  assert.deepEqual((await mine.list())[0].offers, [])
  const old = client(domain, TOKEN, { fetch: async () => new Response(JSON.stringify({ error: 'No such route.' }), { status: 404 }) })
  await assert.rejects(old.offer(fork, { to: origin }), /needs an update before it can take offers/)
})

test('one link holds at most 50 offers', async () => {
  const { env, theirs, origin, fork, meta } = await twoUsers()
  const insert = env.DB.sql.prepare('INSERT INTO offers (origin_id, share_id, owner_id, created_at, updated_at) VALUES (?, ?, ?, 1, 1)')
  for (let i = 0; i < 50; i++) insert.run(origin, `filler${String(i).padStart(4, '0')}`, 'o2')
  await assert.rejects(theirs.offer(fork, { to: origin }), e => e.code === 'quota')
  void meta
})
