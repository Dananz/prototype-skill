// Both entry points preserve the owner's earlier choice while still walking the ancestry.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { test } from 'node:test'

const skill = dirname(dirname(fileURLToPath(import.meta.url)))
for (const entry of ['page', 'CLI']) test(`${entry} parent picks preserve decisions and traverse the whole chain`, async () => {
  const project = mkdtempSync(join(tmpdir(), 'proto-parent-picks-'))
  const app = join(project, '.prototypes', '_project')
  const file = slug => join(app, 'src', 'protos', slug, 'meta.ts')
  const put = (slug, fields = {}) => {
    mkdirSync(dirname(file(slug)), { recursive: true })
    writeFileSync(file(slug), `export default ${JSON.stringify({ title: slug, variants: { A: 'First', B: 'Second' }, ...fields }, null, 2)}\n`)
  }
  const meta = slug => JSON.parse(readFileSync(file(slug), 'utf8').replace(/^export default\s*/, ''))
  try {
    put('grand')
    put('parent', { from: 'grand/B', picked: 'A' })
    put('other')
    put('child', { from: 'parent/B', also: ['other/A'] })
    writeFileSync(join(app, 'session.json'), JSON.stringify({ id: 'parents' }))
    let pick
    if (entry === 'page') {
      const server = join(app, 'server.mjs')
      copyFileSync(join(skill, 'app/server.mjs'), server)
      copyFileSync(join(skill, 'app/assignment.mjs'), join(app, 'assignment.mjs'))
      copyFileSync(join(skill, 'app/listener.mjs'), join(app, 'listener.mjs'))
      for (const f of ['history.mjs', 'brief.mjs', 'numbers.mjs']) copyFileSync(join(skill, 'app', f), join(app, f))

      pick = (await import(pathToFileURL(server).href)).pickParents
    } else {
      pick = slug => {
        const r = spawnSync(process.execPath, [join(skill, 'scripts/proto.mjs'), 'pick', slug, 'A', '--project', project, '--session', 'parents'], { encoding: 'utf8' })
        assert.equal(r.status, 0, r.stderr)
      }
    }
    pick('child')
    assert.equal(meta('parent').picked, 'A', 'an existing parent pick must not be replaced')
    assert.equal(meta('grand').picked, 'B', 'preserving a parent must not stop traversal')
    assert.equal(meta('other').picked, undefined, 'also parents must stay undecided')
    put('parent', { from: 'grand/B' })
    pick('child')
    assert.equal(meta('parent').picked, 'B', 'an undecided structural parent should be picked')
    put('parent', { from: 'grand/B', archived: true })
    pick('child')
    assert.equal(meta('parent').picked, undefined, 'archived parents must stay unchanged')
  } finally { rmSync(project, { recursive: true, force: true }) }
})
