// The map's server stills (app/stills.mjs): what a still's name depends on, and what a request may ask.
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { stillKey, stillServer } from '../app/stills.mjs'

const app = () => {
  const root = mkdtempSync(join(tmpdir(), 'stills-'))
  for (const slug of ['home', 'about']) {
    mkdirSync(join(root, 'src', 'protos', slug), { recursive: true })
    writeFileSync(join(root, 'src', 'protos', slug, 'A.tsx'), 'export default () => null')
  }
  writeFileSync(join(root, 'src', 'theme.css'), '')
  return root
}
const touch = (path, s) => utimesSync(path, s, s)
const later = () => new Promise(r => setTimeout(r, 1100)) // the folders are walked once a second at most

test('a still is named by its route, size, theme and its prototype\'s files', async () => {
  const root = app()
  try {
    const at = { route: 'home/A', w: 1200, h: 750, theme: 'light' }
    const k = stillKey(root, at)
    assert.equal(stillKey(root, at), k)
    assert.notEqual(stillKey(root, { ...at, w: 390 }), k)
    assert.notEqual(stillKey(root, { ...at, theme: 'dark' }), k)
    // Another prototype's change leaves it alone; its own file, or the shared theme, makes a new one.
    touch(join(root, 'src', 'protos', 'about', 'A.tsx'), Date.now() / 1000 + 50)
    await later()
    assert.equal(stillKey(root, at), k)
    touch(join(root, 'src', 'protos', 'home', 'A.tsx'), Date.now() / 1000 + 100)
    await later()
    const k2 = stillKey(root, at)
    assert.notEqual(k2, k)
    touch(join(root, 'src', 'theme.css'), Date.now() / 1000 + 200)
    await later()
    assert.notEqual(stillKey(root, at), k2)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('a request names a variant, a sane size and a theme; without the skill nothing is taken', () => {
  const root = app()
  const s = stillServer({ root, origin: () => 'http://127.0.0.1:1', skill: '', emit: () => {} })
  try {
    assert.throws(() => s.ask({ route: '../x', w: 1200, h: 750 }), /route/)
    assert.throws(() => s.ask({ route: 'home/A', w: 20, h: 750 }), /w and h/)
    assert.throws(() => s.ask({ route: 'home/A', w: 1200, h: 750, theme: 'blue' }), /theme/)
    assert.deepEqual(s.ask({ route: 'home/A', w: 1200, h: 750 }), { unavailable: true })
    assert.equal(s.file('../../session.json'), null)
    assert.equal(s.file('0123456789abcdef0123.webp'), null)
  } finally { s.close(); rmSync(root, { recursive: true, force: true }) }
})
